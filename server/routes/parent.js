// 家长模式（需求 阶段4）：PIN、档案管理、参数设置、记录、每周汇总、导出、家庭花园。

import { Router } from 'express';
import crypto from 'node:crypto';
import { PRESETS, AVATARS } from '../presets.js';
import { mergeSettings } from '../presets.js';
import { getProfileBundle } from '../settings.js';
import { todayLocal, effectiveIntervals, getVocabWord } from '../vocab.js';

const router = Router();

/* ---------- 访问令牌：服务重启后失效，需重新输 PIN ---------- */

const bootSecret = crypto.randomBytes(32);
const parentToken = () => crypto.createHmac('sha256', bootSecret).update('parent-v1').digest('hex');

function requireParent(req, res, next) {
  const token = String(req.get('X-Parent-Token') ?? '');
  if (token !== parentToken()) {
    return res.status(401).json({ error: '请先输入家长密码' });
  }
  next();
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
  const salt = crypto.randomBytes(16).toString('hex');
  setMeta('parent_pin_salt', salt);
  setMeta('parent_pin_hash', hashPin(pin, salt));
  res.json({ ok: true, token: parentToken() });
});

router.post('/parent/login', (req, res) => {
  const pin = String(req.body?.pin ?? '');
  const salt = getMeta('parent_pin_salt');
  const hash = getMeta('parent_pin_hash');
  if (!salt || !hash) return res.status(400).json({ error: '还没有设置密码' });
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(hashPin(pin, salt), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: '密码不对，再试试' });
  }
  res.json({ ok: true, token: parentToken() });
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
