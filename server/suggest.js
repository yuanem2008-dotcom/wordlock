// 相近词提示（需求 2.1）：编辑距离 ≤ 2 的词，按词频排序（常用词优先）。
// 为避免全表扫描，先用首字母 + 长度（±2）缩小范围再算编辑距离。

export function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 99;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

// dictDb 为空时返回空数组。
export function findSuggestions(dictDb, inputLower, limit = 3) {
  if (!dictDb || !inputLower || !/^[a-z'-]+$/.test(inputLower)) return [];
  const first = inputLower[0];
  const last = String.fromCharCode(first.charCodeAt(0) + 1);
  const minLen = Math.max(1, inputLower.length - 2);
  const maxLen = inputLower.length + 2;
  const rows = dictDb
    .prepare(
      `SELECT word, frq FROM dict
       WHERE word_lower >= ? AND word_lower < ?
         AND len BETWEEN ? AND ?
         AND word_lower != ?`
    )
    .all(first, last, minLen, maxLen, inputLower);
  const hits = [];
  for (const row of rows) {
    const dist = editDistance(inputLower, row.word.toLowerCase());
    if (dist <= 2) hits.push({ word: row.word, frq: row.frq, dist });
  }
  // 词频：数值越小越常用，0 表示没有数据，排最后（需求 2.6 同规则）。
  hits.sort((x, y) => {
    const fx = x.frq > 0 ? 0 : 1;
    const fy = y.frq > 0 ? 0 : 1;
    if (fx !== fy) return fx - fy;
    if (x.frq !== y.frq) return x.frq - y.frq;
    if (x.dist !== y.dist) return x.dist - y.dist;
    return x.word < y.word ? -1 : 1;
  });
  return hits.slice(0, limit).map((h) => h.word);
}
