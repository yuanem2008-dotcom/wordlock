# WordLock —— 安全审阅包（门槛是否可被绕过）

> 这个包是**专门为重审"孩子能不能绕过门槛"而抽取的**，只含相关文件，体积小、可一次读完。
> （完整源码包是 `docs/REVIEW-PACK.md`，320KB+，抓取工具容易在中间被截断。）
>
> 代码快照时间：见仓库最新提交。与具体源码文件冲突时，以源码文件为准。

## 一句话背景

给两个中国孩子（小学五年级、初一）用的英语查词网页应用，核心设计是"设了门槛的字典"：
**孩子必须先手动把单词输入 N 次、再跟读评测通过 M 次，才会看到中文释义。**

## 本次修复要守住的不变量

1. 「输入 N 次」由**服务端**判定：`POST /api/session` 绑定目标词（服务端查词典确认存在），
   `POST /api/typing` 由服务端比对字符串并累加；客户端上报的进度一概不算数。
2. 会话**绑定目标词后不可改**（同一 sessionId 换词必须 403）。
3. 释义放行必须同时满足：**同档案 + 同会话 + `session.word === 请求的词`（归一化）+ 输入已完成 +
   （跟读达标 或 求助通关 或 快速查看 或 该词已学会）**。读音同理。
   → 实现见 `server/sessions.js` 的 `sessionUnlocksMeaning()` / `sessionUnlocksPronunciation()`
4. `/api/events` **只记录、绝不授权**（它接收前端上报，不得改变任何放行状态）。
5. 求助通关由服务端判定：`POST /api/help` 内部查 `learn_sessions.read_fail >= helpAfterFails`。
6. 校准分数线只由服务端算：客户端提交的任何分数一律忽略；有效样本 < 2 个则保留原分数线。
7. 启动强检查：`SCORER=mock` 且没有 `WORDLOCK_DEV=1` → 拒绝启动；密钥缺失 → 拒绝启动。

> ⚠️ 注意：`server/sessions.js`（状态层，提供状态函数）与 `server/routes/session.js`
> （HTTP 路由，暴露 `/api/session`、`/api/typing`）是**两个不同的文件**。

## 请这样审

```
请只针对这一个问题给结论：**孩子能不能绕过"输入 N 次 + 跟读 M 次"看到释义？**
（包括：伪造请求、改会话绑定的词、跨词、跨档案、伪造事件、伪造校准分数、伪造求助、跳过输入直接评分）

要求：
1. 每条结论都必须指向具体文件与代码片段（带行号或函数名），并说明"在什么请求序列下会成功"。
2. 如果某处你无法从这段代码判断，请明确说"需要看 X 文件"，不要猜。
3. 同时指出：这次修复有没有**误伤正常流程**（孩子正常查词会不会被拒）。
4. 最后单列一节"仍然存在的绕过路径"（如果有），并给出建议改法。
```

## 顺便回答上一轮的一个疑问

`server/routes/session.js` 与 `server/sessions.js` **不是同一个文件**：
前者是 HTTP 路由（`POST /api/session`、`POST /api/typing`），后者是与传输无关的状态层
（建会话、记输入/跟读、求助、快速查看，以及"这个会话能否放行释义/读音"的判定）。
这样分层是为了：路由只管收请求，状态改动只能走这几个明确函数。

## 测试

仓库共 119 个测试；其中 `tests/integration.test.js` 末尾有一组标着「安全 N」的回归用例，
每一条都对应一个曾经**真实存在且已实测复现**的绕过路径。


---

## 📄 server/sessions.js

````js
// 学习会话：一次查词流程一行，是「读音 / 释义」门禁的唯一依据。
//
// 安全不变量（务必保持）：
//   1. 会话绑定「档案 + 目标词」，创建后**不能改词**（换词必须开新会话）。
//   2. 所有会放行门禁的字段（typing_done / read_pass / assisted / quick_peek）
//      只能由下面这些明确函数写入，且只能由服务端在真实动作之后调用。
//      路由里不要直接 UPDATE 这些列，也不要接受客户端上报的进度。
//   3. 客户端上报的事件只进 events 表（审计），不改变这里的状态。

const NOW = () => new Date().toISOString();
const SID = (sessionId) => String(sessionId ?? '').slice(0, 64);

export function getSession(userDb, profileId, sessionId) {
  if (!sessionId) return null;
  return userDb
    .prepare('SELECT * FROM learn_sessions WHERE profile_id = ? AND session_id = ?')
    .get(profileId, SID(sessionId));
}

