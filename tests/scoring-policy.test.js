// 跟读处置策略的单元测试：谁算过、谁算失败、谁不计入失败。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideOutcome, MESSAGES } from '../server/scoring-policy.js';

const PASS = 60;

test('读得够好 → 通过', () => {
  const r = decideOutcome({ score: 86, detail: {} }, PASS);
  assert.equal(r.kind, 'pass');
  assert.equal(r.passed, true);
});

test('分数不够 → 算一次失败（计入失败次数）', () => {
  const r = decideOutcome({ score: 42, detail: {} }, PASS);
  assert.equal(r.kind, 'fail');
  assert.equal(r.passed, false);
});

test('读错词（乱读，分数被置 0）→ 算一次失败，不能白过', () => {
  const r = decideOutcome({ score: 0, detail: { nonsense: true } }, PASS);
  assert.equal(r.kind, 'fail');
  assert.equal(r.score, 0);
});

test('没念／太小声 → 不计入失败，提示靠近一点', () => {
  const r = decideOutcome({ score: null, error: 'no_speech', detail: {} }, PASS);
  assert.equal(r.kind, 'retry');
  assert.equal(r.message, MESSAGES.no_speech);
});

test('环境太吵 + 读得不好 → 不计入失败（不怪孩子）', () => {
  const r = decideOutcome({ score: 35, detail: { noisy: true } }, PASS);
  assert.equal(r.kind, 'retry');
  assert.equal(r.message, MESSAGES.bad_audio);
});

test('环境太吵 + 其实读得不错 → 照样通过（不让孩子白念）', () => {
  const r = decideOutcome({ score: 91, detail: { noisy: true } }, PASS);
  assert.equal(r.kind, 'pass');
  assert.equal(r.passed, true);
});

test('服务故障 → error，只说再试一次（不把孩子的问题暴露出来）', () => {
  const r = decideOutcome({ score: null, error: '讯飞评测失败（10313）' }, PASS);
  assert.equal(r.kind, 'error');
  assert.equal(r.message, MESSAGES.error);
});

test('通过线由档案决定（同一分数在不同档案结论不同）', () => {
  assert.equal(decideOutcome({ score: 65, detail: {} }, 60).kind, 'pass');
  assert.equal(decideOutcome({ score: 65, detail: {} }, 70).kind, 'fail');
});
