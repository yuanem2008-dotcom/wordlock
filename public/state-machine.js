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
