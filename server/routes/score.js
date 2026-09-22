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
// 同一个会话里重复提交字节完全相同的音频不重复计数（只记最近几段，避免内存增长；
// 进程重启后重新计数 —— 这只影响"同一秒内反复回放"的场景，不影响正常使用）。
const audioFingerprints = new Map();
function isRepeatedAudio(profileId, sessionId, buffer) {
  const key = `${profileId}:${sessionId}`;
  const hash = crypto.createHash('sha1').update(buffer).digest('hex');
  const seen = audioFingerprints.get(key) ?? new Set();
  if (seen.has(hash)) return true;
  seen.add(hash);
  if (seen.size > 8) seen.clear();
  audioFingerprints.set(key, seen);
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

    // 重复提交同一段录音 → 不计入通过次数（也不算失败，提示重念）
    if (outcome.passed && buffer && isRepeatedAudio(profileId, sessionId, buffer)) {
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
