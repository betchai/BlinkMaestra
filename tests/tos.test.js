import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTemplates } from '../src/templates.js';
import { calculateTos, placementLines, normalizeLevel } from '../src/tos.js';

test('DepEd 015 template is seeded with the required inputs', () => {
  const template = seedTemplates().find((item) => item.id === 'deped-015-tos');
  assert.ok(template);
  assert.match(template.name, /\(Beta\)$/);
  assert.deepEqual(template.requiredFields, ['Grade level', 'Subject / learning area', 'Term', 'Assessment type', 'Number of items', 'Competencies with teaching days', 'Item format']);
});

test('TOS uses largest remainder and preserves the requested item total', () => {
  const tos = calculateTos({ competencies: 'A: 1 day\nB: 1 day\nC: 1 day', numberOfItems: 2 });
  assert.equal(tos.totalDays, 3);
  assert.deepEqual(tos.rows.map((row) => row.items), [1, 1, 0]);
  assert.equal(tos.blueprint.length, 2);
  assert.deepEqual(tos.blueprint.map((item) => item.competency), ['A', 'B']);
});

test('TOS enforces 60/30/10 cognitive distribution and item placement', () => {
  const tos = calculateTos({ competencies: 'Fraction Basics: 6 days\nAdding Fractions: 4 days', numberOfItems: 40 });
  assert.deepEqual(tos.rows.map((row) => row.items), [24, 16]);
  assert.deepEqual(tos.rows.map((row) => [row.cognitive.Remembering + row.cognitive.Understanding, row.cognitive.Applying + row.cognitive.Analyzing, row.cognitive.Evaluating + row.cognitive.Creating]), [[15, 7, 2], [9, 5, 2]]);
  assert.equal(tos.cognitiveTotals.Remembering + tos.cognitiveTotals.Understanding, 24);
  assert.equal(tos.cognitiveTotals.Applying + tos.cognitiveTotals.Analyzing, 12);
  assert.equal(tos.cognitiveTotals.Evaluating + tos.cognitiveTotals.Creating, 4);
  assert.equal(tos.blueprint[0].number, 1);
  assert.equal(tos.blueprint.at(-1).number, 40);
});

test('placementLines renders the exact TOS slot for every item number', () => {
  const tos = calculateTos({ competencies: 'Fraction Basics: 1 day\nAdding Fractions: 1 day', numberOfItems: 4 });
  const lines = placementLines(tos.blueprint, 1, 4);
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^1 → Fraction Basics \((Remembering|Understanding|Applying|Analyzing|Evaluating|Creating)\)$/);
  assert.match(lines[1], /^2 → Fraction Basics \((Remembering|Understanding|Applying|Analyzing|Evaluating|Creating)\)$/);
  assert.match(lines[2], /^3 → Adding Fractions \((Remembering|Understanding|Applying|Analyzing|Evaluating|Creating)\)$/);
  assert.match(lines[3], /^4 → Adding Fractions \((Remembering|Understanding|Applying|Analyzing|Evaluating|Creating)\)$/);
  assert.ok(lines.every((l) => / \((Remembering|Understanding|Applying|Analyzing|Evaluating|Creating)\)$/.test(l)), 'each line must carry a cognitive level');
  const competencyOf = (l) => /^(\d+) → (.*) \(/.exec(l)[2];
  assert.deepEqual([...new Set(lines.map(competencyOf))], ['Fraction Basics', 'Adding Fractions']);

  // Blueprint covers every number 1..total exactly once, level ascending within each competency block.
  const byNumber = new Map(tos.blueprint.map((b) => [b.number, b]));
  for (let n = 1; n <= tos.totalItems; n++) assert.ok(byNumber.has(n), `number ${n} must be placed`);

  // Out-of-range numbers render an explicit unassigned slot, never a crash.
  assert.equal(placementLines(tos.blueprint, 5, 6)[0], '5 → (unassigned)');
});

test('normalizeLevel maps classifier labels to canonical TOS levels', () => {
  assert.equal(normalizeLevel('Analyzing'), 'Analyzing');
  assert.equal(normalizeLevel('Apply'), 'Applying');
  assert.equal(normalizeLevel('UNDERSTANDING'), 'Understanding');
  assert.equal(normalizeLevel(' r '), 'Remembering');
  assert.equal(normalizeLevel('analyses'), 'Analyzing');
  assert.equal(normalizeLevel('gobbledygook'), null);
});
