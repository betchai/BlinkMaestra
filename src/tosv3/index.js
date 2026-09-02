// TOS V3 — assessment blueprint orchestrator.
// Composes the full chain: competencies + coverage -> weight -> raw -> final items ->
// difficulty & cognitive allocation -> Difficulty × Cognitive matrix -> item blueprint
// -> validation. Entry point for both the server pipeline and the UI.

import {
  parseCompetencyLines, competencyWeights, rawItems, finalItems,
  allocateDifficulty, allocateCognitive, DIFFICULTIES, COGNITIVES,
} from './engine.js';
import { buildMatrix, matrixCells } from './matrix.js';
import { buildItemBlueprint } from './blueprint.js';
import { validateBlueprint } from './validate.js';
import { resolveDifficulty, resolveCognitive, defaultTotalItems, SOURCES } from './policy.js';

// Options:
//  - competencies: string block or [{competency, days}] list
//  - totalItems: number (defaults from policy via gradeLevel)
//  - difficultyShare / cognitiveShare: {key: share} configurable distributions
//  - difficultyCfg / cognitiveCfg: override counts per competency (teacher overrides)
//  - gradeLevel, assessmentType, itemFormat, policy
// Returns { assessment, competencyRanges, items, issues, passed }.
export function buildAssessmentBlueprint({
  competencies, totalItems, difficultyShare, cognitiveShare,
  gradeLevel = '', assessmentType = 'Term Examination', itemFormat = 'Multiple Choice',
  difficultyOverride = {}, cognitiveOverride = {}, policy = {},
} = {}) {
  const parsed = Array.isArray(competencies) && competencies[0]?.competency != null
    ? competencies
    : parseCompetencyLines(competencies);

  const distTotal = totalItems ?? defaultTotalItems(gradeLevel);
  const diffCfg = { ...resolveDifficulty({ difficulty: difficultyShare }), ...difficultyOverride };
  const cogCfg = { ...resolveCognitive({ cognitive: cognitiveShare }), ...cognitiveOverride };
  // Normalize override counts to shares if they are raw counts (whole numbers present).
  const diffShare = toShares(DIFFICULTIES, diffCfg);
  const cogShare = toShares(COGNITIVES, cogCfg);

  const weights = competencyWeights(parsed.map((p) => p.days));
  const raw = rawItems(weights, distTotal);
  const finals = finalItems(raw, distTotal);

  const comps = parsed.map((p, i) => {
    const total = finals[i];
    const difficulty = allocateDifficulty(total, diffCfgForShare(diffShare));
    const cognitive = allocateCognitive(total, cogShareObj(cogShare));
    const matrixRes = buildMatrix({ total, difficulty, cognitive });
    return {
      competency: p.competency,
      competencyId: p.id || null,
      days: p.days,
      weight: weights[i].weight,
      rawItems: raw[i],
      finalItems: total,
      difficulty,
      cognitive,
      matrix: matrixRes.matrix,
      matrixOk: matrixRes.ok,
      format: p.format || itemFormat,
    };
  });

  const blueprint = buildItemBlueprint(comps);
  const assessmentDiffCfg = allocateDifficulty(distTotal, diffCfgForShare(diffShare));
  const assessmentCogCfg = allocateCognitive(distTotal, cogShareObj(cogShare));

  const assessment = {
    totalItems: distTotal,
    assessmentType,
    itemFormat,
    gradeLevel,
    difficulty: assessmentDiffCfg,
    cognitive: assessmentCogCfg,
    competencies: comps,
    items: blueprint.items,
    policy: {
      name: (policy && policy.name) || 'DepEd 015, s. 2026 — BlinkMaestra TOS V3 defaults',
      version: (policy && policy.version) || '3.0',
      effectiveSY: (policy && policy.effectiveSY) || '2026-2027',
      gradeLevel,
      assessmentType,
      itemFormat,
      difficultySource: SOURCES.DEFAULT,
      cognitiveSource: SOURCES.DEFAULT,
    },
  };

  const issues = validateBlueprint({
    ...assessment,
    difficulty: assessmentDiffCfg,
    cognitive: assessmentCogCfg,
    competencies: comps,
    items: blueprint.items,
  });

  return {
    assessment,
    competencyRanges: blueprint.competencyRanges,
    items: blueprint.items,
    issues,
    passed: issues.length === 0,
    totalItems: distTotal,
  };
}

// ----- helpers -----
// Convert a {key: value} distribution into a normalized [share0..] array summing to 1.
// Values are relative weights (e.g. {Create:0} -> the other five each become 1/5).
function toShares(keys, cfg) {
  const values = keys.map((k) => {
    const v = cfg[k];
    return v == null ? 0 : Number(v);
  });
  const total = values.reduce((a, b) => a + b, 0);
  return total > 0 ? values.map((v) => v / total) : values.map(() => 0);
}
function diffCfgForShare(share) {
  return { easy: share[0] ?? 0, average: share[1] ?? 0, difficult: share[2] ?? 0 };
}
function cogShareObj(share) {
  const o = {};
  COGNITIVES.forEach((k, i) => (o[k] = share[i]));
  return o;
}

export { matrixCells };
