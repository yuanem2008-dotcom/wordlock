// 标准读音播放（需求 5.3）。
// 重要：浏览器返回的英文语音列表里，第一个往往是最老、最机械的那个（macOS 上是 Albert），
// 所以这里不取第一个，而是按「声音饱满的男声」优先级挑选；家长也可以在家长模式里指定。
// 以后可以换成预先生成的 mp3，界面不用改。

const PREFERRED_VOICES = {
  'en-US': ['Reed', 'Rocko', 'Ralph', 'Fred', 'Junior', 'Alex', 'Aaron', 'Tom'],
  'en-GB': ['Daniel', 'Reed', 'Rocko', 'Ralph', 'Fred', 'Alex'],
};

let unlocked = false;
let voices = [];

function refreshVoices() {
  try {
    voices = window.speechSynthesis?.getVoices() ?? [];
  } catch {
    voices = [];
  }
}

if (typeof window !== 'undefined' && window.speechSynthesis) {
  refreshVoices();
  window.speechSynthesis.onvoiceschanged = refreshVoices;
}

function normalizeLang(lang) {
  return String(lang ?? '').replace('_', '-');
}

// 给家长模式的下拉框用：列出这台设备上所有英文嗓音
export function listEnglishVoices() {
  if (!voices.length) refreshVoices();
  return voices
    .filter((v) => /^en/i.test(v.lang ?? ''))
    .map((v) => ({ name: v.name, lang: normalizeLang(v.lang) }))
    .sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
}

function findByNames(candidates, list) {
  for (const wanted of candidates) {
    const hit = list.find((v) => v.name.toLowerCase().startsWith(wanted.toLowerCase()));
    if (hit) return hit;
  }
  return null;
}

function pickVoice(accent, preferredName) {
  if (!voices.length) refreshVoices();
  const lang = accent === 'en-GB' ? 'en-GB' : 'en-US';
  const sameLang = voices.filter((v) => normalizeLang(v.lang) === lang);

  // 1) 家长指定的嗓音优先
  if (preferredName) {
    const exact = voices.find((v) => v.name.toLowerCase() === preferredName.toLowerCase());
    if (exact) return exact;
    const fuzzy = voices.find((v) => v.name.toLowerCase().startsWith(preferredName.toLowerCase()));
    if (fuzzy) return fuzzy;
  }
  // 2) 该口音下的饱满男声
  const preferred = findByNames(PREFERRED_VOICES[lang] ?? [], sameLang);
  if (preferred) return preferred;
  // 3) 同口音任意嗓音 → 任意英文嗓音
  return sameLang[0] ?? voices.find((v) => /^en/i.test(v.lang ?? '')) ?? null;
}

// iOS/ iPadOS 要求首次播放必须在用户点击里触发。
export function unlockTTS() {
  if (unlocked || typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    const u = new SpeechSynthesisUtterance('');
    window.speechSynthesis.speak(u);
    unlocked = true;
  } catch {
    // 忽略：解锁失败不影响后续手动播放
  }
}

export function speakWord(word, accent = 'en-US', voiceName = '') {
  if (typeof window === 'undefined' || !window.speechSynthesis || !word) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = accent === 'en-GB' ? 'en-GB' : 'en-US';
    u.rate = 0.8;
    const voice = pickVoice(u.lang, voiceName);
    if (voice) u.voice = voice;
    window.speechSynthesis.speak(u);
  } catch {
    // 播放失败不打扰孩子
  }
}
