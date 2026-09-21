// 词典查询接口（check-word / pronunciation / search-zh）。

import { Router } from 'express';
import { findSuggestions } from '../suggest.js';
import { searchZh } from '../zh-search.js';
import { getSession, sessionUnlocksPronunciation } from '../sessions.js';
import { getLearnedWord } from '../vocab.js';
import { getProfileBundle } from '../settings.js';
import { lookupLimitState } from '../limits.js';

export function createDictRouter({ getDictDb, userDb }) {
  const router = Router();

  const WORD_RE = /^[a-z'-]+$/;

  function normalize(raw) {
    return String(raw ?? '').trim().toLowerCase();
  }

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
