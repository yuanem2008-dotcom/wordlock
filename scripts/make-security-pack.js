// 生成「安全审阅包」：只放与「门槛能否被绕过」直接相关的文件，体积小、便于外部 AI 抓取。
//
// 用法：npm run security-pack  →  docs/SECURITY-REVIEW.md
//
// 背景：完整审阅包（docs/REVIEW-PACK.md）有 320KB+，外部 AI 的抓取工具常在读到大文件时被截断，
// 而最关键的服务端路由排在后面。这个包把安全相关文件单独抽出来，保证一次能读完。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.join(root, 'docs', 'SECURITY-REVIEW.md');

// 与「孩子能不能绕过门槛」直接相关的文件，按阅读顺序
const FILES = [
  'server/word-rules.js',
  'server/sessions.js',
  'server/routes/session.js',
  'server/routes/events.js',
  'server/routes/score.js',
  'server/scoring-policy.js',
  'server/routes/vocab.js',
  'server/routes/child.js',
  'server/routes/dict.js',
  'server/settings.js',
  'server/scorers/xunfei.js',
  'server/scorers/mock.js',
  'server/scorers/index.js',
  'server/routes/parent.js',
  'server/app.js',
  'server/db.js',
  'tests/integration.test.js',
];

const SECRET_PATTERNS = [
  /XUNFEI_API_SECRET\s*=\s*[A-Za-z0-9+/=_-]{12,}/,
  /XUNFEI_API_KEY\s*=\s*[A-Za-z0-9+/=_-]{12,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
];

const header = `# WordLock —— 安全审阅包（门槛是否可被绕过）

> 这个包是**专门为重审"孩子能不能绕过门槛"而抽取的**，只含相关文件，体积小、可一次读完。
> （完整源码包是 \`docs/REVIEW-PACK.md\`，320KB+，抓取工具容易在中间被截断。）
>
> 代码快照时间：见仓库最新提交。与具体源码文件冲突时，以源码文件为准。

## 一句话背景

给两个中国孩子（小学五年级、初一）用的英语查词网页应用，核心设计是"设了门槛的字典"：
**孩子必须先手动把单词输入 N 次、再跟读评测通过 M 次，才会看到中文释义。**

## 本次修复要守住的不变量

1. 「输入 N 次」由**服务端**判定，**且从 0 开始数**：\`POST /api/session\` 只绑定目标词
   （服务端查词典确认存在），**不给任何次数**；只有 \`/api/typing\` 里服务端比对通过才算一次。
   需求 2.1 的"第 1 次输入算 1/N"由前端把刚输入的字符串再交给 \`/api/typing\` 实现，孩子体感不变。
   客户端上报的 \`count/done/typing_done\` 一律忽略。
2. 会话**绑定目标词后不可改**（同一 sessionId 换词必须 403）。
3. 释义放行必须同时满足：**同档案 + 同会话 + \`session.word === 请求的词\`（归一化）+ 输入已完成 +
   （跟读达标 或 求助通关 或 快速查看 或 该词已学会）**。读音同理。
   → 实现见 \`server/sessions.js\` 的 \`sessionUnlocksMeaning()\` / \`sessionUnlocksPronunciation()\`
4. **快速查看只免除"跟读"，不免除"输入"**：\`/api/quick-peek\` 要求 \`session.typing_count >= 1\`，
   **中英文入口都要求**（否则声明 \`mode='zh'\` 就能绕过）。它直接返回释义、不走 \`/api/meaning\`，
   所以这条判断必须写在它自己里面。
5. **词的校验与归一化只有一个来源**：\`server/word-rules.js\`（客户端 \`public/state-machine.js\` 有等价实现，改一处要同步另一处）。
   允许字母与词间的空格/连字符/撇号（词典里有 \`nice day\` 这类短语）——**应用给出的候选必须能被孩子输入**，
   否则会出现「候选里显示 nice day、但输入时永远提示只能输入英文字母」这种自相矛盾。
6. \`/api/events\` **只记录、绝不授权**（它接收前端上报，不得改变任何放行状态）。
7. 求助通关由服务端判定：\`POST /api/help\` 内部查 \`learn_sessions.read_fail >= helpAfterFails\`。
8. 校准分数线只由服务端算：客户端提交的任何分数一律忽略；有效样本 < 2 个则保留原分数线。
9. **同一段录音重复提交不重复计数**（\`/api/score\` 的音频指纹），返回 \`duplicate_audio\`。
   注意两个易错点：判重对**通过和失败都生效**（否则回放失败的录音可刷够 read_fail 白拿求助通关）；
   指纹记满是**先进先出丢最早的**，不是 clear() 全清（否则交够若干段就能重放最早那段）。
10. 启动强检查：\`SCORER=mock\` 且没有 \`WORDLOCK_DEV=1\` → 拒绝启动；密钥缺失 → 拒绝启动
   （检查在 \`boot()\` 里，任何入口点都绕不过去）。

> ⚠️ 注意：\`server/sessions.js\`（状态层，提供状态函数）与 \`server/routes/session.js\`
> （HTTP 路由，暴露 \`/api/session\`、\`/api/typing\`）是**两个不同的文件**。

## 请这样审

\`\`\`
请只针对这一个问题给结论：**孩子能不能绕过"输入 N 次 + 跟读 M 次"看到释义？**
（包括：伪造请求、改会话绑定的词、跨词、跨档案、伪造事件、伪造校准分数、伪造求助、跳过输入直接评分）

要求：
1. 每条结论都必须指向具体文件与代码片段（带行号或函数名），并说明"在什么请求序列下会成功"。
2. 如果某处你无法从这段代码判断，请明确说"需要看 X 文件"，不要猜。
3. 同时指出：这次修复有没有**误伤正常流程**（孩子正常查词会不会被拒）。
4. 最后单列一节"仍然存在的绕过路径"（如果有），并给出建议改法。
\`\`\`

## 顺便回答上一轮的一个疑问

\`server/routes/session.js\` 与 \`server/sessions.js\` **不是同一个文件**：
前者是 HTTP 路由（\`POST /api/session\`、\`POST /api/typing\`），后者是与传输无关的状态层
（建会话、记输入/跟读、求助、快速查看，以及"这个会话能否放行释义/读音"的判定）。
这样分层是为了：路由只管收请求，状态改动只能走这几个明确函数。

## 测试

仓库共 134 个测试（其中 22 个标着「安全 N」）；其中 \`tests/integration.test.js\` 末尾有一组标着「安全 N」的回归用例，
每一条都对应一个曾经**真实存在且已实测复现**的绕过路径。
`;

const parts = [];
let totalBytes = 0;
for (const rel of FILES) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) {
    console.warn(`跳过（文件不存在）：${rel}`);
    continue;
  }
  const text = fs.readFileSync(full, 'utf8');
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      console.error(`发现疑似密钥，已中止：${rel}`);
      process.exit(1);
    }
  }
  totalBytes += Buffer.byteLength(text);
  parts.push(`\n\n---\n\n## 📄 ${rel}\n\n\`\`\`\`js\n${text.replace(/\n+$/, '')}\n\`\`\`\`\n`);
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, header + parts.join(''), 'utf8');
console.log(`已生成 ${path.relative(root, outFile)}`);
console.log(`  包含 ${parts.length} 个文件，源码约 ${Math.round(totalBytes / 1024)} KB`);
console.log(`  文件总大小约 ${Math.round(fs.statSync(outFile).size / 1024)} KB`);
