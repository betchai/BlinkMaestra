import { getProvider } from './ai.js';
import { knowledgeFor } from './knowledge.js';
import { routeCapability, relatedCapabilities } from './capabilities.js';

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

function systemInstructions(capability, profile, refs) {
  const ilawNote = capability === 'Lesson Planning'
    ? ` IMPORTANT - ILAW framework: Structure lesson plans exactly per DepEd Order No. 016, s. 2026 with sections in this order: header information (learning area, grade level, term/week), "I - Intentions" (competency, objectives, success criteria), "L - Learning Experience" (activities with timing and resources), "A - Assessing Learning" (formative checks plus summative task and accommodations), "W - Ways Forward" (remediation, enrichment, reflection), and a final "Declaration of AI Use" section stating AI was used to draft this plan and the teacher reviewed and modified it.`
    : '';
  return `You are BLinkMaestra, the DepEd teacher's copilot, a professional instructional assistant. Create editable, classroom-ready ${capability} documents. The teacher retains professional judgment. Never invent DepEd orders, memoranda, curriculum codes, promotion requirements, or official claims. If verified official information is not provided, state a concise assumption or recommend confirmation.${ilawNote}
Teacher context: ${JSON.stringify({
    gradeLevels: profile?.gradeLevels,
    subjects: profile?.subjects,
    school: profile?.school,
    language: profile?.language,
    duration: profile?.duration,
    preferences: profile?.preferences,
  })}.
Use these relevant knowledge notes and label their type accurately: ${JSON.stringify(refs.map((r) => ({ title: r.title, type: r.type, text: r.text })))}.
Return valid JSON with keys: title, contentHtml, assumptions (array), qualityNotes (array).
contentHtml must contain semantic h1/h2/p/ul/ol/table only; no markdown.`;
}

// Lightweight post-generation validation before presenting output to the teacher.
function validate(result) {
  const issues = [];
  if (!result.title || !String(result.title).trim()) issues.push('The document has no title.');
  const html = String(result.contentHtml || '');
  if (html.replace(/<[^>]+>/g, '').trim().length < 80) issues.push('The generated document is too short to be usable.');
  if (!/<(h1|h2|p|ul|ol|table)/i.test(html)) issues.push('The document has no recognizable structure.');
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

async function callProvider({ capability, context, profile, refs }) {
  const provider = getProvider();
  const { raw, usage } = await provider.generate({
    instructions: systemInstructions(capability, profile, refs),
    input: `Return a JSON object for this workflow using the structured teacher inputs: ${JSON.stringify(context)}`,
  });
  let parsed;
  try { parsed = extractJson(raw); } catch {
    console.error('[pipeline] model returned non-JSON output:', String(raw).slice(0, 200));
    throw Object.assign(new Error('We could not validate the generated document. Please try again.'), { status: 502 });
  }
  parsed.references = refs.map(({ id, title, category, version, section, type }) => ({ id, title, category, version, section, type }));
  parsed.usage = usage;
  return parsed;
}

export async function runGeneration({ capability, requestedCapability, context = {}, profile = {}, knowledgeStore = [], onStage = () => {} }) {
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
  let result = await callProvider({ capability: resolved, context, profile, refs });
  onStage('Checking the result');
  let check = validate(result);
  if (!check.ok) {
    console.warn('[pipeline] validation issues, retrying once:', check.issues);
    onStage('Checking found gaps — regenerating');
    result = await callProvider({ capability: resolved, context: { ...context, previousIssues: check.issues }, profile, refs });
    check = validate(result);
  }
  onStage('Preparing your document');
  result.validation = check.ok ? 'passed' : 'uncertain';
  result.validationIssues = check.issues;
  result.relatedWork = relatedCapabilities(resolved);
  return result;
}
