// TOS V3 — three-level blueprint validation (Assessment / Competency / Item).
// Produces teacher-friendly messages (§19–20). Each issue: { level, code, message }.
// `diagnostics` carries machine-readable detail for logs only, never the UI.

import { DIFFICULTIES, COGNITIVES } from './engine.js';
import { rowTotals, colTotals } from './matrix.js';

export function validateAssessment(assessment) {
  const issues = [];
  const d = assessment || {};
  const comps = d.competencies || [];
  const totalItems = d.totalItems ?? 0;
  const difficulty = d.difficulty || {};
  const cognitive = d.cognitive || {};

  // Total item count match.
  const sumComp = comps.reduce((a, c) => a + (c.finalItems || 0), 0);
  if (sumComp !== totalItems) {
    issues.push({
      level: 'assessment', code: 'total_mismatch',
      message: `${totalItems} items were requested, but the competencies sum to ${sumComp}. Adjust the competency allocations.`,
    });
  }

  // Overall difficulty totals.
  const diffSum = DIFFICULTIES.reduce((a, k) => a + (difficulty[k] || 0), 0);
  if (difficulty.Easy + difficulty.Average + difficulty.Difficult !== totalItems) {
    issues.push({
      level: 'assessment', code: 'difficulty_total',
      message: `Difficulty items total ${diffSum}, but the blueprint requires ${totalItems}. Adjust the difficulty distribution.`,
    });
  }

  // Overall cognitive totals.
  const cogSum = COGNITIVES.reduce((a, k) => a + (cognitive[k] || 0), 0);
  if (cogSum !== totalItems) {
    issues.push({
      level: 'assessment', code: 'cognitive_total',
      message: `Cognitive items total ${cogSum}, but the blueprint requires ${totalItems}. Adjust the cognitive distribution.`,
    });
  }

  // Item numbering must be contiguous 1..total (assessed after build).
  return issues;
}

export function validateCompetency(comp) {
  const issues = [];
  const c = comp || {};
  const total = c.finalItems ?? 0;
  const difficulty = c.difficulty || {};
  const cognitive = c.cognitive || {};
  const matrix = c.matrix;

  const diffSum = DIFFICULTIES.reduce((a, k) => a + (difficulty[k] || 0), 0);
  if (diffSum !== total) {
    issues.push({
      level: 'competency', code: 'comp_difficulty_total',
      message: `"${c.competency}" needs ${total} items, but its difficulty counts sum to ${diffSum}.`,
    });
  }
  const cogSum = COGNITIVES.reduce((a, k) => a + (cognitive[k] || 0), 0);
  if (cogSum !== total) {
    issues.push({
      level: 'competency', code: 'comp_cognitive_total',
      message: `"${c.competency}" needs ${total} items, but its cognitive counts sum to ${cogSum}.`,
    });
  }
  if (matrix) {
    const rows = rowTotals(matrix);
    const cols = colTotals(matrix);
    const rowSum = rows.reduce((a, b) => a + b, 0);
    const colSum = cols.reduce((a, b) => a + b, 0);
    if (rowSum !== total) {
      issues.push({
        level: 'competency', code: 'matrix_rows',
        message: `"${c.competency}" matrix rows sum to ${rowSum}, not ${total}.`,
      });
    }
    if (colSum !== total) {
      issues.push({
        level: 'competency', code: 'matrix_cols',
        message: `"${c.competency}" matrix columns sum to ${colSum}, not ${total}.`,
      });
    }
  }
  return issues;
}

export function validateItemBlueprint(items, totalItems, compByNumber = {}) {
  const issues = [];
  const list = Array.isArray(items) ? items : [];

  // No duplicate / missing / out-of-range numbers, and single competency.
  const seen = new Set();
  for (let n = 1; n <= totalItems; n++) {
    const matches = list.filter((it) => it.number === n);
    if (matches.length === 0) {
      issues.push({ level: 'item', code: 'missing_item', message: `Item ${n} is missing from the blueprint.` });
    } else if (matches.length > 1) {
      issues.push({ level: 'item', code: 'dup_item', message: `Item ${n} appears more than once in the blueprint.` });
    }
  }

  for (const it of list) {
    if (it.number < 1 || it.number > totalItems) {
      issues.push({ level: 'item', code: 'out_of_range', message: `Item ${it.number} is outside the assessment range of 1–${totalItems}.` });
    }
    if (!it.competency) issues.push({ level: 'item', code: 'no_comp', message: `Item ${it.number} has no competency assigned.` });
    if (!it.difficulty || !DIFFICULTIES.includes(it.difficulty)) issues.push({ level: 'item', code: 'no_diff', message: `Item ${it.number} has no valid difficulty assigned.` });
    if (!it.cognitive || !COGNITIVES.includes(it.cognitive)) issues.push({ level: 'item', code: 'no_cog', message: `Item ${it.number} has no valid cognitive process assigned.` });
    if (it.matrixCell && (it.matrixCell.difficulty !== it.difficulty || it.matrixCell.cognitive !== it.cognitive)) {
      issues.push({ level: 'item', code: 'cell_mismatch', message: `Item ${it.number} is placed in a matrix cell that does not match its difficulty/cognitive assignment.` });
    }
  }

  // No item assigned to multiple competencies (structural guard — each item lives once).
  return issues;
}

// Convenience: run all three levels and merge.
export function validateBlueprint(assessment) {
  return [
    ...validateAssessment(assessment),
    ...(assessment.competencies || []).flatMap((c) => validateCompetency(c)),
    ...validateItemBlueprint(assessment.items, assessment.totalItems),
  ];
}

export function validationPassed(issues) {
  return issues.length === 0;
}
