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
  const sid1 = SID();
  const r1 = await call('/api/session', { method: 'POST', profile: profileA, body: { sessionId: sid1, word: 'book', mode: 'en' } });
  assert.equal(r1.data.requiredCount, 1);
  assert.equal(r1.data.done, true); // N=1：第 1 次输入即完成

  const sid2 = SID();
  const r2 = await call('/api/session', { method: 'POST', profile: profileB, body: { sessionId: sid2, word: 'book', mode: 'en' } });
  assert.equal(r2.data.requiredCount, 2);
  assert.equal(r2.data.done, false);
  const r3 = await call('/api/typing', { method: 'POST', profile: profileB, body: { sessionId: sid2, typed: 'book' } });
  assert.equal(r3.data.done, true);
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