// 建立会话并绑定目标词。同一个 (档案, 会话) 若已存在：
//   - 词相同 → 原样返回（幂等）
//   - 词不同 → 拒绝（这是防止「给容易的词过关 → 改成生僻词 → 看释义」的关键）
export function createSession(userDb, profileId, sessionId, { word, mode = 'en', counted = 0 }) {
  const id = SID(sessionId);
  const target = String(word ?? '').trim().toLowerCase().slice(0, 64);
  if (!id || !target) return { ok: false, reason: 'bad_request' };

  const existing = getSession(userDb, profileId, id);
  if (existing) {
    if (existing.word !== target) return { ok: false, reason: 'word_mismatch', session: existing };
    return { ok: true, session: existing, completed: existing.typing_count };
  }

  const now = NOW();
  userDb
    .prepare(
      `INSERT INTO learn_sessions
         (profile_id, session_id, word, mode, typing_count, typing_done, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(profileId, id, target, mode === 'zh' ? 'zh' : 'en', Math.max(0, counted), now, now);
  return { ok: true, session: getSession(userDb, profileId, id), completed: Math.max(0, counted) };
}

function update(userDb, profileId, sessionId, sets, args) {
  const id = SID(sessionId);
  userDb
    .prepare(`UPDATE learn_sessions SET ${sets.join(', ')}, updated_at = ? WHERE profile_id = ? AND session_id = ?`)
    .run(...args, NOW(), profileId, id);
}

// 输入正确一次：服务端比对通过后调用，累加到 N 次就标记输入完成。
export function recordTypingSuccess(userDb, profileId, session, requiredCount) {
  const completed = session.typing_count + 1;
  const done = completed >= Math.max(1, requiredCount);
  update(
    userDb,
    profileId,
    session.session_id,
    ['typing_count = ?', 'typing_done = ?'],
    [completed, done ? 1 : 0]
  );
  return { completed, done };
}

export function recordReadingPass(userDb, profileId, session, score) {
  update(
    userDb,
    profileId,
    session.session_id,
    ['read_pass = read_pass + 1', 'read_attempts = read_attempts + 1', 'best_score = MAX(best_score, ?)'],
    [score ?? 0]
  );
}

export function recordReadingFail(userDb, profileId, session) {
  update(userDb, profileId, session.session_id, ['read_fail = read_fail + 1', 'read_attempts = read_attempts + 1'], []);
}

// 求助通关：只有服务端确认「累计失败够数」才能调用（见 routes/child.js 的 /api/help）。
export function useHelp(userDb, profileId, session) {
  update(userDb, profileId, session.session_id, ['assisted = 1'], []);
  return getSession(userDb, profileId, session.session_id);
}

// 快速查看：只有 /api/quick-peek 在校验过当天额度后能调用。
export function useQuickPeek(userDb, profileId, session) {
  update(userDb, profileId, session.session_id, ['quick_peek = 1'], []);
  return getSession(userDb, profileId, session.session_id);
}

export function markMeaningShown(userDb, profileId, session) {
  if (!session) return;
  update(userDb, profileId, session.session_id, ['meaning_shown = 1'], []);
}

// 会话是否已经放行「释义」：必须同档案 + 同会话 + 同词，且输入与跟读都达标。
export function sessionUnlocksMeaning(session, word, requiredReadingCount) {
  if (!session) return false;
  if (session.word !== String(word ?? '').trim().toLowerCase()) return false;
  if (session.typing_done !== 1) return false;
  if (session.assisted === 1 || session.quick_peek === 1) return true;
  return session.read_pass >= requiredReadingCount;
}

// 会话是否已经放行「读音」：输入完成即可。
export function sessionUnlocksPronunciation(session, word) {
  if (!session) return false;
  if (session.word !== String(word ?? '').trim().toLowerCase()) return false;
  return session.typing_done === 1;
}
````


---

## 📄 server/routes/session.js

````js
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

    // 英文入口：孩子第 1 次输对了，算 1/N（需求 2.1）；中文入口从 0/N 开始（需求 2.6）
    const counted = mode === 'en' ? 1 : 0;
    const created = createSession(userDb, profileId, sessionId, { word, mode, counted });
    if (!created.ok) {
      // 同一个会话被换词：拒绝（防「给容易的词过关后改词看释义」）
      return res.status(403).json({ error: '这个会话已经绑定了别的词，请重新开始' });
    }

    let session = created.session;
    let done = session.typing_done === 1;
    // 英文入口且 N=1：第 1 次输入就直接进入下一阶段
    if (mode === 'en' && required <= 1 && !done) {
      const r = recordTypingSuccess(userDb, profileId, session, required);
      session = getSession(userDb, profileId, sessionId);
      done = r.done;
    }
    const completed = Math.min(session.typing_count, required);
    if (done) logEvent(profileId, sessionId, mode, word, 'typing_done', null);
    logEvent(profileId, sessionId, mode, word, 'typing_ok', { completed });

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
````


---

## 📄 server/routes/events.js

````js
// 查词事件记录（需求 2.10）——**只记录，不授权**。
//
// 安全不变量：这个接口从前端接收数据，所以它绝不能改变任何门禁状态。
// 以前它会在收到 help_used 时直接把词判为「已学会」，等于让孩子自报「我用过求助了」
// 就能看到释义（实测可绕过）。现在：
//   - 会不会放行，只由 /api/session、/api/typing、/api/score、/api/help、/api/quick-peek
//     这些服务端能核实真实动作的接口决定；
//   - 这里只往 events 表写一行日志，供家长模式看记录与「放弃点」统计。

import { Router } from 'express';

// 这些事件不涉及任何放行，允许客户端上报（都是"孩子做了什么"的观察值）
const CLIENT_REPORTABLE = new Set([
  'lookup_start',
  'not_found',
  'cancel',
  'network_error',
  'quick_peek_request', // 只是"点了按钮"的记录；真正的放行看 /api/quick-peek
]);

export function createEventsRouter(userDb) {
  const router = Router();
  const insert = userDb.prepare(
    `INSERT INTO events (profile_id, ts, session_id, mode, word, step, type, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  router.post('/events', (req, res) => {
    const profileId = req.profile.id;
    const list = Array.isArray(req.body?.events) ? req.body.events : [req.body ?? {}];
    const ts = new Date().toISOString();
    const run = userDb.transaction(() => {
      for (const e of list) {
        const type = typeof e.type === 'string' ? e.type.slice(0, 64) : '';
        if (!type) continue;
        // 服务端负责的门禁事件不接受客户端上报（避免重复计数，也避免被伪造利用）
        if (!CLIENT_REPORTABLE.has(type)) continue;
        insert.run(
          profileId,
          ts,
          typeof e.sessionId === 'string' ? e.sessionId.slice(0, 64) : null,
          e.mode === 'zh' ? 'zh' : 'en',
          typeof e.word === 'string' ? e.word.slice(0, 64) : null,
          typeof e.step === 'string' ? e.step.slice(0, 32) : null,
          type,
          e.detail == null ? null : JSON.stringify(e.detail)
        );
      }
    });
    run();
    res.json({ ok: true, recorded: true });
  });

  return router;
}
````


---

## 📄 server/routes/score.js

````js
// 发音评测接口（需求 5.1 / 阶段 2）+ 首次校准。
//
// 安全不变量：
//   - 评分前必须确认：同一个档案、同一个会话、同一个词、**输入阶段已完成**。
//     否则客户端可以直接调 /api/score 跳过「输入 N 次」这道门槛。
//   - mockScore（模拟打分滑块）只在显式开发模式下生效，绝不作为安全边界。
//   - 校准分数线由**服务端**根据自己记录的分数算，不接受客户端上报的分数。

import { Router } from 'express';
import { getScorer, scorerIsConfigured } from '../scorers/index.js';
import { decideOutcome } from '../scoring-policy.js';
import { getProfileBundle, LEVEL_COUNTS } from '../settings.js';
import { getSession, recordReadingPass, recordReadingFail, getSession as readSession } from '../sessions.js';
import { graduateWord } from '../vocab.js';

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const CALIBRATION_MIN_SAMPLES = 2;
const CALIBRATION_CLAMP = [50, 75];

const normalize = (s) => String(s ?? '').trim().toLowerCase();

export function createScoreRouter(userDb) {
  const router = Router();
  const insertEvent = userDb.prepare(
    `INSERT INTO events (profile_id, ts, session_id, mode, word, step, type, detail)
     VALUES (?, ?, ?, ?, ?, 'reading', ?, ?)`
  );
  const logEvent = (profileId, sid, word, type, detail) =>
    insertEvent.run(profileId, new Date().toISOString(), sid ?? null, 'en', word ?? null, type, detail ? JSON.stringify(detail) : null);

  // 模拟打分只允许在显式开发模式下使用
  const devMode = () => (process.env.WORDLOCK_DEV ?? '') === '1';

  router.post('/score', async (req, res) => {
    const profileId = req.profile.id;
    const bundle = getProfileBundle(userDb, req.profile);
    const passScore = Number(bundle.settings.passScore) || 60;
    const requiredReading = LEVEL_COUNTS[bundle.effectiveLevel].reading;

    const word = normalize(req.body?.word);
    const sessionId = String(req.body?.sessionId ?? '').slice(0, 64) || null;
    const isCalibration = Boolean(req.body?.calibration);

    /* ---- 门槛：会话必须存在、绑定同一个词、输入已完成 ---- */
    const session = isCalibration ? null : getSession(userDb, profileId, sessionId);
    if (!isCalibration) {
      if (!session || session.word !== word) {
        return res.status(403).json({ error: '这个会话不对应这个词，请重新开始' });
      }
      if (session.typing_done !== 1) {
        return res.status(403).json({ error: '要先完成输入才能跟读哦' });
      }
    }

    /* ---- 音频基本校验（不再因缺音频抛异常）---- */
    const audioBase64 = typeof req.body?.audioBase64 === 'string' ? req.body.audioBase64 : '';
    const buffer = audioBase64 ? Buffer.from(audioBase64, 'base64') : null;
    const mockScore = Number(req.body?.mockScore);
    const useMock = Number.isFinite(mockScore) && devMode();

    if (!useMock && (!buffer || buffer.length < 900)) {
      return res.json({ score: null, passed: false, error: 'too_quiet', message: '没听清，靠近一点再念一遍', retry: true });
    }
    if (buffer && buffer.length > MAX_AUDIO_BYTES) {
      return res.json({ score: null, passed: false, error: 'too_long', message: '录音有点长了，再试一次', retry: true });
    }

    const scorer = await getScorer();
    if (!scorerIsConfigured(scorer.name)) {
      return res.json({ score: null, passed: false, error: 'not_configured', message: '评测服务还没配置好' });
    }

    let result;
    try {
      result = await scorer.score(buffer, word, useMock ? { mockScore } : {});
    } catch (err) {
      console.warn(`[评测] ${scorer.name} 抛异常：${err.message}`);
      result = { score: null, detail: null, error: 'scorer_error' };
    }

    /* ---- 校准：只由服务端记录分数 ---- */
    if (isCalibration) {
      if (result.error || result.score == null) {
        const message = result.error === 'no_speech' ? '没听清，靠近一点再念一遍' : '评测没成功，再试一次';
        return res.json({ score: null, passed: false, error: result.error || 'scorer_error', message, retry: true });
      }
      userDb
        .prepare('INSERT INTO calibration_samples (profile_id, ts, score, clean) VALUES (?, ?, ?, ?)')
        .run(profileId, new Date().toISOString(), result.score, result.detail?.noisy || result.detail?.nonsense ? 0 : 1);
      return res.json({ score: result.score, passed: true, calibration: true, detail: null });
    }

    /* ---- 正常跟读 ---- */
    const outcome = decideOutcome(result, passScore);
    if (outcome.kind === 'retry') {
      return res.json({
        score: null,
        passed: false,
        error: result.error || 'bad_audio',
        message: outcome.message,
        retry: true,
        canHelp: session.read_fail >= bundle.settings.helpAfterFails,
      });
    }
    if (outcome.kind === 'error') {
      console.warn(`[评测] ${scorer.name} 失败：${result.error}`);
      return res.json({ score: null, passed: false, error: result.error || 'scorer_error', message: outcome.message });
    }

    // 只有真正跑完一次评测（通过或没通过）才计入状态
    if (outcome.passed) recordReadingPass(userDb, profileId, session, outcome.score);
    else recordReadingFail(userDb, profileId, session);
    logEvent(profileId, sessionId, word, outcome.passed ? 'read_pass' : 'read_fail', { score: outcome.score });

    let current = readSession(userDb, profileId, sessionId);
    // 读够 M 次 → 通关写入生词本
    if (current.read_pass >= requiredReading) {
      graduateWord(userDb, profileId, word, {
        settings: bundle.settings,
        assisted: Boolean(current.assisted),
        readAttempts: current.read_attempts,
        bestScore: current.best_score,
      });
    }
    current = readSession(userDb, profileId, sessionId);

    res.json({
      score: outcome.score,
      passed: outcome.passed,
      detail: result.detail ?? null,
      passes: current.read_pass,
      requiredCount: requiredReading,
      canHelp: !current.assisted && current.read_fail >= bundle.settings.helpAfterFails,
    });
  });

  /* ---------- 首次校准（需求 阶段2）---------- */

  // 开始校准：清掉旧样本（分数完全由服务端记录，客户端无法伪造）
  router.post('/calibration/start', (req, res) => {
    userDb.prepare('DELETE FROM calibration_samples WHERE profile_id = ?').run(req.profile.id);
    res.json({ ok: true });
  });

  // 结束校准：服务端算平均分 → passScore = clamp(round(avg − 15), 50, 75)
  // 有效样本不足 2 个（例如孩子敷衍、被拒识）→ 保留原分数线，避免被故意压低。
  router.post('/calibration/finish', (req, res) => {
    const profileId = req.profile.id;
    const skipped = Boolean(req.body?.skipped);
    const samples = userDb
      .prepare('SELECT score, clean FROM calibration_samples WHERE profile_id = ?')
      .all(profileId);
    const usable = samples.filter((s) => s.clean === 1 && Number.isFinite(s.score) && s.score > 0);

    let passScore = null;
    if (!skipped && usable.length >= CALIBRATION_MIN_SAMPLES) {
      const avg = usable.reduce((a, b) => a + b.score, 0) / usable.length;
      passScore = Math.min(CALIBRATION_CLAMP[1], Math.max(CALIBRATION_CLAMP[0], Math.round(avg - 15)));
    }

    const row = req.profile;
    let overrides = {};
    try {
      overrides = JSON.parse(row.settings_json || '{}') || {};
    } catch {
      overrides = {};
    }
    if (passScore != null) overrides.passScore = passScore;
    overrides.calibrated = true;
    userDb.prepare('UPDATE profiles SET settings_json = ? WHERE id = ?').run(JSON.stringify(overrides), profileId);
    userDb.prepare('DELETE FROM calibration_samples WHERE profile_id = ?').run(profileId);

    res.json({ ok: true, passScore, usedSamples: usable.length, totalSamples: samples.length });
  });

  return router;
}
````


---

## 📄 server/scoring-policy.js

````js
// 跟读评测的处置策略：把「评测器返回的结果 + 通过线」变成对孩子的处置。
//
// 决策原则（需求 2.3 与 2.9）：
//   - 环境/设备问题（没说、太吵、录爆了）不该算孩子读错 → retry，不计入失败次数
//   - 但环境有问题而孩子其实读得不错 → 直接算通过，不让孩子白念
//   - 读的是别的词（乱读）→ fail，正常计入失败次数（否则乱念也能过关，门槛就废了）
//   - 服务故障（网络/鉴权）→ error，只提示"再试一次"

export const MESSAGES = {
  no_speech: '没听清，靠近一点再念一遍',
  bad_audio: '周围有点吵，换个安静的地方再试一次',
  error: '评测没成功，再试一次',
};

// result: { score, error, detail } 来自 scorer
// 返回：{ kind: 'pass'|'fail'|'retry'|'error', score?, passed?, message? }
//   retry = 不计入失败次数（孩子不受罚）
export function decideOutcome(result, passScore) {
  if (result?.error || result?.score == null) {
    if (result?.error === 'no_speech') return { kind: 'retry', message: MESSAGES.no_speech };
    if (result?.error === 'bad_audio') return { kind: 'retry', message: MESSAGES.bad_audio };
    return { kind: 'error', message: MESSAGES.error };
  }
  const score = result.score;
  const passed = score >= passScore;
  // 环境有噪声但孩子读得不错 → 照常通过；读得不好则不怪孩子，让他重念
  if (result.detail?.noisy && !passed) {
    return { kind: 'retry', message: MESSAGES.bad_audio };
  }
  return { kind: passed ? 'pass' : 'fail', score, passed };
}
````


---

## 📄 server/routes/vocab.js

````js
// 释义 / 生词本 / 复习（需求 2.4、2.8、阶段 3）。

import { Router } from 'express';
import { getProfileBundle, LEVEL_COUNTS } from '../settings.js';
import { getSession, markMeaningShown, sessionUnlocksMeaning } from '../sessions.js';
import {
  getVocabWord,
  getLearnedWord,
  learnedDaysAgo,
  dueWords,
  pendingWords,
  applyReviewResult,
  graduateWord,
} from '../vocab.js';

function normalizeWord(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

function translationLines(dictDb, word, maxLines) {
  const row = dictDb
    .prepare('SELECT translation FROM dict WHERE word_lower = ? ORDER BY CASE WHEN frq > 0 THEN 0 ELSE 1 END, frq ASC LIMIT 1')
    .get(word);
  if (!row || !row.translation) return [];
  return String(row.translation)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, Math.max(1, maxLines));
}

export function createVocabRouter(userDb, getDictDb) {
  const router = Router();
  const insertEvent = userDb.prepare(
    `INSERT INTO events (profile_id, ts, session_id, mode, word, step, type, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  function logEvent(profileId, e) {
    insertEvent.run(
      profileId,
      new Date().toISOString(),
      e.sessionId ?? null,
      e.mode ?? 'en',
      e.word ?? null,
      e.step ?? null,
      e.type,
      e.detail ? JSON.stringify(e.detail) : null
    );
  }

  // 释义（需求 2.4）：只有「本档案里已学会」或「本会话已完成输入 + 跟读达标/求助/快速查看」
  // 才返回。**必须同时满足：同一个档案、同一个会话、会话绑定的就是这个词**——
  // 否则「给 apple 通过后拿同一会话去问 banana 的释义」就能看遍整本字典（已实测的绕过）。
  router.get('/meaning/:word', (req, res) => {
    const profileId = req.profile.id;
    const bundle = getProfileBundle(userDb, req.profile);
    const word = normalizeWord(req.params.word);
    const dictDb = getDictDb();
    if (!dictDb) return res.status(503).json({ error: '词典还没建立' });

    const learned = getLearnedWord(userDb, profileId, word);
    const session = getSession(userDb, profileId, req.get('X-Session-Id'));
    const m = LEVEL_COUNTS[bundle.effectiveLevel].reading;
    if (!learned && !sessionUnlocksMeaning(session, word, m)) {
      return res.status(403).json({ error: '要先完成输入和跟读才能看释义哦' });
    }

    const lines = translationLines(dictDb, word, bundle.settings.meaningLines);
    logEvent(profileId, { sessionId: session?.session_id, word, type: 'meaning_shown', step: 'meaning' });
    markMeaningShown(userDb, profileId, session);
    res.json({
      word,
      lines,
      learnedDaysAgo: learned ? learnedDaysAgo(learned) : null,
    });
  });

  // 生词本列表（只读，阶段 3）
  router.get('/vocab', (req, res) => {
    const dictDb = getDictDb();
    const rows = userDb
      .prepare('SELECT * FROM vocab WHERE profile_id = ? ORDER BY first_learned_at DESC, id DESC')
      .all(req.profile.id);
    const words = rows.map((row) => {
      let phonetic = '';
      let gloss = '';
      if (dictDb) {
        const d = dictDb
          .prepare('SELECT phonetic, translation FROM dict WHERE word_lower = ? LIMIT 1')
          .get(row.word);
        phonetic = d?.phonetic ?? '';
        gloss = String(d?.translation ?? '').split('\n')[0]?.trim() ?? '';
      }
      return { ...row, phonetic, gloss };
    });
    res.json({ words });
  });

  // 今天要复习的词（需求 阶段3：每天最多 reviewPerDay 个）
  router.get('/review/today', (req, res) => {
    const bundle = getProfileBundle(userDb, req.profile);
    const dictDb = getDictDb();
    const rows = dueWords(userDb, req.profile.id, bundle.settings);
    const words = rows.map((row) => {
      const lines = dictDb ? translationLines(dictDb, row.word, bundle.settings.meaningLines) : [];
      return { word: row.word, gloss: lines.join('；'), assisted: row.assisted };
    });
    const pending = pendingWords(userDb, req.profile.id);
    res.json({ words, pendingCount: pending.length });
  });

  // 复习答题：显示中文释义 → 输入英文，1 次（需求 阶段3）
  router.post('/review/answer', (req, res) => {
    const profileId = req.profile.id;
    const bundle = getProfileBundle(userDb, req.profile);
    const word = normalizeWord(req.body?.word);
    const typed = normalizeWord(req.body?.typed);
    const row = getVocabWord(userDb, profileId, word);
    if (!row || row.status !== 'learned') {
      return res.status(404).json({ error: '这个词不在生词本里' });
    }
    const correct = typed === word && typed !== '';
    const updated = applyReviewResult(userDb, profileId, word, correct, bundle.settings);
    logEvent(profileId, {
      word,
      type: correct ? 'review_ok' : 'review_wrong',
      step: 'review',
      detail: { stage: updated?.stage },
    });
    res.json({
      correct,
      answer: word,
      stage: updated?.stage ?? 0,
      nextReviewAt: updated?.next_review_at ?? null,
    });
  });

  // 待巩固列表（阶段 5 的 pending 词）
  router.get('/pending', (req, res) => {
    const dictDb = getDictDb();
    const bundle = getProfileBundle(userDb, req.profile);
    const rows = pendingWords(userDb, req.profile.id);
    const words = rows.map((row) => {
      const lines = dictDb ? translationLines(dictDb, row.word, bundle.settings.meaningLines) : [];
      return { word: row.word, gloss: lines.join('；') };
    });
    res.json({ words });
  });

  // 待巩固完成：按当前门槛完整过一遍输入+跟读后，由 score 路由通关。
  // 这里提供直接查询：前端用来判断某个 pending 词是否已转正。
  router.get('/pending/:word/status', (req, res) => {
    const row = getVocabWord(userDb, req.profile.id, normalizeWord(req.params.word));
    res.json({ word: normalizeWord(req.params.word), status: row?.status ?? null });
  });

  // 兼容入口：把 pending 词标记通关（跟读走 score 路由自动处理，这里给 consolidate 手动兜底）
  router.post('/pending/:word/complete', (req, res) => {
    const bundle = getProfileBundle(userDb, req.profile);
    const word = normalizeWord(req.params.word);
    const row = getVocabWord(userDb, req.profile.id, word);
    if (!row || row.status !== 'pending') {
      return res.status(404).json({ error: '没有找到待巩固的这个词' });
    }
    const session = getSession(userDb, req.profile.id, req.get('X-Session-Id'));
    const m = LEVEL_COUNTS[bundle.effectiveLevel].reading;
    // 与释义接口同一套判定：必须同一个会话、绑定同一个词、输入与跟读都达标
    if (!sessionUnlocksMeaning(session, word, m)) {
      return res.status(403).json({ error: '要先完成输入和跟读' });
    }
    const updated = graduateWord(userDb, req.profile.id, word, {
      settings: bundle.settings,
      assisted: Boolean(row.assisted),
      readAttempts: session?.read_attempts ?? row.read_attempts,
    });
    res.json({ ok: true, status: updated.status });
  });

  return router;
}
````


---

## 📄 server/routes/child.js

````js
// 孩子侧的辅助接口：快速查看（阶段5）、学习天数（阶段6）、花园（阶段6）、主题选择。

import { Router } from 'express';
import { getProfileBundle, countActiveDays } from '../settings.js';
import { getLearnedWord, getVocabWord, graduateWord, todayLocal } from '../vocab.js';
import { lookupLimitState } from '../limits.js';
import { getSession, markMeaningShown, useHelp, useQuickPeek } from '../sessions.js';

export function createChildRouter(userDb, getDictDb) {
  const router = Router();
  const insertEvent = userDb.prepare(
    `INSERT INTO events (profile_id, ts, session_id, mode, word, step, type, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  function translationLines(word, maxLines) {
    const dictDb = getDictDb();
    if (!dictDb) return [];
    const row = dictDb
      .prepare('SELECT translation FROM dict WHERE word_lower = ? LIMIT 1')
      .get(word);
    if (!row?.translation) return [];
    return String(row.translation)
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, Math.max(1, maxLines));
  }

  // 快速查看（需求 阶段5）：服务器校验剩余次数；写入 pending 生词本
  router.post('/quick-peek', (req, res) => {
    const profileId = req.profile.id;
    const bundle = getProfileBundle(userDb, req.profile);
    const quota = Math.max(0, Math.floor(bundle.settings.quickPeekPerDay ?? 0));
    if (quota === 0) {
      return res.status(403).json({ error: '快速查看没有打开' });
    }
    const used = userDb
      .prepare(
        `SELECT COUNT(*) AS n FROM events
         WHERE profile_id = ? AND type = 'quick_peek' AND date(ts, 'localtime') = date('now', 'localtime')`
      )
      .get(profileId)?.n ?? 0;
    if (used >= quota) {
      return res.status(403).json({ error: '今天的快速查看已经用完啦' });
    }

    const word = String(req.body?.word ?? '').trim().toLowerCase().slice(0, 64);
    const sessionId = String(req.body?.sessionId ?? '').slice(0, 64) || null;
    const mode = req.body?.mode === 'zh' ? 'zh' : 'en';
    if (!/^[a-z'-]+$/.test(word)) {
      return res.status(400).json({ error: '词不对' });
    }

    // 必须绑定到「本会话正在查的那个词」：否则可以拿 apple 的会话去快速查看任意词
    const session = getSession(userDb, profileId, sessionId);
    if (!session || session.word !== word) {
      return res.status(403).json({ error: '这个会话不对应这个词，请重新开始' });
    }

    // pending 的词不覆盖已学会的（需求 2.8 / 阶段5）
    const existing = getVocabWord(userDb, profileId, word);
    if (!existing || existing.status !== 'learned') {
      userDb
        .prepare(
          `INSERT INTO vocab (profile_id, word, entry_mode, status, first_learned_at)
           VALUES (?, ?, ?, 'pending', ?)
           ON CONFLICT(profile_id, word) DO UPDATE SET status = 'pending'`
        )
        .run(profileId, word, mode, new Date().toISOString());
    }

    const ts = new Date().toISOString();
    insertEvent.run(profileId, ts, sessionId, mode, word, 'typing', 'quick_peek', null);
    insertEvent.run(profileId, ts, sessionId, mode, word, 'meaning', 'meaning_shown', JSON.stringify({ quickPeek: true }));
    // 只有走完上面的额度校验、且会话绑定的是这个词，才由服务端写入放行标记
    useQuickPeek(userDb, profileId, session);
    markMeaningShown(userDb, profileId, session);

    const remaining = quota - used - 1;
    res.json({ ok: true, lines: translationLines(word, bundle.settings.meaningLines), remaining });
  });

  // 求助通关（需求 2.3）：由**服务端**确认「累计读不过 helpAfterFails 次」才放行。
  // 以前客户端发一条 help_used 事件就能通关（实测可绕过），现在必须服务端同意。
  router.post('/help', (req, res) => {
    const profileId = req.profile.id;
    const bundle = getProfileBundle(userDb, req.profile);
    const word = String(req.body?.word ?? '').trim().toLowerCase().slice(0, 64);
    const sessionId = String(req.body?.sessionId ?? '').slice(0, 64) || null;
    const session = getSession(userDb, profileId, sessionId);
    if (!session || session.word !== word) {
      return res.status(403).json({ error: '这个会话不对应这个词，请重新开始' });
    }
    if (session.typing_done !== 1) {
      return res.status(403).json({ error: '要先完成输入才能求助哦' });
    }
    if (session.assisted === 1) return res.json({ ok: true, assisted: true, alreadyHelped: true });

    const need = Math.max(1, Math.floor(bundle.settings.helpAfterFails ?? 4));
    if (session.read_fail < need) {
      return res.status(403).json({
        error: '再多试几次吧',
        remaining: need - session.read_fail,
      });
    }
    useHelp(userDb, profileId, session);
    insertEvent.run(profileId, new Date().toISOString(), sessionId, session.mode, word, 'reading', 'help_used', null);
    graduateWord(userDb, profileId, word, {
      settings: bundle.settings,
      assisted: true,
      readAttempts: session.read_attempts,
      bestScore: session.best_score,
    });
    res.json({ ok: true, assisted: true });
  });

  // 学习天数（需求 阶段6）：本周（近 7 天）与累计；不做断签清零
  router.get('/stats', (req, res) => {
    const profileId = req.profile.id;
    const weekRow = userDb
      .prepare(
        `SELECT COUNT(DISTINCT date(ts, 'localtime')) AS n FROM events
         WHERE profile_id = ? AND date(ts, 'localtime') >= date('now', 'localtime', '-6 days')`
      )
      .get(profileId);
    res.json({ weekDays: weekRow?.n ?? 0, totalDays: countActiveDays(userDb, profileId) });
  });

  // 花园（需求 阶段6）：自己的植物；家庭花园只给总数
  router.get('/garden', (req, res) => {
    const profileId = req.profile.id;
    const words = userDb
      .prepare("SELECT word, first_learned_at FROM vocab WHERE profile_id = ? AND status = 'learned' ORDER BY first_learned_at, id")
      .all(profileId)
      .map((r, i) => ({ word: r.word, slot: i }));
    const familyEnabled = userDb.prepare("SELECT value FROM meta WHERE key = 'family_garden'").get()?.value === '1';
    let familyTotal = null;
    if (familyEnabled) {
      familyTotal = userDb.prepare("SELECT COUNT(*) AS n FROM vocab WHERE status = 'learned'").get()?.n ?? 0;
    }
    res.json({ plants: words, total: words.length, familyEnabled, familyTotal });
  });

  // 孩子自己选主题（需求 阶段6：theme 由孩子选）
  router.post('/theme', (req, res) => {
    const theme = req.body?.theme === 'garden' ? 'garden' : 'simple';
    const row = req.profile;
    let overrides = {};
    try {
      overrides = JSON.parse(row.settings_json || '{}') || {};
    } catch {
      overrides = {};
    }
    overrides.theme = theme;
    userDb.prepare('UPDATE profiles SET settings_json = ? WHERE id = ?').run(JSON.stringify(overrides), row.id);
    res.json({ ok: true, theme });
  });

  return router;
}
````


---

## 📄 server/scorers/xunfei.js

````js
// 讯飞开放平台「语音评测（ISE）」—— 英语单词模式。
//
// 本文件按官方文档实现（2026-09 核对）：
//   https://www.xfyun.cn/doc/Ise/IseAPI.html  （语音评测 流式版 API 文档）
// 要点：
//   - 地址：wss://ise-api.xfyun.cn/v2/open-ise
//   - 鉴权：HMAC-SHA256，签名串是 host/date/request-line 三行，再 base64 成 authorization
//   - 音频：16k、16bit、单声道 PCM，每帧 1280 字节（官方建议每 40ms 一帧）
//   - 流程：先发一帧 ssb（上传评测参数），再按 auw 逐帧发音频（首帧 aus=1、中间 aus=2、末帧 aus=4 且 status=2）
//   - 返回：data.data 是 base64 的 XML，里面 total_score 等就是分数
//
// 需要的环境变量（.env）：
//   XUNFEI_APP_ID / XUNFEI_API_KEY / XUNFEI_API_SECRET
//   可选：XUNFEI_GROUP（pupil/youth/adult，默认 pupil）、XUNFEI_CHECK_TYPE（easy/common/hard，默认 easy）

import crypto from 'node:crypto';

const HOST = 'ise-api.xfyun.cn';
const PATH = '/v2/open-ise';
const FRAME_BYTES = 1280;      // 官方建议：每帧 1280 字节
const FRAME_INTERVAL_MS = 40;  // 官方建议：每 40ms 一帧
const OVERALL_TIMEOUT_MS = 20000;

/* ---------- 鉴权 ---------- */

// 官方签名串（三行，冒号后有空格），apiSecret 做 HMAC-SHA256 再 base64。
export function signOrigin(date, apiSecret) {
  const origin = `host: ${HOST}\ndate: ${date}\nGET ${PATH} HTTP/1.1`;
  return crypto.createHmac('sha256', apiSecret).update(origin).digest('base64');
}

// 带鉴权参数的 wss 地址。spaced 控制 authorization 里逗号后是否带空格：
// 文档正文用的是不带空格的写法，而官方示例代码历史上用带空格的写法，两种都可能被接受，
// 所以保留这个开关，鉴权失败时换另一种重试。
export function buildAuthUrl({ apiKey, apiSecret, date = new Date().toUTCString(), spaced = false }) {
  const signature = signOrigin(date, apiSecret);
  const parts = [
    `api_key="${apiKey}"`,
    `algorithm="hmac-sha256"`,
    `headers="host date request-line"`,
    `signature="${signature}"`,
  ];
  const authOrigin = parts.join(spaced ? ', ' : ',');
  const authorization = Buffer.from(authOrigin).toString('base64');
  const query = new URLSearchParams({ host: HOST, date, authorization });
  return `wss://${HOST}${PATH}?${query.toString()}`;
}

/* ---------- 音频处理 ---------- */

// 读出 WAV 的格式（不是 WAV 就返回 null）
export function readWavFormat(buffer) {
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= buffer.length) {
      return {
        formatTag: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

// 取出裸 PCM 数据。不能写死"跳过 44 字节"——WAV 里可能有 LIST/fact 等额外块，
// afconvert 生成的 WAV 就带 LIST 块，写死偏移会把块头当成音频，讯飞直接报 48195 格式不符。
export function extractPcm(buffer) {
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return buffer; // 已经是裸 PCM
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'data') return buffer.subarray(body, Math.min(body + size, buffer.length));
    offset = body + size + (size % 2);
  }
  return buffer.subarray(Math.min(44, buffer.length)); // 兜底
}

// 切成 1280 字节一帧，并标好 aus（1 首帧 / 2 中间 / 4 末帧）和 status（0 / 1 / 2）。
export function buildAudioFrames(pcm, frameBytes = FRAME_BYTES) {
  const frames = [];
  for (let offset = 0; offset < pcm.length; offset += frameBytes) {
    const chunk = pcm.subarray(offset, Math.min(offset + frameBytes, pcm.length));
    const isFirst = offset === 0;
    const isLast = offset + frameBytes >= pcm.length;
    frames.push({
      data: chunk,
      aus: isFirst ? 1 : isLast ? 4 : 2,
      status: isFirst && isLast ? 2 : isFirst ? 0 : isLast ? 2 : 1,
    });
  }
  return frames;
}

/* ---------- 结果解析 ---------- */

function attr(xml, name) {
  const m = xml.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

export function parseResultXml(xml) {
  const num = (name) => {
    const v = attr(xml, name);
    if (v == null || v === '') return null; // 注意 Number(null) 是 0，会假装成 0 分
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    total: num('total_score'),
    // 官方文档里把 accuracy 写成了 accuracy_socre（原文如此），两种都认
    accuracy: num('accuracy_score') ?? num('accuracy_socre'),
    fluency: num('fluency_score'),
    integrity: num('integrity_score'),
    phone: num('phone_score'),
    tone: num('tone_score'),
    standard: num('standard_score'),
    rejected: attr(xml, 'is_rejected') === 'true',
    exceptInfo: num('except_info'),
    dpMessage: attr(xml, 'dp_message'),
  };
}

// 讯飞单词评测的原始分是 0~5 分制。官方 FAQ 给了对照表：
//   4.3~5 分 = 86~100 分（优）｜3.5~4.2 = 70~85（良）｜2.5~3.4 = 50~69（中）
//   1.5~2.4 = 30~49（差）｜0~1.4 = 0~29（很差）
// 本应用统一用 0~100（通过线 60/70 也是按这个来的），所以要乘 20。
export function toHundredScale(raw) {
  if (raw == null) return null;
  return Math.max(0, Math.min(100, Math.round(raw * 20)));
}

// except_info 的含义（官方文档）：
//   0     无异常
//   28673 无语音输入或音量太小      → 没念/太小声：不计入失败
//   28676 检测到语音为乱说类型      → 读的是别的词：算一次失败
//   28680 信噪比太低（1.7 以下）    → 环境太吵
//   28709 信噪比太低（0.7 以下）    → 环境太吵
//   28690 音频出现截幅              → 录音爆了（设备/距离问题）
const NO_SPEECH_EXCEPT = 28673;
const NOISY_EXCEPTS = new Set([28680, 28709, 28690]);

// 分类结果，具体的处置（算不算失败）交给 scoring-policy
export function classifyResult(parsed) {
  if (parsed.exceptInfo === NO_SPEECH_EXCEPT) return 'no_speech';
  if (NOISY_EXCEPTS.has(parsed.exceptInfo)) return 'noisy';
  if (parsed.rejected) return 'nonsense'; // 乱读：官方说此时分数不可信，按失败处理
  if (parsed.total == null) return 'no_speech';
  return 'ok';
}

/* ---------- 主流程 ---------- */

// 英文题型的「试题」有固定写法：首行是标记，之后每行一个单词。
// 见《语音评测试题格式及结果说明》：read_word → 首行 [word]；read_sentence → 首行 [content]。
// 直接发裸单词会被判为「试题格式错误」并报 48195，所以这里必须拼上标记。
export function buildExamText(word, category = 'read_word') {
  const marker = category === 'read_sentence' ? '[content]' : '[word]';
  return `﻿${marker}\n${word}`; // 官方要求带 BOM 的 UTF-8
}

function businessFor(cmd, word, aus) {
  const business = {
    sub: 'ise',
    ent: 'en_vip',           // 英文评测
    category: 'read_word',   // 单词模式：孩子读一个单词
    cmd,
    text: buildExamText(word),
    tte: 'utf-8',
    ttp_skip: true,          // 跳过文本上传阶段
    aue: 'raw',              // 裸 PCM
    auf: 'audio/L16;rate=16000',
    rst: 'entirety',
    ise_unite: '0',
    plev: '0',
    group: process.env.XUNFEI_GROUP || 'pupil',        // 小学生
    check_type: process.env.XUNFEI_CHECK_TYPE || 'easy', // 评分宽松一些
  };
  if (aus !== undefined) business.aus = aus;
  return business;
}

function evaluateOnce({ url, appId, pcm, word }) {
  const debug = process.env.XUNFEI_DEBUG === '1';
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {}
      resolve(value);
    };

    const timer = setTimeout(() => finish({ error: '讯飞评测超时，请再试一次' }), OVERALL_TIMEOUT_MS);
    let socket;
    try {
      socket = new WebSocket(url);
    } catch (err) {
      clearTimeout(timer);
      return resolve({ error: `连不上讯飞：${err.message}` });
    }

    socket.addEventListener('error', () => finish({ error: '连不上讯飞，请检查网络' }));
    socket.addEventListener('close', () => finish({ error: '讯飞连接被关闭' }));

    socket.addEventListener('open', async () => {
      // 第 1 帧：上传评测参数（不带音频）
      if (debug) console.log('[讯飞] 连接已建立，发送 ssb');
      socket.send(
        JSON.stringify({
          common: { app_id: appId },
          business: businessFor('ssb', word),
          data: { status: 0, data: '' },
        })
      );
      // 给服务端一点时间把参数准备好，再开始推音频（立刻推会被拒：iSEInputAppend error）
      await new Promise((r) => setTimeout(r, 250));
      // 之后逐帧送音频，按官方建议 40ms 一帧
      for (const frame of buildAudioFrames(pcm)) {
        if (settled) return;
        socket.send(
          JSON.stringify({
            common: { app_id: appId },
            business: businessFor('auw', word, frame.aus),
            data: { status: frame.status, data: frame.data.toString('base64') },
          })
        );
        await new Promise((r) => setTimeout(r, FRAME_INTERVAL_MS));
      }
    });

    socket.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
      } catch {
        return;
      }
      if (debug) {
        const brief = { ...msg, data: msg.data ? { ...msg.data, data: msg.data.data ? `<${String(msg.data.data).length} 字节>` : '' } : undefined };
        console.log('[讯飞] 收到：', JSON.stringify(brief).slice(0, 300));
      }
      if (msg.code !== 0) {
        const hint = msg.code === 10313 ? 'APPID 和密钥不匹配，请检查 .env' : msg.message || '讯飞返回错误';
        return finish({ error: `讯飞评测失败（${msg.code}）：${hint}` });
      }
      if (msg.data?.status !== 2 || !msg.data?.data) return; // 还没结束
      let xml;
      try {
        xml = Buffer.from(msg.data.data, 'base64').toString('utf8');
      } catch {
        return finish({ error: '讯飞返回的结果看不懂' });
      }
      if (debug) console.log('[讯飞] 最终结果 XML：', xml.slice(0, 800));
      const parsed = parseResultXml(xml);
      const kind = classifyResult(parsed);
      if (kind === 'no_speech') {
        return finish({ error: 'no_speech', detail: { ...parsed } });
      }
      if (kind === 'nonsense') {
        // 孩子读的不是这个词：官方说这时分数不可信，按一次失败的低分处理
        return finish({ score: 0, detail: { ...parsed, rawScore: parsed.total, nonsense: true } });
      }
      finish({
        score: toHundredScale(parsed.total),
        detail: { ...parsed, rawScore: parsed.total, noisy: kind === 'noisy' },
      });
    });
  });
}

