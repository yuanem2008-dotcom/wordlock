import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { buildDict, buildZhTerms, cleanTerm, isIndexableWord, relevanceRank } from '../scripts/build-dict.js';
import { searchZh } from '../server/zh-search.js';

test('cleanTerm：去词性标记、括号注释、残留标点', () => {
  assert.equal(cleanTerm('n. 苹果'), '苹果');
  assert.equal(cleanTerm('vt.&vi. 预订'), '预订');
  assert.equal(cleanTerm('adj. 高兴的；幸福的'), '高兴的；幸福的');
  assert.equal(cleanTerm('银河系（天河）'), '银河系');
  assert.equal(cleanTerm('n. 《创世纪》(圣经)'), '《创世纪》');
  assert.equal(cleanTerm('  水  '), '水');
  assert.equal(cleanTerm('。'), '');
});

test('buildZhTerms：按行拆、按分隔符拆、gloss 是所在行', () => {
  const terms = buildZhTerms('n. 书本；书籍\nvt. 预订；预约');
  assert.deepEqual(terms, [
    { term: '书本', gloss: 'n. 书本；书籍' },
    { term: '书籍', gloss: 'n. 书本；书籍' },
    { term: '预订', gloss: 'vt. 预订；预约' },
    { term: '预约', gloss: 'vt. 预订；预约' },
  ]);
});

test('buildZhTerms：空片段、超长片段会被丢掉', () => {
  assert.deepEqual(buildZhTerms('n. 书本；（注释）\n' + '长'.repeat(30)), [
    { term: '书本', gloss: 'n. 书本；（注释）' },
  ]);
});

test('buildZhTerms：跳过 [网络]/[医] 等专业来源的释义行', () => {
  assert.deepEqual(buildZhTerms('n. 苹果, 家伙\n[医] 苹果\n[网络] 苹果手机'), [
    { term: '苹果', gloss: 'n. 苹果, 家伙' },
    { term: '家伙', gloss: 'n. 苹果, 家伙' },
  ]);
});

test('isIndexableWord：app. / a. / apel- / 123 这类非词条不建索引', () => {
  assert.ok(isIndexableWord('apple'));
  assert.ok(isIndexableWord("don't"));
  assert.ok(isIndexableWord('well-known'));
  assert.ok(isIndexableWord('ice cream'));
  assert.ok(!isIndexableWord('app.'));
  assert.ok(!isIndexableWord('a.'));
  assert.ok(!isIndexableWord('apel-'));
  assert.ok(!isIndexableWord('12345'));
  assert.ok(!isIndexableWord('-foo'));
});

test('relevanceRank：中高考词最优先，生僻词最后', () => {
  assert.equal(relevanceRank('zk gk', 371), 0);        // teacher
  assert.equal(relevanceRank('gk cet4 ky', 4890), 0);  // delight
  assert.equal(relevanceRank('toefl', 24090), 1);      // hilarity
  assert.equal(relevanceRank('', 31123), 2);           // rebbe：有词频但不属于任何考试词表
  assert.equal(relevanceRank('', 0), 3);               // moolvee：没有词频 → 生僻
  assert.equal(relevanceRank(null, 0), 3);
});

test('searchZh：生僻词沉底，且没有更好结果时才兜底（老师 → teacher）', () => {
  const db3 = new Database(':memory:');
  db3.exec('CREATE TABLE zh_index (term TEXT, word TEXT, gloss TEXT, frq INTEGER, hot INTEGER, rank INTEGER)');
  const ins = db3.prepare('INSERT INTO zh_index VALUES (?, ?, ?, ?, 1, ?)');
  ins.run('老师', 'teacher', 'n. 老师', 371, 0);    // 中高考词
  ins.run('老师', 'rebbe', 'n. 老师', 31123, 2);    // 有词频但不常用
  ins.run('老师', 'moolvee', 'n. 老师', 0, 3);      // 生僻
  ins.run('老师', 'teachering', 'n. 老师', 0, 3);   // 生僻
  const results = searchZh(db3, '老师', 8);
  // 常用词在前，生僻词因为已有更好结果而不显示
  assert.deepEqual(results.map((r) => r.word), ['teacher', 'rebbe']);

  // 只有生僻词时兜底返回，不至于「什么都没找到」
  const db4 = new Database(':memory:');
  db4.exec('CREATE TABLE zh_index (term TEXT, word TEXT, gloss TEXT, frq INTEGER, hot INTEGER, rank INTEGER)');
  const ins4 = db4.prepare('INSERT INTO zh_index VALUES (?, ?, ?, ?, 0, ?)');
  ins4.run('犄角旮旯', 'nook', 'n. 犄角旮旯', 0, 3);
  assert.deepEqual(searchZh(db4, '犄角旮旯', 8).map((r) => r.word), ['nook']);
  db3.close();
  db4.close();
});

