// 词典构建脚本（需求 4）：
//   读取 data/raw/ 下的 ECDICT 原始文件（CSV 或 SQLite，不写死文件名，按表头自动识别列）
//   → 生成 data/dict.db（word / word_lower / phonetic / translation / tag / frq / len）
//
// 用法：npm run build-dict
//   也可指定路径：node scripts/build-dict.js --raw <目录> --out <文件>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

/* ---------- CSV 解析：支持带引号的字段（可含逗号、真实换行）、CRLF、BOM ---------- */

export class CsvParser {
  constructor(onRow) {
    this.onRow = onRow;
    this.buf = '';
    this.row = [];
    this.field = '';
    this.inQuotes = false;
    this.firstChunk = true;
  }

  push(chunk) {
    if (this.firstChunk) {
      if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1);
      this.firstChunk = false;
    }
    this.buf += chunk;
    let i = 0;
    const n = this.buf.length;
    while (i < n) {
      const ch = this.buf[i];
      if (this.inQuotes) {
        if (ch === '"') {
          if (this.buf[i + 1] === '"') { this.field += '"'; i += 2; continue; }
          this.inQuotes = false; i += 1; continue;
        }
        this.field += ch; i += 1; continue;
      }
      if (ch === '"') { this.inQuotes = true; i += 1; continue; }
      if (ch === ',') { this.endField(); i += 1; continue; }
      if (ch === '\n') { this.endRow(); i += 1; continue; }
      if (ch === '\r') {
        if (this.buf[i + 1] === '\n') i += 1;
        this.endRow(); i += 1; continue;
      }
      this.field += ch; i += 1;
    }
    this.buf = this.buf.slice(i);
  }

  end() {
    if (this.field !== '' || this.row.length) {
      this.row.push(this.field);
      this.field = '';
      const row = this.row;
      this.row = [];
      this.onRow(row);
    }
  }

  endField() {
    this.row.push(this.field);
    this.field = '';
  }

  endRow() {
    this.endField();
    const row = this.row;
    this.row = [];
    this.onRow(row);
  }
}

/* ---------- 通用处理 ---------- */

