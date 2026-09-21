// 按 .env 里的 SCORER 选择评测实现（需求 5.1）。

export function getScorer() {
  const name = (process.env.SCORER || 'mock').toLowerCase();
  const mod = name === 'tencent' ? 'tencent.js' : name === 'xunfei' ? 'xunfei.js' : 'mock.js';
  return import(`./${mod}`).then((m) => ({ name, score: m.score }));
}

export function scorerIsConfigured(name) {
  if (name === 'tencent') {
    return Boolean(process.env.TENCENT_SECRET_ID && process.env.TENCENT_SECRET_KEY);
  }
  if (name === 'xunfei') {
    return Boolean(process.env.XUNFEI_APP_ID && process.env.XUNFEI_API_KEY && process.env.XUNFEI_API_SECRET);
  }
  return true; // mock 永远可用
}
