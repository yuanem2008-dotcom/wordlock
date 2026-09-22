// 讯飞开放平台「语音评测（ISE）」—— 英语单词模式。
//
// 本文件按官方文档实现（2026-09 核对）：
//   https://www.xfyun.cn/doc/Ise/IseAPI.html  （语音评测 流式版 API 文档）
// 要点：
//   - 地址：wss://ise-api.xfyun.cn/v2/open-ise
//   - 鉴权：HMAC-SHA256，签名串是 host/date/request-line 三行，再 base64 成 authorization
//   - 音频：16k、16bit、单声道 PCM，每帧 1280 字节（官方建议每 40ms 一帧）
//   - 流程：先发一帧 ssb（上传评测参数），再按 auw 逐帧发音频（首帧 aus=1、中间 aus=2、末帧 aus=4 且 status=2）
//   - 返回：data.data 是 base64 的 XML，里面 total_score 等就是分数
//
// 需要的环境变量（.env）：
//   XUNFEI_APP_ID / XUNFEI_API_KEY / XUNFEI_API_SECRET
//   可选：XUNFEI_GROUP（pupil/youth/adult，默认 pupil）、XUNFEI_CHECK_TYPE（easy/common/hard，默认 easy）

import crypto from 'node:crypto';

const HOST = 'ise-api.xfyun.cn';
const PATH = '/v2/open-ise';
const FRAME_BYTES = 1280;      // 官方建议：每帧 1280 字节
const FRAME_INTERVAL_MS = 40;  // 官方建议：每 40ms 一帧
const OVERALL_TIMEOUT_MS = 20000;

/* ---------- 鉴权 ---------- */

// 官方签名串（三行，冒号后有空格），apiSecret 做 HMAC-SHA256 再 base64。
export function signOrigin(date, apiSecret) {
  const origin = `host: ${HOST}\ndate: ${date}\nGET ${PATH} HTTP/1.1`;
  return crypto.createHmac('sha256', apiSecret).update(origin).digest('base64');
}

// 带鉴权参数的 wss 地址。spaced 控制 authorization 里逗号后是否带空格：
// 文档正文用的是不带空格的写法，而官方示例代码历史上用带空格的写法，两种都可能被接受，
// 所以保留这个开关，鉴权失败时换另一种重试。
export function buildAuthUrl({ apiKey, apiSecret, date = new Date().toUTCString(), spaced = false }) {
  const signature = signOrigin(date, apiSecret);
  const parts = [
    `api_key="${apiKey}"`,
    `algorithm="hmac-sha256"`,
    `headers="host date request-line"`,
    `signature="${signature}"`,
  ];
  const authOrigin = parts.join(spaced ? ', ' : ',');
  const authorization = Buffer.from(authOrigin).toString('base64');
  const query = new URLSearchParams({ host: HOST, date, authorization });
  return `wss://${HOST}${PATH}?${query.toString()}`;
}

/* ---------- 音频处理 ---------- */

// 读出 WAV 的格式（不是 WAV 就返回 null）
export function readWavFormat(buffer) {
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= buffer.length) {
      return {
        formatTag: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

// 取出裸 PCM 数据。不能写死"跳过 44 字节"——WAV 里可能有 LIST/fact 等额外块，
// afconvert 生成的 WAV 就带 LIST 块，写死偏移会把块头当成音频，讯飞直接报 48195 格式不符。
export function extractPcm(buffer) {
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return buffer; // 已经是裸 PCM
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'data') return buffer.subarray(body, Math.min(body + size, buffer.length));
    offset = body + size + (size % 2);
  }
  return buffer.subarray(Math.min(44, buffer.length)); // 兜底
}

// 切成 1280 字节一帧，并标好 aus（1 首帧 / 2 中间 / 4 末帧）和 status（0 / 1 / 2）。
export function buildAudioFrames(pcm, frameBytes = FRAME_BYTES) {
  const frames = [];
  for (let offset = 0; offset < pcm.length; offset += frameBytes) {
    const chunk = pcm.subarray(offset, Math.min(offset + frameBytes, pcm.length));
    const isFirst = offset === 0;
    const isLast = offset + frameBytes >= pcm.length;
    frames.push({
      data: chunk,
      aus: isFirst ? 1 : isLast ? 4 : 2,
      status: isFirst && isLast ? 2 : isFirst ? 0 : isLast ? 2 : 1,
    });
  }
  return frames;
}

