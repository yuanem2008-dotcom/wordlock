// 验证发音评测是否可用：用系统语音合成「念」几个单词，送给评测接口看分数。
// 用法：npm run try-scorer
//   念对的音应该拿高分；故意用另一个词冒充（banana 当成 apple）应该明显低分。
//
// 只依赖 macOS 自带的 say / afconvert（其它系统会提示跳过）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../server/env.js';

loadEnv();
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { getScorer, scorerIsConfigured } = await import('../server/scorers/index.js');

const CASES = process.argv.slice(2).length
  ? process.argv.slice(2).map((s) => {
      const [speak, target] = s.split(':');
      return { speak: speak.trim(), target: (target ?? speak).trim() };
    })
  : [
      { speak: 'apple', target: 'apple' },
      { speak: 'book', target: 'book' },
      { speak: 'water', target: 'water' },
      { speak: 'banana', target: 'apple' }, // 念错：预期明显低分
    ];

function checkTools() {
  const missing = ['say', 'afconvert'].filter((cmd) => spawnSync('which', [cmd], { encoding: 'utf8' }).status !== 0);
  return missing;
}

// 读 WAV 头，确认格式确实是 16kHz/16bit/单声道（讯飞对此很挑）
export function describeWav(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') return '不是 WAV 格式';
  return {
    format: `fmt 标记 ${buffer.readUInt16LE(20)}（1=PCM）`,
    channels: buffer.readUInt16LE(22),
    sampleRate: buffer.readUInt32LE(24),
    bitsPerSample: buffer.readUInt16LE(34),
    dataBytes: buffer.length - 44,
  };
}

// 用系统语音生成一段 16kHz/16bit/单声道 WAV（和浏览器录出来的格式一致）
function synthesize(text, outWav) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wordlock-say-'));
  const aiff = path.join(tmp, 'speech.aiff');
  const said = spawnSync('say', ['-r', '160', text, '-o', aiff], { encoding: 'utf8' });
  if (said.status !== 0) throw new Error(`say 失败：${said.stderr || said.error?.message}`);
  const converted = spawnSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', aiff, outWav], {
    encoding: 'utf8',
  });
  if (converted.status !== 0) throw new Error(`afconvert 失败：${converted.stderr || converted.error?.message}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  return outWav;
}

const missing = checkTools();
if (missing.length) {
  console.error(`这个验证工具需要 macOS 自带的 ${missing.join('、')}，当前系统上没有。`);
  console.error('你可以直接在浏览器里点麦克风念单词来验证：npm start 后打开 http://localhost:3000');
  process.exit(1);
}

const scorer = await getScorer();
console.log(`当前评测实现：${scorer.name}`);
if (!scorerIsConfigured(scorer.name)) {
  console.error('密钥还没配置好，请检查 .env 里的 XUNFEI_APP_ID / XUNFEI_API_KEY / XUNFEI_API_SECRET。');
  process.exit(1);
}

const outWav = path.join(root, 'certs', 'try-scorer.wav'); // 放在 certs 里（已被 git 忽略）
console.log('用例：念的词 → 评测的单词（前者和后者不一样时，分数应该明显低）\n');

let failures = 0;
for (const { speak, target } of CASES) {
  try {
    synthesize(speak, outWav);
    const wav = fs.readFileSync(outWav);
    const info = describeWav(wav);
    const started = Date.now();
    const result = await scorer.score(wav, target);
    const ms = Date.now() - started;
    if (result.error) {
      failures += 1;
      console.log(`念「${speak}」评「${target}」 → 出错：${result.error}  (${ms}ms)`);
      console.log(`   送出的音频：${JSON.stringify(info)}`);
      continue;
    }
    const d = result.detail ?? {};
    console.log(
      `念「${speak}」评「${target}」 → 总分 ${result.score}` +
        (d.accuracy != null ? `（准确 ${d.accuracy} / 流畅 ${d.fluency} / 完整 ${d.integrity}）` : '') +
        `  (${ms}ms)`
    );
  } catch (err) {
    failures += 1;
    console.log(`念「${speak}」评「${target}」 → 失败：${err.message}`);
  }
}

console.log(
  failures
    ? `\n有 ${failures} 个用例失败——如果都是网络/鉴权错误，请检查 .env 的密钥。`
    : '\n完成。念对的分明显高于念错的，就说明接好了 ✅'
);
