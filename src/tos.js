const LEVELS = ['Remembering', 'Understanding', 'Applying', 'Analyzing', 'Evaluating', 'Creating'];
const LEVEL_FIRST = { r: 'Remembering', u: 'Understanding', a: 'Applying', e: 'Evaluating', c: 'Creating' };

// Render the placement spec for a contiguous item range: "1 → Competency (Remembering)".
export function placementLines(blueprint, start, end) {
  const byNumber = new Map(blueprint.map((item) => [item.number, item]));
  const lines = [];
  for (let n = start; n <= end; n++) {
    const slot = byNumber.get(n);
    lines.push(slot ? `${n} → ${slot.competency} (${slot.cognitiveLevel})` : `${n} → (unassigned)`);
  }
  return lines;
}

// Normalize a classifier's level label (Remembering/Remember/R/Analyses, etc.) to the canonical level name.
export function normalizeLevel(label) {
  const value = String(label ?? '').trim().toLowerCase();
  if (!value) return null;
  const exact = LEVELS.find((level) => level.toLowerCase() === value);
  if (exact) return exact;
  if (value.length >= 4) {
    const prefix = LEVELS.find((level) => level.toLowerCase().startsWith(value.slice(0, 4)));
    if (prefix) return prefix;
  }
  return LEVEL_FIRST[value[0]] || null;
}
export function parseCompetencies(value) {
  return String(Array.isArray(value) ? value.join('\n') : value || '').split(/\n|;/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const match = line.match(/^(.*?)(?:\s*[:|,-]\s*|\s+)(\d+(?:\.\d+)?)\s*(?:days?|d)?$/i);
    return { competency: (match ? match[1] : line).trim(), days: Number(match?.[2] || 0) };
  }).filter((row) => row.competency && row.days > 0);
}
function largestRemainder(raw, total) {
  const out = raw.map(Math.floor); let left = total - out.reduce((a, b) => a + b, 0);
  raw.map((x, i) => ({ i, f: x - Math.floor(x) })).sort((a, b) => Math.abs(b.f - a.f) > 1e-9 ? b.f - a.f : a.i - b.i).forEach(({ i }) => { if (left-- > 0) out[i]++; });
  return out;
}
function cognitiveCounts(total) {
  const bandRaw = [total * 0.60, total * 0.30, total * 0.10];
  const bandBase = bandRaw.map(Math.floor);
  let bandRemainder = total - bandBase.reduce((sum, count) => sum + count, 0);
  const bands = [...bandBase];
  bandRaw.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => Math.abs(b.fraction - a.fraction) > 1e-9 ? b.fraction - a.fraction : b.index - a.index)
    .forEach(({ index }) => { if (bandRemainder-- > 0) bands[index] += 1; });
  const counts = [
    ...largestRemainder([bands[0] / 2, bands[0] / 2], bands[0]),
    ...largestRemainder([bands[1] / 2, bands[1] / 2], bands[1]),
    ...largestRemainder([bands[2] / 2, bands[2] / 2], bands[2]),
  ];
  return Object.fromEntries(LEVELS.map((level, index) => [level, counts[index]]));
}
export function calculateTos({ competencies, numberOfItems }) {
  const rows = parseCompetencies(competencies); const totalItems = Math.floor(Number(numberOfItems) || 0); const totalDays = rows.reduce((a, r) => a + r.days, 0);
  if (!rows.length || !totalDays || totalItems < 1) throw new Error('Enter competencies with teaching days and a positive number of items.');
  const raw = rows.map((r) => r.days / totalDays * totalItems); const allocations = largestRemainder(raw, totalItems); let n = 0;
  let running = 1;
  const outputRows = rows.map((r, i) => {
    const items = allocations[i];
    const row = { ...r, weight: r.days / totalDays, rawItems: raw[i], items, itemStart: running, itemEnd: running + items - 1, cognitive: cognitiveCounts(items) };
    running += items;
    return row;
  });
  const target = cognitiveCounts(totalItems);
  const current = Object.fromEntries(LEVELS.map((level) => [level, outputRows.reduce((sum, row) => sum + row.cognitive[level], 0)]));
  while (current.Evaluating + current.Creating > target.Evaluating + target.Creating) {
    const row = outputRows.find((item) => item.cognitive.Evaluating + item.cognitive.Creating > 0);
    if (!row) break;
    if (row.cognitive.Creating) { row.cognitive.Creating--; current.Creating--; } else { row.cognitive.Evaluating--; current.Evaluating--; }
    row.cognitive.Remembering++; current.Remembering++;
  }
  while (current.Remembering + current.Understanding < target.Remembering + target.Understanding) {
    const row = outputRows.find((item) => item.cognitive.Applying + item.cognitive.Analyzing > 0);
    if (!row) break;
    if (row.cognitive.Analyzing) { row.cognitive.Analyzing--; current.Analyzing--; } else { row.cognitive.Applying--; current.Applying--; }
    row.cognitive.Remembering++; current.Remembering++;
  }
  return { totalDays, totalItems, rows: outputRows, cognitiveTotals: current, blueprint: outputRows.flatMap((row) => Array.from({ length: row.items }, (_, index) => ({ number: ++n, competency: row.competency, cognitiveLevel: LEVELS.find((level) => index < row.cognitive[LEVELS.slice(0, LEVELS.indexOf(level) + 1).reduce((sum, key) => sum + row.cognitive[key], 0)]) || LEVELS.at(-1) }))) };
}
function esc(v) { return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export function assembleTosHtml({ title, tos, items, assessmentType }) {
  const levels = ['Remembering', 'Understanding', 'Applying', 'Analyzing', 'Evaluating', 'Creating'];
  const abbr = { Remembering: 'R', Understanding: 'U', Applying: 'Ap', Analyzing: 'An', Evaluating: 'E', Creating: 'Cre' };
  const headerCells = `<th>Learning Competency</th><th>Days</th><th>Weight</th><th>Raw Items</th><th>Total Items</th>${levels.map((l) => `<th>${abbr[l]}</th>`).join('')}<th>Item Placement</th>`;
  const rowCells = (r) => `<tr><td>${esc(r.competency)}</td><td>${r.days}</td><td>${(r.weight * 100).toFixed(2)}%</td><td>${r.rawItems.toFixed(2)}</td><td>${r.items}</td>${levels.map((l) => `<td>${r.cognitive[l]}</td>`).join('')}<td>${r.items ? `${r.itemStart}-${r.itemEnd}` : '—'}</td></tr>`;
  const totalCells = `<th>Total</th><th>${tos.totalDays}</th><th>100%</th><th>${tos.totalItems}</th><th>${tos.totalItems}</th>${levels.map((l) => `<th>${tos.cognitiveTotals[l]}</th>`).join('')}<th>1-${tos.totalItems}</th>`;
  const table = `<table><tr>${headerCells}</tr>${tos.rows.map(rowCells).join('')}<tr>${totalCells}</tr></table>`;
  const ordered = (items || []).sort((a, b) => a.number - b.number);
  const questions = ordered.map((i) => `<li><p><strong>${i.number}. ${esc(i.stem)}</strong></p>${i.options?.length ? `<ul>${i.options.map((o) => `<li>${esc(o.label)}. ${esc(o.text)}</li>`).join('')}</ul>` : ''}</li>`).join('');
  const key = ordered.map((i) => `<li>${i.number}. ${esc(i.answerLabel)}${i.answerText ? ` - ${esc(i.answerText)}` : ''}</li>`).join('');
  return `<h1>${esc(title)}</h1><h2>Table of Specifications</h2><p>Assessment type: ${esc(assessmentType)}</p>${table}<h2>Examination Items</h2><ol>${questions}</ol><h2>Answer Key</h2><ol>${key}</ol><h2>Scoring Guide</h2><p>One point per correct response; apply the item criteria for constructed responses.</p>`;
}
