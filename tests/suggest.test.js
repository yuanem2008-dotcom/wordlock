import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { editDistance, findSuggestions } from '../server/suggest.js';
import { buildDict } from '../scripts/build-dict.js';

test('编辑距离基本性质', () => {
  assert.equal(editDistance('apple', 'apple'), 0);
  assert.equal(editDistance('aple', 'apple'), 1);      // 少打一个 p
  assert.equal(editDistance('appla', 'apple'), 1);     // 打错一个字母
  assert.equal(editDistance('cat', 'cut'), 1);
  assert.equal(editDistance('kitten', 'sitting'), 3);
});

test('长度差超过 2 直接排除', () => {
  assert.equal(editDistance('a', 'apple'), 99);
});

test('findSuggestions：按词频排序、0 排最后、只取 3 个', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE dict (
    word TEXT PRIMARY KEY, word_lower TEXT NOT NULL, phonetic TEXT DEFAULT '',
    translation TEXT, tag TEXT DEFAULT '', frq INTEGER DEFAULT 0, len INTEGER DEFAULT 0)`);
  const ins = db.prepare('INSERT INTO dict VALUES (?, ?, ?, ?, ?, ?, ?)');
  // 猫 的相近词们：距离都 ≤ 2，按词频升序，frq=0 的排最后
  ins.run('cat', 'cat', '', 'n. 猫', '', 900, 3);
  ins.run('cap', 'cap', '', 'n. 帽子', '', 100, 3);
  ins.run('cot', 'cot', '', 'n. 小床', '', 0, 3);
  ins.run('cart', 'cart', '', 'n. 手推车', '', 50, 4);
  ins.run('cats', 'cats', '', 'n. 猫（复数）', '', 20, 4);
  ins.run('can', 'can', '', 'v. 能；可以；装罐', '', 10, 3);
  ins.run('car', 'car', '', 'n. 汽车', '', 5, 3);
  // 注意：cat 本身不该出现在建议里
  assert.deepEqual(findSuggestions(db, 'cat', 3), ['car', 'can', 'cats']);
  // 词频 0 的排最后
  assert.deepEqual(findSuggestions(db, 'cat', 7).slice(-1), ['cot']);
  db.close();
});

test('findSuggestions：空库/非法输入返回空数组', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE dict (word TEXT, word_lower TEXT, phonetic TEXT, translation TEXT, tag TEXT, frq INTEGER, len INTEGER)');
  assert.deepEqual(findSuggestions(db, 'cat', 3), []);
  assert.deepEqual(findSuggestions(null, 'cat', 3), []);
  assert.deepEqual(findSuggestions(db, '', 3), []);
  assert.deepEqual(findSuggestions(db, '苹', 3), []);
  db.close();
});

test('findSuggestions：只用首字母+长度筛选后再算距离（构建的迷你词典上验证）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wordlock-test-'));
  const fixtureDir = path.join(tmp, 'raw');
  fs.mkdirSync(fixtureDir);
  const fixture = new URL('./fixtures/mini-ecdict.csv', import.meta.url);
  fs.copyFileSync(fixture, path.join(fixtureDir, 'mini-ecdict.csv'));
  const outFile = path.join(tmp, 'dict.db');

  try {
    const report = await buildDict({ rawDir: fixtureDir, outFile });
    assert.equal(report.kept, 30); // 全部 30 行都有中文释义

    const db = new Database(outFile, { readonly: true });
    const row = db.prepare('SELECT * FROM dict WHERE word_lower = ?').get('apple');
    assert.equal(row.word, 'apple');
    assert.equal(row.frq, 25771);
    assert.equal(row.len, 5);
    assert.equal(row.phonetic, 'ˈæp.əl');
    assert.ok(row.translation.includes('\n')); // 字面与真实换行都已归一

    // 短语与带撇号/连字符的词都在
    assert.ok(db.prepare('SELECT 1 FROM dict WHERE word_lower = ?').get("well-known"));
    assert.ok(db.prepare('SELECT 1 FROM dict WHERE word_lower = ?').get("don't"));

    // 相近词：aple → apple
    assert.deepEqual(findSuggestions(db, 'aple', 3), ['apple']);

    // 完全不认识的词：没有建议也不崩溃
    assert.deepEqual(findSuggestions(db, 'zzzz', 3), []);

    // cat 自己不出现在建议里；c 开头、长度±2 的 can't 会出现
    const sug = findSuggestions(db, 'cat', 8);
    assert.ok(sug.includes("can't") && !sug.includes('cat'));

    db.close();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
