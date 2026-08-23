export const CATEGORIES = [
  'Curriculum',
  'Official DepEd References',
  'Professional Standards',
  'Promotion',
  'Administrative References',
  'Templates',
  'Educational Best Practices',
  'Terminology',
];

export const DEFAULT_KNOWLEDGE = [
  { id: 'best-practice-instruction', category: 'Educational Best Practices', title: 'Classroom-ready learning design', version: '1.0', section: 'Planning guidance', type: 'RECOMMENDATION', text: 'Use clear objectives, active learning, formative checks, and reasonable differentiation. Adapt to actual learner context.', active: true },
  { id: 'privacy-guidance', category: 'Administrative References', title: 'Privacy-safe classroom documentation', version: '1.0', section: 'Data minimization', type: 'RECOMMENDATION', text: 'Avoid personally identifying learner information unless it is necessary and authorized. Use initials or groups in generated drafts.', active: true },
  { id: 'ppst-boundary', category: 'Professional Standards', title: 'PPST reference boundary', version: '1.0', section: 'Use with verified school references', type: 'ASSUMPTION', text: 'Do not state a PPST or promotion requirement unless the teacher provides or selects a verified official source.', active: true },
  { id: 'ilaw-framework', category: 'Official DepEd References', title: 'ILAW Lesson Planning Framework (D.O. 016, s. 2026)', version: '1.0', section: 'Framework elements', type: 'OFFICIAL REQUIREMENT', text: 'Per DepEd Order No. 016, s. 2026, lesson plans follow the ILAW framework: I – Intentions (competencies, objectives, success criteria); L – Learning Experience (facilitation, activities, resources, timing); A – Assessing Learning (formative checks during the lesson plus a summative task and accommodations); W – Ways Forward (evidence-based remediation, enrichment, reflection). Include header information (learning area, grade level, term under the three-term calendar) and a Declaration of AI Use stating whether and how AI was used and what modifications the teacher made. Old DLL/DLP formats are superseded.', active: true },
  { id: 'dll-structure', category: 'Templates', title: 'Legacy DLL structure (superseded)', version: '2.0', section: 'Reference only', type: 'ASSUMPTION', text: 'The legacy Daily Lesson Log (D.O. 42, s. 2016) sections — objectives, content, resources, procedures, remarks, reflection — are superseded by the ILAW framework for SY 2026-2027 onward. Use only when a teacher explicitly requests the legacy format.', active: true },
  { id: 'assessment-principles', category: 'Educational Best Practices', title: 'Balanced assessment design', version: '1.0', section: 'Item construction', type: 'RECOMMENDATION', text: 'Combine recall, comprehension, and application items. Provide an answer key with a scoring guide. Keep language at learner grade level.', active: true },
];

const CAPABILITY_CATEGORIES = {
  'Lesson Planning': ['Official DepEd References', 'Templates', 'Educational Best Practices', 'Curriculum'],
  'Classroom Assessment': ['Official DepEd References', 'Educational Best Practices', 'Curriculum'],
  'Learning Materials': ['Educational Best Practices', 'Curriculum'],
  'School Documentation': ['Official DepEd References', 'Administrative References', 'Educational Best Practices'],
  'Professional Growth': ['Professional Standards', 'Promotion', 'Administrative References'],
  'Parent Communication': ['Educational Best Practices', 'Administrative References'],
  'Classroom Management': ['Educational Best Practices', 'Administrative References'],
  'School Programs': ['Administrative References', 'Educational Best Practices'],
};

export function knowledgeFor(capability, store = []) {
  const all = [...DEFAULT_KNOWLEDGE.filter((k) => !store.some((s) => s.id === k.id)), ...store];
  const categories = CAPABILITY_CATEGORIES[capability] || [];
  return all
    .filter((k) => k.active !== false)
    .filter((k) => categories.length === 0 || categories.includes(k.category));
}
