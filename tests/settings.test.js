import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, mergeSettings, AVATARS } from '../server/presets.js';

test('小学高年级预设的默认参数（需求 2.5 表格）', () => {
  const s = mergeSettings('primary', '{}');
  assert.equal(s.gateLevel, 1);
  assert.equal(s.autoRamp, true);
  assert.equal(s.rampEveryActiveDays, 5);
  assert.equal(s.passScore, 60);
  assert.equal(s.helpAfterFails, 4);
  assert.equal(s.meaningLines, 2);
  assert.equal(s.reviewPerDay, 3);
  assert.equal(s.accent, 'en-US');
  assert.equal(s.dailyLookupLimit, 0);
  assert.deepEqual(s.reviewIntervals, [1, 2, 7, 15, 30]);
  assert.equal(s.readingMode, 'cumulative');
  assert.equal(s.streakTolerance, 1);
  assert.equal(s.soundEnabled, true);
  assert.equal(s.theme, 'simple');
  assert.equal(s.quickPeekPerDay, 0);
  assert.equal('label' in s, false); // label 不算参数
});

test('初中预设的默认参数', () => {
  const s = mergeSettings('middle', '{}');
  assert.equal(s.gateLevel, 2);
  assert.equal(s.passScore, 70);
  assert.equal(s.meaningLines, 3);
  assert.equal(s.reviewPerDay, 5);
});

test('档案覆盖项生效，其余沿用预设', () => {
  const s = mergeSettings('primary', JSON.stringify({ passScore: 75, soundEnabled: false }));
  assert.equal(s.passScore, 75);
  assert.equal(s.soundEnabled, false);
  assert.equal(s.gateLevel, 1);
});

test('settings_json 坏了也能读到默认值', () => {
  const s = mergeSettings('primary', 'not-json{{{');
  assert.equal(s.gateLevel, 1);
});

test('未知预设回退到小学高年级', () => {
  const s = mergeSettings('unknown', '{}');
  assert.equal(s.gateLevel, 1);
});

test('正好 8 个头像可选', () => {
  assert.equal(AVATARS.length, 8);
  assert.equal(new Set(AVATARS).size, 8);
});
