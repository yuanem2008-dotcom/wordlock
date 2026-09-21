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
