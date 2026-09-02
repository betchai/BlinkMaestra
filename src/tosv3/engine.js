// TOS V3 — reusable deterministic calculation engine.
// State-free functions, independently testable, no UI coupling.

export const DIFFICULTIES = ['Easy', 'Average', 'Difficult'];
export const COGNITIVES = ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'];

// Largest-remainder reconciliation: distributes the integer leftovers of a set of
// raw values so they sum exactly to `total`. Ties are resolved deterministically
// (higher fractional remainder first; on equal fractions, lower index wins).
export function largestRemainder(raw, total) {
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => {
      const d = Math.abs(b.frac - a.frac) > 1e-9 ? b.frac - a.frac : 0;
      return d !== 0 ? d : a.i - b.i;
    })
    .forEach(({ i }) => { if (left-- > 0) out[i] += 1; });
  return out;
}

// Percentage weight of each competency from instructional coverage.
// Returns [0..1] fractions and the total instructional days.
export function competencyWeights(days) {
  const totalDays = days.reduce((a, b) => a + b, 0);
  if (!totalDays) throw new Error('Total instructional days must be greater than zero.');
  return days.map((d) => ({ days: d, weight: d / totalDays }));
}

// Raw (unrounded) item allocation from weights and total items.
export function rawItems(weights, totalItems) {
  return weights.map((w) => w.weight * totalItems);
}

// Final whole-number item allocation guaranteed to sum to `totalItems`.
export function finalItems(raw, totalItems) {
  return largestRemainder(raw, totalItems);
}

// Allocate `total` items across a set of { key, share } entries. Shares are treated
// as relative weights and are renormalized to sum to 1, so a partial or zeroed set
// (e.g. { Create: 0 }) re-distributes proportionally across the rest. The result is
// guaranteed to span exactly `total` items via largest-remainder.
export function allocateDistribution(shares, total) {
  const sum = shares.reduce((a, s) => a + (s.share || 0), 0);
  const normalized = shares.map((s) => ({ key: s.key, share: sum > 0 ? (s.share || 0) / sum : 0 }));
  const raw = normalized.map((s) => s.share * total);
  const counts = largestRemainder(raw, total);
  return Object.fromEntries(normalized.map((s, i) => [s.key, counts[i]]));
}

// Difficulty allocation for a total, given [easy, average, difficult] shares summing to 1.
export function allocateDifficulty(total, cfg = { easy: 0.6, average: 0.3, difficult: 0.1 }) {
  const shares = [
    { key: 'Easy', share: cfg.easy ?? 0.6 },
    { key: 'Average', share: cfg.average ?? 0.3 },
    { key: 'Difficult', share: cfg.difficult ?? 0.1 },
  ];
  const counts = allocateDistribution(shares, total);
  counts.Easy + counts.Average + counts.Difficult === total || enforceSum(total, counts);
  return counts;
}

// Cognitive allocation for a total, given shares per cognitive level. With no
// shares (or only a subset), missing levels get 0 weight and the rest are
// renormalized by allocateDistribution, so the result always spans `total`.
export function allocateCognitive(total, sharesByKey = {}) {
  const entries = Object.keys(sharesByKey).length
    ? COGNITIVES.map((key) => ({ key, share: sharesByKey[key] ?? 0 }))
    : COGNITIVES.map((key) => ({ key, share: 1 }));
  return allocateDistribution(entries, total);
}

function enforceSum(total, counts) {
  if (Object.values(counts).reduce((a, b) => a + b, 0) !== total) {
    throw new Error(`Distribution does not reconcile to ${total} items.`);
  }
}

// ---- Parsing competencies from a text/array block (reuses V1/V2 convention) ----
export function parseCompetencyLines(value) {
  return String(Array.isArray(value) ? value.join('\n') : value || '')
    .split(/\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.*?)(?:\s*[:|,-]\s*|\s+)(\d+(?:\.\d+)?)\s*(?:days?|d|hours?|h)?$/i);
      return { competency: (match ? match[1] : line).trim(), days: Number(match?.[2] || 0) };
    })
    .filter((r) => r.competency && r.days > 0);
}
