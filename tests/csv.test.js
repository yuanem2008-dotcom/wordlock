import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CsvParser, normalizeTranslation, hasChinese, mapColumns } from '../scripts/build-dict.js';

function parseAll(text, chunkSize = 1 << 16) {
  const rows = [];
  const parser = new CsvParser((row) => rows.push(row));
  for (let i = 0; i < text.length; i += chunkSize) {
    parser.push(text.slice(i, i + chunkSize));
  }
  parser.end();
  return rows;
}

const ECDICT_HEADER = 'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio';

test('基本解析：普通行、空行占位', () => {
  const rows = parseAll('a,b,c\n1,2,3\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('引号字段：内部逗号、双引号转义', () => {
  const rows = parseAll('a,"b,c ""q""",d\n');
  assert.deepEqual(rows, [['a', 'b,c "q"', 'd']]);
});

test('引号字段里可以有真实换行（不会被拆成两行）', () => {
  const rows = parseAll('apple,"ˈæp.əl",x,"n. 苹果\nn. 苹果树",,1\nbook,bʊk,y,"n. 书",,1\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], ['apple', 'ˈæp.əl', 'x', 'n. 苹果\nn. 苹果树', '', '1']);
});

test('CRLF 行尾、末行无换行符', () => {
  const rows = parseAll('a,b\r\n1,2');
  assert.deepEqual(rows, [['a', 'b'], ['1', '2']]);
});

test('BOM 被去掉', () => {
  const rows = parseAll('﻿word,frq\napple,10\n');
  assert.deepEqual(rows[0], ['word', 'frq']);
});

test('按很小的块推送（模拟流式读取边界切断字段）', () => {
  const text = `${ECDICT_HEADER}\napple,"ˈæp.əl",fruit,"n. 苹果；苹果树",,,1,cet4,150,25771,,,7274\n`;
  const rows = parseAll(text, 3);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], 'apple');
  assert.equal(rows[1][3], 'n. 苹果；苹果树');
});

test('normalizeTranslation：字面 \\n 与真实换行都变成换行，并去首尾空白', () => {
  assert.equal(normalizeTranslation('n. 苹果\\nn. 苹果树'), 'n. 苹果\nn. 苹果树');
  assert.equal(normalizeTranslation('n. 苹果\r\nn. 苹果树'), 'n. 苹果\nn. 苹果树');
  assert.equal(normalizeTranslation('  n. 水  '), 'n. 水');
  assert.equal(normalizeTranslation(null), '');
});

test('hasChinese：没有中文释义的条目要被丢弃', () => {
  assert.ok(hasChinese('n. 苹果'));
  assert.ok(!hasChinese('a kind of fruit'));
});

test('mapColumns：按表头自动识别列，大小写不敏感', () => {
  const map = mapColumns(ECDICT_HEADER.split(','));
  assert.equal(map.word, 0);
  assert.equal(map.phonetic, 1);
  assert.equal(map.translation, 3);
  assert.equal(map.tag, 7);
  assert.equal(map.frq, 9);
});

test('mapColumns：缺 word 或 translation 列要报错', () => {
  assert.throws(() => mapColumns(['word', 'phonetic']));
  assert.throws(() => mapColumns(['translation', 'frq']));
});