export async function score(wavBuffer, targetWord) {
  const appId = process.env.XUNFEI_APP_ID;
  const apiKey = process.env.XUNFEI_API_KEY;
  const apiSecret = process.env.XUNFEI_API_SECRET;
  if (!appId || !apiKey || !apiSecret) {
    return { score: null, detail: null, error: '还没在 .env 里填写讯飞的 APPID / APIKey / APISecret' };
  }
  const word = String(targetWord ?? '').trim();
  if (!word) return { score: null, detail: null, error: '没有要评测的单词' };

  const format = readWavFormat(wavBuffer);
  if (format && (format.sampleRate !== 16000 || format.bitsPerSample !== 16 || format.channels !== 1)) {
    console.warn(
      `[评测] 音频格式不是 16kHz/16bit/单声道（当前 ${format.sampleRate}Hz/${format.bitsPerSample}bit/${format.channels}声道），讯飞可能拒绝`
    );
  }
  const pcm = extractPcm(wavBuffer);
  if (pcm.length < 1600) return { score: null, detail: null, error: 'no_speech' };

  // 文档正文与历史示例的 authorization 写法略有差异，先按文档、失败再换一种
  for (const spaced of [false, true]) {
    const url = buildAuthUrl({ apiKey, apiSecret, spaced });
    const result = await evaluateOnce({ url, appId, pcm, word });
    const authFailed = result.error && /(11200|401|unauthorized|鉴权)/i.test(result.error);
    if (!authFailed) return result;
  }
  return { score: null, detail: null, error: '讯飞鉴权没通过，请检查 .env 里的 APPID / APIKey / APISecret 是否对得上' };
}
````


