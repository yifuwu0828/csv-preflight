export const FIELDS = ['sku', 'title', 'price', 'currency'];
export const ALIASES = {
  sku: ['sku', 'product id', 'item id', 'stock code'],
  title: ['title', 'name', 'product name'],
  price: ['price', 'unit price', 'cost'],
  currency: ['currency', 'currency code'],
};
export const ANCHORS = {
  sku: ['stock keeping unit unique product code', 'item identifier stock reference'],
  title: ['product name item title', 'name of the merchandise listing'],
  price: ['selling price per product', 'unit selling amount in money'],
  currency: ['currency code such as USD EUR SAR', 'monetary currency denomination'],
};
export const CURRENCIES = new Set('USD EUR GBP SAR CNY AED JPY CAD AUD CHF INR HKD NZD SGD BRL MXN ZAR KRW SEK NOK DKK PLN TRY THB IDR MYR PHP VND TWD BHD KWD QAR OMR EGP CLP COP ARS PKR'.split(' '));
export const normalizeHeader = (s) => s.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');

export function parseCSV(input) {
  const text = input.replace(/^\uFEFF/, '');
  const records = [], rowNumbers = [];
  let row = [], value = '', quoted = false, closed = false, line = 1, startLine = 1;
  const cell = () => { row.push(value); value = ''; closed = false; };
  const record = () => { cell(); records.push(row); rowNumbers.push(startLine); row = []; startLine = line + 1; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { value += '"'; i++; }
        else { quoted = false; closed = true; }
      } else if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        value += '\n'; line++;
      } else value += ch;
      continue;
    }
    if (ch === ',') { cell(); continue; }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      record(); line++; continue;
    }
    if (closed) throw new Error(`Unexpected text after closing quote on line ${line}.`);
    if (ch === '"') {
      if (value.length) throw new Error(`Quote inside an unquoted cell on line ${line}.`);
      quoted = true;
    } else value += ch;
  }
  if (quoted) throw new Error(`Unclosed quoted cell beginning before line ${line}.`);
  if (row.length || value.length || closed) { cell(); records.push(row); rowNumbers.push(startLine); }
  if (!records.length || !records[0].some((v) => v.trim())) throw new Error('CSV needs a nonempty header row.');
  const headers = records.shift(); rowNumbers.shift();
  if (headers.some((h) => !h.trim())) throw new Error('Every column needs a header.');
  if (new Set(headers.map(normalizeHeader)).size !== headers.length) throw new Error('Duplicate column headings need distinct names before mapping.');
  return {headers, rows: records, rowNumbers};
}

export function exactMapping(headers) {
  return FIELDS.map((field) => {
    const hits = headers.map((h, i) => ALIASES[field].includes(normalizeHeader(h)) ? i : -1).filter((i) => i >= 0);
    return {field, index: hits.length === 1 ? hits[0] : null, ambiguous: hits.length > 1, method: hits.length === 1 ? 'exact alias' : 'review required'};
  });
}

export function semanticMapping(headers, vectors, anchorVectors, {threshold = 0.35, margin = 0.08} = {}) {
  const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
  const exact = exactMapping(headers);
  const proposals = FIELDS.map((field, fi) => {
    if (exact[fi].ambiguous || (field === 'price' && headers.filter((h) => /\b(price|cost|amount)\b/.test(normalizeHeader(h))).length > 1)) {
      return {field, index:null, score:null, gap:null, method:'multiple explicit candidates — review required'};
    }
    if (exact[fi].index !== null) return {...exact[fi], score: null, gap: null};
    const candidates = vectors.map((v, index) => ({index, score: Math.max(...anchorVectors[field].map((a) => dot(v, a)))})).sort((a, b) => b.score - a.score);
    const best = candidates[0], second = candidates[1];
    const gap = second ? best.score - second.score : best.score;
    const eligible = best.score >= threshold && gap >= margin;
    return {field, index: eligible ? best.index : null, suggestedIndex: best.index, score: best.score, gap, method: eligible ? 'local model suggestion' : 'weak or ambiguous — review required'};
  });
  for (const p of proposals) {
    if (p.index === null) continue;
    if (proposals.some((q) => q !== p && q.index === p.index)) p.conflict = true;
  }
  for (const p of proposals) if (p.conflict) {p.index = null; p.method = 'column collision — review required';}
  return proposals;
}

export function auditCSV(parsed, mapping) {
  const indexes = FIELDS.map((f) => mapping[f]);
  if (indexes.some((i) => !Number.isInteger(i) || i < 0 || i >= parsed.headers.length) || new Set(indexes).size !== 4) {
    throw new Error('Confirm four distinct valid column mappings before auditing.');
  }
  const issues = [], seen = new Map();
  parsed.rows.forEach((row, i) => {
    const sourceLine = parsed.rowNumbers[i];
    const add = (field, code, message) => issues.push({record: i + 1, sourceLine, field, code, message});
    if (row.length !== parsed.headers.length) add(null, 'column_count', `Expected ${parsed.headers.length} cells; found ${row.length}.`);
    const sku = (row[mapping.sku] ?? '').trim();
    if (!sku) add('sku', 'missing_sku', 'SKU is empty.');
    else if (seen.has(sku)) add('sku', 'duplicate_sku', `SKU also occurs on source line ${seen.get(sku)}.`);
    else seen.set(sku, sourceLine);
    if (!(row[mapping.title] ?? '').trim()) add('title', 'empty_title', 'Product title is empty.');
    const priceText = (row[mapping.price] ?? '').trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(priceText) || !Number.isFinite(Number(priceText))) add('price', 'invalid_price', 'Price must be a finite decimal number, without symbols or separators.');
    else if (Number(priceText) < 0) add('price', 'negative_price', 'Price must not be negative.');
    const currency = (row[mapping.currency] ?? '').trim();
    if (!CURRENCIES.has(currency)) add('currency', 'unsupported_currency', 'Use an uppercase supported currency code; see the supported list.');
  });
  return {schemaVersion: 'csv-preflight.audit.v1', recordCount: parsed.rows.length, issueCount: issues.length, affectedRecords: new Set(issues.map((i) => i.record)).size, headers: parsed.headers, mapping, issues, sourceLineMeaning: 'Physical starting line of the CSV record, including the header line.', pricesModified: false};
}
