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
  const cap = CAPABILITIES.find((c) => c.name === capabilityName);
  if (!cap) return CAPABILITIES.slice(0, 3).map((c) => c.name);
  // Domain-specific next-step chains for the most common flows.
  const CHAINS = {
    'Lesson Planning': ['Generate Assessment', 'Create Activity Sheet', 'Create Remediation'],
    'Classroom Assessment': ['Answer Key', 'Rubric', 'Item Analysis Template'],
    'School Programs': ['Program', 'Attendance Documentation', 'Narrative Report', 'Accomplishment Report'],
  };
  return CHAINS[capabilityName] || cap.chain.map((n) => `Open ${n}`);
}