/* ---------- 结果解析 ---------- */

function attr(xml, name) {
  const m = xml.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

export function parseResultXml(xml) {
  const num = (name) => {
    const v = attr(xml, name);
    if (v == null || v === '') return null; // 注意 Number(null) 是 0，会假装成 0 分
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    total: num('total_score'),
    // 官方文档里把 accuracy 写成了 accuracy_socre（原文如此），两种都认
    accuracy: num('accuracy_score') ?? num('accuracy_socre'),
    fluency: num('fluency_score'),
    integrity: num('integrity_score'),
    phone: num('phone_score'),
    tone: num('tone_score'),
    standard: num('standard_score'),
    rejected: attr(xml, 'is_rejected') === 'true',
    exceptInfo: num('except_info'),
    dpMessage: attr(xml, 'dp_message'),
  };
}

// 讯飞单词评测的原始分是 0~5 分制。官方 FAQ 给了对照表：
//   4.3~5 分 = 86~100 分（优）｜3.5~4.2 = 70~85（良）｜2.5~3.4 = 50~69（中）
//   1.5~2.4 = 30~49（差）｜0~1.4 = 0~29（很差）
// 本应用统一用 0~100（通过线 60/70 也是按这个来的），所以要乘 20。
export function toHundredScale(raw) {
  if (raw == null) return null;
  return Math.max(0, Math.min(100, Math.round(raw * 20)));
}

// except_info 的含义（官方文档）：
//   0     无异常
//   28673 无语音输入或音量太小      → 没念/太小声：不计入失败
//   28676 检测到语音为乱说类型      → 读的是别的词：算一次失败
//   28680 信噪比太低（1.7 以下）    → 环境太吵
//   28709 信噪比太低（0.7 以下）    → 环境太吵
//   28690 音频出现截幅              → 录音爆了（设备/距离问题）
const NO_SPEECH_EXCEPT = 28673;
const NOISY_EXCEPTS = new Set([28680, 28709, 28690]);

// 分类结果，具体的处置（算不算失败）交给 scoring-policy
export function classifyResult(parsed) {
  if (parsed.exceptInfo === NO_SPEECH_EXCEPT) return 'no_speech';
  if (NOISY_EXCEPTS.has(parsed.exceptInfo)) return 'noisy';
  if (parsed.rejected) return 'nonsense'; // 乱读：官方说此时分数不可信，按失败处理
  if (parsed.total == null) return 'no_speech';
  return 'ok';
}

/* ---------- 主流程 ---------- */

// 英文题型的「试题」有固定写法：首行是标记，之后每行一个单词。
// 见《语音评测试题格式及结果说明》：read_word → 首行 [word]；read_sentence → 首行 [content]。
// 直接发裸单词会被判为「试题格式错误」并报 48195，所以这里必须拼上标记。
export function buildExamText(word, category = 'read_word') {
  const marker = category === 'read_sentence' ? '[content]' : '[word]';
  return `﻿${marker}\n${word}`; // 官方要求带 BOM 的 UTF-8
}

function businessFor(cmd, word, aus) {
  // 含空格的短语（"nice day"）用句子模式：单词模式下讯飞评不准，且试题标记不同
  const category = /\s/.test(word) ? 'read_sentence' : 'read_word';
  const business = {
    sub: 'ise',
    ent: 'en_vip',           // 英文评测
    category,
    cmd,
    text: buildExamText(word, category),
    tte: 'utf-8',
    ttp_skip: true,          // 跳过文本上传阶段
    aue: 'raw',              // 裸 PCM
    auf: 'audio/L16;rate=16000',
    rst: 'entirety',
    ise_unite: '0',
    plev: '0',
    group: process.env.XUNFEI_GROUP || 'pupil',        // 小学生
    check_type: process.env.XUNFEI_CHECK_TYPE || 'easy', // 评分宽松一些
  };
  if (aus !== undefined) business.aus = aus;
  return business;
}

function evaluateOnce({ url, appId, pcm, word }) {
  const debug = process.env.XUNFEI_DEBUG === '1';
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {}
      resolve(value);
    };

    const timer = setTimeout(() => finish({ error: '讯飞评测超时，请再试一次' }), OVERALL_TIMEOUT_MS);
    let socket;
    try {
      socket = new WebSocket(url);
    } catch (err) {
      clearTimeout(timer);
      return resolve({ error: `连不上讯飞：${err.message}` });
    }

    socket.addEventListener('error', () => finish({ error: '连不上讯飞，请检查网络' }));
    socket.addEventListener('close', () => finish({ error: '讯飞连接被关闭' }));

    socket.addEventListener('open', async () => {
      // 第 1 帧：上传评测参数（不带音频）
      if (debug) console.log('[讯飞] 连接已建立，发送 ssb');
      socket.send(
        JSON.stringify({
          common: { app_id: appId },
          business: businessFor('ssb', word),
          data: { status: 0, data: '' },
        })
      );
      // 给服务端一点时间把参数准备好，再开始推音频（立刻推会被拒：iSEInputAppend error）
      await new Promise((r) => setTimeout(r, 250));
      // 之后逐帧送音频，按官方建议 40ms 一帧
      for (const frame of buildAudioFrames(pcm)) {
        if (settled) return;
        socket.send(
          JSON.stringify({
            common: { app_id: appId },
            business: businessFor('auw', word, frame.aus),
            data: { status: frame.status, data: frame.data.toString('base64') },
          })
        );
        await new Promise((r) => setTimeout(r, FRAME_INTERVAL_MS));
      }
    });

    socket.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
      } catch {
        return;
      }
      if (debug) {
        const brief = { ...msg, data: msg.data ? { ...msg.data, data: msg.data.data ? `<${String(msg.data.data).length} 字节>` : '' } : undefined };
        console.log('[讯飞] 收到：', JSON.stringify(brief).slice(0, 300));
      }
      if (msg.code !== 0) {
        const hint = msg.code === 10313 ? 'APPID 和密钥不匹配，请检查 .env' : msg.message || '讯飞返回错误';
        return finish({ error: `讯飞评测失败（${msg.code}）：${hint}` });
      }
      if (msg.data?.status !== 2 || !msg.data?.data) return; // 还没结束
      let xml;
      try {
        xml = Buffer.from(msg.data.data, 'base64').toString('utf8');
      } catch {
        return finish({ error: '讯飞返回的结果看不懂' });
      }
      if (debug) console.log('[讯飞] 最终结果 XML：', xml.slice(0, 800));
      const parsed = parseResultXml(xml);
      const kind = classifyResult(parsed);
      if (kind === 'no_speech') {
        return finish({ error: 'no_speech', detail: { ...parsed } });
      }
      if (kind === 'nonsense') {
        // 孩子读的不是这个词：官方说这时分数不可信，按一次失败的低分处理
        return finish({ score: 0, detail: { ...parsed, rawScore: parsed.total, nonsense: true } });
      }
      finish({
        score: toHundredScale(parsed.total),
        detail: { ...parsed, rawScore: parsed.total, noisy: kind === 'noisy' },
      });
    });
  });
}

