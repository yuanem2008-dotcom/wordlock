// mock 评测器：开发/演示用，不看真实音频。
// - 前端在 ?dev=1 时会传 mockScore（模拟得分滑块），服务器照它打分；
// - 没传时给一个稳定的“读得不错”分数，方便走通流程。
// 正式使用请在 .env 里配置 SCORER=tencent 或 xunfei。

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function stableScore(targetWord) {
  let h = 0;
  for (const ch of String(targetWord || 'word')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 74 + (h % 18); // 74~91：mock 默认让流程能通过
}

export async function score(wavBuffer, targetWord, options = {}) {
  const provided = Number(options.mockScore);
  const value = Number.isFinite(provided)
    ? clamp(Math.round(provided), 0, 100)
    : stableScore(targetWord);
  return { score: value, detail: { mock: true }, error: null };
}
