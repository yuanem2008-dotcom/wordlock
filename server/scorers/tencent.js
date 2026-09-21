// 腾讯云口语评测（单词模式）—— 预留实现位。
//
// 需求规定：第三方接口的参数、签名、格式必须以官方最新文档为准，不要凭记忆写。
// 等拿到腾讯云密钥后，按 https://cloud.tencent.com/document/api/1093 的最新文档实现
// score(wavBuffer, targetWord, options) 并返回：
//   { score: 0-100 数字, detail: 原始返回(可null), error: 出错时给错误描述 }
// 需要的环境变量（写在 .env）：
//   TENCENT_SECRET_ID=...
//   TENCENT_SECRET_KEY=...
//   TENCENT_SOE_REGION=ap-guangzhou  （地域以控制台为准）

export async function score() {
  return {
    score: null,
    detail: null,
    error: '腾讯云评测还没接入：请在 .env 填好密钥后，让 Claude 按官方文档实现本文件',
  };
}