---

## 📄 server/scorers/mock.js

````js
// mock 评测器：开发/演示用，不看真实音频。
// - 前端在 ?dev=1 时会传 mockScore（模拟得分滑块），服务器照它打分；
// - 没传时给一个稳定的“读得不错”分数，方便走通流程。
// 正式使用请在 .env 里配置 SCORER=tencent 或 xunfei。

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function stableScore(targetWord) {
  let h = 0;
  for (const ch of String(targetWord || 'word')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 74 + (h % 18); // 74~91：mock 默认让流程能通过
}

export async function score(wavBuffer, targetWord, options = {}) {
  const provided = Number(options.mockScore);
  const value = Number.isFinite(provided)
    ? clamp(Math.round(provided), 0, 100)
    : stableScore(targetWord);
  return { score: value, detail: { mock: true }, error: null };
}
````


---

## 📄 server/scorers/index.js

````js
// 按 .env 里的 SCORER 选择评测实现（需求 5.1）。

export function getScorer() {
  const name = (process.env.SCORER || 'mock').toLowerCase();
  const mod = name === 'tencent' ? 'tencent.js' : name === 'xunfei' ? 'xunfei.js' : 'mock.js';
  return import(`./${mod}`).then((m) => ({ name, score: m.score }));
}

export function scorerIsConfigured(name) {
  if (name === 'tencent') {
    return Boolean(process.env.TENCENT_SECRET_ID && process.env.TENCENT_SECRET_KEY);
  }
  if (name === 'xunfei') {
    return Boolean(process.env.XUNFEI_APP_ID && process.env.XUNFEI_API_KEY && process.env.XUNFEI_API_SECRET);
  }
  return true; // mock 永远可用
}
````


---

## 📄 server/routes/parent.js

````js
// 家长模式（需求 阶段4）：PIN、档案管理、参数设置、记录、每周汇总、导出、家庭花园。

import { Router } from 'express';
import crypto from 'node:crypto';
import { PRESETS, AVATARS } from '../presets.js';
import { mergeSettings } from '../presets.js';
import { getProfileBundle } from '../settings.js';
import { todayLocal, effectiveIntervals, getVocabWord } from '../vocab.js';

const router = Router();

/* ---------- 访问令牌：服务重启后失效；页面空闲 30 分钟也要重新输密码 ---------- */

const SESSION_IDLE_MS = 30 * 60 * 1000;
const parentSessions = new Map(); // token → 最近一次使用时间

function issueToken() {
  const token = crypto.randomBytes(24).toString('hex');
  parentSessions.set(token, Date.now());
  return token;
}

function requireParent(req, res, next) {
  const token = String(req.get('X-Parent-Token') ?? '');
  const lastUsed = parentSessions.get(token);
  if (!lastUsed) {
    return res.status(401).json({ error: '请先输入家长密码' });
  }
  if (Date.now() - lastUsed > SESSION_IDLE_MS) {
    parentSessions.delete(token);
    return res.status(401).json({ error: '太久没操作，请重新输入家长密码' });
  }
  parentSessions.set(token, Date.now());
  next();
}

/* ---------- PIN 防暴力破解：失败次数入库，锁定时间逐步翻倍 ---------- */

const PIN_MAX_FAILS = 5;
const PIN_BASE_LOCK_MS = 30 * 1000;

function lockRemainingMs() {
  const until = Number(getMeta('pin_locked_until') ?? 0);
  return Math.max(0, until - Date.now());
}

function notePinFailure() {
  const fails = Number(getMeta('pin_fails') ?? 0) + 1;
  setMeta('pin_fails', String(fails));
  if (fails >= PIN_MAX_FAILS) {
    const rounds = Math.floor(fails / PIN_MAX_FAILS) - 1;
    const lockMs = PIN_BASE_LOCK_MS * 2 ** Math.max(0, rounds);
    setMeta('pin_locked_until', String(Date.now() + lockMs));
  }
  return fails;
}

function clearPinFailures() {
  setMeta('pin_fails', '0');
  setMeta('pin_locked_until', '0');
}

// 首次设置密码只允许在电脑本机操作，防止孩子抢先设一个只有他知道的密码
function isLocalRequest(req) {
  const ip = req.ip || req.socket?.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function getMeta(key) {
  return router.userDb.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
}

function setMeta(key, value) {
  router.userDb
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 32).toString('hex');
}

router.get('/parent/has-pin', (req, res) => {
  res.json({ hasPin: Boolean(getMeta('parent_pin_hash')) });
});

router.post('/parent/pin', (req, res) => {
  const pin = String(req.body?.pin ?? '');
  if (!/^\d{4,6}$/.test(pin)) {
    return res.status(400).json({ error: '密码需要是 4 到 6 位数字' });
  }
  if (getMeta('parent_pin_hash')) {
    return res.status(403).json({ error: '密码已经设置过了，请直接输入' });
  }
  if (!isLocalRequest(req)) {
    return res.status(403).json({
      error: '第一次设置家长密码请在运行服务的这台电脑上操作（浏览器打开 http://localhost:3000）',
    });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  setMeta('parent_pin_salt', salt);
  setMeta('parent_pin_hash', hashPin(pin, salt));
  clearPinFailures();
  res.json({ ok: true, token: issueToken() });
});

router.post('/parent/login', (req, res) => {
  const locked = lockRemainingMs();
  if (locked > 0) {
    return res.status(429).json({ error: `试的次数太多啦，请等 ${Math.ceil(locked / 1000)} 秒再试` });
  }
  const pin = String(req.body?.pin ?? '');
  const salt = getMeta('parent_pin_salt');
  const hash = getMeta('parent_pin_hash');
  if (!salt || !hash) return res.status(400).json({ error: '还没有设置密码' });
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(hashPin(pin, salt), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const fails = notePinFailure();
    const waitMs = lockRemainingMs();
    return res.status(waitMs > 0 ? 429 : 403).json({
      error: waitMs > 0
        ? `试的次数太多啦，请等 ${Math.ceil(waitMs / 1000)} 秒再试`
        : `密码不对，再试试（还可以试 ${Math.max(0, PIN_MAX_FAILS - fails)} 次）`,
    });
  }
  clearPinFailures();
  res.json({ ok: true, token: issueToken() });
});

/* ---------- 以下都需要家长令牌（只挂 /parent 路径，避免拦截其他 /api 路由） ---------- */
router.use('/parent', requireParent);

function profileIdParam(req) {
  return Number(req.params.id);
}

// 档案管理：改名 / 换头像 / 换预设
router.post('/parent/profiles/:id', (req, res) => {
  const id = profileIdParam(req);
  const row = router.userDb.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '没有这个档案' });
  const name = req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 20) : row.name;
  const avatar = req.body?.avatar !== undefined ? String(req.body.avatar) : row.avatar;
  const preset = req.body?.preset !== undefined ? String(req.body.preset) : row.preset;
  if (!name) return res.status(400).json({ error: '名字不能是空的' });
  if (!AVATARS.includes(avatar)) return res.status(400).json({ error: '头像不对' });
  if (!PRESETS[preset]) return res.status(400).json({ error: '预设不对' });
  router.userDb
    .prepare('UPDATE profiles SET name = ?, avatar = ?, preset = ? WHERE id = ?')
    .run(name, avatar, preset, id);
  res.json({ ok: true });
});

