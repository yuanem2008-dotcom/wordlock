// 录音并转 16kHz / 16bit / 单声道 WAV（需求 5.2）。
// 浏览器 MediaRecorder 在 iPad 上输出 mp4/aac 不能直接用，所以自己采集原始音频。
// 优先 AudioWorklet，不支持时退回 ScriptProcessor。

const WORKLET_CODE = `
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) this.port.postMessage(input[0]);
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
`;

const TARGET_RATE = 16000;
const MAX_SECONDS = 5;

export function createRecorder() {
  let stream = null;
  let ctx = null;
  let node = null;
  let workletNode = null;
  let chunks = [];
  let peak = 0;
  let onVolume = null;
  let running = false;
  let startMs = 0;
  let stopTimer = null;

  async function start(volumeCallback) {
    onVolume = volumeCallback ?? null;
    chunks = [];
    peak = 0;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: TARGET_RATE });
    } catch {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ctx.state === 'suspended') await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    running = true;
    startMs = Date.now();

    let usedWorklet = false;
    try {
      const blobUrl = URL.createObjectURL(new Blob([WORKLET_CODE], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(blobUrl);
      URL.revokeObjectURL(blobUrl);
      workletNode = new AudioWorkletNode(ctx, 'capture-processor');
      workletNode.port.onmessage = (e) => handleChunk(e.data);
      source.connect(workletNode);
      usedWorklet = true;
    } catch {
      usedWorklet = false;
    }
    if (!usedWorklet) {
      node = ctx.createScriptProcessor(2048, 1, 1);
      node.onaudioprocess = (e) => handleChunk(e.inputBuffer.getChannelData(0));
      source.connect(node);
      node.connect(ctx.destination);
    }

    // 单词最长录 5 秒，超时自动结束（需求 2.3）
    stopTimer = setTimeout(() => stop(), MAX_SECONDS * 1000 + 300);
    return { usedWorklet };
  }

  function handleChunk(float32) {
    if (!running) return;
    const copy = new Float32Array(float32);
    chunks.push(copy);
    let sumSq = 0;
    for (let i = 0; i < copy.length; i++) sumSq += copy[i] * copy[i];
    const rms = Math.sqrt(sumSq / copy.length);
    if (rms > peak) peak = rms;
    if (onVolume) onVolume(Math.min(1, rms * 4));
    if (Date.now() - startMs > MAX_SECONDS * 1000) stop();
  }

  // stop() 返回 { wav: ArrayBuffer, durationSec, tooQuiet }
  async function stop() {
    if (!running) return null;
    running = false;
    clearTimeout(stopTimer);
    try {
      workletNode?.disconnect();
      node?.disconnect();
      stream?.getTracks().forEach((t) => t.stop());
    } catch {}
    const sampleRate = ctx.sampleRate;
    try {
      await ctx.close();
    } catch {}
    ctx = null;

    const merged = mergeChunks(chunks);
    const durationSec = merged.length / sampleRate;
    const tooQuiet = peak < 0.012; // 基本没出声：不算失败，提示再念一遍
    const resampled = sampleRate === TARGET_RATE ? merged : resampleLinear(merged, sampleRate, TARGET_RATE);
    return { wav: encodeWav(resampled, TARGET_RATE), durationSec, tooQuiet, peak };
  }

  return { start, stop, isRunning: () => running };
}

function mergeChunks(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function resampleLinear(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = input[i0] ?? 0;
    const b = input[i0 + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

export function encodeWav(samples, rate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}
