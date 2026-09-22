// 生词本与复习调度（需求 2.8、阶段 3）。
// next_review_at 用 YYYY-MM-DD（服务器本地时间）存，字符串比较即日期比较。

export function todayLocal(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// assisted 的词额外增加一轮复习（需求 阶段3）。
export function effectiveIntervals(vocabRow, settings) {
  const base = Array.isArray(settings.reviewIntervals) && settings.reviewIntervals.length
    ? settings.reviewIntervals
    : [1, 2, 7, 15, 30];
  if (vocabRow?.assisted) return [...base, base[base.length - 1] + 1];
  return base;
}

export function getVocabWord(userDb, profileId, word) {
  return userDb
    .prepare('SELECT * FROM vocab WHERE profile_id = ? AND word = ?')
    .get(profileId, word);
}

export function getLearnedWord(userDb, profileId, word) {
  const row = getVocabWord(userDb, profileId, word);
  return row && row.status === 'learned' ? row : null;
}

export function learnedDaysAgo(vocabRow) {
  if (!vocabRow?.first_learned_at) return null;
  const dayUtc = (iso) => {
    const t = new Date(iso);
    return Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  };
  const diff = Math.floor((dayUtc(new Date()) - dayUtc(new Date(vocabRow.first_learned_at))) / 86400000);
  return Number.isFinite(diff) ? Math.max(0, diff) : null;
}

// 通关：写入/更新生词本（status=learned），并安排第一次复习。
export function graduateWord(userDb, profileId, word, info = {}) {
  const now = new Date().toISOString();
  const existing = getVocabWord(userDb, profileId, word);
  const settings = info.settings;
  const intervals = effectiveIntervals(existing, settings);
  const firstLearnedAt = existing?.first_learned_at ?? now;
  const status = 'learned';
  const assisted = existing?.assisted || (info.assisted ? 1 : 0);
  const stage = existing?.status === 'pending' ? existing.stage : 0;
  userDb
    .prepare(
      `INSERT INTO vocab (profile_id, word, entry_mode, status, first_learned_at, assisted,
        typing_errors, read_attempts, best_score, stage, next_review_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(profile_id, word) DO UPDATE SET
         status = excluded.status,
         assisted = excluded.assisted,
         typing_errors = excluded.typing_errors,
         read_attempts = excluded.read_attempts,
         best_score = MAX(vocab.best_score, excluded.best_score),
         stage = excluded.stage,
         next_review_at = excluded.next_review_at`
    )
    .run(
      profileId,
      word,
      info.entryMode ?? existing?.entry_mode ?? 'en',
      status,
      firstLearnedAt,
      assisted,
      info.typingErrors ?? existing?.typing_errors ?? 0,
      info.readAttempts ?? existing?.read_attempts ?? 0,
      info.bestScore ?? 0,
      stage,
      todayLocal(intervals[0] ?? 1)
    );
  return getVocabWord(userDb, profileId, word);
}

// 复习答对/答错后的安排（需求 阶段3）。
export function applyReviewResult(userDb, profileId, word, correct, settings) {
  const row = getVocabWord(userDb, profileId, word);
  if (!row) return null;
  const intervals = effectiveIntervals(row, settings);
  let stage = row.stage;
  let next;
  if (correct) {
    stage += 1;
    next = stage < intervals.length ? todayLocal(intervals[stage]) : null; // 毕业不再复习
  } else {
    stage = Math.max(0, stage - 1);
    next = todayLocal(1); // 第二天再考
  }
  userDb
    .prepare(
      `UPDATE vocab SET
         stage = ?,
         next_review_at = ?,
         review_correct = review_correct + ?,
         review_wrong = review_wrong + ?
       WHERE profile_id = ? AND word = ?`
    )
    .run(stage, next, correct ? 1 : 0, correct ? 0 : 1, profileId, word);
  return getVocabWord(userDb, profileId, word);
}

// 今天到期的复习词：最多 reviewPerDay 个（需求 阶段3）。
export function dueWords(userDb, profileId, settings) {
  const cap = Math.max(0, Math.floor(settings.reviewPerDay ?? 0));
  return userDb
    .prepare(
      `SELECT * FROM vocab
       WHERE profile_id = ? AND status = 'learned'
         AND next_review_at IS NOT NULL AND next_review_at <= ?
       ORDER BY next_review_at, id
       LIMIT ?`
    )
    .all(profileId, todayLocal(0), cap);
}

export function pendingWords(userDb, profileId) {
  return userDb
    .prepare("SELECT * FROM vocab WHERE profile_id = ? AND status = 'pending' ORDER BY first_learned_at")
    .all(profileId);
}
