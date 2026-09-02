// TOS V3 — HTML renderer for the assessment blueprint and generated exam.
// Emits semantic h1/h2/p/table/ol/ul only (matches the app's document HTML rules in
// pipeline.validate) so the result round-trips through the editor and DOCX/PDF export.

import { DIFFICULTIES, COGNITIVES } from './engine.js';
import { rowTotals, colTotals } from './matrix.js';

function esc(v) { return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export function renderSummaryTable(assessment) {
  const comps = assessment.competencies || [];
  const rows = comps.map((c) => `
    <tr>
      <td>${esc(c.competency)}</td>
      <td>${c.days}</td>
      <td>${(c.weight * 100).toFixed(2)}%</td>
      <td>${c.finalItems}</td>
      <td>${c.difficulty.Easy}</td>
      <td>${c.difficulty.Average}</td>
      <td>${c.difficulty.Difficult}</td>
      <td>${COGNITIVES.map((k) => `${abbr(k)} ${c.cognitive[k]}`).join(' / ')}</td>
      <td>${c.from ?? '—'}–${c.to ?? '—'}</td>
    </tr>`).join('');
  const r = comps.reduce((a, c) => ({
    days: a.days + c.days,
    items: a.items + c.finalItems,
    Easy: a.Easy + c.difficulty.Easy,
    Average: a.Average + c.difficulty.Average,
    Difficult: a.Difficult + c.difficulty.Difficult,
    cog: COGNITIVES.map((k, i) => a.cog[i] + c.cognitive[k]),
  }), { days: 0, items: 0, Easy: 0, Average: 0, Difficult: 0, cog: COGNITIVES.map(() => 0) });
  return `<h2>Table of Specifications</h2>
<p>Assessment type: ${esc(assessment.assessmentType)} · Item format: ${esc(assessment.itemFormat)}</p>
<table>
  <tr><th>Learning Competency</th><th>Days</th><th>Weight</th><th>Total Items</th><th>Easy</th><th>Average</th><th>Difficult</th><th>Cognitive Allocation</th><th>Item Numbers</th></tr>
  ${rows}
  <tr><th>Total</th><th>${r.days}</th><th>100%</th><th>${r.items}</th><th>${r.Easy}</th><th>${r.Average}</th><th>${r.Difficult}</th><th>${COGNITIVES.map((k, i) => `${abbr(k)} ${r.cog[i]}`).join(' / ')}</th><th>1–${assessment.totalItems}</th></tr>
</table>`;
}

export function renderCompetencyMatrix(comp) {
  const head = `<tr><th>Difficulty \\ Cognitive</th>${COGNITIVES.map((c) => `<th>${c}</th>`).join('')}<th>Total</th></tr>`;
  const body = comp.matrix.map((row, di) =>
    `<tr><th>${DIFFICULTIES[di]}</th>${row.map((cell) => `<td>${cell}</td>`).join('')}<th>${rowTotals(comp.matrix)[di]}</th></tr>`).join('');
  const cols = colTotals(comp.matrix);
  const foot = `<tr><th>Total</th>${cols.map((c) => `<th>${c}</th>`).join('')}<th>${comp.finalItems}</th></tr>`;
  return `<h3>Difficulty × Cognitive Matrix — ${esc(comp.competency)}</h3>
<table>${head}${body}${foot}</table>`;
}

export function renderItemBlueprint(assessment) {
  const items = assessment.items || [];
  const rows = items.map((it) => `<tr><td>${it.number}</td><td>${esc(it.competency)}</td><td>${it.difficulty}</td><td>${it.cognitive}</td><td>${esc(it.format)}</td></tr>`).join('');
  return `<h2>Item Blueprint</h2>
<table><tr><th>Item No.</th><th>Learning Competency</th><th>Difficulty</th><th>Cognitive</th><th>Item Format</th></tr>${rows}</table>`;
}

// Render the full blueprint (summary + matrices + item blueprint) as HTML.
export function renderBlueprintHtml(assessment) {
  const matrices = (assessment.competencies || []).map(renderCompetencyMatrix).join('');
  return `${renderSummaryTable(assessment)}${matrices}${renderItemBlueprint(assessment)}`;
}

// Render the exam with numbered items (numbering enforced via <li value>).
export function renderExamHtml(items) {
  const ordered = [...(items || [])].sort((a, b) => (a.number || 0) - (b.number || 0));
  const questions = ordered.map((i) => `<li value="${i.number}"><p>${esc(i.stem)}</p>${i.options?.length ? `<ul>${i.options.map((o) => `<li>${esc(o.label)}) ${esc(o.text)}</li>`).join('')}</ul>` : ''}</li>`).join('');
  const answers = ordered.map((i) => {
    const label = i.answerLabel || i.answer || '';
    const text = i.answerText || '';
    return `<li value="${i.number}">${esc(label)}${text ? ` - ${esc(text)}` : ''}</li>`;
  }).join('');
  return `<h2>Examination</h2><ol>${questions}</ol>
<p><strong>Answer Key</strong></p><ol>${answers}</ol>
<h2>Scoring Guide</h2><p>One point per correct response; apply the item criteria for constructed responses.</p>`;
}

export function abbr(k) {
  return ({ Remember: 'R', Understand: 'U', Apply: 'Ap', Analyze: 'An', Evaluate: 'E', Create: 'C' })[k] || k;
}
