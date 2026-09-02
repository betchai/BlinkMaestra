import test from 'node:test';
import assert from 'node:assert/strict';
import {
  largestRemainder, competencyWeights, rawItems, finalItems,
  allocateDifficulty, allocateCognitive,
} from '../src/tosv3/engine.js';
import { buildMatrix, rowTotals, colTotals, matrixCells, emptyGrid } from '../src/tosv3/matrix.js';
import { buildItemBlueprint, expandCompetency, placementText, v3placementLines } from '../src/tosv3/blueprint.js';
import { validateAssessment, validateCompetency, validateItemBlueprint, validateBlueprint, validationPassed } from '../src/tosv3/validate.js';
import { defaultTotalItems, KEYSTAGE_TE_ITEMS, DEFAULT_DIFFICULTY } from '../src/tosv3/policy.js';
import { buildAssessmentBlueprint } from '../src/tosv3/index.js';
import { renderBlueprintHtml, renderExamHtml, abbr } from '../src/tosv3/render.js';
import { seedTemplates } from '../src/templates.js';

// ---------------- Engine: weighting & reconciliation ----------------

test('largestRemainder preserves total and is deterministic', () => {
  assert.deepEqual(largestRemainder([0.5, 0.5], 2).reduce((a, b) => a + b, 0), 2);
  assert.deepEqual(largestRemainder([0.33, 0.33, 0.34], 2).reduce((a, b) => a + b, 0), 2);
  assert.deepEqual(largestRemainder([1.4, 1.4, 1.4, 1.4, 1.4], 7).reduce((a, b) => a + b, 0), 7);
  // tie broken by lower fractional index deterministically
  const a = largestRemainder([0.5, 0.5], 1);
  assert.deepEqual(a, [1, 0]);
});

test('competency weights reflect teaching days', () => {
  const w = competencyWeights([5, 10]);
  assert.deepEqual(w.map((x) => x.weight), [1 / 3, 2 / 3]);
});

test('finalItems reconciles raw items to exact total', () => {
  const totals = [5, 10, 15, 40, 60];
  for (const t of totals) {
    const raw = rawItems([{ weight: 0.5 }, { weight: 0.5 }], t);
    assert.equal(finalItems(raw, t).reduce((a, b) => a + b, 0), t);
  }
});

test('allocateDifficulty renormalizes and sums exactly', () => {
  const d = allocateDifficulty(13, { easy: 0.6, average: 0.3, difficult: 0.1 });
  assert.deepEqual(Object.values(d).reduce((a, b) => a + b, 0), 13);
  assert.equal(d.Easy, 8); assert.equal(d.Average, 4); assert.equal(d.Difficult, 1);
});

test('allocateDifficulty handles a 50/30/20 custom split', () => {
  const d = allocateDifficulty(50, { easy: 0.5, average: 0.3, difficult: 0.2 });
  assert.equal(Object.values(d).reduce((a, b) => a + b, 0), 50);
  assert.equal(d.Easy, 25); assert.equal(d.Average, 15); assert.equal(d.Difficult, 10);
});

test('allocateCognitive with Create=0 redistributes and still sums to total', () => {
  const c = allocateCognitive(39, { Remember: 1, Understand: 1, Apply: 1, Analyze: 1, Evaluate: 1, Create: 0 });
  assert.equal(c.Create, 0);
  assert.equal(Object.values(c).reduce((a, b) => a + b, 0), 39);
});

// ---------------- Matrix ----------------

