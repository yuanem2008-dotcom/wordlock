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
  'read_retry', // 客户端因音量过低/重复录音而没提交给评测：只记录，不授权
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