// translation 字段的换行可能是字面的 \n，也可能是真正的换行，统一成真正的换行（需求 4）。
export function normalizeTranslation(text) {
  return String(text ?? '').replace(/\\n/g, '\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

export function hasChinese(text) {
  return /[一-鿿]/.test(text);
}

const WANTED = ['word', 'phonetic', 'translation', 'tag', 'frq'];

// 按表头自动识别列（大小写不敏感；找不到 word / translation 就报错）。
export function mapColumns(headerRow) {
  const lower = headerRow.map((h) => String(h).trim().toLowerCase());
  const map = {};
  for (const name of WANTED) {
    const idx = lower.indexOf(name);
    if (idx === -1 && (name === 'word' || name === 'translation')) {
      throw new Error(`词典文件表头里找不到 ${name} 列，请确认下载的是 ECDICT 完整 CSV`);
    }
    map[name] = idx;
  }
  return map;
}

function toDictEntry(row, colMap) {
  const word = (row[colMap.word] ?? '').trim();
  const translation = normalizeTranslation(row[colMap.translation]);
  if (!word || !hasChinese(translation)) return null;
  const frq = parseInt(row[colMap.frq], 10);
  return {
    word,
    word_lower: word.toLowerCase(),
    phonetic: (row[colMap.phonetic] ?? '').trim(),
    translation,
    tag: (row[colMap.tag] ?? '').trim(),
    frq: Number.isFinite(frq) && frq > 0 ? frq : 0,
    len: word.length,
  };
}

const DICT_SCHEMA = `
  CREATE TABLE dict (
    word        TEXT PRIMARY KEY,
    word_lower  TEXT NOT NULL,
    phonetic    TEXT NOT NULL DEFAULT '',
    translation TEXT NOT NULL,
    tag         TEXT NOT NULL DEFAULT '',
    frq         INTEGER NOT NULL DEFAULT 0,
    len         INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_dict_word_lower ON dict(word_lower);
  CREATE TABLE zh_index (
    term  TEXT NOT NULL,
    word  TEXT NOT NULL,
    gloss TEXT NOT NULL,
    frq   INTEGER NOT NULL DEFAULT 0,
    hot   INTEGER NOT NULL DEFAULT 0,
    rank  INTEGER NOT NULL DEFAULT 3
  );
  CREATE INDEX idx_zh_term ON zh_index(term);
  -- 部分索引：「包含」档只在常用词里找，既快又不给孩子看不认识的词
  CREATE INDEX idx_zh_hot ON zh_index(term) WHERE hot = 1;
`;

/* ---------- 中文反查索引（需求 2.6 / 阶段 1B） ---------- */

// 清理一个释义片段：去掉括号注释、开头词性标记（n. / vt. / adj. …）、残留分隔符。
export function cleanTerm(fragment) {
  let t = String(fragment ?? '').trim();
  t = t.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');
  t = t.replace(/^(?:[a-zA-Z]{1,5}\.\s*&?\s*)+/g, '');
  t = t.replace(/^[、，,;；\s]+/g, '');
  t = t.replace(/[。．.\s]+$/g, '');
  return t.trim();
}

// translation → [{ term, gloss }]：先按行拆，再按 ；;，,、 拆片段。
// 跳过 [网络]/[医]/[化] 这类专业或网络来源的释义行：对中小学生是噪音
// （例如「水」会因此匹配到「[医] 调节, 适应, 安培 … 水, 水剂」这种条目）。
export function buildZhTerms(translation, maxTermLen = 24) {
  const out = [];
  const seen = new Set();
  for (const rawLine of String(translation ?? '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^\[[^\]]*\]/.test(line)) continue;
    const gloss = line.length > 80 ? line.slice(0, 79) + '…' : line;
    for (const rawFrag of line.split(/[；;，,、]/)) {
      const term = cleanTerm(rawFrag);
      if (!term || term.length > maxTermLen) continue;
      const key = term + '|' + gloss;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ term, gloss });
    }
  }
  return out;
}

// 只给「像正常英文词」的条目建反查索引：
// 词典里有 app. / a. / apel- / 12345 这类非词条，中文查词命中它们对孩子毫无意义。
// 必须以字母开头、以字母结尾（中间可以有连字符/撇号/空格）。
export function isIndexableWord(word) {
  return /^[a-zA-Z](?:[a-zA-Z'\- ]*[a-zA-Z])?$/.test(String(word ?? ''));
}

// 学生视角的常用度分档（越小越可能用得上）：
//   0 中高考词（tag 含 zk/gk）—— 正是教材和考卷里的词
//   1 四六级 / 考研 / 托福 / 雅思词
//   2 其他现代英语里真在用的词（有语料库词频）
//   3 生僻词（人名、地名、专业术语、古语；没有词频）
// 需求 2.6 明确要求「明显生僻的条目排在最后」，这里就是那个判据。
export function relevanceRank(tag, frq) {
  const tags = new Set(String(tag ?? '').toLowerCase().split(/\s+/).filter(Boolean));
  if (tags.has('zk') || tags.has('gk')) return 0;
  for (const t of ['cet4', 'cet6', 'ky', 'toefl', 'ielts']) {
    if (tags.has(t)) return 1;
  }
  return Number(frq) > 0 ? 2 : 3;
}

const ZH_INSERT = 'INSERT OR IGNORE INTO zh_index (term, word, gloss, frq, hot, rank) VALUES (?, ?, ?, ?, ?, ?)';

function zhRowsFor(word, frq, translation, tag) {
  if (!isIndexableWord(word)) return [];
  const hot = frq > 0 ? 1 : 0; // 有语料库词频 = 现代英语里真在用的词
  const rank = relevanceRank(tag, frq);
  return buildZhTerms(translation).map(({ term, gloss }) => [term, word, gloss, frq, hot, rank]);
}

function fillZhIndex(db) {
  const insert = db.prepare(ZH_INSERT);
  const page = db.prepare('SELECT rowid, word, frq, translation, tag FROM dict WHERE rowid > ? ORDER BY rowid LIMIT 20000');
  // 不能边遍历边插入（同一连接），按 rowid 分页读
  let lastRowid = 0;
  for (;;) {
    const rows = page.all(lastRowid);
    if (!rows.length) break;
    const insertBatch = db.transaction(() => {
      for (const row of rows) {
        for (const args of zhRowsFor(row.word, row.frq, row.translation, row.tag)) insert.run(...args);
      }
    });
    insertBatch();
    lastRowid = rows[rows.length - 1].rowid;
  }
  return db.prepare('SELECT COUNT(*) AS n FROM zh_index').get().n;
}

/* ---------- CSV / SQLite 两种来源 ---------- */

function buildFromCsvFile(db, filePath) {
  return new Promise((resolve, reject) => {
    const insert = db.prepare(
      `INSERT OR REPLACE INTO dict (word, word_lower, phonetic, translation, tag, frq, len)
       VALUES (@word, @word_lower, @phonetic, @translation, @tag, @frq, @len)`
    );
    let colMap = null;
    let readRows = 0;
    let kept = 0;
    let batch = [];
    const flush = db.transaction(() => {
      for (const entry of batch) insert.run(entry);
      batch = [];
    });

    const parser = new CsvParser((row) => {
      if (!colMap) {
        colMap = mapColumns(row);
        return;
      }
      readRows += 1;
      const entry = toDictEntry(row, colMap);
      if (entry) {
        kept += 1;
        batch.push(entry);
        if (batch.length >= 10000) flush();
        if (kept % 50000 === 0) console.log(`  已写入 ${kept} 条…`);
      }
    });

    // 不用 readline：带引号的多行字段要交给解析器自己处理换行
    fs.createReadStream(filePath, { encoding: 'utf8' })
      .on('data', (chunk) => parser.push(chunk))
      .on('end', () => {
        try {
          parser.end();
          flush();
          console.log(`  ${path.basename(filePath)}：读取 ${readRows} 行，保留 ${kept} 条`);
          resolve({ readRows, kept });
        } catch (err) {
          reject(err);
        }
      })
      .on('error', reject);
  });
}

function buildFromSqliteFile(db, filePath) {
  const src = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const tables = src
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    let tableName = null;
    let colMap = null;
    for (const t of tables) {
      const cols = src.prepare(`PRAGMA table_info(${JSON.stringify(t)})`).all().map((c) => c.name);
      const lower = cols.map((c) => c.toLowerCase());
      try {
        colMap = mapColumns(lower);
        tableName = t;
        break;
      } catch {
        continue;
      }
    }
    if (!tableName) {
      throw new Error('这个 SQLite 文件里找不到含 word / translation 列的表');
    }
    // 列名 → 查询时重命名为统一列名
    const cols = src.prepare(`PRAGMA table_info(${JSON.stringify(tableName)})`).all().map((c) => c.name);
    const selectParts = WANTED.map((name) => {
      const idx = colMap[name];
      return idx === -1 ? 'NULL' : `"${cols[idx]}"`;
    });
    const insert = db.prepare(
      `INSERT OR REPLACE INTO dict (word, word_lower, phonetic, translation, tag, frq, len)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    // .raw(true) 让每行是数组（按列序取值），否则 better-sqlite3 返回对象，按序号取会全是 undefined
    const rows = src.prepare(
      `SELECT ${selectParts.join(', ')} FROM "${tableName}"`
    ).raw(true);
    let kept = 0;
    let count = 0;
    const flushBatch = [];
    const flush = db.transaction(() => {
      for (const e of flushBatch) insert.run(...e);
      flushBatch.length = 0;
    });
    for (const row of rows.iterate()) {
      count += 1;
      const entry = toDictEntry(row, { word: 0, phonetic: 1, translation: 2, tag: 3, frq: 4 });
      if (entry) {
        kept += 1;
        flushBatch.push([entry.word, entry.word_lower, entry.phonetic, entry.translation, entry.tag, entry.frq, entry.len]);
        if (flushBatch.length >= 10000) flush();
        if (kept % 50000 === 0) console.log(`  已写入 ${kept} 条…`);
      }
    }
    flush();
    console.log(`  ${path.basename(filePath)}：读取 ${count} 行，保留 ${kept} 条`);
    return { readRows: count, kept };
  } finally {
    src.close();
  }
}

/* ---------- 主流程 ---------- */

export async function buildDict({ rawDir, outFile } = {}) {
  rawDir = rawDir ?? path.join(ROOT, 'data', 'raw');
  outFile = outFile ?? path.join(ROOT, 'data', 'dict.db');

  if (!fs.existsSync(rawDir)) {
    throw new Error(`没有找到词典目录 ${rawDir}。请先从 ECDICT 官方仓库下载词典文件放进这个目录（步骤见 README）。`);
  }
  const csvFiles = fs.readdirSync(rawDir).filter((f) => f.toLowerCase().endsWith('.csv')).sort();
  const sqliteFiles = fs.readdirSync(rawDir).filter((f) => /\.(db|sqlite|sqlite3)$/i.test(f)).sort();
  if (!csvFiles.length && !sqliteFiles.length) {
    throw new Error(`${rawDir} 里没有 .csv 或 .sqlite 文件。请先从 ECDICT 官方仓库下载词典文件（步骤见 README）。`);
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(outFile + suffix); } catch {}
  }

  console.log(`正在生成 ${outFile} …`);
  const db = new Database(outFile);
  try {
    db.exec(DICT_SCHEMA);
    const report = { readRows: 0, kept: 0 };
    for (const f of csvFiles) {
      const r = await buildFromCsvFile(db, path.join(rawDir, f));
      report.readRows += r.readRows;
      report.kept += r.kept;
    }
    if (!csvFiles.length) {
      const r = buildFromSqliteFile(db, path.join(rawDir, sqliteFiles[0]));
      report.readRows += r.readRows;
      report.kept += r.kept;
    }
    const zhCount = fillZhIndex(db);
    console.log(`完成：共保留 ${report.kept} 个带中文释义的词条，中文反查索引 ${zhCount} 条。`);
    report.zhCount = zhCount;
    return report;
  } finally {
    db.close();
  }
}

export async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 ? args[i + 1] : undefined;
  };
  try {
    await buildDict({ rawDir: opt('raw'), outFile: opt('out') });
  } catch (err) {
    console.error(`构建失败：${err.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