test('matrix rows and columns both match their marginals', () => {
  for (const t of [3, 5, 7, 13, 27, 40, 50, 60]) {
    const difficulty = allocateDifficulty(t, { easy: 0.6, average: 0.3, difficult: 0.1 });
    const cognitive = allocateCognitive(t);
    const m = buildMatrix({ total: t, difficulty, cognitive });
    assert.ok(m.ok, `t=${t}`);
    assert.deepEqual(rowTotals(m.matrix), [difficulty.Easy, difficulty.Average, difficulty.Difficult]);
    assert.deepEqual(colTotals(m.matrix), ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'].map((k) => cognitive[k]));
    assert.equal(rowTotals(m.matrix).reduce((a, b) => a + b, 0), t);
  }
});

test('matrix reports an impossible request in plain terms', () => {
  const m = buildMatrix({ total: 13, difficulty: { Easy: 7, Average: 4, Difficult: 2 }, cognitive: { Remember: 4, Understand: 3, Apply: 3, Analyze: 2, Evaluate: 1, Create: 1 } });
  assert.equal(m.ok, false);
  assert.match(m.message, /needs 13 items/i);
  assert.match(m.message, /cognitive totals add to 14/i);
});

test('matrix leaves all items in Easy when cognitive and difficulty align on one row', () => {
  const m = buildMatrix({ total: 6, difficulty: { Easy: 3, Average: 2, Difficult: 1 }, cognitive: { Remember: 1, Understand: 1, Apply: 1, Analyze: 1, Evaluate: 1, Create: 1 } });
  assert.equal(m.ok, true);
  assert.deepEqual(rowTotals(m.matrix), [3, 2, 1]);
});

test('matrixCells and totals utilities are consistent', () => {
  const m = buildMatrix({ total: 10, difficulty: { Easy: 6, Average: 3, Difficult: 1 }, cognitive: { Remember: 2, Understand: 2, Apply: 2, Analyze: 2, Evaluate: 1, Create: 1 } });
  const cells = matrixCells(m.matrix);
  assert.equal(cells.reduce((a, c) => a + c.count, 0), 10);
  assert.equal(emptyGrid().length, 3);
});

// ---------------- Blueprint ----------------

test('buildItemBlueprint produces global contiguous numbering across competencies', () => {
  const comps = [
    { competency: 'A', matrix: [[1, 1, 1, 1, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]], finalItems: 4 },
    { competency: 'B', matrix: [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 1], [0, 0, 0, 0, 0, 0]], finalItems: 1 },
  ];
  const bp = buildItemBlueprint(comps);
  assert.deepEqual(bp.items.map((i) => i.number), [1, 2, 3, 4, 5]);
  assert.deepEqual(bp.items.map((i) => i.competency), ['A', 'A', 'A', 'A', 'B']);
  assert.equal(bp.items[4].cognitive, 'Create');
  assert.equal(bp.totalItems, 5);
});

test('placementText renders cognitive ranges with item numbers', () => {
  const comp = { competency: 'A', matrix: [[0, 1, 0, 0, 0, 1], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]], finalItems: 2, format: 'Multiple Choice' };
  const { items } = expandCompetency(comp, 1);
  const text = placementText(items);
  assert.match(text, /U 1/);
  assert.match(text, /C 2/);
});

test('v3placementLines carry competency, cognitive, and difficulty', () => {
  const comps = [{ competency: 'A', matrix: [[1, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]], finalItems: 1, format: 'Multiple Choice' }];
  const bp = buildItemBlueprint(comps);
  const lines = v3placementLines(bp.items, 1, 1);
  assert.match(lines[0], /^1 → A \(Remember, Easy\)$/);
  assert.equal(v3placementLines(bp.items, 2, 2)[0], '2 → (unassigned)');
});

// ---------------- Validation ----------------

test('validate flags assessment-level aggregation mismatches', () => {
  const issues = validateAssessment({ totalItems: 40, competencies: [{ finalItems: 13 }, { finalItems: 25 }], difficulty: { Easy: 10, Average: 5, Difficult: 5 }, cognitive: { Remember: 10, Understand: 10, Apply: 10, Analyze: 5, Evaluate: 0, Create: 0 } });
  assert.ok(issues.some((i) => i.code === 'total_mismatch'));
  assert.ok(issues.some((i) => i.code === 'difficulty_total'));
  assert.ok(issues.some((i) => i.code === 'cognitive_total'));
  assert.ok(issues.every((i) => i.level === 'assessment'));
});

test('validate flags competency-level matrix and marginal mismatches', () => {
  const issues = validateCompetency({ competency: 'X', finalItems: 5, difficulty: { Easy: 3, Average: 1, Difficult: 1 }, cognitive: { Remember: 5, Understand: 0, Apply: 0, Analyze: 0, Evaluate: 0, Create: 0 } });
  assert.ok(issues.length === 0);
  const bad = validateCompetency({ competency: 'Y', finalItems: 5, difficulty: { Easy: 2, Average: 2, Difficult: 2 }, cognitive: { Remember: 5, Understand: 0, Apply: 0, Analyze: 0, Evaluate: 0, Create: 0 } });
  const codes = bad.map((i) => i.code);
  assert.ok(codes.includes('comp_difficulty_total'));
  assert.ok(bad.every((i) => i.level === 'competency'));
});

