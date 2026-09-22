// 录音格式的单元测试：讯飞对音频格式很挑（16k/16bit/单声道），
// 这里守住 WAV 头不要写错——错了会表现为"孩子念了却总是没听清"。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav } from '../public/audio-record.js';

function readAscii(view, offset, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

test('encodeWav：写出标准的 16kHz / 16bit / 单声道 WAV 头', () => {
  const samples = new Float32Array(1000);
  const buf = encodeWav(samples, 16000);
  const view = new DataView(buf);

  assert.equal(readAscii(view, 0, 4), 'RIFF');
  assert.equal(readAscii(view, 8, 4), 'WAVE');
  assert.equal(readAscii(view, 12, 4), 'fmt ');
  assert.equal(readAscii(view, 36, 4), 'data');

  assert.equal(view.getUint16(20, true), 1, 'PCM 格式标记应为 1');
  assert.equal(view.getUint16(22, true), 1, '应为单声道');
  assert.equal(view.getUint32(24, true), 16000, '采样率应为 16000');
  assert.equal(view.getUint16(34, true), 16, '位深应为 16');

  assert.equal(view.getUint32(40, true), samples.length * 2, 'data 段长度 = 样本数 × 2');
  assert.equal(buf.byteLength, 44 + samples.length * 2);
  assert.equal(view.getUint32(4, true), 36 + samples.length * 2, 'RIFF 段长度');
});

test('encodeWav：样本按 16bit 小端写入，且做了削波保护', () => {
  const samples = new Float32Array([0, 1, -1, 2, -2, 0.5]);
  const view = new DataView(encodeWav(samples, 16000));
  const at = (i) => view.getInt16(44 + i * 2, true);

  assert.equal(at(0), 0);
  assert.equal(at(1), 32767, '最大正值');
  assert.equal(at(2), -32768, '最小负值');
  assert.equal(at(3), 32767, '超过 1 的值要被削到上限');
  assert.equal(at(4), -32768, '低于 -1 的值要被削到下限');
  assert.ok(Math.abs(at(5) - 16383) <= 1, '0.5 大致对应一半量程');
});