// 删除档案：连带删除全部数据（前端二次确认）
router.delete('/parent/profiles/:id', (req, res) => {
  const id = profileIdParam(req);
  const db = router.userDb;
  const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '没有这个档案' });
  db.transaction(() => {
    db.prepare('DELETE FROM events WHERE profile_id = ?').run(id);
    db.prepare('DELETE FROM vocab WHERE profile_id = ?').run(id);
    db.prepare('DELETE FROM learn_sessions WHERE profile_id = ?').run(id);
    db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
  })();
  res.json({ ok: true });
});

// 档案参数（需求 2.5 全部参数，保存后立即生效）
router.post('/parent/profiles/:id/settings', (req, res) => {
  const id = profileIdParam(req);
  const row = router.userDb.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '没有这个档案' });
  const patch = req.body && typeof req.body === 'object' ? req.body : {};
  const presetKeys = Object.keys(PRESETS[row.preset] ?? PRESETS.primary).filter((k) => k !== 'label');
  const overrides = JSON.parse(row.settings_json || '{}') || {};
  for (const key of presetKeys) {
    if (key in patch) overrides[key] = patch[key];
  }
  router.userDb.prepare('UPDATE profiles SET settings_json = ? WHERE id = ?').run(JSON.stringify(overrides), id);
  const fresh = router.userDb.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
  res.json({ ok: true, settings: getProfileBundle(router.userDb, fresh) });
});

// 查词记录：按档案 + 可选日期
router.get('/parent/records', (req, res) => {
  const id = Number(req.query.profile);
  const date = String(req.query.date ?? '');
  const db = router.userDb;
  let rows;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    rows = db
      .prepare(
        `SELECT ts, session_id, mode, word, step, type, detail FROM events
         WHERE profile_id = ? AND date(ts, 'localtime') = ? ORDER BY id DESC LIMIT 500`
      )
      .all(id, date);
  } else {
    rows = db
      .prepare(
        `SELECT ts, session_id, mode, word, step, type, detail FROM events
         WHERE profile_id = ? ORDER BY id DESC LIMIT 200`
      )
      .all(id);
  }
  res.json({ records: rows });
});

// 每周汇总（需求 阶段4，含放弃点统计 2.10）
router.get('/parent/summary', (req, res) => {
  const id = Number(req.query.profile);
  const db = router.userDb;
  const since = new Date(Date.now() - 6 * 86400000);
  since.setHours(0, 0, 0, 0);
  const sinceIso = since.toISOString();

  const events = db
    .prepare('SELECT ts, session_id, mode, word, step, type FROM events WHERE profile_id = ? AND ts >= ?')
    .all(id, sinceIso);

  const countType = (type) => events.filter((e) => e.type === type).length;
  const distinct = (list) => new Set(list.filter(Boolean)).size;

  const lookedUp =
    distinct(events.filter((e) => e.type === 'lookup_start' && e.mode === 'en').map((e) => e.word)) +
    distinct(events.filter((e) => e.type === 'typing_ok' && e.mode === 'zh').map((e) => e.word));

  const learnedRows = db
    .prepare(
      `SELECT word, assisted FROM vocab
       WHERE profile_id = ? AND status = 'learned' AND first_learned_at >= ?`
    )
    .all(id, sinceIso);

  // 卡得最久的词：按总尝试次数（输错 + 找不到 + 读不过）
  const attempts = new Map();
  for (const e of events) {
    if (!e.word) continue;
    if (['typing_wrong', 'not_found', 'read_fail'].includes(e.type)) {
      attempts.set(e.word, (attempts.get(e.word) ?? 0) + 1);
    }
  }
  const stuckTop = [...attempts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word, n]) => ({ word, attempts: n }));

  // 复习正确率
  const reviewOk = countType('review_ok');
  const reviewWrong = countType('review_wrong');

  // 放弃点统计：流程没到 meaning_shown 且最后一个事件超过 10 分钟 → 放弃在最后事件的 step
  const nowMs = Date.now();
  const bySession = new Map();
  for (const e of events) {
    if (!e.session_id) continue;
    if (!bySession.has(e.session_id)) bySession.set(e.session_id, []);
    bySession.get(e.session_id).push(e);
  }
  const giveUpByStep = {};
  let giveUpTotal = 0;
  for (const list of bySession.values()) {
    if (list.some((e) => e.type === 'meaning_shown')) continue;
    const last = list.reduce((a, b) => (a.ts > b.ts ? a : b));
    if (nowMs - new Date(last.ts).getTime() < 10 * 60 * 1000) continue; // 还在进行中
    const step = last.step || 'typing';
    giveUpByStep[step] = (giveUpByStep[step] ?? 0) + 1;
    giveUpTotal += 1;
  }
  const cancelByStep = {};
  for (const e of events) {
    if (e.type === 'cancel') {
      const step = e.step || 'typing';
      cancelByStep[step] = (cancelByStep[step] ?? 0) + 1;
    }
  }
  const merged = { ...giveUpByStep };
  for (const [step, n] of Object.entries(cancelByStep)) {
    merged[step] = (merged[step] ?? 0) + n;
  }
  const stepNames = { typing: '输入阶段', candidates: '候选列表', reading: '跟读阶段', meaning: '看释义', review: '复习' };
  const worstStep = Object.entries(merged).sort((a, b) => b[1] - a[1])[0];
  const giveUpConclusion = worstStep
    ? `孩子最容易在「${stepNames[worstStep[0]] ?? worstStep[0]}」放下查询（放弃或返回共 ${worstStep[1]} 次）`
    : '这段时间没有明显的放弃点，节奏刚刚好';

  res.json({
    since: sinceIso,
    lookedUp,
    learned: learnedRows.length,
    assisted: learnedRows.filter((r) => r.assisted).length,
    stuckTop,
    review: { ok: reviewOk, wrong: reviewWrong, accuracy: reviewOk + reviewWrong ? Math.round((reviewOk / (reviewOk + reviewWrong)) * 100) : null },
    giveUp: { byStep: giveUpByStep, cancelByStep, total: giveUpTotal, conclusion: giveUpConclusion },
  });
});

