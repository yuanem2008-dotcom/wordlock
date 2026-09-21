// 生成 iPad 能用的本地 HTTPS 证书（基于 mkcert）。
// 一条命令搞定：自动找出这台电脑在局域网里的 IP，把它写进证书里。
//
// 用法：npm run certs
// 之后在 .env 里加一行 HTTPS=1，再 npm start，终端会打印 iPad 该打开的地址。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const certDir = path.join(root, 'certs');

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal) out.push(info.address);
    }
  }
  return out;
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts });
}

const version = run('mkcert', ['-version']);
if (version.error || version.status !== 0) {
  console.error(
    '没有找到 mkcert。请先安装它：\n' +
      '  macOS：brew install mkcert\n' +
      '  其它系统见 https://github.com/FiloSottile/mkcert\n' +
      '装好后重新运行：npm run certs'
  );
  process.exit(1);
}

const ips = lanAddresses();
if (!ips.length) {
  console.error('这台电脑现在没有局域网 IP：请先连上 Wi-Fi（iPad 要和电脑连同一个 Wi-Fi），再运行 npm run certs。');
  process.exit(1);
}

fs.mkdirSync(certDir, { recursive: true });

// 第一次运行会把本地根证书装进系统信任列表（macOS 会要一次开机密码）。
// 不想输密码就加 --no-install：加密证书照样生成，只是电脑自己的浏览器会提示证书不受信任。
const skipInstall = process.argv.includes('--no-install');
if (skipInstall) {
  console.log('第 1 步：跳过安装系统根证书（--no-install）');
  console.log('        影响：电脑自己的浏览器打开 https 会提示“不安全”，iPad 不受影响。');
} else {
  console.log('第 1 步：把本地根证书装到这台电脑（如果之前装过会跳过，macOS 可能要你输一次开机密码）…');
  const install = run('mkcert', ['-install'], { stdio: 'inherit' });
  if (install.status !== 0) {
    console.error('安装根证书失败。可以跳过这步，但电脑浏览器会提示证书不受信任。');
  }
}

console.log('\n第 2 步：给下面这些地址签证书…');
for (const ip of ips) console.log(`  - ${ip}`);
const hosts = ['localhost', '127.0.0.1', ...ips];
const made = run(
  'mkcert',
  ['-key-file', path.join('certs', 'wordlock-key.pem'), '-cert-file', path.join('certs', 'wordlock.pem'), ...hosts],
  { cwd: root, stdio: 'inherit' }
);
if (made.status !== 0) {
  console.error('\n生成证书失败，请看上面的报错信息。');
  process.exit(1);
}

const caRoot = run('mkcert', ['-CAROOT']);
const caDir = (caRoot.stdout ?? '').trim();

console.log('\n搞定！证书在 certs/ 目录里。接下来：');
console.log('  1) 在 .env 里加一行：HTTPS=1');
console.log('  2) npm start —— 终端会打印「iPad 上用这个地址：https://…」');
console.log('  3) 把下面这个文件隔空投送到 iPad，装好并在「证书信任设置」里打开它：');
console.log(`     ${path.join(caDir || '<mkcert -CAROOT 的输出>', 'rootCA.pem')}`);
console.log('\n详细步骤（含 iPad 上怎么点）见 README 的「四、iPad 上使用」。');
