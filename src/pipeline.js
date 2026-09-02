import { getProvider } from './ai.js';
import { knowledgeFor } from './knowledge.js';
import { routeCapability, relatedCapabilities } from './capabilities.js';
import { calculateTos, assembleTosHtml, placementLines, normalizeLevel } from './tos.js';

const STAGES = [
  'Understanding your request',
  'Preparing relevant information',
  'Generating content',
  'Checking the result',
  'Preparing your document',
];

export function pipelineStages() {
  return STAGES;
}

function systemInstructions(capability, profile, refs, context = {}) {
  const useProfileContext = profile?.contextEnabled !== false;
  const ilawNote = capability === 'Lesson Planning'
    ? ` IMPORTANT - ILAW framework: Structure lesson plans exactly per DepEd Order No. 016, s. 2026 with sections in this order: header information (learning area, grade level, term/week), "I - Intentions" (competency, objectives, success criteria), "L - Learning Experience" (activities with timing and resources), "A - Assessing Learning" (formative checks plus summative task and accommodations), "W - Ways Forward" (remediation, enrichment, reflection), and a final "Declaration of AI Use" section stating AI was used to draft this plan and the teacher reviewed and modified it.`
    : '';
  if (context._examPrompt) {
    return `${context._examPrompt}\n\nRespond with valid JSON only.`;
  }
  const batchNote = context.itemRange
    ? ` Generate ONLY items ${context.itemRange}. Do not generate any other item numbers. Do not add assessment headers, directions, or introductions. Output only: an items section with the requested numbered items and a single answer key section matching those items.`
    : '';
  return `You are BLinkMaestra, the DepEd teacher's copilot, a professional instructional assistant. Create editable, classroom-ready ${capability} documents. The teacher retains professional judgment. Never invent DepEd orders, memoranda, curriculum codes, promotion requirements, or official claims. If verified official information is not provided, state a concise assumption or recommend confirmation.${ilawNote}${batchNote}
Teacher context: ${JSON.stringify({
    ...(useProfileContext ? {
      gradeLevels: profile?.gradeLevels,
      subjects: profile?.subjects,
      school: profile?.school,
      language: profile?.language,
      duration: profile?.duration,
      preferences: profile?.preferences,
    } : {}),
  })}.
Use these relevant knowledge notes and label their type accurately: ${JSON.stringify(refs.map((r) => ({ title: r.title, type: r.type, text: r.text })))}.
Return valid JSON with keys: title, contentHtml, assumptions (array), qualityNotes (array).
  contentHtml must contain semantic h1/h2/p/ul/ol/table only; no markdown. Use the knowledge notes as design constraints and concise references; do not paste a full knowledge note or policy explainer into the assessment unless the teacher explicitly asks for a guide.`;
}

// Lightweight post-generation validation before presenting output to the teacher.
function validate(result, context = {}) {
  const issues = [];
  if (!result.title || !String(result.title).trim()) issues.push('The document has no title.');
  const html = String(result.contentHtml || '');
  if (html.replace(/<[^>]+>/g, '').trim().length < 80) issues.push('The generated document is too short to be usable.');
  if (!/<(h1|h2|p|ul|ol|table)/i.test(html)) issues.push('The document has no recognizable structure.');
  const assessmentType = `${context['Assessment type'] || ''} ${context['Item format'] || ''}`.toLowerCase();
  const choiceBased = /multiple.?choice|true.?false|matching|selected.?response|choices|options/.test(assessmentType);
  const multipleChoice = /multiple.?choice|choices|options/.test(assessmentType);
  if (choiceBased && !/<li\b/i.test(html) && !/<table\b/i.test(html)) {
    issues.push('Choice-based assessments must visibly print the learner-facing choices or options for every item.');
  }
  if (multipleChoice && !(/\bA[.)]/i.test(html) && /\bB[.)]/i.test(html) && /\bC[.)]/i.test(html) && /\bD[.)]/i.test(html))) {
    issues.push('Multiple-choice assessments must print complete A, B, C, and D options; a letter-only answer key is invalid.');
  }
  if (/DepEd Order No\.?\s*\d|DepEd Memorandum No\.?\s*\d/i.test(html) && !(result.references || []).some((r) => r.type === 'OFFICIAL REQUIREMENT')) {
    issues.push('Possible fabricated official reference detected.');
  }
  return { ok: issues.length === 0, issues };
}

