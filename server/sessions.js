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
export function createSession(userDb, profileId, sessionId, { word, mode = 'en' }) {
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
    .run(profileId, id, target, mode === 'zh' ? 'zh' : 'en', 0, now, now);
  return { ok: true, session: getSession(userDb, profileId, id), completed: 0 };
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
