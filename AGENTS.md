# AGENTS.md — WordLock 查词器

> 给 AI 协作者（Codex / Claude 等）的说明。**人类用户请看 `README.md`**（中文，写清了安装、启动、iPad 使用方法）。

## 这是什么

给两个中国孩子（小学五年级、初一）用的英语查词网页应用。核心设计是一句可以当验收标准的话：

> **这是一本「设了门槛的字典」。**

孩子必须先把单词**手动输入 N 次**，再**跟读评测通过 M 次**，才会看到中文释义。目的不是查词效率，而是让每次查词都变成一次学习动作（普通词典 App 会让孩子顺手跑去刷视频）。

技术栈刻意保持极简：Node + Express + better-sqlite3 + **原生 HTML/CSS/ES modules**，无框架、无构建工具、无外部 CDN。

## 审阅时请优先守住这些价值观（来自需求文档 v3）

1. **孩子不能因为门槛太难而放弃**，宁可比需求松一点。取舍时以"孩子会不会想放弃"为准。
2. **提示语必须鼓励式**：代码与界面里**不得出现「错误 / 失败 / 错了」字样，不得出现红色叉号**。用"差一点""再看看""再试一次"。
3. **不做上瘾设计**：无随机奖励、无推送提醒、无"断签清零"惩罚。
4. 界面极简、大字大按钮、全中文；**不得有任何外部链接、广告、视频或跳转**。
5. **密钥只能放在服务器端 `.env`**，绝不能出现在前端代码或浏览器请求里（`.env` 与 `certs/` 均已在 `.gitignore`）。
6. 第三方接口（发音评测）的参数必须以**官方最新文档**为准，不能凭记忆写。

## 架构（按阅读顺序）

| 文件 | 职责 |
|---|---|
| `server/index.js` | 启动：HTTP 或 HTTPS、打印电脑与 iPad 的访问地址 |
| `server/app.js` | 路由装配（集成测试也从这里起 app）、启动时打印评测实现与配置状态 |
| `server/db.js` | 两个库：`data/dict.db`（词典，只读）、`data/user.db`（档案/事件/生词本/会话） |
| `server/settings.js` | 档案参数合并 + `effectiveLevel` 门槛档位（纯函数，有测试） |
| `server/sessions.js` | 单次查词流程的进度 —— **读音/释义接口的 403 门禁依据** |
| `server/vocab.js` | 生词本、复习调度、本地日期 |
| `server/scoring-policy.js` | 评测结果 → 通过/失败/**不计入失败**的处置策略（纯函数，有测试） |
| `server/scorers/` | 评测器：`mock`（开发）/ `xunfei`（已接通）/ `tencent`（占位） |
| `server/routes/` | `profile` / `events` / `score` / `vocab` / `child` / `parent` / `dict` |
| `public/state-machine.js` | 输入与跟读状态机（纯函数，不依赖 DOM，有测试） |
| `public/app.js` | 界面与流程编排（单文件，较长） |
| `public/tts.js`、`audio-record.js` | 标准读音（男性嗓音优先级）、录音并转 16k/16bit/单声道 WAV |
| `scripts/build-dict.js` | ECDICT → `dict.db`（含中文反查索引 `zh_index`） |
| `tests/` | `node:test` 共 102 个；集成测试用 `tests/helpers/dispatch.js` **进程内**调 Express（不监听端口） |

## 不能改坏的硬约束（都是联调/踩坑换来的，改动请连带跑测试）

- **讯飞英文试题格式**：`text` 必须是 `[word]\n单词`（句子题型 `[content]`），直接发裸单词会报 **48195**。
- **讯飞单词原始分是 0~5 制**，必须经 `toHundredScale()` ×20 换算成 0~100（官方 FAQ 对照表：4.3~5 分 = 86~100 分）。不换算则通过线 60 永远达不到。
- **`is_rejected=true` 的含义是"乱读/读的不是这个词"（算一次失败）**；真正"没声音"是 `except_info=28673`；`28680/28709/28690` 是环境噪声/截幅（不计入失败）。混淆会导致"乱念也不扣分、门槛失效"。
- **WAV 取 PCM 必须按 RIFF 块解析**（`extractPcm`），不能写死跳过 44 字节。
- **前端禁止 `window.confirm/alert/prompt`**：内嵌浏览器与 iPad 会屏蔽系统弹窗（confirm 直接返回 false，操作静默失败）。用应用内的 `askConfirm()` / `toast()`。
- **`public/tts.js` 不能取 `voices[0]`**：macOS 上那是机器人音 Albert，要按候选列表挑饱满男声。
- 所有用户数据表都带 `profile_id`，请求带 `X-Profile-Id` 头。
- **读音与释义接口有服务器端校验**（未完成输入/跟读 → 403），不要为了"方便"去掉门禁。

## 常用命令

```bash
npm start              # HTTP（电脑上用；本会话沙箱内不能监听端口）
npm run start:https    # HTTPS（iPad 用麦克风时需要，先 npm run certs）
npm test               # 102 个测试（单元 + 进程内集成）
npm run build-dict     # 由 data/raw 的 ECDICT 重建 data/dict.db（约 35 秒）
npm run try-scorer     # 用 macOS say 合成人声送真实评测，验证密钥与计分是否正常
npm run review-pack    # 重新生成 docs/REVIEW-PACK.md（单文件源码快照，供外部 AI 审阅）
npm run push-github    # 用 GitHub API 推送本仓库（github.com 被墙时用，需 .github-token）
```

> **只读一个文件就能拿到全部源码**：`docs/REVIEW-PACK.md`（自包含快照，含背景说明与
> 全部源码）。抓取 GitHub 目录页失败时，直接读这个文件即可，不必逐个找源文件。

## 欢迎重点审阅的地方

1. `server/routes/parent.js`：家长 PIN 与令牌机制是否够稳（当前是进程内 HMAC，服务重启即失效）。
2. `server/routes/score.js` + `server/scoring-policy.js`：**计分与"不计入失败"的规则有没有漏洞——孩子能不能绕过门槛？**（这是本项目的核心不变量）
3. `public/state-machine.js`：换词重置、中文入口、待巩固流程的边界情况。
4. `server/vocab.js`：复习调度（间隔 [1,2,7]、求助通关额外一轮、毕业后不再推送）、日期边界。
5. `server/routes/parent.js` 的"每周汇总 / 放弃点判定"（需求 2.10：未到 `meaning_shown` 且 10 分钟无新事件即视为放弃）。
6. 数据量与性能：词典 337 万词条、中文索引 270 万行，`zh_index` 的 `rank/hot` 分档与查询计划。

## 背景

- 需求文档 v3（分 7 个阶段）由用户提供，**阶段 1～6 已完成**，阶段 1B（中文查词）也已完成；**阶段 7（例句 / 导入教材词表 / 音节级反馈）未做**，做之前需用户确认。
- 用户不是程序员：改动请保持"最简单最稳"，并同步更新中文 `README.md`。
