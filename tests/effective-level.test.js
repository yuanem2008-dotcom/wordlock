import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEffectiveLevel, LEVEL_COUNTS } from '../server/settings.js';

test('起点档位（还没有查词记录）', () => {
  assert.equal(computeEffectiveLevel(1, true, 0, 5), 1);
  assert.equal(computeEffectiveLevel(2, true, 0, 5), 2);
  assert.equal(computeEffectiveLevel(3, true, 0, 5), 3);
});

test('自动升档：每 5 个有记录的日子升一档', () => {
  assert.equal(computeEffectiveLevel(1, true, 4, 5), 1);
  assert.equal(computeEffectiveLevel(1, true, 5, 5), 2);
  assert.equal(computeEffectiveLevel(1, true, 9, 5), 2);
  assert.equal(computeEffectiveLevel(1, true, 10, 5), 3);
  assert.equal(computeEffectiveLevel(2, true, 5, 5), 3);
});

test('档位上限是 3', () => {
  assert.equal(computeEffectiveLevel(1, true, 15, 5), 3);
  assert.equal(computeEffectiveLevel(3, true, 500, 5), 3);
});

test('autoRamp 关闭时不升档', () => {
  assert.equal(computeEffectiveLevel(1, false, 100, 5), 1);
  assert.equal(computeEffectiveLevel(2, false, 100, 5), 2);
});

test('rampEveryActiveDays 为 0 时视为不升档（避免除零）', () => {
  assert.equal(computeEffectiveLevel(1, true, 100, 0), 1);
});

test('异常输入兜底', () => {
  assert.equal(computeEffectiveLevel(0, true, 0, 5), 1);      // 档位下限 1
  assert.equal(computeEffectiveLevel(9, true, 0, 5), 3);      // 档位上限 3
  assert.equal(computeEffectiveLevel(1, true, -3, 5), 1);     // 天数不为负
  assert.equal(computeEffectiveLevel(2, true, 5.9, 5), 3);    // 天数取整
});

test('档位 → 次数对应表', () => {
  assert.deepEqual(LEVEL_COUNTS[1], { typing: 1, reading: 1 });
  assert.deepEqual(LEVEL_COUNTS[2], { typing: 2, reading: 2 });
  assert.deepEqual(LEVEL_COUNTS[3], { typing: 3, reading: 3 });
});