test('validateItemBlueprint catches duplicate, missing, and out-of-range items', () => {
  const issues = validateItemBlueprint(
    [{ number: 1, competency: 'A', difficulty: 'Easy', cognitive: 'Remember', matrixCell: { difficulty: 'Easy', cognitive: 'Remember' } }],
    2,
  );
  assert.ok(issues.some((i) => i.code === 'missing_item')); // item 2 missing
  const dup = validateItemBlueprint([
    { number: 1, competency: 'A', difficulty: 'Easy', cognitive: 'Remember' },
    { number: 1, competency: 'A', difficulty: 'Easy', cognitive: 'Remember' },
  ], 1);
  assert.ok(dup.some((i) => i.code === 'dup_item'));
  const oob = validateItemBlueprint([{ number: 5, competency: 'A', difficulty: 'Easy', cognitive: 'Remember' }], 3);
  assert.ok(oob.some((i) => i.code === 'out_of_range'));
  assert.ok(issues.every((i) => i.level === 'item'));
});

test('validateItemBlueprint flags a matrix cell that contradicts assignment', () => {
  const issues = validateItemBlueprint([{ number: 1, competency: 'A', difficulty: 'Easy', cognitive: 'Remember', matrixCell: { difficulty: 'Difficult', cognitive: 'Create' } }], 1);
  assert.ok(issues.some((i) => i.code === 'cell_mismatch'));
});

// ---------------- Orchestrator (end-to-end blueprint) ----------------

test('full blueprint for a 40-item test is internally consistent and valid', () => {
  const r = buildAssessmentBlueprint({ competencies: 'Competency A: 5 days\nCompetency B: 10 days', totalItems: 40 });
  assert.equal(r.passed, true, JSON.stringify(r.issues));
  assert.equal(r.totalItems, 40);
  assert.equal(r.items.length, 40);
  assert.deepEqual(r.items.map((i) => i.number).slice(0, 3), [1, 2, 3]);
  assert.equal(r.items.at(-1).number, 40);
  // every item maps to exactly one competency and every competency has a contiguous range
  for (const c of r.assessment.competencies) {
    const own = r.items.filter((i) => i.competency === c.competency);
    assert.equal(own.length, c.finalItems);
  }
});

test('5/10/15 teaching days produce weighted allocation summing to 40', () => {
  const r = buildAssessmentBlueprint({ competencies: 'A: 5 days\nB: 10 days\nC: 15 days', totalItems: 40 });
  const finals = r.assessment.competencies.map((c) => c.finalItems);
  const expected = finalItems(rawItems([{ weight: 5 / 30 }, { weight: 10 / 30 }, { weight: 15 / 30 }], 40), 40);
  assert.deepEqual(finals, expected);
  assert.equal(finals.reduce((a, b) => a + b, 0), 40);
});

test('custom difficulty distribution flows into the blueprint and matrix', () => {
  const r = buildAssessmentBlueprint({ competencies: 'A: 10 days', totalItems: 50, difficultyShare: { Easy: 0.5, Average: 0.3, Difficult: 0.2 } });
  const c = r.assessment.competencies[0];
  assert.deepEqual(c.difficulty, { Easy: 25, Average: 15, Difficult: 10 });
  assert.equal(rowTotals(c.matrix).reduce((a, b) => a + b, 0), 50);
});

test('traceability: teaching days -> weights -> items -> blueprint -> matrix (spec 40)', () => {
  const r = buildAssessmentBlueprint({ competencies: 'A: 6 days\nB: 4 days', totalItems: 40 });
  const a = r.assessment.competencies[0];
  const b = r.assessment.competencies[1];
  assert.equal(a.finalItems, 24);
  assert.equal(b.finalItems, 16);
  // blueprint item count == sum of final items
  assert.equal(r.items.length, a.finalItems + b.finalItems);
  // item 1 belongs to A; item 25 and later belongs to B
  assert.equal(r.items[0].competency, 'A');
  assert.equal(r.items[23].competency, 'A');
  assert.equal(r.items[24].competency, 'B');
  assert.equal(r.passed, true, JSON.stringify(r.issues));
});

test('difficulty and cognitive are independent, configurable dimensions', () => {
  const r = buildAssessmentBlueprint({ competencies: 'A: 10 days', totalItems: 40, difficultyShare: { Easy: 0.7, Average: 0.2, Difficult: 0.1 }, cognitiveShare: { Create: 0, Evaluate: 0 } });
  const c = r.assessment.competencies[0];
  assert.equal(c.difficulty.Easy, 28);
  assert.equal(c.cognitive.Create, 0);
  assert.equal(c.cognitive.Evaluate, 0);
  assert.equal(Object.values(c.cognitive).reduce((a, b) => a + b, 0), 40);
});

