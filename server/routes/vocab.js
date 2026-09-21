// 释义 / 生词本 / 复习（需求 2.4、2.8、阶段 3）。

import { Router } from 'express';
import { getProfileBundle, LEVEL_COUNTS } from '../settings.js';
import { getSession, upsertSession } from '../sessions.js';
import {
  getVocabWord,
  getLearnedWord,
  learnedDaysAgo,
  dueWords,
  pendingWords,
  applyReviewResult,
  graduateWord,
} from '../vocab.js';

function normalizeWord(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

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

  // 释义（需求 2.4）：只有完成跟读 / 求助通关 / 快速看过 / 已学会 才返回，否则 403。
  router.get('/meaning/:word', (req, res) => {
    const profileId = req.profile.id;
    const bundle = getProfileBundle(userDb, req.profile);
    const word = normalizeWord(req.params.word);
    const dictDb = getDictDb();
    if (!dictDb) return res.status(503).json({ error: '词典还没建立' });

    const learned = getLearnedWord(userDb, profileId, word);
    const session = getSession(userDb, profileId, req.get('X-Session-Id'));
    const m = LEVEL_COUNTS[bundle.effectiveLevel].reading;
    const readComplete = session && (session.read_pass >= m || session.assisted === 1);
    if (!learned && !readComplete && !(session && session.quick_peek === 1)) {
      return res.status(403).json({ error: '要先完成跟读才能看释义哦' });
    }

    const lines = translationLines(dictDb, word, bundle.settings.meaningLines);
    logEvent(profileId, { sessionId: session?.session_id, word, type: 'meaning_shown', step: 'meaning' });
    upsertSession(userDb, profileId, session?.session_id, { word, meaning_shown: 1 });
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
    const readOk = session && (session.read_pass >= m || session.assisted === 1);
    if (!readOk) {
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
