// 用 HTTPS 启动（iPad 上要用麦克风就得走 HTTPS）。
// 用法：npm run start:https
// 与 npm start 的区别只有一个：把 HTTPS 打开。端口/证书路径也可以用 .env 覆盖。

process.env.HTTPS = process.env.HTTPS || '1';
await import('../server/index.js');