// Escape raw control characters inside string literals (models sometimes emit them).
function repairJson(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString && c === '\\') { out += c + text[i + 1]; i++; continue; }
    if (c === '"') inString = !inString;
    if (inString && c === '\n') { out += '\\n'; continue; }
    if (inString && c === '\t') { out += '\\t'; continue; }
    if (inString && c === '\r') continue;
    out += c;
  }
  return out;
}

// Models sometimes wrap JSON in markdown fences or lead with prose. Extract the JSON object.
function extractJson(raw) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = (fenced ? fenced[1] : raw).trim();
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const sliced = text.slice(start, end + 1);
    try { return JSON.parse(sliced); } catch {}
    return JSON.parse(repairJson(sliced));
  }
  throw new SyntaxError('no JSON found');
}

async function callProvider({ capability, context, profile, refs, settings }) {
  const provider = getProvider(settings);
  const promptRefs = context.template === 'Assessment with Answer Key'
    ? refs.map(({ title, type }) => ({ title, type }))
    : refs;
  const { raw, usage } = await provider.generate({
    instructions: systemInstructions(capability, profile, promptRefs, context),
    input: `Return a JSON object for this workflow using the structured teacher inputs: ${JSON.stringify(context)}`,
  });
  let parsed;
  try { parsed = extractJson(raw); } catch {
    console.error('[pipeline] model returned invalid or truncated JSON:', { length: String(raw).length, tail: String(raw).slice(-160) });
    throw Object.assign(new Error('We could not validate the generated document. Please try again.'), { status: 502 });
  }
  parsed.references = refs.map(({ id, title, category, version, section, type }) => ({ id, title, category, version, section, type }));
  parsed.usage = usage;
  return parsed;
}

export async function runGeneration({ capability, requestedCapability, context = {}, profile = {}, knowledgeStore = [], settings = {}, onStage = () => {} }) {
  if (context.template === 'DepEd 015 TOS & Examination (Beta)') return runTosGeneration({ capability, context, profile, knowledgeStore, settings, onStage });
  // Stage 1: intent detection / capability routing
  onStage('Understanding your request');
  let resolved = capability || null;
  if (!resolved && context.request) {
    const routed = routeCapability(context.request);
    resolved = routed.capability;
  }
  if (!resolved) resolved = requestedCapability || 'General';

  // Stage 2: knowledge retrieval
  onStage(`Preparing relevant information (${resolved})`);
  const refs = knowledgeFor(resolved, knowledgeStore);

  // Stage 3-4: generation + validation with one retry on validation failure
  onStage('Generating content — the AI model is writing');
  let result = await callProvider({ capability: resolved, context, profile, refs, settings });
  onStage('Checking the result');
  let check = validate(result, context);
  if (!check.ok) {
    console.warn('[pipeline] validation issues, retrying once:', check.issues);
    onStage('Checking found gaps — regenerating');
    result = await callProvider({ capability: resolved, context: { ...context, previousIssues: check.issues }, profile, refs, settings });
    check = validate(result, context);
  }
  onStage('Preparing your document');
  result.validation = check.ok ? 'passed' : 'uncertain';
  result.validationIssues = check.issues;
  result.relatedWork = relatedCapabilities(resolved);
  return result;
}

function stripCognitiveLabels(html) {
  return html
    .replace(/\s*\(\s*(Remembering|Understanding|Applying|Analyzing|Evaluating|Creating)\s*\)/gi, '')
    .replace(/\s*[-–]\s*(Remembering|Understanding|Applying|Analyzing|Evaluating|Creating)\s*[-–]?\s*/gi, '')
    .replace(/\bCreating\b/gi, '')
    .trim();
}

