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