// CSV 导出（UTF-8 带 BOM，Excel 打开中文不乱码）
function csvResponse(res, filename, rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = rows.map((r) => r.map(esc).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + body + '\r\n');
}

router.get('/parent/export/vocab.csv', (req, res) => {
  const id = Number(req.query.profile);
  const rows = [
    ['word', 'entry_mode', 'status', 'first_learned_at', 'assisted', 'typing_errors', 'read_attempts', 'best_score', 'stage', 'next_review_at', 'review_correct', 'review_wrong'],
    ...router.userDb
      .prepare('SELECT * FROM vocab WHERE profile_id = ? ORDER BY id')
      .all(id)
      .map((r) => [r.word, r.entry_mode, r.status, r.first_learned_at, r.assisted, r.typing_errors, r.read_attempts, r.best_score, r.stage, r.next_review_at ?? '', r.review_correct, r.review_wrong]),
  ];
  csvResponse(res, `vocab-${id}.csv`, rows);
});

router.get('/parent/export/events.csv', (req, res) => {
  const id = Number(req.query.profile);
  const rows = [
    ['ts', 'session_id', 'mode', 'word', 'step', 'type', 'detail'],
    ...router.userDb
      .prepare('SELECT ts, session_id, mode, word, step, type, detail FROM events WHERE profile_id = ? ORDER BY id')
      .all(id)
      .map((r) => [r.ts, r.session_id ?? '', r.mode, r.word ?? '', r.step ?? '', r.type, r.detail ?? '']),
  ];
  csvResponse(res, `events-${id}.csv`, rows);
});

// 家庭花园开关（需求 阶段6，默认关）
router.get('/parent/family-garden', (req, res) => {
  res.json({ enabled: getMeta('family_garden') === '1' });
});

router.post('/parent/family-garden', (req, res) => {
  setMeta('family_garden', req.body?.enabled ? '1' : '0');
  res.json({ ok: true, enabled: Boolean(req.body?.enabled) });
});

export function createParentRouter(userDb) {
  router.userDb = userDb;
  return router;
}
````


---

## 📄 server/app.js

````js
// 应用装配：index.js（启动）与测试共用。

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDictDb, openUserDb } from './db.js';
import { createDictRouter } from './routes/dict.js';
import { createProfileRouter, createProfileMiddleware } from './routes/profile.js';
import { createEventsRouter } from './routes/events.js';
import { createSessionRouter } from './routes/session.js';
import { createScoreRouter } from './routes/score.js';
import { createVocabRouter } from './routes/vocab.js';
import { createChildRouter } from './routes/child.js';
import { createParentRouter } from './routes/parent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 启动前的评测配置检查：宁可起不来，也不要让孩子在用"随便念都能过"的模拟打分。
// 返回 null 表示没问题，否则返回一段中文说明。
export function scorerConfigProblem() {
  const name = (process.env.SCORER || 'mock').toLowerCase();
  const dev = (process.env.WORDLOCK_DEV ?? '') === '1';
  if (name === 'mock' && !dev) {
    return (
      '当前用的是"模拟打分"（SCORER=mock），孩子随便念都能通过，不能这样给孩子用。\n' +
      '  ① 正式使用：在 .env 里填好密钥并设 SCORER=xunfei\n' +
      '  ② 只是自己调试：在 .env 里加一行 WORDLOCK_DEV=1（明确声明这是开发模式）'
    );
  }
  if (name === 'xunfei') {
    const missing = ['XUNFEI_APP_ID', 'XUNFEI_API_KEY', 'XUNFEI_API_SECRET'].filter((k) => !process.env[k]);
    if (missing.length) return `SCORER=xunfei，但 .env 里缺：${missing.join('、')}`;
  }
  if (name === 'tencent') {
    const missing = ['TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY'].filter((k) => !process.env[k]);
    if (missing.length) return `SCORER=tencent，但 .env 里缺：${missing.join('、')}`;
  }
  return null;
}

export function createApp({ userDb, dictDb }) {
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const requireProfile = createProfileMiddleware(userDb);
  app.use('/api', createProfileRouter(userDb, requireProfile));
  // 家长接口用自己的 PIN 鉴权，不要求先选档案
  app.use('/api', createParentRouter(userDb));
  // 之后的接口都需要已选择档案
  app.use('/api', requireProfile);
  // 所有正常接口
  app.use('/api', createEventsRouter(userDb));
  app.use('/api', createSessionRouter(userDb, () => dictDb));
  app.use('/api', createScoreRouter(userDb));
  app.use('/api', createVocabRouter(userDb, () => dictDb));
  app.use('/api', createChildRouter(userDb, () => dictDb));
  app.use('/api', createDictRouter({ getDictDb: () => dictDb, userDb }));

  // 没匹配到的接口：明确返回 JSON 404（而不是 HTML 错误页，也避免请求挂住）
  app.use('/api', (req, res) => res.status(404).json({ error: '没有这个接口' }));

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: '服务器开小差了，请再试一次' });
  });
  return app;
}

export function boot() {
  const userDb = openUserDb();
  const dictDb = openDictDb();
  if (!dictDb) {
    console.warn('提示：还没有找到 data/dict.db，查词功能暂不可用。请先下载词典并运行 npm run build-dict（见 README）。');
  }
  const scorerName = (process.env.SCORER || 'mock').toLowerCase();
  if (scorerName === 'mock') {
    console.log('评测：模拟打分（正式用请在 .env 里设置 SCORER=xunfei 并填好密钥）');
  } else {
    const missing =
      scorerName === 'xunfei'
        ? ['XUNFEI_APP_ID', 'XUNFEI_API_KEY', 'XUNFEI_API_SECRET'].filter((k) => !process.env[k])
        : ['TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY'].filter((k) => !process.env[k]);
    console.log(
      missing.length
        ? `评测：${scorerName}（还没配置好，缺 ${missing.join('、')}）`
        : `评测：${scorerName}（已配置）`
    );
  }
  return { userDb, dictDb, app: createApp({ userDb, dictDb }) };
}
````


---

## 📄 server/db.js

````js
// 打开两个 SQLite 库：dict.db（词典，只读）和 user.db（用户数据）。

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.WORDLOCK_DATA_DIR || path.join(__dirname, '..', 'data');

export function dictDbPath() {
  return path.join(DATA_DIR, 'dict.db');
}

export function openDictDb() {
  const file = dictDbPath();
  if (!fs.existsSync(file)) return null;
  return new Database(file, { readonly: true, fileMustExist: true });
}

