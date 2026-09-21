// 查词事件记录（需求 2.10）。某些事件同时推进会话进度（阶段 3 的校验依据）。

import { Router } from 'express';
import { applyEventToSession, getSession, upsertSession } from '../sessions.js';
import { getProfileBundle } from '../settings.js';
import { graduateWord } from '../vocab.js';

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
        const word = typeof e.word === 'string' ? e.word.slice(0, 64) : null;
        const sid = typeof e.sessionId === 'string' ? e.sessionId.slice(0, 64) : null;
        insert.run(
          profileId,
          ts,
          sid,
          e.mode === 'zh' ? 'zh' : 'en',
          word,
          typeof e.step === 'string' ? e.step.slice(0, 32) : null,
          type,
          e.detail == null ? null : JSON.stringify(e.detail)
        );
        applyEventToSession(userDb, profileId, {
          session_id: sid,
          type,
          word,
          mode: e.mode === 'zh' ? 'zh' : 'en',
        });

        // 求助通关：立即写入生词本（assisted，之后会重点复习）
        if (type === 'help_used' && word && sid) {
          const bundle = getProfileBundle(userDb, req.profile);
          const session = getSession(userDb, profileId, sid);
          graduateWord(userDb, profileId, word, {
            settings: bundle.settings,
            assisted: true,
            readAttempts: session?.read_attempts ?? 0,
          });
        }
      }
    });
    run();
    res.json({ ok: true });
  });

  return router;
}