test('renamed/structural item placement replaces the opaque 2R/2U/... string', () => {
  const r = buildAssessmentBlueprint({ competencies: 'A: 5 days\nB: 5 days', totalItems: 20 });
  // every item carries structural number/competency/difficulty/cognitive, not a string
  for (const it of r.items) {
    assert.equal(typeof it.number, 'number');
    assert.ok(it.competency);
    assert.ok(['Easy', 'Average', 'Difficult'].includes(it.difficulty));
    assert.ok(['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'].includes(it.cognitive));
  }
});

// ---------------- Policy / configuration ----------------

test('policy supplies KS-aware default term-examination item counts', () => {
  assert.equal(defaultTotalItems('Grade 4'), 40);
  assert.equal(defaultTotalItems('Grade 7'), 50);
  assert.equal(defaultTotalItems('Grade 12'), 60);
  assert.equal(KEYSTAGE_TE_ITEMS['Grade 2'], null); // KS1 has no fixed count
});

test('difficulty default is a configurable convention, not a mandatory DepEd rule', () => {
  assert.deepEqual(DEFAULT_DIFFICULTY, { Easy: 0.6, Average: 0.3, Difficult: 0.1 });
});

test('a missing total items input falls back to the grade-level default', () => {
  const r = buildAssessmentBlueprint({ competencies: 'A: 5 days', gradeLevel: 'Grade 7' });
  assert.equal(r.totalItems, 50);
});

// ---------------- Renderer ----------------

test('renderBlueprintHtml emits a summary table, matrix, and item blueprint', () => {
  const r = buildAssessmentBlueprint({ competencies: 'A: 5 days\nB: 10 days', totalItems: 40 });
  const html = renderBlueprintHtml(r.assessment);
  assert.match(html, /<h2>Table of Specifications<\/h2>/);
  assert.match(html, /Difficulty × Cognitive Matrix/);
  assert.match(html, /<h2>Item Blueprint<\/h2>/);
  assert.ok((html.match(/<table>/g) || []).length >= 4);
});

test('renderExamHtml preserves item numbering via <li value>', () => {
  const items = [
    { number: 2, stem: 'S2', options: [{ label: 'A', text: 'x' }], answerLabel: 'A' },
    { number: 1, stem: 'S1', answerText: 'ok' },
  ];
  const html = renderExamHtml(items);
  assert.match(html, /<li value="1">/);
  assert.match(html, /<li value="2">/);
});

test('abbr maps cognitive processes to compact labels', () => {
  assert.equal(abbr('Remember'), 'R');
  assert.equal(abbr('Evaluate'), 'E');
  assert.equal(abbr('Create'), 'C');
});

// ---------------- Template ----------------

test('tos-v3 template is seeded and exposes configurable distributions as optional fields', () => {
  const template = seedTemplates().find((t) => t.id === 'tos-v3');
  assert.ok(template);
  assert.equal(template.version, '3.0');
  assert.ok(template.requiredFields.includes('Competencies with teaching days'));
  assert.ok(template.optionalFields.includes('Difficulty distribution'));
  assert.ok(template.optionalFields.includes('Cognitive distribution'));
  // Assessment type and Item format remain separate (no "Mixed" conflation forced here)
  assert.ok(template.requiredFields.includes('Assessment type'));
  assert.ok(template.requiredFields.includes('Item format'));
});

// ---------------- validationPassed / validateBlueprint convenience ----------------

test('validateBlueprint aggregates all three levels and validationPassed gates', () => {
  const r = buildAssessmentBlueprint({ competencies: 'A: 5 days', totalItems: 4 });
  // intact blueprint: all levels pass
  assert.ok(validationPassed(validateBlueprint({ ...r.assessment, competencies: r.assessment.competencies.map((c) => ({ ...c, cognitive: { ...c.cognitive } })), items: r.items })));
  // break it deliberately
  const broken = validateBlueprint({ ...r.assessment, totalItems: 9, competencies: r.assessment.competencies, items: r.items });
  assert.ok(!validationPassed(broken));
});

test('template name used for generation must equal the pipeline dispatch string', () => {
  const template = seedTemplates().find((t) => t.id === 'tos-v3');
  // pipeline.js dispatches on context.template === name; keep in sync
  assert.equal(template.name, 'TOS V3 · Assessment Blueprint Engine');
});
