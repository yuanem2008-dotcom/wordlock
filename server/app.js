// 应用装配：index.js（启动）与测试共用。

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDictDb, openUserDb } from './db.js';
import { createDictRouter } from './routes/dict.js';
import { createProfileRouter, createProfileMiddleware } from './routes/profile.js';
import { createEventsRouter } from './routes/events.js';
import { createScoreRouter } from './routes/score.js';
import { createVocabRouter } from './routes/vocab.js';
import { createChildRouter } from './routes/child.js';
import { createParentRouter } from './routes/parent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  app.use('/api', createEventsRouter(userDb));
  app.use('/api', createScoreRouter(userDb));
  app.use('/api', createVocabRouter(userDb, () => dictDb));
  app.use('/api', createChildRouter(userDb, () => dictDb));
  app.use('/api', createDictRouter({ getDictDb: () => dictDb, userDb }));

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