let tmp;
let db;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wordlock-zh-'));
  const fixtureDir = path.join(tmp, 'raw');
  fs.mkdirSync(fixtureDir);
  const fixture = new URL('./fixtures/mini-ecdict.csv', import.meta.url);
  fs.copyFileSync(fixture, path.join(fixtureDir, 'mini-ecdict.csv'));
  await buildDict({ rawDir: fixtureDir, outFile: path.join(tmp, 'dict.db') });
  db = new Database(path.join(tmp, 'dict.db'), { readonly: true });
});

after(() => {
  db?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('zh_index 已生成：苹果 能查到 apple', () => {
  const rows = db.prepare('SELECT word, gloss FROM zh_index WHERE term = ?').all('苹果');
  assert.ok(rows.length >= 1);
  assert.ok(rows.some((r) => r.word === 'apple'));
});

test('searchZh：精确命中排第一（苹果 → apple）', () => {
  const results = searchZh(db, '苹果');
  assert.ok(results.length >= 1);
  assert.equal(results[0].word, 'apple');
  assert.ok(results[0].gloss.includes('苹果'));
  // 不返回音标/释义字段
  assert.equal('phonetic' in results[0], false);
  assert.equal('translation' in results[0], false);
});

test('searchZh：前缀命中（高兴 → happy 的「高兴的」）', () => {
  const results = searchZh(db, '高兴');
  assert.ok(results.some((r) => r.word === 'happy'));
});

test('searchZh：精确命中（跑 → run）', () => {
  const results = searchZh(db, '跑');
  assert.equal(results[0].word, 'run');
});

test('searchZh：包含命中兜底也能找到', () => {
  // 「水」是 water 释义「n. 水；雨水」的精确片段；用「雨水」测包含之外的场景
  const results = searchZh(db, '水');
  assert.ok(results.some((r) => r.word === 'water'));
});

test('searchZh：三档排序——精确 > 前缀 > 包含', () => {
  const db2 = new Database(':memory:');
  db2.exec(`CREATE TABLE zh_index (term TEXT, word TEXT, gloss TEXT, frq INTEGER, hot INTEGER DEFAULT 0, rank INTEGER DEFAULT 0)`);
  const ins = db2.prepare('INSERT INTO zh_index VALUES (?, ?, ?, ?, 1, 0)');
  ins.run('爱学习', 'contain', 'n. 爱学习的人', 100);  // 只含“学习”，不算前缀
  ins.run('学习者', 'prefix', 'n. 学习者', 100);        // 以“学习”开头
  ins.run('学习', 'exact', 'v. 学习', 100);             // 完全相同
  const results = searchZh(db2, '学习', 8);
  assert.deepEqual(results.map((r) => r.word), ['exact', 'prefix', 'contain']);
  db2.close();
});

test('searchZh：同档内单词优先于短语、frq 小的在前、0 最后', () => {
  const db2 = new Database(':memory:');
  db2.exec(`CREATE TABLE zh_index (term TEXT, word TEXT, gloss TEXT, frq INTEGER, hot INTEGER DEFAULT 0, rank INTEGER DEFAULT 0)`);
  const ins = db2.prepare('INSERT INTO zh_index VALUES (?, ?, ?, ?, 1, 0)');
  ins.run('猫', 'big cats', 'n. 猫科动物', 10);         // 短语（含空格）
  ins.run('猫', 'zero', 'n. 猫', 0);                    // 无词频
  ins.run('猫', 'rare', 'n. 猫', 900);                  // 高名次=较生僻
  ins.run('猫', 'common', 'n. 猫', 10);                 // 常用
  const results = searchZh(db2, '猫', 8);
  assert.deepEqual(results.map((r) => r.word), ['common', 'rare', 'zero', 'big cats']);
  db2.close();
});

test('searchZh：同一个词只出现一次（不同释义行去重）', () => {
  const results = searchZh(db, '书');
  const words = results.map((r) => r.word);
  assert.equal(new Set(words).size, words.length);
});

test('searchZh：查不到返回空数组，不崩溃', () => {
  assert.deepEqual(searchZh(db, '不存在的词组合'), []);
  assert.deepEqual(searchZh(db, ''), []);
  assert.deepEqual(searchZh(null, '苹果'), []);
});
