// 生成「审阅包」：把项目源码合成一个 Markdown 文件，方便上传给线上 AI（Claude / ChatGPT）审阅。
//
// 用法：
//   npm run review-pack            # 核心文件（不含 57KB 的 public/app.js）
//   npm run review-pack -- --full  # 全量（含 app.js）
//
// 安全：只读取下面列出的目录/扩展名；.env、certs/、data/ 一律不读；
// 生成后还会再扫一遍，若出现疑似密钥就报警并退出。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const full = process.argv.includes('--full');
const outFile = path.join(root, 'REVIEW-PACK.md');

const INCLUDE_DIRS = ['server', 'public', 'scripts', 'tests'];
const INCLUDE_FILES = ['README.md', 'AGENTS.md', 'package.json'];
const SKIP_FILES = full ? [] : ['public/app.js', 'tests/integration.test.js'];
const CODE_EXT = new Set(['.js', '.json', '.html', '.css', '.md']);

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'data', 'certs', '.claude'].includes(entry.name)) continue;
      walk(rel, acc);
    } else if (CODE_EXT.has(path.extname(entry.name))) {
      acc.push(rel);
    }
  }
  return acc;
}

let files = [];
for (const dir of INCLUDE_DIRS) {
  if (fs.existsSync(path.join(root, dir))) files.push(...walk(dir));
}
files.push(...INCLUDE_FILES.filter((f) => fs.existsSync(path.join(root, f))));
files = files.filter((f) => !SKIP_FILES.includes(f)).sort();

// 二次保险：绝不把密钥/证书打进包里。
// 只认"真正像密钥的长串"，这样 README 里的 XUNFEI_API_KEY=... 这种占位符不会误报。
const SECRET_PATTERNS = [
  /XUNFEI_API_SECRET\s*=\s*[A-Za-z0-9+/=_-]{12,}/,
  /XUNFEI_API_KEY\s*=\s*[A-Za-z0-9+/=_-]{12,}/,
  /TENCENT_SECRET_KEY\s*=\s*[A-Za-z0-9+/=_-]{12,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

const parts = [];
let totalBytes = 0;
for (const rel of files) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      console.error(`发现疑似密钥，已中止：${rel}\n（审阅包绝不能包含密钥）`);
      process.exit(1);
    }
  }
  totalBytes += Buffer.byteLength(text);
  const lang = { '.js': 'js', '.json': 'json', '.html': 'html', '.css': 'css', '.md': 'markdown' }[path.extname(rel)] ?? '';
  parts.push(`\n\n---\n\n## 📄 ${rel}\n\n\`\`\`\`${lang}\n${text.replace(/\n+$/, '')}\n\`\`\`\`\n`);
}

const header = `# WordLock 查词器 —— 代码审阅包

> 这是一份可以**直接上传给 AI 助手（Claude / ChatGPT / Gemini）**的单个文件。
> 上半部分是背景与审阅要求，下半部分是全部源码。请把它当作一次"代码评审"来做。

## 你可以这样对 AI 说

\`\`\`
请阅读这份代码审阅包，扮演一位严格的资深工程师，给我一份可以直接执行的评审报告。

背景：这是一个给两个中国孩子（小学五年级、初一）用的英语查词网页应用。
它的核心设计是"设了门槛的字典"：孩子必须先把单词手动输入 N 次、再跟读评测通过 M 次，
才能看到中文释义。目的是让每次查词都变成一次学习动作。

我最担心的是：**孩子能不能绕过这个门槛？**（这是本项目的核心不变量）

请按下面要求输出：
1. 按严重程度从高到低排序的问题列表（严重：能被绕过 / 数据出错 / 崩溃；中等：逻辑漏洞 / 体验问题；轻微：可简化 / 可读性）
2. 每条给出：文件名与位置、问题是什么、为什么是问题（具体在什么情况下会出错）、建议怎么改（给代码或思路）
3. 单列一节"我认为这个设计本身有问题的地方"——欢迎质疑需求，不要只顺着说
4. 明确不要重写整个项目，聚焦具体改动

注意：这些文件我都不知道"标准答案"，请直接指出你判断有问题的地方；
如果某处你不确定，请说明需要什么额外信息，不要猜测。
\`\`\`

## 项目背景（供你判断）

- 用户**不是程序员**：方案要"最简单最稳"，改动要小且可验证。
- 已完成的阶段：档案系统、英文查词、中文查词、跟读评测（已接讯飞真实评分）、释义、生词本与复习、家长模式、快速查看、收藏册与主题。
- 未做：例句、导入教材词表、音节级反馈。
- 有一条中文的 \`README.md\`（用户看的）和 \`AGENTS.md\`（AI 看的），都包含在本包里。
- 测试：\`node --test\`，共 102 个（单元 + 进程内 HTTP 集成测试，不需要监听端口）。

## 本包不含什么

- 数据文件（\`data/dict.db\` 675MB 的 ECDICT 词典、\`data/user.db\` 用户数据）
- 密钥与证书（\`.env\`、\`certs/\`）—— **本包内不含任何密钥**
- ${full ? '（本次为全量模式，包含所有源码）' : '为控制体积，本次**未包含** `public/app.js`（界面编排，约 57KB）和 `tests/integration.test.js`（集成测试全文）。如需完整版请让作者运行 `npm run review-pack -- --full`。'}
`;

fs.writeFileSync(outFile, header + parts.join(''), 'utf8');
console.log(`已生成 ${path.relative(root, outFile)}`);
console.log(`  包含 ${files.length} 个文件，源码约 ${Math.round(totalBytes / 1024)} KB`);
console.log(`  文件总大小约 ${Math.round(fs.statSync(outFile).size / 1024)} KB`);
if (!full) console.log('  提示：加 --full 可以把 public/app.js 和集成测试也打进去');
