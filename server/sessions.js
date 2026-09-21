// 学习会话进度（阶段 3 的服务器校验依据）：一个查词流程一行。

const NOW = () => new Date().toISOString();

export function upsertSession(userDb, profileId, sessionId, fields = {}) {
  if (!sessionId) return;
  const existing = userDb
    .prepare('SELECT * FROM learn_sessions WHERE profile_id = ? AND session_id = ?')
    .get(profileId, sessionId);
  const now = NOW();
  if (!existing) {
    userDb
      .prepare(
        `INSERT INTO learn_sessions (profile_id, session_id, word, mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(profileId, String(sessionId).slice(0, 64), fields.word ?? null, fields.mode ?? 'en', now, now);
  }
  const sets = [];
  const args = [];
  for (const key of ['word', 'mode', 'typing_done', 'read_pass', 'read_fail', 'read_attempts', 'assisted', 'quick_peek', 'meaning_shown']) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      args.push(fields[key]);
    }
  }
  if (!sets.length) return;
  sets.push('updated_at = ?');
  args.push(now, profileId, String(sessionId).slice(0, 64));
  userDb
    .prepare(`UPDATE learn_sessions SET ${sets.join(', ')} WHERE profile_id = ? AND session_id = ?`)
    .run(...args);
}

// 事件驱动会话状态：某些事件类型直接推进会话进度。
export function applyEventToSession(userDb, profileId, event) {
  const { session_id: sid, type } = event;
  if (!sid) return;
  if (type === 'lookup_start') {
    upsertSession(userDb, profileId, sid, { word: event.word, mode: event.mode });
  } else if (type === 'typing_done') {
    upsertSession(userDb, profileId, sid, { word: event.word, typing_done: 1 });
  } else if (type === 'help_used') {
    upsertSession(userDb, profileId, sid, { word: event.word, assisted: 1 });
  } else if (type === 'quick_peek') {
    upsertSession(userDb, profileId, sid, { word: event.word, quick_peek: 1 });
  } else if (type === 'meaning_shown') {
    upsertSession(userDb, profileId, sid, { word: event.word, meaning_shown: 1 });
  }
}

export function getSession(userDb, profileId, sessionId) {
  if (!sessionId) return null;
  return userDb
    .prepare('SELECT * FROM learn_sessions WHERE profile_id = ? AND session_id = ?')
    .get(profileId, String(sessionId).slice(0, 64));
}