function escHtml(v) { return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function renderAnswer(i) {
  const label = i.answerLabel || i.answer || '';
  const text = i.answerText || '';
  if (label || text) return `${escHtml(label)}${text ? ` - ${escHtml(text)}` : ''}`;
  return '* answer not generated — please review';
}

// Build consolidated exam HTML (one items list + one answer key) from parsed items.
// Explicit item numbers via <li value> so the numbering always matches the TOS,
// even when some item numbers are missing from the model output.
function buildExamHtml(items) {
  const ordered = [...items].sort((a, b) => (a.number || a.n || 0) - (b.number || b.n || 0));
  const questions = ordered.map((i) => `<li value="${i.number || i.n}"><p>${escHtml(i.stem)}</p>${i.options?.length ? `<ul>${i.options.map((o) => `<li>${escHtml(o.label)}) ${escHtml(o.text)}</li>`).join('')}</ul>` : ''}</li>`).join('');
  const answers = ordered.map((i) => `<li value="${i.number || i.n}">${renderAnswer(i)}</li>`).join('');
  return `<ol>${questions}</ol>\n<p><strong>Answer Key</strong></p>\n<ol>${answers}</ol>`;
}

// Normalize a parsed generation result into an items array (accepts an items key or a raw HTML fallback).
function extractItems(parsed) {
  if (Array.isArray(parsed.items)) return parsed.items;
  if (Array.isArray(parsed.data)) return parsed.data;
  const html = String(parsed.contentHtml || '');
  const matches = [...html.matchAll(/<li><p>([\s\S]*?)<\/p>(?:<ul>([\s\S]*?)<\/ul>)?<\/li>/gi)];
  return matches.map((m, idx) => ({
    number: idx + 1,
    stem: m[1].replace(/<[^>]+>/g, '').trim(),
    options: m[2] ? [...m[2].matchAll(/<li>([^]*?)<\/li>/gi)].map((o) => {
      const t = o[1].replace(/<[^>]+>/g, '').trim();
      const mm = t.match(/^([A-Z])[)\.]\s*([\s\S]*)$/i);
      return mm ? { label: mm[1], text: mm[2].trim() } : { label: '', text: t };
    }) : undefined,
  }));
}

