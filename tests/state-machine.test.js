import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTypingSession,
  normalizeInput,
  MSG_INVALID,
  MSG_NOT_FOUND,
  MSG_LENGTH,
  positionMessage,
} from '../public/state-machine.js';

const FOUND = (word) => ({ exists: true, word });
const MISS = (suggestions) => ({ exists: false, word: 'xx', suggestions });

test('归一化：去首尾空格、转小写', () => {
  assert.equal(normalizeInput('  Apple '), 'apple');
  assert.equal(normalizeInput('WELL-KNOWN'), 'well-known');
  assert.equal(normalizeInput("DON'T"), "don't");
  assert.equal(normalizeInput('   '), '');
});

test('非法字符被拒绝，不计数', () => {
  const s = createTypingSession({ requiredCount: 3 });
  const r = s.firstInput('app1e', MISS());
  assert.equal(r.status, 'invalid');
  assert.equal(r.message, MSG_INVALID);
  assert.equal(r.events.length, 0);
  assert.equal(s.getState().completed, 0);

  const r2 = s.firstInput('苹果', MISS());
  assert.equal(r2.status, 'invalid');

  // 后续输入同样校验
  s.firstInput('apple', FOUND('apple'));
  const r3 = s.nextInput('appl3');
  assert.equal(r3.status, 'invalid');
  assert.equal(s.getState().completed, 1);
});

test('第 1 次找不到：提示且不计数、不给相近词', () => {
  const s = createTypingSession({ requiredCount: 2 });
  const r = s.firstInput('aple', MISS(['apple']));
  assert.equal(r.status, 'not_found');
  assert.equal(r.message, MSG_NOT_FOUND);
  assert.equal(r.suggestions, undefined);
  assert.equal(s.getState().notFoundStreak, 1);
  assert.equal(r.events[0].type, 'not_found');
});

test('连续第 2 次找不到：返回相近词提示', () => {
  const s = createTypingSession({ requiredCount: 2 });
  s.firstInput('aple', MISS(['apple']));
  const r = s.firstInput('appla', MISS(['apple']));
  assert.equal(r.status, 'not_found');
  assert.deepEqual(r.suggestions, ['apple']);
  assert.equal(s.getState().notFoundStreak, 2);
});

test('找到目标词后，找不到的连击计数归零', () => {
  const s = createTypingSession({ requiredCount: 2 });
  s.firstInput('aple', MISS());
  s.firstInput('apple', FOUND('apple'));
  assert.equal(s.getState().notFoundStreak, 0);
  assert.equal(s.isAwaitingFirst(), false);
});

test('N=1：第 1 次命中即完成', () => {
  const s = createTypingSession({ requiredCount: 1 });
  const r = s.firstInput('Apple ', FOUND('apple'));
  assert.equal(r.status, 'done');
  assert.equal(r.done, true);
  assert.equal(r.target, 'apple');
  assert.deepEqual(r.events.map((e) => e.type), ['typing_ok', 'typing_done']);
});

test('N=2：第 1 次命中是进度，第 2 次命中才完成', () => {
  const s = createTypingSession({ requiredCount: 2 });
  const r1 = s.firstInput('apple', FOUND('apple'));
  assert.equal(r1.status, 'progress');
  assert.equal(r1.completed, 1);
  assert.deepEqual(r1.events.map((e) => e.type), ['typing_ok']);

  const r2 = s.nextInput('APPLE');
  assert.equal(r2.status, 'done');
  assert.deepEqual(r2.events.map((e) => e.type), ['typing_ok', 'typing_done']);
});

test('N=3：完整走三遍', () => {
  const s = createTypingSession({ requiredCount: 3 });
  assert.equal(s.firstInput('run', FOUND('run')).status, 'progress');
  assert.equal(s.nextInput('run').status, 'progress');
  const r3 = s.nextInput(' run ');
  assert.equal(r3.status, 'done');
  assert.equal(r3.completed, 3);
});

