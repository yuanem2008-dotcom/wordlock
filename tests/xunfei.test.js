// 讯飞评测模块的单元测试。
// 没有真实密钥也能验证：鉴权签名、音频分帧、返回 XML 的分数解析。
// 依据官方文档：https://www.xfyun.cn/doc/Ise/IseAPI.html

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  signOrigin,
  buildAuthUrl,
  extractPcm,
  readWavFormat,
  buildAudioFrames,
  parseResultXml,
  buildExamText,
  toHundredScale,
  classifyResult,
} from '../server/scorers/xunfei.js';

const DATE = 'Wed, 10 Jul 2019 07:35:43 GMT';
const SECRET = 'test-secret';
const KEY = 'test-key';

test('英文试题格式：read_word 必须以 [word] 开头（否则讯飞报 48195）', () => {
  const text = buildExamText('apple');
  assert.equal(text, '﻿[word]\napple');
  assert.equal(text[0], '﻿'); // 带 BOM
  assert.equal(buildExamText('apple', 'read_sentence'), '﻿[content]\napple');
});

test('签名串格式与官方一致（host/date/request-line 三行）', () => {
  const expectedOrigin = 'host: ise-api.xfyun.cn\ndate: Wed, 10 Jul 2019 07:35:43 GMT\nGET /v2/open-ise HTTP/1.1';
  const expected = crypto.createHmac('sha256', SECRET).update(expectedOrigin).digest('base64');
  assert.equal(signOrigin(DATE, SECRET), expected);
  // base64 的 HMAC-SHA256 固定 44 字节
  assert.equal(Buffer.from(signOrigin(DATE, SECRET), 'base64').length, 32);
});

test('鉴权地址：参数齐全、authorization 可解出 api_key 与 signature', () => {
  const url = buildAuthUrl({ apiKey: KEY, apiSecret: SECRET, date: DATE });
  assert.ok(url.startsWith('wss://ise-api.xfyun.cn/v2/open-ise?'));
  const params = new URL(url).searchParams;
  assert.equal(params.get('host'), 'ise-api.xfyun.cn');
  assert.equal(params.get('date'), DATE);

  const decoded = Buffer.from(params.get('authorization'), 'base64').toString('utf8');
  assert.ok(decoded.includes(`api_key="${KEY}"`));
  assert.ok(decoded.includes('algorithm="hmac-sha256"'));
  assert.ok(decoded.includes('headers="host date request-line"'));
  assert.ok(decoded.includes(`signature="${signOrigin(DATE, SECRET)}"`));
  // 文档正文的写法：逗号后不带空格
  assert.ok(decoded.startsWith(`api_key="${KEY}",algorithm=`));
});

test('鉴权地址：另一种逗号写法（历史示例）也能生成', () => {
  const decoded = Buffer.from(
    new URL(buildAuthUrl({ apiKey: KEY, apiSecret: SECRET, date: DATE, spaced: true })).searchParams.get('authorization'),
    'base64'
  ).toString('utf8');
  assert.ok(decoded.startsWith(`api_key="${KEY}", algorithm=`));
});

// 造一个标准 WAV：44 字节头 + payload
function makeWav(payload, { extraChunk = null } = {}) {
  const chunks = [];
  const fmt = Buffer.alloc(8 + 16);
  fmt.write('fmt ', 0, 'ascii');
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8); // PCM
  fmt.writeUInt16LE(1, 10); // 单声道
  fmt.writeUInt32LE(16000, 12); // 采样率
  fmt.writeUInt32LE(32000, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22); // 16bit
  chunks.push(fmt);
  if (extraChunk) chunks.push(extraChunk);
  const data = Buffer.alloc(8 + payload.length);
  data.write('data', 0, 'ascii');
  data.writeUInt32LE(payload.length, 4);
  payload.copy(data, 8);
  chunks.push(data);
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WAVE', 8, 'ascii');
  return Buffer.concat([header, body]);
}

test('取 PCM：标准 WAV 去掉 44 字节头', () => {
  const payload = Buffer.alloc(1000, 3);
  assert.equal(extractPcm(makeWav(payload)).length, 1000);
  assert.deepEqual(extractPcm(makeWav(payload)).subarray(0, 3), Buffer.from([3, 3, 3]));
});

test('取 PCM：带额外块（afconvert 会加的 LIST 块）也能取对', () => {
  // 关键回归：以前写死跳过 44 字节，遇到 LIST 块会把块头当音频，讯飞报 48195
  const listPayload = Buffer.from('INFOxxxx', 'ascii');
  const listChunk = Buffer.alloc(8 + listPayload.length);
  listChunk.write('LIST', 0, 'ascii');
  listChunk.writeUInt32LE(listPayload.length, 4);
  listPayload.copy(listChunk, 8);
  const payload = Buffer.alloc(1000, 9);
  const wav = makeWav(payload, { extraChunk: listChunk });
  const pcm = extractPcm(wav);
  assert.equal(pcm.length, 1000);
  assert.equal(pcm[0], 9); // 不是块头的字节
});

