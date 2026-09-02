// TOS V3 — item-level blueprint engine.
// Resolves a matrix (per competency) into concrete, numbered items. Each item
// records exactly one competency, one difficulty, one cognitive process, and its
// matrix cell. Numbering is global across the assessment, ordered by competency
// then by matrix cells in a stable difficulty×cognitive order.

import { DIFFICULTIES, COGNITIVES } from './engine.js';
import { matrixCells } from './matrix.js';

// Expand a competency blueprint sub-model into concrete item descriptors.
// `startNumber` is the first global item number for this competency.
// Returns { items, nextNumber } where nextNumber is the next free global number.
export function expandCompetency(comp, startNumber) {
  const items = [];
  let n = startNumber;
  const cells = matrixCells(comp.matrix);
  // Deterministic cell order: difficulty ascending, then cognitive ascending.
  cells.sort((a, b) => {
    const di = DIFFICULTIES.indexOf(a.difficulty) - DIFFICULTIES.indexOf(b.difficulty);
    if (di !== 0) return di;
    return COGNITIVES.indexOf(a.cognitive) - COGNITIVES.indexOf(b.cognitive);
  });
  for (const cell of cells) {
    for (let k = 0; k < cell.count; k++) {
      items.push({
        number: n++,
        competency: comp.competency,
        competencyId: comp.competencyId || null,
        difficulty: cell.difficulty,
        cognitive: cell.cognitive,
        matrixCell: { difficulty: cell.difficulty, cognitive: cell.cognitive },
        format: comp.format || 'Multiple Choice',
      });
    }
  }
  return { items, nextNumber: n };
}

// Build the full assessment item blueprint from the resolved per-competency models
// (each with `.competency`, `.matrix`, and optional `.format`).
export function buildItemBlueprint(comps) {
  const items = [];
  let start = 1;
  let competencyRanges = [];
  for (const comp of comps) {
    const from = start;
    const { items: compItems, nextNumber } = expandCompetency(comp, start);
    items.push(...compItems);
    competencyRanges.push({ competency: comp.competency, from, to: nextNumber - 1, count: compItems.length });
    start = nextNumber;
  }
  return { items, competencyRanges, totalItems: items.length };
}

// Structured placement summary per competency, e.g. { R:[1,2], U:[3,4], Ap:[5], An:[6], E:[7] }.
export function placementByCognitive(compItems) {
  const map = {};
  for (const it of compItems) {
    (map[it.cognitive] = map[it.cognitive] || []).push(it.number);
  }
  return map;
}

export function placementByDifficulty(compItems) {
  const map = {};
  for (const it of compItems) {
    (map[it.difficulty] = map[it.difficulty] || []).push(it.number);
  }
  return map;
}

// Text rendering of cognitive placement, e.g. "R 1–2 / U 3–4 / Ap 5 / An 6 / E 7".
export function placementText(compItems) {
  const byCognitive = placementByCognitive(compItems);
  return COGNITIVES
    .filter((c) => byCognitive[c] && byCognitive[c].length)
    .map((c) => {
      const nums = byCognitive[c];
      const label = c === 'Remember' ? 'R' : c === 'Understand' ? 'U' : c === 'Apply' ? 'Ap' : c === 'Analyze' ? 'An' : c === 'Evaluate' ? 'E' : 'C';
      return `${label} ${nums.length === 1 ? nums[0] : `${nums[0]}–${nums[nums.length - 1]}`}`;
    })
    .join(' / ');
}

// Render the per-item placement spec for a contiguous global range, matching the V2
// prompt contract but extended with difficulty: "N → competency (cognitive, difficulty)".
export function v3placementLines(blueprint, start, end) {
  const byNumber = new Map(blueprint.map((item) => [item.number, item]));
  const lines = [];
  for (let n = start; n <= end; n++) {
    const slot = byNumber.get(n);
    lines.push(slot
      ? `${n} → ${slot.competency} (${slot.cognitive}, ${slot.difficulty})`
      : `${n} → (unassigned)`);
  }
  return lines;
}
