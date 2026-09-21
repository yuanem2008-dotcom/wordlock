// 跟读评测的处置策略：把「评测器返回的结果 + 通过线」变成对孩子的处置。
//
// 决策原则（需求 2.3 与 2.9）：
//   - 环境/设备问题（没说、太吵、录爆了）不该算孩子读错 → retry，不计入失败次数
//   - 但环境有问题而孩子其实读得不错 → 直接算通过，不让孩子白念
//   - 读的是别的词（乱读）→ fail，正常计入失败次数（否则乱念也能过关，门槛就废了）
//   - 服务故障（网络/鉴权）→ error，只提示"再试一次"

export const MESSAGES = {
  no_speech: '没听清，靠近一点再念一遍',
  bad_audio: '周围有点吵，换个安静的地方再试一次',
  error: '评测没成功，再试一次',
};

// result: { score, error, detail } 来自 scorer
// 返回：{ kind: 'pass'|'fail'|'retry'|'error', score?, passed?, message? }
//   retry = 不计入失败次数（孩子不受罚）
export function decideOutcome(result, passScore) {
  if (result?.error || result?.score == null) {
    if (result?.error === 'no_speech') return { kind: 'retry', message: MESSAGES.no_speech };
    if (result?.error === 'bad_audio') return { kind: 'retry', message: MESSAGES.bad_audio };
    return { kind: 'error', message: MESSAGES.error };
  }
  const score = result.score;
  const passed = score >= passScore;
  // 环境有噪声但孩子读得不错 → 照常通过；读得不好则不怪孩子，让他重念
  if (result.detail?.noisy && !passed) {
    return { kind: 'retry', message: MESSAGES.bad_audio };
  }
  return { kind: passed ? 'pass' : 'fail', score, passed };
}
