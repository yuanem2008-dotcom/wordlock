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
| `server/sessions.js` | 单次查词流程的进度 + **唯一允许改门禁状态的函数**（创建会话、记输入/跟读、求助、快速查看） |
| `server/routes/session.js` | **服务端验证输入阶段**：`POST /api/session` 绑定目标词、`POST /api/typing` 自己比对并数够 N 次 |
| `server/vocab.js` | 生词本、复习调度、本地日期 |
| `server/scoring-policy.js` | 评测结果 → 通过/失败/**不计入失败**的处置策略（纯函数，有测试） |
| `server/scorers/` | 评测器：`mock`（开发）/ `xunfei`（已接通）/ `tencent`（占位） |
| `server/routes/` | `profile` / `events` / `score` / `vocab` / `child` / `parent` / `dict` |
| `public/state-machine.js` | 输入与跟读状态机（纯函数，不依赖 DOM，有测试） |
| `public/app.js` | 界面与流程编排（单文件，较长） |
| `public/tts.js`、`audio-record.js` | 标准读音（男性嗓音优先级）、录音并转 16k/16bit/单声道 WAV |
| `scripts/build-dict.js` | ECDICT → `dict.db`（含中文反查索引 `zh_index`） |
| `tests/` | `node:test` 共 134 个（含 22 个安全回归）；集成测试用 `tests/helpers/dispatch.js` **进程内**调 Express（不监听端口） |

## 不能改坏的硬约束（都是联调/踩坑换来的，改动请连带跑测试）

- **讯飞英文试题格式**：`text` 必须是 `[word]\n单词`（句子题型 `[content]`），直接发裸单词会报 **48195**。
- **讯飞单词原始分是 0~5 制**，必须经 `toHundredScale()` ×20 换算成 0~100（官方 FAQ 对照表：4.3~5 分 = 86~100 分）。不换算则通过线 60 永远达不到。
- **`is_rejected=true` 的含义是"乱读/读的不是这个词"（算一次失败）**；真正"没声音"是 `except_info=28673`；`28680/28709/28690` 是环境噪声/截幅（不计入失败）。混淆会导致"乱念也不扣分、门槛失效"。
- **WAV 取 PCM 必须按 RIFF 块解析**（`extractPcm`），不能写死跳过 44 字节。
- **前端禁止 `window.confirm/alert/prompt`**：内嵌浏览器与 iPad 会屏蔽系统弹窗（confirm 直接返回 false，操作静默失败）。用应用内的 `askConfirm()` / `toast()`。
- **`public/tts.js` 不能取 `voices[0]`**：macOS 上那是机器人音 Albert，要按候选列表挑饱满男声。
- **词的校验/归一化只有一个来源**：`server/word-rules.js`（客户端 `public/state-machine.js` 有等价实现，改一处必须同步另一处）。
  允许字母与**词间的空格**/连字符/撇号 —— 因为词典里有 `nice day` 这类短语，而**应用给出的候选必须能被孩子输入**
  （曾出现「候选显示 nice day、输入却永远提示只能输入英文字母」的自相矛盾，用户实测发现）。
- 所有用户数据表都带 `profile_id`，请求带 `X-Profile-Id` 头。

### 门槛不可绕过（这九条是核心不变量，改动务必跑安全回归测试）

1. **「输入 N 次」由服务端判定，且从 0 开始数**：`POST /api/session` 只负责绑定目标词
   （服务端自己查词典确认存在），**不给任何次数**；只有 `POST /api/typing` 里服务端比对通过才算一次。
   需求 2.1 的"第 1 次输入算 1/N"由前端把刚输入的字符串再交给 `/api/typing` 实现，孩子体感不变。
   客户端上报的任何 `count/done/typing_done` 字段一概忽略。
2. **会话绑定目标词且创建后不可改**：同一 `sessionId` 换词必须 403（否则「给容易的词过关 → 改词 → 看释义」）。
3. **释义必须同时满足**：同档案 + 同会话 + `session.word === 请求的词`（归一化后）+ 输入已完成 +
   （跟读达标 或 求助通关 或 快速查看 或 该词已学会）。见 `sessions.js` 的 `sessionUnlocksMeaning()`。
4. **读音同理**：`sessionUnlocksPronunciation()`。
5. **快速查看只免除"跟读"，不免除"输入"**：`/api/quick-peek` 要求 `session.typing_count >= 1`
   （**中英文入口都要求**，否则孩子声明 `mode='zh'` 就能绕过）。它直接返回释义、不走 `/api/meaning`，
   所以这条判断必须写在它自己里面。
6. **`/api/events` 只记录、绝不授权**：它接收前端上报，所以不能改变任何放行状态；
   只接受不涉及放行的类型（`lookup_start` / `not_found` / `cancel` / `network_error`）。
7. **求助通关由服务端判定**：`POST /api/help` 内部查 `learn_sessions.read_fail >= helpAfterFails`，否则 403。
8. **校准分数线只由服务端算**：`/api/calibration/start` 清样本、`/api/score` 带 `calibration:true` 时
   由服务端把分数写进 `calibration_samples`、`/api/calibration/finish` 由服务端算平均分
   （有效样本 < 2 个则保留原分数线）。客户端提交的任何分数一律忽略。
9. **同一段录音重复提交不重复计数**：产品的 M 次是"读 M 遍"，不是"同一遍提交 M 次"。
   `/api/score` 用音频指纹拦重复回放，返回 `duplicate_audio`（提示重念、不计入失败）。
   这里有两个**很容易写错、请勿改回去**的点：
   - 判重必须对**通过和失败都生效**。只在通过时判是不够的：回放一段"没通过"的录音
     可以刷够 `read_fail`，白拿"求助通关"（那是直接解锁释义）。
   - 指纹记满之后必须**先进先出地丢最早的**，不能 `clear()` 全清。全清等于
     "交够若干段不同录音，最早那段就被忘掉、可以再重放一次"。
   内存两层上限：每会话 64 个指纹、最多 200 个会话；进程重启即清空。

