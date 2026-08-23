import { seedTemplates } from './templates.js';

export function listTemplates(store = []) {
  return [...seedTemplates().filter((t) => !store.some((s) => s.id === t.id)), ...store].filter((t) => t.active !== false);
}

export const CAPABILITIES = [
  { id: 'lesson-planning', name: 'Lesson Planning', chain: ['Classroom Assessment', 'Learning Materials'] },
  { id: 'assessment', name: 'Classroom Assessment', chain: ['Lesson Planning', 'Learning Materials'] },
  { id: 'materials', name: 'Learning Materials', chain: ['Lesson Planning', 'Classroom Assessment'] },
  { id: 'school-docs', name: 'School Documentation', chain: [] },
  { id: 'growth', name: 'Professional Growth', chain: ['School Documentation'] },
  { id: 'parent-comm', name: 'Parent Communication', chain: [] },
  { id: 'classroom-mgmt', name: 'Classroom Management', chain: [] },
  { id: 'programs', name: 'School Programs', chain: ['School Documentation'] },
];

// Keyword routing so the system can pick a capability from a natural request.
const ROUTING_RULES = [
  { capability: 'Lesson Planning', keywords: ['dll', 'daily lesson log', 'lesson plan', 'lesson', 'lp'] },
  { capability: 'Classroom Assessment', keywords: ['quiz', 'test', 'exam', 'assessment', 'answer key', 'rubric', 'periodical'] },
  { capability: 'Learning Materials', keywords: ['worksheet', 'activity sheet', 'material', 'visual aid', 'handout', 'slides'] },
  { capability: 'Parent Communication', keywords: ['parent', 'advisory', 'letter to parents', 'consent'] },
  { capability: 'Professional Growth', keywords: ['mov', 'narrative', 'reflection', 'promotion', 'rpms', 'ipcrf', 'portfolio'] },
  { capability: 'School Documentation', keywords: ['report', 'accomplishment', 'minutes', 'memorandum', 'letter'] },
  { capability: 'Classroom Management', keywords: ['classroom', 'rules', 'seating', 'discipline', 'intervention'] },
  { capability: 'School Programs', keywords: ['program', 'activity plan', 'event', 'project proposal'] },
];

export function routeCapability(text) {
  const lower = String(text || '').toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const rule of ROUTING_RULES) {
    const score = rule.keywords.filter((k) => lower.includes(k)).length;
    if (score > bestScore) {
      best = rule.capability;
      bestScore = score;
    }
  }
  return best ? { capability: best, confident: bestScore > 0 } : { capability: null, confident: false };
}

export function relatedCapabilities(capabilityName) {
  const CHAINS = {
    'Lesson Planning': [
      { label: 'Generate Assessment', template: 'assessment' },
      { label: 'Create Activity Sheet', template: 'activity-sheet' },
      { label: 'Create Remediation', template: 'activity-sheet' },
    ],
    'Classroom Assessment': [
      { label: 'Create Answer Key & Rubric', template: 'assessment' },
      { label: 'Create Practice Worksheet', template: 'activity-sheet' },
    ],
    'Learning Materials': [
      { label: 'Plan the Supporting Lesson', template: 'ilaw' },
      { label: 'Create a Matching Assessment', template: 'assessment' },
    ],
    'School Programs': [
      { label: 'Generate Program Plan', template: 'program-plan' },
      { label: 'Create Attendance Documentation', template: 'accomplishment-report' },
      { label: 'Write Narrative Report', template: 'accomplishment-report' },
      { label: 'Write Accomplishment Report', template: 'accomplishment-report' },
    ],
  };
  if (CHAINS[capabilityName]) return CHAINS[capabilityName];
  // Sensible defaults per capability family.
  const DEFAULTS = {
    'Parent Communication': [{ label: 'Draft a Follow-up Advisory', template: 'parent-advisory' }],
    'Professional Growth': [{ label: 'Write a Supporting Narrative Report', template: 'accomplishment-report' }],
    'Classroom Management': [{ label: 'Plan a Related Lesson', template: 'ilaw' }],
    'School Documentation': [{ label: 'Summarize as Accomplishment Report', template: 'accomplishment-report' }, { label: 'Notify Parents', template: 'parent-advisory' }],
  };
  return DEFAULTS[capabilityName] || [{ label: 'Create an Activity Sheet', template: 'activity-sheet' }];
}
