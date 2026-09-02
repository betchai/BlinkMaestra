// TOS V3 — Difficulty × Cognitive matrix allocation engine.
// Builds a 3 (difficulty) × 6 (cognitive) matrix that satisfies BOTH the requested
// row (difficulty) totals AND the requested column (cognitive) totals, for a given
// competency item count. Deterministic. Reports impossible requests in plain terms.

import { DIFFICULTIES, COGNITIVES } from './engine.js';

// Build a matrix given row totals (difficulty counts) and column totals (cognitive
// counts). Guarantees row sums == difficulty totals and column sums == cognitive
// totals when both already sum to `total`. Uses largest-remainder across the
// flattened grid weighted by row×col shares, which is deterministic and reproduces
// both marginals exactly.
//
// IMPORTANT: row totals must sum to `total` and column totals must sum to `total`.
// The matrix engine only reconciles item placement given consistent marginals; if
// the requested difficulty and cognitive distributions themselves cannot agree on a
// total, we do NOT invent an allocation — we report it plainly (spec §12).
export function buildMatrix({ total, difficulty, cognitive }) {
  const diff = DIFFICULTIES.map((d) => difficulty[d] ?? 0);
  const cog = COGNITIVES.map((c) => cognitive[c] ?? 0);
  const diffSum = diff.reduce((a, b) => a + b, 0);
  const cogSum = cog.reduce((a, b) => a + b, 0);

  if (diffSum !== total || cogSum !== total) {
    return {
      ok: false,
      total,
      difficultyMarginalGood: diffSum === total,
      cognitiveMarginalGood: cogSum === total,
      reportedDifficulty: toObj(diff),
      reportedCognitive: toObj(cog),
      matrix: emptyGrid(),
      message: gradeMessage(diffSum, cogSum, total),
    };
  }

  // Guaranteed-correct integer contingency table rounding. Start with
  // x_ij = floor(r_i * c_j / total); the matrix then has row/column shortfalls that
  // sum equally. Repetitively add 1 to a cell whose row AND column still have
  // shortfall (deterministically: top-down row, highest remaining column shortfall),
  // which is always possible because total row shortfall == total column shortfall.
  // This pins BOTH marginals exactly (spec §11/§12).
  const mat = emptyGrid();
  const rowShort = diff.slice();
  const colShort = cog.slice();
  let remaining = total;
  for (let oi = 0; oi < DIFFICULTIES.length; oi++) {
    for (let ci = 0; ci < COGNITIVES.length; ci++) {
      const f = (diff[oi] / diffSum) * (cog[ci] / cogSum) * total;
      const v = Math.floor(f);
      mat[oi][ci] = v;
      rowShort[oi] -= v;
      colShort[ci] -= v;
      remaining -= v;
    }
  }
  // Balance the remaining cells greedily.
  while (remaining > 0) {
    let placed = false;
    for (let oi = 0; oi < DIFFICULTIES.length && !placed; oi++) {
      if (rowShort[oi] <= 0) continue;
      // choose column with the largest remaining shortfall
      let bestCi = -1;
      for (let ci = 0; ci < COGNITIVES.length; ci++) {
        if (colShort[ci] > 0 && (bestCi === -1 || colShort[ci] > colShort[bestCi])) bestCi = ci;
      }
      if (bestCi === -1) break;
      mat[oi][bestCi] += 1;
      rowShort[oi] -= 1;
      colShort[bestCi] -= 1;
      remaining -= 1;
      placed = true;
    }
    if (!placed) break; // defensive
  }

  return {
    ok: true, total,
    difficulty: toObj(diff), cognitive: toObj(cog),
    matrix: mat, message: '',
  };
}

function gradeMessage(diffSum, cogSum, total) {
  return `The difficulty totals add to ${diffSum} and the cognitive totals add to ${cogSum}, but this competency needs ${total} items. Adjust one or both so both add to ${total}.`
    + suggest(diffSum, cogSum, total);
}

function suggest(diffSum, cogSum, total) {
  if (diffSum !== total && cogSum === total) return ' Hint: raise or lower some difficulty counts by ' + Math.abs(total - diffSum) + ' item(s).';
  if (cogSum !== total && diffSum === total) return ' Hint: raise or lower some cognitive counts by ' + Math.abs(total - cogSum) + ' item(s).';
  if (diffSum === cogSum && diffSum !== total) return ' Hint: add or remove ' + (total - diffSum) + ' item(s) to both distributions so they equal ' + total + '.';
  return '';
}

export function emptyGrid() {
  return DIFFICULTIES.map(() => COGNITIVES.map(() => 0));
}

function toObj(arr) {
  const o = {};
  DIFFICULTIES.forEach((k, i) => (o[k] = arr[i]));
  return o;
}


// Convert the matrix grid into a flat list of { difficulty, cognitive, count }.
export function matrixCells(matrix) {
  const cells = [];
  matrix.forEach((row, di) => row.forEach((count, ci) => {
    if (count > 0) cells.push({ difficulty: DIFFICULTIES[di], cognitive: COGNITIVES[ci], count });
  }));
  return cells;
}

export function rowTotals(matrix) {
  return matrix.map((row) => row.reduce((a, b) => a + b, 0));
}
export function colTotals(matrix) {
  return COGNITIVES.map((_, ci) => matrix.reduce((sum, row) => sum + row[ci], 0));
}