另外：**启动即强检查**——`SCORER=mock` 且没有显式 `WORDLOCK_DEV=1` 时拒绝启动；
选了 `xunfei`/`tencent` 但密钥缺失也拒绝启动（避免静默变成"随便念都能过"）。

## 常用命令

```bash
npm start              # HTTP（电脑上用；本会话沙箱内不能监听端口）
npm run start:https    # HTTPS（iPad 用麦克风时需要，先 npm run certs）
npm test               # 134 个测试（单元 + 进程内集成 + 安全回归）
npm run build-dict     # 由 data/raw 的 ECDICT 重建 data/dict.db（约 35 秒）
npm run try-scorer     # 用 macOS say 合成人声送真实评测，验证密钥与计分是否正常
npm run review-pack    # 重新生成 docs/REVIEW-PACK.md（全量源码快照，供外部 AI 审阅）
npm run security-pack  # 重新生成 docs/SECURITY-REVIEW.md（只含安全相关文件，约 100KB，便于抓取）
npm run push-github    # 用 GitHub API 推送本仓库（github.com 被墙时用，需 .github-token）
```

> **外部 AI 审阅用哪个**：优先 `docs/SECURITY-REVIEW.md`（小、专为安全审阅抽取）。
> `docs/REVIEW-PACK.md` 是全量包（320KB+），外部抓取工具容易在中间被截断——
> 顺序是 server → public → scripts → tests，所以大文件 `scripts/build-dict.js` 之前的内容才读得到。

## 欢迎重点审阅的地方

1. `server/routes/parent.js`：家长 PIN 与令牌机制是否够稳（scrypt 加盐哈希入库；失败 5 次锁定
   且逐次翻倍；首次设置只允许本机；随机会话令牌 30 分钟空闲过期）。
2. `server/routes/score.js` + `server/scoring-policy.js` + `server/routes/session.js`：
   **门槛与计分还有没有漏洞——孩子能不能绕过？**（这是本项目的核心不变量，
   `tests/integration.test.js` 末尾那 22 个"安全 N"用例就是它的看门狗）
3. `public/state-machine.js`：换词重置、中文入口、待巩固流程的边界情况。
4. `server/vocab.js`：复习调度（间隔 [1,2,7,15,30]、求助通关额外一轮、毕业后不再推送）、日期边界。
5. `server/routes/parent.js` 的"每周汇总 / 放弃点判定"（需求 2.10：未到 `meaning_shown` 且 10 分钟无新事件即视为放弃）。
6. 数据量与性能：词典 337 万词条、中文索引 270 万行，`zh_index` 的 `rank/hot` 分档与查询计划。

## 本机部署现状（2026-09-22 实测）

- **服务由 macOS LaunchAgent 托管**（两个 plist 都在 `~/Library/LaunchAgents/`）：
  - `com.wilburread.wordlock`：直接跑 `/opt/homebrew/bin/node …/word-lock/server/index.js`
    （刻意不用 `npm start`，否则 launchd 监管的是 npm 这个壳，KeepAlive 判断会失真）；
    `WorkingDirectory` 必须是应用目录（要从这里读 `.env` 和 `data/`）。
  - `com.wilburread.cloudflared`：跑 `~/.cloudflared/cloudflared tunnel --no-autoupdate run dash-mac`。
  - 两者都是 `RunAtLoad` + `KeepAlive` + `ThrottleInterval 15`，日志在 `~/Library/Logs/`。
  - 重启：`launchctl kickstart -k gui/501/<label>`；查状态：`launchctl print gui/501/<label>`。
- **公网入口**：`https://wordlock.wilburread.com` → 本机 3000。TLS 由 Cloudflare 终止，
  所以本机不需要 HTTPS/证书（`npm run certs` 那套只是局域网备选）。
- ⚠️ **不要再另外跑 `npm start`**：会抢 3000 端口，让 LaunchAgent 反复重启。
- ⚠️ **这台机器会杀掉后台进程**：`cmd &` / `nohup` 起的进程在命令返回后会被清掉；
  要长期存活必须用 `launchctl bootstrap`（进程 `ppid=1`）。所以别指望 `npm start &` 能常驻。
- **`dash.wilburread.com` 不由这台 Mac 服务**：它由账号里另一条隧道（`wilbur`）在 Windows 机器上提供，
  本机 8787 端口没有任何进程在听 → config.yml 里那条 dash ingress 实际是**空转配置**。
  结论：在这台 Mac 上做隧道操作**不会影响 dash**。
- **启动守卫是有意的**：评测配置不合法（如 `SCORER=mock` 却没设 `WORDLOCK_DEV=1`）时应用会拒绝启动并退出。
  遇到它反复重启请看 `~/Library/Logs/wordlock.err.log`，不要去改代码或加环境变量绕过检查。
- **`~/.cloudflared/cert.pem` 里的 API Token 已失效**（`/user/tokens/verify` 报 Invalid，`dns_records` 查询报鉴权错误），
  但 `tunnel list` / `tunnel info` / `tunnel route dns` 仍可用（走隧道凭据）。
  以后要新增域名，DNS 记录可能得去 Cloudflare 面板手动加。

## 背景

- 需求文档 v3（分 7 个阶段）由用户提供，**阶段 1～6 已完成**，阶段 1B（中文查词）也已完成；**阶段 7（例句 / 导入教材词表 / 音节级反馈）未做**，做之前需用户确认。
- 用户不是程序员：改动请保持"最简单最稳"，并同步更新中文 `README.md`。
