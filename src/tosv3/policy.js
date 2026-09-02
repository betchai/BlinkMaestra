// TOS V3 — policy / configuration layer.
// Assessment rules are configurable rather than hard-coded (§24). Every rule carries
// a `source` tag so it can be classified as a DepEd Requirement, Teacher Preference,
// School Configuration, Assessment Convention, Recommended Practice, or BlinkMaestra
// Default (§23). Where an authoritative DepEd source does NOT establish a rule, we do
// not label it as mandatory — we treat it as a configurable default.
//
// Current national policy: DepEd Order No. 015, s. 2026 (Revised Guidelines on
// Classroom Assessment, Grading System, and Awards and Recognition for the K to 12
// Basic Education Program), effective SY 2026-2027.

export const SOURCES = {
  DEPED_REQUIREMENT: 'DepEd Requirement',
  TEACHER_PREFERENCE: 'Teacher Preference',
  SCHOOL_CONFIGURATION: 'School Configuration',
  CONVENTION: 'Assessment Convention',
  RECOMMENDED: 'Recommended Practice',
  DEFAULT: 'BlinkMaestra Default',
};

// KS-aware default Term Examination item counts, traceable to DO 015 s.2026.
// (DO 015: KS2 ~40, KS3 ~50, KS4 ~60 for the Term Examination, guided by the TOS.)
export const KEYSTAGE_TE_ITEMS = {
  'Grade 1': null, 'Grade 2': null, 'Grade 3': null, // KS1 — developmentally appropriate, no fixed count
  'Grade 4': 40, 'Grade 5': 40, 'Grade 6': 40,        // KS2
  'Grade 7': 50, 'Grade 8': 50, 'Grade 9': 50, 'Grade 10': 50, // KS3
  'Grade 11': 60, 'Grade 12': 60,                     // KS4
};

// Default difficulty distribution. 60/30/10 is a common classroom convention; it is
// NOT labeled as a mandatory DepEd requirement unless an authoritative source says
// otherwise. Fully configurable per assessment (§7).
export const DEFAULT_DIFFICULTY = { Easy: 0.6, Average: 0.3, Difficult: 0.1 };

// Default cognitive distribution — evenly across the six processes unless the teacher
// or applicable policy overrides it. Configurable (§9).
export const DEFAULT_COGNITIVE = {
  Remember: 1 / 6, Understand: 1 / 6, Apply: 1 / 6,
  Analyze: 1 / 6, Evaluate: 1 / 6, Create: 1 / 6,
};

export function defaultTotalItems(gradeLevel) {
  const key = String(gradeLevel || '').trim();
  return KEYSTAGE_TE_ITEMS[key] ?? 40;
}

// Resolve the effective distribution for an assessment from a policy object.
// A `policy` may provide difficulty/cognitive shares; otherwise defaults apply.
export function resolveDifficulty(cfg = {}) {
  return { ...DEFAULT_DIFFICULTY, ...(cfg.difficulty || {}) };
}
export function resolveCognitive(cfg = {}) {
  return { ...DEFAULT_COGNITIVE, ...(cfg.cognitive || {}) };
}

// Describe a configured difficulty/cognitive rule with its provenance.
export function difficultySource(policy = {}) {
  return (policy && policy.difficultySource) || SOURCES.DEFAULT;
}
export function cognitiveSource(policy = {}) {
  return (policy && policy.cognitiveSource) || SOURCES.DEFAULT;
}

// Compose the policy/configuration snapshot recorded on an assessment blueprint.
export function makePolicy({
  gradeLevel = '', assessmentType = 'Term Examination', itemFormat = 'Multiple Choice',
  totalItems, difficulty = DEFAULT_DIFFICULTY, cognitive = DEFAULT_COGNITIVE, note = '',
} = {}) {
  return {
    name: 'DepEd 015, s. 2026 (Classroom Assessment) — BlinkMaestra TOS V3 defaults',
    version: '3.0',
    effectiveSY: '2026-2027',
    gradeLevel,
    assessmentType,
    itemFormat,
    totalItems: totalItems ?? defaultTotalItems(gradeLevel),
    difficultyShare: difficulty,
    cognitiveShare: cognitive,
    difficultySource: difficultySource({ difficultySource: '' }),
    cognitiveSource: cognitiveSource({ cognitiveSource: '' }),
    note,
  };
}