test('字母个数不同：提示数一数，不清零', () => {
  const s = createTypingSession({ requiredCount: 2 });
  s.firstInput('apple', FOUND('apple'));
  const r = s.nextInput('apples');
  assert.equal(r.status, 'wrong');
  assert.equal(r.message, MSG_LENGTH);
  assert.equal(s.getState().completed, 1);
  assert.equal(r.events[0].type, 'typing_wrong');
});

test('个数相同有错位：只说第一个错的位置，不泄露字母', () => {
  const s = createTypingSession({ requiredCount: 3 });
  s.firstInput('happy', FOUND('happy'));
  const r = s.nextInput('hafpy'); // 第 3 个字母错
  assert.equal(r.status, 'wrong');
  assert.equal(r.message, positionMessage(3));
  assert.ok(!r.message.includes('appy')); // 给孩子看的提示里不带答案
  const r2 = s.nextInput('hoppy'); // 第 2 个字母错
  assert.equal(r2.message, positionMessage(2));
});

test('输错不清零，接着输对仍可完成', () => {
  const s = createTypingSession({ requiredCount: 2 });
  s.firstInput('book', FOUND('book'));
  s.nextInput('books');
  const r = s.nextInput('book');
  assert.equal(r.status, 'done');
});

test('换一个词：完全重置', () => {
  const s = createTypingSession({ requiredCount: 2 });
  s.firstInput('aple', MISS());
  s.firstInput('apple', FOUND('apple'));
  s.nextInput('applx');
  s.cancel();
  const st = s.getState();
  assert.equal(st.target, null);
  assert.equal(st.completed, 0);
  assert.equal(st.notFoundStreak, 0);
  assert.equal(st.done, false);
  assert.equal(s.isAwaitingFirst(), true);
  // 重置后连击也从零开始：第 1 次找不到不给相近词
  const r = s.firstInput('dogz', MISS(['dog']));
  assert.equal(r.suggestions, undefined);
});

test('已过首查阶段后不能再调 firstInput', () => {
  const s = createTypingSession({ requiredCount: 2 });
  s.firstInput('cat', FOUND('cat'));
  assert.equal(s.firstInput('cat', FOUND('cat')).status, 'error');
});

test('空输入被忽略', () => {
  const s = createTypingSession({ requiredCount: 1 });
  const r = s.firstInput('   ', MISS());
  assert.equal(r.status, 'empty');
});

test('requiredCount 异常值兜底为 1', () => {
  const s = createTypingSession({ requiredCount: 0 });
  const r = s.firstInput('sun', FOUND('sun'));
  assert.equal(r.status, 'done');
});

test('nextInput 完成时也必须带回目标词（回归：曾漏掉导致界面请求 undefined）', () => {
  const s = createTypingSession({ requiredCount: 2 });
  s.firstInput('book', FOUND('book'));
  const r = s.nextInput('book');
  assert.equal(r.status, 'done');
  assert.equal(r.target, 'book');
});

test('中文入口：setTarget 后从 0/N 开始，目标词可见', () => {
  const s = createTypingSession({ requiredCount: 2, mode: 'zh', targetVisible: true });
  const st0 = s.getState();
  assert.equal(st0.mode, 'zh');
  assert.equal(st0.targetVisible, true);
  assert.equal(s.isAwaitingFirst(), true); // 还没 setTarget

  s.setTarget('Apple'); // 大小写归一化
  assert.equal(s.isAwaitingFirst(), false);
  assert.equal(s.getState().completed, 0);
  assert.equal(s.getState().target, 'apple');

  const r1 = s.nextInput('apple');
  assert.equal(r1.status, 'progress');
  assert.equal(r1.completed, 1);
  const r2 = s.nextInput('apple');
  assert.equal(r2.status, 'done');
  assert.equal(r2.target, 'apple');
});

test('中文入口：默认参数是英文入口', () => {
  const s = createTypingSession({ requiredCount: 1 });
  assert.equal(s.getState().mode, 'en');
  assert.equal(s.getState().targetVisible, false);
});

test('音标不编造由接口负责；状态机不产生任何释义/音标', () => {
  const s = createTypingSession({ requiredCount: 1 });
  const r = s.firstInput('apple', FOUND('apple'));
  assert.ok(!('phonetic' in r));
  assert.ok(!('translation' in r));
});
