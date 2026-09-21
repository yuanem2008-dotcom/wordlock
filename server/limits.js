// 每日查词上限（需求 阶段4）：按“今天已开始输入的 distinct 词数”计算。

export function lookupLimitState(userDb, profileId, settings) {
  const limit = Math.max(0, Math.floor(settings.dailyLookupLimit ?? 0));
  if (limit === 0) return { allowed: true, remaining: null, limit: 0, usedToday: null };
  const row = userDb
    .prepare(
      `SELECT COUNT(DISTINCT word) AS n FROM events
       WHERE profile_id = ? AND type = 'typing_ok' AND date(ts, 'localtime') = date('now', 'localtime')`
    )
    .get(profileId);
  const used = row?.n ?? 0;
  return {
    allowed: used < limit,
    remaining: Math.max(0, limit - used),
    limit,
    usedToday: used,
  };
}
