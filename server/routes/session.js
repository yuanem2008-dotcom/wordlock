// 输入阶段的服务器验证（安全关键）。
//
// 为什么必须放在服务端：客户端可以改 JS、开 DevTools、直接调接口。
// 「输入 N 次」这道门槛如果由浏览器自己说了算，就等于没有门槛。
// 所以这里由服务端：① 绑定目标词 ② 自己比对每次输入 ③ 自己数够 N 次才放行。

import { Router } from 'express';
import { getProfileBundle, LEVEL_COUNTS } from '../settings.js';
import { createSession, getSession, recordTypingSuccess } from '../sessions.js';

const WORD_RE = /^[a-z'-]+$/;

const normalize = (s) => String(s ?? '').trim().toLowerCase();

// 输了但不对时，只告诉孩子「第几个字母再看看」——不泄露正确字母（需求 2.1）
export function hintFor(typed, target) {
  if (typed.length !== target.length) return { kind: 'length' };
  for (let i = 0; i < typed.length; i++) {
    if (typed[i] !== target[i]) return { kind: 'position', position: i + 1 };
  }
  return { kind: 'none' };
}

export function createSessionRouter(userDb, getDictDb) {
  const router = Router();
  const insertEvent = userDb.prepare(
    `INSERT INTO events (profile_id, ts, session_id, mode, word, step, type, detail)
     VALUES (?, ?, ?, ?, ?, 'typing', ?, ?)`
  );
  const logEvent = (profileId, sid, mode, word, type, detail) =>
    insertEvent.run(profileId, new Date().toISOString(), sid ?? null, mode, word ?? null, type, detail ? JSON.stringify(detail) : null);

  // 绑定目标词：英文入口在第 1 次查词命中后调用；中文入口在选中候选后调用。
  // 服务端自己查词典确认这个词真实存在，不信客户端。
  router.post('/session', (req, res) => {
    const dictDb = getDictDb();
    if (!dictDb) return res.status(503).json({ error: '词典还没建立' });

    const profileId = req.profile.id;
    const bundle = getProfileBundle(userDb, req.profile);
    const required = LEVEL_COUNTS[bundle.effectiveLevel].typing;

    const mode = req.body?.mode === 'zh' ? 'zh' : 'en';
    const word = normalize(req.body?.word);
    const sessionId = String(req.body?.sessionId ?? '');
    if (!word || !WORD_RE.test(word) || !sessionId) {
      return res.status(400).json({ error: '参数不对' });
    }
    const exists = dictDb.prepare('SELECT 1 FROM dict WHERE word_lower = ? LIMIT 1').get(word);
    if (!exists) return res.status(404).json({ error: '词典里没有这个词' });

    // 绑定会话永远从 0 次开始：**任何一次计数都必须经过 /api/typing 的服务端校验**。
    // （曾经这里会因 mode==='en' 白送 1 次，等于不真打字、只调一次这个接口就能让 N=1 完成。）
    // 需求 2.1 的"第 1 次输入算 1/N"仍然满足：前端绑定后会把刚输入的字符串交给 /api/typing 校验并计 1。
    const created = createSession(userDb, profileId, sessionId, { word, mode });
    if (!created.ok) {
      // 同一个会话被换词：拒绝（防「给容易的词过关后改词看释义」）
      return res.status(403).json({ error: '这个会话已经绑定了别的词，请重新开始' });
    }

    const session = created.session;
    const done = session.typing_done === 1;
    const completed = Math.min(session.typing_count, required);
    res.json({ ok: true, word: session.word, mode: session.mode, completed, requiredCount: required, done });
  });

  // 提交一次输入：服务端自己比对并计数
  router.post('/typing', (req, res) => {
    const profileId = req.profile.id;
    const bundle = getProfileBundle(userDb, req.profile);
    const required = LEVEL_COUNTS[bundle.effectiveLevel].typing;

    const sessionId = String(req.body?.sessionId ?? '');
    const typed = normalize(req.body?.typed);
    const session = getSession(userDb, profileId, sessionId);
    if (!session || !session.word) {
      return res.status(403).json({ error: '请先开始查这个词' });
    }
    if (!typed) return res.json({ ok: false, reason: 'empty' });
    if (!WORD_RE.test(typed)) {
      logEvent(profileId, sessionId, session.mode, session.word, 'typing_wrong', { reason: 'invalid_chars' });
      return res.json({ ok: false, reason: 'invalid_chars' });
    }
    if (typed !== session.word) {
      const hint = hintFor(typed, session.word);
      logEvent(profileId, sessionId, session.mode, session.word, 'typing_wrong', hint);
      return res.json({
        ok: false,
        reason: 'mismatch',
        hint: hint.kind === 'length' ? 'length' : hint.kind === 'position' ? 'position' : 'none',
        position: hint.position ?? null,
      });
    }

    const r = recordTypingSuccess(userDb, profileId, session, required);
    logEvent(profileId, sessionId, session.mode, session.word, 'typing_ok', { completed: r.completed });
    if (r.done) logEvent(profileId, sessionId, session.mode, session.word, 'typing_done', null);
    res.json({
      ok: true,
      completed: Math.min(r.completed, required),
      requiredCount: required,
      done: r.done,
    });
  });

  return router;
}