export async function score(wavBuffer, targetWord) {
  const appId = process.env.XUNFEI_APP_ID;
  const apiKey = process.env.XUNFEI_API_KEY;
  const apiSecret = process.env.XUNFEI_API_SECRET;
  if (!appId || !apiKey || !apiSecret) {
    return { score: null, detail: null, error: '还没在 .env 里填写讯飞的 APPID / APIKey / APISecret' };
  }
  const word = String(targetWord ?? '').trim();
  if (!word) return { score: null, detail: null, error: '没有要评测的单词' };

  const format = readWavFormat(wavBuffer);
  if (format && (format.sampleRate !== 16000 || format.bitsPerSample !== 16 || format.channels !== 1)) {
    console.warn(
      `[评测] 音频格式不是 16kHz/16bit/单声道（当前 ${format.sampleRate}Hz/${format.bitsPerSample}bit/${format.channels}声道），讯飞可能拒绝`
    );
  }
  const pcm = extractPcm(wavBuffer);
  if (pcm.length < 1600) return { score: null, detail: null, error: 'no_speech' };

  // 文档正文与历史示例的 authorization 写法略有差异，先按文档、失败再换一种
  for (const spaced of [false, true]) {
    const url = buildAuthUrl({ apiKey, apiSecret, spaced });
    const result = await evaluateOnce({ url, appId, pcm, word });
    const authFailed = result.error && /(11200|401|unauthorized|鉴权)/i.test(result.error);
    if (!authFailed) return result;
  }
  return { score: null, detail: null, error: '讯飞鉴权没通过，请检查 .env 里的 APPID / APIKey / APISecret 是否对得上' };
}
