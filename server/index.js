// WordLock 服务器入口。npm start 即可启动，默认端口 3000。
// iPad 上要用麦克风必须走 HTTPS（浏览器规定），在 .env 里设 HTTPS=1 即可。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.js';
import { boot } from './app.js';

loadEnv();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 评测没配好就别启动（检查在 boot() 里，任何入口点都绕不过去）
let app;
try {
  ({ app } = boot());
} catch (err) {
  console.error(`\n启动失败：${err.message}\n`);
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const useHttps = /^(1|true|yes|on)$/i.test(process.env.HTTPS ?? '');
const keyPath = process.env.HTTPS_KEY || path.join(__dirname, '..', 'certs', 'wordlock-key.pem');
const certPath = process.env.HTTPS_CERT || path.join(__dirname, '..', 'certs', 'wordlock.pem');

// 找出电脑在局域网里的地址，方便直接把它念给 iPad 用
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal) out.push(info.address);
    }
  }
  return out;
}

function announce(scheme) {
  console.log(`WordLock 已启动（${scheme.toUpperCase()}）`);
  console.log(`  这台电脑上打开：${scheme}://localhost:${PORT}`);
  for (const ip of lanAddresses()) {
    console.log(`  iPad 上用这个地址：${scheme}://${ip}:${PORT}`);
  }
}

if (useHttps) {
  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.error(
      `找不到证书文件：\n  ${keyPath}\n  ${certPath}\n` +
        '请先运行 npm run certs 生成证书（或按 README「四、iPad 上使用」操作），\n' +
        '也可以把 .env 里的 HTTPS 去掉，先用 http 在电脑上打开。'
    );
    process.exit(1);
  }
  https
    .createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app)
    .listen(PORT, HOST, () => announce('https'));
} else {
  app.listen(PORT, HOST, () => announce('http'));
}
