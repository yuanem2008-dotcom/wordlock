// 用 GitHub REST API 把本仓库推成一个公开仓库。
//
// 为什么不用 git push：在国内 github.com 常被墙（api.github.com 通常可直连，本机实测
// github.com 3/3 超时、api.github.com 3/3 成功），而 git push / gh 登录都要连 github.com。
//
// 用法：
//   1) 把访问令牌写进 .github-token（该文件已被 git 忽略）
//   2) GITHUB_TOKEN=$(cat .github-token) node scripts/push-to-github.js [仓库名]
//
// 只会推送 git 已跟踪的文件（因此不含 .env、data/、certs/），并在推送前扫一遍密钥。

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.github.com';
const repoName = process.argv[2] || 'wordlock';
const token = process.env.GITHUB_TOKEN;

if (!token) {
  console.error('缺少 GITHUB_TOKEN。用法：GITHUB_TOKEN=$(cat .github-token) node scripts/push-to-github.js [仓库名]');
  process.exit(1);
}

const SECRET_PATTERNS = [
  /XUNFEI_API_SECRET\s*=\s*[A-Za-z0-9+/=_-]{12,}/,
  /XUNFEI_API_KEY\s*=\s*[A-Za-z0-9+/=_-]{12,}/,
  /TENCENT_SECRET_KEY\s*=\s*[A-Za-z0-9+/=_-]{12,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
];

async function api(pathname, init = {}) {
  const res = await fetch(API + pathname, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  return { status: res.status, data };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

/* ---------- 1. 确认身份 ---------- */
const me = await api('/user');
if (me.status !== 200) fail(`令牌无效或权限不足（HTTP ${me.status}）：${JSON.stringify(me.data).slice(0, 200)}`);
const owner = me.data.login;
const repoPath = `/repos/${owner}/${repoName}`;
console.log(`已识别账号：${owner}`);

/* ---------- 2. 收集要推送的文件（只取 git 已跟踪的） ---------- */
// 用 -z 以 NUL 分隔：文件名含中文时 git 默认会加引号转义，按行读会读错
const tracked = execSync('git ls-files -z', { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const files = [];
for (const rel of tracked) {
  const buf = fs.readFileSync(path.join(root, rel));
  const text = buf.toString('utf8');
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) fail(`中止：${rel} 里疑似有密钥，不能公开推送`);
  }
  files.push({ rel, base64: buf.toString('base64') });
}
console.log(`准备推送 ${files.length} 个文件（不含 .env / data / certs）`);

/* ---------- 3. 仓库：已存在就直接用，不存在才创建 ---------- */
// 先探测：用「只授权 wordlock 一个仓库、只有 Contents 读写」的细粒度令牌时，
// 没有「建仓库」权限，所以不能一上来就调建仓库接口。
const probe = await api(repoPath);
if (probe.status === 200) {
  console.log(`仓库 ${owner}/${repoName} 已存在，直接往里推`);
} else if (probe.status === 404) {
  const created = await api('/user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name: repoName,
      description: '给小学生用的英语查词器：设了门槛的字典（输入 N 次 + 跟读评测通过 M 次才给看释义）',
      private: false,
      has_issues: false,
      has_wiki: false,
      has_projects: false,
      auto_init: false,
    }),
  });
  if (created.status === 201) console.log(`已创建公开仓库：${created.data.full_name}`);
  else fail(`建仓库失败（HTTP ${created.status}）：${JSON.stringify(created.data).slice(0, 300)}`);
} else {
  fail(`读取仓库失败（HTTP ${probe.status}）：${JSON.stringify(probe.data).slice(0, 300)}`);
}

// GitHub 的坑：完全空的仓库不允许创建 blob（409 Git Repository is empty），
// 所以先用 Contents API 放一个占位文件，让仓库有第一个提交。
let baseCommit;
const head = await api(`${repoPath}/git/ref/heads/main`);
if (head.status === 200 && head.data.object?.sha) {
  baseCommit = head.data.object.sha;
  console.log('仓库已有提交，基于它继续');
} else {
  const init = await api(`${repoPath}/contents/README.md`, {
    method: 'PUT',
    body: JSON.stringify({
      message: '初始化仓库',
      content: Buffer.from(`# ${repoName}\n\n（正在上传源代码…）\n`).toString('base64'),
    }),
  });
  if (init.status !== 201) fail(`初始化仓库失败（HTTP ${init.status}）：${JSON.stringify(init.data).slice(0, 300)}`);
  baseCommit = init.data.commit.sha;
  console.log('已初始化仓库（占位提交）');
}

/* ---------- 4. 上传文件 ---------- */
async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
    process.stdout.write(`\r  已上传 ${Math.min(i + size, items.length)}/${items.length}`);
  }
  process.stdout.write('\n');
  return out;
}

const blobs = await inBatches(files, 6, async ({ rel, base64 }) => {
  const res = await api(`${repoPath}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: base64, encoding: 'base64' }),
  });
  if (!res.data.sha) throw new Error(`上传 ${rel} 失败：${JSON.stringify(res.data).slice(0, 200)}`);
  return { path: rel, mode: '100644', type: 'blob', sha: res.data.sha };
});

/* ---------- 5. 一次提交完成 ---------- */
const tree = await api(`${repoPath}/git/trees`, { method: 'POST', body: JSON.stringify({ tree: blobs }) });
if (!tree.data.sha) fail(`建目录树失败：${JSON.stringify(tree.data).slice(0, 300)}`);

const commit = await api(`${repoPath}/git/commits`, {
  method: 'POST',
  body: JSON.stringify({
    message:
      'WordLock 查词器：阶段 1～6 完整实现\n\n' +
      '设了门槛的字典：输入 N 次 + 跟读评测通过 M 次才显示释义。\n' +
      '含中英文查词、讯飞发音评测、生词本与复习、家长模式、快速查看、收藏册与花园主题。\n' +
      '102 个测试（单元 + 进程内集成）。详见 README.md / AGENTS.md。',
    tree: tree.data.sha,
    parents: [baseCommit],
  }),
});
if (!commit.data.sha) fail(`建提交失败：${JSON.stringify(commit.data).slice(0, 300)}`);

const ref = await api(`${repoPath}/git/refs/heads/main`, {
  method: 'PATCH',
  body: JSON.stringify({ sha: commit.data.sha, force: false }),
});
if (ref.status !== 200) fail(`更新分支失败（HTTP ${ref.status}）：${JSON.stringify(ref.data).slice(0, 300)}`);

console.log('\n完成 ✅');
console.log(`仓库地址：https://github.com/${owner}/${repoName}`);
