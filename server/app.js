// 应用装配：index.js（启动）与测试共用。

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDictDb, openUserDb } from './db.js';
import { createDictRouter } from './routes/dict.js';
import { createProfileRouter, createProfileMiddleware } from './routes/profile.js';
import { createEventsRouter } from './routes/events.js';
import { createSessionRouter } from './routes/session.js';
import { createScoreRouter } from './routes/score.js';
import { createVocabRouter } from './routes/vocab.js';
import { createChildRouter } from './routes/child.js';
import { createParentRouter } from './routes/parent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 启动前的评测配置检查：宁可起不来，也不要让孩子在用"随便念都能过"的模拟打分。
// 返回 null 表示没问题，否则返回一段中文说明。
export function scorerConfigProblem() {
  const name = (process.env.SCORER || 'mock').toLowerCase();
  const dev = (process.env.WORDLOCK_DEV ?? '') === '1';
  if (name === 'mock' && !dev) {
    return (
      '当前用的是"模拟打分"（SCORER=mock），孩子随便念都能通过，不能这样给孩子用。\n' +
      '  ① 正式使用：在 .env 里填好密钥并设 SCORER=xunfei\n' +
      '  ② 只是自己调试：在 .env 里加一行 WORDLOCK_DEV=1（明确声明这是开发模式）'
    );
  }
  if (name === 'xunfei') {
    const missing = ['XUNFEI_APP_ID', 'XUNFEI_API_KEY', 'XUNFEI_API_SECRET'].filter((k) => !process.env[k]);
    if (missing.length) return `SCORER=xunfei，但 .env 里缺：${missing.join('、')}`;
  }
  if (name === 'tencent') {
    const missing = ['TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY'].filter((k) => !process.env[k]);
    if (missing.length) return `SCORER=tencent，但 .env 里缺：${missing.join('、')}`;
  }
  return null;
}

export function createApp({ userDb, dictDb }) {
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const requireProfile = createProfileMiddleware(userDb);
  app.use('/api', createProfileRouter(userDb, requireProfile));
  // 家长接口用自己的 PIN 鉴权，不要求先选档案
  app.use('/api', createParentRouter(userDb));
  // 之后的接口都需要已选择档案
  app.use('/api', requireProfile);
  // 所有正常接口
  app.use('/api', createEventsRouter(userDb));
  app.use('/api', createSessionRouter(userDb, () => dictDb));
  app.use('/api', createScoreRouter(userDb));
  app.use('/api', createVocabRouter(userDb, () => dictDb));
  app.use('/api', createChildRouter(userDb, () => dictDb));
  app.use('/api', createDictRouter({ getDictDb: () => dictDb, userDb }));

  // 没匹配到的接口：明确返回 JSON 404（而不是 HTML 错误页，也避免请求挂住）
  app.use('/api', (req, res) => res.status(404).json({ error: '没有这个接口' }));

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: '服务器开小差了，请再试一次' });
  });
  return app;
}

export function boot() {
  const userDb = openUserDb();
  const dictDb = openDictDb();
  if (!dictDb) {
    console.warn('提示：还没有找到 data/dict.db，查词功能暂不可用。请先下载词典并运行 npm run build-dict（见 README）。');
  }
  const scorerName = (process.env.SCORER || 'mock').toLowerCase();
  if (scorerName === 'mock') {
    console.log('评测：模拟打分（正式用请在 .env 里设置 SCORER=xunfei 并填好密钥）');
  } else {
    const missing =
      scorerName === 'xunfei'
        ? ['XUNFEI_APP_ID', 'XUNFEI_API_KEY', 'XUNFEI_API_SECRET'].filter((k) => !process.env[k])
        : ['TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY'].filter((k) => !process.env[k]);
    console.log(
      missing.length
        ? `评测：${scorerName}（还没配置好，缺 ${missing.join('、')}）`
        : `评测：${scorerName}（已配置）`
    );
  }
  return { userDb, dictDb, app: createApp({ userDb, dictDb }) };
}