export function openUserDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(path.join(DATA_DIR, 'user.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      avatar        TEXT NOT NULL,
      preset        TEXT NOT NULL,
      settings_json TEXT NOT NULL DEFAULT '{}',
      created_at    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL,
      ts         TEXT NOT NULL,
      session_id TEXT,
      mode       TEXT NOT NULL DEFAULT 'en',
      word       TEXT,
      step       TEXT,
      type       TEXT NOT NULL,
      detail     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_profile_ts ON events(profile_id, ts);
    CREATE TABLE IF NOT EXISTS learn_sessions (
      profile_id  INTEGER NOT NULL,
      session_id  TEXT NOT NULL,
      word        TEXT,
      mode        TEXT NOT NULL DEFAULT 'en',
      typing_count INTEGER NOT NULL DEFAULT 0,
      typing_done INTEGER NOT NULL DEFAULT 0,
      read_pass   INTEGER NOT NULL DEFAULT 0,
      read_fail   INTEGER NOT NULL DEFAULT 0,
      read_attempts INTEGER NOT NULL DEFAULT 0,
      best_score  INTEGER NOT NULL DEFAULT 0,
      assisted    INTEGER NOT NULL DEFAULT 0,
      quick_peek  INTEGER NOT NULL DEFAULT 0,
      meaning_shown INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      PRIMARY KEY (profile_id, session_id)
    );
    CREATE TABLE IF NOT EXISTS vocab (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id      INTEGER NOT NULL,
      word            TEXT NOT NULL,
      entry_mode      TEXT NOT NULL DEFAULT 'en',
      status          TEXT NOT NULL DEFAULT 'learned',
      first_learned_at TEXT NOT NULL,
      assisted        INTEGER NOT NULL DEFAULT 0,
      typing_errors   INTEGER NOT NULL DEFAULT 0,
      read_attempts   INTEGER NOT NULL DEFAULT 0,
      best_score      INTEGER NOT NULL DEFAULT 0,
      stage           INTEGER NOT NULL DEFAULT 0,
      next_review_at  TEXT,
      review_correct  INTEGER NOT NULL DEFAULT 0,
      review_wrong    INTEGER NOT NULL DEFAULT 0,
      UNIQUE(profile_id, word)
    );
    CREATE INDEX IF NOT EXISTS idx_vocab_review ON vocab(profile_id, status, next_review_at);
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    -- 首次校准的分数样本：只由服务端写，客户端无法伪造（防止故意压低分数线）
    CREATE TABLE IF NOT EXISTS calibration_samples (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL,
      ts         TEXT NOT NULL,
      score      INTEGER NOT NULL,
      clean      INTEGER NOT NULL DEFAULT 1
    );
  `);
  // 并发加固：多设备（电脑 + iPad）同时用时不至于因锁竞争直接抛错
  db.pragma('busy_timeout = 5000');
  // 老库升级：老版本的 learn_sessions 没有这两列
  addColumnIfMissing(db, 'learn_sessions', 'typing_count', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'learn_sessions', 'best_score', 'INTEGER NOT NULL DEFAULT 0');
  return db;
}

function addColumnIfMissing(db, table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
````


---

## 📄 tests/integration.test.js

````js
// 集成测试：直接打 HTTP API，验证正常流程与「门槛不可绕过」。
//
// 安全测试部分（本文件后半）是这次修复的重点：每一条都对应一个曾经真实存在的绕过路径。
// 迷你测试词典只有 29 个词，用例只能用里面的词（见 tests/fixtures/mini-ecdict.csv）。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { todayLocal } from '../server/vocab.js';

// 必须在动态 import 之前设置（db.js 在导入时读取）
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wordlock-it-'));
process.env.WORDLOCK_DATA_DIR = dataDir;
process.env.SCORER = 'mock';
process.env.WORDLOCK_DEV = '1'; // 允许测试用 mockScore 控制分数（正式使用不允许）
process.env.NODE_ENV = 'test';

const { openUserDb } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { buildDict } = await import('../scripts/build-dict.js');
const { makeCaller } = await import('./helpers/dispatch.js');
const { default: Database } = await import('better-sqlite3');

let userDb;
let dictDb;
let callRaw;
let profileA; // 小学预设：输入 1 次
let profileB; // 初中预设：输入 2 次

const SID = () => crypto.randomUUID();

before(async () => {
  const raw = path.join(dataDir, 'raw');
  fs.mkdirSync(raw);
  fs.copyFileSync(new URL('./fixtures/mini-ecdict.csv', import.meta.url), path.join(raw, 'mini.csv'));
  await buildDict({ rawDir: raw, outFile: path.join(dataDir, 'dict.db') });

  userDb = openUserDb();
  dictDb = new Database(path.join(dataDir, 'dict.db'), { readonly: true });
  callRaw = makeCaller(createApp({ userDb, dictDb }));

  const a = await call('/api/profiles', { method: 'POST', body: { name: '测试A', avatar: '🐱', preset: 'primary' } });
  const b = await call('/api/profiles', { method: 'POST', body: { name: '测试B', avatar: '🐶', preset: 'middle' } });
  profileA = a.data.id;
  profileB = b.data.id;
});

after(() => {
  userDb?.close();
  dictDb?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function call(pathname, { method = 'GET', body, profile, session, parent } = {}) {
  const headers = {};
  if (profile) headers['X-Profile-Id'] = String(profile);
  if (session) headers['X-Session-Id'] = session;
  if (parent) headers['X-Parent-Token'] = parent;
  return callRaw(pathname, { method, body, headers });
}

/* ---------- 正常流程要用的服务端步骤（和前端调的是同一套接口） ---------- */

async function bindAndType(profile, sessionId, word, mode = 'en') {
  const bound = await call('/api/session', { method: 'POST', profile, body: { sessionId, word, mode } });
  assert.equal(bound.status, 200, `绑定会话失败：${JSON.stringify(bound.data)}`);
  let { completed, requiredCount, done } = bound.data;
  while (!done) {
    const r = await call('/api/typing', { method: 'POST', profile, body: { sessionId, typed: word } });
    assert.equal(r.data.ok, true, `输入未通过：${JSON.stringify(r.data)}`);
    completed = r.data.completed;
    requiredCount = r.data.requiredCount;
    done = r.data.done;
    if (!done && completed >= requiredCount) break;
  }
  return { completed, requiredCount };
}

async function readOnce(profile, sessionId, word, mockScore) {
  const r = await call('/api/score', { method: 'POST', profile, body: { word, sessionId, mockScore } });
  assert.equal(r.status, 200, `评分失败：${JSON.stringify(r.data)}`);
  return r.data;
}

async function readTimes(profile, sessionId, word, times, mockScore = 92) {
  let last;
  for (let i = 0; i < times; i++) last = await readOnce(profile, sessionId, word, mockScore);
  return last;
}

async function newProfile(name, preset = 'primary') {
  const r = await call('/api/profiles', { method: 'POST', body: { name, avatar: '🐸', preset } });
  return r.data.id;
}

async function dropProfile(id) {
  await call(`/api/parent/profiles/${id}`, { method: 'DELETE', parent: await getParent() });
}

/* ============ 正常流程（孩子实际会走到） ============ */

test('完整流程：输入 → 读音放行 → 跟读通过 → 释义放行 → 进生词本', async () => {
  const sid = SID();
  assert.equal((await call('/api/pronunciation/run', { profile: profileA, session: sid })).status, 403);
  assert.equal((await call('/api/meaning/run', { profile: profileA, session: sid })).status, 403);

  assert.equal((await call('/api/check-word', { method: 'POST', profile: profileA, body: { word: 'run' } })).data.exists, true);
  await bindAndType(profileA, sid, 'run');

  const pron = await call('/api/pronunciation/run', { profile: profileA, session: sid });
  assert.equal(pron.status, 200);
  assert.ok(pron.data.phonetic.length > 0);
  assert.equal((await call('/api/meaning/run', { profile: profileA, session: sid })).status, 403); // 跟读前仍锁着

  const score = await readOnce(profileA, sid, 'run', 92);
  assert.equal(score.passed, true);
  assert.equal(score.passes, 1);

  const meaning = await call('/api/meaning/run', { profile: profileA, session: sid });
  assert.equal(meaning.status, 200);
  assert.ok(meaning.data.lines.length >= 1);
  assert.ok((await call('/api/vocab', { profile: profileA })).data.words.some((w) => w.word === 'run' && w.status === 'learned'));
  assert.ok(!(await call('/api/vocab', { profile: profileB })).data.words.some((w) => w.word === 'run'));
});

test('输入次数按门槛档位来（小学 1 次、初中 2 次）', async () => {
  const sid1 = SID();
  const r1 = await call('/api/session', { method: 'POST', profile: profileA, body: { sessionId: sid1, word: 'book', mode: 'en' } });
  assert.equal(r1.data.requiredCount, 1);
  assert.equal(r1.data.done, true); // N=1：第 1 次输入即完成

  const sid2 = SID();
  const r2 = await call('/api/session', { method: 'POST', profile: profileB, body: { sessionId: sid2, word: 'book', mode: 'en' } });
  assert.equal(r2.data.requiredCount, 2);
  assert.equal(r2.data.done, false);
  const r3 = await call('/api/typing', { method: 'POST', profile: profileB, body: { sessionId: sid2, typed: 'book' } });
  assert.equal(r3.data.done, true);
});

test('输入错误由服务端指出位置，且不计数', async () => {
  const sid = SID();
  await call('/api/session', { method: 'POST', profile: profileA, body: { sessionId: sid, word: 'happy', mode: 'zh' } });
  const wrongLength = await call('/api/typing', { method: 'POST', profile: profileA, body: { sessionId: sid, typed: 'happpy' } });
  assert.equal(wrongLength.data.ok, false);
  assert.equal(wrongLength.data.hint, 'length');
  const wrongPos = await call('/api/typing', { method: 'POST', profile: profileA, body: { sessionId: sid, typed: 'hoppy' } });
  assert.equal(wrongPos.data.hint, 'position');
  assert.equal(wrongPos.data.position, 2);
  assert.equal(wrongPos.data.completed, undefined); // 没计数
});

test('中文入口从 0/N 开始', async () => {
  const sid = SID();
  const zh = await call('/api/search-zh', { method: 'POST', profile: profileA, body: { query: '跑' } });
  assert.equal(zh.data.results[0].word, 'run');
  const bound = await call('/api/session', { method: 'POST', profile: profileA, body: { sessionId: sid, word: 'run', mode: 'zh' } });
  assert.equal(bound.data.completed, 0);
  assert.equal(bound.data.done, false);
});

test('没过关就请求释义返回 403（阶段3 验收）', async () => {
  const sid = SID();
  await call('/api/check-word', { method: 'POST', profile: profileA, body: { word: 'dog' } });
  await bindAndType(profileA, sid, 'dog');
  assert.equal((await readOnce(profileA, sid, 'dog', 10)).passed, false);
  assert.equal((await call('/api/meaning/dog', { profile: profileA, session: sid })).status, 403);
  assert.equal(userDb.prepare('SELECT * FROM vocab WHERE profile_id = ? AND word = ?').get(profileA, 'dog'), undefined);
});

test('已学会的词免门槛：check-word 返回 learned，释义直接可看（2.8）', async () => {
  assert.equal((await call('/api/check-word', { method: 'POST', profile: profileA, body: { word: 'run' } })).data.learned, true);
  const m = await call('/api/meaning/run', { profile: profileA, session: SID() });
  assert.equal(m.status, 200);
  assert.ok(m.data.learnedDaysAgo != null);
  assert.equal((await call('/api/check-word', { method: 'POST', profile: profileB, body: { word: 'run' } })).data.learned, false);
});

test('中文候选标记已学会（2.8）', async () => {
  const zh = await call('/api/search-zh', { method: 'POST', profile: profileA, body: { query: '跑' } });
  assert.equal(zh.data.results.find((r) => r.word === 'run').learned, true);
});

test('读够 M 次才能看释义；求助通关也可以（阶段2/3）', async () => {
  const sid = SID();
  await bindAndType(profileB, sid, 'book');
  await readOnce(profileB, sid, 'book', 92);
  assert.equal((await call('/api/meaning/book', { profile: profileB, session: sid })).status, 403); // 初中要 2 次

  for (let i = 0; i < 4; i++) await readOnce(profileB, sid, 'book', 5);
  const help = await call('/api/help', { method: 'POST', profile: profileB, body: { word: 'book', sessionId: sid } });
  assert.equal(help.status, 200);
  assert.equal((await call('/api/meaning/book', { profile: profileB, session: sid })).status, 200);
  const row = userDb.prepare('SELECT * FROM vocab WHERE profile_id = ? AND word = ?').get(profileB, 'book');
  assert.equal(row.assisted, 1);
  assert.ok(row.next_review_at);
});

test('首次校准：分数由服务端记录并计算，夹在 50–75（阶段2）', async () => {
  const sid = SID();
  await call('/api/calibration/start', { method: 'POST', profile: profileB });
  for (const score of [70, 80, 90]) {
    const r = await call('/api/score', { method: 'POST', profile: profileB, body: { word: 'apple', sessionId: sid, mockScore: score, calibration: true } });
    assert.equal(r.status, 200);
    assert.equal(r.data.calibration, true);
  }
  const done = await call('/api/calibration/finish', { method: 'POST', profile: profileB });
  assert.equal(done.data.passScore, 65); // 平均 80 − 15
  assert.equal(done.data.usedSamples, 3);
  assert.equal((await call('/api/settings', { profile: profileB })).data.settings.calibrated, true);
});

test('复习：答错退回并明天再考；答对进入下一间隔（阶段3）', async () => {
  userDb.prepare("UPDATE vocab SET next_review_at = ? WHERE profile_id = ? AND word = 'run'").run(todayLocal(0), profileA);
  assert.ok((await call('/api/review/today', { profile: profileA })).data.words.some((w) => w.word === 'run'));

  let ans = await call('/api/review/answer', { method: 'POST', profile: profileA, body: { word: 'run', typed: 'rnu' } });
  assert.equal(ans.data.correct, false);
  assert.equal(ans.data.nextReviewAt, todayLocal(1));
  ans = await call('/api/review/answer', { method: 'POST', profile: profileA, body: { word: 'run', typed: 'run' } });
  assert.equal(ans.data.correct, true);
  assert.equal(ans.data.nextReviewAt, todayLocal(2));
  userDb.prepare("UPDATE vocab SET next_review_at = ?, stage = 0 WHERE profile_id = ? AND word = 'run'").run(todayLocal(0), profileA);
});

test('复习每天最多 reviewPerDay 个（阶段3）', async () => {
  const pid = await newProfile('复习上限测试');
  const ins = userDb.prepare(
    `INSERT INTO vocab (profile_id, word, status, first_learned_at, next_review_at) VALUES (?, ?, 'learned', ?, ?)`
  );
  const now = new Date().toISOString();
  for (const w of ['paper', 'pen', 'pencil', 'rain', 'sun']) ins.run(pid, w, now, todayLocal(0));
  const today = await call('/api/review/today', { profile: pid });
  assert.equal(today.data.words.length, 3);
  await dropProfile(pid);
});

test('快速查看：默认关闭；打开后限额生效；巩固后转正（阶段5）', async () => {
  const pid = await newProfile('快速查看测试');
  const sid0 = SID();
  await bindAndType(pid, sid0, 'water');
  assert.equal((await call('/api/quick-peek', { method: 'POST', profile: pid, body: { word: 'water', sessionId: sid0 } })).status, 403); // 默认关闭

  await call(`/api/parent/profiles/${pid}/settings`, { method: 'POST', parent: await getParent(), body: { quickPeekPerDay: 2 } });

  const sid1 = SID();
  await bindAndType(pid, sid1, 'water');
  const peek1 = await call('/api/quick-peek', { method: 'POST', profile: pid, body: { word: 'water', sessionId: sid1 } });
  assert.equal(peek1.status, 200);
  assert.equal(peek1.data.remaining, 1);
  assert.equal(userDb.prepare('SELECT status FROM vocab WHERE profile_id = ? AND word = ?').get(pid, 'water')?.status, 'pending');

  const sid2 = SID();
  await bindAndType(pid, sid2, 'moon');
  assert.equal((await call('/api/quick-peek', { method: 'POST', profile: pid, body: { word: 'moon', sessionId: sid2 } })).status, 200);
  const sid3 = SID();
  await bindAndType(pid, sid3, 'star');
  assert.equal((await call('/api/quick-peek', { method: 'POST', profile: pid, body: { word: 'star', sessionId: sid3 } })).status, 403); // 额度用完

  await readTimes(pid, sid1, 'water', 1, 88); // 完整过一遍 → 转 learned
  assert.equal(userDb.prepare('SELECT status FROM vocab WHERE profile_id = ? AND word = ?').get(pid, 'water')?.status, 'learned');
  await dropProfile(pid);
});

test('每日查词上限：达到后不能再开始新的词（阶段4）', async () => {
  const pid = await newProfile('限额测试');
  await call(`/api/parent/profiles/${pid}/settings`, { method: 'POST', parent: await getParent(), body: { dailyLookupLimit: 1 } });
  assert.equal((await call('/api/check-word', { method: 'POST', profile: pid, body: { word: 'sun' } })).data.allowed, true);
  await bindAndType(pid, SID(), 'sun');
  assert.equal((await call('/api/check-word', { method: 'POST', profile: pid, body: { word: 'moon' } })).data.allowed, false);
  assert.equal((await call('/api/review/today', { profile: pid })).status, 200); // 复习不受影响
  await dropProfile(pid);
});

let cachedParent = null;
async function getParent() {
  if (cachedParent) return cachedParent;
  const has = await call('/api/parent/has-pin', { noProfile: true });
  cachedParent = has.data.hasPin
    ? (await call('/api/parent/login', { method: 'POST', noProfile: true, body: { pin: '135790' } })).data.token
    : (await call('/api/parent/pin', { method: 'POST', noProfile: true, body: { pin: '135790' } })).data.token;
  return cachedParent;
}

test('家长模式：PIN 校验、改名、删除档案（阶段4）', async () => {
  assert.equal((await call('/api/parent/records?profile=1')).status, 401);
  assert.equal((await call('/api/parent/login', { method: 'POST', noProfile: true, body: { pin: '000000' } })).status, 403);
  const token = await getParent();
  assert.ok(token);

  assert.equal((await call(`/api/parent/profiles/${profileB}`, { method: 'POST', parent: token, body: { name: '改个名' } })).status, 200);
  assert.ok((await call('/api/profiles')).data.profiles.some((p) => p.id === profileB && p.name === '改个名'));

  assert.equal((await call(`/api/parent/profiles/${profileB}`, { method: 'DELETE', parent: token })).status, 200);
  assert.equal(userDb.prepare('SELECT COUNT(*) n FROM events WHERE profile_id = ?').get(profileB).n, 0);
  assert.equal(userDb.prepare('SELECT COUNT(*) n FROM vocab WHERE profile_id = ?').get(profileB).n, 0);
  profileB = -1;
});

test('家长 PIN：连续输错会被临时锁定', async () => {
  for (let i = 0; i < 5; i++) await call('/api/parent/login', { method: 'POST', noProfile: true, body: { pin: '000001' } });
  const locked = await call('/api/parent/login', { method: 'POST', noProfile: true, body: { pin: '135790' } });
  assert.equal(locked.status, 429); // 正确密码也要等锁定结束
  // 清掉锁定，后面的测试还要用令牌
  userDb.prepare("UPDATE meta SET value = '0' WHERE key IN ('pin_fails','pin_locked_until')").run();
  assert.equal((await call('/api/parent/login', { method: 'POST', noProfile: true, body: { pin: '135790' } })).status, 200);
});

test('家长汇总：放弃点统计与 events 一致（阶段4 / 2.10）', async () => {
  const old = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  userDb.prepare(
    `INSERT INTO events (profile_id, ts, session_id, mode, word, step, type)
     VALUES (?, ?, 'abandoned-session', 'en', 'quixotic', 'reading', 'read_fail')`
  ).run(profileA, old);
  const summary = await call(`/api/parent/summary?profile=${profileA}`, { parent: await getParent() });
  assert.equal(summary.status, 200);
  assert.ok(summary.data.lookedUp >= 1);
  assert.ok(summary.data.giveUp.total >= 1);
  assert.ok(summary.data.giveUp.conclusion.length > 0);
});

test('记录接口可按日期筛选（阶段4）', async () => {
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const res = await call(`/api/parent/records?profile=${profileA}&date=${day}`, { parent: await getParent() });
  assert.equal(res.status, 200);
  assert.ok(res.data.records.length >= 1);
});

test('生态接口：stats / garden / theme', async () => {
  assert.ok((await call('/api/stats', { profile: profileA })).data.totalDays >= 1);
  assert.ok((await call('/api/garden', { profile: profileA })).data.total >= 1);
  assert.equal((await call('/api/garden', { profile: profileA })).data.familyEnabled, false);
  assert.equal((await call('/api/theme', { method: 'POST', profile: profileA, body: { theme: 'garden' } })).data.theme, 'garden');
  assert.equal((await call('/api/settings', { profile: profileA })).data.settings.theme, 'garden');
});

/* ============ 安全回归：这些路径以前真的能绕过门槛 ============ */

test('安全 1：没完成输入就不能跟读（直接调 /api/score 也会被拒）', async () => {
  const r = await call('/api/score', { method: 'POST', profile: profileA, body: { word: 'computer', sessionId: SID(), mockScore: 100 } });
  assert.equal(r.status, 403);
});

test('安全 2：会话绑定了 apple，就不能拿它给 banana 评分', async () => {
  const sid = SID();
  await bindAndType(profileA, sid, 'apple');
  assert.equal((await call('/api/score', { method: 'POST', profile: profileA, body: { word: 'banana', sessionId: sid, mockScore: 100 } })).status, 403);
});

test('安全 3【已实测的绕过】：给一个词通过后，同一会话不能拿别的词的释义', async () => {
  const sid = SID();
  await bindAndType(profileA, sid, 'teacher');
  await readOnce(profileA, sid, 'teacher', 95);
  assert.equal((await call('/api/meaning/teacher', { profile: profileA, session: sid })).status, 200);
  // 以前这里会返回 200，等于一次通过就能看遍整本字典
  assert.equal((await call('/api/meaning/school', { profile: profileA, session: sid })).status, 403);
  assert.equal((await call('/api/meaning/quixotic', { profile: profileA, session: sid })).status, 403);
});

test('安全 4【已实测的绕过】：伪造 help_used 事件不再能通关', async () => {
  const sid = SID();
  await bindAndType(profileA, sid, 'student');
  const forged = await call('/api/events', {
    method: 'POST', profile: profileA,
    body: { sessionId: sid, type: 'help_used', word: 'student', mode: 'en', step: 'reading' },
  });
  assert.equal(forged.status, 200); // 接口正常返回（只记录）
  assert.equal(userDb.prepare('SELECT assisted FROM learn_sessions WHERE profile_id = ? AND session_id = ?').get(profileA, sid).assisted, 0);
  assert.equal((await call('/api/meaning/student', { profile: profileA, session: sid })).status, 403);
  assert.equal(userDb.prepare('SELECT * FROM vocab WHERE profile_id = ? AND word = ?').get(profileA, 'student'), undefined);
});

test('安全 5：伪造 quick_peek / typing_done / read_pass 事件同样无效', async () => {
  const sid = SID();
  for (const type of ['quick_peek', 'typing_done', 'read_pass', 'meaning_shown']) {
    await call('/api/events', { method: 'POST', profile: profileA, body: { sessionId: sid, type, word: 'sister', mode: 'en' } });
  }
  assert.equal(userDb.prepare('SELECT * FROM learn_sessions WHERE profile_id = ? AND session_id = ?').get(profileA, sid), undefined);
  assert.equal((await call('/api/meaning/sister', { profile: profileA, session: sid })).status, 403);
});

test('安全 6：没读够次数不能求助，读够了才能', async () => {
  const sid = SID();
  await bindAndType(profileA, sid, 'school');
  assert.equal((await call('/api/help', { method: 'POST', profile: profileA, body: { word: 'school', sessionId: sid } })).status, 403);
  await readOnce(profileA, sid, 'school', 5);
  assert.equal((await call('/api/help', { method: 'POST', profile: profileA, body: { word: 'school', sessionId: sid } })).status, 403);
  for (let i = 0; i < 3; i++) await readOnce(profileA, sid, 'school', 5);
  assert.equal((await call('/api/help', { method: 'POST', profile: profileA, body: { word: 'school', sessionId: sid } })).status, 200);
});

test('安全 7：会话绑定后不能改词（换词必须新会话）', async () => {
  const sid = SID();
  await call('/api/session', { method: 'POST', profile: profileA, body: { sessionId: sid, word: 'friend', mode: 'en' } });
  assert.equal((await call('/api/session', { method: 'POST', profile: profileA, body: { sessionId: sid, word: 'quixotic', mode: 'en' } })).status, 403);
  assert.equal(userDb.prepare('SELECT word FROM learn_sessions WHERE profile_id = ? AND session_id = ?').get(profileA, sid).word, 'friend');
});

test('安全 8：跨档案拿不到别人的会话状态', async () => {
  const other = await newProfile('跨档案测试');
  const sid = SID();
  await bindAndType(other, sid, 'moon');
  await readOnce(other, sid, 'moon', 95);
  assert.equal((await call('/api/meaning/moon', { profile: other, session: sid })).status, 200);
  assert.equal((await call('/api/meaning/moon', { profile: profileA, session: sid })).status, 403); // 换档案必须 403
  await dropProfile(other);
});

test('安全 9：快速查看不能跨词使用', async () => {
  await call(`/api/parent/profiles/${profileA}/settings`, { method: 'POST', parent: await getParent(), body: { quickPeekPerDay: 5 } });
  const sid = SID();
  await bindAndType(profileA, sid, 'star');
  assert.equal((await call('/api/quick-peek', { method: 'POST', profile: profileA, body: { word: 'quixotic', sessionId: sid } })).status, 403);
});

test('安全 10：读音接口也不能跨词', async () => {
  const sid = SID();
  await bindAndType(profileA, sid, 'family');
  assert.equal((await call('/api/pronunciation/family', { profile: profileA, session: sid })).status, 200);
  assert.equal((await call('/api/pronunciation/quixotic', { profile: profileA, session: sid })).status, 403);
});

test('安全 11：客户端伪造校准分数无效（分数线只由服务端算）', async () => {
  const pid = await newProfile('校准测试', 'middle');
  const before = (await call('/api/settings', { profile: pid })).data.settings.passScore;

  assert.equal((await call('/api/calibration', { method: 'POST', profile: pid, body: { scores: [5, 5, 5] } })).status, 404); // 老接口已移除

  await call('/api/calibration/start', { method: 'POST', profile: pid });
  const done = await call('/api/calibration/finish', { method: 'POST', profile: pid, body: { scores: [5, 5, 5] } });
  assert.equal(done.data.passScore, null); // 一个有效样本都没有 → 不采用
  assert.equal(done.data.usedSamples, 0);
  assert.equal((await call('/api/settings', { profile: pid })).data.settings.passScore, before); // 分数线没被改动
  await dropProfile(pid);
});

test('安全 12：非开发模式下 mockScore 无效', async () => {
  const sid = SID();
  await bindAndType(profileA, sid, 'father');
  const prev = process.env.WORDLOCK_DEV;
  delete process.env.WORDLOCK_DEV;
  try {
    const r = await call('/api/score', { method: 'POST', profile: profileA, body: { word: 'father', sessionId: sid, mockScore: 5 } });
    assert.equal(r.status, 200);
    assert.notEqual(r.data.score, 5); // 客户端给的 5 分被忽略
  } finally {
    process.env.WORDLOCK_DEV = prev;
  }
});

test('安全 13：缺音频时给友好提示而不是服务器报错', async () => {
  const sid = SID();
  await bindAndType(profileA, sid, 'mother');
  const prev = process.env.WORDLOCK_DEV;
  delete process.env.WORDLOCK_DEV;
  try {
    const r = await call('/api/score', { method: 'POST', profile: profileA, body: { word: 'mother', sessionId: sid } });
    assert.equal(r.status, 200);
    assert.equal(r.data.error, 'too_quiet');
    assert.equal(r.data.retry, true);
  } finally {
    process.env.WORDLOCK_DEV = prev;
  }
});
````
