// 档案参数的读取与门槛档位计算（需求 2.5）。

import { mergeSettings } from './presets.js';

// 档位 → 输入次数 / 跟读次数
export const LEVEL_COUNTS = {
  1: { typing: 1, reading: 1 },
  2: { typing: 2, reading: 2 },
  3: { typing: 3, reading: 3 },
};

// 纯函数：当前生效的门槛档位，上限 3、下限 1。
export function computeEffectiveLevel(gateLevel, autoRamp, activeDays, rampEveryActiveDays) {
  const base = Math.min(3, Math.max(1, Math.floor(gateLevel) || 1));
  let ramp = 0;
  if (autoRamp && rampEveryActiveDays > 0) {
    ramp = Math.floor(Math.max(0, Math.floor(activeDays) || 0) / rampEveryActiveDays);
  }
  return Math.min(3, base + ramp);
}

// 计算一个档案「有查词记录的日子」的天数（按服务器本地时间的天）。
export function countActiveDays(userDb, profileId) {
  const row = userDb
    .prepare("SELECT COUNT(DISTINCT date(ts, 'localtime')) AS n FROM events WHERE profile_id = ?")
    .get(profileId);
  return row?.n ?? 0;
}

export function getProfileBundle(userDb, profileRow) {
  const settings = mergeSettings(profileRow.preset, profileRow.settings_json);
  const activeDays = countActiveDays(userDb, profileRow.id);
  const effectiveLevel = computeEffectiveLevel(
    settings.gateLevel,
    settings.autoRamp,
    activeDays,
    settings.rampEveryActiveDays
  );
  return {
    settings,
    activeDays,
    effectiveLevel,
    typingCount: LEVEL_COUNTS[effectiveLevel].typing,
    readingCount: LEVEL_COUNTS[effectiveLevel].reading,
  };
}