async function runTosGeneration({ capability, context, profile, knowledgeStore, settings, onStage }) {
  onStage('Preparing relevant information');
  const tos = calculateTos({ competencies: context['Competencies with teaching days'], numberOfItems: context['Number of items'] });

  const itemFormat = (context['Item format'] || 'Multiple Choice').trim();
  const assessmentType = (context['Assessment type'] || 'assessment').trim();
  const cleanAssessmentType = itemFormat.toLowerCase() === assessmentType.toLowerCase()
    ? itemFormat
    : `${itemFormat} (${assessmentType})`;

  const competencyList = [...new Set(tos.blueprint.map((item) => item.competency))].join('; ');
  const slotByNumber = new Map(tos.blueprint.map((item) => [item.number, item]));

  onStage('Generating content');
  const refs = knowledgeFor('Classroom Assessment', knowledgeStore);

  // Build a compact JSON request — the model returns only an items array,
  // which we assemble into clean HTML ourselves (one items list + one answer key).
  // Each item number carries its TOS placement (competency → cognitive level), so
  // generated items are constrained to the planned slot instead of free-floating.
  const buildItemsPrompt = (count, start, label) => `${label}
Generate ${count} ${context['Subject / learning area'] || ''} exam item${count === 1 ? '' : 's'} for Grade ${context['Grade level'] || ''}, Term ${context['Term'] || ''}.
Item numbers: ${start} to ${start + count - 1}.
Competencies: ${competencyList}.
Format: ${cleanAssessmentType}.
Placement (item number → competency → cognitive level):
${placementLines(tos.blueprint, start, start + count - 1).join('\n')}

Return ONLY a JSON object with a single key "items", an array of ${count} objects. Do NOT add any other keys.
Each item object has exactly this shape:
{"number": 1, "stem": "question text", "options": [{"label":"A","text":"option text"},{"label":"B","text":"…"}], "answerLabel": "A", "answerText": "optional short explanation or correct answer text"}
Rules:
- Exactly ${count} items with consecutive numbers starting at ${start}.
- Each item must ACTUALLY test the competency and cognitive level listed for its number in the Placement list. A Remembering item asks the learner to recall or define; an Understanding item explains or interprets; an Applying item uses the skill in a scenario; an Analyzing item breaks down, compares, or classifies; an Evaluating item judges or critiques; a Creating item generates or designs.
- For multiple-choice items, include 4 options (A-D). For true/false, 2 options. For short-answer or matching, use options:[] and put the expected answer in answerText.
- Keep stems concise. Use grade-appropriate language.
- JSON only. No HTML, no markdown, no headings, no extra text.`;

  // Generate items in bounded chunks so each call fits the model output limit.
  // A single call for the full count silently truncates (returns fewer items with
  // valid JSON), so we always chunk and then verify we actually got every number.
  const MAX_PER_CALL = 10;
  const collected = new Map();
  // Numbers awaiting a forced rewrite (e.g. level-mismatched items after verification).
  const extra = new Set();

  async function generateRange(start, end) {
    const count = end - start + 1;
    try {
      const res = await callProvider({
        capability: 'Classroom Assessment',
        context: { ...context, _examPrompt: buildItemsPrompt(count, start, 'You are generating examination items for the DepEd 015 assessment.'), template: 'Exam Items Only', 'Number of items': String(count) },
        profile,
        refs: refs.map(({ title, type }) => ({ title, type })),
        settings,
      });
      for (const item of extractItems(res)) {
        const n = Number(item.number ?? item.n);
        if (Number.isInteger(n) && n >= start && n <= end && (!collected.has(n) || extra.has(n))) collected.set(n, item);
      }
    } catch (err) {
      console.warn(`[tos] range ${start}-${end} failed:`, err.message);
    }
  }

  function needsFill(n) {
    const it = collected.get(n);
    if (!it) return true;
    return !it.answerLabel && !it.answer && !it.answerText;
  }

  function missingNumbers() {
    const out = [];
    for (let n = 1; n <= tos.totalItems; n++) if (needsFill(n)) out.push(n);
    return out;
  }

  function badNumbers(extraSet) {
    const out = [];
    for (let n = 1; n <= tos.totalItems; n++) {
      if (needsFill(n) || extraSet.has(n)) out.push(n);
    }
    return out;
  }

  // Regenerate the largest contiguous run of bad numbers; returns false when nothing is left.
  async function regenerateBestRun(extraSet) {
    const missing = badNumbers(extraSet);
    if (!missing.length) return false;
    const runs = [[missing[0], missing[0]]];
    for (let i = 1; i < missing.length; i++) {
      if (missing[i] === runs[runs.length - 1][1] + 1) runs[runs.length - 1][1] = missing[i];
      else runs.push([missing[i], missing[i]]);
    }
    const best = runs.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
    console.warn(`[tos] regenerating ${best[0]}-${best[1]}`);
    await new Promise((r) => setTimeout(r, 3000));
    await generateRange(best[0], best[1]);
    for (let n = best[0]; n <= best[1]; n++) extraSet.delete(n);
    return true;
  }

  for (let start = 1; start <= tos.totalItems; start += MAX_PER_CALL) {
    await generateRange(start, Math.min(start + MAX_PER_CALL - 1, tos.totalItems));
    if (start + MAX_PER_CALL <= tos.totalItems) await new Promise((r) => setTimeout(r, 3000));
  }

  // Fill any gaps (missing items OR items without an answer) with up to 3 targeted
  // retry rounds; each round regenerates the largest contiguous missing run.
  for (let round = 0; round < 3 && (await regenerateBestRun(extra)); round++) {}

  // Classify generated items against the TOS blueprint: one lightweight call that tags
  // each item with the cognitive level it actually tests, compared to the slot it owns.
  async function verifyPlacement(examItems) {
    const orderedItems = [...examItems].sort((a, b) => (a.number || a.n || 0) - (b.number || b.n || 0));
    const input = orderedItems.map((i) => `${i.number || i.n}: ${i.stem}`).join('\n');
    const prompt = `You are verifying a DepEd 015 examination against its Table of Specifications.
For EACH numbered item below, classify the cognitive process level it actually tests. Use exactly one of: Remembering, Understanding, Applying, Analyzing, Evaluating, Creating.
Return ONLY a JSON object with key "classifications": an array of {"number": <n>, "level": "<one of the six levels>"}, one entry per item.

${input}`;
    const res = await callProvider({
      capability: 'Classroom Assessment',
      context: { ...context, _examPrompt: prompt, template: 'Exam Items Only', 'Number of items': String(orderedItems.length) },
      profile,
      refs: refs.map(({ title, type }) => ({ title, type })),
      settings,
    });
    const classifications = Array.isArray(res.classifications) ? res.classifications : [];
    const mismatches = [];
    for (const c of classifications) {
      const n = Number(c.number);
      const slot = slotByNumber.get(n);
      const level = normalizeLevel(c.level);
      if (!slot || !level || level === slot.cognitiveLevel) continue;
      mismatches.push({ number: n, expected: slot.cognitiveLevel, reported: level });
    }
    return mismatches;
  }

  // Verify the generated items actually sit at the cognitive levels the TOS assigns
  // to their numbers. One lightweight classification call; mismatches are regenerated
  // with the slot constraints (already part of the prompt) and re-verified once.
  const levelMismatches = [];
  const structurallyComplete = missingNumbers().length === 0;
  if (structurallyComplete) {
    onStage('Checking the result');
    try {
      for (const m of await verifyPlacement([...collected.values()])) extra.add(m.number);
      for (let round = 0; round < 3 && (await regenerateBestRun(extra)); round++) {}
      levelMismatches.push(...(await verifyPlacement([...collected.values()])));
    } catch (err) {
      console.warn('[tos] placement verification skipped:', err.message);
    }
  }

  // Items with no answer at all (store a marker so they still get an answer-key row).
  const examItems = [...collected.values()].sort((a, b) => (a.number || a.n) - (b.number || b.n));
  if (!examItems.length) {
    throw Object.assign(new Error('Item generation returned no usable items. Please try again.'), { status: 502 });
  }

  const consolidatedExamHtml = buildExamHtml(examItems)
    .replace(/\s*\(\s*(Remembering|Understanding|Applying|Analyzing|Evaluating|Creating)\s*\)/gi, '')
    .replace(/\s*[-–]\s*(Remembering|Understanding|Applying|Analyzing|Evaluating|Creating)\s*[-–]?\s*/gi, '')
    .replace(/\bCreating\b/gi, '');

  const structuralMissing = missingNumbers();
  const uniqueMismatches = [...new Map(levelMismatches.map((m) => [m.number, m])).values()].sort((a, b) => a.number - b.number);
  const complete = structuralMissing.length === 0 && uniqueMismatches.length === 0;
  const title = stripCognitiveLabels(String(context['Subject / learning area'] || 'Assessment')).trim();
  const tosHtml = assembleTosHtml({ title, tos, items: [], assessmentType: cleanAssessmentType })
    .replace(/<h2>Examination Items<\/h2>[\s\S]*?<h2>Answer Key<\/h2>/i, '')
    .replace(/<h2>Scoring Guide<\/h2>[\s\S]*$/i, '');
  const shortTitle = title
    ? `${title} Assessment – Grade ${context['Grade level'] || ''}, Term ${context['Term'] || ''}`.replace(/\s+-\s+$/,'').trim()
    : 'DepEd 015 TOS and Examination';
  const validationIssues = [];
  if (structuralMissing.length) validationIssues.push(`Generated ${examItems.length} of ${tos.totalItems} requested items (percent incomplete: ${structuralMissing.join(', ')}). Regenerate to fill gaps.`);
  for (const m of uniqueMismatches) validationIssues.push(`Item ${m.number} tests ${m.reported}, but the TOS places it at ${m.expected}. Regenerate to align this item to its planned cognitive level.`);
  return {
    title: shortTitle,
    contentHtml: `${tosHtml}<h2>Examination</h2>${consolidatedExamHtml}`,
    validation: complete ? 'passed' : 'uncertain',
    validationIssues,
    relatedWork: relatedCapabilities('Classroom Assessment'),
  };
}
