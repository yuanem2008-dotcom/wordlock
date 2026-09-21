// 轻微的提示音效（需求 2.9），受档案的 soundEnabled 控制。
// 用 WebAudio 现场生成，不加载任何外部文件。

let ctx = null;

function getCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  return ctx;
}

export function unlockSFX() {
  const c = getCtx();
  if (c && c.state === 'suspended') c.resume();
}

function tone(freq, start, duration, gainValue = 0.06) {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(c.destination);
  const t0 = c.currentTime + start;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(gainValue, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

// 完成一小步：清脆的上升双音
export function playStepSound(enabled) {
  if (!enabled) return;
  try {
    tone(660, 0, 0.12);
    tone(880, 0.09, 0.16);
  } catch {}
}

// 学会一个词：短促的小庆祝三连音
export function playSuccessSound(enabled) {
  if (!enabled) return;
  try {
    tone(523, 0, 0.12);
    tone(659, 0.1, 0.12);
    tone(784, 0.2, 0.22);
  } catch {}
}

// 温和的提醒：柔和单音（不用刺耳的“错误音”）
export function playGentleSound(enabled) {
  if (!enabled) return;
  try {
    tone(440, 0, 0.2, 0.04);
  } catch {}
}
