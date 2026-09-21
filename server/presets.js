// 两个预设的默认参数（需求 2.5）。
// 档案创建时选定预设；家长模式（阶段4）的修改会写进档案自己的 settings 覆盖项。

export const PRESETS = {
  primary: {
    label: '小学高年级（五年级）',
    gateLevel: 1,
    autoRamp: true,
    rampEveryActiveDays: 5,
    passScore: 60,
    helpAfterFails: 4,
    meaningLines: 2,
    reviewPerDay: 3,
    accent: 'en-US',
    dailyLookupLimit: 0,
    reviewIntervals: [1, 2, 7],
    readingMode: 'cumulative',
    streakTolerance: 1,
    soundEnabled: true,
    theme: 'simple',
    quickPeekPerDay: 0,
    calibrated: false, // 阶段2：首次跟读前的试一试是否做过
    ttsVoice: '',      // 标准读音的嗓音，空 = 自动挑饱满男声
  },
  middle: {
    label: '初中（初一）',
    gateLevel: 2,
    autoRamp: true,
    rampEveryActiveDays: 5,
    passScore: 70,
    helpAfterFails: 4,
    meaningLines: 3,
    reviewPerDay: 5,
    accent: 'en-US',
    dailyLookupLimit: 0,
    reviewIntervals: [1, 2, 7],
    readingMode: 'cumulative',
    streakTolerance: 1,
    soundEnabled: true,
    theme: 'simple',
    quickPeekPerDay: 0,
    calibrated: false,
    ttsVoice: '',
  },
};

export const AVATARS = ['🐱', '🐶', '🦊', '🐼', '🐸', '🦉', '🐳', '🦄'];

// settings_json 里只存「与预设不同的覆盖项」，读取时与预设合并，
// 这样以后给预设加新参数时，老档案也能自动拿到默认值。
export function mergeSettings(presetKey, overridesJson) {
  const preset = PRESETS[presetKey] ?? PRESETS.primary;
  let overrides = {};
  try {
    overrides = JSON.parse(overridesJson || '{}') || {};
  } catch {
    overrides = {};
  }
  const merged = {};
  for (const key of Object.keys(preset)) {
    if (key === 'label') continue;
    merged[key] = key in overrides && overrides[key] !== undefined ? overrides[key] : preset[key];
  }
  return merged;
}
