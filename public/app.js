// WordLock 界面与流程（阶段 1～6）。
// 流程：档案 → 输入 N 次（英文/中文入口）→ 读音 → 跟读 M 次 → 释义 → 生词本/复习。

import {
  createTypingSession,
  createReadingSession,
  MSG_INVALID,
  MSG_LENGTH,
  positionMessage,
} from './state-machine.js?v=20260922c';
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
      if (res.error !== 'too_quiet') {
        logEvents([{ type: res.error === 'no_speech' || res.error === 'bad_audio' ? 'read_retry' : 'network_error',
                     word, detail: { error: res.error, score: res.score ?? null } }], { step: 'reading' });
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