test('取 PCM：非 WAV（已经是裸 PCM）原样返回', () => {
  const raw = Buffer.alloc(1000, 7);
  assert.equal(extractPcm(raw).length, 1000);
});

test('读 WAV 格式：拿到采样率/位深/声道', () => {
  const format = readWavFormat(makeWav(Buffer.alloc(100)));
  assert.deepEqual(format, { formatTag: 1, channels: 1, sampleRate: 16000, bitsPerSample: 16 });
  assert.equal(readWavFormat(Buffer.alloc(100)), null);
});

test('分帧：每帧 1280 字节，aus/status 序列正确', () => {
  const pcm = Buffer.alloc(1280 * 3 + 100, 1); // 3 整帧 + 1 个尾帧
  const frames = buildAudioFrames(pcm);
  assert.equal(frames.length, 4);
  assert.deepEqual(frames.map((f) => f.data.length), [1280, 1280, 1280, 100]);
  // 首帧 aus=1 status=0；中间 aus=2 status=1；末帧 aus=4 status=2
  assert.deepEqual(frames.map((f) => [f.aus, f.status]), [[1, 0], [2, 1], [2, 1], [4, 2]]);
});

test('分帧：只有一帧时既是首帧也是末帧', () => {
  const frames = buildAudioFrames(Buffer.alloc(500, 1));
  assert.equal(frames.length, 1);
  assert.deepEqual([frames[0].aus, frames[0].status], [1, 2]);
});

test('分帧：正好整帧时末帧标记正确', () => {
  const frames = buildAudioFrames(Buffer.alloc(2560, 1));
  assert.equal(frames.length, 2);
  assert.deepEqual(frames.map((f) => [f.aus, f.status]), [[1, 0], [4, 2]]);
});

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<xml_result>
  <read_word id="abc" ent="en_vip" category="read_word" total_score="83.5"
    fluency_score="80.2" integrity_score="100" accuracy_score="78" standard_score="81"
    phone_score="85" tone_score="90" is_rejected="false" dp_message="0">
  </read_word>
</xml_result>`;

test('解析分数 XML', () => {
  const parsed = parseResultXml(SAMPLE_XML);
  assert.equal(parsed.total, 83.5);
  assert.equal(parsed.fluency, 80.2);
  assert.equal(parsed.integrity, 100);
  assert.equal(parsed.accuracy, 78);
  assert.equal(parsed.phone, 85);
  assert.equal(parsed.rejected, false);
});

test('解析：被拒识（没读到有效语音）', () => {
  const parsed = parseResultXml('<xml_result><read_word is_rejected="true" except_info="28677"></read_word></xml_result>');
  assert.equal(parsed.rejected, true);
  assert.equal(parsed.total, null);
});

test('解析：缺字段不炸，返回 null', () => {
  const parsed = parseResultXml('<xml_result><read_word></read_word></xml_result>');
  assert.equal(parsed.total, null);
  assert.equal(parsed.rejected, false);
});

test('分数换算：官方 0~5 分制 → 本应用的 0~100 分', () => {
  // 官方对照表：4.3~5 分 = 86~100 分（优）
  assert.equal(toHundredScale(4.64), 93);
  assert.equal(toHundredScale(4.3), 86);
  assert.equal(toHundredScale(3.5), 70); // 良的下沿
  assert.equal(toHundredScale(2.5), 50); // 中的下沿
  assert.equal(toHundredScale(0), 0);
  assert.equal(toHundredScale(5), 100);
  assert.equal(toHundredScale(5.4), 100); // 越界夹住
  assert.equal(toHundredScale(null), null);
});

test('结果分类：区分「没好念」「环境吵」「读错词」', () => {
  // 没声音／声音太小
  assert.equal(classifyResult({ exceptInfo: 28673, rejected: true }), 'no_speech');
  // 太吵、录音截幅 → 环境/设备问题
  assert.equal(classifyResult({ exceptInfo: 28680, rejected: false }), 'noisy');
  assert.equal(classifyResult({ exceptInfo: 28709, rejected: false }), 'noisy');
  assert.equal(classifyResult({ exceptInfo: 28690, rejected: false }), 'noisy');
  // 乱读（读的是别的词）→ 算一次失败
  assert.equal(classifyResult({ exceptInfo: 28676, rejected: true }), 'nonsense');
  assert.equal(classifyResult({ exceptInfo: 0, rejected: true }), 'nonsense');
  // 正常
  assert.equal(classifyResult({ exceptInfo: 0, rejected: false, total: 4.6 }), 'ok');
  // 正常但没给分数 → 当作没听到
  assert.equal(classifyResult({ exceptInfo: 0, rejected: false, total: null }), 'no_speech');
});

test('解析真实返回：except_info 与 is_rejected 都要取到', () => {
  const xml =
    '<read_word accuracy_score="2.530319" content="apple" except_info="28676" is_rejected="true" total_score="2.530319">';
  const parsed = parseResultXml(xml);
  assert.equal(parsed.exceptInfo, 28676);
  assert.equal(parsed.rejected, true);
  assert.equal(classifyResult(parsed), 'nonsense');
});
