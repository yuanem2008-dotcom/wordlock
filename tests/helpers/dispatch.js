// 进程内调用 Express 应用（不监听端口，沙箱/CI 里也能跑）。
// 伪造 socket 捕获响应字节，再按 HTTP 报文解析出 {status, headers, body}。

import http from 'node:http';
import net from 'node:net';

export function makeCaller(app) {
  return function call(pathname, { method = 'GET', body, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const parts = [];

      const socket = new net.Socket();
      socket.write = (data, enc, cb) => {
        parts.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data), typeof enc === 'string' ? enc : 'latin1'));
        const done = typeof enc === 'function' ? enc : cb;
        if (typeof done === 'function') done();
        return true;
      };
      socket.end = (data) => {
        if (data) socket.write(data);
        return socket;
      };
      socket.destroy = () => {};
      socket.address = () => ({ port: 0 });
      socket.setTimeout = () => {};

      const req = new http.IncomingMessage(socket);
      req.httpVersion = '1.1';
      req.method = method.toUpperCase();
      req.url = pathname;
      // Node 的 req.get() 按小写查 headers，必须统一小写
      const allHeaders = { host: 'test.local' };
      for (const [k, v] of Object.entries(headers)) allHeaders[k.toLowerCase()] = String(v);
      if (body !== undefined) {
        allHeaders['content-type'] = allHeaders['content-type'] ?? 'application/json';
      }
      req.headers = allHeaders;
      req.rawHeaders = Object.entries(allHeaders).flatMap(([k, v]) => [k, v]);
      if (body !== undefined) {
        const buf = Buffer.from(JSON.stringify(body));
        req.headers['content-length'] = String(buf.length);
        req.rawHeaders.push('content-length', String(buf.length));
        req.push(buf);
      }
      req.push(null);

      const res = new http.ServerResponse(req);
      res.assignSocket(socket);
      res.on('finish', () => {
        const raw = Buffer.concat(parts).toString('latin1');
        const sep = raw.indexOf('\r\n\r\n');
        const head = raw.slice(0, sep).split('\r\n');
        const status = Number(head[0].split(' ')[1]);
        const headerMap = {};
        for (const line of head.slice(1)) {
          const idx = line.indexOf(':');
          if (idx > 0) headerMap[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
        }
        const rawBody = raw.slice(sep + 4);
        let data;
        try {
          data = JSON.parse(Buffer.from(rawBody, 'latin1').toString('utf8'));
        } catch {
          data = rawBody;
        }
        resolve({ status, headers: headerMap, data });
      });
      res.on('error', reject);

      app.handle(req, res, (err) => {
        if (err) reject(err);
      });
    });
  };
}
