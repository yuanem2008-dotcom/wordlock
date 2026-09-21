// 集成测试：直接打 HTTP API，验证阶段 2～5 的服务器行为与验收项。

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
process.env.NODE_ENV = 'test';

const { openUserDb } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { buildDict } = await import('../scripts/build-dict.js');
const { makeCaller } = await import('./helpers/dispatch.js');
const { default: Database } = await import('better-sqlite3');

let userDb;
let dictDb;
let callRaw;
let profileA; // 小学：门槛 1
let profileB; // 初中：门槛 2
let parentToken;

const SID = () => crypto.randomUUID();

before(async () => {
  const raw = path.join(dataDir, 'raw');
  fs.mkdirSync(raw);
  fs.copyFileSync(new URL('./fixtures/mini-ecdict.csv', import.meta.url), path.join(raw, 'mini.csv'));
  await buildDict({ rawDir: raw, outFile: path.join(dataDir, 'dict.db') });

  userDb = openUserDb();
  dictDb = new Database(path.join(dataDir, 'dict.db'), { readonly: true });
  const app = createApp({ userDb, dictDb });
  callRaw = makeCaller(app);

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

async function call(pathname, { method = 'GET', body, profile, session, parent, noProfile } = {}) {
  const headers = {};
  if (profile) headers['X-Profile-Id'] = String(profile);
  if (session) headers['X-Session-Id'] = session;
  if (parent) headers['X-Parent-Token'] = parent;
  return callRaw(pathname, { method, body, headers });
}

async function sendEvent(profile, sessionId, type, word, mode = 'en', step = 'typing') {
  return call('/api/events', {
    method: 'POST',
    profile,
    body: { sessionId, type, word, mode, step },
  });
}

/* ---------- 阶段 2/3：跟读 → 释义 → 生词本 ---------- */

test('完整流程：输入完成 → 读音放行 → 跟读通过 → 释义放行 → 进生词本', async () => {
  const sid = SID();
  // 未完成输入时：读音与释义都是 403
  const p403 = await call('/api/pronunciation/run', { profile: profileA, session: sid });
  assert.equal(p403.status, 403);
  const m403 = await call('/api/meaning/run', { profile: profileA, session: sid });
  assert.equal(m403.status, 403);

  assert.equal((await call('/api/check-word', { method: 'POST', profile: profileA, body: { word: 'run' } })).data.exists, true);
  await sendEvent(profileA, sid, 'lookup_start', 'run');
  await sendEvent(profileA, sid, 'typing_done', 'run');

  const pron = await call('/api/pronunciation/run', { profile: profileA, session: sid });
  assert.equal(pron.status, 200);
  assert.equal(pron.data.word, 'run');
  assert.ok(pron.data.phonetic.length > 0);

  // 跟读通过（小学门槛 1 次）
  const score = await call('/api/score', {
    method: 'POST', profile: profileA, session: sid,
    body: { word: 'run', sessionId: sid, mockScore: 90 },
  });
  assert.equal(score.data.passed, true);
  assert.ok(score.data.score >= 60);

  const meaning = await call('/api/meaning/run', { profile: profileA, session: sid });
  assert.equal(meaning.status, 200);
  assert.ok(meaning.data.lines.length >= 1);

  const vocabA = await call('/api/vocab', { profile: profileA });
  assert.ok(vocabA.data.words.some((w) => w.word === 'run' && w.status === 'learned'));
  // 另一个档案看不到
  const vocabB = await call('/api/vocab', { profile: profileB });
  assert.ok(!vocabB.data.words.some((w) => w.word === 'run'));
});

test('没过关就请求释义返回 403（阶段3 验收）', async () => {
  const sid = SID();
  await sendEvent(profileA, sid, 'typing_done', 'happy');
  const score = await call('/api/score', {
    method: 'POST', profile: profileA, session: sid,
    body: { word: 'happy', sessionId: sid, mockScore: 10 }, // 不及格
  });
  assert.equal(score.data.passed, false);
  const m = await call('/api/meaning/happy', { profile: profileA, session: sid });
  assert.equal(m.status, 403);
  const row = userDb.prepare('SELECT * FROM vocab WHERE profile_id = ? AND word = ?').get(profileA, 'happy');
  assert.equal(row, undefined); // 没通关不进生词本
});

test('已学会的词免门槛：check-word 返回 learned，释义直接可看（2.8）', async () => {
  const cw = await call('/api/check-word', { method: 'POST', profile: profileA, body: { word: 'run' } });
  assert.equal(cw.data.learned, true);
  const m = await call('/api/meaning/run', { profile: profileA, session: SID() });
  assert.equal(m.status, 200);
  assert.ok(m.data.learnedDaysAgo != null);
  // 另一个档案没有学会
  const cwB = await call('/api/check-word', { method: 'POST', profile: profileB, body: { word: 'run' } });
  assert.equal(cwB.data.learned, false);
});

test('中文候选标记已学会（2.8）', async () => {
  const zh = await call('/api/search-zh', { method: 'POST', profile: profileA, body: { query: '跑' } });
  const run = zh.data.results.find((r) => r.word === 'run');
  assert.ok(run);
  assert.equal(run.learned, true);
});

test('读不够次数不能看释义；求助通关可以（阶段2/3）', async () => {
  // 初中档案：跟读门槛 2 次
  const sid = SID();
  await sendEvent(profileB, sid, 'typing_done', 'book');
  await call('/api/score', { method: 'POST', profile: profileB, session: sid, body: { word: 'book', sessionId: sid, mockScore: 95 } });
  const m1 = await call('/api/meaning/book', { profile: profileB, session: sid });
  assert.equal(m1.status, 403);
  // 求助通关
  await sendEvent(profileB, sid, 'help_used', 'book');
  const m2 = await call('/api/meaning/book', { profile: profileB, session: sid });
  assert.equal(m2.status, 200);
  const row = userDb.prepare('SELECT * FROM vocab WHERE profile_id = ? AND word = ?').get(profileB, 'book');
  assert.equal(row.assisted, 1);
  assert.ok(row.next_review_at); // 求助通关也进生词本
  // assisted 额外一轮复习：间隔 1,2,7 + 8
  const { effectiveIntervals } = await import('../server/vocab.js');
  assert.equal(effectiveIntervals(row, { reviewIntervals: [1, 2, 7] }).length, 4);
});

test('首次校准：平均分 −15，夹在 50–75（阶段2）', async () => {
  const res = await call('/api/calibration', { method: 'POST', profile: profileB, body: { scores: [70, 80, 90] } });
  assert.equal(res.data.passScore, 65);
  const settings = await call('/api/settings', { profile: profileB });
  assert.equal(settings.data.settings.calibrated, true);
});

/* ---------- 阶段 3：复习调度 ---------- */

test('复习：答错退回并明天再考；答对进入下一间隔（阶段3）', async () => {
  // 把 run 的复习安排到今天
  userDb.prepare("UPDATE vocab SET next_review_at = ? WHERE profile_id = ? AND word = 'run'").run(todayLocal(0), profileA);
  const today = await call('/api/review/today', { profile: profileA });
  assert.ok(today.data.words.some((w) => w.word === 'run'));
  assert.ok(today.data.words.length <= 3); // reviewPerDay = 3

  let ans = await call('/api/review/answer', { method: 'POST', profile: profileA, body: { word: 'run', typed: 'rnu' } });
  assert.equal(ans.data.correct, false);
  assert.equal(ans.data.nextReviewAt, todayLocal(1)); // 第二天再考
  ans = await call('/api/review/answer', { method: 'POST', profile: profileA, body: { word: 'run', typed: 'run' } });
  assert.equal(ans.data.correct, true);
  assert.equal(ans.data.nextReviewAt, todayLocal(2)); // 进入间隔 [1,2,7] 的第 2 个
  // 填回今天的到期时间，供下一个测试用
  userDb.prepare("UPDATE vocab SET next_review_at = ?, stage = 0 WHERE profile_id = ? AND word = 'run'").run(todayLocal(0), profileA);
});

test('复习每天最多 reviewPerDay 个（阶段3）', async () => {
  const ins = userDb.prepare(
    `INSERT INTO vocab (profile_id, word, status, first_learned_at, next_review_at)
     VALUES (?, ?, 'learned', ?, ?)`
  );
  const now = new Date().toISOString();
  for (const w of ['paper', 'pen', 'pencil', 'rain', 'sun']) {
    ins.run(profileA, w, now, todayLocal(0));
  }
  const today = await call('/api/review/today', { profile: profileA });
  assert.ok(today.data.words.length <= 3);
  assert.equal(today.data.words.length, 3);
});

/* ---------- 阶段 5：快速查看 ---------- */

test('快速查看：默认关闭；打开后限额生效；pending 不免门槛（阶段5）', async () => {
  // 默认关闭
  const qp0 = await call('/api/quick-peek', { method: 'POST', profile: profileA, session: SID(), body: { word: 'water' } });
  assert.equal(qp0.status, 403);

  // 家长设置 2 次/天
  await call(`/api/parent/profiles/${profileA}/settings`, {
    method: 'POST', parent: await getParent(), body: { quickPeekPerDay: 2 },
  });

  const sid1 = SID();
  const peek1 = await call('/api/quick-peek', { method: 'POST', profile: profileA, session: sid1, body: { word: 'water' } });
  assert.equal(peek1.status, 200);
  assert.equal(peek1.data.remaining, 1);
  assert.ok(peek1.data.lines.length >= 1);
  assert.equal(userDb.prepare('SELECT status FROM vocab WHERE profile_id = ? AND word = ?').get(profileA, 'water')?.status, 'pending');

  await call('/api/quick-peek', { method: 'POST', profile: profileA, session: SID(), body: { word: 'moon' } });
  const peek3 = await call('/api/quick-peek', { method: 'POST', profile: profileA, session: SID(), body: { word: 'star' } });
  assert.equal(peek3.status, 403);

  // pending 的词不免门槛：直接要释义被拒（water 的 peek 会话除外）
  const stranger = await call('/api/meaning/water', { profile: profileA, session: SID() });
  assert.equal(stranger.status, 403);

  // 待巩固：完整过输入 + 跟读 → 跟读通关时自动转 learned
  const sid2 = SID();
  await sendEvent(profileA, sid2, 'typing_done', 'water');
  await call('/api/score', { method: 'POST', profile: profileA, session: sid2, body: { word: 'water', sessionId: sid2, mockScore: 88 } });
  assert.equal(userDb.prepare('SELECT status FROM vocab WHERE profile_id = ? AND word = ?').get(profileA, 'water')?.status, 'learned');

  // 兜底接口：没跟读就被拒绝（403）
  const notReady = await call('/api/pending/moon/complete', { method: 'POST', profile: profileA, session: SID() });
  assert.equal(notReady.status, 403);
  const status = await call('/api/pending/water/status', { profile: profileA });
  assert.equal(status.data.status, 'learned');
});

/* ---------- 阶段 4：每日上限 + 家长模式 ---------- */

test('每日查词上限：达到后不能再开始新的词（阶段4）', async () => {
  await call(`/api/parent/profiles/${profileA}/settings`, {
    method: 'POST', parent: await getParent(), body: { dailyLookupLimit: 1 },
  });
  const cw1 = await call('/api/check-word', { method: 'POST', profile: profileA, body: { word: 'sun' } });
  assert.equal(cw1.data.allowed, true);
  await sendEvent(profileA, SID(), 'typing_ok', 'sun');
  const cw2 = await call('/api/check-word', { method: 'POST', profile: profileA, body: { word: 'moon' } });
  assert.equal(cw2.data.allowed, false);
  // 复习不受影响
  const today = await call('/api/review/today', { profile: profileA });
  assert.equal(today.status, 200);
});

let cachedParent = null;
async function getParent() {
  if (cachedParent) return cachedParent;
  const has = await call('/api/parent/has-pin', { noProfile: true });
  let token;
  if (!has.data.hasPin) {
    token = (await call('/api/parent/pin', { method: 'POST', noProfile: true, body: { pin: '135790' } })).data.token;
  } else {
    token = (await call('/api/parent/login', { method: 'POST', noProfile: true, body: { pin: '135790' } })).data.token;
  }
  cachedParent = token;
  return token;
}

test('家长模式：PIN 校验、改名、删除档案（阶段4）', async () => {
  // 没有令牌不能进家长接口
  const denied = await call('/api/parent/records?profile=1');
  assert.equal(denied.status, 401);

  const wrong = await call('/api/parent/login', { method: 'POST', noProfile: true, body: { pin: '000000' } });
  assert.equal(wrong.status, 403);

  const token = await getParent();
  assert.ok(token);

  const rename = await call(`/api/parent/profiles/${profileB}`, {
    method: 'POST', parent: token, body: { name: '改个名' },
  });
  assert.equal(rename.status, 200);
  const list = await call('/api/profiles');
  assert.ok(list.data.profiles.some((p) => p.id === profileB && p.name === '改个名'));

  // 删除档案连带数据
  const del = await call(`/api/parent/profiles/${profileB}`, { method: 'DELETE', parent: token });
  assert.equal(del.status, 200);
  assert.equal(userDb.prepare('SELECT COUNT(*) n FROM events WHERE profile_id = ?').get(profileB).n, 0);
  assert.equal(userDb.prepare('SELECT COUNT(*) n FROM vocab WHERE profile_id = ?').get(profileB).n, 0);
  // 把 profileB 标记为已删除，后续没有用到它的测试
  profileB = -1;
});

test('家长汇总：放弃点统计与 events 一致（阶段4 / 2.10）', async () => {
  const token = await getParent();
  // 造一个 11 分钟前放弃的流程（没到 meaning_shown）
  const old = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  userDb.prepare(
    `INSERT INTO events (profile_id, ts, session_id, mode, word, step, type)
     VALUES (?, ?, ?, 'en', 'quixotic', 'reading', 'read_fail')`
  ).run(profileA, old, 'abandoned-session');

  const summary = await call(`/api/parent/summary?profile=${profileA}`, { parent: token });
  assert.equal(summary.status, 200);
  assert.ok(summary.data.lookedUp >= 1);
  assert.ok(summary.data.giveUp.total >= 1);
  assert.ok(summary.data.giveUp.conclusion.length > 0);
  assert.ok(['typing', 'candidates', 'reading', 'meaning', 'review'].includes(Object.keys(summary.data.giveUp.byStep)[0]));
});

test('记录接口可按日期筛选（阶段4）', async () => {
  const token = await getParent();
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const res = await call(`/api/parent/records?profile=${profileA}&date=${y}-${m}-${d}`, { parent: token });
  assert.equal(res.status, 200);
  assert.ok(res.data.records.length >= 1);
});

test('生态接口：stats / garden / theme', async () => {
  const stats = await call('/api/stats', { profile: profileA });
  assert.ok(stats.data.totalDays >= 1);
  const garden = await call('/api/garden', { profile: profileA });
  assert.ok(garden.data.total >= 1);
  assert.equal(garden.data.familyEnabled, false);
  const theme = await call('/api/theme', { method: 'POST', profile: profileA, body: { theme: 'garden' } });
  assert.equal(theme.data.theme, 'garden');
  const settings = await call('/api/settings', { profile: profileA });
  assert.equal(settings.data.settings.theme, 'garden');
});
