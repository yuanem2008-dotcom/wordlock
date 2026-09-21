// 中文查词（需求 2.6 / 阶段 1B）：三档查询 + 排序。
//   第一档：查询词与释义片段完全相同
//   第二档：片段以查询词开头
//   第三档：片段包含查询词（LIKE，前两档不足 8 条才用，避免全表扫描）
// 同档内：单词优先于短语（含空格）；常用词优先（frq 越小越常用，0 = 无数据排最后）。

// 取每一档时先排序再截断，否则 LIMIT 取到的是任意一批行，
// 会把最常用的词漏掉（例：查「水」时 water 反而没进候选）。
// 排序与 compare() 保持一致：学生常用度分档 → 单词优先 → 常用优先。
const RANK_ORDER = `
  ORDER BY rank ASC,
           (CASE WHEN instr(word, ' ') > 0 THEN 1 ELSE 0 END),
           (CASE WHEN frq > 0 THEN 0 ELSE 1 END),
           frq ASC
  LIMIT ?`;

export function searchZh(dictDb, rawQuery, limit = 8) {
  if (!dictDb) return [];
  const q = String(rawQuery ?? '').trim().slice(0, 30);
  if (!q) return [];

  const perTier = 24;
  const picked = [];

  const exact = dictDb
    .prepare(`SELECT word, gloss, frq, rank FROM zh_index WHERE term = ?${RANK_ORDER}`)
    .all(q, perTier);
  push(exact, 0);

  if (uniqueWords(picked) < limit) {
    // 范围扫描代替 LIKE 'q%'，保证能走 idx_zh_term 索引
    const prefix = dictDb
      .prepare(`SELECT word, gloss, frq, rank FROM zh_index WHERE term >= ? AND term < ?${RANK_ORDER}`)
      .all(q, q + String.fromCharCode(0xffff), perTier);
    push(prefix, 1);
  }

  if (uniqueWords(picked) < limit) {
    // 只在常用词（hot=1，走部分索引）里做包含匹配：
    // 全表 LIKE 要 1 秒以上，而且命中的多是孩子根本不认识的生僻词
    const escaped = q.replace(/[\\%_]/g, (c) => '\\' + c);
    const contains = dictDb
      .prepare(`SELECT word, gloss, frq, rank FROM zh_index WHERE hot = 1 AND term LIKE ? ESCAPE '\\'${RANK_ORDER}`)
      .all('%' + escaped + '%', perTier);
    push(contains, 2);
  }

  picked.sort(compare);

  const seen = new Set();
  const ranked = [];
  for (const item of picked) {
    if (seen.has(item.word)) continue;
    seen.add(item.word);
    ranked.push({ word: item.word, gloss: item.gloss, rank: item.rank ?? 3 });
  }

  // 生僻词只在确实没有更好结果时兜底：孩子不该看到 moolvee、teachering 这类词
  const useful = ranked.filter((r) => r.rank < 3);
  return (useful.length ? useful : ranked)
    .slice(0, limit)
    .map(({ word, gloss }) => ({ word, gloss }));

  function push(rows, tier) {
    for (const r of rows) picked.push({ word: r.word, gloss: r.gloss, frq: r.frq, rank: r.rank, tier });
  }
}

function uniqueWords(list) {
  return new Set(list.map((x) => x.word)).size;
}

function compare(a, b) {
  // 先按“学生常用度”分档（需求 2.6：明显生僻的条目排在最后），
  // 否则孩子查「老师」会先看到 moolvee、rebbe 这类词。
  const ra = a.rank ?? 3;
  const rb = b.rank ?? 3;
  if (ra !== rb) return ra - rb;
  if (a.tier !== b.tier) return a.tier - b.tier;
  const pa = a.word.includes(' ') ? 1 : 0;
  const pb = b.word.includes(' ') ? 1 : 0;
  if (pa !== pb) return pa - pb;
  const fa = a.frq > 0 ? 0 : 1;
  const fb = b.frq > 0 ? 0 : 1;
  if (fa !== fb) return fa - fb;
  if (a.frq !== b.frq) return a.frq - b.frq;
  return a.word < b.word ? -1 : a.word > b.word ? 1 : 0;
}
