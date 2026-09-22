# WordLock 查词器 —— 代码审阅包

> 这是一份可以**直接上传给 AI 助手，或在仓库里直接读这一个文件**的自包含快照。
> 上半部分是背景与审阅要求，下半部分是全部源码。请把它当作一次"代码评审"来做。
>
> ⚠️ 这是**某一时刻的快照**：判断问题时请以它为准，但若与仓库其它文件冲突，以具体源码文件为准。

## 你可以这样对 AI 说

```
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
```

## 项目背景（供你判断）

- 用户**不是程序员**：方案要"最简单最稳"，改动要小且可验证。
- 已完成的阶段：档案系统、英文查词、中文查词、跟读评测（已接讯飞真实评分）、释义、生词本与复习、家长模式、快速查看、收藏册与主题。
- 未做：例句、导入教材词表、音节级反馈。
- 有一条中文的 `README.md`（用户看的）和 `AGENTS.md`（AI 看的），都包含在本包里。
- 测试：`node --test`，共 102 个（单元 + 进程内 HTTP 集成测试，不需要监听端口）。

## 本包不含什么

- 数据文件（`data/dict.db` 675MB 的 ECDICT 词典、`data/user.db` 用户数据）
- 密钥与证书（`.env`、`certs/`）—— **本包内不含任何密钥**
- （本次为全量模式，包含所有源码）


---

## 📄 AGENTS.md

````markdown
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
| `tests/` | `node:test` 共 132 个（含 22 个安全回归）；集成测试用 `tests/helpers/dispatch.js` **进程内**调 Express（不监听端口） |

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
npm test               # 132 个测试（单元 + 进程内集成 + 安全回归）
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
4. `server/vocab.js`：复习调度（间隔 [1,2,7]、求助通关额外一轮、毕业后不再推送）、日期边界。
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
````


---

## 📄 README.md

````markdown
# WordLock 查词器（阶段 1 ～ 6 已完成）

给两个孩子用的英语查词工具：**只能查词，不能干别的**。每次查词都要"输入 N 次 + 跟读通过"才能看到释义，让每次查词都变成一次学习。

> 跟读评分已接入**讯飞语音评测**（真实打分）；模拟打分仅作开发调试用。

---

## 一、安装与启动

1. 需要 Node.js 20 或更高（终端里 `node -v` 查看）。
2. 安装依赖（只需要一次）：

```bash
cd ~/Desktop/word-lock && npm install
```

> 如果提示 better-sqlite3 需要批准（npm 11+），执行：
> `npm install-scripts approve better-sqlite3 && npm rebuild better-sqlite3`

3. 词典已经装好了（ECDICT 1.0.28 完整版：**337 万个词条**、中文反查索引 270 万条，`data/dict.db` 约 675 MB）。
   原始词典文件在 `data/raw/stardict.db`（851 MB），下载包 `data/raw/ecdict-sqlite-28.zip`（216 MB）确认无误后可以删掉。

   **什么时候要重新构建**：换了词典文件、或者改了 `scripts/build-dict.js` 之后。

```bash
cd ~/Desktop/word-lock && npm run build-dict
```

   构建约 35 秒（本机实测），脚本按表头/列名自动识别，不用改代码。

   想自己重新下载：到 https://github.com/skywind3000/ECDICT 的 **Releases** 下 `ecdict-sqlite-28.zip` 或任意 `.csv`，解压后放进 `data/raw/` 再运行上面的命令（`.csv` 和 `.db` 都支持）。

4. 每天启动：

```bash
cd ~/Desktop/word-lock && npm start
```

浏览器打开 **http://localhost:3000**。想换端口：`PORT=3001 npm start`。

5. 跑测试：`npm test`（共 132 个测试：单元测试 + 接口集成测试，含 22 个"门槛不可绕过"的安全回归）。

## 二、功能总览（按使用场景）

### 查词
- **两个入口**：主界面输入框输入英文单词；或直接输入中文（如"苹果"）→ 从候选列表里点选英文词。
- **门槛**：查任何新词都要先照着书输入 N 次；然后跟读，评测通过 M 次（默认累计制，可改成连续制）。N 和 M 由门槛档位决定（1→1 次、2→2 次、3→3 次），每累计 5 个"有查词记录的日子"自动升一档，最高 3 档。
- **支持短语**：词典里的 `nice day`、`have a look` 这类带空格的短语也能查、能输入（大小写和多余空格都会自动忽略）。
- **提示不泄题**：输错只说"字母个数不对，再数一数"或"第 X 个字母再看看"；跟读不过会说"差一点，先听一遍标准读音，再试一次"。全程没有"错误/失败"字眼。
- **相近词**：连续 2 次输入词典里没有的词，会给出最多 3 个相近词（编辑距离 ≤ 2，常用词优先），点一下就能选用。
- **首次校准**：每个档案第一次跟读前，先读 3 个简单词（apple、book、water）试试音，自动定一个适合孩子的通过分数线（也可跳过）。可以在家长模式重置。
- **星级反馈**：每次跟读后显示 1～3 颗星（不影响通过判定，只是鼓励）。
- **求助通关**：累计读不过 4 次后出现"求助通关"按钮，用了就直接看释义，但这个词以后会重点复习（多安排一轮）。
- **快速查看**（默认关闭）：家长打开后，孩子急用时可以"先快速看一眼"释义（每天限次数）。**要先把这个词真实输入过一遍**（只免除"跟读"这一步，不免除输入），这个词第二天进入"待巩固"，要完整过一遍门槛才算学会。
- **已学会的词免门槛**：学过的词再查，直接看释义和听读音，并显示"这个词你 X 天前学过啦"。

### 复习
- 通关的词进**生词本**，按第 1、2、7 天的间隔安排复习（求助通关的词多一轮）；每天最多推送设定数量的词（默认 3 或 5）。
- 复习题是"看中文释义 → 输入英文"，答对进入下一间隔，答错显示正确答案、退回上一阶段、第二天再考。复习毕业的词不再推送。**没有任何断签清零。**
- 主界面上方显示"今天有 N 个词要复习""待巩固 N 个"，都不强制。

### 激励（阶段 6）
- **收藏册**：每个学会的词生成一张单词卡（单词、音标、释义、学会日期、最好成绩星级），可翻看。
- **学习天数**：显示"本周学习了 N 天""累计学习了 N 天"，只增不减。
- **主题**：孩子自己点右上角 🎨 选「简洁」或「花园」。花园主题里每学会一个词长出一株植物（内联网页图形，无外部图片）；复习答对时植物会发光。默认简洁主题。
- **今天完成啦**：当天的复习做完后会出现一个提示休息的结束画面。
- **家庭花园**（默认关闭）：家长模式里打开后，可以看两个档案加起来的植物总数，**只显示总数，不做任何排名**。

### 家长模式

**怎么进**：**点屏幕右下角的「家长」按钮**（任何页面都能看到）→ 输入 4–6 位数字密码（第一次会让你设置）。密码只存加盐哈希，忘了可以让我帮你重置。

**怎么退出**：家长面板最下面「退出家长模式」。退出后再想进去，**再点一次「家长」按钮 + 重新输密码**（不输密码进不去）。

**编辑 / 删除学生**：
1. 点右下角「**家长**」→ 输密码 → 「**档案**」标签页
2. 点要改的那个孩子 → 下面会出现表单（**改名字**、换头像、换预设）
3. 改完点「**保存**」，右下角会提示“已保存，立即生效”
4. 要删除就点左边的「**删除档案**」→ 会**弹两次确认**（第一次说明删什么，第二次问“确定吗”）→ 点「确认删除」

- **档案**：新建、改名、换头像、换预设、删除（删除需两次确认，会清掉该档案全部数据）。
- **设置**：改门槛起点、自动升档、分数线、求助次数、释义行数、每日复习数、口音（美音/英音）、每日查词上限、跟读计数方式（累计/连续）、音效、快速查看次数、**标准读音的嗓音**等，保存后立即生效，只影响选中的档案。
  - 嗓音默认「自动（饱满男声优先）」：美音优先用 Reed，英音优先用 Daniel（都比系统默认那个机械音自然得多）；也可以在下拉框里指定这台电脑上的任意英文嗓音。
- **记录**：按档案和日期筛选查词记录。
- **汇总**（近 7 天）：查了几个词、学会几个、求助几个；卡得最久的 5 个词；复习正确率；**放弃点统计**（孩子在输入/候选/跟读哪一步最容易放弃，自动给一句话结论）。
- **其他**：生词本和查词记录一键导出 CSV（Excel 打开中文不乱码）；家庭花园开关。
- **每日查词上限**：达到后孩子会看到"今天的词已经查够啦，明天再来"，复习不受影响。

### 服务器端校验（防绕过）
- 读音接口要求"该词输入已完成"，释义接口要求"跟读完成 / 求助通关 / 快速看过 / 已学会"，否则一律拒绝——绕过界面直接请求也拿不到内容。

## 三、发音评测（讯飞）

孩子跟读的分数由**讯飞语音评测（ISE）**给出。密钥只放在服务器的 `.env` 里，前端代码和浏览器请求里都看不到。

### 已经配好了吗

`.env` 里这些项齐了就是配好了：

```
SCORER=xunfei
XUNFEI_APP_ID=...
XUNFEI_API_KEY=...
XUNFEI_API_SECRET=...
```

启动时会打印一行状态，例如 `评测：xunfei（已配置）`。改完 `.env` 要**重启服务器**才生效。

### 怎么验证

```bash
cd ~/Desktop/word-lock && npm run try-scorer
```

它会用电脑自带语音念几个单词送给讯飞：**念对的应该拿高分，故意用别的词冒充（banana 当成 apple）应该明显低分**。这是最快的"密钥通不通"检查。然后就打开页面，让孩子对着麦克风念一个真词试试。

### 密钥从哪来

讯飞开放平台控制台 → **在服务列表里找「语音评测」**（注意：不是「星火大模型」，两者密钥不通用）→ 开通（有免费额度）→ 应用详情里能看到 **APPID / APIKey / APISecret** 三个值。

### 可选参数

| 变量 | 作用 | 默认 |
|---|---|---|
| `XUNFEI_GROUP` | 评分参照人群：`pupil`（小学生）/ `youth` / `adult` | `pupil` |
| `XUNFEI_CHECK_TYPE` | 严格度：`easy` / `common` / `hard` | `easy` |
| `XUNFEI_DEBUG=1` | 把和讯飞来回的报文打到服务器日志，排查用 | 关 |

### 分数是怎么算的（重要）

讯飞单词评测返回的是 **0~5 分制**，官方 FAQ 给了对照表：`4.3~5 分 = 86~100 分（优）`、`3.5~4.2 = 70~85（良）`、`2.5~3.4 = 50~69（中）`。
本应用统一用 **0~100**（通过线 60/70 也是按这个定的），所以代码里会 ×20 换算——见 `server/scorers/xunfei.js` 的 `toHundredScale()`。

孩子**只会看到星星，不会看到具体分数**。

### 什么情况算"没读好"，什么情况不算

| 情况 | 怎么处理 |
|---|---|
| 读得够好 | 通过，进度点亮 |
| 分数不够 | 算一次失败（累计制下不会清零已通过次数） |
| **读的是别的词**（讯飞判为乱读，`is_rejected=true`） | 算一次失败，分数按 0 记 |
| 没念／声音太小（`except_info=28673`） | **不算失败**，提示"没听清，靠近一点再念一遍" |
| 环境太吵／录音爆了（`28680/28709/28690`） | **不算失败**，提示"周围有点吵，换个安静的地方再试一次"；但如果这一遍其实读得不错，照样判通过（不让孩子白念） |
| 网络／密钥等故障 | **不算失败**，提示"评测没成功，再试一次"，技术细节只写进服务器日志 |

### 出问题怎么看

| 现象 | 原因 |
|---|---|
| 提示"评测没成功"，日志里 `11200` / `10313` | APPID 和密钥不匹配，检查 `.env` 三个值 |
| 日志里 `48195` | 试题格式不对。英文评测的文本必须写成 `[word]` 换行再跟单词——本项目已按官方文档处理，改动相关代码时别删掉这个标记 |
| 日志里 `68675` | 音频格式不是 16kHz/16bit/单声道 |
| 想看到底发生了什么 | 把 `.env` 里 `XUNFEI_DEBUG` 改成 `1` 再重启，服务器日志会打印与讯飞的完整往来和评分 XML |

> 想临时回到模拟打分：把 `.env` 里的 `SCORER` 改成 `mock` 并重启。
> 开发时想不用麦克风测流程：在 `.env` 里加 `WORDLOCK_DEV=1` 并在浏览器地址后加 `?dev=1`（会出现"模拟评分"滑块）。
> **注意**：`WORDLOCK_DEV` 只是让自己调试用的开关；不设它、又用着 `SCORER=mock`，服务器会直接拒绝启动。

## 四、在 iPad / 手机上使用

### 推荐：公网地址（不用装证书，任何有网的地方都能用）

```
https://wordlock.wilburread.com
```

- 手机上用 4G/5G、在外面、在学校都能打开（不要求和电脑同一个 Wi-Fi）
- **不需要装任何证书**（Cloudflare 提供公共可信证书），麦克风直接可用
- iPad 用 Safari 打开 → 分享 → **添加到主屏幕**，就能像 App 一样全屏使用
- 第一次点麦克风会问权限 → 选「允许」

**前提**：服务器就是这台 Mac，所以——

| 要保证 | 说明 |
|---|---|
| 电脑开着、**不睡眠** | 合盖/睡眠 = 网站打不开（建议插电，并在「设置 → 锁定屏幕」里关掉睡眠） |
| 电脑能上网 | 跟读评分要连讯飞；隧道也要往外连 |
| 家里的电和网正常 | 断电断网就都停了 |

### 备用：只在同一个 Wi-Fi 下用（不经过公网）

不想走公网时，也可以用局域网：`npm run certs` 生成证书 → `npm run start:https` 启动 →
iPad 打开终端打印的 `https://电脑IP:3000`。这条路**要先给 iPad 装根证书**：

1. `mkcert -CAROOT` 看目录 → 里面有 `rootCA.pem`
2. 隔空投送到 iPad → 点开 → 设置里「安装」
3. **设置 → 通用 → 关于本机 → 拉到最后「证书信任设置」→ 打开 mkcert 那一项**（不做这步 Safari 会一直提示"不安全"）

> 换了 Wi-Fi 或电脑换了 IP，要重新 `npm run certs`。走隧道那条路就不用管这些。

### 服务平时是怎么跑起来的

已经配好 macOS 的 LaunchAgent（`com.wilburread.wordlock`）：**开机自动启动，崩了自动拉起**，
所以平时你什么都不用做。

```bash
# 看它在不在跑
launchctl print gui/$(id -u)/com.wilburread.wordlock | head -5

# 出问题时看日志
tail -20 ~/Library/Logs/wordlock.out.log    # 正常输出
tail -20 ~/Library/Logs/wordlock.err.log    # 报错看这个

# 重启
launchctl kickstart -k gui/$(id -u)/com.wilburread.wordlock
```

> ⚠️ **不要再另外跑 `npm start`**：会和它抢 3000 端口，导致服务反复重启。
> 要临时手动启动，先 `launchctl bootout gui/$(id -u)/com.wilburread.wordlock`。

### 强烈建议：给 iPad 加一道"系统层防线"

应用内的门槛挡得住"在这个 App 里偷懒"，但挡不住孩子**退出网页去用别的 App 或网站**。
配合 iPad 自带的限制功能，才是完整的方案（全部是系统设置，不用装任何东西）：

1. **只允许访问指定网站**：iPad → 设置 → 屏幕使用时间 →（设一个家长密码）→
   **内容和隐私访问限制** 打开 → **内容访问限制** → **网页内容** → **仅允许的网站** →
   添加 `https://wordlock.wilburread.com`
   （这样 Safari 里就只能打开这一个网站，其它一律黑屏）
2. **锁定在单个 App 里**（更彻底）：设置 → 辅助功能 → **引导式访问** 打开 →
   用的时候打开 WordLock，连按三次顶部按钮（或主屏幕键）启动引导式访问，
   孩子就被锁在这个页面里，退出需要你的密码
3. **预防购买/安装**：屏幕使用时间 → iTunes Store 与 App Store 购买 → 按需限制

> 菜单名称可能随 iOS 版本略有不同，但都在「屏幕使用时间」里。

### 遇到问题怎么办

| 现象 | 原因 / 解决 |
|---|---|
| 公网地址打不开 | ① 电脑睡眠了或关机 ② 家里断网 ③ 隧道挂了（看 `~/.cloudflared/tunnel.log`） |
| 换成局域网也不行 | iPad 和电脑不在同一个 Wi-Fi；或电脑防火墙拦了 node |
| 提示"无法验证服务器身份"（只在使用备用方案时） | iPad 的「证书信任设置」没打开 |
| 麦克风没反应 | Safari 里要先允许麦克风；页面必须是 https（隧道地址本身就是 https） |

> 安全提醒：`.env` 和 `certs/` 都已被 git 忽略，证书和密钥不会进仓库。
> 这个地址是**公开**的：知道网址的人都能打开（应用按需求不设登录，家长 PIN 只保护设置）。
> 不想让它一直开着，就临时 `launchctl bootout` 停掉，或让 Codex 把隧道那条也停掉。

## 五、上线前检查清单（给孩子用之前扫一眼）

- [ ] `.env` 里 **`SCORER=xunfei`**，三个讯飞密钥都填好
- [ ] `.env` 里 **没有 `WORDLOCK_DEV=1`**（那是自己调试用的；留着它 + `SCORER=mock` 会让孩子说什么都过）
- [ ] 启动日志里显示 **`评测：xunfei（已配置）`**，且**没有**黄色的"开发模式"警告
- [ ] 家长 PIN 是你自己设的（第一次要在电脑上设，只有本机能设）
- [ ] iPad 那边做了"屏幕使用时间 → 内容和隐私访问限制"（见上方建议）

> 说明：`SCORER=mock` 又没有 `WORDLOCK_DEV=1` 时，服务器会**直接拒绝启动**，
> 所以"忘了切回真实评分"会变成一个显眼的故障，而不是悄悄放水。

## 六、常见问题

- **查词提示"词典还没建立"** → 第二节第 3 步没做。
- **读音没声音** → 先在页面上点一下任意按钮（浏览器要求第一次声音由点击触发）；检查档案设置里口音。
- **想重置某个孩子的校准/门槛** → 家长模式 → 设置里调整；想清空重来可以删除档案重建。
- **`npm test` 报端口错误** → 集成测试不需要网络和端口；如遇到权限问题换一个终端目录重试。

## 七、许可证与数据

- 词典数据：[ECDICT](https://github.com/skywind3000/ECDICT)，MIT License（`frq`/`bnc` 为语料库词频名次，越小越常用，0 表示无数据）。
- 所有用户数据都存在本机 `data/user.db`，不联网、不上传。

## 八、还没做的（阶段 7，待确认）

- 例句（Tatoeba 开源例句库，先确认许可证）
- 导入教材单词表（每个档案标记"本学期教材词"，复习和候选排序优先）
- 音节级发音反馈（指出哪个音节不准）
- 家长可维护的**屏蔽词表**（337 万词条未做内容过滤；中文反查可能查到不适合小学生的词）
- 隧道迁移到 LaunchAgent 统一管理（`dash-mac` 现在仍由 launchd 临时任务/看门狗之外的方式托管，见 AGENTS.md）

例句（Tatoeba）、导入教材单词表、音节级发音反馈。真实评测商接入也等你拿到密钥后进行。
````


---

## 📄 package.json

````json
{
  "name": "wordlock",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "儿童英语查词器：设了门槛的字典（阶段1）",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "start": "node server/index.js",
    "start:https": "node scripts/start-https.js",
    "test": "node --test tests/",
    "build-dict": "node scripts/build-dict.js",
    "certs": "node scripts/make-certs.js",
    "try-scorer": "node scripts/try-scorer.js",
    "review-pack": "node scripts/make-review-pack.js",
    "security-pack": "node scripts/make-security-pack.js",
    "push-github": "node scripts/push-to-github.js"
  },
  "dependencies": {
    "better-sqlite3": "^12.4.1",
    "express": "^4.21.2"
  },
  "allowScripts": {
    "better-sqlite3@12.11.1": true
  }
}
````


---

## 📄 public/app.js

````js
// WordLock 界面与流程（阶段 1～6）。
// 流程：档案 → 输入 N 次（英文/中文入口）→ 读音 → 跟读 M 次 → 释义 → 生词本/复习。

import {
  createTypingSession,
  createReadingSession,
  MSG_INVALID,
  MSG_LENGTH,
  positionMessage,
} from './state-machine.js?v=20260922b';
import { unlockTTS, speakWord, listEnglishVoices } from './tts.js?v=20260922b';
import { unlockSFX, playStepSound, playSuccessSound, playGentleSound } from './sfx.js?v=20260922b';
import { createRecorder } from './audio-record.js?v=20260922b';

const AVATARS = ['🐱', '🐶', '🦊', '🐼', '🐸', '🦉', '🐳', '🦄'];
const PRESET_CARDS = [
  { key: 'primary', title: '小学高年级', sub: '先从输入 1 次开始，慢慢升级' },
  { key: 'middle', title: '初中', sub: '先从输入 2 次开始，慢慢升级' },
];
const CHEERS = ['真棒！', '就是这样！', '很好，继续！', '稳稳的！', '又近了一步！'];
const CALIBRATION_WORDS = ['apple', 'book', 'water'];
const PLANTS = ['🌸', '🌻', '🍀', '🌷', '🌱', '🌲', '🌿', '🪴'];

const $ = (id) => document.getElementById(id);
const views = [
  'view-profiles', 'view-create', 'view-main', 'view-candidates', 'view-pronunciation',
  'view-reading', 'view-meaning', 'view-review', 'view-vocab', 'view-collection',
  'view-garden', 'view-parent-pin', 'view-parent',
];

const state = {
  profile: null,
  bundle: null,          // { profile, settings, effectiveLevel, typingCount, readingCount }
  session: null,         // 输入状态机
  sessionId: null,
  lookupStarted: false,
  targetWord: null,
  zhQuery: null,
  candidates: [],
  learn: null,           // { word, entryMode, consolidate }
  reading: null,         // 跟读状态机
  recorder: null,
  recording: false,
  calibration: null,     // { words, idx, scores, nextWord }
  review: null,          // { queue, idx }
  pendingQueue: [],
  parentToken: null,
  returnToParent: false,
  cheerIndex: 0,
  celebrationTimer: null,
  doneTimer: null,
};

const isDev = () => new URLSearchParams(location.search).has('dev');

function showView(id) {
  for (const v of views) $(v).hidden = v !== id;
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.profile && !opts.noProfile) headers['X-Profile-Id'] = String(state.profile.id);
  if (opts.session && state.sessionId) headers['X-Session-Id'] = state.sessionId;
  if (opts.parent && state.parentToken) headers['X-Parent-Token'] = state.parentToken;
  delete opts.session;
  delete opts.parent;
  delete opts.noProfile;
  const res = await fetch(path, { headers, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || '出了点小状况，请再试一次');
    err.userMessage = data?.error;
    err.status = res.status;
    throw err;
  }
  return data;
}

function logEvents(events, base = {}) {
  if (!events.length || !state.profile) return;
  const mode = base.mode ?? state.session?.getState().mode ?? 'en';
  api('/api/events', {
    method: 'POST',
    body: JSON.stringify({
      events: events.map((e) => ({
        sessionId: state.sessionId,
        mode,
        step: base.step ?? 'typing',
        ...e,
      })),
    }),
  }).catch(() => {});
}

/* ---------- 档案 ---------- */

async function renderProfileList() {
  const { profiles } = await api('/api/profiles');
  const list = $('profile-list');
  list.textContent = '';
  for (const p of profiles) {
    const btn = document.createElement('button');
    btn.className = 'profile-card';
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.textContent = p.avatar;
    const name = document.createElement('span');
    name.textContent = p.name;
    btn.append(avatar, name);
    btn.addEventListener('click', () => enterProfile(p).catch(showError));
    list.append(btn);
  }
  $('btn-new-profile').textContent = profiles.length ? '新建档案' : '创建第一个档案';
}

async function enterProfile(p) {
  state.profile = p;
  state.bundle = await api('/api/settings');
  applyTheme();
  $('whoami').textContent = `${p.avatar} ${p.name}`;
  showView('view-main');
  newFlow();
  refreshCounts();
  $('input-word').focus();
}

function applyTheme() {
  const theme = state.bundle?.settings?.theme === 'garden' ? 'garden' : 'simple';
  document.body.classList.toggle('theme-garden', theme === 'garden');
  $('chip-garden').hidden = theme !== 'garden';
}

async function refreshCounts() {
  try {
    const [review, pending] = await Promise.all([
      api('/api/review/today').catch(() => ({ words: [] })),
      api('/api/pending').catch(() => ({ words: [] })),
    ]);
    const words = review.words ?? [];
    state.pendingQueue = pending.words ?? [];
    const reviewBtn = $('chip-review');
    reviewBtn.hidden = !words.length;
    reviewBtn.textContent = `今天有 ${words.length} 个词要复习`;
    const pendingBtn = $('chip-pending');
    pendingBtn.hidden = !state.pendingQueue.length;
    pendingBtn.textContent = `待巩固 ${state.pendingQueue.length} 个`;
  } catch {}
}

function newFlow() {
  state.session = createTypingSession({ requiredCount: state.bundle?.typingCount ?? 1 });
  state.sessionId = crypto.randomUUID();
  state.lookupStarted = false;
  state.targetWord = null;
  state.zhQuery = null;
  state.learn = null;
  state.reading = null;
  state.calibration = null;
  $('input-word').value = '';
  $('zh-target-row').hidden = true;
  $('btn-cancel-word').textContent = '换一个词';
  $('btn-quick-peek').hidden = true;
  hideFeedback();
  hideSuggestions();
  renderProgress(0);
}

/* ---------- 创建档案 ---------- */

let pickedAvatar = null;
let pickedPreset = null;

function renderCreateView() {
  pickedAvatar = null;
  pickedPreset = null;
  $('input-name').value = '';
  const av = $('avatar-grid');
  av.textContent = '';
  for (const a of AVATARS) {
    const btn = document.createElement('button');
    btn.className = 'profile-card';
    const span = document.createElement('span');
    span.className = 'avatar';
    span.textContent = a;
    btn.append(span);
    btn.addEventListener('click', () => {
      pickedAvatar = a;
      for (const c of av.children) c.classList.toggle('selected', c === btn);
    });
    av.append(btn);
  }
  const pg = $('preset-grid');
  pg.textContent = '';
  for (const card of PRESET_CARDS) {
    const btn = document.createElement('button');
    btn.className = 'preset-card';
    btn.textContent = card.title;
    const sub = document.createElement('small');
    sub.textContent = card.sub;
    btn.append(sub);
    btn.addEventListener('click', () => {
      pickedPreset = card.key;
      for (const c of pg.children) c.classList.toggle('selected', c === btn);
    });
    pg.append(btn);
  }
}

async function createProfile() {
  const name = $('input-name').value.trim();
  if (!name) return showFeedback('先写上名字吧', false);
  if (!pickedAvatar) return showFeedback('选一个喜欢的头像吧', false);
  if (!pickedPreset) return showFeedback('选一种学习方式吧', false);
  const p = await api('/api/profiles', {
    method: 'POST',
    body: JSON.stringify({ name, avatar: pickedAvatar, preset: pickedPreset }),
  });
  await enterProfile(p);
}

/* ---------- 输入阶段（英文 + 中文分流） ---------- */

function renderProgress(completed) {
  const n = state.bundle?.typingCount ?? 1;
  const dots = $('progress-dots');
  if (dots.childElementCount !== n) {
    dots.textContent = '';
    for (let i = 0; i < n; i++) {
      const d = document.createElement('span');
      d.className = 'dot';
      dots.append(d);
    }
  }
  [...dots.children].forEach((d, i) => d.classList.toggle('on', i < completed));
  const zh = state.session?.getState().mode === 'zh' && !state.session?.isAwaitingFirst();
  $('progress-text').textContent = state.session?.isAwaitingFirst() && !zh ? '' : `已输入 ${completed}/${n}`;
}

function showFeedback(message, good, target = 'feedback-line') {
  const el = $(target);
  el.textContent = message;
  el.classList.toggle('good', Boolean(good));
  el.hidden = false;
}

function hideFeedback(target = 'feedback-line') {
  $(target).hidden = true;
}

function showSuggestions(words) {
  const box = $('suggestion-box');
  const chips = $('suggestion-chips');
  chips.textContent = '';
  if (!words || !words.length) return hideSuggestions();
  for (const w of words) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.textContent = w;
    chip.addEventListener('click', () => {
      hideSuggestions();
      $('input-word').value = w;
      submitInput();
    });
    chips.append(chip);
  }
  box.hidden = false;
}

function hideSuggestions() {
  $('suggestion-box').hidden = true;
}

async function submitInput() {
  const input = $('input-word');
  const raw = input.value;
  input.value = '';
  if (!raw.trim()) return;

  // 含汉字 → 中文入口（需求 2.0）
  if (state.session.isAwaitingFirst() && state.session.getState().mode === 'en' && /[一-鿿]/.test(raw)) {
    await searchChinese(raw.trim());
    return;
  }

  const precheck = state.session.prepare(raw);
  if (!precheck.ok) {
    showFeedback(precheck.message, false);
    playGentleSound(soundOn());
    return;
  }

  if (state.session.isAwaitingFirst()) {
    await firstLookup(precheck.word, raw);
    return;
  }
  await submitTyping(raw);
}

// 把当前会话绑定到目标词（服务端记账的唯一入口）
async function bindSession(word, mode) {
  try {
    return await api('/api/session', {
      method: 'POST',
      session: true,
      body: JSON.stringify({ sessionId: state.sessionId, word, mode }),
    });
  } catch (err) {
    showFeedback(err.userMessage || '出了点小状况，请重新开始查这个词', false);
    return null;
  }
}

// 英文入口第 1 次输入：先查词典；命中后由服务端绑定会话并计第 1 次
async function firstLookup(word, raw) {
  if (!state.lookupStarted) {
    state.lookupStarted = true;
    logEvents([{ type: 'lookup_start', word }]);
  }
  let dictResult;
  try {
    dictResult = await api('/api/check-word', {
      method: 'POST',
      body: JSON.stringify({
        word,
        suggest: state.session.getState().notFoundStreak >= 1,
      }),
    });
  } catch (err) {
    showFeedback(err.userMessage || '出了点小状况，请再试一次', false);
    return;
  }

  // 本地状态机只负责"找不到的连击"和相近词提示，不决定放行
  const result = state.session.firstInput(raw, dictResult);
  if (!dictResult.exists) {
    logEvents(result.events);
    showFeedback(result.message, false);
    playGentleSound(soundOn());
    showSuggestions(result.suggestions);
    return;
  }
  if (dictResult.learned) {
    state.session.cancel();
    await showLearned(dictResult.word);
    return;
  }
  if (!dictResult.allowed) {
    showFeedback('今天的词已经查够啦，明天再来', false);
    playGentleSound(soundOn());
    return;
  }
  hideSuggestions();

  state.targetWord = dictResult.word;
  state.learn = { word: dictResult.word, entryMode: 'en', consolidate: false };
  const bound = await bindSession(dictResult.word, 'en');
  if (!bound) return;
  // 第 1 次输入同样要过服务端校验并计数（需求 2.1：第 1 次输入算 1/N）。
  // 服务端不再因为"绑定会话"就白送一次，所以这里必须把这串真实的输入交给 /api/typing。
  await submitTyping(raw);
}

// 后续每次输入：由服务端比对与计数（客户端说的不算数）
async function submitTyping(raw) {
  let r;
  try {
    r = await api('/api/typing', {
      method: 'POST',
      session: true,
      body: JSON.stringify({ sessionId: state.sessionId, typed: raw }),
    });
  } catch (err) {
    showFeedback(err.userMessage || '出了点小状况，请再试一次', false);
    return;
  }

  if (r.ok) {
    if (r.done) {
      renderProgress(r.completed);
      $('btn-quick-peek').hidden = true; // 已经进门槛了，不需要"快速查看"
      showFeedback('输入完成！', true);
      playSuccessSound(soundOn());
      openPronunciation();
    } else {
      renderProgress(r.completed);
      // 真正输入过一次之后才给"快速查看"（服务端也这么要求）
      if (r.completed >= 1) maybeShowPeek();
      showFeedback(CHEERS[state.cheerIndex++ % CHEERS.length], true);
      playStepSound(soundOn());
      $('input-word').focus();
    }
    return;
  }
  if (r.reason === 'invalid_chars') {
    showFeedback(MSG_INVALID, false);
  } else if (r.reason === 'mismatch') {
    showFeedback(r.hint === 'length' ? MSG_LENGTH : positionMessage(r.position), false);
  } else {
    showFeedback('再看看这个词吧', false);
  }
  playGentleSound(soundOn());
}

function soundOn() {
  return state.bundle?.settings?.soundEnabled !== false;
}

// 统一入口：口音和嗓音都取自档案设置（嗓音为空时由 tts.js 自动挑饱满男声）
function speak(word) {
  if (!word) return;
  speakWord(word, state.bundle?.settings?.accent ?? 'en-US', state.bundle?.settings?.ttsVoice ?? '');
}

/* ---------- 中文入口（阶段 1B） ---------- */

async function searchChinese(query) {
  state.zhQuery = query;
  state.sessionId = crypto.randomUUID();
  state.lookupStarted = true;
  logEvents([{ type: 'lookup_start', word: query }], { mode: 'zh', step: 'candidates' });
  showFeedback('找一找…', true);
  try {
    const data = await api('/api/search-zh', { method: 'POST', body: JSON.stringify({ query }) });
    hideFeedback();
    state.candidates = data.results ?? [];
    state.zhAllowed = data.allowed !== false;
    state.zhRemaining = data.remaining;
    renderCandidates();
  } catch (err) {
    hideFeedback();
    logEvents([{ type: 'not_found', word: query }], { mode: 'zh', step: 'candidates' });
    showCandidatesEmpty();
  }
}

function renderCandidates() {
  const list = $('candidate-list');
  list.textContent = '';
  $('zh-query-title').textContent = state.zhQuery ? `「${state.zhQuery}」的英文：` : '你想查哪个词？';
  $('candidate-empty').hidden = state.candidates.length > 0;
  for (const item of state.candidates) {
    const card = document.createElement('button');
    card.className = 'candidate-card';
    const word = document.createElement('span');
    word.className = 'candidate-word';
    word.textContent = item.word;
    const gloss = document.createElement('span');
    gloss.className = 'candidate-gloss';
    gloss.textContent = item.gloss;
    card.append(word, gloss);
    if (item.learned) {
      const mark = document.createElement('span');
      mark.className = 'candidate-learned';
      mark.textContent = '✓ 已学会';
      card.append(mark);
    }
    card.addEventListener('click', () => pickCandidate(item));
    list.append(card);
  }
  showView('view-candidates');
}

function showCandidatesEmpty() {
  $('zh-query-title').textContent = state.zhQuery ? `「${state.zhQuery}」的英文：` : '你想查哪个词？';
  $('candidate-list').textContent = '';
  $('candidate-empty').hidden = false;
  showView('view-candidates');
}

function pickCandidate(item) {
  if (!state.zhAllowed) {
    showFeedback('今天的词已经查够啦，明天再来', false);
    playGentleSound(soundOn());
    return;
  }
  state.targetWord = item.word.toLowerCase();
  state.learn = { word: state.targetWord, entryMode: 'zh', consolidate: false };
  state.session = createTypingSession({
    requiredCount: state.bundle?.typingCount ?? 1,
    mode: 'zh',
    targetVisible: true,
  });
  state.session.setTarget(state.targetWord);
  $('zh-target-word').textContent = item.word;
  $('zh-target-row').hidden = false;
  $('btn-cancel-word').textContent = '返回';
  hideFeedback();
  hideSuggestions();
  renderProgress(0);
  $('btn-quick-peek').hidden = true; // 输入过一次之后才出现（见 submitTyping）
  showView('view-main');
  $('input-word').focus();
  // 中文入口从 0/N 开始，由服务端绑定目标词（服务端自己查词典确认存在）
  bindSession(state.targetWord, 'zh').catch(() => {});
}

function backFromZhTyping() {
  logEvents([{ type: 'cancel', word: state.session.getState().target }], { mode: 'zh', step: 'typing' });
  state.session.cancel();
  renderCandidates();
}

/* ---------- 快速查看（阶段 5） ---------- */

function maybeShowPeek() {
  const quota = state.bundle?.settings?.quickPeekPerDay ?? 0;
  if (quota > 0 && !state.learn?.consolidate) {
    $('btn-quick-peek').textContent = `先快速看一眼（今天还剩 ${state.zhRemaining ?? quota} 次）`;
    $('btn-quick-peek').hidden = (state.zhRemaining ?? quota) <= 0;
  } else {
    $('btn-quick-peek').hidden = true;
  }
}

async function quickPeek() {
  try {
    const data = await api('/api/quick-peek', {
      method: 'POST',
      session: true,
      body: JSON.stringify({
        word: state.learn?.word,
        sessionId: state.sessionId,
        mode: state.learn?.entryMode ?? 'en',
      }),
    });
    logEvents([{ type: 'quick_peek', word: state.learn?.word }], { step: 'typing' });
    state.zhRemaining = data.remaining;
    $('btn-quick-peek').hidden = true;
    showMeaningView(state.learn?.word, data.lines, {
      note: '先看一眼，明天要记得回来巩固哦',
      celebrate: false,
    });
  } catch (err) {
    showFeedback(err.userMessage || '快速查看用完啦', false);
    $('btn-quick-peek').hidden = true;
  }
}

/* ---------- 展示读音 ---------- */

function startCelebration() {
  const el = $('celebration');
  el.hidden = false;
  el.onclick = () => { el.hidden = true; };
  clearTimeout(state.celebrationTimer);
  state.celebrationTimer = setTimeout(() => { el.hidden = true; }, 2000);
}

async function openPronunciation() {
  const word = state.targetWord;
  showView('view-pronunciation');
  startCelebration();
  const wordEl = $('pron-word');
  const phEl = $('pron-phonetic');
  wordEl.textContent = word;
  phEl.hidden = true;
  try {
    const data = await api(`/api/pronunciation/${encodeURIComponent(word)}`, { session: true });
    wordEl.textContent = data.word;
    if (data.phonetic) {
      phEl.textContent = `/${data.phonetic}/`;
      phEl.hidden = false;
    }
  } catch (err) {
    showFeedback(err.userMessage || '出了点小状况', false, 'feedback-line');
    newFlow();
    showView('view-main');
    return;
  }
  speak(word);
}

// 已学会的词：免门槛直接看（需求 2.8）
async function showLearned(word) {
  state.targetWord = word;
  state.learn = { word, entryMode: 'en', consolidate: false };
  state.sessionId = crypto.randomUUID();
  try {
    const [pron, meaning] = await Promise.all([
      api(`/api/pronunciation/${encodeURIComponent(word)}`),
      api(`/api/meaning/${encodeURIComponent(word)}`),
    ]);
    showMeaningView(word, meaning.lines ?? [], {
      note: meaning.learnedDaysAgo != null && meaning.learnedDaysAgo > 0
        ? `这个词你 ${meaning.learnedDaysAgo} 天前学过啦`
        : '这个词你已经学会啦',
      celebrate: true,
      phonetic: pron.phonetic,
    });
    speak(word);
  } catch (err) {
    showError(err);
  }
}

/* ---------- 跟读（阶段 2） ---------- */

async function openReading() {
  const word = state.targetWord;
  if (!state.bundle.settings.calibrated) {
    startCalibration(word);
    return;
  }
  beginReading(word);
}

function beginReading(word) {
  const s = state.bundle.settings;
  state.reading = createReadingSession({
    requiredCount: state.bundle.readingCount,
    passScore: s.passScore,
    helpAfterFails: s.helpAfterFails,
    readingMode: s.readingMode,
    streakTolerance: s.streakTolerance,
  });
  $('reading-title').textContent = '读出这个词';
  $('reading-word').textContent = word;
  const phEl = $('reading-phonetic');
  phEl.hidden = true;
  $('reading-stars').textContent = '';
  $('btn-hear-standard').hidden = true;
  $('btn-help').hidden = true;
  $('btn-calibration-skip').hidden = true;
  $('dev-panel').hidden = !isDev();
  hideFeedback('feedback-reading');
  renderReadingProgress();
  showView('view-reading');
  api(`/api/pronunciation/${encodeURIComponent(word)}`, { session: true })
    .then((d) => {
      if (d.phonetic) {
        phEl.textContent = `/${d.phonetic}/`;
        phEl.hidden = false;
      }
    })
    .catch(() => {});
  speak(word);
  setTimeout(() => speak(word), 1200);
}

function renderReadingProgress(passes, required) {
  const st = state.reading.getState();
  const m = required ?? st.requiredCount;
  const done = passes ?? st.passes;
  const dots = $('reading-dots');
  if (dots.childElementCount !== m) {
    dots.textContent = '';
    for (let i = 0; i < m; i++) {
      const d = document.createElement('span');
      d.className = 'dot';
      dots.append(d);
    }
  }
  [...dots.children].forEach((d, i) => d.classList.toggle('on', i < done));
  $('reading-progress-text').textContent =
    st.readingMode === 'streak' ? `连续通过 ${done}/${m}` : `通过 ${done}/${m}`;
}

function starString(n) {
  return n >= 3 ? '⭐⭐⭐' : n === 2 ? '⭐⭐' : '⭐';
}

async function toggleMic() {
  if (state.recording) {
    await finishRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  try {
    state.recorder = state.recorder ?? createRecorder();
    await state.recorder.start((level) => {
      $('volume-fill').style.width = `${Math.round(level * 100)}%`;
    });
    state.recording = true;
    $('volume-bar').hidden = false;
    $('btn-mic').textContent = '⏹ 读完了，点一下';
    $('btn-mic').classList.add('recording');
    hideFeedback('feedback-reading');
  } catch (err) {
    showFeedback('请在浏览器设置里允许使用麦克风', false, 'feedback-reading');
  }
}

async function finishRecording() {
  const result = await state.recorder.stop();
  state.recording = false;
  $('volume-bar').hidden = true;
  $('volume-fill').style.width = '0%';
  $('btn-mic').textContent = '🎤 点一下开始读';
  $('btn-mic').classList.remove('recording');
  if (!result) return;
  if (result.tooQuiet) {
    showFeedback('没听清，靠近一点再念一遍', false, 'feedback-reading');
    state.reading.recordError();
    // 记一条诊断事件（不授予任何权限）：万一以后又出现"总是没听清"，
    // 家长模式/数据库里能看出是"音量太低"还是"压根没采集到音频"
    logEvents(
      [{ type: 'read_retry', word: state.targetWord, detail: { reason: 'too_quiet', peak: result.peak, chunks: result.chunks } }],
      { step: 'reading' }
    );
    return;
  }
  await submitScore({ audioBase64: arrayBufferToBase64(result.wav) });
}

async function submitScore(extra = {}) {
  const word = state.calibration ? state.calibration.words[state.calibration.idx] : state.targetWord;
  hideFeedback('feedback-reading');
  try {
    const res = await api('/api/score', {
      method: 'POST',
      session: true,
      body: JSON.stringify({
        word,
        sessionId: state.sessionId,
        calibration: Boolean(state.calibration),
        ...extra,
      }),
    });
    if (res.error) {
      showFeedback(res.message || '评测没成功，再试一次', false, 'feedback-reading');
      if (!state.calibration) state.reading.recordError();
      if (res.error === 'scorer_error' || res.error === 'not_configured') {
        logEvents([{ type: 'network_error', word, detail: { error: res.error } }], { step: 'reading' });
      }
      return;
    }
    handleScoreResult(res, word);
  } catch (err) {
    showFeedback('网络不太好，等一下再试', false, 'feedback-reading');
    if (!state.calibration) {
      state.reading.recordError();
      logEvents([{ type: 'network_error', word, detail: {} }], { step: 'reading' });
    }
  }
}

function handleScoreResult(res, word) {
  const s = state.bundle.settings;
  if (state.calibration) {
    state.calibration.scores.push(res.score);
    $('reading-stars').textContent = starString(res.score >= s.passScore ? 2 : 1);
    showFeedback('好，下一个', true, 'feedback-reading');
    state.calibration.idx += 1;
    if (state.calibration.idx >= state.calibration.words.length) {
      finishCalibration();
    } else {
      setTimeout(() => {
        const next = state.calibration.words[state.calibration.idx];
        $('reading-word').textContent = next;
        $('reading-progress-text').textContent = `试一试 第 ${state.calibration.idx + 1}/${state.calibration.words.length} 个`;
        $('reading-stars').textContent = '';
        speak(next);
      }, 900);
    }
    return;
  }

  // 次数与能否求助都以服务端返回为准（客户端说的不算数）
  const passes = res.passes ?? 0;
  const required = res.requiredCount ?? state.bundle.readingCount;
  const passedNow = Boolean(res.passed);
  $('reading-stars').textContent = starString(passedNow ? (res.score >= Math.min(100, s.passScore + 15) ? 3 : 2) : 1);
  renderReadingProgress(passes, required);
  const rs = { status: passedNow ? (passes >= required ? 'done' : 'pass') : 'fail', canHelp: Boolean(res.canHelp) };
  if (rs.status === 'done') {
    showFeedback('读得真棒！', true, 'feedback-reading');
    playSuccessSound(soundOn());
    setTimeout(() => openMeaning(), 600);
  } else if (rs.status === 'pass') {
    showFeedback(CHEERS[state.cheerIndex++ % CHEERS.length], true, 'feedback-reading');
    playStepSound(soundOn());
    $('btn-hear-standard').hidden = true;
  } else {
    showFeedback('差一点，先听一遍标准读音，再试一次', false, 'feedback-reading');
    playGentleSound(soundOn());
    $('btn-hear-standard').hidden = false;
    $('btn-help').hidden = !rs.canHelp;
  }
}

/* ---------- 首次校准（阶段 2） ---------- */

function startCalibration(nextWord) {
  // 分数由服务端记录，客户端不上报任何分数
  api('/api/calibration/start', { method: 'POST', session: true }).catch(() => {});
  state.calibration = { words: CALIBRATION_WORDS, idx: 0, scores: [], nextWord };
  state.reading = createReadingSession({ requiredCount: 1, passScore: 0, helpAfterFails: 99 });
  $('reading-title').textContent = '先试一试';
  $('reading-word').textContent = CALIBRATION_WORDS[0];
  $('reading-phonetic').hidden = true;
  $('reading-progress-text').textContent = '试一试 第 1/3 个';
  $('reading-stars').textContent = '';
  $('btn-hear-standard').hidden = true;
  $('btn-help').hidden = true;
  $('btn-calibration-skip').hidden = false;
  $('dev-panel').hidden = !isDev();
  hideFeedback('feedback-reading');
  showView('view-reading');
  speak(CALIBRATION_WORDS[0]);
}

async function finishCalibration() {
  const spokeAnything = state.calibration.scores.length > 0;
  const nextWord = state.calibration.nextWord;
  state.calibration = null;
  try {
    // 只告诉服务端"试着读完了"；分数线由服务端按自己记录的分数算（客户端无法伪造）
    await api('/api/calibration/finish', {
      method: 'POST',
      session: true,
      body: JSON.stringify({ skipped: !spokeAnything }),
    });
    state.bundle = await api('/api/settings');
    showFeedback('准备好啦！', true, 'feedback-reading');
    setTimeout(() => beginReading(nextWord), 1000);
  } catch (err) {
    beginReading(nextWord);
  }
}

/* ---------- 释义（阶段 3） ---------- */

async function openMeaning() {
  const word = state.targetWord;
  try {
    const data = await api(`/api/meaning/${encodeURIComponent(word)}`, { session: true });
    logEvents([{ type: 'meaning_shown', word }], { step: 'meaning' });
    const isNew = data.learnedDaysAgo == null;
    const notes = [];
    if (data.learnedDaysAgo != null && data.learnedDaysAgo > 0) notes.push(`这个词你 ${data.learnedDaysAgo} 天前学过啦`);
    if (state.learn?.consolidate) notes.push('巩固完成！');
    showMeaningView(word, data.lines ?? [], {
      note: notes.join('　'),
      celebrate: true,
      isNew,
    });
  } catch (err) {
    showFeedback(err.userMessage || '再试一次', false, 'feedback-reading');
  }
}

function showMeaningView(word, lines, { note, celebrate, isNew, phonetic } = {}) {
  $('meaning-word').textContent = word;
  const linesEl = $('meaning-lines');
  linesEl.textContent = '';
  if (!lines || !lines.length) {
    const p = document.createElement('p');
    p.textContent = '（词典里暂时没有这个词的释义）';
    linesEl.append(p);
  }
  for (const line of lines ?? []) {
    const p = document.createElement('p');
    p.textContent = line;
    linesEl.append(p);
  }
  const noteEl = $('meaning-note');
  noteEl.textContent = note ?? '';
  noteEl.hidden = !note;
  const cel = $('meaning-celebration');
  cel.hidden = !celebrate;
  if (celebrate) {
    clearTimeout(state.celebrationTimer);
    state.celebrationTimer = setTimeout(() => { cel.hidden = true; }, 2000);
    playSuccessSound(soundOn());
    cel.onclick = () => { cel.hidden = true; };
  }
  $('btn-meaning-next').textContent = state.learn?.consolidate ? '巩固下一个词' : '查下一个词';
  $('btn-meaning-replay').textContent = phonetic ? '听标准读音' : '听标准读音';
  showView('view-meaning');
  if (state.learn?.consolidate) continueConsolidation();
}

async function afterMeaningNext() {
  if (state.learn?.consolidate && state.pendingQueue.length) {
    startConsolidation();
    return;
  }
  if (state.learn?.consolidate) {
    showDoneOverlay('待巩固的词都完成啦！');
  }
  newFlow();
  refreshCounts();
  showView('view-main');
  $('input-word').focus();
}

/* ---------- 待巩固（阶段 5） ---------- */

async function startPendingFlow() {
  if (!state.pendingQueue.length) {
    const data = await api('/api/pending');
    state.pendingQueue = data.words ?? [];
  }
  if (!state.pendingQueue.length) return;
  startConsolidation();
}

function startConsolidation() {
  const item = state.pendingQueue[0];
  state.sessionId = crypto.randomUUID();
  state.lookupStarted = false;
  state.targetWord = item.word;
  state.learn = { word: item.word, entryMode: item.entry_mode ?? 'en', consolidate: true };
  state.session = createTypingSession({ requiredCount: state.bundle.typingCount, mode: 'zh', targetVisible: true });
  state.session.setTarget(item.word);
  $('zh-target-word').textContent = item.word;
  $('zh-target-row').hidden = false;
  $('btn-cancel-word').textContent = '返回';
  $('btn-quick-peek').hidden = true;
  $('main-hint').textContent = `巩固一下：「${item.gloss || item.word}」`;
  renderProgress(0);
  showView('view-main');
  $('input-word').focus();
  // 待巩固也走服务端绑定：目标词由服务端确认存在，输入次数由服务端数
  bindSession(item.word, 'zh').catch(() => {});
}

// 巩固流程读音通关后由 score 路由转正；这里轮询确认后弹出下一个
async function continueConsolidation() {
  try {
    const data = await api(`/api/pending/${encodeURIComponent(state.learn.word)}/status`);
    if (data.status === 'learned') {
      state.pendingQueue.shift();
    }
  } catch {}
}

/* ---------- 复习（阶段 3） ---------- */

async function enterReview() {
  const data = await api('/api/review/today');
  if (!data.words?.length) {
    showDoneOverlay('今天的复习都做完啦！');
    return;
  }
  state.review = { queue: data.words, idx: 0 };
  showReviewItem();
}

function showReviewItem() {
  const item = state.review.queue[state.review.idx];
  $('review-progress').textContent = `第 ${state.review.idx + 1}/${state.review.queue.length} 个`;
  $('review-gloss').textContent = item.gloss || item.word;
  $('review-verdict').hidden = true;
  $('review-input').value = '';
  showView('view-review');
  $('review-input').focus();
}

async function submitReview() {
  const item = state.review.queue[state.review.idx];
  const typed = $('review-input').value.trim();
  $('review-input').value = '';
  try {
    const res = await api('/api/review/answer', {
      method: 'POST',
      body: JSON.stringify({ word: item.word, typed }),
    });
    const verdict = $('review-verdict');
    if (res.correct) {
      verdict.textContent = CHEERS[state.cheerIndex++ % CHEERS.length];
      verdict.classList.add('good');
      playStepSound(soundOn());
      if (state.bundle?.settings?.theme === 'garden') glowGardenPreview();
    } else {
      verdict.textContent = `差一点，答案是 ${res.answer}`;
      verdict.classList.remove('good');
      playGentleSound(soundOn());
    }
    verdict.hidden = false;
    const nextBtn = $('btn-review-submit');
    nextBtn.textContent = '下一个';
    nextBtn.dataset.next = '1';
  } catch (err) {
    showFeedback(err.userMessage || '再试一次', false);
  }
}

async function reviewNext() {
  const nextBtn = $('btn-review-submit');
  nextBtn.textContent = '回答';
  delete nextBtn.dataset.next;
  state.review.idx += 1;
  if (state.review.idx >= state.review.queue.length) {
    showDoneOverlay('今天完成啦！');
    refreshCounts();
    newFlow();
    showView('view-main');
    return;
  }
  showReviewItem();
}

/* ---------- 生词本 / 收藏册 / 花园（阶段 3、6） ---------- */

async function showVocab() {
  const data = await api('/api/vocab');
  const list = $('vocab-list');
  list.textContent = '';
  const learned = data.words.filter((w) => w.status === 'learned');
  const pending = data.words.filter((w) => w.status === 'pending');
  $('vocab-empty').hidden = data.words.length > 0;
  for (const w of [...learned, ...pending]) {
    const row = document.createElement('div');
    row.className = 'vocab-row';
    const word = document.createElement('span');
    word.className = 'vocab-word';
    word.textContent = w.word;
    const phon = document.createElement('span');
    phon.className = 'vocab-phon';
    phon.textContent = w.phonetic ? `/${w.phonetic}/` : '';
    const gloss = document.createElement('span');
    gloss.className = 'vocab-gloss';
    gloss.textContent = w.gloss || '';
    const meta = document.createElement('span');
    meta.className = 'vocab-meta';
    meta.textContent = w.status === 'pending'
      ? '待巩固'
      : w.next_review_at
        ? `下次复习 ${w.next_review_at}`
        : '复习毕业啦';
    row.append(word, phon, gloss, meta);
    list.append(row);
  }
  showView('view-vocab');
}

function starsForScore(score) {
  const pass = state.bundle?.settings?.passScore ?? 60;
  if (score == null || score === 0) return '☆☆☆';
  if (score >= Math.min(100, pass + 15)) return '⭐⭐⭐';
  if (score >= pass) return '⭐⭐';
  return '⭐';
}

async function showCollection() {
  const [data, stats] = await Promise.all([api('/api/vocab'), api('/api/stats')]);
  const words = data.words.filter((w) => w.status === 'learned');
  $('collection-stats').textContent = `本周学习了 ${stats.weekDays} 天 · 累计 ${stats.totalDays} 天`;
  const grid = $('collection-grid');
  grid.textContent = '';
  $('collection-empty').hidden = words.length > 0;
  for (const w of words) {
    const card = document.createElement('div');
    card.className = 'word-card';
    const el = (cls, text) => {
      const s = document.createElement('span');
      s.className = cls;
      s.textContent = text;
      card.append(s);
    };
    el('w', w.word);
    el('p', w.phonetic ? `/${w.phonetic}/` : '');
    el('g', w.gloss || '');
    el('d', `${w.first_learned_at.slice(0, 10)} 学会`);
    el('s', starsForScore(w.best_score));
    grid.append(card);
  }
  showView('view-collection');
}

async function showGarden() {
  const data = await api('/api/garden');
  $('garden-count').textContent = `花园里有 ${data.total} 株植物`;
  const plot = $('garden-plot');
  plot.textContent = '';
  data.plants.forEach((plant, i) => {
    const span = document.createElement('span');
    span.className = 'plant';
    span.textContent = PLANTS[hashWord(plant.word) % PLANTS.length];
    span.style.left = `${(i * 73) % 90 + 5}%`;
    span.style.top = `${88 - ((i * 31) % 22)}%`;
    plot.append(span);
  });
  const fam = $('garden-family');
  if (data.familyEnabled && data.familyTotal != null) {
    fam.textContent = `全家一共种下了 ${data.familyTotal} 株植物`;
    fam.hidden = false;
  } else {
    fam.hidden = true;
  }
  showView('view-garden');
}

function hashWord(word) {
  let h = 0;
  for (const ch of String(word)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

function glowGardenPreview() {
  // 复习答对时的小庆祝（花园主题）：一颗植物短暂发光
  const plot = $('garden-plot');
  if (!plot.childElementCount) return;
  const plant = plot.children[state.cheerIndex % plot.childElementCount];
  plant?.classList.add('glow');
  setTimeout(() => plant?.classList.remove('glow'), 2200);
}

/* ---------- 主题（阶段 6） ---------- */

async function pickTheme(theme) {
  try {
    await api('/api/theme', { method: 'POST', body: JSON.stringify({ theme }) });
    state.bundle.settings.theme = theme;
    applyTheme();
  } catch {}
  $('theme-modal').hidden = true;
}

/* ---------- 家长模式（阶段 4） ---------- */

// 家长模式入口：点一下就去输密码（家长明确要求做成看得见的按钮）
function onParentEntry() {
  openParentPin().catch(showError);
}

async function openParentPin() {
  if (state.parentToken) return openParentPanel();
  const { hasPin } = await api('/api/parent/has-pin', { noProfile: true });
  $('pin-title').textContent = hasPin ? '输入家长密码' : '设置一个家长密码（4-6 位数字）';
  $('input-pin').value = '';
  $('pin-error').hidden = true;
  showView('view-parent-pin');
  $('input-pin').focus();
}

async function submitPin() {
  const pin = $('input-pin').value.trim();
  const { hasPin } = await api('/api/parent/has-pin', { noProfile: true });
  try {
    const res = await api(hasPin ? '/api/parent/login' : '/api/parent/pin', {
      method: 'POST',
      noProfile: true,
      body: JSON.stringify({ pin }),
    });
    state.parentToken = res.token;
    openParentPanel();
  } catch (err) {
    const el = $('pin-error');
    el.textContent = err.userMessage ?? '密码不对，再试试';
    el.hidden = false;
  }
}

async function openParentPanel() {
  showView('view-parent');
  switchTab('tab-profiles');
  await renderParentProfiles();
  await renderParentProfileSelects();
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('selected', b.dataset.tab === tabId));
  for (const id of ['tab-profiles', 'tab-settings', 'tab-records', 'tab-summary', 'tab-misc']) {
    $(id).hidden = id !== tabId;
  }
  // 切到设置页就把表单渲染出来（否则家长会看到空白页）
  if (tabId === 'tab-settings') renderParentSettings().catch(() => {});
}

async function renderParentProfiles() {
  const { profiles } = await api('/api/profiles', { noProfile: true });
  const list = $('parent-profile-list');
  list.textContent = '';
  for (const p of profiles) {
    const card = document.createElement('button');
    card.className = 'profile-card';
    const av = document.createElement('span');
    av.className = 'avatar';
    av.textContent = p.avatar;
    const nm = document.createElement('span');
    nm.textContent = p.name;
    card.append(av, nm);
    card.addEventListener('click', () => editParentProfile(p));
    list.append(card);
  }
}

let editingProfileId = null;
let editingProfileName = '';

function editParentProfile(p) {
  editingProfileId = p.id;
  editingProfileName = p.name;
  $('parent-profile-form').hidden = false;
  $('parent-profile-form').scrollIntoView({ block: 'nearest' });
  $('pp-name').value = p.name;
  const av = $('pp-avatars');
  av.textContent = '';
  for (const a of AVATARS) {
    const btn = document.createElement('button');
    btn.className = 'profile-card' + (a === p.avatar ? ' selected' : '');
    const span = document.createElement('span');
    span.className = 'avatar';
    span.textContent = a;
    btn.append(span);
    btn.addEventListener('click', () => {
      pickedAvatar = a;
      for (const c of av.children) c.classList.toggle('selected', c === btn);
    });
    if (a === p.avatar) pickedAvatar = a;
    av.append(btn);
  }
  const pg = $('pp-presets');
  pg.textContent = '';
  for (const card of PRESET_CARDS) {
    const btn = document.createElement('button');
    btn.className = 'preset-card' + (card.key === p.preset ? ' selected' : '');
    btn.textContent = card.title;
    if (card.key === p.preset) pickedPreset = card.key;
    btn.addEventListener('click', () => {
      pickedPreset = card.key;
      for (const c of pg.children) c.classList.toggle('selected', c === btn);
    });
    pg.append(btn);
  }
}

async function saveParentProfile() {
  if (!editingProfileId) return;
  const name = $('pp-name').value.trim();
  try {
    await api(`/api/parent/profiles/${editingProfileId}`, {
      method: 'POST',
      parent: true,
      noProfile: true,
      body: JSON.stringify({ name, avatar: pickedAvatar, preset: pickedPreset }),
    });
    $('parent-profile-form').hidden = true;
    editingProfileId = null;
    await renderParentProfiles();
    await renderParentProfileSelects();
    toast('已保存，立即生效');
  } catch (err) {
    toast(err.userMessage ?? '保存失败');
  }
}

async function deleteParentProfile() {
  if (!editingProfileId) return;
  const name = editingProfileName || '这个档案';
  const first = await askConfirm({
    title: `删除「${name}」`,
    text: '这个档案的全部数据都会被删除：生词本、复习进度、查词记录、所有设置。',
    okText: '继续删除',
    danger: true,
  });
  if (!first) return;
  const second = await askConfirm({
    title: '再确认一次',
    text: `真的要删除「${name}」吗？删除后无法恢复。`,
    okText: '确认删除',
    danger: true,
  });
  if (!second) return;
  try {
    await api(`/api/parent/profiles/${editingProfileId}`, { method: 'DELETE', parent: true, noProfile: true });
    $('parent-profile-form').hidden = true;
    editingProfileId = null;
    await renderParentProfiles();
    await renderParentProfileSelects();
    toast(`已删除「${name}」`);
  } catch (err) {
    toast(err.userMessage ?? '删除失败，请再试一次');
  }
}

async function newParentProfile() {
  state.returnToParent = true;
  renderCreateView();
  $('btn-create-back').hidden = false;
  showView('view-create');
}

/* ---------- 家长：设置页 ---------- */

const SETTING_FIELDS = [
  ['gateLevel', '门槛起点（1-3）', 'number', { min: 1, max: 3 }],
  ['autoRamp', '自动升档', 'bool'],
  ['rampEveryActiveDays', '几天升一档', 'number', { min: 1, max: 60 }],
  ['passScore', '发音通过分数线', 'number', { min: 0, max: 100 }],
  ['helpAfterFails', '几次读不过后出现“求助”', 'number', { min: 1, max: 20 }],
  ['meaningLines', '释义最多显示几行', 'number', { min: 1, max: 10 }],
  ['reviewPerDay', '每天最多复习几个词', 'number', { min: 0, max: 50 }],
  ['accent', '标准读音口音', 'select', { options: ['en-US', 'en-GB'] }],
  ['dailyLookupLimit', '每天最多查几个新词（0 不限）', 'number', { min: 0, max: 200 }],
  ['readingMode', '跟读计数方式', 'select', { options: ['cumulative', 'streak'] }],
  ['streakTolerance', '连续模式允许中间失败几次', 'number', { min: 0, max: 5 }],
  ['soundEnabled', '提示音效', 'bool'],
  ['quickPeekPerDay', '每天快速查看次数（0 关闭）', 'number', { min: 0, max: 50 }],
  ['ttsVoice', '标准读音的嗓音', 'voice'],
];

let settingsProfileId = null;

async function renderParentSettings() {
  const id = Number($('ps-profile').value);
  settingsProfileId = id;
  const profiles = await api('/api/profiles', { noProfile: true });
  const target = profiles.profiles.find((p) => p.id === id);
  const settings = target ? (await apiWithProfile(id, '/api/settings')).settings : null;
  const box = $('ps-fields');
  box.textContent = '';
  if (!settings) return;
  for (const [key, label, type, extra] of SETTING_FIELDS) {
    const row = document.createElement('div');
    row.className = 'ps-row';
    const lab = document.createElement('label');
    lab.textContent = label;
    row.append(lab);
    let input;
    if (type === 'bool') {
      input = document.createElement('select');
      for (const [val, txt] of [['true', '开'], ['false', '关']]) {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = txt;
        input.append(opt);
      }
      input.value = String(settings[key]);
    } else if (type === 'select') {
      input = document.createElement('select');
      for (const val of extra.options) {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = val;
        input.append(opt);
      }
      input.value = String(settings[key]);
    } else if (type === 'voice') {
      // 列出这台设备上可用的英文嗓音，默认“自动”（自动挑饱满男声）
      input = document.createElement('select');
      const auto = document.createElement('option');
      auto.value = '';
      auto.textContent = '自动（饱满男声优先）';
      input.append(auto);
      for (const v of listEnglishVoices()) {
        const opt = document.createElement('option');
        opt.value = v.name;
        opt.textContent = `${v.name}　${v.lang}`;
        input.append(opt);
      }
      const current = String(settings[key] ?? '');
      if (current && ![...input.options].some((o) => o.value === current)) {
        const opt = document.createElement('option');
        opt.value = current;
        opt.textContent = `${current}（当前设置）`;
        input.append(opt);
      }
      input.value = current;
    } else {
      input = document.createElement('input');
      input.type = 'number';
      if (extra?.min !== undefined) input.min = extra.min;
      if (extra?.max !== undefined) input.max = extra.max;
      input.value = settings[key];
    }
    input.dataset.key = key;
    row.append(input);
    box.append(row);
  }
}

async function apiWithProfile(profileId, path) {
  const headers = { 'Content-Type': 'application/json', 'X-Profile-Id': String(profileId) };
  const res = await fetch(path, { headers });
  return res.json();
}

async function saveParentSettings() {
  const body = {};
  for (const input of $('ps-fields').querySelectorAll('[data-key]')) {
    const key = input.dataset.key;
    if (input.tagName === 'SELECT') {
      const boolVals = ['true', 'false'];
      if (boolVals.includes(input.value) && ['autoRamp', 'soundEnabled'].includes(key)) {
        body[key] = input.value === 'true';
      } else if (key === 'gateLevel' || ['rampEveryActiveDays', 'passScore', 'helpAfterFails', 'meaningLines', 'reviewPerDay', 'dailyLookupLimit', 'streakTolerance', 'quickPeekPerDay'].includes(key)) {
        body[key] = Number(input.value);
      } else {
        body[key] = input.value;
      }
    } else {
      body[key] = Number(input.value);
    }
  }
  await api(`/api/parent/profiles/${settingsProfileId}/settings`, {
    method: 'POST',
    parent: true,
    noProfile: true,
    body: JSON.stringify(body),
  });
  if (state.profile?.id === settingsProfileId) {
    state.bundle = await apiWithProfile(settingsProfileId, '/api/settings');
  }
  toast('已保存，立即生效');
}

/* ---------- 家长：记录 / 汇总 / 导出 ---------- */

async function loadParentRecords() {
  const id = $('pr-profile').value;
  const date = $('pr-date').value;
  const qs = new URLSearchParams({ profile: id });
  if (date) qs.set('date', date);
  const data = await api(`/api/parent/records?${qs}`, { parent: true, noProfile: true });
  const list = $('pr-list');
  list.textContent = '';
  for (const r of data.records) {
    const row = document.createElement('div');
    row.className = 'record-row';
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = new Date(r.ts).toLocaleString('zh-CN', { hour12: false });
    const ty = document.createElement('span');
    ty.className = 'ty';
    ty.textContent = r.type;
    const info = document.createElement('span');
    info.textContent = `${r.mode === 'zh' ? '中' : '英'} ${r.word ?? ''} ${r.step ?? ''}`;
    row.append(t, ty, info);
    list.append(row);
  }
  if (!data.records.length) {
    const empty = document.createElement('div');
    empty.className = 'record-row';
    empty.textContent = '这段时间没有记录';
    list.append(empty);
  }
}

async function loadParentSummary() {
  const id = $('pm-profile').value;
  const data = await api(`/api/parent/summary?profile=${id}`, { parent: true, noProfile: true });
  const box = $('pm-body');
  box.textContent = '';
  const item = (html) => {
    const d = document.createElement('div');
    d.className = 'pm-item';
    d.innerHTML = html;
    box.append(d);
  };
  item(`<b>查词</b>：查了 ${data.lookedUp} 个词，学会 ${data.learned} 个，求助通关 ${data.assisted} 个`);
  item('<b>卡得最久的词</b>：' + (data.stuckTop.length
    ? data.stuckTop.map((s) => `${s.word}（${s.attempts} 次）`).join('、')
    : '没有特别卡住的词'));
  item(`<b>复习正确率</b>：${data.review.accuracy == null ? '还没有复习记录' : `${data.review.accuracy}%（对 ${data.review.ok} / 错 ${data.review.wrong}）`}`);
  item(`<b>放弃点统计</b>：${data.giveUp.conclusion}。${Object.entries(data.giveUp.byStep).map(([k, v]) => `${k} 放弃 ${v} 次`).join('，') || '没有放弃'}；${Object.entries(data.giveUp.cancelByStep).map(([k, v]) => `${k} 返回 ${v} 次`).join('，') || '没有点返回'}`);
}

async function exportCsv(kind) {
  const id = Number($('ps-profile').value || state.profile?.id);
  const headers = { 'X-Parent-Token': state.parentToken ?? '' };
  const res = await fetch(`/api/parent/export/${kind}.csv?profile=${id}`, { headers });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${kind}-${id}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function toggleFamilyGarden() {
  const { enabled } = await api('/api/parent/family-garden', { parent: true, noProfile: true });
  const next = !enabled;
  await api('/api/parent/family-garden', {
    method: 'POST',
    parent: true,
    noProfile: true,
    body: JSON.stringify({ enabled: next }),
  });
  $('btn-family-garden').textContent = next ? '关闭' : '打开';
}

/* ---------- 完成画面 ---------- */

function showDoneOverlay(text = '今天完成啦！') {
  $('done-overlay').querySelector('.overlay-title').textContent = text;
  $('done-overlay').hidden = false;
  playSuccessSound(soundOn());
  clearTimeout(state.doneTimer);
  state.doneTimer = setTimeout(() => { $('done-overlay').hidden = true; }, 2600);
}

/* ---------- 绑定 ---------- */

function bind() {
  // 档案
  $('btn-new-profile').addEventListener('click', () => {
    renderCreateView();
    $('btn-create-back').hidden = $('profile-list').childElementCount === 0;
    showView('view-create');
    $('input-name').focus();
  });
  $('btn-create-back').addEventListener('click', () => {
    if (state.returnToParent) {
      state.returnToParent = false;
      openParentPanel();
      return;
    }
    showView('view-profiles');
  });
  $('btn-create-done').addEventListener('click', () => createProfile().catch(showError));
  $('btn-switch-profile').addEventListener('click', () => {
    state.profile = null;
    state.bundle = null;
    renderProfileList().catch(showError);
    showView('view-profiles');
  });

  // 输入
  $('btn-submit').addEventListener('click', submitInput);
  $('input-word').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitInput();
  });
  $('input-word').addEventListener('paste', (e) => e.preventDefault());
  $('btn-cancel-word').addEventListener('click', () => {
    if (state.learn?.consolidate) {
      newFlow();
      refreshCounts();
      return;
    }
    if (state.session.getState().mode === 'zh' && !state.session.isAwaitingFirst()) {
      backFromZhTyping();
      return;
    }
    if (!state.session.isAwaitingFirst() || state.lookupStarted) {
      logEvents([{ type: 'cancel', word: state.session.getState().target }]);
    }
    state.session.cancel();
    newFlow();
    $('input-word').focus();
  });
  $('btn-candidates-back').addEventListener('click', () => {
    logEvents([{ type: 'cancel', word: state.zhQuery }], { mode: 'zh', step: 'candidates' });
    newFlow();
    showView('view-main');
    $('input-word').focus();
  });
  $('btn-quick-peek').addEventListener('click', quickPeek);

  // 读音
  $('btn-replay').addEventListener('click', () => speak(state.targetWord));
  $('btn-go-reading').addEventListener('click', openReading);
  $('btn-pron-back').addEventListener('click', () => {
    newFlow();
    showView('view-main');
  });

  // 跟读
  $('btn-mic').addEventListener('click', toggleMic);
  $('btn-hear-standard').addEventListener('click', () => speak(state.targetWord));
  $('btn-help').addEventListener('click', () => {
    // 是否允许求助由服务端判定（读不够次数会被拒）
    api('/api/help', {
      method: 'POST',
      session: true,
      body: JSON.stringify({ word: state.targetWord, sessionId: state.sessionId }),
    })
      .then(() => {
        $('btn-help').hidden = true;
        showFeedback('好，这次先帮你打开，之后要重点复习哦', true, 'feedback-reading');
        setTimeout(() => openMeaning(), 800);
      })
      .catch((err) => {
        $('btn-help').hidden = true;
        showFeedback(err.userMessage || '再多试几次吧', false, 'feedback-reading');
      });
  });
  $('btn-dev-score').addEventListener('click', () => {
    submitScore({ mockScore: Number($('dev-score').value) });
  });
  $('btn-calibration-skip').addEventListener('click', () => {
    if (state.calibration) {
      state.calibration.scores = [];
      finishCalibration();
    }
  });

  // 释义
  $('btn-meaning-replay').addEventListener('click', () => speak(state.targetWord));
  $('btn-meaning-next').addEventListener('click', afterMeaningNext);

  // 复习
  $('chip-review').addEventListener('click', () => enterReview().catch(showError));
  $('chip-pending').addEventListener('click', () => startPendingFlow().catch(showError));
  $('btn-review-submit').addEventListener('click', () => {
    if ($('btn-review-submit').dataset.next) reviewNext();
    else submitReview();
  });
  $('review-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-review-submit').click();
  });
  $('review-input').addEventListener('paste', (e) => e.preventDefault());
  $('btn-review-quit').addEventListener('click', () => {
    newFlow();
    showView('view-main');
  });

  // 生词本 / 收藏册 / 花园
  $('chip-vocab').addEventListener('click', () => showVocab().catch(showError));
  $('chip-collection').addEventListener('click', () => showCollection().catch(showError));
  $('chip-garden').addEventListener('click', () => showGarden().catch(showError));
  $('btn-vocab-back').addEventListener('click', () => showView('view-main'));
  $('btn-collection-back').addEventListener('click', () => showView('view-main'));
  $('btn-garden-back').addEventListener('click', () => showView('view-main'));

  // 主题
  $('btn-theme').addEventListener('click', () => { $('theme-modal').hidden = false; });
  $('btn-theme-close').addEventListener('click', () => { $('theme-modal').hidden = true; });
  $('btn-theme-simple').addEventListener('click', () => pickTheme('simple'));
  $('btn-theme-garden').addEventListener('click', () => pickTheme('garden'));

  // 家长
  $('parent-entry').addEventListener('click', onParentEntry);
  $('btn-pin-ok').addEventListener('click', submitPin);
  $('input-pin').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitPin();
  });
  $('btn-pin-cancel').addEventListener('click', () => {
    // 还没选档案时（在“你是谁呀”页点进来的），要退回档案选择页
    if (state.profile) {
      showView('view-main');
    } else {
      renderProfileList().catch(() => {});
      showView('view-profiles');
    }
  });
  document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('btn-pp-save').addEventListener('click', saveParentProfile);
  $('btn-pp-delete').addEventListener('click', deleteParentProfile);
  $('btn-pp-new').addEventListener('click', newParentProfile);
  $('ps-profile').addEventListener('change', renderParentSettings);
  $('btn-ps-save').addEventListener('click', saveParentSettings);
  $('btn-pr-load').addEventListener('click', loadParentRecords);
  $('btn-pm-load').addEventListener('click', loadParentSummary);
  $('btn-export-vocab').addEventListener('click', () => exportCsv('vocab'));
  $('btn-export-events').addEventListener('click', () => exportCsv('events'));
  $('btn-family-garden').addEventListener('click', toggleFamilyGarden);
  $('btn-parent-exit').addEventListener('click', () => {
    // 退出后清掉本次令牌：下次进家长模式一定要重新输密码（孩子不能顺着点进来）
    state.parentToken = null;
    showView('view-main');
    toast('已退出家长模式');
  });
  $('done-overlay').addEventListener('click', () => { $('done-overlay').hidden = true; });
}

function showError(err) {
  showFeedback(err?.userMessage || err?.message || '出了点小状况，请再试一次', false);
}

/* ---------- 应用内确认框 / 提示条 ----------
   不能用 window.confirm / alert：内嵌浏览器（Claude 的预览面板）和 iPad 上的
   独立窗口会把系统弹窗直接屏蔽掉，导致「删除」等操作永远不执行、也看不到结果。 */

function askConfirm({ title, text, okText = '确定', danger = false }) {
  return new Promise((resolve) => {
    const modal = $('confirm-modal');
    const okBtn = $('btn-confirm-ok');
    const cancelBtn = $('btn-confirm-cancel');
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    okBtn.textContent = okText;
    okBtn.classList.toggle('btn-danger', danger);
    modal.hidden = false;
    const finish = (value) => {
      modal.hidden = true;
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      resolve(value);
    };
    okBtn.onclick = () => finish(true);
    cancelBtn.onclick = () => finish(false);
  });
}

let toastTimer = null;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

async function renderParentProfileSelects() {
  const { profiles } = await api('/api/profiles', { noProfile: true });
  for (const selectId of ['ps-profile', 'pr-profile', 'pm-profile']) {
    const select = $(selectId);
    select.textContent = '';
    for (const p of profiles) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.avatar} ${p.name}`;
      select.append(opt);
    }
  }
}

async function init() {
  bind();
  const { profiles } = await api('/api/profiles', { noProfile: true });
  if (!profiles.length) {
    renderCreateView();
    $('btn-create-back').hidden = true;
    showView('view-create');
  } else {
    await renderProfileList();
    showView('view-profiles');
  }
}

// 任何一次点击都顺带解锁声音（iOS 需要，需求 5.3）
document.addEventListener('pointerdown', () => {
  unlockTTS();
  unlockSFX();
}, { capture: true });

init().catch(showError);
````


---

## 📄 public/audio-record.js

````js
// 录音并转 16kHz / 16bit / 单声道 WAV（需求 5.2）。
// 浏览器 MediaRecorder 在 iPad 上输出 mp4/aac 不能直接用，所以自己采集原始音频。
// 优先 AudioWorklet，不支持时退回 ScriptProcessor。

const WORKLET_CODE = `
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) this.port.postMessage(input[0]);
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
`;

const TARGET_RATE = 16000;
const MAX_SECONDS = 5;

export function createRecorder() {
  let stream = null;
  let ctx = null;
  let node = null;
  let workletNode = null;
  let sink = null; // 增益为 0 的汇点：驱动采集但不出声
  let chunks = [];
  let peak = 0;
  let onVolume = null;
  let running = false;
  let startMs = 0;
  let stopTimer = null;

  async function start(volumeCallback) {
    onVolume = volumeCallback ?? null;
    chunks = [];
    peak = 0;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: TARGET_RATE });
    } catch {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ctx.state === 'suspended') await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    running = true;
    startMs = Date.now();

    // ⚠️ Web Audio 只会"拉动"能通到 destination 的节点。
    // 采集节点必须先接到 destination，否则它的 process()/onaudioprocess 根本不会被调用，
    // 结果是一个音频块都收不到、峰值恒为 0，界面永远提示"没听清"（踩过这个坑）。
    // 但直接把麦克风接到 destination 会从扬声器放出来（iPad 上会啸叫），
    // 所以中间串一个增益为 0 的节点：能驱动采集，又不出声。
    sink = ctx.createGain();
    sink.gain.value = 0;
    sink.connect(ctx.destination);

    let usedWorklet = false;
    try {
      const blobUrl = URL.createObjectURL(new Blob([WORKLET_CODE], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(blobUrl);
      URL.revokeObjectURL(blobUrl);
      workletNode = new AudioWorkletNode(ctx, 'capture-processor');
      workletNode.port.onmessage = (e) => handleChunk(e.data);
      source.connect(workletNode);
      workletNode.connect(sink);
      usedWorklet = true;
    } catch {
      usedWorklet = false;
    }
    if (!usedWorklet) {
      node = ctx.createScriptProcessor(2048, 1, 1);
      node.onaudioprocess = (e) => handleChunk(e.inputBuffer.getChannelData(0));
      source.connect(node);
      node.connect(sink);
    }

    // 单词最长录 5 秒，超时自动结束（需求 2.3）
    stopTimer = setTimeout(() => stop(), MAX_SECONDS * 1000 + 300);
    return { usedWorklet };
  }

  function handleChunk(float32) {
    if (!running) return;
    const copy = new Float32Array(float32);
    chunks.push(copy);
    let sumSq = 0;
    for (let i = 0; i < copy.length; i++) sumSq += copy[i] * copy[i];
    const rms = Math.sqrt(sumSq / copy.length);
    if (rms > peak) peak = rms;
    if (onVolume) onVolume(Math.min(1, rms * 4));
    if (Date.now() - startMs > MAX_SECONDS * 1000) stop();
  }

  // stop() 返回 { wav: ArrayBuffer, durationSec, tooQuiet }
  async function stop() {
    if (!running) return null;
    running = false;
    clearTimeout(stopTimer);
    try {
      workletNode?.disconnect();
      node?.disconnect();
      sink?.disconnect();
      stream?.getTracks().forEach((t) => t.stop());
    } catch {}
    const sampleRate = ctx.sampleRate;
    try {
      await ctx.close();
    } catch {}
    ctx = null;

    const merged = mergeChunks(chunks);
    const durationSec = merged.length / sampleRate;
    const tooQuiet = peak < 0.012; // 基本没出声：不算失败，提示再念一遍
    const resampled = sampleRate === TARGET_RATE ? merged : resampleLinear(merged, sampleRate, TARGET_RATE);
    return { wav: encodeWav(resampled, TARGET_RATE), durationSec, tooQuiet, peak, chunks: chunks.length };
  }

  return { start, stop, isRunning: () => running };
}

function mergeChunks(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function resampleLinear(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = input[i0] ?? 0;
    const b = input[i0 + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

export function encodeWav(samples, rate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}
````


---

## 📄 public/index.html

````html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>WordLock 查词器</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🔒</text></svg>">
  <link rel="manifest" href="manifest.json">
  <link rel="apple-touch-icon" href="icon-180.png">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main id="app">

    <!-- 档案选择 -->
    <section id="view-profiles" class="view" hidden>
      <h1 class="page-title">你是谁呀？</h1>
      <div id="profile-list" class="profile-grid"></div>
      <button id="btn-new-profile" class="btn btn-big btn-ghost">新建档案</button>
    </section>

    <!-- 创建档案 -->
    <section id="view-create" class="view" hidden>
      <h1 class="page-title">新建档案</h1>
      <label class="field-label" for="input-name">名字</label>
      <input id="input-name" class="text-input" type="text" maxlength="20"
             autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
             placeholder="写上你的名字">
      <p class="field-label">选一个头像</p>
      <div id="avatar-grid" class="profile-grid avatar-grid"></div>
      <p class="field-label">选择学习方式</p>
      <div id="preset-grid" class="preset-grid"></div>
      <div class="row-buttons">
        <button id="btn-create-back" class="btn btn-ghost">返回</button>
        <button id="btn-create-done" class="btn btn-big btn-primary">创建</button>
      </div>
    </section>

    <!-- 输入阶段 -->
    <section id="view-main" class="view" hidden>
      <header class="topbar">
        <span id="whoami" class="whoami"></span>
        <div class="topbar-actions">
          <button id="btn-theme" class="btn btn-small btn-ghost" title="选主题">🎨</button>
          <button id="btn-switch-profile" class="btn btn-small btn-ghost">换人</button>
        </div>
      </header>

      <div class="entry-chips">
        <button id="chip-review" class="chip-link" hidden></button>
        <button id="chip-pending" class="chip-link" hidden></button>
        <button id="chip-vocab" class="chip-link">生词本</button>
        <button id="chip-collection" class="chip-link">收藏册</button>
        <button id="chip-garden" class="chip-link" hidden>花园</button>
      </div>

      <p class="main-hint" id="main-hint">输入英文单词，或者输入中文来查英文</p>

      <div id="zh-target-row" hidden>
        <p class="zh-target-label">请照着它，输入下面这个词</p>
        <p id="zh-target-word" class="zh-target-word"></p>
      </div>

      <div id="progress-row">
        <div id="progress-dots" class="dots"></div>
        <p id="progress-text" class="progress-text"></p>
      </div>

      <div id="feedback-line" class="feedback" hidden></div>

      <div id="suggestion-box" hidden>
        <p class="suggest-title">你是不是想输入：</p>
        <div id="suggestion-chips" class="chips"></div>
      </div>

      <input id="input-word" class="text-input input-word" type="text" name="word"
             autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
             placeholder="在这里输入" aria-label="输入单词">
      <button id="btn-submit" class="btn btn-big btn-primary">输入</button>
      <button id="btn-cancel-word" class="btn btn-ghost">换一个词</button>
      <button id="btn-quick-peek" class="btn btn-peek" hidden></button>
    </section>

    <!-- 中文候选列表 -->
    <section id="view-candidates" class="view" hidden>
      <p id="zh-query-title" class="page-title-small"></p>
      <div id="candidate-list" class="candidate-list"></div>
      <div id="candidate-empty" class="feedback" hidden>没找到，换个更短或更常见的说法试试</div>
      <button id="btn-candidates-back" class="btn btn-big btn-ghost">返回</button>
    </section>

    <!-- 展示读音 -->
    <section id="view-pronunciation" class="view" hidden>
      <div id="celebration" class="celebration" hidden>
        <span class="celebration-star">✨</span>
        <p class="celebration-text">输入得真棒！</p>
      </div>
      <p id="pron-word" class="pron-word"></p>
      <p id="pron-phonetic" class="pron-phonetic" hidden></p>
      <div class="row-buttons">
        <button id="btn-replay" class="btn btn-big btn-secondary">再听一遍</button>
        <button id="btn-go-reading" class="btn btn-big btn-primary">继续读一读</button>
      </div>
      <button id="btn-pron-back" class="btn btn-ghost">返回</button>
    </section>

    <!-- 跟读阶段 -->
    <section id="view-reading" class="view" hidden>
      <p id="reading-title" class="page-title-small">读出这个词</p>
      <p id="reading-word" class="pron-word"></p>
      <p id="reading-phonetic" class="pron-phonetic" hidden></p>

      <div id="reading-dots" class="dots"></div>
      <p id="reading-progress-text" class="progress-text"></p>
      <div id="reading-stars" class="stars"></div>

      <div id="volume-bar" class="volume" hidden><div id="volume-fill" class="volume-fill"></div></div>

      <button id="btn-mic" class="btn btn-big btn-mic">🎤 点一下开始读</button>
      <div id="feedback-reading" class="feedback" hidden></div>
      <button id="btn-hear-standard" class="btn btn-secondary" hidden>听标准读音</button>
      <button id="btn-help" class="btn btn-help" hidden>求助通关</button>

      <div id="dev-panel" class="dev-panel" hidden>
        <p class="dev-note">开发模式：模拟评分</p>
        <input id="dev-score" type="range" min="0" max="100" value="80">
        <button id="btn-dev-score" class="btn btn-small btn-secondary">按这个分数评测</button>
      </div>
      <button id="btn-calibration-skip" class="btn btn-ghost" hidden>跳过试一试</button>
    </section>

    <!-- 释义 -->
    <section id="view-meaning" class="view" hidden>
      <div id="meaning-celebration" class="celebration" hidden>
        <span class="celebration-star">🌟</span>
        <p class="celebration-text">学会啦！</p>
      </div>
      <p id="meaning-word" class="pron-word"></p>
      <p id="meaning-note" class="meaning-note" hidden></p>
      <div id="meaning-lines" class="meaning-lines"></div>
      <button id="btn-meaning-replay" class="btn btn-secondary">听标准读音</button>
      <button id="btn-meaning-next" class="btn btn-big btn-primary">查下一个词</button>
    </section>

    <!-- 复习 -->
    <section id="view-review" class="view" hidden>
      <p class="page-title-small">复习一下</p>
      <p id="review-progress" class="progress-text"></p>
      <p class="review-ask">这个词是什么意思？请输入英文：</p>
      <p id="review-gloss" class="review-gloss"></p>
      <div id="review-verdict" class="feedback" hidden></div>
      <input id="review-input" class="text-input input-word" type="text"
             autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
             placeholder="输入英文单词" aria-label="复习输入">
      <button id="btn-review-submit" class="btn btn-big btn-primary">回答</button>
      <button id="btn-review-quit" class="btn btn-ghost">先不复习了</button>
    </section>

    <!-- 生词本 -->
    <section id="view-vocab" class="view" hidden>
      <p class="page-title-small">生词本</p>
      <div id="vocab-list" class="vocab-list"></div>
      <div id="vocab-empty" class="feedback" hidden>生词本还是空的，去查几个词吧</div>
      <button id="btn-vocab-back" class="btn btn-big btn-ghost">返回</button>
    </section>

    <!-- 收藏册 -->
    <section id="view-collection" class="view" hidden>
      <p class="page-title-small">单词卡收藏册</p>
      <p id="collection-stats" class="progress-text"></p>
      <div id="collection-grid" class="card-grid"></div>
      <div id="collection-empty" class="feedback" hidden>学会了词就会有一张卡片哦</div>
      <button id="btn-collection-back" class="btn btn-big btn-ghost">返回</button>
    </section>

    <!-- 花园 -->
    <section id="view-garden" class="view" hidden>
      <p class="page-title-small">我的花园</p>
      <p id="garden-count" class="progress-text"></p>
      <div id="garden-plot" class="garden-plot"></div>
      <p id="garden-family" class="progress-text" hidden></p>
      <button id="btn-garden-back" class="btn btn-big btn-ghost">返回</button>
    </section>

    <!-- 家长模式：PIN -->
    <section id="view-parent-pin" class="view" hidden>
      <p id="pin-title" class="page-title-small">输入家长密码</p>
      <input id="input-pin" class="text-input input-pin" type="password" inputmode="numeric"
             maxlength="6" autocomplete="off" aria-label="家长密码">
      <div id="pin-error" class="feedback" hidden></div>
      <div class="row-buttons">
        <button id="btn-pin-cancel" class="btn btn-ghost">取消</button>
        <button id="btn-pin-ok" class="btn btn-big btn-primary">进入</button>
      </div>
    </section>

    <!-- 家长面板 -->
    <section id="view-parent" class="view" hidden>
      <p class="page-title-small">家长模式</p>
      <div class="tab-row">
        <button class="tab-btn selected" data-tab="tab-profiles">档案</button>
        <button class="tab-btn" data-tab="tab-settings">设置</button>
        <button class="tab-btn" data-tab="tab-records">记录</button>
        <button class="tab-btn" data-tab="tab-summary">汇总</button>
        <button class="tab-btn" data-tab="tab-misc">其他</button>
      </div>

      <div id="tab-profiles" class="tab-body">
        <div id="parent-profile-list" class="profile-grid"></div>
        <div id="parent-profile-form" hidden>
          <label class="field-label">名字</label>
          <input id="pp-name" class="text-input" type="text" maxlength="20">
          <p class="field-label">头像</p>
          <div id="pp-avatars" class="profile-grid avatar-grid"></div>
          <p class="field-label">预设</p>
          <div id="pp-presets" class="preset-grid"></div>
          <div class="row-buttons">
            <button id="btn-pp-delete" class="btn btn-danger">删除档案</button>
            <button id="btn-pp-save" class="btn btn-primary">保存</button>
          </div>
        </div>
        <button id="btn-pp-new" class="btn btn-big btn-ghost">新建档案</button>
      </div>

      <div id="tab-settings" class="tab-body" hidden>
        <label class="field-label">给哪个档案设置</label>
        <select id="ps-profile" class="text-input"></select>
        <div id="ps-fields" class="ps-fields"></div>
        <button id="btn-ps-save" class="btn btn-big btn-primary">保存设置</button>
      </div>

      <div id="tab-records" class="tab-body" hidden>
        <label class="field-label">档案</label>
        <select id="pr-profile" class="text-input"></select>
        <label class="field-label">日期（可不选）</label>
        <input id="pr-date" class="text-input" type="date">
        <button id="btn-pr-load" class="btn btn-secondary">查看记录</button>
        <div id="pr-list" class="record-list"></div>
      </div>

      <div id="tab-summary" class="tab-body" hidden>
        <label class="field-label">档案</label>
        <select id="pm-profile" class="text-input"></select>
        <button id="btn-pm-load" class="btn btn-secondary">生成本周汇总</button>
        <div id="pm-body" class="pm-body"></div>
      </div>

      <div id="tab-misc" class="tab-body" hidden>
        <p class="field-label">导出（Excel 可打开）</p>
        <div class="row-buttons">
          <button id="btn-export-vocab" class="btn btn-secondary">生词本 CSV</button>
          <button id="btn-export-events" class="btn btn-secondary">查词记录 CSV</button>
        </div>
        <label class="field-label">家庭花园（两个档案的词种进同一个花园，只显示总数）</label>
        <button id="btn-family-garden" class="btn btn-secondary">打开</button>
        <button id="btn-parent-exit" class="btn btn-big btn-ghost">退出家长模式</button>
      </div>
    </section>

    <!-- 今天完成啦 -->
    <div id="done-overlay" class="overlay" hidden>
      <div class="overlay-card">
        <span class="overlay-star">🌈</span>
        <p class="overlay-title">今天完成啦！</p>
        <p class="overlay-text">可以休息一会儿了</p>
      </div>
    </div>

    <!-- 主题选择 -->
    <div id="theme-modal" class="overlay" hidden>
      <div class="overlay-card">
        <p class="overlay-title">选一个主题</p>
        <div class="row-buttons">
          <button id="btn-theme-simple" class="btn btn-big btn-secondary">简洁</button>
          <button id="btn-theme-garden" class="btn btn-big btn-secondary">花园</button>
        </div>
        <button id="btn-theme-close" class="btn btn-ghost">关闭</button>
      </div>
    </div>

    <!-- 应用内确认框（不能用系统 confirm：内嵌浏览器和 iPad 会屏蔽系统弹窗） -->
    <div id="confirm-modal" class="overlay" hidden>
      <div class="overlay-card">
        <p id="confirm-title" class="overlay-title"></p>
        <p id="confirm-text" class="overlay-text"></p>
        <div class="row-buttons">
          <button id="btn-confirm-cancel" class="btn btn-big btn-ghost">取消</button>
          <button id="btn-confirm-ok" class="btn btn-big btn-primary">确定</button>
        </div>
      </div>
    </div>

    <div id="toast" class="toast" hidden></div>

    <button id="parent-entry" class="parent-entry" title="家长模式">家长</button>
  </main>
  <script type="module" src="app.js?v=20260922b"></script>
</body>
</html>
````


---

## 📄 public/manifest.json

````json
{
  "name": "WordLock 查词器",
  "short_name": "WordLock",
  "start_url": "/",
  "display": "fullscreen",
  "background_color": "#faf6ee",
  "theme_color": "#faf6ee",
  "icons": [
    { "src": "icon-180.png", "sizes": "180x180", "type": "image/png" }
  ]
}
````


---

## 📄 public/sfx.js

````js
// 轻微的提示音效（需求 2.9），受档案的 soundEnabled 控制。
// 用 WebAudio 现场生成，不加载任何外部文件。

let ctx = null;

function getCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  return ctx;
}

export function unlockSFX() {
  const c = getCtx();
  if (c && c.state === 'suspended') c.resume();
}

function tone(freq, start, duration, gainValue = 0.06) {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(c.destination);
  const t0 = c.currentTime + start;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(gainValue, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

// 完成一小步：清脆的上升双音
export function playStepSound(enabled) {
  if (!enabled) return;
  try {
    tone(660, 0, 0.12);
    tone(880, 0.09, 0.16);
  } catch {}
}

// 学会一个词：短促的小庆祝三连音
export function playSuccessSound(enabled) {
  if (!enabled) return;
  try {
    tone(523, 0, 0.12);
    tone(659, 0.1, 0.12);
    tone(784, 0.2, 0.22);
  } catch {}
}

// 温和的提醒：柔和单音（不用刺耳的“错误音”）
export function playGentleSound(enabled) {
  if (!enabled) return;
  try {
    tone(440, 0, 0.2, 0.04);
  } catch {}
}
````


---

## 📄 public/state-machine.js

````js
// 输入阶段状态机（需求 2.1）：纯逻辑、不依赖界面。
// N（需要输入的次数）由服务器按门槛档位算好后传入。

export const MSG_INVALID = '只能输入英文字母哦';
export const MSG_NOT_FOUND = '词典里没有这个词，对照书上再看看拼写吧';
export const MSG_LENGTH = '字母个数不对，再数一数';

export function positionMessage(position) {
  return `第 ${position} 个字母再看看`;
}

// 归一化：去首尾空白、转小写、把连续空白折叠成一个空格
// ⚠️ 必须与 server/word-rules.js 保持一致（那边有同样的实现）
export function normalizeInput(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// 允许英文字母，以及词与词之间的空格/连字符/撇号（词典里有 "nice day"、"well-known"、"don't"）
export function isValidWordChars(word) {
  return /^[a-z]+(?:[ '-][a-z]+)*$/.test(word);
}

// 一个查词流程的输入阶段。生命周期：
//   英文入口：反复 firstInput(...) 直到词典命中成为目标词
//   中文入口：setTarget(...) 先定目标词（屏幕可见，从 0/N 开始）
//   → 反复 nextInput(...) 直到完成 N 次
//   → cancel() 可随时放弃重来。
export function createTypingSession({ requiredCount, mode = 'en', targetVisible = false }) {
  const n = Math.max(1, Math.floor(requiredCount) || 1);
  const state = {
    requiredCount: n,
    mode,               // 'en' | 'zh'
    targetVisible,      // 中文入口：目标词持续显示在屏幕上
    target: null,       // 命中的目标词（小写）
    completed: 0,
    notFoundStreak: 0,
    done: false,
  };

  // 中文入口：从候选列表点选后直接设定目标词，输入从 0/N 开始（需求 2.0/2.6）。
  function setTarget(word) {
    const w = normalizeInput(word);
    state.target = w;
    state.completed = 0;
    state.notFoundStreak = 0;
    state.done = false;
    return { status: 'progress', completed: 0, requiredCount: state.requiredCount, done: false, events: [] };
  }

  function snapshot(extra) {
    return {
      status: extra.status,
      completed: state.completed,
      requiredCount: state.requiredCount,
      done: state.done,
      events: extra.events ?? [],
      message: extra.message ?? '',
      suggestions: extra.suggestions,
      ...extra.extra,
    };
  }

  // 预检一次原始输入（首次输入前调用，不产生事件）。
  function prepare(raw) {
    const word = normalizeInput(raw);
    if (!word) return { ok: false, status: 'empty', message: '' };
    if (!isValidWordChars(word)) return { ok: false, status: 'invalid', message: MSG_INVALID };
    return { ok: true, word };
  }

  // 第一次输入：dictResult 是 /api/check-word 的返回值。
  function firstInput(raw, dictResult) {
    if (state.target) return snapshot({ status: 'error' }); // 已过首查阶段
    const pre = prepare(raw);
    if (!pre.ok) return snapshot({ status: pre.status, message: pre.message });

    if (dictResult && dictResult.exists) {
      state.target = normalizeInput(dictResult.word || pre.word);
      state.completed = 1;
      state.notFoundStreak = 0;
      const events = [{ type: 'typing_ok', word: state.target }];
      if (state.completed >= state.requiredCount) {
        state.done = true;
        events.push({ type: 'typing_done', word: state.target });
      }
      return snapshot({
        status: state.done ? 'done' : 'progress',
        events,
        extra: { target: state.done ? state.target : null },
      });
    }

    state.notFoundStreak += 1;
    const showSuggestions = state.notFoundStreak >= 2;
    return snapshot({
      status: 'not_found',
      message: MSG_NOT_FOUND,
      suggestions: showSuggestions ? dictResult?.suggestions ?? [] : undefined,
      events: [{ type: 'not_found', word: pre.word, detail: { streak: state.notFoundStreak } }],
    });
  }

  // 后续输入：必须与目标词完全一致（大小写、首尾空格忽略）。
  function nextInput(raw) {
    if (!state.target) return snapshot({ status: 'error' });
    const pre = prepare(raw);
    if (!pre.ok) return snapshot({ status: pre.status, message: pre.message });

    if (pre.word === state.target) {
      state.completed += 1;
      const events = [{ type: 'typing_ok', word: state.target }];
      if (state.completed >= state.requiredCount) {
        state.done = true;
        events.push({ type: 'typing_done', word: state.target });
      }
      return snapshot({
        status: state.done ? 'done' : 'progress',
        events,
        extra: { target: state.done ? state.target : null },
      });
    }

    // 提示但不泄露答案（需求 2.1）。
    let message;
    if (pre.word.length !== state.target.length) {
      message = MSG_LENGTH;
    } else {
      let pos = 1;
      for (let i = 0; i < pre.word.length; i++) {
        if (pre.word[i] !== state.target[i]) {
          pos = i + 1;
          break;
        }
      }
      message = positionMessage(pos);
    }
    return snapshot({
      status: 'wrong',
      message,
      events: [{ type: 'typing_wrong', word: state.target }],
    });
  }

  function isAwaitingFirst() {
    return state.target === null;
  }

  function cancel() {
    state.target = null;
    state.completed = 0;
    state.notFoundStreak = 0;
    state.done = false;
    return { status: 'cancelled' };
  }

  return { prepare, setTarget, firstInput, nextInput, isAwaitingFirst, cancel, getState: () => ({ ...state }) };
}

/* ---------- 跟读阶段状态机（需求 2.3 / 阶段 2）---------- */

// 累计通过 M 次（默认）或连续通过 M 次（readingMode='streak'，允许中间失败 streakTolerance 次）。
// 网络/超时/没声音等错误用 recordError()，不计入失败。
export function createReadingSession({
  requiredCount,
  passScore,
  helpAfterFails = 4,
  readingMode = 'cumulative',
  streakTolerance = 1,
}) {
  const m = Math.max(1, Math.floor(requiredCount) || 1);
  const state = {
    requiredCount: m,
    passScore,
    readingMode,
    passes: 0,
    fails: 0,
    totalAttempts: 0,
    toleratedUsed: 0,
    helpAfterFails: Math.max(1, Math.floor(helpAfterFails) || 4),
    assisted: false,
    done: false,
    bestScore: 0,
  };

  function starsFor(score, passed) {
    if (!passed) return 1;
    return score >= Math.min(100, state.passScore + 15) ? 3 : 2;
  }

  function snapshot(extra) {
    return {
      status: extra.status,
      stars: extra.stars ?? 0,
      passes: state.passes,
      fails: state.fails,
      totalAttempts: state.totalAttempts,
      done: state.done,
      canHelp: canHelp(),
      message: extra.message ?? '',
    };
  }

  function recordAttempt({ score, passed }) {
    state.totalAttempts += 1;
    state.bestScore = Math.max(state.bestScore, score ?? 0);
    if (passed) {
      state.passes += 1;
      if (state.passes >= state.requiredCount) state.done = true;
      return snapshot({ status: state.done ? 'done' : 'pass', stars: starsFor(score, true) });
    }
    state.fails += 1;
    if (state.readingMode === 'streak') {
      if (state.toleratedUsed < streakTolerance) {
        state.toleratedUsed += 1; // 容忍这次失败，已通过的次数保留
      } else {
        state.passes = 0; // 超出容忍额度，重新连
        state.toleratedUsed = 0;
      }
    }
    return snapshot({ status: 'fail', stars: 1 });
  }

  function recordError() {
    return snapshot({ status: 'error' });
  }

  function canHelp() {
    return !state.assisted && !state.done && state.fails >= state.helpAfterFails;
  }

  function useHelp() {
    if (!canHelp()) return snapshot({ status: 'error' });
    state.assisted = true;
    state.done = true;
    return snapshot({ status: 'done' });
  }

  function getPasses() {
    return state.passes;
  }

  return { recordAttempt, recordError, canHelp, useHelp, getPasses, getState: () => ({ ...state }) };
}
````


---

## 📄 public/styles.css

````css
/* WordLock 界面：大字、大按钮、极简、温和配色（需求 2.9：不用“错误/失败”字眼，不用红色叉号） */

* { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #faf6ee;
  --card: #ffffff;
  --ink: #3a3a3a;
  --ink-soft: #8a8378;
  --accent: #4a8fd4;
  --accent-dark: #3a76b2;
  --good: #58a65c;
  --gentle: #b98a2f;
  --gentle-bg: #fdf6e3;
  --radius: 22px;
}

html, body { height: 100%; }

body {
  font-family: -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  background: var(--bg);
  color: var(--ink);
  font-size: 20px;
  -webkit-tap-highlight-color: transparent;
}

body.theme-garden { --bg: #f2f8ec; }

#app {
  max-width: 560px;
  margin: 0 auto;
  padding: 20px 20px 48px;
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.view { display: flex; flex-direction: column; gap: 18px; }
.view[hidden] { display: none; }

.page-title { font-size: 34px; text-align: center; margin-top: 28px; }
.page-title-small { font-size: 26px; text-align: center; margin-top: 10px; }

/* 按钮 */
.btn {
  border: none;
  border-radius: var(--radius);
  font-size: 22px;
  padding: 16px 24px;
  cursor: pointer;
  font-family: inherit;
  color: var(--ink);
  background: #efe9dc;
  transition: transform 0.06s ease, filter 0.12s ease;
}
.btn:active { transform: scale(0.97); }
.btn-big { min-height: 72px; font-size: 26px; }
.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover { filter: brightness(1.05); }
.btn-secondary { background: #dcebf9; color: var(--accent-dark); }
.btn-ghost { background: transparent; color: var(--ink-soft); font-size: 18px; }
.btn-small { min-height: 44px; padding: 8px 16px; font-size: 16px; }
.btn-danger { background: #f3e0d3; color: #a4592f; }
.btn:disabled { opacity: 0.5; cursor: default; }
.btn-mic { background: var(--good); color: #fff; min-height: 88px; font-size: 28px; }
.btn-mic.recording { background: #c9803a; }
.btn-help { background: #eadff5; color: #6b4d9e; }
.btn-peek { background: #fdf0d3; color: #9a6b12; font-size: 18px; }

.row-buttons { display: flex; gap: 12px; }
.row-buttons .btn { flex: 1; }

/* 档案选择 */
.profile-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 14px;
}
.profile-card {
  background: var(--card);
  border: 3px solid transparent;
  border-radius: var(--radius);
  padding: 20px 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-family: inherit;
  font-size: 20px;
  color: var(--ink);
  box-shadow: 0 2px 10px rgba(90, 70, 40, 0.08);
  transition: transform 0.08s ease, border-color 0.12s ease;
}
.profile-card:active { transform: scale(0.96); }
.profile-card.selected { border-color: var(--accent); }
.profile-card .avatar { font-size: 52px; line-height: 1; }

.avatar-grid { grid-template-columns: repeat(4, 1fr); }

/* 创建档案 */
.field-label { font-size: 18px; color: var(--ink-soft); margin-top: 6px; }
.text-input {
  width: 100%;
  min-height: 64px;
  border: 2px solid #e5ddcc;
  border-radius: var(--radius);
  background: var(--card);
  font-size: 26px;
  padding: 12px 18px;
  font-family: inherit;
  color: var(--ink);
  text-align: center;
}
.text-input:focus { outline: none; border-color: var(--accent); }
.input-pin { letter-spacing: 12px; font-size: 34px; }

.preset-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.preset-card {
  background: var(--card);
  border: 3px solid transparent;
  border-radius: var(--radius);
  padding: 16px 10px;
  font-family: inherit;
  font-size: 19px;
  color: var(--ink);
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(90, 70, 40, 0.08);
}
.preset-card.selected { border-color: var(--accent); background: #f2f8ff; }
.preset-card small { display: block; color: var(--ink-soft); font-size: 14px; margin-top: 6px; }

/* 主界面 */
.topbar { display: flex; justify-content: space-between; align-items: center; }
.topbar-actions { display: flex; gap: 6px; }
.whoami { font-size: 20px; color: var(--ink-soft); }

.entry-chips { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.chip-link {
  border: none;
  border-radius: 999px;
  background: #ece5d6;
  color: var(--ink-soft);
  font-size: 15px;
  padding: 8px 14px;
  cursor: pointer;
  font-family: inherit;
}
.chip-link.hot { background: #dcebf9; color: var(--accent-dark); }

.main-hint { text-align: center; font-size: 22px; color: var(--ink-soft); margin-top: 10px; }

.dots { display: flex; justify-content: center; gap: 12px; margin-top: 8px; }
.dot {
  width: 22px; height: 22px;
  border-radius: 50%;
  background: #e8e0cf;
  transition: background 0.2s ease, transform 0.2s ease;
}
.dot.on { background: var(--good); transform: scale(1.15); }

.progress-text { text-align: center; font-size: 20px; color: var(--ink-soft); min-height: 28px; }

.feedback {
  text-align: center;
  font-size: 22px;
  padding: 14px 16px;
  border-radius: var(--radius);
  background: var(--gentle-bg);
  color: var(--gentle);
  line-height: 1.5;
}
.feedback.good { background: #eef7ee; color: var(--good); }

.input-word { font-size: 34px; letter-spacing: 2px; margin-top: 4px; }

.suggest-title { font-size: 20px; color: var(--ink-soft); margin-bottom: 10px; }
.chips { display: flex; flex-wrap: wrap; gap: 10px; }
.chip {
  border: none;
  border-radius: 999px;
  background: #dcebf9;
  color: var(--accent-dark);
  font-size: 22px;
  padding: 12px 22px;
  cursor: pointer;
  font-family: inherit;
}
.chip:active { transform: scale(0.95); }

/* 中文入口 */
.candidate-list { display: flex; flex-direction: column; gap: 12px; }
.candidate-card {
  display: flex;
  align-items: baseline;
  gap: 16px;
  background: var(--card);
  border: none;
  border-radius: var(--radius);
  padding: 18px 20px;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  box-shadow: 0 2px 10px rgba(90, 70, 40, 0.08);
  transition: transform 0.08s ease;
}
.candidate-card:active { transform: scale(0.98); }
.candidate-word { font-size: 30px; font-weight: 600; color: var(--ink); white-space: nowrap; }
.candidate-gloss { font-size: 18px; color: var(--ink-soft); line-height: 1.4; }
.candidate-learned { font-size: 14px; color: var(--good); white-space: nowrap; }

.zh-target-label { text-align: center; font-size: 20px; color: var(--ink-soft); }
.zh-target-word {
  text-align: center;
  font-size: 52px;
  font-weight: 600;
  color: var(--accent-dark);
  letter-spacing: 2px;
  word-break: break-word;
}

/* 展示读音 */
.pron-word {
  font-size: 64px;
  text-align: center;
  font-weight: 600;
  margin-top: 20px;
  word-break: break-word;
}
.pron-phonetic {
  text-align: center;
  font-size: 26px;
  color: var(--ink-soft);
  font-family: "Charis SIL", "Gentium", "Times New Roman", serif;
}

.celebration {
  text-align: center;
  margin-top: 10px;
  animation: pop 0.45s ease;
}
.celebration-star { font-size: 56px; display: inline-block; animation: bounce 0.9s ease infinite alternate; }
.celebration-text { font-size: 22px; color: var(--good); margin-top: 6px; }
@keyframes pop {
  0% { transform: scale(0.4); opacity: 0; }
  70% { transform: scale(1.08); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes bounce {
  from { transform: translateY(0); }
  to { transform: translateY(-8px); }
}

/* 跟读 */
.stars { text-align: center; font-size: 34px; min-height: 44px; }
.volume {
  width: 100%;
  height: 14px;
  background: #eee7d8;
  border-radius: 999px;
  overflow: hidden;
}
.volume-fill {
  height: 100%;
  width: 0%;
  background: var(--good);
  border-radius: 999px;
  transition: width 0.08s linear;
}

.dev-panel {
  background: #f4f0ff;
  border-radius: var(--radius);
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dev-note { font-size: 14px; color: #6b4d9e; }

/* 释义 */
.meaning-note { text-align: center; font-size: 20px; color: var(--good); }
.meaning-lines {
  background: var(--card);
  border-radius: var(--radius);
  padding: 20px 22px;
  font-size: 24px;
  line-height: 1.7;
  text-align: center;
  box-shadow: 0 2px 10px rgba(90, 70, 40, 0.08);
}

/* 复习 */
.review-ask { text-align: center; font-size: 20px; color: var(--ink-soft); }
.review-gloss {
  text-align: center;
  font-size: 32px;
  line-height: 1.6;
  background: var(--card);
  border-radius: var(--radius);
  padding: 22px;
  box-shadow: 0 2px 10px rgba(90, 70, 40, 0.08);
}

/* 生词本 */
.vocab-list { display: flex; flex-direction: column; gap: 10px; }
.vocab-row {
  background: var(--card);
  border-radius: 16px;
  padding: 14px 18px;
  display: flex;
  align-items: baseline;
  gap: 12px;
  box-shadow: 0 2px 8px rgba(90, 70, 40, 0.06);
}
.vocab-word { font-size: 24px; font-weight: 600; }
.vocab-phon { font-size: 16px; color: var(--ink-soft); }
.vocab-gloss { font-size: 17px; color: var(--ink-soft); flex: 1; }
.vocab-meta { font-size: 14px; color: var(--ink-soft); white-space: nowrap; }

/* 收藏册 */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
}
.word-card {
  background: linear-gradient(160deg, #fffdf6, #f6eedd);
  border-radius: 18px;
  padding: 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-shadow: 0 3px 10px rgba(90, 70, 40, 0.12);
}
.word-card .w { font-size: 24px; font-weight: 600; }
.word-card .p { font-size: 14px; color: var(--ink-soft); }
.word-card .g { font-size: 15px; color: var(--ink-soft); line-height: 1.4; }
.word-card .d { font-size: 13px; color: #b9ae99; }
.word-card .s { font-size: 16px; }

/* 花园 */
.garden-plot {
  position: relative;
  height: 300px;
  background: linear-gradient(#dff0fb 0%, #dff0fb 55%, #bfe3a8 55%, #a9d78e 100%);
  border-radius: var(--radius);
  overflow: hidden;
}
.plant { position: absolute; width: 64px; transform: translate(-50%, -100%); }
.plant.glow { animation: glow 1s ease 2; }
@keyframes glow {
  0% { filter: drop-shadow(0 0 0 #ffd76b); }
  50% { filter: drop-shadow(0 0 14px #ffd76b); }
  100% { filter: drop-shadow(0 0 0 #ffd76b); }
}
.watering { position: absolute; font-size: 40px; animation: pour 1.4s ease forwards; }
@keyframes pour {
  0% { transform: translateY(-80px); opacity: 0; }
  30% { opacity: 1; }
  100% { transform: translateY(60px); opacity: 0; }
}

/* 家长模式 */
.tab-row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.tab-btn {
  border: none;
  border-radius: 999px;
  background: #ece5d6;
  color: var(--ink-soft);
  font-size: 17px;
  padding: 10px 18px;
  cursor: pointer;
  font-family: inherit;
}
.tab-btn.selected { background: var(--accent); color: #fff; }
.tab-body[hidden] { display: none; }
.tab-body { display: flex; flex-direction: column; gap: 12px; }
.record-list { display: flex; flex-direction: column; gap: 6px; max-height: 46vh; overflow: auto; }
.record-row {
  display: flex;
  gap: 10px;
  font-size: 14px;
  color: var(--ink-soft);
  background: var(--card);
  border-radius: 10px;
  padding: 8px 12px;
}
.record-row .t { white-space: nowrap; }
.record-row .ty { font-weight: 600; color: var(--ink); }
.pm-body { display: flex; flex-direction: column; gap: 10px; }
.pm-item { background: var(--card); border-radius: 14px; padding: 12px 16px; font-size: 17px; line-height: 1.6; }
.pm-item b { color: var(--ink); }
.ps-fields { display: flex; flex-direction: column; gap: 10px; }
.ps-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.ps-row label { font-size: 17px; color: var(--ink); }
.ps-row input, .ps-row select {
  width: 180px;
  min-height: 44px;
  border: 2px solid #e5ddcc;
  border-radius: 12px;
  font-size: 17px;
  padding: 6px 10px;
  font-family: inherit;
  background: var(--card);
}

/* 家长模式入口：看得见、点一下就去输密码 */
.parent-entry {
  position: fixed;
  right: 12px;
  bottom: 12px;
  min-height: 48px;
  padding: 10px 20px;
  border: 2px solid #ded4c0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.94);
  color: #8a8378;
  font-family: inherit;
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-user-select: none;
  user-select: none;
  box-shadow: 0 2px 10px rgba(90, 70, 40, 0.14);
}
.parent-entry:active { transform: scale(0.95); }

/* 应用内提示条 */
.toast {
  position: fixed;
  left: 50%;
  bottom: 26px;
  transform: translateX(-50%);
  background: #3a3a3a;
  color: #fff;
  font-size: 18px;
  padding: 14px 22px;
  border-radius: 999px;
  z-index: 60;
  max-width: 88vw;
  text-align: center;
  box-shadow: 0 6px 24px rgba(40, 32, 20, 0.3);
}
.toast[hidden] { display: none; }

/* 覆盖层 */
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(60, 50, 30, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.overlay[hidden] { display: none; }
.overlay-card {
  background: var(--card);
  border-radius: 28px;
  padding: 34px 40px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 280px;
  box-shadow: 0 8px 40px rgba(60, 50, 30, 0.25);
}
.overlay-star { font-size: 52px; }
.overlay-title { font-size: 28px; }
.overlay-text { font-size: 19px; color: var(--ink-soft); }
````


---

## 📄 public/tts.js

````js
// 标准读音播放（需求 5.3）。
// 重要：浏览器返回的英文语音列表里，第一个往往是最老、最机械的那个（macOS 上是 Albert），
// 所以这里不取第一个，而是按「声音饱满的男声」优先级挑选；家长也可以在家长模式里指定。
// 以后可以换成预先生成的 mp3，界面不用改。

const PREFERRED_VOICES = {
  'en-US': ['Reed', 'Rocko', 'Ralph', 'Fred', 'Junior', 'Alex', 'Aaron', 'Tom'],
  'en-GB': ['Daniel', 'Reed', 'Rocko', 'Ralph', 'Fred', 'Alex'],
};

let unlocked = false;
let voices = [];

function refreshVoices() {
  try {
    voices = window.speechSynthesis?.getVoices() ?? [];
  } catch {
    voices = [];
  }
}

if (typeof window !== 'undefined' && window.speechSynthesis) {
  refreshVoices();
  window.speechSynthesis.onvoiceschanged = refreshVoices;
}

function normalizeLang(lang) {
  return String(lang ?? '').replace('_', '-');
}

// 给家长模式的下拉框用：列出这台设备上所有英文嗓音
export function listEnglishVoices() {
  if (!voices.length) refreshVoices();
  return voices
    .filter((v) => /^en/i.test(v.lang ?? ''))
    .map((v) => ({ name: v.name, lang: normalizeLang(v.lang) }))
    .sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
}

function findByNames(candidates, list) {
  for (const wanted of candidates) {
    const hit = list.find((v) => v.name.toLowerCase().startsWith(wanted.toLowerCase()));
    if (hit) return hit;
  }
  return null;
}

function pickVoice(accent, preferredName) {
  if (!voices.length) refreshVoices();
  const lang = accent === 'en-GB' ? 'en-GB' : 'en-US';
  const sameLang = voices.filter((v) => normalizeLang(v.lang) === lang);

  // 1) 家长指定的嗓音优先
  if (preferredName) {
    const exact = voices.find((v) => v.name.toLowerCase() === preferredName.toLowerCase());
    if (exact) return exact;
    const fuzzy = voices.find((v) => v.name.toLowerCase().startsWith(preferredName.toLowerCase()));
    if (fuzzy) return fuzzy;
  }
  // 2) 该口音下的饱满男声
  const preferred = findByNames(PREFERRED_VOICES[lang] ?? [], sameLang);
  if (preferred) return preferred;
  // 3) 同口音任意嗓音 → 任意英文嗓音
  return sameLang[0] ?? voices.find((v) => /^en/i.test(v.lang ?? '')) ?? null;
}

// iOS/ iPadOS 要求首次播放必须在用户点击里触发。
export function unlockTTS() {
  if (unlocked || typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    const u = new SpeechSynthesisUtterance('');
    window.speechSynthesis.speak(u);
    unlocked = true;
  } catch {
    // 忽略：解锁失败不影响后续手动播放
  }
}

export function speakWord(word, accent = 'en-US', voiceName = '') {
  if (typeof window === 'undefined' || !window.speechSynthesis || !word) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = accent === 'en-GB' ? 'en-GB' : 'en-US';
    u.rate = 0.8;
    const voice = pickVoice(u.lang, voiceName);
    if (voice) u.voice = voice;
    window.speechSynthesis.speak(u);
  } catch {
    // 播放失败不打扰孩子
  }
}
````


---

## 📄 scripts/build-dict.js

````js
// 词典构建脚本（需求 4）：
//   读取 data/raw/ 下的 ECDICT 原始文件（CSV 或 SQLite，不写死文件名，按表头自动识别列）
//   → 生成 data/dict.db（word / word_lower / phonetic / translation / tag / frq / len）
//
// 用法：npm run build-dict
//   也可指定路径：node scripts/build-dict.js --raw <目录> --out <文件>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

/* ---------- CSV 解析：支持带引号的字段（可含逗号、真实换行）、CRLF、BOM ---------- */

export class CsvParser {
  constructor(onRow) {
    this.onRow = onRow;
    this.buf = '';
    this.row = [];
    this.field = '';
    this.inQuotes = false;
    this.firstChunk = true;
  }

  push(chunk) {
    if (this.firstChunk) {
      if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1);
      this.firstChunk = false;
    }
    this.buf += chunk;
    let i = 0;
    const n = this.buf.length;
    while (i < n) {
      const ch = this.buf[i];
      if (this.inQuotes) {
        if (ch === '"') {
          if (this.buf[i + 1] === '"') { this.field += '"'; i += 2; continue; }
          this.inQuotes = false; i += 1; continue;
        }
        this.field += ch; i += 1; continue;
      }
      if (ch === '"') { this.inQuotes = true; i += 1; continue; }
      if (ch === ',') { this.endField(); i += 1; continue; }
      if (ch === '\n') { this.endRow(); i += 1; continue; }
      if (ch === '\r') {
        if (this.buf[i + 1] === '\n') i += 1;
        this.endRow(); i += 1; continue;
      }
      this.field += ch; i += 1;
    }
    this.buf = this.buf.slice(i);
  }

  end() {
    if (this.field !== '' || this.row.length) {
      this.row.push(this.field);
      this.field = '';
      const row = this.row;
      this.row = [];
      this.onRow(row);
    }
  }

  endField() {
    this.row.push(this.field);
    this.field = '';
  }

  endRow() {
    this.endField();
    const row = this.row;
    this.row = [];
    this.onRow(row);
  }
}

/* ---------- 通用处理 ---------- */

// translation 字段的换行可能是字面的 \n，也可能是真正的换行，统一成真正的换行（需求 4）。
export function normalizeTranslation(text) {
  return String(text ?? '').replace(/\\n/g, '\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

export function hasChinese(text) {
  return /[一-鿿]/.test(text);
}

const WANTED = ['word', 'phonetic', 'translation', 'tag', 'frq'];

// 按表头自动识别列（大小写不敏感；找不到 word / translation 就报错）。
export function mapColumns(headerRow) {
  const lower = headerRow.map((h) => String(h).trim().toLowerCase());
  const map = {};
  for (const name of WANTED) {
    const idx = lower.indexOf(name);
    if (idx === -1 && (name === 'word' || name === 'translation')) {
      throw new Error(`词典文件表头里找不到 ${name} 列，请确认下载的是 ECDICT 完整 CSV`);
    }
    map[name] = idx;
  }
  return map;
}

function toDictEntry(row, colMap) {
  const word = (row[colMap.word] ?? '').trim();
  const translation = normalizeTranslation(row[colMap.translation]);
  if (!word || !hasChinese(translation)) return null;
  const frq = parseInt(row[colMap.frq], 10);
  return {
    word,
    word_lower: word.toLowerCase(),
    phonetic: (row[colMap.phonetic] ?? '').trim(),
    translation,
    tag: (row[colMap.tag] ?? '').trim(),
    frq: Number.isFinite(frq) && frq > 0 ? frq : 0,
    len: word.length,
  };
}

const DICT_SCHEMA = `
  CREATE TABLE dict (
    word        TEXT PRIMARY KEY,
    word_lower  TEXT NOT NULL,
    phonetic    TEXT NOT NULL DEFAULT '',
    translation TEXT NOT NULL,
    tag         TEXT NOT NULL DEFAULT '',
    frq         INTEGER NOT NULL DEFAULT 0,
    len         INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_dict_word_lower ON dict(word_lower);
  CREATE TABLE zh_index (
    term  TEXT NOT NULL,
    word  TEXT NOT NULL,
    gloss TEXT NOT NULL,
    frq   INTEGER NOT NULL DEFAULT 0,
    hot   INTEGER NOT NULL DEFAULT 0,
    rank  INTEGER NOT NULL DEFAULT 3
  );
  CREATE INDEX idx_zh_term ON zh_index(term);
  -- 部分索引：「包含」档只在常用词里找，既快又不给孩子看不认识的词
  CREATE INDEX idx_zh_hot ON zh_index(term) WHERE hot = 1;
`;

/* ---------- 中文反查索引（需求 2.6 / 阶段 1B） ---------- */

// 清理一个释义片段：去掉括号注释、开头词性标记（n. / vt. / adj. …）、残留分隔符。
export function cleanTerm(fragment) {
  let t = String(fragment ?? '').trim();
  t = t.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');
  t = t.replace(/^(?:[a-zA-Z]{1,5}\.\s*&?\s*)+/g, '');
  t = t.replace(/^[、，,;；\s]+/g, '');
  t = t.replace(/[。．.\s]+$/g, '');
  return t.trim();
}

// translation → [{ term, gloss }]：先按行拆，再按 ；;，,、 拆片段。
// 跳过 [网络]/[医]/[化] 这类专业或网络来源的释义行：对中小学生是噪音
// （例如「水」会因此匹配到「[医] 调节, 适应, 安培 … 水, 水剂」这种条目）。
export function buildZhTerms(translation, maxTermLen = 24) {
  const out = [];
  const seen = new Set();
  for (const rawLine of String(translation ?? '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^\[[^\]]*\]/.test(line)) continue;
    const gloss = line.length > 80 ? line.slice(0, 79) + '…' : line;
    for (const rawFrag of line.split(/[；;，,、]/)) {
      const term = cleanTerm(rawFrag);
      if (!term || term.length > maxTermLen) continue;
      const key = term + '|' + gloss;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ term, gloss });
    }
  }
  return out;
}

// 只给「像正常英文词」的条目建反查索引：
// 词典里有 app. / a. / apel- / 12345 这类非词条，中文查词命中它们对孩子毫无意义。
// 必须以字母开头、以字母结尾（中间可以有连字符/撇号/空格）。
export function isIndexableWord(word) {
  return /^[a-zA-Z](?:[a-zA-Z'\- ]*[a-zA-Z])?$/.test(String(word ?? ''));
}

// 学生视角的常用度分档（越小越可能用得上）：
//   0 中高考词（tag 含 zk/gk）—— 正是教材和考卷里的词
//   1 四六级 / 考研 / 托福 / 雅思词
//   2 其他现代英语里真在用的词（有语料库词频）
//   3 生僻词（人名、地名、专业术语、古语；没有词频）
// 需求 2.6 明确要求「明显生僻的条目排在最后」，这里就是那个判据。
export function relevanceRank(tag, frq) {
  const tags = new Set(String(tag ?? '').toLowerCase().split(/\s+/).filter(Boolean));
  if (tags.has('zk') || tags.has('gk')) return 0;
  for (const t of ['cet4', 'cet6', 'ky', 'toefl', 'ielts']) {
    if (tags.has(t)) return 1;
  }
  return Number(frq) > 0 ? 2 : 3;
}

const ZH_INSERT = 'INSERT OR IGNORE INTO zh_index (term, word, gloss, frq, hot, rank) VALUES (?, ?, ?, ?, ?, ?)';

function zhRowsFor(word, frq, translation, tag) {
  if (!isIndexableWord(word)) return [];
  const hot = frq > 0 ? 1 : 0; // 有语料库词频 = 现代英语里真在用的词
  const rank = relevanceRank(tag, frq);
  return buildZhTerms(translation).map(({ term, gloss }) => [term, word, gloss, frq, hot, rank]);
}

function fillZhIndex(db) {
  const insert = db.prepare(ZH_INSERT);
  const page = db.prepare('SELECT rowid, word, frq, translation, tag FROM dict WHERE rowid > ? ORDER BY rowid LIMIT 20000');
  // 不能边遍历边插入（同一连接），按 rowid 分页读
  let lastRowid = 0;
  for (;;) {
    const rows = page.all(lastRowid);
    if (!rows.length) break;
    const insertBatch = db.transaction(() => {
      for (const row of rows) {
        for (const args of zhRowsFor(row.word, row.frq, row.translation, row.tag)) insert.run(...args);
      }
    });
    insertBatch();
    lastRowid = rows[rows.length - 1].rowid;
  }
  return db.prepare('SELECT COUNT(*) AS n FROM zh_index').get().n;
}

/* ---------- CSV / SQLite 两种来源 ---------- */

function buildFromCsvFile(db, filePath) {
  return new Promise((resolve, reject) => {
    const insert = db.prepare(
      `INSERT OR REPLACE INTO dict (word, word_lower, phonetic, translation, tag, frq, len)
       VALUES (@word, @word_lower, @phonetic, @translation, @tag, @frq, @len)`
    );
    let colMap = null;
    let readRows = 0;
    let kept = 0;
    let batch = [];
    const flush = db.transaction(() => {
      for (const entry of batch) insert.run(entry);
      batch = [];
    });

    const parser = new CsvParser((row) => {
      if (!colMap) {
        colMap = mapColumns(row);
        return;
      }
      readRows += 1;
      const entry = toDictEntry(row, colMap);
      if (entry) {
        kept += 1;
        batch.push(entry);
        if (batch.length >= 10000) flush();
        if (kept % 50000 === 0) console.log(`  已写入 ${kept} 条…`);
      }
    });

    // 不用 readline：带引号的多行字段要交给解析器自己处理换行
    fs.createReadStream(filePath, { encoding: 'utf8' })
      .on('data', (chunk) => parser.push(chunk))
      .on('end', () => {
        try {
          parser.end();
          flush();
          console.log(`  ${path.basename(filePath)}：读取 ${readRows} 行，保留 ${kept} 条`);
          resolve({ readRows, kept });
        } catch (err) {
          reject(err);
        }
      })
      .on('error', reject);
  });
}

function buildFromSqliteFile(db, filePath) {
  const src = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const tables = src
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    let tableName = null;
    let colMap = null;
    for (const t of tables) {
      const cols = src.prepare(`PRAGMA table_info(${JSON.stringify(t)})`).all().map((c) => c.name);
      const lower = cols.map((c) => c.toLowerCase());
      try {
        colMap = mapColumns(lower);
        tableName = t;
        break;
      } catch {
        continue;
      }
    }
    if (!tableName) {
      throw new Error('这个 SQLite 文件里找不到含 word / translation 列的表');
    }
    // 列名 → 查询时重命名为统一列名
    const cols = src.prepare(`PRAGMA table_info(${JSON.stringify(tableName)})`).all().map((c) => c.name);
    const selectParts = WANTED.map((name) => {
      const idx = colMap[name];
      return idx === -1 ? 'NULL' : `"${cols[idx]}"`;
    });
    const insert = db.prepare(
      `INSERT OR REPLACE INTO dict (word, word_lower, phonetic, translation, tag, frq, len)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    // .raw(true) 让每行是数组（按列序取值），否则 better-sqlite3 返回对象，按序号取会全是 undefined
    const rows = src.prepare(
      `SELECT ${selectParts.join(', ')} FROM "${tableName}"`
    ).raw(true);
    let kept = 0;
    let count = 0;
    const flushBatch = [];
    const flush = db.transaction(() => {
      for (const e of flushBatch) insert.run(...e);
      flushBatch.length = 0;
    });
    for (const row of rows.iterate()) {
      count += 1;
      const entry = toDictEntry(row, { word: 0, phonetic: 1, translation: 2, tag: 3, frq: 4 });
      if (entry) {
        kept += 1;
        flushBatch.push([entry.word, entry.word_lower, entry.phonetic, entry.translation, entry.tag, entry.frq, entry.len]);
        if (flushBatch.length >= 10000) flush();
        if (kept % 50000 === 0) console.log(`  已写入 ${kept} 条…`);
      }
    }
    flush();
    console.log(`  ${path.basename(filePath)}：读取 ${count} 行，保留 ${kept} 条`);
    return { readRows: count, kept };
  } finally {
    src.close();
  }
}

/* ---------- 主流程 ---------- */

export async function buildDict({ rawDir, outFile } = {}) {
  rawDir = rawDir ?? path.join(ROOT, 'data', 'raw');
  outFile = outFile ?? path.join(ROOT, 'data', 'dict.db');

  if (!fs.existsSync(rawDir)) {
    throw new Error(`没有找到词典目录 ${rawDir}。请先从 ECDICT 官方仓库下载词典文件放进这个目录（步骤见 README）。`);
  }
  const csvFiles = fs.readdirSync(rawDir).filter((f) => f.toLowerCase().endsWith('.csv')).sort();
  const sqliteFiles = fs.readdirSync(rawDir).filter((f) => /\.(db|sqlite|sqlite3)$/i.test(f)).sort();
  if (!csvFiles.length && !sqliteFiles.length) {
    throw new Error(`${rawDir} 里没有 .csv 或 .sqlite 文件。请先从 ECDICT 官方仓库下载词典文件（步骤见 README）。`);
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(outFile + suffix); } catch {}
  }

  console.log(`正在生成 ${outFile} …`);
  const db = new Database(outFile);
  try {
    db.exec(DICT_SCHEMA);
    const report = { readRows: 0, kept: 0 };
    for (const f of csvFiles) {
      const r = await buildFromCsvFile(db, path.join(rawDir, f));
      report.readRows += r.readRows;
      report.kept += r.kept;
    }
    if (!csvFiles.length) {
      const r = buildFromSqliteFile(db, path.join(rawDir, sqliteFiles[0]));
      report.readRows += r.readRows;
      report.kept += r.kept;
    }
    const zhCount = fillZhIndex(db);
    console.log(`完成：共保留 ${report.kept} 个带中文释义的词条，中文反查索引 ${zhCount} 条。`);
    report.zhCount = zhCount;
    return report;
  } finally {
    db.close();
  }
}

export async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 ? args[i + 1] : undefined;
  };
  try {
    await buildDict({ rawDir: opt('raw'), outFile: opt('out') });
  } catch (err) {
    console.error(`构建失败：${err.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
````


---

## 📄 scripts/make-certs.js

````js
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
````


---

## 📄 scripts/make-review-pack.js

````js
// 生成「审阅包」：把项目源码合成一个 Markdown 文件，方便上传给线上 AI（Claude / ChatGPT）审阅。
//
// 用法：
//   npm run review-pack           # 全量（默认）→ docs/REVIEW-PACK.md，供线上 AI 直接读仓库里的这一个文件
//   npm run review-pack -- --slim # 精简版（不含 57KB 的 public/app.js 与集成测试），适合上传到聊天窗口
//
// 安全：只读取下面列出的目录/扩展名；.env、certs/、data/ 一律不读；
// 生成后还会再扫一遍，若出现疑似密钥就报警并退出。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const full = !process.argv.includes('--slim'); // 默认全量
const outFile = path.join(root, 'docs', 'REVIEW-PACK.md');

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

> 这是一份可以**直接上传给 AI 助手，或在仓库里直接读这一个文件**的自包含快照。
> 上半部分是背景与审阅要求，下半部分是全部源码。请把它当作一次"代码评审"来做。
>
> ⚠️ 这是**某一时刻的快照**：判断问题时请以它为准，但若与仓库其它文件冲突，以具体源码文件为准。

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

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, header + parts.join(''), 'utf8');
console.log(`已生成 ${path.relative(root, outFile)}`);
console.log(`  包含 ${files.length} 个文件，源码约 ${Math.round(totalBytes / 1024)} KB`);
console.log(`  文件总大小约 ${Math.round(fs.statSync(outFile).size / 1024)} KB`);
if (!full) console.log('  提示：默认是全量版，去掉 --slim 即可');
````


---

## 📄 scripts/make-security-pack.js

````js
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

仓库共 132 个测试（其中 22 个标着「安全 N」）；其中 \`tests/integration.test.js\` 末尾有一组标着「安全 N」的回归用例，
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
````


---

## 📄 scripts/push-to-github.js

````js
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

// 提交说明用本地 HEAD 的标题+正文，这样仓库历史能看出每次改了什么
const headSubject = execSync('git log -1 --pretty=%s', { cwd: root, encoding: 'utf8' }).trim();
const headBody = execSync('git log -1 --pretty=%b', { cwd: root, encoding: 'utf8' }).trim();
const commit = await api(`${repoPath}/git/commits`, {
  method: 'POST',
  body: JSON.stringify({
    message:
      `${headSubject}\n\n${headBody}\n\n` +
      `（本提交由 npm run push-github 生成：包含仓库当前全部 ${files.length} 个文件，` +
      `对应本地提交 ${execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf8' }).trim()}）`,
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
````


---

## 📄 scripts/start-https.js

````js
// 用 HTTPS 启动（iPad 上要用麦克风就得走 HTTPS）。
// 用法：npm run start:https
// 与 npm start 的区别只有一个：把 HTTPS 打开。端口/证书路径也可以用 .env 覆盖。

process.env.HTTPS = process.env.HTTPS || '1';
await import('../server/index.js');
````


---

## 📄 scripts/try-scorer.js

````js
// 验证发音评测是否可用：用系统语音合成「念」几个单词，送给评测接口看分数。
// 用法：npm run try-scorer
//   念对的音应该拿高分；故意用另一个词冒充（banana 当成 apple）应该明显低分。
//
// 只依赖 macOS 自带的 say / afconvert（其它系统会提示跳过）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../server/env.js';

loadEnv();
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { getScorer, scorerIsConfigured } = await import('../server/scorers/index.js');

const CASES = process.argv.slice(2).length
  ? process.argv.slice(2).map((s) => {
      const [speak, target] = s.split(':');
      return { speak: speak.trim(), target: (target ?? speak).trim() };
    })
  : [
      { speak: 'apple', target: 'apple' },
      { speak: 'book', target: 'book' },
      { speak: 'water', target: 'water' },
      { speak: 'banana', target: 'apple' }, // 念错：预期明显低分
    ];

function checkTools() {
  const missing = ['say', 'afconvert'].filter((cmd) => spawnSync('which', [cmd], { encoding: 'utf8' }).status !== 0);
  return missing;
}

// 读 WAV 头，确认格式确实是 16kHz/16bit/单声道（讯飞对此很挑）
export function describeWav(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') return '不是 WAV 格式';
  return {
    format: `fmt 标记 ${buffer.readUInt16LE(20)}（1=PCM）`,
    channels: buffer.readUInt16LE(22),
    sampleRate: buffer.readUInt32LE(24),
    bitsPerSample: buffer.readUInt16LE(34),
    dataBytes: buffer.length - 44,
  };
}

// 用系统语音生成一段 16kHz/16bit/单声道 WAV（和浏览器录出来的格式一致）
function synthesize(text, outWav) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wordlock-say-'));
  const aiff = path.join(tmp, 'speech.aiff');
  const said = spawnSync('say', ['-r', '160', text, '-o', aiff], { encoding: 'utf8' });
  if (said.status !== 0) throw new Error(`say 失败：${said.stderr || said.error?.message}`);
  const converted = spawnSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', aiff, outWav], {
    encoding: 'utf8',
  });
  if (converted.status !== 0) throw new Error(`afconvert 失败：${converted.stderr || converted.error?.message}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  return outWav;
}

const missing = checkTools();
if (missing.length) {
  console.error(`这个验证工具需要 macOS 自带的 ${missing.join('、')}，当前系统上没有。`);
  console.error('你可以直接在浏览器里点麦克风念单词来验证：npm start 后打开 http://localhost:3000');
  process.exit(1);
}

const scorer = await getScorer();
console.log(`当前评测实现：${scorer.name}`);
if (!scorerIsConfigured(scorer.name)) {
  console.error('密钥还没配置好，请检查 .env 里的 XUNFEI_APP_ID / XUNFEI_API_KEY / XUNFEI_API_SECRET。');
  process.exit(1);
}

const outWav = path.join(root, 'certs', 'try-scorer.wav'); // 放在 certs 里（已被 git 忽略）
console.log('用例：念的词 → 评测的单词（前者和后者不一样时，分数应该明显低）\n');

let failures = 0;
for (const { speak, target } of CASES) {
  try {
    synthesize(speak, outWav);
    const wav = fs.readFileSync(outWav);
    const info = describeWav(wav);
    const started = Date.now();
    const result = await scorer.score(wav, target);
    const ms = Date.now() - started;
    if (result.error) {
      failures += 1;
      console.log(`念「${speak}」评「${target}」 → 出错：${result.error}  (${ms}ms)`);
      console.log(`   送出的音频：${JSON.stringify(info)}`);
      continue;
    }
    const d = result.detail ?? {};
    console.log(
      `念「${speak}」评「${target}」 → 总分 ${result.score}` +
        (d.accuracy != null ? `（准确 ${d.accuracy} / 流畅 ${d.fluency} / 完整 ${d.integrity}）` : '') +
        `  (${ms}ms)`
    );
  } catch (err) {
    failures += 1;
    console.log(`念「${speak}」评「${target}」 → 失败：${err.message}`);
  }
}

console.log(
  failures
    ? `\n有 ${failures} 个用例失败——如果都是网络/鉴权错误，请检查 .env 的密钥。`
    : '\n完成。念对的分明显高于念错的，就说明接好了 ✅'
);
````


---

## 📄 server/app.js

````js
// 应用装配：index.js（启动）与测试共用。

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDictDb, openUserDb } from './db.js';
import { createDictRouter } from './routes/dict.js';
import { createProfileRouter, createProfileMiddleware } from './routes/profile.js';
import { createEventsRouter } from './routes/events.js';
import { createSessionRouter } from './routes/session.js';
import { createScoreRouter } from './routes/score.js';
import { createVocabRouter } from './routes/vocab.js';
import { createChildRouter } from './routes/child.js';
import { createParentRouter } from './routes/parent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 启动前的评测配置检查：宁可起不来，也不要让孩子在用"随便念都能过"的模拟打分。
// 返回 null 表示没问题，否则返回一段中文说明。
export function scorerConfigProblem() {
  const name = (process.env.SCORER || 'mock').toLowerCase();
  const dev = (process.env.WORDLOCK_DEV ?? '') === '1';
  if (name === 'mock' && !dev) {
    return (
      '当前用的是"模拟打分"（SCORER=mock），孩子随便念都能通过，不能这样给孩子用。\n' +
      '  ① 正式使用：在 .env 里填好密钥并设 SCORER=xunfei\n' +
      '  ② 只是自己调试：在 .env 里加一行 WORDLOCK_DEV=1（明确声明这是开发模式）'
    );
  }
  if (name === 'xunfei') {
    const missing = ['XUNFEI_APP_ID', 'XUNFEI_API_KEY', 'XUNFEI_API_SECRET'].filter((k) => !process.env[k]);
    if (missing.length) return `SCORER=xunfei，但 .env 里缺：${missing.join('、')}`;
  }
  if (name === 'tencent') {
    const missing = ['TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY'].filter((k) => !process.env[k]);
    if (missing.length) return `SCORER=tencent，但 .env 里缺：${missing.join('、')}`;
  }
  return null;
}

export function createApp({ userDb, dictDb }) {
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  // 静态文件带 no-store：否则 Cloudflare 会给 .js/.css 套上 4 小时的边缘缓存，
  // 出现「服务器代码已更新、孩子那边还在跑旧版本」的怪现象（实测踩过：改了校验规则，
  // iPad 上仍然报旧提示）。这个应用很小，每次重新取一遍毫无压力。
  app.use(
    express.static(path.join(__dirname, '..', 'public'), {
      setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
    })
  );

  const requireProfile = createProfileMiddleware(userDb);
  app.use('/api', createProfileRouter(userDb, requireProfile));
  // 家长接口用自己的 PIN 鉴权，不要求先选档案
  app.use('/api', createParentRouter(userDb));
  // 之后的接口都需要已选择档案
  app.use('/api', requireProfile);
  // 所有正常接口
  app.use('/api', createEventsRouter(userDb));
  app.use('/api', createSessionRouter(userDb, () => dictDb));
  app.use('/api', createScoreRouter(userDb));
  app.use('/api', createVocabRouter(userDb, () => dictDb));
  app.use('/api', createChildRouter(userDb, () => dictDb));
  app.use('/api', createDictRouter({ getDictDb: () => dictDb, userDb }));

  // 没匹配到的接口：明确返回 JSON 404（而不是 HTML 错误页，也避免请求挂住）
  app.use('/api', (req, res) => res.status(404).json({ error: '没有这个接口' }));

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: '服务器开小差了，请再试一次' });
  });
  return app;
}

export function boot() {
  // 评测没配好就**拒绝启动**（放在 boot 里，任何入口点都绕不过去）
  const problem = scorerConfigProblem();
  if (problem) throw new Error(problem);

  const userDb = openUserDb();
  const dictDb = openDictDb();
  if (!dictDb) {
    console.warn('提示：还没有找到 data/dict.db，查词功能暂不可用。请先下载词典并运行 npm run build-dict（见 README）。');
  }

  const scorerName = (process.env.SCORER || 'mock').toLowerCase();
  const dev = (process.env.WORDLOCK_DEV ?? '') === '1';
  if (scorerName === 'mock') {
    console.warn(
      '\n⚠️  开发模式：评测用的是"模拟打分"，孩子说什么都会过，绝对不能这样给孩子用。\n' +
        '   正式使用请把 .env 里的 SCORER 改成 xunfei 并删掉 WORDLOCK_DEV。\n'
    );
  } else {
    console.log(`评测：${scorerName}（已配置）${dev ? '，⚠️ 但开着开发模式开关 WORDLOCK_DEV' : ''}`);
  }
  return { userDb, dictDb, app: createApp({ userDb, dictDb }) };
}
````


---

## 📄 server/db.js

````js
// 打开两个 SQLite 库：dict.db（词典，只读）和 user.db（用户数据）。

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.WORDLOCK_DATA_DIR || path.join(__dirname, '..', 'data');

export function dictDbPath() {
  return path.join(DATA_DIR, 'dict.db');
}

export function openDictDb() {
  const file = dictDbPath();
  if (!fs.existsSync(file)) return null;
  return new Database(file, { readonly: true, fileMustExist: true });
}

export function openUserDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(path.join(DATA_DIR, 'user.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      avatar        TEXT NOT NULL,
      preset        TEXT NOT NULL,
      settings_json TEXT NOT NULL DEFAULT '{}',
      created_at    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL,
      ts         TEXT NOT NULL,
      session_id TEXT,
      mode       TEXT NOT NULL DEFAULT 'en',
      word       TEXT,
      step       TEXT,
      type       TEXT NOT NULL,
      detail     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_profile_ts ON events(profile_id, ts);
    CREATE TABLE IF NOT EXISTS learn_sessions (
      profile_id  INTEGER NOT NULL,
      session_id  TEXT NOT NULL,
      word        TEXT,
      mode        TEXT NOT NULL DEFAULT 'en',
      typing_count INTEGER NOT NULL DEFAULT 0,
      typing_done INTEGER NOT NULL DEFAULT 0,
      read_pass   INTEGER NOT NULL DEFAULT 0,
      read_fail   INTEGER NOT NULL DEFAULT 0,
      read_attempts INTEGER NOT NULL DEFAULT 0,
      best_score  INTEGER NOT NULL DEFAULT 0,
      assisted    INTEGER NOT NULL DEFAULT 0,
      quick_peek  INTEGER NOT NULL DEFAULT 0,
      meaning_shown INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      PRIMARY KEY (profile_id, session_id)
    );
    CREATE TABLE IF NOT EXISTS vocab (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id      INTEGER NOT NULL,
      word            TEXT NOT NULL,
      entry_mode      TEXT NOT NULL DEFAULT 'en',
      status          TEXT NOT NULL DEFAULT 'learned',
      first_learned_at TEXT NOT NULL,
      assisted        INTEGER NOT NULL DEFAULT 0,
      typing_errors   INTEGER NOT NULL DEFAULT 0,
      read_attempts   INTEGER NOT NULL DEFAULT 0,
      best_score      INTEGER NOT NULL DEFAULT 0,
      stage           INTEGER NOT NULL DEFAULT 0,
      next_review_at  TEXT,
      review_correct  INTEGER NOT NULL DEFAULT 0,
      review_wrong    INTEGER NOT NULL DEFAULT 0,
      UNIQUE(profile_id, word)
    );
    CREATE INDEX IF NOT EXISTS idx_vocab_review ON vocab(profile_id, status, next_review_at);
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    -- 首次校准的分数样本：只由服务端写，客户端无法伪造（防止故意压低分数线）
    CREATE TABLE IF NOT EXISTS calibration_samples (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL,
      ts         TEXT NOT NULL,
      score      INTEGER NOT NULL,
      clean      INTEGER NOT NULL DEFAULT 1
    );
  `);
  // 并发加固：多设备（电脑 + iPad）同时用时不至于因锁竞争直接抛错
  db.pragma('busy_timeout = 5000');
  // 老库升级：老版本的 learn_sessions 没有这两列
  addColumnIfMissing(db, 'learn_sessions', 'typing_count', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'learn_sessions', 'best_score', 'INTEGER NOT NULL DEFAULT 0');
  return db;
}

function addColumnIfMissing(db, table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
````


---

## 📄 server/env.js

````js
// 读取项目根目录的 .env（不引入额外依赖）。已存在的环境变量不覆盖。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadEnv() {
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
````


---

## 📄 server/index.js

````js
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
````


---

## 📄 server/limits.js

````js
// 每日查词上限（需求 阶段4）：按“今天已开始输入的 distinct 词数”计算。

export function lookupLimitState(userDb, profileId, settings) {
  const limit = Math.max(0, Math.floor(settings.dailyLookupLimit ?? 0));
  if (limit === 0) return { allowed: true, remaining: null, limit: 0, usedToday: null };
  const row = userDb
    .prepare(
      `SELECT COUNT(DISTINCT word) AS n FROM events
       WHERE profile_id = ? AND type = 'typing_ok' AND date(ts, 'localtime') = date('now', 'localtime')`
    )
    .get(profileId);
  const used = row?.n ?? 0;
  return {
    allowed: used < limit,
    remaining: Math.max(0, limit - used),
    limit,
    usedToday: used,
  };
}
````


---

## 📄 server/presets.js

````js
// 两个预设的默认参数（需求 2.5）。
// 档案创建时选定预设；家长模式（阶段4）的修改会写进档案自己的 settings 覆盖项。

export const PRESETS = {
  primary: {
    label: '小学高年级（五年级）',
    gateLevel: 1,
    autoRamp: true,
    rampEveryActiveDays: 5,
    passScore: 60,
    helpAfterFails: 4,
    meaningLines: 2,
    reviewPerDay: 3,
    accent: 'en-US',
    dailyLookupLimit: 0,
    reviewIntervals: [1, 2, 7, 15, 30],
    readingMode: 'cumulative',
    streakTolerance: 1,
    soundEnabled: true,
    theme: 'simple',
    quickPeekPerDay: 0,
    calibrated: false, // 阶段2：首次跟读前的试一试是否做过
    ttsVoice: '',      // 标准读音的嗓音，空 = 自动挑饱满男声
  },
  middle: {
    label: '初中（初一）',
    gateLevel: 2,
    autoRamp: true,
    rampEveryActiveDays: 5,
    passScore: 70,
    helpAfterFails: 4,
    meaningLines: 3,
    reviewPerDay: 5,
    accent: 'en-US',
    dailyLookupLimit: 0,
    reviewIntervals: [1, 2, 7, 15, 30],
    readingMode: 'cumulative',
    streakTolerance: 1,
    soundEnabled: true,
    theme: 'simple',
    quickPeekPerDay: 0,
    calibrated: false,
    ttsVoice: '',
  },
};

export const AVATARS = ['🐱', '🐶', '🦊', '🐼', '🐸', '🦉', '🐳', '🦄'];

// settings_json 里只存「与预设不同的覆盖项」，读取时与预设合并，
// 这样以后给预设加新参数时，老档案也能自动拿到默认值。
export function mergeSettings(presetKey, overridesJson) {
  const preset = PRESETS[presetKey] ?? PRESETS.primary;
  let overrides = {};
  try {
    overrides = JSON.parse(overridesJson || '{}') || {};
  } catch {
    overrides = {};
  }
  const merged = {};
  for (const key of Object.keys(preset)) {
    if (key === 'label') continue;
    merged[key] = key in overrides && overrides[key] !== undefined ? overrides[key] : preset[key];
  }
  return merged;
}
````


---

## 📄 server/routes/child.js

````js
// 孩子侧的辅助接口：快速查看（阶段5）、学习天数（阶段6）、花园（阶段6）、主题选择。

import { Router } from 'express';
import { getProfileBundle, countActiveDays } from '../settings.js';
import { getLearnedWord, getVocabWord, graduateWord, todayLocal } from '../vocab.js';
import { lookupLimitState } from '../limits.js';
import { getSession, markMeaningShown, useHelp, useQuickPeek } from '../sessions.js';

export function createChildRouter(userDb, getDictDb) {
  const router = Router();
  const insertEvent = userDb.prepare(
    `INSERT INTO events (profile_id, ts, session_id, mode, word, step, type, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  function translationLines(word, maxLines) {
    const dictDb = getDictDb();
    if (!dictDb) return [];
    const row = dictDb
      .prepare('SELECT translation FROM dict WHERE word_lower = ? LIMIT 1')
      .get(word);
    if (!row?.translation) return [];
    return String(row.translation)
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, Math.max(1, maxLines));
  }

  // 快速查看（需求 阶段5）：服务器校验剩余次数；写入 pending 生词本
  router.post('/quick-peek', (req, res) => {
    const profileId = req.profile.id;
    const bundle = getProfileBundle(userDb, req.profile);
    const quota = Math.max(0, Math.floor(bundle.settings.quickPeekPerDay ?? 0));
    if (quota === 0) {
      return res.status(403).json({ error: '快速查看没有打开' });
    }
    const used = userDb
      .prepare(
        `SELECT COUNT(*) AS n FROM events
         WHERE profile_id = ? AND type = 'quick_peek' AND date(ts, 'localtime') = date('now', 'localtime')`
      )
      .get(profileId)?.n ?? 0;
    if (used >= quota) {
      return res.status(403).json({ error: '今天的快速查看已经用完啦' });
    }

    const word = String(req.body?.word ?? '').trim().toLowerCase().slice(0, 64);
    const sessionId = String(req.body?.sessionId ?? '').slice(0, 64) || null;
    const mode = req.body?.mode === 'zh' ? 'zh' : 'en';
    if (!/^[a-z'-]+$/.test(word)) {
      return res.status(400).json({ error: '词不对' });
    }

    // 必须绑定到「本会话正在查的那个词」：否则可以拿 apple 的会话去快速查看任意词
    const session = getSession(userDb, profileId, sessionId);
    if (!session || session.word !== word) {
      return res.status(403).json({ error: '这个会话不对应这个词，请重新开始' });
    }
    // 必须先至少真实输入过一次（服务端校验过的），否则等于"连一个字母都不用打就能看释义"。
    // 需求阶段5 把按钮放在"第 1 次输入成功后"，所以门槛就是 ≥1 次真实输入；
    // 中英文入口都要求，否则孩子只要声明 mode='zh' 就能绕过。
    if (session.typing_count < 1) {
      return res.status(403).json({ error: '要先把这个词输入一遍才能快速查看哦' });
    }

    // pending 的词不覆盖已学会的（需求 2.8 / 阶段5）
    const existing = getVocabWord(userDb, profileId, word);
    if (!existing || existing.status !== 'learned') {
      userDb
        .prepare(
          `INSERT INTO vocab (profile_id, word, entry_mode, status, first_learned_at)
           VALUES (?, ?, ?, 'pending', ?)
           ON CONFLICT(profile_id, word) DO UPDATE SET status = 'pending'`
        )
        .run(profileId, word, mode, new Date().toISOString());
    }

    const ts = new Date().toISOString();
    insertEvent.run(profileId, ts, sessionId, mode, word, 'typing', 'quick_peek', null);
    insertEvent.run(profileId, ts, sessionId, mode, word, 'meaning', 'meaning_shown', JSON.stringify({ quickPeek: true }));
    // 只有走完上面的额度校验、且会话绑定的是这个词，才由服务端写入放行标记
    useQuickPeek(userDb, profileId, session);
    markMeaningShown(userDb, profileId, session);

    const remaining = quota - used - 1;
    res.json({ ok: true, lines: translationLines(word, bundle.settings.meaningLines), remaining });
  });

  // 求助通关（需求 2.3）：由**服务端**确认「累计读不过 helpAfterFails 次」才放行。
  // 以前客户端发一条 help_used 事件就能通关（实测可绕过），现在必须服务端同意。
  router.post('/help', (req, res) => {
    const profileId = req.profile.id;
    const bundle = getProfileBundle(userDb, req.profile);
    const word = String(req.body?.word ?? '').trim().toLowerCase().slice(0, 64);
    const sessionId = String(req.body?.sessionId ?? '').slice(0, 64) || null;
    const session = getSession(userDb, profileId, sessionId);
    if (!session || session.word !== word) {
      return res.status(403).json({ error: '这个会话不对应这个词，请重新开始' });
    }
    if (session.typing_done !== 1) {
      return res.status(403).json({ error: '要先完成输入才能求助哦' });
    }
    if (session.assisted === 1) return res.json({ ok: true, assisted: true, alreadyHelped: true });

    const need = Math.max(1, Math.floor(bundle.settings.helpAfterFails ?? 4));
    if (session.read_fail < need) {
      return res.status(403).json({
        error: '再多试几次吧',
        remaining: need - session.read_fail,
      });
    }
    useHelp(userDb, profileId, session);
    insertEvent.run(profileId, new Date().toISOString(), sessionId, session.mode, word, 'reading', 'help_used', null);
    graduateWord(userDb, profileId, word, {
      settings: bundle.settings,
      assisted: true,
      readAttempts: session.read_attempts,
      bestScore: session.best_score,
    });
    res.json({ ok: true, assisted: true });
  });

  // 学习天数（需求 阶段6）：本周（近 7 天）与累计；不做断签清零
  router.get('/stats', (req, res) => {
    const profileId = req.profile.id;
    const weekRow = userDb
      .prepare(
        `SELECT COUNT(DISTINCT date(ts, 'localtime')) AS n FROM events
         WHERE profile_id = ? AND date(ts, 'localtime') >= date('now', 'localtime', '-6 days')`
      )
      .get(profileId);
    res.json({ weekDays: weekRow?.n ?? 0, totalDays: countActiveDays(userDb, profileId) });
  });

  // 花园（需求 阶段6）：自己的植物；家庭花园只给总数
  router.get('/garden', (req, res) => {
    const profileId = req.profile.id;
    const words = userDb
      .prepare("SELECT word, first_learned_at FROM vocab WHERE profile_id = ? AND status = 'learned' ORDER BY first_learned_at, id")
      .all(profileId)
      .map((r, i) => ({ word: r.word, slot: i }));
    const familyEnabled = userDb.prepare("SELECT value FROM meta WHERE key = 'family_garden'").get()?.value === '1';
    let familyTotal = null;
    if (familyEnabled) {
      familyTotal = userDb.prepare("SELECT COUNT(*) AS n FROM vocab WHERE status = 'learned'").get()?.n ?? 0;
    }
    res.json({ plants: words, total: words.length, familyEnabled, familyTotal });
  });

  // 孩子自己选主题（需求 阶段6：theme 由孩子选）
  router.post('/theme', (req, res) => {
    const theme = req.body?.theme === 'garden' ? 'garden' : 'simple';
    const row = req.profile;
    let overrides = {};
    try {
      overrides = JSON.parse(row.settings_json || '{}') || {};
    } catch {
      overrides = {};
    }
    overrides.theme = theme;
    userDb.prepare('UPDATE profiles SET settings_json = ? WHERE id = ?').run(JSON.stringify(overrides), row.id);
    res.json({ ok: true, theme });
  });

  return router;
}
````


---

## 📄 server/routes/dict.js

````js
// 词典查询接口（check-word / pronunciation / search-zh）。

import { Router } from 'express';
import { findSuggestions } from '../suggest.js';
import { searchZh } from '../zh-search.js';
import { getSession, sessionUnlocksPronunciation } from '../sessions.js';
import { WORD_RE, normalizeWord } from '../word-rules.js';
import { getLearnedWord } from '../vocab.js';
import { getProfileBundle } from '../settings.js';
import { lookupLimitState } from '../limits.js';

export function createDictRouter({ getDictDb, userDb }) {
  const router = Router();

  const normalize = normalizeWord;

  function lookup(db, wordLower) {
    return db
      .prepare(
        `SELECT word, phonetic FROM dict WHERE word_lower = ?
         ORDER BY CASE WHEN frq > 0 THEN 0 ELSE 1 END, frq ASC LIMIT 1`
      )
      .get(wordLower);
  }

  router.post('/check-word', (req, res) => {
    const db = getDictDb();
    if (!db) {
      return res.status(503).json({ error: '词典还没建立，请先运行 npm run build-dict（见 README）' });
    }
    const word = normalize(req.body?.word);
    if (!word || !WORD_RE.test(word)) {
      return res.json({ exists: false, word, suggestions: [] });
    }
    const row = lookup(db, word);
    if (row) {
      // 已学会的词再次查询不设门槛（需求 2.8）
      const learned = Boolean(getLearnedWord(userDb, req.profile.id, word));
      const bundle = getProfileBundle(userDb, req.profile);
      const limit = lookupLimitState(userDb, req.profile.id, bundle.settings);
      return res.json({ exists: true, word: row.word, learned, allowed: limit.allowed, remaining: limit.remaining });
    }
    const wantSuggestions = Boolean(req.body?.suggest);
    const suggestions = wantSuggestions ? findSuggestions(db, word) : [];
    res.json({ exists: false, word, suggestions, learned: false });
  });

  router.get('/pronunciation/:word', (req, res) => {
    const db = getDictDb();
    if (!db) {
      return res.status(503).json({ error: '词典还没建立，请先运行 npm run build-dict（见 README）' });
    }
    const word = normalize(req.params.word);
    if (!word || !WORD_RE.test(word)) {
      return res.status(404).json({ error: '词典里没有这个词' });
    }
    const row = lookup(db, word);
    if (!row) {
      return res.status(404).json({ error: '词典里没有这个词' });
    }
    // 服务器校验（需求 阶段3）：会话**绑定的是这个词**且输入已完成，或该词已学会
    const learned = getLearnedWord(userDb, req.profile.id, word);
    if (!learned) {
      const session = getSession(userDb, req.profile.id, req.get('X-Session-Id'));
      if (!sessionUnlocksPronunciation(session, word)) {
        return res.status(403).json({ error: '要先完成输入才能听读音哦' });
      }
    }
    // 音标字段可能为空：为空就不显示，前端不要自己编造音标（需求 2.2）。
    res.json({ word: row.word, phonetic: row.phonetic || '' });
  });

  // 中文查词（需求 2.6 / 阶段 1B）：不返回音标和完整释义。
  router.post('/search-zh', (req, res) => {
    const db = getDictDb();
    if (!db) {
      return res.status(503).json({ error: '词典还没建立，请先运行 npm run build-dict（见 README）' });
    }
    const query = String(req.body?.query ?? '');
    const bundle = getProfileBundle(userDb, req.profile);
    const limit = lookupLimitState(userDb, req.profile.id, bundle.settings);
    const results = searchZh(db, query, 8).map((item) => ({
      ...item,
      learned: Boolean(getLearnedWord(userDb, req.profile.id, String(item.word ?? '').toLowerCase())),
    }));
    res.json({ results, allowed: limit.allowed, remaining: limit.remaining });
  });

  return router;
}
````


---

## 📄 server/routes/events.js

````js
// 查词事件记录（需求 2.10）——**只记录，不授权**。
//
// 安全不变量：这个接口从前端接收数据，所以它绝不能改变任何门禁状态。
// 以前它会在收到 help_used 时直接把词判为「已学会」，等于让孩子自报「我用过求助了」
// 就能看到释义（实测可绕过）。现在：
//   - 会不会放行，只由 /api/session、/api/typing、/api/score、/api/help、/api/quick-peek
//     这些服务端能核实真实动作的接口决定；
//   - 这里只往 events 表写一行日志，供家长模式看记录与「放弃点」统计。

import { Router } from 'express';

// 这些事件不涉及任何放行，允许客户端上报（都是"孩子做了什么"的观察值）
const CLIENT_REPORTABLE = new Set([
  'lookup_start',
  'not_found',
  'cancel',
  'network_error',
  'read_retry', // 客户端因音量过低/重复录音而没提交给评测：只记录，不授权
  'quick_peek_request', // 只是"点了按钮"的记录；真正的放行看 /api/quick-peek
]);

export function createEventsRouter(userDb) {
  const router = Router();
  const insert = userDb.prepare(
    `INSERT INTO events (profile_id, ts, session_id, mode, word, step, type, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  router.post('/events', (req, res) => {
    const profileId = req.profile.id;
    const list = Array.isArray(req.body?.events) ? req.body.events : [req.body ?? {}];
    const ts = new Date().toISOString();
    const run = userDb.transaction(() => {
      for (const e of list) {
        const type = typeof e.type === 'string' ? e.type.slice(0, 64) : '';
        if (!type) continue;
        // 服务端负责的门禁事件不接受客户端上报（避免重复计数，也避免被伪造利用）
        if (!CLIENT_REPORTABLE.has(type)) continue;
        insert.run(
          profileId,
          ts,
          typeof e.sessionId === 'string' ? e.sessionId.slice(0, 64) : null,
          e.mode === 'zh' ? 'zh' : 'en',
          typeof e.word === 'string' ? e.word.slice(0, 64) : null,
          typeof e.step === 'string' ? e.step.slice(0, 32) : null,
          type,
          e.detail == null ? null : JSON.stringify(e.detail)
        );
      }
    });
    run();
    res.json({ ok: true, recorded: true });
  });

  return router;
}
````


---

## 📄 server/routes/parent.js

````js
// 家长模式（需求 阶段4）：PIN、档案管理、参数设置、记录、每周汇总、导出、家庭花园。

import { Router } from 'express';
import crypto from 'node:crypto';
import { PRESETS, AVATARS } from '../presets.js';
import { mergeSettings } from '../presets.js';
import { getProfileBundle } from '../settings.js';
import { todayLocal, effectiveIntervals, getVocabWord } from '../vocab.js';

const router = Router();

/* ---------- 访问令牌：服务重启后失效；页面空闲 30 分钟也要重新输密码 ---------- */

const SESSION_IDLE_MS = 30 * 60 * 1000;
const parentSessions = new Map(); // token → 最近一次使用时间

function issueToken() {
  const token = crypto.randomBytes(24).toString('hex');
  parentSessions.set(token, Date.now());
  return token;
}

function requireParent(req, res, next) {
  const token = String(req.get('X-Parent-Token') ?? '');
  const lastUsed = parentSessions.get(token);
  if (!lastUsed) {
    return res.status(401).json({ error: '请先输入家长密码' });
  }
  if (Date.now() - lastUsed > SESSION_IDLE_MS) {
    parentSessions.delete(token);
    return res.status(401).json({ error: '太久没操作，请重新输入家长密码' });
  }
  parentSessions.set(token, Date.now());
  next();
}

/* ---------- PIN 防暴力破解：失败次数入库，锁定时间逐步翻倍 ---------- */

const PIN_MAX_FAILS = 5;
const PIN_BASE_LOCK_MS = 30 * 1000;

function lockRemainingMs() {
  const until = Number(getMeta('pin_locked_until') ?? 0);
  return Math.max(0, until - Date.now());
}

function notePinFailure() {
  const fails = Number(getMeta('pin_fails') ?? 0) + 1;
  setMeta('pin_fails', String(fails));
  if (fails >= PIN_MAX_FAILS) {
    const rounds = Math.floor(fails / PIN_MAX_FAILS) - 1;
    const lockMs = PIN_BASE_LOCK_MS * 2 ** Math.max(0, rounds);
    setMeta('pin_locked_until', String(Date.now() + lockMs));
  }
  return fails;
}

function clearPinFailures() {
  setMeta('pin_fails', '0');
  setMeta('pin_locked_until', '0');
}

// 首次设置密码只允许在电脑本机操作，防止孩子抢先设一个只有他知道的密码
function isLocalRequest(req) {
  const ip = req.ip || req.socket?.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function getMeta(key) {
  return router.userDb.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
}

function setMeta(key, value) {
  router.userDb
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 32).toString('hex');
}

router.get('/parent/has-pin', (req, res) => {
  res.json({ hasPin: Boolean(getMeta('parent_pin_hash')) });
});

router.post('/parent/pin', (req, res) => {
  const pin = String(req.body?.pin ?? '');
  if (!/^\d{4,6}$/.test(pin)) {
    return res.status(400).json({ error: '密码需要是 4 到 6 位数字' });
  }
  if (getMeta('parent_pin_hash')) {
    return res.status(403).json({ error: '密码已经设置过了，请直接输入' });
  }
  if (!isLocalRequest(req)) {
    return res.status(403).json({
      error: '第一次设置家长密码请在运行服务的这台电脑上操作（浏览器打开 http://localhost:3000）',
    });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  setMeta('parent_pin_salt', salt);
  setMeta('parent_pin_hash', hashPin(pin, salt));
  clearPinFailures();
  res.json({ ok: true, token: issueToken() });
});

router.post('/parent/login', (req, res) => {
  const locked = lockRemainingMs();
  if (locked > 0) {
    return res.status(429).json({ error: `试的次数太多啦，请等 ${Math.ceil(locked / 1000)} 秒再试` });
  }
  const pin = String(req.body?.pin ?? '');
  const salt = getMeta('parent_pin_salt');
  const hash = getMeta('parent_pin_hash');
  if (!salt || !hash) return res.status(400).json({ error: '还没有设置密码' });
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(hashPin(pin, salt), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const fails = notePinFailure();
    const waitMs = lockRemainingMs();
    return res.status(waitMs > 0 ? 429 : 403).json({
      error: waitMs > 0
        ? `试的次数太多啦，请等 ${Math.ceil(waitMs / 1000)} 秒再试`
        : `密码不对，再试试（还可以试 ${Math.max(0, PIN_MAX_FAILS - fails)} 次）`,
    });
  }
  clearPinFailures();
  res.json({ ok: true, token: issueToken() });
});

/* ---------- 以下都需要家长令牌（只挂 /parent 路径，避免拦截其他 /api 路由） ---------- */
router.use('/parent', requireParent);

function profileIdParam(req) {
  return Number(req.params.id);
}

// 档案管理：改名 / 换头像 / 换预设
router.post('/parent/profiles/:id', (req, res) => {
  const id = profileIdParam(req);
  const row = router.userDb.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '没有这个档案' });
  const name = req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 20) : row.name;
  const avatar = req.body?.avatar !== undefined ? String(req.body.avatar) : row.avatar;
  const preset = req.body?.preset !== undefined ? String(req.body.preset) : row.preset;
  if (!name) return res.status(400).json({ error: '名字不能是空的' });
  if (!AVATARS.includes(avatar)) return res.status(400).json({ error: '头像不对' });
  if (!PRESETS[preset]) return res.status(400).json({ error: '预设不对' });
  router.userDb
    .prepare('UPDATE profiles SET name = ?, avatar = ?, preset = ? WHERE id = ?')
    .run(name, avatar, preset, id);
  res.json({ ok: true });
});

// 删除档案：连带删除全部数据（前端二次确认）
router.delete('/parent/profiles/:id', (req, res) => {
  const id = profileIdParam(req);
  const db = router.userDb;
  const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '没有这个档案' });
  db.transaction(() => {
    db.prepare('DELETE FROM events WHERE profile_id = ?').run(id);
    db.prepare('DELETE FROM vocab WHERE profile_id = ?').run(id);
    db.prepare('DELETE FROM learn_sessions WHERE profile_id = ?').run(id);
    db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
  })();
  res.json({ ok: true });
});

// 档案参数（需求 2.5 全部参数，保存后立即生效）
router.post('/parent/profiles/:id/settings', (req, res) => {
  const id = profileIdParam(req);
  const row = router.userDb.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '没有这个档案' });
  const patch = req.body && typeof req.body === 'object' ? req.body : {};
  const presetKeys = Object.keys(PRESETS[row.preset] ?? PRESETS.primary).filter((k) => k !== 'label');
  const overrides = JSON.parse(row.settings_json || '{}') || {};
  for (const key of presetKeys) {
    if (key in patch) overrides[key] = patch[key];
  }
  router.userDb.prepare('UPDATE profiles SET settings_json = ? WHERE id = ?').run(JSON.stringify(overrides), id);
  const fresh = router.userDb.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
  res.json({ ok: true, settings: getProfileBundle(router.userDb, fresh) });
});

// 查词记录：按档案 + 可选日期
router.get('/parent/records', (req, res) => {
  const id = Number(req.query.profile);
  const date = String(req.query.date ?? '');
  const db = router.userDb;
  let rows;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    rows = db
      .prepare(
        `SELECT ts, session_id, mode, word, step, type, detail FROM events
         WHERE profile_id = ? AND date(ts, 'localtime') = ? ORDER BY id DESC LIMIT 500`
      )
      .all(id, date);
  } else {
    rows = db
      .prepare(
        `SELECT ts, session_id, mode, word, step, type, detail FROM events
         WHERE profile_id = ? ORDER BY id DESC LIMIT 200`
      )
      .all(id);
  }
  res.json({ records: rows });
});

// 每周汇总（需求 阶段4，含放弃点统计 2.10）
router.get('/parent/summary', (req, res) => {
  const id = Number(req.query.profile);
  const db = router.userDb;
  const since = new Date(Date.now() - 6 * 86400000);
  since.setHours(0, 0, 0, 0);
  const sinceIso = since.toISOString();

  const events = db
    .prepare('SELECT ts, session_id, mode, word, step, type FROM events WHERE profile_id = ? AND ts >= ?')
    .all(id, sinceIso);

  const countType = (type) => events.filter((e) => e.type === type).length;
  const distinct = (list) => new Set(list.filter(Boolean)).size;

  const lookedUp =
    distinct(events.filter((e) => e.type === 'lookup_start' && e.mode === 'en').map((e) => e.word)) +
    distinct(events.filter((e) => e.type === 'typing_ok' && e.mode === 'zh').map((e) => e.word));

  const learnedRows = db
    .prepare(
      `SELECT word, assisted FROM vocab
       WHERE profile_id = ? AND status = 'learned' AND first_learned_at >= ?`
    )
    .all(id, sinceIso);

  // 卡得最久的词：按总尝试次数（输错 + 找不到 + 读不过）
  const attempts = new Map();
  for (const e of events) {
    if (!e.word) continue;
    if (['typing_wrong', 'not_found', 'read_fail'].includes(e.type)) {
      attempts.set(e.word, (attempts.get(e.word) ?? 0) + 1);
    }
  }
  const stuckTop = [...attempts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word, n]) => ({ word, attempts: n }));

  // 复习正确率
  const reviewOk = countType('review_ok');
  const reviewWrong = countType('review_wrong');

  // 放弃点统计：流程没到 meaning_shown 且最后一个事件超过 10 分钟 → 放弃在最后事件的 step
  const nowMs = Date.now();
  const bySession = new Map();
  for (const e of events) {
    if (!e.session_id) continue;
    if (!bySession.has(e.session_id)) bySession.set(e.session_id, []);
    bySession.get(e.session_id).push(e);
  }
  const giveUpByStep = {};
  let giveUpTotal = 0;
  for (const list of bySession.values()) {
    if (list.some((e) => e.type === 'meaning_shown')) continue;
    const last = list.reduce((a, b) => (a.ts > b.ts ? a : b));
    if (nowMs - new Date(last.ts).getTime() < 10 * 60 * 1000) continue; // 还在进行中
    const step = last.step || 'typing';
    giveUpByStep[step] = (giveUpByStep[step] ?? 0) + 1;
    giveUpTotal += 1;
  }
  const cancelByStep = {};
  for (const e of events) {
    if (e.type === 'cancel') {
      const step = e.step || 'typing';
      cancelByStep[step] = (cancelByStep[step] ?? 0) + 1;
    }
  }
  const merged = { ...giveUpByStep };
  for (const [step, n] of Object.entries(cancelByStep)) {
    merged[step] = (merged[step] ?? 0) + n;
  }
  const stepNames = { typing: '输入阶段', candidates: '候选列表', reading: '跟读阶段', meaning: '看释义', review: '复习' };
  const worstStep = Object.entries(merged).sort((a, b) => b[1] - a[1])[0];
  const giveUpConclusion = worstStep
    ? `孩子最容易在「${stepNames[worstStep[0]] ?? worstStep[0]}」放下查询（放弃或返回共 ${worstStep[1]} 次）`
    : '这段时间没有明显的放弃点，节奏刚刚好';

  res.json({
    since: sinceIso,
    lookedUp,
    learned: learnedRows.length,
    assisted: learnedRows.filter((r) => r.assisted).length,
    stuckTop,
    review: { ok: reviewOk, wrong: reviewWrong, accuracy: reviewOk + reviewWrong ? Math.round((reviewOk / (reviewOk + reviewWrong)) * 100) : null },
    giveUp: { byStep: giveUpByStep, cancelByStep, total: giveUpTotal, conclusion: giveUpConclusion },
  });
});

// CSV 导出（UTF-8 带 BOM，Excel 打开中文不乱码）
function csvResponse(res, filename, rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = rows.map((r) => r.map(esc).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + body + '\r\n');
}

router.get('/parent/export/vocab.csv', (req, res) => {
  const id = Number(req.query.profile);
  const rows = [
    ['word', 'entry_mode', 'status', 'first_learned_at', 'assisted', 'typing_errors', 'read_attempts', 'best_score', 'stage', 'next_review_at', 'review_correct', 'review_wrong'],
    ...router.userDb
      .prepare('SELECT * FROM vocab WHERE profile_id = ? ORDER BY id')
      .all(id)
      .map((r) => [r.word, r.entry_mode, r.status, r.first_learned_at, r.assisted, r.typing_errors, r.read_attempts, r.best_score, r.stage, r.next_review_at ?? '', r.review_correct, r.review_wrong]),
  ];
  csvResponse(res, `vocab-${id}.csv`, rows);
});

router.get('/parent/export/events.csv', (req, res) => {
  const id = Number(req.query.profile);
  const rows = [
    ['ts', 'session_id', 'mode', 'word', 'step', 'type', 'detail'],
    ...router.userDb
      .prepare('SELECT ts, session_id, mode, word, step, type, detail FROM events WHERE profile_id = ? ORDER BY id')
      .all(id)
      .map((r) => [r.ts, r.session_id ?? '', r.mode, r.word ?? '', r.step ?? '', r.type, r.detail ?? '']),
  ];
  csvResponse(res, `events-${id}.csv`, rows);
});

// 家庭花园开关（需求 阶段6，默认关）
router.get('/parent/family-garden', (req, res) => {
  res.json({ enabled: getMeta('family_garden') === '1' });
});

router.post('/parent/family-garden', (req, res) => {
  setMeta('family_garden', req.body?.enabled ? '1' : '0');
  res.json({ ok: true, enabled: Boolean(req.body?.enabled) });
});

export function createParentRouter(userDb) {
  router.userDb = userDb;
  return router;
}
````


---

## 📄 server/routes/profile.js

````js
// 档案接口（需求 2.7）与参数接口（需求 2.5）。

import { Router } from 'express';
import { PRESETS, AVATARS } from '../presets.js';
import { getProfileBundle } from '../settings.js';

export function createProfileMiddleware(userDb) {
  const stmt = userDb.prepare('SELECT * FROM profiles WHERE id = ?');
  return function requireProfile(req, res, next) {
    const id = Number(req.get('X-Profile-Id'));
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(401).json({ error: '请先选择档案' });
    }
    const profile = stmt.get(id);
    if (!profile) {
      return res.status(401).json({ error: '请先选择档案' });
    }
    req.profile = profile;
    next();
  };
}

export function createProfileRouter(userDb, requireProfile) {
  const router = Router();

  router.get('/profiles', (req, res) => {
    const rows = userDb.prepare('SELECT id, name, avatar, preset FROM profiles ORDER BY id').all();
    res.json({ profiles: rows });
  });

  router.post('/profiles', (req, res) => {
    const name = String(req.body?.name ?? '').trim().slice(0, 20);
    const avatar = String(req.body?.avatar ?? '');
    const preset = String(req.body?.preset ?? '');
    if (!name) return res.status(400).json({ error: '请填写名字' });
    if (!AVATARS.includes(avatar)) return res.status(400).json({ error: '请选择一个头像' });
    if (!PRESETS[preset]) return res.status(400).json({ error: '请选择一个预设' });
    const info = userDb
      .prepare('INSERT INTO profiles (name, avatar, preset, settings_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(name, avatar, preset, '{}', new Date().toISOString());
    const row = userDb
      .prepare('SELECT id, name, avatar, preset FROM profiles WHERE id = ?')
      .get(info.lastInsertRowid);
    res.status(201).json(row);
  });

  // 当前档案的生效参数（含门槛档位 → 输入/跟读次数）。
  router.get('/settings', requireProfile, (req, res) => {
    const bundle = getProfileBundle(userDb, req.profile);
    res.json({
      profile: {
        id: req.profile.id,
        name: req.profile.name,
        avatar: req.profile.avatar,
        preset: req.profile.preset,
      },
      ...bundle,
    });
  });

  return router;
}
````


---

## 📄 server/routes/score.js

````js
// 发音评测接口（需求 5.1 / 阶段 2）+ 首次校准。
//
// 安全不变量：
//   - 评分前必须确认：同一个档案、同一个会话、同一个词、**输入阶段已完成**。
//     否则客户端可以直接调 /api/score 跳过「输入 N 次」这道门槛。
//   - mockScore（模拟打分滑块）只在显式开发模式下生效，绝不作为安全边界。
//   - 校准分数线由**服务端**根据自己记录的分数算，不接受客户端上报的分数。

import { Router } from 'express';
import crypto from 'node:crypto';
import { getScorer, scorerIsConfigured } from '../scorers/index.js';
import { decideOutcome } from '../scoring-policy.js';
import { getProfileBundle, LEVEL_COUNTS } from '../settings.js';
import { getSession, recordReadingPass, recordReadingFail, getSession as readSession } from '../sessions.js';
import { graduateWord } from '../vocab.js';

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const CALIBRATION_MIN_SAMPLES = 2;
const CALIBRATION_CLAMP = [50, 75];

// 防"回放同一段录音"：产品的 M 次本意是"读 M 遍"，不是"同一遍提交 M 次"。
// 同一个会话里重复提交字节完全相同的音频不重复计入（通过和没通过都不重复计）。
//
// 两个容易写错的地方，别再改回去：
//   1. 记满之后必须**先进先出地丢掉最早的**，不能 `clear()` 全清 ——
//      全清等于"交够 N 段不同的录音，最早那段就被忘掉、可以再重放一次"。
//   2. 判重必须对**通过和失败都生效**，不能只在通过时判 ——
//      否则回放一段"没通过"的录音可以刷够 read_fail，白拿"求助通关"。
//
// 内存有两层上限：每个会话最多记 MAX_PER_SESSION 个指纹（超出丢最早的），
// 最多记 MAX_SESSIONS 个会话（超出丢最早进表的）；进程重启即清空。
const MAX_FINGERPRINTS_PER_SESSION = 64;
const MAX_SESSIONS = 200;
const audioFingerprints = new Map(); // key → string[]（按时间顺序）

function isRepeatedAudio(profileId, sessionId, buffer) {
  const key = `${profileId}:${sessionId}`;
  const hash = crypto.createHash('sha1').update(buffer).digest('hex');

  let seen = audioFingerprints.get(key);
  if (!seen) {
    seen = [];
    audioFingerprints.set(key, seen);
    if (audioFingerprints.size > MAX_SESSIONS) {
      // Map 保持插入顺序：删掉最早进入的那个会话
      audioFingerprints.delete(audioFingerprints.keys().next().value);
    }
  }
  if (seen.includes(hash)) return true;
  seen.push(hash);
  if (seen.length > MAX_FINGERPRINTS_PER_SESSION) seen.shift();
  return false;
}

const normalize = (s) => String(s ?? '').trim().toLowerCase();

export function createScoreRouter(userDb) {
  const router = Router();
  const insertEvent = userDb.prepare(
    `INSERT INTO events (profile_id, ts, session_id, mode, word, step, type, detail)
     VALUES (?, ?, ?, ?, ?, 'reading', ?, ?)`
  );
  const logEvent = (profileId, sid, word, type, detail) =>
    insertEvent.run(profileId, new Date().toISOString(), sid ?? null, 'en', word ?? null, type, detail ? JSON.stringify(detail) : null);

  // 模拟打分只允许在显式开发模式下使用
  const devMode = () => (process.env.WORDLOCK_DEV ?? '') === '1';

  router.post('/score', async (req, res) => {
    const profileId = req.profile.id;
    const bundle = getProfileBundle(userDb, req.profile);
    const passScore = Number(bundle.settings.passScore) || 60;
    const requiredReading = LEVEL_COUNTS[bundle.effectiveLevel].reading;

    const word = normalize(req.body?.word);
    const sessionId = String(req.body?.sessionId ?? '').slice(0, 64) || null;
    const isCalibration = Boolean(req.body?.calibration);

    /* ---- 门槛：会话必须存在、绑定同一个词、输入已完成 ---- */
    const session = isCalibration ? null : getSession(userDb, profileId, sessionId);
    if (!isCalibration) {
      if (!session || session.word !== word) {
        return res.status(403).json({ error: '这个会话不对应这个词，请重新开始' });
      }
      if (session.typing_done !== 1) {
        return res.status(403).json({ error: '要先完成输入才能跟读哦' });
      }
    }

    /* ---- 音频基本校验（不再因缺音频抛异常）---- */
    const audioBase64 = typeof req.body?.audioBase64 === 'string' ? req.body.audioBase64 : '';
    const buffer = audioBase64 ? Buffer.from(audioBase64, 'base64') : null;
    const mockScore = Number(req.body?.mockScore);
    const useMock = Number.isFinite(mockScore) && devMode();

    if (!useMock && (!buffer || buffer.length < 900)) {
      return res.json({ score: null, passed: false, error: 'too_quiet', message: '没听清，靠近一点再念一遍', retry: true });
    }
    if (buffer && buffer.length > MAX_AUDIO_BYTES) {
      return res.json({ score: null, passed: false, error: 'too_long', message: '录音有点长了，再试一次', retry: true });
    }

    const scorer = await getScorer();
    if (!scorerIsConfigured(scorer.name)) {
      return res.json({ score: null, passed: false, error: 'not_configured', message: '评测服务还没配置好' });
    }

    let result;
    try {
      result = await scorer.score(buffer, word, useMock ? { mockScore } : {});
    } catch (err) {
      console.warn(`[评测] ${scorer.name} 抛异常：${err.message}`);
      result = { score: null, detail: null, error: 'scorer_error' };
    }

    /* ---- 校准：只由服务端记录分数 ---- */
    if (isCalibration) {
      if (result.error || result.score == null) {
        const message = result.error === 'no_speech' ? '没听清，靠近一点再念一遍' : '评测没成功，再试一次';
        return res.json({ score: null, passed: false, error: result.error || 'scorer_error', message, retry: true });
      }
      userDb
        .prepare('INSERT INTO calibration_samples (profile_id, ts, score, clean) VALUES (?, ?, ?, ?)')
        .run(profileId, new Date().toISOString(), result.score, result.detail?.noisy || result.detail?.nonsense ? 0 : 1);
      return res.json({ score: result.score, passed: true, calibration: true, detail: null });
    }

    /* ---- 正常跟读 ---- */
    const outcome = decideOutcome(result, passScore);
    if (outcome.kind === 'retry') {
      return res.json({
        score: null,
        passed: false,
        error: result.error || 'bad_audio',
        message: outcome.message,
        retry: true,
        canHelp: session.read_fail >= bundle.settings.helpAfterFails,
      });
    }
    if (outcome.kind === 'error') {
      console.warn(`[评测] ${scorer.name} 失败：${result.error}`);
      return res.json({ score: null, passed: false, error: result.error || 'scorer_error', message: outcome.message });
    }

    // 重复提交同一段录音 → 通过和没通过都不重复计入（提示重念，不算失败）
    // 只在"通过"时判重是不够的：回放一段没通过的录音可以刷够 read_fail，白拿求助通关。
    if (buffer && isRepeatedAudio(profileId, sessionId, buffer)) {
      return res.json({
        score: null,
        passed: false,
        error: 'duplicate_audio',
        message: '这段录音和刚才一样，再念一遍吧',
        retry: true,
        canHelp: session.read_fail >= bundle.settings.helpAfterFails,
      });
    }

    // 只有真正跑完一次评测（通过或没通过）才计入状态
    if (outcome.passed) recordReadingPass(userDb, profileId, session, outcome.score);
    else recordReadingFail(userDb, profileId, session);
    logEvent(profileId, sessionId, word, outcome.passed ? 'read_pass' : 'read_fail', { score: outcome.score });

    let current = readSession(userDb, profileId, sessionId);
    // 读够 M 次 → 通关写入生词本
    if (current.read_pass >= requiredReading) {
      graduateWord(userDb, profileId, word, {
        settings: bundle.settings,
        assisted: Boolean(current.assisted),
        readAttempts: current.read_attempts,
        bestScore: current.best_score,
      });
    }
    current = readSession(userDb, profileId, sessionId);

    res.json({
      score: outcome.score,
      passed: outcome.passed,
      detail: result.detail ?? null,
      passes: current.read_pass,
      requiredCount: requiredReading,
      canHelp: !current.assisted && current.read_fail >= bundle.settings.helpAfterFails,
    });
  });

  /* ---------- 首次校准（需求 阶段2）---------- */

  // 开始校准：清掉旧样本（分数完全由服务端记录，客户端无法伪造）
  router.post('/calibration/start', (req, res) => {
    userDb.prepare('DELETE FROM calibration_samples WHERE profile_id = ?').run(req.profile.id);
    res.json({ ok: true });
  });

  // 结束校准：服务端算平均分 → passScore = clamp(round(avg − 15), 50, 75)
  // 有效样本不足 2 个（例如孩子敷衍、被拒识）→ 保留原分数线，避免被故意压低。
  router.post('/calibration/finish', (req, res) => {
    const profileId = req.profile.id;
    const skipped = Boolean(req.body?.skipped);
    const samples = userDb
      .prepare('SELECT score, clean FROM calibration_samples WHERE profile_id = ?')
      .all(profileId);
    const usable = samples.filter((s) => s.clean === 1 && Number.isFinite(s.score) && s.score > 0);

    let passScore = null;
    if (!skipped && usable.length >= CALIBRATION_MIN_SAMPLES) {
      const avg = usable.reduce((a, b) => a + b.score, 0) / usable.length;
      passScore = Math.min(CALIBRATION_CLAMP[1], Math.max(CALIBRATION_CLAMP[0], Math.round(avg - 15)));
    }

    const row = req.profile;
    let overrides = {};
    try {
      overrides = JSON.parse(row.settings_json || '{}') || {};
    } catch {
      overrides = {};
    }
    if (passScore != null) overrides.passScore = passScore;
    overrides.calibrated = true;
    userDb.prepare('UPDATE profiles SET settings_json = ? WHERE id = ?').run(JSON.stringify(overrides), profileId);
    userDb.prepare('DELETE FROM calibration_samples WHERE profile_id = ?').run(profileId);

    res.json({ ok: true, passScore, usedSamples: usable.length, totalSamples: samples.length });
  });

  return router;
}
````


---

## 📄 server/routes/session.js

````js
// 输入阶段的服务器验证（安全关键）。
//
// 为什么必须放在服务端：客户端可以改 JS、开 DevTools、直接调接口。
// 「输入 N 次」这道门槛如果由浏览器自己说了算，就等于没有门槛。
// 所以这里由服务端：① 绑定目标词 ② 自己比对每次输入 ③ 自己数够 N 次才放行。

import { Router } from 'express';
import { getProfileBundle, LEVEL_COUNTS } from '../settings.js';
import { WORD_RE, normalizeWord } from '../word-rules.js';
import { createSession, getSession, recordTypingSuccess } from '../sessions.js';

const normalize = normalizeWord;


// 输了但不对时，只告诉孩子「第几个字母再看看」——不泄露正确字母（需求 2.1）
export function hintFor(typed, target) {
  if (typed.length !== target.length) return { kind: 'length' };
  for (let i = 0; i < typed.length; i++) {
    if (typed[i] !== target[i]) return { kind: 'position', position: i + 1 };
  }
  return { kind: 'none' };
}

export function createSessionRouter(userDb, getDictDb) {
  const router = Router();
  const insertEvent = userDb.prepare(
    `INSERT INTO events (profile_id, ts, session_id, mode, word, step, type, detail)
     VALUES (?, ?, ?, ?, ?, 'typing', ?, ?)`
  );
  const logEvent = (profileId, sid, mode, word, type, detail) =>
    insertEvent.run(profileId, new Date().toISOString(), sid ?? null, mode, word ?? null, type, detail ? JSON.stringify(detail) : null);

  // 绑定目标词：英文入口在第 1 次查词命中后调用；中文入口在选中候选后调用。
  // 服务端自己查词典确认这个词真实存在，不信客户端。
  router.post('/session', (req, res) => {
    const dictDb = getDictDb();
    if (!dictDb) return res.status(503).json({ error: '词典还没建立' });

    const profileId = req.profile.id;
    const bundle = getProfileBundle(userDb, req.profile);
    const required = LEVEL_COUNTS[bundle.effectiveLevel].typing;

    const mode = req.body?.mode === 'zh' ? 'zh' : 'en';
    const word = normalize(req.body?.word);
    const sessionId = String(req.body?.sessionId ?? '');
    if (!word || !WORD_RE.test(word) || !sessionId) {
      return res.status(400).json({ error: '参数不对' });
    }
    const exists = dictDb.prepare('SELECT 1 FROM dict WHERE word_lower = ? LIMIT 1').get(word);
    if (!exists) return res.status(404).json({ error: '词典里没有这个词' });

    // 绑定会话永远从 0 次开始：**任何一次计数都必须经过 /api/typing 的服务端校验**。
    // （曾经这里会因 mode==='en' 白送 1 次，等于不真打字、只调一次这个接口就能让 N=1 完成。）
    // 需求 2.1 的"第 1 次输入算 1/N"仍然满足：前端绑定后会把刚输入的字符串交给 /api/typing 校验并计 1。
    const created = createSession(userDb, profileId, sessionId, { word, mode });
    if (!created.ok) {
      // 同一个会话被换词：拒绝（防「给容易的词过关后改词看释义」）
      return res.status(403).json({ error: '这个会话已经绑定了别的词，请重新开始' });
    }

    const session = created.session;
    const done = session.typing_done === 1;
    const completed = Math.min(session.typing_count, required);
    res.json({ ok: true, word: session.word, mode: session.mode, completed, requiredCount: required, done });
  });

  // 提交一次输入：服务端自己比对并计数
  router.post('/typing', (req, res) => {
    const profileId = req.profile.id;
    const bundle = getProfileBundle(userDb, req.profile);
    const required = LEVEL_COUNTS[bundle.effectiveLevel].typing;

    const sessionId = String(req.body?.sessionId ?? '');
    const typed = normalize(req.body?.typed);
    const session = getSession(userDb, profileId, sessionId);
    if (!session || !session.word) {
      return res.status(403).json({ error: '请先开始查这个词' });
    }
    if (!typed) return res.json({ ok: false, reason: 'empty' });
    if (!WORD_RE.test(typed)) {
      logEvent(profileId, sessionId, session.mode, session.word, 'typing_wrong', { reason: 'invalid_chars' });
      return res.json({ ok: false, reason: 'invalid_chars' });
    }
    if (typed !== session.word) {
      const hint = hintFor(typed, session.word);
      logEvent(profileId, sessionId, session.mode, session.word, 'typing_wrong', hint);
      return res.json({
        ok: false,
        reason: 'mismatch',
        hint: hint.kind === 'length' ? 'length' : hint.kind === 'position' ? 'position' : 'none',
        position: hint.position ?? null,
      });
    }

    const r = recordTypingSuccess(userDb, profileId, session, required);
    logEvent(profileId, sessionId, session.mode, session.word, 'typing_ok', { completed: r.completed });
    if (r.done) logEvent(profileId, sessionId, session.mode, session.word, 'typing_done', null);
    res.json({
      ok: true,
      completed: Math.min(r.completed, required),
      requiredCount: required,
      done: r.done,
    });
  });

  return router;
}
````


---

## 📄 server/routes/vocab.js

````js
// 释义 / 生词本 / 复习（需求 2.4、2.8、阶段 3）。

import { Router } from 'express';
import { getProfileBundle, LEVEL_COUNTS } from '../settings.js';
import { getSession, markMeaningShown, sessionUnlocksMeaning } from '../sessions.js';
import { normalizeWord as normalizeWordShared } from '../word-rules.js';
import {
  getVocabWord,
  getLearnedWord,
  learnedDaysAgo,
  dueWords,
  pendingWords,
  applyReviewResult,
  graduateWord,
} from '../vocab.js';

// 与会话/词典用同一套归一化（含空格折叠），否则门禁比对会错位
const normalizeWord = normalizeWordShared;

function translationLines(dictDb, word, maxLines) {
  const row = dictDb
    .prepare('SELECT translation FROM dict WHERE word_lower = ? ORDER BY CASE WHEN frq > 0 THEN 0 ELSE 1 END, frq ASC LIMIT 1')
    .get(word);
  if (!row || !row.translation) return [];
  return String(row.translation)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, Math.max(1, maxLines));
}

export function createVocabRouter(userDb, getDictDb) {
  const router = Router();
  const insertEvent = userDb.prepare(
    `INSERT INTO events (profile_id, ts, session_id, mode, word, step, type, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  function logEvent(profileId, e) {
    insertEvent.run(
      profileId,
      new Date().toISOString(),
      e.sessionId ?? null,
      e.mode ?? 'en',
      e.word ?? null,
      e.step ?? null,
      e.type,
      e.detail ? JSON.stringify(e.detail) : null
    );
  }

  // 释义（需求 2.4）：只有「本档案里已学会」或「本会话已完成输入 + 跟读达标/求助/快速查看」
  // 才返回。**必须同时满足：同一个档案、同一个会话、会话绑定的就是这个词**——
  // 否则「给 apple 通过后拿同一会话去问 banana 的释义」就能看遍整本字典（已实测的绕过）。
  router.get('/meaning/:word', (req, res) => {
    const profileId = req.profile.id;
    const bundle = getProfileBundle(userDb, req.profile);
    const word = normalizeWord(req.params.word);
    const dictDb = getDictDb();
    if (!dictDb) return res.status(503).json({ error: '词典还没建立' });

    const learned = getLearnedWord(userDb, profileId, word);
    const session = getSession(userDb, profileId, req.get('X-Session-Id'));
    const m = LEVEL_COUNTS[bundle.effectiveLevel].reading;
    if (!learned && !sessionUnlocksMeaning(session, word, m)) {
      return res.status(403).json({ error: '要先完成输入和跟读才能看释义哦' });
    }

    const lines = translationLines(dictDb, word, bundle.settings.meaningLines);
    logEvent(profileId, { sessionId: session?.session_id, word, type: 'meaning_shown', step: 'meaning' });
    markMeaningShown(userDb, profileId, session);
    res.json({
      word,
      lines,
      learnedDaysAgo: learned ? learnedDaysAgo(learned) : null,
    });
  });

  // 生词本列表（只读，阶段 3）
  router.get('/vocab', (req, res) => {
    const dictDb = getDictDb();
    const rows = userDb
      .prepare('SELECT * FROM vocab WHERE profile_id = ? ORDER BY first_learned_at DESC, id DESC')
      .all(req.profile.id);
    const words = rows.map((row) => {
      let phonetic = '';
      let gloss = '';
      if (dictDb) {
        const d = dictDb
          .prepare('SELECT phonetic, translation FROM dict WHERE word_lower = ? LIMIT 1')
          .get(row.word);
        phonetic = d?.phonetic ?? '';
        gloss = String(d?.translation ?? '').split('\n')[0]?.trim() ?? '';
      }
      return { ...row, phonetic, gloss };
    });
    res.json({ words });
  });

  // 今天要复习的词（需求 阶段3：每天最多 reviewPerDay 个）
  router.get('/review/today', (req, res) => {
    const bundle = getProfileBundle(userDb, req.profile);
    const dictDb = getDictDb();
    const rows = dueWords(userDb, req.profile.id, bundle.settings);
    const words = rows.map((row) => {
      const lines = dictDb ? translationLines(dictDb, row.word, bundle.settings.meaningLines) : [];
      return { word: row.word, gloss: lines.join('；'), assisted: row.assisted };
    });
    const pending = pendingWords(userDb, req.profile.id);
    res.json({ words, pendingCount: pending.length });
  });

  // 复习答题：显示中文释义 → 输入英文，1 次（需求 阶段3）
  router.post('/review/answer', (req, res) => {
    const profileId = req.profile.id;
    const bundle = getProfileBundle(userDb, req.profile);
    const word = normalizeWord(req.body?.word);
    const typed = normalizeWord(req.body?.typed);
    const row = getVocabWord(userDb, profileId, word);
    if (!row || row.status !== 'learned') {
      return res.status(404).json({ error: '这个词不在生词本里' });
    }
    const correct = typed === word && typed !== '';
    const updated = applyReviewResult(userDb, profileId, word, correct, bundle.settings);
    logEvent(profileId, {
      word,
      type: correct ? 'review_ok' : 'review_wrong',
      step: 'review',
      detail: { stage: updated?.stage },
    });
    res.json({
      correct,
      answer: word,
      stage: updated?.stage ?? 0,
      nextReviewAt: updated?.next_review_at ?? null,
    });
  });

  // 待巩固列表（阶段 5 的 pending 词）
  router.get('/pending', (req, res) => {
    const dictDb = getDictDb();
    const bundle = getProfileBundle(userDb, req.profile);
    const rows = pendingWords(userDb, req.profile.id);
    const words = rows.map((row) => {
      const lines = dictDb ? translationLines(dictDb, row.word, bundle.settings.meaningLines) : [];
      return { word: row.word, gloss: lines.join('；') };
    });
    res.json({ words });
  });

  // 待巩固完成：按当前门槛完整过一遍输入+跟读后，由 score 路由通关。
  // 这里提供直接查询：前端用来判断某个 pending 词是否已转正。
  router.get('/pending/:word/status', (req, res) => {
    const row = getVocabWord(userDb, req.profile.id, normalizeWord(req.params.word));
    res.json({ word: normalizeWord(req.params.word), status: row?.status ?? null });
  });

  // 兼容入口：把 pending 词标记通关（跟读走 score 路由自动处理，这里给 consolidate 手动兜底）
  router.post('/pending/:word/complete', (req, res) => {
    const bundle = getProfileBundle(userDb, req.profile);
    const word = normalizeWord(req.params.word);
    const row = getVocabWord(userDb, req.profile.id, word);
    if (!row || row.status !== 'pending') {
      return res.status(404).json({ error: '没有找到待巩固的这个词' });
    }
    const session = getSession(userDb, req.profile.id, req.get('X-Session-Id'));
    const m = LEVEL_COUNTS[bundle.effectiveLevel].reading;
    // 与释义接口同一套判定：必须同一个会话、绑定同一个词、输入与跟读都达标
    if (!sessionUnlocksMeaning(session, word, m)) {
      return res.status(403).json({ error: '要先完成输入和跟读' });
    }
    const updated = graduateWord(userDb, req.profile.id, word, {
      settings: bundle.settings,
      assisted: Boolean(row.assisted),
      readAttempts: session?.read_attempts ?? row.read_attempts,
    });
    res.json({ ok: true, status: updated.status });
  });

  return router;
}
````


---

## 📄 server/scorers/index.js

````js
// 按 .env 里的 SCORER 选择评测实现（需求 5.1）。

export function getScorer() {
  const name = (process.env.SCORER || 'mock').toLowerCase();
  const mod = name === 'tencent' ? 'tencent.js' : name === 'xunfei' ? 'xunfei.js' : 'mock.js';
  return import(`./${mod}`).then((m) => ({ name, score: m.score }));
}

export function scorerIsConfigured(name) {
  if (name === 'tencent') {
    return Boolean(process.env.TENCENT_SECRET_ID && process.env.TENCENT_SECRET_KEY);
  }
  if (name === 'xunfei') {
    return Boolean(process.env.XUNFEI_APP_ID && process.env.XUNFEI_API_KEY && process.env.XUNFEI_API_SECRET);
  }
  return true; // mock 永远可用
}
````


---

## 📄 server/scorers/mock.js

````js
// mock 评测器：开发/演示用，不看真实音频。
// - 前端在 ?dev=1 时会传 mockScore（模拟得分滑块），服务器照它打分；
// - 没传时给一个稳定的“读得不错”分数，方便走通流程。
// 正式使用请在 .env 里配置 SCORER=tencent 或 xunfei。

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function stableScore(targetWord) {
  let h = 0;
  for (const ch of String(targetWord || 'word')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 74 + (h % 18); // 74~91：mock 默认让流程能通过
}

export async function score(wavBuffer, targetWord, options = {}) {
  const provided = Number(options.mockScore);
  const value = Number.isFinite(provided)
    ? clamp(Math.round(provided), 0, 100)
    : stableScore(targetWord);
  return { score: value, detail: { mock: true }, error: null };
}
````


---

## 📄 server/scorers/tencent.js

````js
// 腾讯云口语评测（单词模式）—— 预留实现位。
//
// 需求规定：第三方接口的参数、签名、格式必须以官方最新文档为准，不要凭记忆写。
// 等拿到腾讯云密钥后，按 https://cloud.tencent.com/document/api/1093 的最新文档实现
// score(wavBuffer, targetWord, options) 并返回：
//   { score: 0-100 数字, detail: 原始返回(可null), error: 出错时给错误描述 }
// 需要的环境变量（写在 .env）：
//   TENCENT_SECRET_ID=...
//   TENCENT_SECRET_KEY=...
//   TENCENT_SOE_REGION=ap-guangzhou  （地域以控制台为准）

export async function score() {
  return {
    score: null,
    detail: null,
    error: '腾讯云评测还没接入：请在 .env 填好密钥后，让 Claude 按官方文档实现本文件',
  };
}
````


---

## 📄 server/scorers/xunfei.js

````js
// 讯飞开放平台「语音评测（ISE）」—— 英语单词模式。
//
// 本文件按官方文档实现（2026-09 核对）：
//   https://www.xfyun.cn/doc/Ise/IseAPI.html  （语音评测 流式版 API 文档）
// 要点：
//   - 地址：wss://ise-api.xfyun.cn/v2/open-ise
//   - 鉴权：HMAC-SHA256，签名串是 host/date/request-line 三行，再 base64 成 authorization
//   - 音频：16k、16bit、单声道 PCM，每帧 1280 字节（官方建议每 40ms 一帧）
//   - 流程：先发一帧 ssb（上传评测参数），再按 auw 逐帧发音频（首帧 aus=1、中间 aus=2、末帧 aus=4 且 status=2）
//   - 返回：data.data 是 base64 的 XML，里面 total_score 等就是分数
//
// 需要的环境变量（.env）：
//   XUNFEI_APP_ID / XUNFEI_API_KEY / XUNFEI_API_SECRET
//   可选：XUNFEI_GROUP（pupil/youth/adult，默认 pupil）、XUNFEI_CHECK_TYPE（easy/common/hard，默认 easy）

import crypto from 'node:crypto';

const HOST = 'ise-api.xfyun.cn';
const PATH = '/v2/open-ise';
const FRAME_BYTES = 1280;      // 官方建议：每帧 1280 字节
const FRAME_INTERVAL_MS = 40;  // 官方建议：每 40ms 一帧
const OVERALL_TIMEOUT_MS = 20000;

/* ---------- 鉴权 ---------- */

// 官方签名串（三行，冒号后有空格），apiSecret 做 HMAC-SHA256 再 base64。
export function signOrigin(date, apiSecret) {
  const origin = `host: ${HOST}\ndate: ${date}\nGET ${PATH} HTTP/1.1`;
  return crypto.createHmac('sha256', apiSecret).update(origin).digest('base64');
}

// 带鉴权参数的 wss 地址。spaced 控制 authorization 里逗号后是否带空格：
// 文档正文用的是不带空格的写法，而官方示例代码历史上用带空格的写法，两种都可能被接受，
// 所以保留这个开关，鉴权失败时换另一种重试。
export function buildAuthUrl({ apiKey, apiSecret, date = new Date().toUTCString(), spaced = false }) {
  const signature = signOrigin(date, apiSecret);
  const parts = [
    `api_key="${apiKey}"`,
    `algorithm="hmac-sha256"`,
    `headers="host date request-line"`,
    `signature="${signature}"`,
  ];
  const authOrigin = parts.join(spaced ? ', ' : ',');
  const authorization = Buffer.from(authOrigin).toString('base64');
  const query = new URLSearchParams({ host: HOST, date, authorization });
  return `wss://${HOST}${PATH}?${query.toString()}`;
}

/* ---------- 音频处理 ---------- */

// 读出 WAV 的格式（不是 WAV 就返回 null）
export function readWavFormat(buffer) {
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= buffer.length) {
      return {
        formatTag: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

// 取出裸 PCM 数据。不能写死"跳过 44 字节"——WAV 里可能有 LIST/fact 等额外块，
// afconvert 生成的 WAV 就带 LIST 块，写死偏移会把块头当成音频，讯飞直接报 48195 格式不符。
export function extractPcm(buffer) {
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return buffer; // 已经是裸 PCM
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'data') return buffer.subarray(body, Math.min(body + size, buffer.length));
    offset = body + size + (size % 2);
  }
  return buffer.subarray(Math.min(44, buffer.length)); // 兜底
}

// 切成 1280 字节一帧，并标好 aus（1 首帧 / 2 中间 / 4 末帧）和 status（0 / 1 / 2）。
export function buildAudioFrames(pcm, frameBytes = FRAME_BYTES) {
  const frames = [];
  for (let offset = 0; offset < pcm.length; offset += frameBytes) {
    const chunk = pcm.subarray(offset, Math.min(offset + frameBytes, pcm.length));
    const isFirst = offset === 0;
    const isLast = offset + frameBytes >= pcm.length;
    frames.push({
      data: chunk,
      aus: isFirst ? 1 : isLast ? 4 : 2,
      status: isFirst && isLast ? 2 : isFirst ? 0 : isLast ? 2 : 1,
    });
  }
  return frames;
}

/* ---------- 结果解析 ---------- */

function attr(xml, name) {
  const m = xml.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

export function parseResultXml(xml) {
  const num = (name) => {
    const v = attr(xml, name);
    if (v == null || v === '') return null; // 注意 Number(null) 是 0，会假装成 0 分
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    total: num('total_score'),
    // 官方文档里把 accuracy 写成了 accuracy_socre（原文如此），两种都认
    accuracy: num('accuracy_score') ?? num('accuracy_socre'),
    fluency: num('fluency_score'),
    integrity: num('integrity_score'),
    phone: num('phone_score'),
    tone: num('tone_score'),
    standard: num('standard_score'),
    rejected: attr(xml, 'is_rejected') === 'true',
    exceptInfo: num('except_info'),
    dpMessage: attr(xml, 'dp_message'),
  };
}

// 讯飞单词评测的原始分是 0~5 分制。官方 FAQ 给了对照表：
//   4.3~5 分 = 86~100 分（优）｜3.5~4.2 = 70~85（良）｜2.5~3.4 = 50~69（中）
//   1.5~2.4 = 30~49（差）｜0~1.4 = 0~29（很差）
// 本应用统一用 0~100（通过线 60/70 也是按这个来的），所以要乘 20。
export function toHundredScale(raw) {
  if (raw == null) return null;
  return Math.max(0, Math.min(100, Math.round(raw * 20)));
}

// except_info 的含义（官方文档）：
//   0     无异常
//   28673 无语音输入或音量太小      → 没念/太小声：不计入失败
//   28676 检测到语音为乱说类型      → 读的是别的词：算一次失败
//   28680 信噪比太低（1.7 以下）    → 环境太吵
//   28709 信噪比太低（0.7 以下）    → 环境太吵
//   28690 音频出现截幅              → 录音爆了（设备/距离问题）
const NO_SPEECH_EXCEPT = 28673;
const NOISY_EXCEPTS = new Set([28680, 28709, 28690]);

// 分类结果，具体的处置（算不算失败）交给 scoring-policy
export function classifyResult(parsed) {
  if (parsed.exceptInfo === NO_SPEECH_EXCEPT) return 'no_speech';
  if (NOISY_EXCEPTS.has(parsed.exceptInfo)) return 'noisy';
  if (parsed.rejected) return 'nonsense'; // 乱读：官方说此时分数不可信，按失败处理
  if (parsed.total == null) return 'no_speech';
  return 'ok';
}

/* ---------- 主流程 ---------- */

// 英文题型的「试题」有固定写法：首行是标记，之后每行一个单词。
// 见《语音评测试题格式及结果说明》：read_word → 首行 [word]；read_sentence → 首行 [content]。
// 直接发裸单词会被判为「试题格式错误」并报 48195，所以这里必须拼上标记。
export function buildExamText(word, category = 'read_word') {
  const marker = category === 'read_sentence' ? '[content]' : '[word]';
  return `﻿${marker}\n${word}`; // 官方要求带 BOM 的 UTF-8
}

function businessFor(cmd, word, aus) {
  // 含空格的短语（"nice day"）用句子模式：单词模式下讯飞评不准，且试题标记不同
  const category = /\s/.test(word) ? 'read_sentence' : 'read_word';
  const business = {
    sub: 'ise',
    ent: 'en_vip',           // 英文评测
    category,
    cmd,
    text: buildExamText(word, category),
    tte: 'utf-8',
    ttp_skip: true,          // 跳过文本上传阶段
    aue: 'raw',              // 裸 PCM
    auf: 'audio/L16;rate=16000',
    rst: 'entirety',
    ise_unite: '0',
    plev: '0',
    group: process.env.XUNFEI_GROUP || 'pupil',        // 小学生
    check_type: process.env.XUNFEI_CHECK_TYPE || 'easy', // 评分宽松一些
  };
  if (aus !== undefined) business.aus = aus;
  return business;
}

function evaluateOnce({ url, appId, pcm, word }) {
  const debug = process.env.XUNFEI_DEBUG === '1';
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {}
      resolve(value);
    };

    const timer = setTimeout(() => finish({ error: '讯飞评测超时，请再试一次' }), OVERALL_TIMEOUT_MS);
    let socket;
    try {
      socket = new WebSocket(url);
    } catch (err) {
      clearTimeout(timer);
      return resolve({ error: `连不上讯飞：${err.message}` });
    }

    socket.addEventListener('error', () => finish({ error: '连不上讯飞，请检查网络' }));
    socket.addEventListener('close', () => finish({ error: '讯飞连接被关闭' }));

    socket.addEventListener('open', async () => {
      // 第 1 帧：上传评测参数（不带音频）
      if (debug) console.log('[讯飞] 连接已建立，发送 ssb');
      socket.send(
        JSON.stringify({
          common: { app_id: appId },
          business: businessFor('ssb', word),
          data: { status: 0, data: '' },
        })
      );
      // 给服务端一点时间把参数准备好，再开始推音频（立刻推会被拒：iSEInputAppend error）
      await new Promise((r) => setTimeout(r, 250));
      // 之后逐帧送音频，按官方建议 40ms 一帧
      for (const frame of buildAudioFrames(pcm)) {
        if (settled) return;
        socket.send(
          JSON.stringify({
            common: { app_id: appId },
            business: businessFor('auw', word, frame.aus),
            data: { status: frame.status, data: frame.data.toString('base64') },
          })
        );
        await new Promise((r) => setTimeout(r, FRAME_INTERVAL_MS));
      }
    });

    socket.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
      } catch {
        return;
      }
      if (debug) {
        const brief = { ...msg, data: msg.data ? { ...msg.data, data: msg.data.data ? `<${String(msg.data.data).length} 字节>` : '' } : undefined };
        console.log('[讯飞] 收到：', JSON.stringify(brief).slice(0, 300));
      }
      if (msg.code !== 0) {
        const hint = msg.code === 10313 ? 'APPID 和密钥不匹配，请检查 .env' : msg.message || '讯飞返回错误';
        return finish({ error: `讯飞评测失败（${msg.code}）：${hint}` });
      }
      if (msg.data?.status !== 2 || !msg.data?.data) return; // 还没结束
      let xml;
      try {
        xml = Buffer.from(msg.data.data, 'base64').toString('utf8');
      } catch {
        return finish({ error: '讯飞返回的结果看不懂' });
      }
      if (debug) console.log('[讯飞] 最终结果 XML：', xml.slice(0, 800));
      const parsed = parseResultXml(xml);
      const kind = classifyResult(parsed);
      if (kind === 'no_speech') {
        return finish({ error: 'no_speech', detail: { ...parsed } });
      }
      if (kind === 'nonsense') {
        // 孩子读的不是这个词：官方说这时分数不可信，按一次失败的低分处理
        return finish({ score: 0, detail: { ...parsed, rawScore: parsed.total, nonsense: true } });
      }
      finish({
        score: toHundredScale(parsed.total),
        detail: { ...parsed, rawScore: parsed.total, noisy: kind === 'noisy' },
      });
    });
  });
}

export async function score(wavBuffer, targetWord) {
  const appId = process.env.XUNFEI_APP_ID;
  const apiKey = process.env.XUNFEI_API_KEY;
  const apiSecret = process.env.XUNFEI_API_SECRET;
  if (!appId || !apiKey || !apiSecret) {
    return { score: null, detail: null, error: '还没在 .env 里填写讯飞的 APPID / APIKey / APISecret' };
  }
  const word = String(targetWord ?? '').trim();
  if (!word) return { score: null, detail: null, error: '没有要评测的单词' };

  const format = readWavFormat(wavBuffer);
  if (format && (format.sampleRate !== 16000 || format.bitsPerSample !== 16 || format.channels !== 1)) {
    console.warn(
      `[评测] 音频格式不是 16kHz/16bit/单声道（当前 ${format.sampleRate}Hz/${format.bitsPerSample}bit/${format.channels}声道），讯飞可能拒绝`
    );
  }
  const pcm = extractPcm(wavBuffer);
  if (pcm.length < 1600) return { score: null, detail: null, error: 'no_speech' };

  // 文档正文与历史示例的 authorization 写法略有差异，先按文档、失败再换一种
  for (const spaced of [false, true]) {
    const url = buildAuthUrl({ apiKey, apiSecret, spaced });
    const result = await evaluateOnce({ url, appId, pcm, word });
    const authFailed = result.error && /(11200|401|unauthorized|鉴权)/i.test(result.error);
    if (!authFailed) return result;
  }
  return { score: null, detail: null, error: '讯飞鉴权没通过，请检查 .env 里的 APPID / APIKey / APISecret 是否对得上' };
}
````


---

## 📄 server/scoring-policy.js

````js
// 跟读评测的处置策略：把「评测器返回的结果 + 通过线」变成对孩子的处置。
//
// 决策原则（需求 2.3 与 2.9）：
//   - 环境/设备问题（没说、太吵、录爆了）不该算孩子读错 → retry，不计入失败次数
//   - 但环境有问题而孩子其实读得不错 → 直接算通过，不让孩子白念
//   - 读的是别的词（乱读）→ fail，正常计入失败次数（否则乱念也能过关，门槛就废了）
//   - 服务故障（网络/鉴权）→ error，只提示"再试一次"

export const MESSAGES = {
  no_speech: '没听清，靠近一点再念一遍',
  bad_audio: '周围有点吵，换个安静的地方再试一次',
  error: '评测没成功，再试一次',
};

// result: { score, error, detail } 来自 scorer
// 返回：{ kind: 'pass'|'fail'|'retry'|'error', score?, passed?, message? }
//   retry = 不计入失败次数（孩子不受罚）
export function decideOutcome(result, passScore) {
  if (result?.error || result?.score == null) {
    if (result?.error === 'no_speech') return { kind: 'retry', message: MESSAGES.no_speech };
    if (result?.error === 'bad_audio') return { kind: 'retry', message: MESSAGES.bad_audio };
    return { kind: 'error', message: MESSAGES.error };
  }
  const score = result.score;
  const passed = score >= passScore;
  // 环境有噪声但孩子读得不错 → 照常通过；读得不好则不怪孩子，让他重念
  if (result.detail?.noisy && !passed) {
    return { kind: 'retry', message: MESSAGES.bad_audio };
  }
  return { kind: passed ? 'pass' : 'fail', score, passed };
}
````


---

## 📄 server/sessions.js

````js
// 学习会话：一次查词流程一行，是「读音 / 释义」门禁的唯一依据。
//
// 安全不变量（务必保持）：
//   1. 会话绑定「档案 + 目标词」，创建后**不能改词**（换词必须开新会话）。
//   2. 所有会放行门禁的字段（typing_done / read_pass / assisted / quick_peek）
//      只能由下面这些明确函数写入，且只能由服务端在真实动作之后调用。
//      路由里不要直接 UPDATE 这些列，也不要接受客户端上报的进度。
//   3. 客户端上报的事件只进 events 表（审计），不改变这里的状态。

const NOW = () => new Date().toISOString();
const SID = (sessionId) => String(sessionId ?? '').slice(0, 64);

export function getSession(userDb, profileId, sessionId) {
  if (!sessionId) return null;
  return userDb
    .prepare('SELECT * FROM learn_sessions WHERE profile_id = ? AND session_id = ?')
    .get(profileId, SID(sessionId));
}

// 建立会话并绑定目标词。同一个 (档案, 会话) 若已存在：
//   - 词相同 → 原样返回（幂等）
//   - 词不同 → 拒绝（这是防止「给容易的词过关 → 改成生僻词 → 看释义」的关键）
export function createSession(userDb, profileId, sessionId, { word, mode = 'en' }) {
  const id = SID(sessionId);
  const target = String(word ?? '').trim().toLowerCase().slice(0, 64);
  if (!id || !target) return { ok: false, reason: 'bad_request' };

  const existing = getSession(userDb, profileId, id);
  if (existing) {
    if (existing.word !== target) return { ok: false, reason: 'word_mismatch', session: existing };
    return { ok: true, session: existing, completed: existing.typing_count };
  }

  const now = NOW();
  userDb
    .prepare(
      `INSERT INTO learn_sessions
         (profile_id, session_id, word, mode, typing_count, typing_done, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(profileId, id, target, mode === 'zh' ? 'zh' : 'en', 0, now, now);
  return { ok: true, session: getSession(userDb, profileId, id), completed: 0 };
}

function update(userDb, profileId, sessionId, sets, args) {
  const id = SID(sessionId);
  userDb
    .prepare(`UPDATE learn_sessions SET ${sets.join(', ')}, updated_at = ? WHERE profile_id = ? AND session_id = ?`)
    .run(...args, NOW(), profileId, id);
}

// 输入正确一次：服务端比对通过后调用，累加到 N 次就标记输入完成。
export function recordTypingSuccess(userDb, profileId, session, requiredCount) {
  const completed = session.typing_count + 1;
  const done = completed >= Math.max(1, requiredCount);
  update(
    userDb,
    profileId,
    session.session_id,
    ['typing_count = ?', 'typing_done = ?'],
    [completed, done ? 1 : 0]
  );
  return { completed, done };
}

export function recordReadingPass(userDb, profileId, session, score) {
  update(
    userDb,
    profileId,
    session.session_id,
    ['read_pass = read_pass + 1', 'read_attempts = read_attempts + 1', 'best_score = MAX(best_score, ?)'],
    [score ?? 0]
  );
}

export function recordReadingFail(userDb, profileId, session) {
  update(userDb, profileId, session.session_id, ['read_fail = read_fail + 1', 'read_attempts = read_attempts + 1'], []);
}

// 求助通关：只有服务端确认「累计失败够数」才能调用（见 routes/child.js 的 /api/help）。
export function useHelp(userDb, profileId, session) {
  update(userDb, profileId, session.session_id, ['assisted = 1'], []);
  return getSession(userDb, profileId, session.session_id);
}

// 快速查看：只有 /api/quick-peek 在校验过当天额度后能调用。
export function useQuickPeek(userDb, profileId, session) {
  update(userDb, profileId, session.session_id, ['quick_peek = 1'], []);
  return getSession(userDb, profileId, session.session_id);
}

export function markMeaningShown(userDb, profileId, session) {
  if (!session) return;
  update(userDb, profileId, session.session_id, ['meaning_shown = 1'], []);
}

// 会话是否已经放行「释义」：必须同档案 + 同会话 + 同词，且输入与跟读都达标。
export function sessionUnlocksMeaning(session, word, requiredReadingCount) {
  if (!session) return false;
  if (session.word !== String(word ?? '').trim().toLowerCase()) return false;
  if (session.typing_done !== 1) return false;
  if (session.assisted === 1 || session.quick_peek === 1) return true;
  return session.read_pass >= requiredReadingCount;
}

// 会话是否已经放行「读音」：输入完成即可。
export function sessionUnlocksPronunciation(session, word) {
  if (!session) return false;
  if (session.word !== String(word ?? '').trim().toLowerCase()) return false;
  return session.typing_done === 1;
}
````


---

## 📄 server/settings.js

````js
// 档案参数的读取与门槛档位计算（需求 2.5）。

import { mergeSettings } from './presets.js';

// 档位 → 输入次数 / 跟读次数
export const LEVEL_COUNTS = {
  1: { typing: 1, reading: 1 },
  2: { typing: 2, reading: 2 },
  3: { typing: 3, reading: 3 },
};

// 纯函数：当前生效的门槛档位，上限 3、下限 1。
export function computeEffectiveLevel(gateLevel, autoRamp, activeDays, rampEveryActiveDays) {
  const base = Math.min(3, Math.max(1, Math.floor(gateLevel) || 1));
  let ramp = 0;
  if (autoRamp && rampEveryActiveDays > 0) {
    ramp = Math.floor(Math.max(0, Math.floor(activeDays) || 0) / rampEveryActiveDays);
  }
  return Math.min(3, base + ramp);
}

// 计算一个档案「有查词记录的日子」的天数（按服务器本地时间的天）。
export function countActiveDays(userDb, profileId) {
  const row = userDb
    .prepare("SELECT COUNT(DISTINCT date(ts, 'localtime')) AS n FROM events WHERE profile_id = ?")
    .get(profileId);
  return row?.n ?? 0;
}

export function getProfileBundle(userDb, profileRow) {
  const settings = mergeSettings(profileRow.preset, profileRow.settings_json);
  const activeDays = countActiveDays(userDb, profileRow.id);
  const effectiveLevel = computeEffectiveLevel(
    settings.gateLevel,
    settings.autoRamp,
    activeDays,
    settings.rampEveryActiveDays
  );
  return {
    settings,
    activeDays,
    effectiveLevel,
    typingCount: LEVEL_COUNTS[effectiveLevel].typing,
    readingCount: LEVEL_COUNTS[effectiveLevel].reading,
  };
}
````


---

## 📄 server/suggest.js

````js
// 相近词提示（需求 2.1）：编辑距离 ≤ 2 的词，按词频排序（常用词优先）。
// 为避免全表扫描，先用首字母 + 长度（±2）缩小范围再算编辑距离。

export function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 99;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

// dictDb 为空时返回空数组。
export function findSuggestions(dictDb, inputLower, limit = 3) {
  if (!dictDb || !inputLower || !/^[a-z'-]+$/.test(inputLower)) return [];
  const first = inputLower[0];
  const last = String.fromCharCode(first.charCodeAt(0) + 1);
  const minLen = Math.max(1, inputLower.length - 2);
  const maxLen = inputLower.length + 2;
  const rows = dictDb
    .prepare(
      `SELECT word, frq FROM dict
       WHERE word_lower >= ? AND word_lower < ?
         AND len BETWEEN ? AND ?
         AND word_lower != ?`
    )
    .all(first, last, minLen, maxLen, inputLower);
  const hits = [];
  for (const row of rows) {
    const dist = editDistance(inputLower, row.word.toLowerCase());
    if (dist <= 2) hits.push({ word: row.word, frq: row.frq, dist });
  }
  // 词频：数值越小越常用，0 表示没有数据，排最后（需求 2.6 同规则）。
  hits.sort((x, y) => {
    const fx = x.frq > 0 ? 0 : 1;
    const fy = y.frq > 0 ? 0 : 1;
    if (fx !== fy) return fx - fy;
    if (x.frq !== y.frq) return x.frq - y.frq;
    if (x.dist !== y.dist) return x.dist - y.dist;
    return x.word < y.word ? -1 : 1;
  });
  return hits.slice(0, limit).map((h) => h.word);
}
````


---

## 📄 server/vocab.js

````js
// 生词本与复习调度（需求 2.8、阶段 3）。
// next_review_at 用 YYYY-MM-DD（服务器本地时间）存，字符串比较即日期比较。

export function todayLocal(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// assisted 的词额外增加一轮复习（需求 阶段3）。
export function effectiveIntervals(vocabRow, settings) {
  const base = Array.isArray(settings.reviewIntervals) && settings.reviewIntervals.length
    ? settings.reviewIntervals
    : [1, 2, 7, 15, 30];
  if (vocabRow?.assisted) return [...base, base[base.length - 1] + 1];
  return base;
}

export function getVocabWord(userDb, profileId, word) {
  return userDb
    .prepare('SELECT * FROM vocab WHERE profile_id = ? AND word = ?')
    .get(profileId, word);
}

export function getLearnedWord(userDb, profileId, word) {
  const row = getVocabWord(userDb, profileId, word);
  return row && row.status === 'learned' ? row : null;
}

export function learnedDaysAgo(vocabRow) {
  if (!vocabRow?.first_learned_at) return null;
  const dayUtc = (iso) => {
    const t = new Date(iso);
    return Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  };
  const diff = Math.floor((dayUtc(new Date()) - dayUtc(new Date(vocabRow.first_learned_at))) / 86400000);
  return Number.isFinite(diff) ? Math.max(0, diff) : null;
}

// 通关：写入/更新生词本（status=learned），并安排第一次复习。
export function graduateWord(userDb, profileId, word, info = {}) {
  const now = new Date().toISOString();
  const existing = getVocabWord(userDb, profileId, word);
  const settings = info.settings;
  const intervals = effectiveIntervals(existing, settings);
  const firstLearnedAt = existing?.first_learned_at ?? now;
  const status = 'learned';
  const assisted = existing?.assisted || (info.assisted ? 1 : 0);
  const stage = existing?.status === 'pending' ? existing.stage : 0;
  userDb
    .prepare(
      `INSERT INTO vocab (profile_id, word, entry_mode, status, first_learned_at, assisted,
        typing_errors, read_attempts, best_score, stage, next_review_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(profile_id, word) DO UPDATE SET
         status = excluded.status,
         assisted = excluded.assisted,
         typing_errors = excluded.typing_errors,
         read_attempts = excluded.read_attempts,
         best_score = MAX(vocab.best_score, excluded.best_score),
         stage = excluded.stage,
         next_review_at = excluded.next_review_at`
    )
    .run(
      profileId,
      word,
      info.entryMode ?? existing?.entry_mode ?? 'en',
      status,
      firstLearnedAt,
      assisted,
      info.typingErrors ?? existing?.typing_errors ?? 0,
      info.readAttempts ?? existing?.read_attempts ?? 0,
      info.bestScore ?? 0,
      stage,
      todayLocal(intervals[0] ?? 1)
    );
  return getVocabWord(userDb, profileId, word);
}

// 复习答对/答错后的安排（需求 阶段3）。
export function applyReviewResult(userDb, profileId, word, correct, settings) {
  const row = getVocabWord(userDb, profileId, word);
  if (!row) return null;
  const intervals = effectiveIntervals(row, settings);
  let stage = row.stage;
  let next;
  if (correct) {
    stage += 1;
    next = stage < intervals.length ? todayLocal(intervals[stage]) : null; // 毕业不再复习
  } else {
    stage = Math.max(0, stage - 1);
    next = todayLocal(1); // 第二天再考
  }
  userDb
    .prepare(
      `UPDATE vocab SET
         stage = ?,
         next_review_at = ?,
         review_correct = review_correct + ?,
         review_wrong = review_wrong + ?
       WHERE profile_id = ? AND word = ?`
    )
    .run(stage, next, correct ? 1 : 0, correct ? 0 : 1, profileId, word);
  return getVocabWord(userDb, profileId, word);
}

// 今天到期的复习词：最多 reviewPerDay 个（需求 阶段3）。
export function dueWords(userDb, profileId, settings) {
  const cap = Math.max(0, Math.floor(settings.reviewPerDay ?? 0));
  return userDb
    .prepare(
      `SELECT * FROM vocab
       WHERE profile_id = ? AND status = 'learned'
         AND next_review_at IS NOT NULL AND next_review_at <= ?
       ORDER BY next_review_at, id
       LIMIT ?`
    )
    .all(profileId, todayLocal(0), cap);
}

export function pendingWords(userDb, profileId) {
  return userDb
    .prepare("SELECT * FROM vocab WHERE profile_id = ? AND status = 'pending' ORDER BY first_learned_at")
    .all(profileId);
}
````


---

## 📄 server/word-rules.js

````js
// 「一个合法的目标词长什么样」的唯一来源。
//
// 为什么要集中在一处：会话绑定的词、输入校验的词、词典查询的词，三者必须用**同一套归一化**，
// 否则会出现"存的是 A、比的是 B"这类门禁漏洞；而且客户端 state-machine.js 里有一份等价实现，
// 改这里时请同步改那边（有单元测试分别覆盖两者）。
//
// 允许：英文字母，以及**词与词之间的**空格 / 连字符 / 撇号（词典里有 "nice day"、"well-known"、"don't"）。
// 不允许：首尾是分隔符、连续分隔符、数字、汉字等其它字符。

export const WORD_RE = /^[a-z]+(?:[ '-][a-z]+)*$/;

// 归一化：去首尾空白、转小写、把连续空白折叠成一个空格
export function normalizeWord(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function isValidWord(word) {
  return WORD_RE.test(word);
}
````


---

## 📄 server/zh-search.js

````js
// 中文查词（需求 2.6 / 阶段 1B）：三档查询 + 排序。
//   第一档：查询词与释义片段完全相同
//   第二档：片段以查询词开头
//   第三档：片段包含查询词（LIKE，前两档不足 8 条才用，避免全表扫描）
// 同档内：单词优先于短语（含空格）；常用词优先（frq 越小越常用，0 = 无数据排最后）。

// 取每一档时先排序再截断，否则 LIMIT 取到的是任意一批行，
// 会把最常用的词漏掉（例：查「水」时 water 反而没进候选）。
// 排序与 compare() 保持一致：学生常用度分档 → 单词优先 → 常用优先。
const RANK_ORDER = `
  ORDER BY rank ASC,
           (CASE WHEN instr(word, ' ') > 0 THEN 1 ELSE 0 END),
           (CASE WHEN frq > 0 THEN 0 ELSE 1 END),
           frq ASC
  LIMIT ?`;

export function searchZh(dictDb, rawQuery, limit = 8) {
  if (!dictDb) return [];
  const q = String(rawQuery ?? '').trim().slice(0, 30);
  if (!q) return [];

  const perTier = 24;
  const picked = [];

  const exact = dictDb
    .prepare(`SELECT word, gloss, frq, rank FROM zh_index WHERE term = ?${RANK_ORDER}`)
    .all(q, perTier);
  push(exact, 0);

  if (uniqueWords(picked) < limit) {
    // 范围扫描代替 LIKE 'q%'，保证能走 idx_zh_term 索引
    const prefix = dictDb
      .prepare(`SELECT word, gloss, frq, rank FROM zh_index WHERE term >= ? AND term < ?${RANK_ORDER}`)
      .all(q, q + String.fromCharCode(0xffff), perTier);
    push(prefix, 1);
  }

  if (uniqueWords(picked) < limit) {
    // 只在常用词（hot=1，走部分索引）里做包含匹配：
    // 全表 LIKE 要 1 秒以上，而且命中的多是孩子根本不认识的生僻词
    const escaped = q.replace(/[\\%_]/g, (c) => '\\' + c);
    const contains = dictDb
      .prepare(`SELECT word, gloss, frq, rank FROM zh_index WHERE hot = 1 AND term LIKE ? ESCAPE '\\'${RANK_ORDER}`)
      .all('%' + escaped + '%', perTier);
    push(contains, 2);
  }

  picked.sort(compare);

  const seen = new Set();
  const ranked = [];
  for (const item of picked) {
    if (seen.has(item.word)) continue;
    seen.add(item.word);
    ranked.push({ word: item.word, gloss: item.gloss, rank: item.rank ?? 3 });
  }

  // 生僻词只在确实没有更好结果时兜底：孩子不该看到 moolvee、teachering 这类词
  const useful = ranked.filter((r) => r.rank < 3);
  return (useful.length ? useful : ranked)
    .slice(0, limit)
    .map(({ word, gloss }) => ({ word, gloss }));

  function push(rows, tier) {
    for (const r of rows) picked.push({ word: r.word, gloss: r.gloss, frq: r.frq, rank: r.rank, tier });
  }
}

function uniqueWords(list) {
  return new Set(list.map((x) => x.word)).size;
}

function compare(a, b) {
  // 先按“学生常用度”分档（需求 2.6：明显生僻的条目排在最后），
  // 否则孩子查「老师」会先看到 moolvee、rebbe 这类词。
  const ra = a.rank ?? 3;
  const rb = b.rank ?? 3;
  if (ra !== rb) return ra - rb;
  if (a.tier !== b.tier) return a.tier - b.tier;
  const pa = a.word.includes(' ') ? 1 : 0;
  const pb = b.word.includes(' ') ? 1 : 0;
  if (pa !== pb) return pa - pb;
  const fa = a.frq > 0 ? 0 : 1;
  const fb = b.frq > 0 ? 0 : 1;
  if (fa !== fb) return fa - fb;
  if (a.frq !== b.frq) return a.frq - b.frq;
  return a.word < b.word ? -1 : a.word > b.word ? 1 : 0;
}
````


---

## 📄 tests/audio-record.test.js

````js
// 录音格式的单元测试：讯飞对音频格式很挑（16k/16bit/单声道），
// 这里守住 WAV 头不要写错——错了会表现为"孩子念了却总是没听清"。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav } from '../public/audio-record.js';

function readAscii(view, offset, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

test('encodeWav：写出标准的 16kHz / 16bit / 单声道 WAV 头', () => {
  const samples = new Float32Array(1000);
  const buf = encodeWav(samples, 16000);
  const view = new DataView(buf);

  assert.equal(readAscii(view, 0, 4), 'RIFF');
  assert.equal(readAscii(view, 8, 4), 'WAVE');
  assert.equal(readAscii(view, 12, 4), 'fmt ');
  assert.equal(readAscii(view, 36, 4), 'data');

  assert.equal(view.getUint16(20, true), 1, 'PCM 格式标记应为 1');
  assert.equal(view.getUint16(22, true), 1, '应为单声道');
  assert.equal(view.getUint32(24, true), 16000, '采样率应为 16000');
  assert.equal(view.getUint16(34, true), 16, '位深应为 16');

  assert.equal(view.getUint32(40, true), samples.length * 2, 'data 段长度 = 样本数 × 2');
  assert.equal(buf.byteLength, 44 + samples.length * 2);
  assert.equal(view.getUint32(4, true), 36 + samples.length * 2, 'RIFF 段长度');
});

test('encodeWav：样本按 16bit 小端写入，且做了削波保护', () => {
  const samples = new Float32Array([0, 1, -1, 2, -2, 0.5]);
  const view = new DataView(encodeWav(samples, 16000));
  const at = (i) => view.getInt16(44 + i * 2, true);

  assert.equal(at(0), 0);
  assert.equal(at(1), 32767, '最大正值');
  assert.equal(at(2), -32768, '最小负值');
  assert.equal(at(3), 32767, '超过 1 的值要被削到上限');
  assert.equal(at(4), -32768, '低于 -1 的值要被削到下限');
  assert.ok(Math.abs(at(5) - 16383) <= 1, '0.5 大致对应一半量程');
});
````


---

## 📄 tests/csv.test.js

````js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CsvParser, normalizeTranslation, hasChinese, mapColumns } from '../scripts/build-dict.js';

function parseAll(text, chunkSize = 1 << 16) {
  const rows = [];
  const parser = new CsvParser((row) => rows.push(row));
  for (let i = 0; i < text.length; i += chunkSize) {
    parser.push(text.slice(i, i + chunkSize));
  }
  parser.end();
  return rows;
}

const ECDICT_HEADER = 'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio';

test('基本解析：普通行、空行占位', () => {
  const rows = parseAll('a,b,c\n1,2,3\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('引号字段：内部逗号、双引号转义', () => {
  const rows = parseAll('a,"b,c ""q""",d\n');
  assert.deepEqual(rows, [['a', 'b,c "q"', 'd']]);
});

test('引号字段里可以有真实换行（不会被拆成两行）', () => {
  const rows = parseAll('apple,"ˈæp.əl",x,"n. 苹果\nn. 苹果树",,1\nbook,bʊk,y,"n. 书",,1\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], ['apple', 'ˈæp.əl', 'x', 'n. 苹果\nn. 苹果树', '', '1']);
});

test('CRLF 行尾、末行无换行符', () => {
  const rows = parseAll('a,b\r\n1,2');
  assert.deepEqual(rows, [['a', 'b'], ['1', '2']]);
});

test('BOM 被去掉', () => {
  const rows = parseAll('﻿word,frq\napple,10\n');
  assert.deepEqual(rows[0], ['word', 'frq']);
});

test('按很小的块推送（模拟流式读取边界切断字段）', () => {
  const text = `${ECDICT_HEADER}\napple,"ˈæp.əl",fruit,"n. 苹果；苹果树",,,1,cet4,150,25771,,,7274\n`;
  const rows = parseAll(text, 3);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], 'apple');
  assert.equal(rows[1][3], 'n. 苹果；苹果树');
});

test('normalizeTranslation：字面 \\n 与真实换行都变成换行，并去首尾空白', () => {
  assert.equal(normalizeTranslation('n. 苹果\\nn. 苹果树'), 'n. 苹果\nn. 苹果树');
  assert.equal(normalizeTranslation('n. 苹果\r\nn. 苹果树'), 'n. 苹果\nn. 苹果树');
  assert.equal(normalizeTranslation('  n. 水  '), 'n. 水');
  assert.equal(normalizeTranslation(null), '');
});

test('hasChinese：没有中文释义的条目要被丢弃', () => {
  assert.ok(hasChinese('n. 苹果'));
  assert.ok(!hasChinese('a kind of fruit'));
});

test('mapColumns：按表头自动识别列，大小写不敏感', () => {
  const map = mapColumns(ECDICT_HEADER.split(','));
  assert.equal(map.word, 0);
  assert.equal(map.phonetic, 1);
  assert.equal(map.translation, 3);
  assert.equal(map.tag, 7);
  assert.equal(map.frq, 9);
});

test('mapColumns：缺 word 或 translation 列要报错', () => {
  assert.throws(() => mapColumns(['word', 'phonetic']));
  assert.throws(() => mapColumns(['translation', 'frq']));
});
````


---

## 📄 tests/effective-level.test.js

````js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEffectiveLevel, LEVEL_COUNTS } from '../server/settings.js';

test('起点档位（还没有查词记录）', () => {
  assert.equal(computeEffectiveLevel(1, true, 0, 5), 1);
  assert.equal(computeEffectiveLevel(2, true, 0, 5), 2);
  assert.equal(computeEffectiveLevel(3, true, 0, 5), 3);
});

test('自动升档：每 5 个有记录的日子升一档', () => {
  assert.equal(computeEffectiveLevel(1, true, 4, 5), 1);
  assert.equal(computeEffectiveLevel(1, true, 5, 5), 2);
  assert.equal(computeEffectiveLevel(1, true, 9, 5), 2);
  assert.equal(computeEffectiveLevel(1, true, 10, 5), 3);
  assert.equal(computeEffectiveLevel(2, true, 5, 5), 3);
});

test('档位上限是 3', () => {
  assert.equal(computeEffectiveLevel(1, true, 15, 5), 3);
  assert.equal(computeEffectiveLevel(3, true, 500, 5), 3);
});

test('autoRamp 关闭时不升档', () => {
  assert.equal(computeEffectiveLevel(1, false, 100, 5), 1);
  assert.equal(computeEffectiveLevel(2, false, 100, 5), 2);
});

test('rampEveryActiveDays 为 0 时视为不升档（避免除零）', () => {
  assert.equal(computeEffectiveLevel(1, true, 100, 0), 1);
});

test('异常输入兜底', () => {
  assert.equal(computeEffectiveLevel(0, true, 0, 5), 1);      // 档位下限 1
  assert.equal(computeEffectiveLevel(9, true, 0, 5), 3);      // 档位上限 3
  assert.equal(computeEffectiveLevel(1, true, -3, 5), 1);     // 天数不为负
  assert.equal(computeEffectiveLevel(2, true, 5.9, 5), 3);    // 天数取整
});

test('档位 → 次数对应表', () => {
  assert.deepEqual(LEVEL_COUNTS[1], { typing: 1, reading: 1 });
  assert.deepEqual(LEVEL_COUNTS[2], { typing: 2, reading: 2 });
  assert.deepEqual(LEVEL_COUNTS[3], { typing: 3, reading: 3 });
});
````


---

## 📄 tests/helpers/dispatch.js

````js
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
      // 让 req.ip / remoteAddress 看起来像本机（家长 PIN 首次设置只允许本机操作）。
      // remoteAddress 是只读 getter，必须用 defineProperty 覆盖。
      Object.defineProperty(socket, 'remoteAddress', { value: '127.0.0.1', configurable: true });

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
      // 未匹配到路由时 Express 可能直接销毁连接，不一定触发 finish —— 两个都接上
      res.on('finish', done);
      res.on('close', done);
      let settled = false;

      function done() {
        if (settled) return;
        settled = true;
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
      }
      res.on('error', reject);

      app.handle(req, res, (err) => {
        if (err) reject(err);
      });
    });
  };
}
````


---

## 📄 tests/integration.test.js

````js
// 集成测试：直接打 HTTP API，验证正常流程与「门槛不可绕过」。
//
// 安全测试部分（本文件后半）是这次修复的重点：每一条都对应一个曾经真实存在的绕过路径。
// 迷你测试词典只有 29 个词，用例只能用里面的词（见 tests/fixtures/mini-ecdict.csv）。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { todayLocal } from '../server/vocab.js';

// 必须在动态 import 之前设置（db.js 在导入时读取）
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wordlock-it-'));
process.env.WORDLOCK_DATA_DIR = dataDir;
process.env.SCORER = 'mock';
process.env.WORDLOCK_DEV = '1'; // 允许测试用 mockScore 控制分数（正式使用不允许）
process.env.NODE_ENV = 'test';

const { openUserDb } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { buildDict } = await import('../scripts/build-dict.js');
const { makeCaller } = await import('./helpers/dispatch.js');
const { default: Database } = await import('better-sqlite3');

let userDb;
let dictDb;
let callRaw;
let profileA; // 小学预设：输入 1 次
let profileB; // 初中预设：输入 2 次

const SID = () => crypto.randomUUID();

before(async () => {
  const raw = path.join(dataDir, 'raw');
  fs.mkdirSync(raw);
  fs.copyFileSync(new URL('./fixtures/mini-ecdict.csv', import.meta.url), path.join(raw, 'mini.csv'));
  await buildDict({ rawDir: raw, outFile: path.join(dataDir, 'dict.db') });

  userDb = openUserDb();
  dictDb = new Database(path.join(dataDir, 'dict.db'), { readonly: true });
  callRaw = makeCaller(createApp({ userDb, dictDb }));

  const a = await call('/api/profiles', { method: 'POST', body: { name: '测试A', avatar: '🐱', preset: 'primary' } });
  const b = await call('/api/profiles', { method: 'POST', body: { name: '测试B', avatar: '🐶', preset: 'middle' } });
  profileA = a.data.id;
  profileB = b.data.id;
});

after(() => {
  userDb?.close();
  dictDb?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function call(pathname, { method = 'GET', body, profile, session, parent } = {}) {
  const headers = {};
  if (profile) headers['X-Profile-Id'] = String(profile);
  if (session) headers['X-Session-Id'] = session;
  if (parent) headers['X-Parent-Token'] = parent;
  return callRaw(pathname, { method, body, headers });
}

/* ---------- 正常流程要用的服务端步骤（和前端调的是同一套接口） ---------- */

async function bindAndType(profile, sessionId, word, mode = 'en') {
  const bound = await call('/api/session', { method: 'POST', profile, body: { sessionId, word, mode } });
  assert.equal(bound.status, 200, `绑定会话失败：${JSON.stringify(bound.data)}`);
  let { completed, requiredCount, done } = bound.data;
  while (!done) {
    const r = await call('/api/typing', { method: 'POST', profile, body: { sessionId, typed: word } });
    assert.equal(r.data.ok, true, `输入未通过：${JSON.stringify(r.data)}`);
    completed = r.data.completed;
    requiredCount = r.data.requiredCount;
    done = r.data.done;
    if (!done && completed >= requiredCount) break;
  }
  return { completed, requiredCount };
}

async function readOnce(profile, sessionId, word, mockScore) {
  const r = await call('/api/score', { method: 'POST', profile, body: { word, sessionId, mockScore } });
  assert.equal(r.status, 200, `评分失败：${JSON.stringify(r.data)}`);
  return r.data;
}

async function readTimes(profile, sessionId, word, times, mockScore = 92) {
  let last;
  for (let i = 0; i < times; i++) last = await readOnce(profile, sessionId, word, mockScore);
  return last;
}

async function newProfile(name, preset = 'primary') {
  const r = await call('/api/profiles', { method: 'POST', body: { name, avatar: '🐸', preset } });
  return r.data.id;
}

async function dropProfile(id) {
  await call(`/api/parent/profiles/${id}`, { method: 'DELETE', parent: await getParent() });
}

/* ============ 正常流程（孩子实际会走到） ============ */

test('完整流程：输入 → 读音放行 → 跟读通过 → 释义放行 → 进生词本', async () => {
  const sid = SID();
  assert.equal((await call('/api/pronunciation/run', { profile: profileA, session: sid })).status, 403);
  assert.equal((await call('/api/meaning/run', { profile: profileA, session: sid })).status, 403);

  assert.equal((await call('/api/check-word', { method: 'POST', profile: profileA, body: { word: 'run' } })).data.exists, true);
  await bindAndType(profileA, sid, 'run');

  const pron = await call('/api/pronunciation/run', { profile: profileA, session: sid });
  assert.equal(pron.status, 200);
  assert.ok(pron.data.phonetic.length > 0);
  assert.equal((await call('/api/meaning/run', { profile: profileA, session: sid })).status, 403); // 跟读前仍锁着

  const score = await readOnce(profileA, sid, 'run', 92);
  assert.equal(score.passed, true);
  assert.equal(score.passes, 1);

  const meaning = await call('/api/meaning/run', { profile: profileA, session: sid });
  assert.equal(meaning.status, 200);
  assert.ok(meaning.data.lines.length >= 1);
  assert.ok((await call('/api/vocab', { profile: profileA })).data.words.some((w) => w.word === 'run' && w.status === 'learned'));
  assert.ok(!(await call('/api/vocab', { profile: profileB })).data.words.some((w) => w.word === 'run'));
});

test('输入次数按门槛档位来（小学 1 次、初中 2 次）', async () => {
  // 绑定会话永远从 0 次开始：任何一次计数都必须经过 /api/typing 的服务端校验
  const sid1 = SID();
  const r1 = await call('/api/session', { method: 'POST', profile: profileA, body: { sessionId: sid1, word: 'book', mode: 'en' } });
  assert.equal(r1.data.requiredCount, 1);
  assert.equal(r1.data.completed, 0);
  assert.equal(r1.data.done, false);
  const a1 = await call('/api/typing', { method: 'POST', profile: profileA, body: { sessionId: sid1, typed: 'book' } });
  assert.equal(a1.data.completed, 1);
  assert.equal(a1.data.done, true); // 小学 N=1：真实输入 1 次即完成

  const sid2 = SID();
  const r2 = await call('/api/session', { method: 'POST', profile: profileB, body: { sessionId: sid2, word: 'book', mode: 'en' } });
  assert.equal(r2.data.requiredCount, 2);
  assert.equal(r2.data.done, false);
  const b1 = await call('/api/typing', { method: 'POST', profile: profileB, body: { sessionId: sid2, typed: 'book' } });
  assert.equal(b1.data.completed, 1);
  assert.equal(b1.data.done, false); // 初中 N=2：还差一次
  const b2 = await call('/api/typing', { method: 'POST', profile: profileB, body: { sessionId: sid2, typed: 'book' } });
  assert.equal(b2.data.done, true);
});

test('输入错误由服务端指出位置，且不计数', async () => {
  const sid = SID();
  await call('/api/session', { method: 'POST', profile: profileA, body: { sessionId: sid, word: 'happy', mode: 'zh' } });
  const wrongLength = await call('/api/typing', { method: 'POST', profile: profileA, body: { sessionId: sid, typed: 'happpy' } });
  assert.equal(wrongLength.data.ok, false);
  assert.equal(wrongLength.data.hint, 'length');
  const wrongPos = await call('/api/typing', { method: 'POST', profile: profileA, body: { sessionId: sid, typed: 'hoppy' } });
  assert.equal(wrongPos.data.hint, 'position');
  assert.equal(wrongPos.data.position, 2);
  assert.equal(wrongPos.data.completed, undefined); // 没计数
});

test('中文入口从 0/N 开始', async () => {
  const sid = SID();
  const zh = await call('/api/search-zh', { method: 'POST', profile: profileA, body: { query: '跑' } });
  assert.equal(zh.data.results[0].word, 'run');
  const bound = await call('/api/session', { method: 'POST', profile: profileA, body: { sessionId: sid, word: 'run', mode: 'zh' } });
  assert.equal(bound.data.completed, 0);
  assert.equal(bound.data.done, false);
});

test('没过关就请求释义返回 403（阶段3 验收）', async () => {
  const sid = SID();
  await call('/api/check-word', { method: 'POST', profile: profileA, body: { word: 'dog' } });
  await bindAndType(profileA, sid, 'dog');
  assert.equal((await readOnce(profileA, sid, 'dog', 10)).passed, false);
  assert.equal((await call('/api/meaning/dog', { profile: profileA, session: sid })).status, 403);
  assert.equal(userDb.prepare('SELECT * FROM vocab WHERE profile_id = ? AND word = ?').get(profileA, 'dog'), undefined);
});

test('已学会的词免门槛：check-word 返回 learned，释义直接可看（2.8）', async () => {
  assert.equal((await call('/api/check-word', { method: 'POST', profile: profileA, body: { word: 'run' } })).data.learned, true);
  const m = await call('/api/meaning/run', { profile: profileA, session: SID() });
  assert.equal(m.status, 200);
  assert.ok(m.data.learnedDaysAgo != null);
  assert.equal((await call('/api/check-word', { method: 'POST', profile: profileB, body: { word: 'run' } })).data.learned, false);
});

test('中文候选标记已学会（2.8）', async () => {
  const zh = await call('/api/search-zh', { method: 'POST', profile: profileA, body: { query: '跑' } });
  assert.equal(zh.data.results.find((r) => r.word === 'run').learned, true);
});

test('读够 M 次才能看释义；求助通关也可以（阶段2/3）', async () => {
  const sid = SID();
  await bindAndType(profileB, sid, 'book');
  await readOnce(profileB, sid, 'book', 92);
  assert.equal((await call('/api/meaning/book', { profile: profileB, session: sid })).status, 403); // 初中要 2 次

  for (let i = 0; i < 4; i++) await readOnce(profileB, sid, 'book', 5);
  const help = await call('/api/help', { method: 'POST', profile: profileB, body: { word: 'book', sessionId: sid } });
  assert.equal(help.status, 200);
  assert.equal((await call('/api/meaning/book', { profile: profileB, session: sid })).status, 200);
  const row = userDb.prepare('SELECT * FROM vocab WHERE profile_id = ? AND word = ?').get(profileB, 'book');
  assert.equal(row.assisted, 1);
  assert.ok(row.next_review_at);
});

test('首次校准：分数由服务端记录并计算，夹在 50–75（阶段2）', async () => {
  const sid = SID();
  await call('/api/calibration/start', { method: 'POST', profile: profileB });
  for (const score of [70, 80, 90]) {
    const r = await call('/api/score', { method: 'POST', profile: profileB, body: { word: 'apple', sessionId: sid, mockScore: score, calibration: true } });
    assert.equal(r.status, 200);
    assert.equal(r.data.calibration, true);
  }
  const done = await call('/api/calibration/finish', { method: 'POST', profile: profileB });
  assert.equal(done.data.passScore, 65); // 平均 80 − 15
  assert.equal(done.data.usedSamples, 3);
  assert.equal((await call('/api/settings', { profile: profileB })).data.settings.calibrated, true);
});

test('复习：答错退回并明天再考；答对进入下一间隔（阶段3）', async () => {
  userDb.prepare("UPDATE vocab SET next_review_at = ? WHERE profile_id = ? AND word = 'run'").run(todayLocal(0), profileA);
  assert.ok((await call('/api/review/today', { profile: profileA })).data.words.some((w) => w.word === 'run'));

  let ans = await call('/api/review/answer', { method: 'POST', profile: profileA, body: { word: 'run', typed: 'rnu' } });
  assert.equal(ans.data.correct, false);
  assert.equal(ans.data.nextReviewAt, todayLocal(1));
  ans = await call('/api/review/answer', { method: 'POST', profile: profileA, body: { word: 'run', typed: 'run' } });
  assert.equal(ans.data.correct, true);
  assert.equal(ans.data.nextReviewAt, todayLocal(2));
  userDb.prepare("UPDATE vocab SET next_review_at = ?, stage = 0 WHERE profile_id = ? AND word = 'run'").run(todayLocal(0), profileA);
});

test('复习每天最多 reviewPerDay 个（阶段3）', async () => {
  const pid = await newProfile('复习上限测试');
  const ins = userDb.prepare(
    `INSERT INTO vocab (profile_id, word, status, first_learned_at, next_review_at) VALUES (?, ?, 'learned', ?, ?)`
  );
  const now = new Date().toISOString();
  for (const w of ['paper', 'pen', 'pencil', 'rain', 'sun']) ins.run(pid, w, now, todayLocal(0));
  const today = await call('/api/review/today', { profile: pid });
  assert.equal(today.data.words.length, 3);
  await dropProfile(pid);
});

test('快速查看：默认关闭；打开后限额生效；巩固后转正（阶段5）', async () => {
  const pid = await newProfile('快速查看测试');
  const sid0 = SID();
  await bindAndType(pid, sid0, 'water');
  assert.equal((await call('/api/quick-peek', { method: 'POST', profile: pid, body: { word: 'water', sessionId: sid0 } })).status, 403); // 默认关闭

  await call(`/api/parent/profiles/${pid}/settings`, { method: 'POST', parent: await getParent(), body: { quickPeekPerDay: 2 } });

  const sid1 = SID();
  await bindAndType(pid, sid1, 'water');
  const peek1 = await call('/api/quick-peek', { method: 'POST', profile: pid, body: { word: 'water', sessionId: sid1 } });
  assert.equal(peek1.status, 200);
  assert.equal(peek1.data.remaining, 1);
  assert.equal(userDb.prepare('SELECT status FROM vocab WHERE profile_id = ? AND word = ?').get(pid, 'water')?.status, 'pending');

  const sid2 = SID();
  await bindAndType(pid, sid2, 'moon');
  assert.equal((await call('/api/quick-peek', { method: 'POST', profile: pid, body: { word: 'moon', sessionId: sid2 } })).status, 200);
  const sid3 = SID();
  await bindAndType(pid, sid3, 'star');
  assert.equal((await call('/api/quick-peek', { method: 'POST', profile: pid, body: { word: 'star', sessionId: sid3 } })).status, 403); // 额度用完

  await readTimes(pid, sid1, 'water', 1, 88); // 完整过一遍 → 转 learned
  assert.equal(userDb.prepare('SELECT status FROM vocab WHERE profile_id = ? AND word = ?').get(pid, 'water')?.status, 'learned');
  await dropProfile(pid);
});

test('每日查词上限：达到后不能再开始新的词（阶段4）', async () => {
  const pid = await newProfile('限额测试');
  await call(`/api/parent/profiles/${pid}/settings`, { method: 'POST', parent: await getParent(), body: { dailyLookupLimit: 1 } });
  assert.equal((await call('/api/check-word', { method: 'POST', profile: pid, body: { word: 'sun' } })).data.allowed, true);
  await bindAndType(pid, SID(), 'sun');
  assert.equal((await call('/api/check-word', { method: 'POST', profile: pid, body: { word: 'moon' } })).data.allowed, false);
  assert.equal((await call('/api/review/today', { profile: pid })).status, 200); // 复习不受影响
  await dropProfile(pid);
});

let cachedParent = null;
async function getParent() {
  if (cachedParent) return cachedParent;
  const has = await call('/api/parent/has-pin', { noProfile: true });
  cachedParent = has.data.hasPin
    ? (await call('/api/parent/login', { method: 'POST', noProfile: true, body: { pin: '135790' } })).data.token
    : (await call('/api/parent/pin', { method: 'POST', noProfile: true, body: { pin: '135790' } })).data.token;
  return cachedParent;
}

test('家长模式：PIN 校验、改名、删除档案（阶段4）', async () => {
  assert.equal((await call('/api/parent/records?profile=1')).status, 401);
  assert.equal((await call('/api/parent/login', { method: 'POST', noProfile: true, body: { pin: '000000' } })).status, 403);
  const token = await getParent();
  assert.ok(token);

  assert.equal((await call(`/api/parent/profiles/${profileB}`, { method: 'POST', parent: token, body: { name: '改个名' } })).status, 200);
  assert.ok((await call('/api/profiles')).data.profiles.some((p) => p.id === profileB && p.name === '改个名'));

  assert.equal((await call(`/api/parent/profiles/${profileB}`, { method: 'DELETE', parent: token })).status, 200);
  assert.equal(userDb.prepare('SELECT COUNT(*) n FROM events WHERE profile_id = ?').get(profileB).n, 0);
  assert.equal(userDb.prepare('SELECT COUNT(*) n FROM vocab WHERE profile_id = ?').get(profileB).n, 0);
  profileB = -1;
});

test('家长 PIN：连续输错会被临时锁定', async () => {
  for (let i = 0; i < 5; i++) await call('/api/parent/login', { method: 'POST', noProfile: true, body: { pin: '000001' } });
  const locked = await call('/api/parent/login', { method: 'POST', noProfile: true, body: { pin: '135790' } });
  assert.equal(locked.status, 429); // 正确密码也要等锁定结束
  // 清掉锁定，后面的测试还要用令牌
  userDb.prepare("UPDATE meta SET value = '0' WHERE key IN ('pin_fails','pin_locked_until')").run();
  assert.equal((await call('/api/parent/login', { method: 'POST', noProfile: true, body: { pin: '135790' } })).status, 200);
});

test('家长汇总：放弃点统计与 events 一致（阶段4 / 2.10）', async () => {
  // "查了几个词"来自客户端上报的 lookup_start（前端会发；这里补一条模拟真实使用）
  await call('/api/events', { method: 'POST', profile: profileA, body: { sessionId: SID(), type: 'lookup_start', word: 'run', mode: 'en' } });
  const old = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  userDb.prepare(
    `INSERT INTO events (profile_id, ts, session_id, mode, word, step, type)
     VALUES (?, ?, 'abandoned-session', 'en', 'quixotic', 'reading', 'read_fail')`
  ).run(profileA, old);
  const summary = await call(`/api/parent/summary?profile=${profileA}`, { parent: await getParent() });
  assert.equal(summary.status, 200);
  assert.ok(summary.data.lookedUp >= 1);
  assert.ok(summary.data.giveUp.total >= 1);
  assert.ok(summary.data.giveUp.conclusion.length > 0);
});

test('记录接口可按日期筛选（阶段4）', async () => {
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const res = await call(`/api/parent/records?profile=${profileA}&date=${day}`, { parent: await getParent() });
  assert.equal(res.status, 200);
  assert.ok(res.data.records.length >= 1);
});

test('生态接口：stats / garden / theme', async () => {
  assert.ok((await call('/api/stats', { profile: profileA })).data.totalDays >= 1);
  assert.ok((await call('/api/garden', { profile: profileA })).data.total >= 1);
  assert.equal((await call('/api/garden', { profile: profileA })).data.familyEnabled, false);
  assert.equal((await call('/api/theme', { method: 'POST', profile: profileA, body: { theme: 'garden' } })).data.theme, 'garden');
  assert.equal((await call('/api/settings', { profile: profileA })).data.settings.theme, 'garden');
});

/* ============ 安全回归：这些路径以前真的能绕过门槛 ============ */

test('回归【用户实测发现】：含空格的短语能查、能绑定、能输入通过', async () => {
  // 曾经的问题：中文入口给出 "nice day" 这样的候选，而输入校验只允许字母/连字符/撇号，
  // 孩子照抄也永远输不过（一直提示"只能输入英文字母哦"）。
  const cw = await call('/api/check-word', { method: 'POST', profile: profileA, body: { word: 'nice day' } });
  assert.equal(cw.data.exists, true); // 英文入口也能查短语

  const zh = await call('/api/search-zh', { method: 'POST', profile: profileA, body: { query: '美好的一天' } });
  assert.ok(zh.data.results.some((r) => r.word === 'nice day'));

  const sid = SID();
  const bound = await call('/api/session', { method: 'POST', profile: profileA, body: { sessionId: sid, word: 'nice day', mode: 'zh' } });
  assert.equal(bound.status, 200);
  const typed = await call('/api/typing', { method: 'POST', profile: profileA, body: { sessionId: sid, typed: 'Nice   Day ' } });
  assert.equal(typed.data.ok, true, JSON.stringify(typed.data)); // 大小写/多余空格都能归一化
  assert.equal(typed.data.done, true);
  assert.equal((await call('/api/pronunciation/nice%20day', { profile: profileA, session: sid })).status, 200);
});

test('安全 1：没完成输入就不能跟读（直接调 /api/score 也会被拒）', async () => {
  const r = await call('/api/score', { method: 'POST', profile: profileA, body: { word: 'computer', sessionId: SID(), mockScore: 100 } });
  assert.equal(r.status, 403);
});

test('安全 2：会话绑定了 apple，就不能拿它给 banana 评分', async () => {
  const sid = SID();
  await bindAndType(profileA, sid, 'apple');
  assert.equal((await call('/api/score', { method: 'POST', profile: profileA, body: { word: 'banana', sessionId: sid, mockScore: 100 } })).status, 403);
});

test('安全 3【已实测的绕过】：给一个词通过后，同一会话不能拿别的词的释义', async () => {
  const sid = SID();
  await bindAndType(profileA, sid, 'teacher');
  await readOnce(profileA, sid, 'teacher', 95);
  assert.equal((await call('/api/meaning/teacher', { profile: profileA, session: sid })).status, 200);
  // 以前这里会返回 200，等于一次通过就能看遍整本字典
  assert.equal((await call('/api/meaning/school', { profile: profileA, session: sid })).status, 403);
  assert.equal((await call('/api/meaning/quixotic', { profile: profileA, session: sid })).status, 403);
});

test('安全 4【已实测的绕过】：伪造 help_used 事件不再能通关', async () => {
  const sid = SID();
  await bindAndType(profileA, sid, 'student');
  const forged = await call('/api/events', {
    method: 'POST', profile: profileA,
    body: { sessionId: sid, type: 'help_used', word: 'student', mode: 'en', step: 'reading' },
  });
  assert.equal(forged.status, 200); // 接口正常返回（只记录）
  assert.equal(userDb.prepare('SELECT assisted FROM learn_sessions WHERE profile_id = ? AND session_id = ?').get(profileA, sid).assisted, 0);
  assert.equal((await call('/api/meaning/student', { profile: profileA, session: sid })).status, 403);
  assert.equal(userDb.prepare('SELECT * FROM vocab WHERE profile_id = ? AND word = ?').get(profileA, 'student'), undefined);
});

test('安全 5：伪造 quick_peek / typing_done / read_pass 事件同样无效', async () => {
  const sid = SID();
  for (const type of ['quick_peek', 'typing_done', 'read_pass', 'meaning_shown']) {
    await call('/api/events', { method: 'POST', profile: profileA, body: { sessionId: sid, type, word: 'sister', mode: 'en' } });
  }
  assert.equal(userDb.prepare('SELECT * FROM learn_sessions WHERE profile_id = ? AND session_id = ?').get(profileA, sid), undefined);
  assert.equal((await call('/api/meaning/sister', { profile: profileA, session: sid })).status, 403);
});

test('安全 6：没读够次数不能求助，读够了才能', async () => {
  const sid = SID();
  await bindAndType(profileA, sid, 'school');
  assert.equal((await call('/api/help', { method: 'POST', profile: profileA, body: { word: 'school', sessionId: sid } })).status, 403);
  await readOnce(profileA, sid, 'school', 5);
  assert.equal((await call('/api/help', { method: 'POST', profile: profileA, body: { word: 'school', sessionId: sid } })).status, 403);
  for (let i = 0; i < 3; i++) await readOnce(profileA, sid, 'school', 5);
  assert.equal((await call('/api/help', { method: 'POST', profile: profileA, body: { word: 'school', sessionId: sid } })).status, 200);
});

test('安全 7：会话绑定后不能改词（换词必须新会话）', async () => {
  const sid = SID();
  await call('/api/session', { method: 'POST', profile: profileA, body: { sessionId: sid, word: 'friend', mode: 'en' } });
  assert.equal((await call('/api/session', { method: 'POST', profile: profileA, body: { sessionId: sid, word: 'quixotic', mode: 'en' } })).status, 403);
  assert.equal(userDb.prepare('SELECT word FROM learn_sessions WHERE profile_id = ? AND session_id = ?').get(profileA, sid).word, 'friend');
});

test('安全 8：跨档案拿不到别人的会话状态', async () => {
  const other = await newProfile('跨档案测试');
  const sid = SID();
  await bindAndType(other, sid, 'moon');
  await readOnce(other, sid, 'moon', 95);
  assert.equal((await call('/api/meaning/moon', { profile: other, session: sid })).status, 200);
  assert.equal((await call('/api/meaning/moon', { profile: profileA, session: sid })).status, 403); // 换档案必须 403
  await dropProfile(other);
});

test('安全 9：快速查看不能跨词使用', async () => {
  await call(`/api/parent/profiles/${profileA}/settings`, { method: 'POST', parent: await getParent(), body: { quickPeekPerDay: 5 } });
  const sid = SID();
  await bindAndType(profileA, sid, 'star');
  assert.equal((await call('/api/quick-peek', { method: 'POST', profile: profileA, body: { word: 'quixotic', sessionId: sid } })).status, 403);
});

test('安全 10：读音接口也不能跨词', async () => {
  const sid = SID();
  await bindAndType(profileA, sid, 'family');
  assert.equal((await call('/api/pronunciation/family', { profile: profileA, session: sid })).status, 200);
  assert.equal((await call('/api/pronunciation/quixotic', { profile: profileA, session: sid })).status, 403);
});

test('安全 11：客户端伪造校准分数无效（分数线只由服务端算）', async () => {
  const pid = await newProfile('校准测试', 'middle');
  const before = (await call('/api/settings', { profile: pid })).data.settings.passScore;

  assert.equal((await call('/api/calibration', { method: 'POST', profile: pid, body: { scores: [5, 5, 5] } })).status, 404); // 老接口已移除

  await call('/api/calibration/start', { method: 'POST', profile: pid });
  const done = await call('/api/calibration/finish', { method: 'POST', profile: pid, body: { scores: [5, 5, 5] } });
  assert.equal(done.data.passScore, null); // 一个有效样本都没有 → 不采用
  assert.equal(done.data.usedSamples, 0);
  assert.equal((await call('/api/settings', { profile: pid })).data.settings.passScore, before); // 分数线没被改动
  await dropProfile(pid);
});

test('安全 12：非开发模式下 mockScore 无效', async () => {
  const sid = SID();
  await bindAndType(profileA, sid, 'father');
  const prev = process.env.WORDLOCK_DEV;
  delete process.env.WORDLOCK_DEV;
  try {
    const r = await call('/api/score', { method: 'POST', profile: profileA, body: { word: 'father', sessionId: sid, mockScore: 5 } });
    assert.equal(r.status, 200);
    assert.notEqual(r.data.score, 5); // 客户端给的 5 分被忽略
  } finally {
    process.env.WORDLOCK_DEV = prev;
  }
});

test('安全 13：缺音频时给友好提示而不是服务器报错', async () => {
  const sid = SID();
  await bindAndType(profileA, sid, 'mother');
  const prev = process.env.WORDLOCK_DEV;
  delete process.env.WORDLOCK_DEV;
  try {
    const r = await call('/api/score', { method: 'POST', profile: profileA, body: { word: 'mother', sessionId: sid } });
    assert.equal(r.status, 200);
    assert.equal(r.data.error, 'too_quiet');
    assert.equal(r.data.retry, true);
  } finally {
    process.env.WORDLOCK_DEV = prev;
  }
});

test('安全 14：只绑定会话、不提交输入，不能评分（小学 N=1 也必须真实输入一次）', async () => {
  const sid = SID();
  const bound = await call('/api/session', { method: 'POST', profile: profileA, body: { sessionId: sid, word: 'brother', mode: 'en' } });
  assert.equal(bound.status, 200);
  assert.equal(bound.data.done, false);
  // 还没 /api/typing → 不能跟读
  assert.equal((await call('/api/score', { method: 'POST', profile: profileA, body: { word: 'brother', sessionId: sid, mockScore: 95 } })).status, 403);
  // 真实输入一次之后才可以
  await call('/api/typing', { method: 'POST', profile: profileA, body: { sessionId: sid, typed: 'brother' } });
  assert.equal((await call('/api/score', { method: 'POST', profile: profileA, body: { word: 'brother', sessionId: sid, mockScore: 95 } })).status, 200);
});

test('安全 15：初中 N=2，输一次不够、输两次才放行', async () => {
  const pid = await newProfile('二次输入测试', 'middle');
  const sid = SID();
  await call('/api/session', { method: 'POST', profile: pid, body: { sessionId: sid, word: 'moon', mode: 'en' } });
  await call('/api/typing', { method: 'POST', profile: pid, body: { sessionId: sid, typed: 'moon' } });
  assert.equal((await call('/api/score', { method: 'POST', profile: pid, body: { word: 'moon', sessionId: sid, mockScore: 95 } })).status, 403);
  await call('/api/typing', { method: 'POST', profile: pid, body: { sessionId: sid, typed: 'moon' } });
  assert.equal((await call('/api/score', { method: 'POST', profile: pid, body: { word: 'moon', sessionId: sid, mockScore: 95 } })).status, 200);
  await dropProfile(pid);
});

test('安全 16：客户端塞进 typing_count / typing_done / completed 都不算数', async () => {
  const sid = SID();
  await call('/api/session', { method: 'POST', profile: profileA, body: { sessionId: sid, word: 'paper', mode: 'en' } });
  const r = await call('/api/typing', {
    method: 'POST', profile: profileA,
    body: { sessionId: sid, typed: 'WRONG', completed: 99, done: true, typing_done: 1, typingCount: 99 },
  });
  assert.equal(r.data.ok, false);
  const session = userDb.prepare('SELECT typing_count, typing_done FROM learn_sessions WHERE profile_id = ? AND session_id = ?').get(profileA, sid);
  assert.equal(session.typing_count, 0);
  assert.equal(session.typing_done, 0);
  // 也没法靠"声明式"字段蒙混过关
  assert.equal((await call('/api/score', { method: 'POST', profile: profileA, body: { word: 'paper', sessionId: sid, mockScore: 95 } })).status, 403);
});

test('安全 17【外部评审发现】：快速查看必须先真实输入过一次', async () => {
  const pid = await newProfile('快速查看门槛测试');
  await call(`/api/parent/profiles/${pid}/settings`, { method: 'POST', parent: await getParent(), body: { quickPeekPerDay: 5 } });
  const sid = SID();
  // 只绑定、一次都没输入 → 快速查看必须被拒（以前这里会直接给释义，等于整本词典免门槛）
  await call('/api/session', { method: 'POST', profile: pid, body: { sessionId: sid, word: 'quixotic', mode: 'en' } });
  const tooEarly = await call('/api/quick-peek', { method: 'POST', profile: pid, body: { word: 'quixotic', sessionId: sid } });
  assert.equal(tooEarly.status, 403);
  // 声明成中文入口也不行（否则换个 mode 就绕过去了）
  const sidZh = SID();
  await call('/api/session', { method: 'POST', profile: pid, body: { sessionId: sidZh, word: 'quixotic', mode: 'zh' } });
  assert.equal((await call('/api/quick-peek', { method: 'POST', profile: pid, body: { word: 'quixotic', sessionId: sidZh } })).status, 403);
  // 真实输入一次之后才允许
  await call('/api/typing', { method: 'POST', profile: pid, body: { sessionId: sid, typed: 'quixotic' } });
  const ok = await call('/api/quick-peek', { method: 'POST', profile: pid, body: { word: 'quixotic', sessionId: sid } });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.lines.length >= 1);
  await dropProfile(pid);
});

test('安全 18：同一段录音重复提交不重复计数（M 次必须是 M 遍）', async () => {
  const pid = await newProfile('重复录音测试', 'middle');
  const sid = SID();
  await bindAndType(pid, sid, 'sun'); // 初中：输入 2 次（M 也是 2）
  const audio = Buffer.alloc(2000, 7).toString('base64');
  const first = await call('/api/score', { method: 'POST', profile: pid, body: { word: 'sun', sessionId: sid, audioBase64: audio, mockScore: 95 } });
  assert.equal(first.data.passed, true);
  assert.equal(first.data.passes, 1);
  // 同一段音频再提交：不计数，提示重念
  const again = await call('/api/score', { method: 'POST', profile: pid, body: { word: 'sun', sessionId: sid, audioBase64: audio, mockScore: 95 } });
  assert.equal(again.data.error, 'duplicate_audio');
  assert.equal(userDb.prepare('SELECT read_pass FROM learn_sessions WHERE profile_id = ? AND session_id = ?').get(pid, sid).read_pass, 1);
  // 换一段（新的录音）就可以继续计数
  const other = await call('/api/score', { method: 'POST', profile: pid, body: { word: 'sun', sessionId: sid, audioBase64: Buffer.alloc(2000, 9).toString('base64'), mockScore: 95 } });
  assert.equal(other.data.passed, true);
  assert.equal(other.data.passes, 2);
  await dropProfile(pid);
});

test('安全 19：重复提交"没通过"的录音，也不会重复累计失败次数', async () => {
  const pid = await newProfile('重复失败录音测试');
  const sid = SID();
  await bindAndType(pid, sid, 'happy');
  const bad = Buffer.alloc(2000, 3).toString('base64');
  // 同一段低分录音提交 4 次：只算 1 次失败（否则回放就能刷够"求助通关"）
  for (let i = 0; i < 4; i++) {
    const r = await call('/api/score', { method: 'POST', profile: pid, body: { word: 'happy', sessionId: sid, audioBase64: bad, mockScore: 5 } });
    assert.equal(r.status, 200);
    if (i > 0) assert.equal(r.data.error, 'duplicate_audio');
  }
  const row = userDb.prepare('SELECT read_fail FROM learn_sessions WHERE profile_id = ? AND session_id = ?').get(pid, sid);
  assert.equal(row.read_fail, 1);
  // 因此也拿不到求助通关
  assert.equal((await call('/api/help', { method: 'POST', profile: pid, body: { word: 'happy', sessionId: sid } })).status, 403);
  await dropProfile(pid);
});

test('安全 20：指纹记满后是"丢最早的"，不是全清（否则交够 N 段就能重放最早那段）', async () => {
  const pid = await newProfile('指纹淘汰测试', 'middle');
  const sid = SID();
  await bindAndType(pid, sid, 'friend');
  const oldest = Buffer.alloc(2000, 11).toString('base64');
  const first = await call('/api/score', { method: 'POST', profile: pid, body: { word: 'friend', sessionId: sid, audioBase64: oldest, mockScore: 95 } });
  assert.equal(first.data.passed, true);
  // 再交 70 段各不相同的录音（远超每个会话 64 个指纹的上限）
  for (let i = 0; i < 70; i++) {
    const audio = Buffer.alloc(1200 + i, i % 251).toString('base64');
    await call('/api/score', { method: 'POST', profile: pid, body: { word: 'friend', sessionId: sid, audioBase64: audio, mockScore: 95 } });
  }
  // 最近的那段仍然被记得 → 证明是"先进先出地丢最早的"，而不是"记满就全清"
  const recent = Buffer.alloc(1200 + 69, 69 % 251).toString('base64');
  const again = await call('/api/score', { method: 'POST', profile: pid, body: { word: 'friend', sessionId: sid, audioBase64: recent, mockScore: 95 } });
  assert.equal(again.data.error, 'duplicate_audio');
  // 最早那段因为超出上限被淘汰（这是有意为之：内存必须有界）——它会被当成一段新录音
  const oldestAgain = await call('/api/score', { method: 'POST', profile: pid, body: { word: 'friend', sessionId: sid, audioBase64: oldest, mockScore: 95 } });
  assert.notEqual(oldestAgain.data.error, 'duplicate_audio');
  await dropProfile(pid);
});

test('安全 21：判重不会误伤正常使用——换一段新录音照常计数，且重复时不计入失败', async () => {
  const pid = await newProfile('判重不误伤测试', 'middle');
  const sid = SID();
  await bindAndType(pid, sid, 'sister');
  const a = Buffer.alloc(1500, 21).toString('base64');
  const b = Buffer.alloc(1500, 22).toString('base64');
  const r1 = await call('/api/score', { method: 'POST', profile: pid, body: { word: 'sister', sessionId: sid, audioBase64: a, mockScore: 95 } });
  assert.equal(r1.data.passes, 1);
  const dup = await call('/api/score', { method: 'POST', profile: pid, body: { word: 'sister', sessionId: sid, audioBase64: a, mockScore: 95 } });
  assert.equal(dup.data.error, 'duplicate_audio');
  assert.equal(dup.data.retry, true); // 提示重念，不算失败
  const r2 = await call('/api/score', { method: 'POST', profile: pid, body: { word: 'sister', sessionId: sid, audioBase64: b, mockScore: 95 } });
  assert.equal(r2.data.passed, true);
  assert.equal(r2.data.passes, 2); // 新录音照常计数
  const row = userDb.prepare('SELECT read_pass, read_fail FROM learn_sessions WHERE profile_id = ? AND session_id = ?').get(pid, sid);
  assert.equal(row.read_pass, 2);
  assert.equal(row.read_fail, 0); // 判重没有被算成失败
  await dropProfile(pid);
});

test('安全 22：评测没配好或配置不当，启动就失败（纯函数）', async () => {
  const { scorerConfigProblem } = await import('../server/app.js');
  const KEYS = ['XUNFEI_APP_ID', 'XUNFEI_API_KEY', 'XUNFEI_API_SECRET'];
  const saved = { SCORER: process.env.SCORER, WORDLOCK_DEV: process.env.WORDLOCK_DEV };
  for (const k of KEYS) saved[k] = process.env[k];
  try {
    process.env.SCORER = 'mock';
    delete process.env.WORDLOCK_DEV;
    assert.ok(/mock/.test(scorerConfigProblem())); // 未声明开发模式 → 拒绝启动

    process.env.WORDLOCK_DEV = '1';
    assert.equal(scorerConfigProblem(), null); // 明确声明开发模式才允许

    process.env.SCORER = 'xunfei';
    delete process.env.WORDLOCK_DEV;
    process.env.XUNFEI_APP_ID = 'x';
    process.env.XUNFEI_API_KEY = '';
    process.env.XUNFEI_API_SECRET = 'y';
    assert.ok(/缺/.test(scorerConfigProblem())); // 缺密钥 → 拒绝启动

    process.env.XUNFEI_API_KEY = 'fake-key-for-test';
    assert.equal(scorerConfigProblem(), null); // 三个都齐了才允许
  } finally {
    process.env.SCORER = saved.SCORER;
    if (saved.WORDLOCK_DEV === undefined) delete process.env.WORDLOCK_DEV;
    else process.env.WORDLOCK_DEV = saved.WORDLOCK_DEV;
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});
````


---

## 📄 tests/scoring-policy.test.js

````js
// 跟读处置策略的单元测试：谁算过、谁算失败、谁不计入失败。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideOutcome, MESSAGES } from '../server/scoring-policy.js';

const PASS = 60;

test('读得够好 → 通过', () => {
  const r = decideOutcome({ score: 86, detail: {} }, PASS);
  assert.equal(r.kind, 'pass');
  assert.equal(r.passed, true);
});

test('分数不够 → 算一次失败（计入失败次数）', () => {
  const r = decideOutcome({ score: 42, detail: {} }, PASS);
  assert.equal(r.kind, 'fail');
  assert.equal(r.passed, false);
});

test('读错词（乱读，分数被置 0）→ 算一次失败，不能白过', () => {
  const r = decideOutcome({ score: 0, detail: { nonsense: true } }, PASS);
  assert.equal(r.kind, 'fail');
  assert.equal(r.score, 0);
});

test('没念／太小声 → 不计入失败，提示靠近一点', () => {
  const r = decideOutcome({ score: null, error: 'no_speech', detail: {} }, PASS);
  assert.equal(r.kind, 'retry');
  assert.equal(r.message, MESSAGES.no_speech);
});

test('环境太吵 + 读得不好 → 不计入失败（不怪孩子）', () => {
  const r = decideOutcome({ score: 35, detail: { noisy: true } }, PASS);
  assert.equal(r.kind, 'retry');
  assert.equal(r.message, MESSAGES.bad_audio);
});

test('环境太吵 + 其实读得不错 → 照样通过（不让孩子白念）', () => {
  const r = decideOutcome({ score: 91, detail: { noisy: true } }, PASS);
  assert.equal(r.kind, 'pass');
  assert.equal(r.passed, true);
});

test('服务故障 → error，只说再试一次（不把孩子的问题暴露出来）', () => {
  const r = decideOutcome({ score: null, error: '讯飞评测失败（10313）' }, PASS);
  assert.equal(r.kind, 'error');
  assert.equal(r.message, MESSAGES.error);
});

test('通过线由档案决定（同一分数在不同档案结论不同）', () => {
  assert.equal(decideOutcome({ score: 65, detail: {} }, 60).kind, 'pass');
  assert.equal(decideOutcome({ score: 65, detail: {} }, 70).kind, 'fail');
});
````


---

## 📄 tests/settings.test.js

````js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, mergeSettings, AVATARS } from '../server/presets.js';

test('小学高年级预设的默认参数（需求 2.5 表格）', () => {
  const s = mergeSettings('primary', '{}');
  assert.equal(s.gateLevel, 1);
  assert.equal(s.autoRamp, true);
  assert.equal(s.rampEveryActiveDays, 5);
  assert.equal(s.passScore, 60);
  assert.equal(s.helpAfterFails, 4);
  assert.equal(s.meaningLines, 2);
  assert.equal(s.reviewPerDay, 3);
  assert.equal(s.accent, 'en-US');
  assert.equal(s.dailyLookupLimit, 0);
  assert.deepEqual(s.reviewIntervals, [1, 2, 7, 15, 30]);
  assert.equal(s.readingMode, 'cumulative');
  assert.equal(s.streakTolerance, 1);
  assert.equal(s.soundEnabled, true);
  assert.equal(s.theme, 'simple');
  assert.equal(s.quickPeekPerDay, 0);
  assert.equal('label' in s, false); // label 不算参数
});

test('初中预设的默认参数', () => {
  const s = mergeSettings('middle', '{}');
  assert.equal(s.gateLevel, 2);
  assert.equal(s.passScore, 70);
  assert.equal(s.meaningLines, 3);
  assert.equal(s.reviewPerDay, 5);
});

test('档案覆盖项生效，其余沿用预设', () => {
  const s = mergeSettings('primary', JSON.stringify({ passScore: 75, soundEnabled: false }));
  assert.equal(s.passScore, 75);
  assert.equal(s.soundEnabled, false);
  assert.equal(s.gateLevel, 1);
});

test('settings_json 坏了也能读到默认值', () => {
  const s = mergeSettings('primary', 'not-json{{{');
  assert.equal(s.gateLevel, 1);
});

test('未知预设回退到小学高年级', () => {
  const s = mergeSettings('unknown', '{}');
  assert.equal(s.gateLevel, 1);
});

test('正好 8 个头像可选', () => {
  assert.equal(AVATARS.length, 8);
  assert.equal(new Set(AVATARS).size, 8);
});
````


---

## 📄 tests/state-machine.test.js

````js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTypingSession,
  normalizeInput,
  isValidWordChars,
  MSG_INVALID,
  MSG_NOT_FOUND,
  MSG_LENGTH,
  positionMessage,
} from '../public/state-machine.js';

const FOUND = (word) => ({ exists: true, word });
const MISS = (suggestions) => ({ exists: false, word: 'xx', suggestions });

test('归一化：去首尾空格、转小写', () => {
  assert.equal(normalizeInput('  Apple '), 'apple');
  assert.equal(normalizeInput('WELL-KNOWN'), 'well-known');
  assert.equal(normalizeInput("DON'T"), "don't");
  assert.equal(normalizeInput('   '), '');
});

test('归一化：词与词之间可以有空格（词典里有 "nice day" 这类短语）', () => {
  assert.equal(normalizeInput('  Nice   Day '), 'nice day'); // 连续空格折叠成一个
  assert.equal(normalizeInput('nice day'), 'nice day');
});

test('允许的字符：字母、词间空格、连字符、撇号', () => {
  assert.ok(isValidWordChars('apple'));
  assert.ok(isValidWordChars('nice day'));
  assert.ok(isValidWordChars('well-known'));
  assert.ok(isValidWordChars("don't"));
  assert.ok(!isValidWordChars('nice  day')); // 连续空格（归一化后不会出现）
  assert.ok(!isValidWordChars(' nice day')); // 首尾空格
  assert.ok(!isValidWordChars('nice day '));
  assert.ok(!isValidWordChars('-nice'));
  assert.ok(!isValidWordChars('nice-'));
  assert.ok(!isValidWordChars('苹果')); // 汉字
  assert.ok(!isValidWordChars('apple1')); // 数字
});

test('回归：中文入口给出的含空格候选，孩子能照抄输入通过（曾经永远输不过）', () => {
  const s = createTypingSession({ requiredCount: 1, mode: 'zh', targetVisible: true });
  s.setTarget('nice day');
  const r = s.nextInput('Nice  Day '); // 大小写/空格多少都归一化
  assert.equal(r.status, 'done');
  assert.equal(r.target, 'nice day');
});

test('非法字符被拒绝，不计数', () => {
  const s = createTypingSession({ requiredCount: 3 });
  const r = s.firstInput('app1e', MISS());
  assert.equal(r.status, 'invalid');
  assert.equal(r.message, MSG_INVALID);
  assert.equal(r.events.length, 0);
  assert.equal(s.getState().completed, 0);

  const r2 = s.firstInput('苹果', MISS());
  assert.equal(r2.status, 'invalid');

  // 后续输入同样校验
  s.firstInput('apple', FOUND('apple'));
  const r3 = s.nextInput('appl3');
  assert.equal(r3.status, 'invalid');
  assert.equal(s.getState().completed, 1);
});

test('第 1 次找不到：提示且不计数、不给相近词', () => {
  const s = createTypingSession({ requiredCount: 2 });
  const r = s.firstInput('aple', MISS(['apple']));
  assert.equal(r.status, 'not_found');
  assert.equal(r.message, MSG_NOT_FOUND);
  assert.equal(r.suggestions, undefined);
  assert.equal(s.getState().notFoundStreak, 1);
  assert.equal(r.events[0].type, 'not_found');
});

test('连续第 2 次找不到：返回相近词提示', () => {
  const s = createTypingSession({ requiredCount: 2 });
  s.firstInput('aple', MISS(['apple']));
  const r = s.firstInput('appla', MISS(['apple']));
  assert.equal(r.status, 'not_found');
  assert.deepEqual(r.suggestions, ['apple']);
  assert.equal(s.getState().notFoundStreak, 2);
});

test('找到目标词后，找不到的连击计数归零', () => {
  const s = createTypingSession({ requiredCount: 2 });
  s.firstInput('aple', MISS());
  s.firstInput('apple', FOUND('apple'));
  assert.equal(s.getState().notFoundStreak, 0);
  assert.equal(s.isAwaitingFirst(), false);
});

test('N=1：第 1 次命中即完成', () => {
  const s = createTypingSession({ requiredCount: 1 });
  const r = s.firstInput('Apple ', FOUND('apple'));
  assert.equal(r.status, 'done');
  assert.equal(r.done, true);
  assert.equal(r.target, 'apple');
  assert.deepEqual(r.events.map((e) => e.type), ['typing_ok', 'typing_done']);
});

test('N=2：第 1 次命中是进度，第 2 次命中才完成', () => {
  const s = createTypingSession({ requiredCount: 2 });
  const r1 = s.firstInput('apple', FOUND('apple'));
  assert.equal(r1.status, 'progress');
  assert.equal(r1.completed, 1);
  assert.deepEqual(r1.events.map((e) => e.type), ['typing_ok']);

  const r2 = s.nextInput('APPLE');
  assert.equal(r2.status, 'done');
  assert.deepEqual(r2.events.map((e) => e.type), ['typing_ok', 'typing_done']);
});

test('N=3：完整走三遍', () => {
  const s = createTypingSession({ requiredCount: 3 });
  assert.equal(s.firstInput('run', FOUND('run')).status, 'progress');
  assert.equal(s.nextInput('run').status, 'progress');
  const r3 = s.nextInput(' run ');
  assert.equal(r3.status, 'done');
  assert.equal(r3.completed, 3);
});

test('字母个数不同：提示数一数，不清零', () => {
  const s = createTypingSession({ requiredCount: 2 });
  s.firstInput('apple', FOUND('apple'));
  const r = s.nextInput('apples');
  assert.equal(r.status, 'wrong');
  assert.equal(r.message, MSG_LENGTH);
  assert.equal(s.getState().completed, 1);
  assert.equal(r.events[0].type, 'typing_wrong');
});

test('个数相同有错位：只说第一个错的位置，不泄露字母', () => {
  const s = createTypingSession({ requiredCount: 3 });
  s.firstInput('happy', FOUND('happy'));
  const r = s.nextInput('hafpy'); // 第 3 个字母错
  assert.equal(r.status, 'wrong');
  assert.equal(r.message, positionMessage(3));
  assert.ok(!r.message.includes('appy')); // 给孩子看的提示里不带答案
  const r2 = s.nextInput('hoppy'); // 第 2 个字母错
  assert.equal(r2.message, positionMessage(2));
});

test('输错不清零，接着输对仍可完成', () => {
  const s = createTypingSession({ requiredCount: 2 });
  s.firstInput('book', FOUND('book'));
  s.nextInput('books');
  const r = s.nextInput('book');
  assert.equal(r.status, 'done');
});

test('换一个词：完全重置', () => {
  const s = createTypingSession({ requiredCount: 2 });
  s.firstInput('aple', MISS());
  s.firstInput('apple', FOUND('apple'));
  s.nextInput('applx');
  s.cancel();
  const st = s.getState();
  assert.equal(st.target, null);
  assert.equal(st.completed, 0);
  assert.equal(st.notFoundStreak, 0);
  assert.equal(st.done, false);
  assert.equal(s.isAwaitingFirst(), true);
  // 重置后连击也从零开始：第 1 次找不到不给相近词
  const r = s.firstInput('dogz', MISS(['dog']));
  assert.equal(r.suggestions, undefined);
});

test('已过首查阶段后不能再调 firstInput', () => {
  const s = createTypingSession({ requiredCount: 2 });
  s.firstInput('cat', FOUND('cat'));
  assert.equal(s.firstInput('cat', FOUND('cat')).status, 'error');
});

test('空输入被忽略', () => {
  const s = createTypingSession({ requiredCount: 1 });
  const r = s.firstInput('   ', MISS());
  assert.equal(r.status, 'empty');
});

test('requiredCount 异常值兜底为 1', () => {
  const s = createTypingSession({ requiredCount: 0 });
  const r = s.firstInput('sun', FOUND('sun'));
  assert.equal(r.status, 'done');
});

test('nextInput 完成时也必须带回目标词（回归：曾漏掉导致界面请求 undefined）', () => {
  const s = createTypingSession({ requiredCount: 2 });
  s.firstInput('book', FOUND('book'));
  const r = s.nextInput('book');
  assert.equal(r.status, 'done');
  assert.equal(r.target, 'book');
});

test('中文入口：setTarget 后从 0/N 开始，目标词可见', () => {
  const s = createTypingSession({ requiredCount: 2, mode: 'zh', targetVisible: true });
  const st0 = s.getState();
  assert.equal(st0.mode, 'zh');
  assert.equal(st0.targetVisible, true);
  assert.equal(s.isAwaitingFirst(), true); // 还没 setTarget

  s.setTarget('Apple'); // 大小写归一化
  assert.equal(s.isAwaitingFirst(), false);
  assert.equal(s.getState().completed, 0);
  assert.equal(s.getState().target, 'apple');

  const r1 = s.nextInput('apple');
  assert.equal(r1.status, 'progress');
  assert.equal(r1.completed, 1);
  const r2 = s.nextInput('apple');
  assert.equal(r2.status, 'done');
  assert.equal(r2.target, 'apple');
});

test('中文入口：默认参数是英文入口', () => {
  const s = createTypingSession({ requiredCount: 1 });
  assert.equal(s.getState().mode, 'en');
  assert.equal(s.getState().targetVisible, false);
});

test('音标不编造由接口负责；状态机不产生任何释义/音标', () => {
  const s = createTypingSession({ requiredCount: 1 });
  const r = s.firstInput('apple', FOUND('apple'));
  assert.ok(!('phonetic' in r));
  assert.ok(!('translation' in r));
});
````


---

## 📄 tests/suggest.test.js

````js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { editDistance, findSuggestions } from '../server/suggest.js';
import { buildDict } from '../scripts/build-dict.js';

test('编辑距离基本性质', () => {
  assert.equal(editDistance('apple', 'apple'), 0);
  assert.equal(editDistance('aple', 'apple'), 1);      // 少打一个 p
  assert.equal(editDistance('appla', 'apple'), 1);     // 打错一个字母
  assert.equal(editDistance('cat', 'cut'), 1);
  assert.equal(editDistance('kitten', 'sitting'), 3);
});

test('长度差超过 2 直接排除', () => {
  assert.equal(editDistance('a', 'apple'), 99);
});

test('findSuggestions：按词频排序、0 排最后、只取 3 个', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE dict (
    word TEXT PRIMARY KEY, word_lower TEXT NOT NULL, phonetic TEXT DEFAULT '',
    translation TEXT, tag TEXT DEFAULT '', frq INTEGER DEFAULT 0, len INTEGER DEFAULT 0)`);
  const ins = db.prepare('INSERT INTO dict VALUES (?, ?, ?, ?, ?, ?, ?)');
  // 猫 的相近词们：距离都 ≤ 2，按词频升序，frq=0 的排最后
  ins.run('cat', 'cat', '', 'n. 猫', '', 900, 3);
  ins.run('cap', 'cap', '', 'n. 帽子', '', 100, 3);
  ins.run('cot', 'cot', '', 'n. 小床', '', 0, 3);
  ins.run('cart', 'cart', '', 'n. 手推车', '', 50, 4);
  ins.run('cats', 'cats', '', 'n. 猫（复数）', '', 20, 4);
  ins.run('can', 'can', '', 'v. 能；可以；装罐', '', 10, 3);
  ins.run('car', 'car', '', 'n. 汽车', '', 5, 3);
  // 注意：cat 本身不该出现在建议里
  assert.deepEqual(findSuggestions(db, 'cat', 3), ['car', 'can', 'cats']);
  // 词频 0 的排最后
  assert.deepEqual(findSuggestions(db, 'cat', 7).slice(-1), ['cot']);
  db.close();
});

test('findSuggestions：空库/非法输入返回空数组', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE dict (word TEXT, word_lower TEXT, phonetic TEXT, translation TEXT, tag TEXT, frq INTEGER, len INTEGER)');
  assert.deepEqual(findSuggestions(db, 'cat', 3), []);
  assert.deepEqual(findSuggestions(null, 'cat', 3), []);
  assert.deepEqual(findSuggestions(db, '', 3), []);
  assert.deepEqual(findSuggestions(db, '苹', 3), []);
  db.close();
});

test('findSuggestions：只用首字母+长度筛选后再算距离（构建的迷你词典上验证）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wordlock-test-'));
  const fixtureDir = path.join(tmp, 'raw');
  fs.mkdirSync(fixtureDir);
  const fixture = new URL('./fixtures/mini-ecdict.csv', import.meta.url);
  fs.copyFileSync(fixture, path.join(fixtureDir, 'mini-ecdict.csv'));
  const outFile = path.join(tmp, 'dict.db');

  try {
    const report = await buildDict({ rawDir: fixtureDir, outFile });
    assert.equal(report.kept, 30); // 全部 30 行都有中文释义

    const db = new Database(outFile, { readonly: true });
    const row = db.prepare('SELECT * FROM dict WHERE word_lower = ?').get('apple');
    assert.equal(row.word, 'apple');
    assert.equal(row.frq, 25771);
    assert.equal(row.len, 5);
    assert.equal(row.phonetic, 'ˈæp.əl');
    assert.ok(row.translation.includes('\n')); // 字面与真实换行都已归一

    // 短语与带撇号/连字符的词都在
    assert.ok(db.prepare('SELECT 1 FROM dict WHERE word_lower = ?').get("well-known"));
    assert.ok(db.prepare('SELECT 1 FROM dict WHERE word_lower = ?').get("don't"));

    // 相近词：aple → apple
    assert.deepEqual(findSuggestions(db, 'aple', 3), ['apple']);

    // 完全不认识的词：没有建议也不崩溃
    assert.deepEqual(findSuggestions(db, 'zzzz', 3), []);

    // cat 自己不出现在建议里；c 开头、长度±2 的 can't 会出现
    const sug = findSuggestions(db, 'cat', 8);
    assert.ok(sug.includes("can't") && !sug.includes('cat'));

    db.close();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
````


---

## 📄 tests/xunfei.test.js

````js
// 讯飞评测模块的单元测试。
// 没有真实密钥也能验证：鉴权签名、音频分帧、返回 XML 的分数解析。
// 依据官方文档：https://www.xfyun.cn/doc/Ise/IseAPI.html

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  signOrigin,
  buildAuthUrl,
  extractPcm,
  readWavFormat,
  buildAudioFrames,
  parseResultXml,
  buildExamText,
  toHundredScale,
  classifyResult,
} from '../server/scorers/xunfei.js';

const DATE = 'Wed, 10 Jul 2019 07:35:43 GMT';
const SECRET = 'test-secret';
const KEY = 'test-key';

test('英文试题格式：read_word 必须以 [word] 开头（否则讯飞报 48195）', () => {
  const text = buildExamText('apple');
  assert.equal(text, '﻿[word]\napple');
  assert.equal(text[0], '﻿'); // 带 BOM
  assert.equal(buildExamText('apple', 'read_sentence'), '﻿[content]\napple');
});

test('签名串格式与官方一致（host/date/request-line 三行）', () => {
  const expectedOrigin = 'host: ise-api.xfyun.cn\ndate: Wed, 10 Jul 2019 07:35:43 GMT\nGET /v2/open-ise HTTP/1.1';
  const expected = crypto.createHmac('sha256', SECRET).update(expectedOrigin).digest('base64');
  assert.equal(signOrigin(DATE, SECRET), expected);
  // base64 的 HMAC-SHA256 固定 44 字节
  assert.equal(Buffer.from(signOrigin(DATE, SECRET), 'base64').length, 32);
});

test('鉴权地址：参数齐全、authorization 可解出 api_key 与 signature', () => {
  const url = buildAuthUrl({ apiKey: KEY, apiSecret: SECRET, date: DATE });
  assert.ok(url.startsWith('wss://ise-api.xfyun.cn/v2/open-ise?'));
  const params = new URL(url).searchParams;
  assert.equal(params.get('host'), 'ise-api.xfyun.cn');
  assert.equal(params.get('date'), DATE);

  const decoded = Buffer.from(params.get('authorization'), 'base64').toString('utf8');
  assert.ok(decoded.includes(`api_key="${KEY}"`));
  assert.ok(decoded.includes('algorithm="hmac-sha256"'));
  assert.ok(decoded.includes('headers="host date request-line"'));
  assert.ok(decoded.includes(`signature="${signOrigin(DATE, SECRET)}"`));
  // 文档正文的写法：逗号后不带空格
  assert.ok(decoded.startsWith(`api_key="${KEY}",algorithm=`));
});

test('鉴权地址：另一种逗号写法（历史示例）也能生成', () => {
  const decoded = Buffer.from(
    new URL(buildAuthUrl({ apiKey: KEY, apiSecret: SECRET, date: DATE, spaced: true })).searchParams.get('authorization'),
    'base64'
  ).toString('utf8');
  assert.ok(decoded.startsWith(`api_key="${KEY}", algorithm=`));
});

// 造一个标准 WAV：44 字节头 + payload
function makeWav(payload, { extraChunk = null } = {}) {
  const chunks = [];
  const fmt = Buffer.alloc(8 + 16);
  fmt.write('fmt ', 0, 'ascii');
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8); // PCM
  fmt.writeUInt16LE(1, 10); // 单声道
  fmt.writeUInt32LE(16000, 12); // 采样率
  fmt.writeUInt32LE(32000, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22); // 16bit
  chunks.push(fmt);
  if (extraChunk) chunks.push(extraChunk);
  const data = Buffer.alloc(8 + payload.length);
  data.write('data', 0, 'ascii');
  data.writeUInt32LE(payload.length, 4);
  payload.copy(data, 8);
  chunks.push(data);
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WAVE', 8, 'ascii');
  return Buffer.concat([header, body]);
}

test('取 PCM：标准 WAV 去掉 44 字节头', () => {
  const payload = Buffer.alloc(1000, 3);
  assert.equal(extractPcm(makeWav(payload)).length, 1000);
  assert.deepEqual(extractPcm(makeWav(payload)).subarray(0, 3), Buffer.from([3, 3, 3]));
});

test('取 PCM：带额外块（afconvert 会加的 LIST 块）也能取对', () => {
  // 关键回归：以前写死跳过 44 字节，遇到 LIST 块会把块头当音频，讯飞报 48195
  const listPayload = Buffer.from('INFOxxxx', 'ascii');
  const listChunk = Buffer.alloc(8 + listPayload.length);
  listChunk.write('LIST', 0, 'ascii');
  listChunk.writeUInt32LE(listPayload.length, 4);
  listPayload.copy(listChunk, 8);
  const payload = Buffer.alloc(1000, 9);
  const wav = makeWav(payload, { extraChunk: listChunk });
  const pcm = extractPcm(wav);
  assert.equal(pcm.length, 1000);
  assert.equal(pcm[0], 9); // 不是块头的字节
});

test('取 PCM：非 WAV（已经是裸 PCM）原样返回', () => {
  const raw = Buffer.alloc(1000, 7);
  assert.equal(extractPcm(raw).length, 1000);
});

test('读 WAV 格式：拿到采样率/位深/声道', () => {
  const format = readWavFormat(makeWav(Buffer.alloc(100)));
  assert.deepEqual(format, { formatTag: 1, channels: 1, sampleRate: 16000, bitsPerSample: 16 });
  assert.equal(readWavFormat(Buffer.alloc(100)), null);
});

test('分帧：每帧 1280 字节，aus/status 序列正确', () => {
  const pcm = Buffer.alloc(1280 * 3 + 100, 1); // 3 整帧 + 1 个尾帧
  const frames = buildAudioFrames(pcm);
  assert.equal(frames.length, 4);
  assert.deepEqual(frames.map((f) => f.data.length), [1280, 1280, 1280, 100]);
  // 首帧 aus=1 status=0；中间 aus=2 status=1；末帧 aus=4 status=2
  assert.deepEqual(frames.map((f) => [f.aus, f.status]), [[1, 0], [2, 1], [2, 1], [4, 2]]);
});

test('分帧：只有一帧时既是首帧也是末帧', () => {
  const frames = buildAudioFrames(Buffer.alloc(500, 1));
  assert.equal(frames.length, 1);
  assert.deepEqual([frames[0].aus, frames[0].status], [1, 2]);
});

test('分帧：正好整帧时末帧标记正确', () => {
  const frames = buildAudioFrames(Buffer.alloc(2560, 1));
  assert.equal(frames.length, 2);
  assert.deepEqual(frames.map((f) => [f.aus, f.status]), [[1, 0], [4, 2]]);
});

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<xml_result>
  <read_word id="abc" ent="en_vip" category="read_word" total_score="83.5"
    fluency_score="80.2" integrity_score="100" accuracy_score="78" standard_score="81"
    phone_score="85" tone_score="90" is_rejected="false" dp_message="0">
  </read_word>
</xml_result>`;

test('解析分数 XML', () => {
  const parsed = parseResultXml(SAMPLE_XML);
  assert.equal(parsed.total, 83.5);
  assert.equal(parsed.fluency, 80.2);
  assert.equal(parsed.integrity, 100);
  assert.equal(parsed.accuracy, 78);
  assert.equal(parsed.phone, 85);
  assert.equal(parsed.rejected, false);
});

test('解析：被拒识（没读到有效语音）', () => {
  const parsed = parseResultXml('<xml_result><read_word is_rejected="true" except_info="28677"></read_word></xml_result>');
  assert.equal(parsed.rejected, true);
  assert.equal(parsed.total, null);
});

test('解析：缺字段不炸，返回 null', () => {
  const parsed = parseResultXml('<xml_result><read_word></read_word></xml_result>');
  assert.equal(parsed.total, null);
  assert.equal(parsed.rejected, false);
});

test('分数换算：官方 0~5 分制 → 本应用的 0~100 分', () => {
  // 官方对照表：4.3~5 分 = 86~100 分（优）
  assert.equal(toHundredScale(4.64), 93);
  assert.equal(toHundredScale(4.3), 86);
  assert.equal(toHundredScale(3.5), 70); // 良的下沿
  assert.equal(toHundredScale(2.5), 50); // 中的下沿
  assert.equal(toHundredScale(0), 0);
  assert.equal(toHundredScale(5), 100);
  assert.equal(toHundredScale(5.4), 100); // 越界夹住
  assert.equal(toHundredScale(null), null);
});

test('结果分类：区分「没好念」「环境吵」「读错词」', () => {
  // 没声音／声音太小
  assert.equal(classifyResult({ exceptInfo: 28673, rejected: true }), 'no_speech');
  // 太吵、录音截幅 → 环境/设备问题
  assert.equal(classifyResult({ exceptInfo: 28680, rejected: false }), 'noisy');
  assert.equal(classifyResult({ exceptInfo: 28709, rejected: false }), 'noisy');
  assert.equal(classifyResult({ exceptInfo: 28690, rejected: false }), 'noisy');
  // 乱读（读的是别的词）→ 算一次失败
  assert.equal(classifyResult({ exceptInfo: 28676, rejected: true }), 'nonsense');
  assert.equal(classifyResult({ exceptInfo: 0, rejected: true }), 'nonsense');
  // 正常
  assert.equal(classifyResult({ exceptInfo: 0, rejected: false, total: 4.6 }), 'ok');
  // 正常但没给分数 → 当作没听到
  assert.equal(classifyResult({ exceptInfo: 0, rejected: false, total: null }), 'no_speech');
});

test('解析真实返回：except_info 与 is_rejected 都要取到', () => {
  const xml =
    '<read_word accuracy_score="2.530319" content="apple" except_info="28676" is_rejected="true" total_score="2.530319">';
  const parsed = parseResultXml(xml);
  assert.equal(parsed.exceptInfo, 28676);
  assert.equal(parsed.rejected, true);
  assert.equal(classifyResult(parsed), 'nonsense');
});
````


---

## 📄 tests/zh.test.js

````js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { buildDict, buildZhTerms, cleanTerm, isIndexableWord, relevanceRank } from '../scripts/build-dict.js';
import { searchZh } from '../server/zh-search.js';

test('cleanTerm：去词性标记、括号注释、残留标点', () => {
  assert.equal(cleanTerm('n. 苹果'), '苹果');
  assert.equal(cleanTerm('vt.&vi. 预订'), '预订');
  assert.equal(cleanTerm('adj. 高兴的；幸福的'), '高兴的；幸福的');
  assert.equal(cleanTerm('银河系（天河）'), '银河系');
  assert.equal(cleanTerm('n. 《创世纪》(圣经)'), '《创世纪》');
  assert.equal(cleanTerm('  水  '), '水');
  assert.equal(cleanTerm('。'), '');
});

test('buildZhTerms：按行拆、按分隔符拆、gloss 是所在行', () => {
  const terms = buildZhTerms('n. 书本；书籍\nvt. 预订；预约');
  assert.deepEqual(terms, [
    { term: '书本', gloss: 'n. 书本；书籍' },
    { term: '书籍', gloss: 'n. 书本；书籍' },
    { term: '预订', gloss: 'vt. 预订；预约' },
    { term: '预约', gloss: 'vt. 预订；预约' },
  ]);
});

test('buildZhTerms：空片段、超长片段会被丢掉', () => {
  assert.deepEqual(buildZhTerms('n. 书本；（注释）\n' + '长'.repeat(30)), [
    { term: '书本', gloss: 'n. 书本；（注释）' },
  ]);
});

test('buildZhTerms：跳过 [网络]/[医] 等专业来源的释义行', () => {
  assert.deepEqual(buildZhTerms('n. 苹果, 家伙\n[医] 苹果\n[网络] 苹果手机'), [
    { term: '苹果', gloss: 'n. 苹果, 家伙' },
    { term: '家伙', gloss: 'n. 苹果, 家伙' },
  ]);
});

test('isIndexableWord：app. / a. / apel- / 123 这类非词条不建索引', () => {
  assert.ok(isIndexableWord('apple'));
  assert.ok(isIndexableWord("don't"));
  assert.ok(isIndexableWord('well-known'));
  assert.ok(isIndexableWord('ice cream'));
  assert.ok(!isIndexableWord('app.'));
  assert.ok(!isIndexableWord('a.'));
  assert.ok(!isIndexableWord('apel-'));
  assert.ok(!isIndexableWord('12345'));
  assert.ok(!isIndexableWord('-foo'));
});

test('relevanceRank：中高考词最优先，生僻词最后', () => {
  assert.equal(relevanceRank('zk gk', 371), 0);        // teacher
  assert.equal(relevanceRank('gk cet4 ky', 4890), 0);  // delight
  assert.equal(relevanceRank('toefl', 24090), 1);      // hilarity
  assert.equal(relevanceRank('', 31123), 2);           // rebbe：有词频但不属于任何考试词表
  assert.equal(relevanceRank('', 0), 3);               // moolvee：没有词频 → 生僻
  assert.equal(relevanceRank(null, 0), 3);
});

test('searchZh：生僻词沉底，且没有更好结果时才兜底（老师 → teacher）', () => {
  const db3 = new Database(':memory:');
  db3.exec('CREATE TABLE zh_index (term TEXT, word TEXT, gloss TEXT, frq INTEGER, hot INTEGER, rank INTEGER)');
  const ins = db3.prepare('INSERT INTO zh_index VALUES (?, ?, ?, ?, 1, ?)');
  ins.run('老师', 'teacher', 'n. 老师', 371, 0);    // 中高考词
  ins.run('老师', 'rebbe', 'n. 老师', 31123, 2);    // 有词频但不常用
  ins.run('老师', 'moolvee', 'n. 老师', 0, 3);      // 生僻
  ins.run('老师', 'teachering', 'n. 老师', 0, 3);   // 生僻
  const results = searchZh(db3, '老师', 8);
  // 常用词在前，生僻词因为已有更好结果而不显示
  assert.deepEqual(results.map((r) => r.word), ['teacher', 'rebbe']);

  // 只有生僻词时兜底返回，不至于「什么都没找到」
  const db4 = new Database(':memory:');
  db4.exec('CREATE TABLE zh_index (term TEXT, word TEXT, gloss TEXT, frq INTEGER, hot INTEGER, rank INTEGER)');
  const ins4 = db4.prepare('INSERT INTO zh_index VALUES (?, ?, ?, ?, 0, ?)');
  ins4.run('犄角旮旯', 'nook', 'n. 犄角旮旯', 0, 3);
  assert.deepEqual(searchZh(db4, '犄角旮旯', 8).map((r) => r.word), ['nook']);
  db3.close();
  db4.close();
});

let tmp;
let db;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wordlock-zh-'));
  const fixtureDir = path.join(tmp, 'raw');
  fs.mkdirSync(fixtureDir);
  const fixture = new URL('./fixtures/mini-ecdict.csv', import.meta.url);
  fs.copyFileSync(fixture, path.join(fixtureDir, 'mini-ecdict.csv'));
  await buildDict({ rawDir: fixtureDir, outFile: path.join(tmp, 'dict.db') });
  db = new Database(path.join(tmp, 'dict.db'), { readonly: true });
});

after(() => {
  db?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('zh_index 已生成：苹果 能查到 apple', () => {
  const rows = db.prepare('SELECT word, gloss FROM zh_index WHERE term = ?').all('苹果');
  assert.ok(rows.length >= 1);
  assert.ok(rows.some((r) => r.word === 'apple'));
});

test('searchZh：精确命中排第一（苹果 → apple）', () => {
  const results = searchZh(db, '苹果');
  assert.ok(results.length >= 1);
  assert.equal(results[0].word, 'apple');
  assert.ok(results[0].gloss.includes('苹果'));
  // 不返回音标/释义字段
  assert.equal('phonetic' in results[0], false);
  assert.equal('translation' in results[0], false);
});

test('searchZh：前缀命中（高兴 → happy 的「高兴的」）', () => {
  const results = searchZh(db, '高兴');
  assert.ok(results.some((r) => r.word === 'happy'));
});

test('searchZh：精确命中（跑 → run）', () => {
  const results = searchZh(db, '跑');
  assert.equal(results[0].word, 'run');
});

test('searchZh：包含命中兜底也能找到', () => {
  // 「水」是 water 释义「n. 水；雨水」的精确片段；用「雨水」测包含之外的场景
  const results = searchZh(db, '水');
  assert.ok(results.some((r) => r.word === 'water'));
});

test('searchZh：三档排序——精确 > 前缀 > 包含', () => {
  const db2 = new Database(':memory:');
  db2.exec(`CREATE TABLE zh_index (term TEXT, word TEXT, gloss TEXT, frq INTEGER, hot INTEGER DEFAULT 0, rank INTEGER DEFAULT 0)`);
  const ins = db2.prepare('INSERT INTO zh_index VALUES (?, ?, ?, ?, 1, 0)');
  ins.run('爱学习', 'contain', 'n. 爱学习的人', 100);  // 只含“学习”，不算前缀
  ins.run('学习者', 'prefix', 'n. 学习者', 100);        // 以“学习”开头
  ins.run('学习', 'exact', 'v. 学习', 100);             // 完全相同
  const results = searchZh(db2, '学习', 8);
  assert.deepEqual(results.map((r) => r.word), ['exact', 'prefix', 'contain']);
  db2.close();
});

test('searchZh：同档内单词优先于短语、frq 小的在前、0 最后', () => {
  const db2 = new Database(':memory:');
  db2.exec(`CREATE TABLE zh_index (term TEXT, word TEXT, gloss TEXT, frq INTEGER, hot INTEGER DEFAULT 0, rank INTEGER DEFAULT 0)`);
  const ins = db2.prepare('INSERT INTO zh_index VALUES (?, ?, ?, ?, 1, 0)');
  ins.run('猫', 'big cats', 'n. 猫科动物', 10);         // 短语（含空格）
  ins.run('猫', 'zero', 'n. 猫', 0);                    // 无词频
  ins.run('猫', 'rare', 'n. 猫', 900);                  // 高名次=较生僻
  ins.run('猫', 'common', 'n. 猫', 10);                 // 常用
  const results = searchZh(db2, '猫', 8);
  assert.deepEqual(results.map((r) => r.word), ['common', 'rare', 'zero', 'big cats']);
  db2.close();
});

test('searchZh：同一个词只出现一次（不同释义行去重）', () => {
  const results = searchZh(db, '书');
  const words = results.map((r) => r.word);
  assert.equal(new Set(words).size, words.length);
});

test('searchZh：查不到返回空数组，不崩溃', () => {
  assert.deepEqual(searchZh(db, '不存在的词组合'), []);
  assert.deepEqual(searchZh(db, ''), []);
  assert.deepEqual(searchZh(null, '苹果'), []);
});
````
