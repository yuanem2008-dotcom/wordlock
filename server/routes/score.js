// 发音评测接口（需求 5.1 / 阶段 2）+ 首次校准。

import { Router } from 'express';
import { getScorer, scorerIsConfigured } from '../scorers/index.js';
import { decideOutcome } from '../scoring-policy.js';
import { getProfileBundle } from '../settings.js';
import { LEVEL_COUNTS } from '../settings.js';
import { upsertSession, getSession } from '../sessions.js';
import { graduateWord } from '../vocab.js';

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

export function createScoreRouter(userDb) {
  const router = Router();
  const insertEvent = userDb.prepare(
    `INSERT INTO events (profile_id, ts, session_id, mode, word, step, type, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  router.post('/score', async (req, res) => {
    const profileId = req.profile.id;
    const bundle = getProfileBundle(userDb, req.profile);
    const passScore = Number(bundle.settings.passScore) || 60;

    const word = String(req.body?.word ?? '').slice(0, 64);
    const sessionId = String(req.body?.sessionId ?? '').slice(0, 64) || null;
    const audioBase64 = typeof req.body?.audioBase64 === 'string' ? req.body.audioBase64 : '';
    const mockScore = Number(req.body?.mockScore);
    const isMock = Number.isFinite(mockScore);
    const isCalibration = Boolean(req.body?.calibration); // 校准不进生词本、不记读数

    // 没录到有效声音：友好提示，不计入失败次数（需求 2.3）
    const buffer = audioBase64 ? Buffer.from(audioBase64, 'base64') : null;
    if (!isMock && (!buffer || buffer.length < 900)) {
      return res.json({ score: null, passed: false, error: 'too_quiet', message: '没听清，靠近一点再念一遍' });
    }
    if (buffer && buffer.length > MAX_AUDIO_BYTES) {
      return res.json({ score: null, passed: false, error: 'too_long', message: '录音有点长了，再试一次' });
    }

    const scorer = await getScorer();
    if (!scorerIsConfigured(scorer.name)) {
      return res.json({ score: null, passed: false, error: 'not_configured', message: '评测服务还没配置好' });
    }
    const result = await scorer.score(buffer, word, { mockScore: req.body?.mockScore });
    const outcome = decideOutcome(result, passScore);
    if (outcome.kind === 'retry') {
      // 环境/设备问题：不计入失败次数（需求 2.3），提示温和（需求 2.9）
      return res.json({
        score: null,
        passed: false,
        error: result.error || 'bad_audio',
        message: outcome.message,
        retry: true,
      });
    }
    if (outcome.kind === 'error') {
      // 服务故障：技术细节只写进服务器日志，给孩子只说"再试一次"
      console.warn(`[评测] ${scorer.name} 失败：${result.error}`);
      return res.json({ score: null, passed: false, error: result.error || 'scorer_error', message: outcome.message });
    }

    const passed = outcome.passed;

    if (sessionId && !isCalibration) {
      const col = passed ? 'read_pass' : 'read_fail';
      upsertSession(userDb, profileId, sessionId, { word, mode: 'en' });
      userDb
        .prepare(
          `UPDATE learn_sessions SET ${col} = ${col} + 1, read_attempts = read_attempts + 1, updated_at = ?
           WHERE profile_id = ? AND session_id = ?`
        )
        .run(new Date().toISOString(), profileId, sessionId);
      insertEvent.run(
        profileId,
        new Date().toISOString(),
        sessionId,
        'en',
        word,
        'reading',
        passed ? 'read_pass' : 'read_fail',
        JSON.stringify({ score: result.score })
      );

      // 读满 M 次（或求助通关）→ 通关写入生词本（阶段 3）
      const session = getSession(userDb, profileId, sessionId);
      if (session && !session.meaning_shown) {
        const m = LEVEL_COUNTS[bundle.effectiveLevel].reading;
        if (session.assisted || session.read_pass >= m) {
          graduateWord(userDb, profileId, word, {
            settings: bundle.settings,
            assisted: Boolean(session.assisted),
            readAttempts: session.read_attempts,
            bestScore: result.score,
          });
        }
      }
    }

    res.json({ score: result.score, passed, detail: result.detail ?? null });
  });

  // 首次校准（需求 阶段2）：passScore = clamp(round(平均分 − 15), 50, 75)
  router.post('/calibration', (req, res) => {
    const profileId = req.profile.id;
    const row = req.profile;
    let overrides = {};
    try {
      overrides = JSON.parse(row.settings_json || '{}') || {};
    } catch {
      overrides = {};
    }
    if (req.body?.skipped) {
      overrides.calibrated = true;
    } else {
      const scores = Array.isArray(req.body?.scores) ? req.body.scores : [];
      const nums = scores.map(Number).filter((n) => Number.isFinite(n));
      if (!nums.length) {
        return res.status(400).json({ error: '没有拿到校准分数' });
      }
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
      overrides.passScore = Math.min(75, Math.max(50, Math.round(avg - 15)));
      overrides.calibrated = true;
    }
    userDb
      .prepare('UPDATE profiles SET settings_json = ? WHERE id = ?')
      .run(JSON.stringify(overrides), profileId);
    res.json({ ok: true, passScore: overrides.passScore ?? null });
  });

  return router;
}
