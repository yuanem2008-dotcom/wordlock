// 孩子侧的辅助接口：快速查看（阶段5）、学习天数（阶段6）、花园（阶段6）、主题选择。

import { Router } from 'express';
import { getProfileBundle, countActiveDays } from '../settings.js';
import { getLearnedWord, getVocabWord, todayLocal } from '../vocab.js';
import { lookupLimitState } from '../limits.js';
import { getSession, upsertSession } from '../sessions.js';

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
    upsertSession(userDb, profileId, sessionId, { word, mode, quick_peek: 1, meaning_shown: 1 });

    const remaining = quota - used - 1;
    res.json({ ok: true, lines: translationLines(word, bundle.settings.meaningLines), remaining });
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
