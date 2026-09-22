// 录音并转 16kHz / 16bit / 单声道 WAV（需求 5.2）。
//
// 两条采集路径：
//   桌面（Mac/Windows）：AudioWorklet —— 实时音量条可用
//   iOS（iPhone/iPad）：MediaRecorder —— 苹果原生采集，最可靠
//     （iOS 上 Web Audio 采集有多个已知怪癖：Worklet 可能采到纯静音、
//      指定采样率的 Context + 麦克风会输出零……统一走 MediaRecorder 最稳）
//
// iOS 路径：MediaRecorder 录出 mp4/aac → decodeAudioData 解码 → 重采样到 16k → WAV。

const TARGET_RATE = 16000;
const MAX_SECONDS = 5;

// 桌面路径的采集处理器（iOS 走 MediaRecorder，不用这个）
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

// iOS（iPhone/iPad）的 Safari 对 Web Audio 采集有已知兼容问题，直接走 MediaRecorder。
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function createRecorder() {
  let stream = null;
  let ctx = null;
  let node = null;
  let workletNode = null;
  let sink = null;         // 桌面路径：增益为 0 的汇点，驱动采集但不出声
  let chunks = [];
  let mr = null;           // iOS：MediaRecorder
  let mrChunks = [];
  let peak = 0;
  let onVolume = null;
  let running = false;
  let startMs = 0;
  let stopTimer = null;
  let mode = 'worklet';    // 'worklet' | 'mr'

  async function start(volumeCallback) {
    onVolume = volumeCallback ?? null;
    chunks = [];
    mrChunks = [];
    peak = 0;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    running = true;
    startMs = Date.now();

    if (IS_IOS && window.MediaRecorder) {
      mode = 'mr';
      mr = new MediaRecorder(stream);
      mrChunks = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size) mrChunks.push(e.data); };
      mr.start();
      // iOS 上不开实时音量条（Web Audio 采集在 iOS 不可靠）；
      // 界面用按钮文字+动画表示录音中。
      stopTimer = setTimeout(() => stop(), MAX_SECONDS * 1000 + 500);
      return { mode };
    }

    mode = 'worklet';

    // ⚠️ Web Audio 只会"拉动"能通到 destination 的节点。
    // 采集节点必须先接到 destination，否则它的 process()/onaudioprocess 根本不会被调用，
    // 结果是一个音频块都收不到、峰值恒为 0，界面永远提示"没听清"（踩过这个坑）。
    // 但直接把麦克风接到 destination 会从扬声器放出来（会啸叫），
    // 所以中间串一个增益为 0 的节点：能驱动采集，又不出声。
    sink = ctx.createGain();
    sink.gain.value = 0;
    sink.connect(ctx.destination);

    let usedWorklet = false;
    if (!IS_IOS) {
      try {
        const blobUrl = URL.createObjectURL(new Blob([WORKLET_CODE], { type: 'application/javascript' }));
        await ctx.audioWorklet.addModule(blobUrl);
        URL.revokeObjectURL(blobUrl);
        workletNode = new AudioWorkletNode(ctx, 'capture-processor');
        workletNode.port.onmessage = (e) => handleChunk(e.data);
        source.connect(workletNode);
        workletNode.connect(sink);
        usedWorklet = true;
      } catch {
        usedWorklet = false;
      }
    }
    if (!usedWorklet) {
      node = ctx.createScriptProcessor(2048, 1, 1);
      node.onaudioprocess = (e) => handleChunk(e.inputBuffer.getChannelData(0));
      source.connect(node);
      node.connect(sink);
    }

    // 单词最长录 5 秒，超时自动结束（需求 2.3）
    stopTimer = setTimeout(() => stop(), MAX_SECONDS * 1000 + 300);
    return { mode: usedWorklet ? 'worklet' : 'script' };
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

  // stop() 返回 { wav, durationSec, tooQuiet, peak, chunks }
  async function stop() {
    if (!running) return null;
    running = false;
    clearTimeout(stopTimer);

    if (mode === 'mr') {
      // iOS：MediaRecorder 停止 → 拿到 mp4/aac → 解码 → 重采样 → WAV
      const blob = await new Promise((resolve) => {
        mr.onstop = () => resolve(new Blob(mrChunks));
        mr.stop();
      });
      try {
        stream?.getTracks().forEach((t) => t.stop());
      } catch {}

      const ab = await blob.arrayBuffer();
      const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
      let audioBuffer;
      try {
        audioBuffer = await decodeCtx.decodeAudioData(ab);
      } catch (err) {
        await decodeCtx.close().catch(() => {});
        return { wav: null, durationSec: 0, tooQuiet: true, peak: 0, chunks: 0 };
      }
      const raw = audioBuffer.getChannelData(0);
      const resampled = resampleLinear(raw, audioBuffer.sampleRate, TARGET_RATE);
      await decodeCtx.close().catch(() => {});

      let peakLinear = 0;
      for (let i = 0; i < raw.length; i++) {
        const v = Math.abs(raw[i]);
        if (v > peakLinear) peakLinear = v;
      }
      const durationSec = audioBuffer.duration;
      const tooQuiet = peakLinear < 0.012;
      return { wav: encodeWav(resampled, TARGET_RATE), durationSec, tooQuiet, peak: peakLinear, chunks: mrChunks.length };
    }

    // 桌面 worklet/script 路径
    try {
      workletNode?.disconnect();
      node?.disconnect();
      sink?.disconnect();
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
    return { wav: encodeWav(resampled, TARGET_RATE), durationSec, tooQuiet, peak, chunks: chunks.length };
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
