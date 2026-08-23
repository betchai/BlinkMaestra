import { api } from './api.js';
import { h, esc, toast, modal, field } from './ui.js';

const state = { user: null, profile: null, capabilities: [], route: { name: 'dashboard' }, saveTimer: null, dirty: false };

const app = document.getElementById('app');

// ---------- Router ----------
function go(route) {
  state.route = route;
  render();
}

// ---------- Auth ----------
function authScreen(mode = 'login') {
  const isReset = mode === 'reset';
  const isConfirm = mode === 'confirm';
  const title = mode === 'register' ? 'Create your account' : isReset ? 'Reset your password' : isConfirm ? 'Choose a new password' : 'Welcome back';
  const formHtml =
    mode === 'login'
      ? `${field('Email', `<input type="email" id="f-email" required autocomplete="email">`)}
         ${field('Password', `<input type="password" id="f-password" required autocomplete="current-password">`)}
         <button class="button" type="submit" style="width:100%">Sign in</button>
         <div class="form-actions"><button type="button" class="button ghost" data-mode="register">Create an account</button>
         <button type="button" class="button ghost" data-mode="reset">Forgot password?</button></div>`
      : mode === 'register'
        ? `${field('Full name', `<input id="f-name" autocomplete="name">`)}
           ${field('Email', `<input type="email" id="f-email" required autocomplete="email">`)}
           ${field('Password', `<input type="password" id="f-password" required minlength="8" autocomplete="new-password">`, )}
           <p class="notice">Use at least 8 characters.</p>
           <button class="button" type="submit" style="width:100%">Create account</button>
           <div class="form-actions"><button type="button" class="button ghost" data-mode="login">I already have an account</button></div>`
        : isReset
          ? `${field('Email', `<input type="email" id="f-email" required>`)}<p class="notice">If the account exists, a reset link will be issued. Ask your administrator for access in this environment.</p>
             <button class="button" type="submit" style="width:100%">Send reset request</button>
             <div class="form-actions"><button type="button" class="button ghost" data-mode="login">Back to sign in</button></div>`
          : `${field('New password', `<input type="password" id="f-password" required minlength="8">`)}
             ${field('Reset token', `<input id="f-token" required>`, true)}
             <button class="button" type="submit" style="width:100%">Set new password</button>
             <div class="form-actions"><button type="button" class="button ghost" data-mode="login">Back to sign in</button></div>`;

  app.innerHTML = '';
  const page = h(`<div class="auth-page page" style="display:grid;place-items:center;min-height:100vh">
    <div class="card auth-card" style="width:min(430px,100%);padding:30px">
      <div class="brand" style="margin-bottom:18px;color:var(--forest)"><span class="brand-mark">B</span><div><strong style="color:var(--ink)">BLinkMaestra</strong><small>Your teaching copilot</small></div></div>
      <h1 style="font:700 24px Fraunces,serif;margin:0 0 16px">${title}</h1>
      <form id="auth-form">${formHtml}</form>
    </div></div>`);
  app.appendChild(page);

  page.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => authScreen(b.dataset.mode)));
  document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (id) => document.getElementById(id)?.value.trim();
    try {
      if (mode === 'login') {
        const r = await api.login({ email: v('f-email'), password: v('f-password') });
        state.user = r.user; state.profile = r.profile;
      } else if (mode === 'register') {
        const r = await api.register({ name: v('f-name'), email: v('f-email'), password: v('f-password') });
        state.user = r.user; state.profile = r.profile;
      } else if (mode === 'reset') {
        await api.requestReset(v('f-email'));
        toast('If that account exists, a reset was issued. Check with your administrator.');
        return;
      } else {
        await api.confirmReset({ token: v('f-token'), password: v('f-password') });
        toast('Password updated. Please sign in.');
        return authScreen('login');
      }
      await afterAuth();
    } catch (err) {
      toast(err.message);
    }
  });
}

async function afterAuth() {
  const caps = await api.capabilities();
  state.capabilities = caps;
  if (!state.profile.onboardingComplete) return onboardingScreen(0);
  go({ name: 'dashboard' });
}

// ---------- Onboarding ----------
function onboardingScreen(step) {
  const p = state.profile || {};
  const steps = [
    { title: `Welcome${state.user?.name ? ', ' + esc(state.user.name) : ''}`, subtitle: 'A few quick questions so we can pre-fill your documents. Everything here can be skipped or edited later.', body: `
      ${field('Position', `<input id="o-position" value="${esc(p.position || '')}" placeholder="e.g. Teacher I">`)}
      ${field('School', `<input id="o-school" value="${esc(p.school || '')}">`)}
      ${field('Division', `<input id="o-division" value="${esc(p.division || '')}">`)}
      ${field('Region', `<input id="o-region" value="${esc(p.region || '')}">`)}` },
    { title: 'What do you teach?', subtitle: 'We use this so workflows never ask for it again.', body: `
      ${field('Grade level(s)', `<input id="o-grades" value="${esc((p.gradeLevels || []).join(', '))}" placeholder="e.g. Grade 5, Grade 6">`)}
      ${field('Subject(s)', `<input id="o-subjects" value="${esc((p.subjects || []).join(', '))}" placeholder="e.g. Science, Math">`)}
      ${field('Learning competencies you teach', `<textarea id="o-competencies" placeholder="One per line, e.g.&#10;Describe the parts of the water cycle (S6ES-IVa-8)&#10;Explain the difference between mixtures and compounds">${esc(p.competencies || '')}</textarea>`, true)}` },
    { title: 'Your preferences', subtitle: 'Optional — helps drafts feel ready-to-use.', body: `
      ${field('Preferred language', `<select id="o-language"><option>English</option><option>Filipino</option><option>English and Filipino</option></select>`)}
      ${field('Common class duration', `<select id="o-duration"><option value="">Skip</option><option>30 minutes</option><option>45 minutes</option><option>60 minutes</option><option>Other</option></select>`)}
      ${field('Teaching preferences', `<textarea id="o-preferences" placeholder="e.g. Group work, low-cost materials, no-internet activities"></textarea>`, true)}` },
  ];
  const s = steps[step];
  app.innerHTML = '';
  app.appendChild(h(`<div class="page" style="max-width:640px;display:grid;place-items:center;min-height:100vh">
    <div class="card workflow-card" style="width:100%">
      <div class="workflow-steps">${steps.map((_, i) => `<span class="step${i <= step ? ' active' : ''}"><b>${i + 1}</b></span>${i < steps.length - 1 ? '<i></i>' : ''}`).join('')}</div>
      <h1 style="font:700 26px Fraunces,serif;margin:0">${s.title}</h1>
      <p class="subtitle" style="font-size:13px">${s.subtitle}</p>
      <form id="onboard-form">${s.body}
        <div class="form-actions">
          <button type="button" class="button ghost" id="skip-btn">Skip</button>
          <button class="button" type="submit">${step < steps.length - 1 ? 'Continue' : 'Finish'}</button>
        </div></form></div></div>`));

  if (step === steps.length - 1) {
    document.getElementById('o-language').value = p.language || 'English';
    document.getElementById('o-duration').value = p.duration || '';
  }

  const collect = () => ({
    position: v('o-position'), school: v('o-school'), division: v('o-division'), region: v('o-region'),
    gradeLevels: splitCsv(v('o-grades')), subjects: splitCsv(v('o-subjects')),
    language: v('o-language'), duration: v('o-duration'), preferences: v('o-preferences'),
  });
  const v = (id) => document.getElementById(id)?.value.trim() || '';
  const finish = async (data, complete) => {
    try {
      const r = await api.saveProfile({ ...data, onboardingComplete: complete !== false });
      state.profile = r.profile;
      toast(complete === false ? 'Skipped for now' : 'Profile saved');
      go({ name: 'dashboard' });
    } catch (err) {
      // A dead session would otherwise trap the teacher on this screen forever.
      if (err.status === 401) {
        state.user = null;
        toast('Your session expired. Please sign in again.');
        return authScreen('login');
      }
      toast(err.message);
    }
  };
  document.getElementById('skip-btn').addEventListener('click', () => finish({}, step === steps.length - 1));
  document.getElementById('onboard-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const merged = { ...(state.profile || {}), ...collect() };
    if (step < steps.length - 1) {
      const r = await api.saveProfile({ ...merged, onboardingComplete: false }).catch(() => null);
      if (r) state.profile = r.profile;
      onboardingScreen(step + 1);
    } else finish(merged);
  });
}

function splitCsv(s) { return String(s).split(',').map((x) => x.trim()).filter(Boolean); }

// ---------- Shell ----------
function shell(contentHtml, crumb) {
  const u = state.user;
  const initials = (u.name || u.email).split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const navItems = [
    ['dashboard', '⌂', 'Dashboard'],
    ['templates', '▤', 'Templates'],
    ['documents', '🗂', 'My Documents'],
    ['history', '🕘', 'AI History'],
    ...(u.role === 'admin' ? [['admin', '🛠', 'Admin']] : []),
    ['settings', '⚙', 'Settings'],
    ['help', '?', 'Help'],
  ];
  app.innerHTML = '';
  app.appendChild(h(`<div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">B</span><div><strong>BLinkMaestra</strong><small>Teacher workspace</small></div></div>
      <nav class="nav" aria-label="Main navigation">${navItems.map(([id, icon, label]) =>
        `<button data-nav="${id}" class="${state.route.name === id ? 'active' : ''}"><span class="symbol">${icon}</span><span>${label}</span></button>`).join('')}</nav>
      <div class="sidebar-footer"><button id="logout-btn" class="user-menu" style="border:0;background:transparent;color:#cae4dd;cursor:pointer;font:inherit;padding:10px;width:100%;text-align:left">↵ Sign out</button></div>
    </aside>
    <main class="main">
      <header class="topbar">
        <div class="crumb">${crumb}</div>
        <div class="top-actions">
          <button class="global-search" id="global-search" aria-label="Global search">⌕ Search everything <kbd>/</kbd></button>
          <button class="icon-btn" id="theme-btn" aria-label="Toggle dark mode">◐</button>
          <span class="avatar" title="${esc(u.name || u.email)}">${initials}</span>
        </div>
      </header>
      <div class="page" id="page-root">${contentHtml}</div>
    </main></div>`));

  app.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => go({ name: b.dataset.nav })));
  document.getElementById('logout-btn').addEventListener('click', async () => { await api.logout(); state.user = null; authScreen(); });
  document.getElementById('theme-btn').addEventListener('click', () => document.body.classList.toggle('dark'));
  document.getElementById('global-search').addEventListener('click', globalSearch);
  const keyHandler = (e) => {
    if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { e.preventDefault(); globalSearch(); }
    if (e.key === 'Escape') document.querySelector('.modal')?.remove();
  };
  document.removeEventListener('keydown', shell._keyHandler || (() => {}));
  shell._keyHandler = keyHandler;
  document.addEventListener('keydown', keyHandler);
}

// ---------- Global search ----------
async function globalSearch() {
  const overlay = modal(`<div class="modal-box"><div class="search-command"><span aria-hidden="true">⌕</span><input id="gs-input" placeholder="Search documents, templates, capabilities…" aria-label="Search"></div><div class="command-results" id="gs-results"></div></div>`);
  const input = overlay.querySelector('#gs-input');
  const results = overlay.querySelector('#gs-results');
  input.focus();

  const search = async () => {
    const q = input.value.toLowerCase().trim();
    if (!q) { results.innerHTML = `<div class="empty-command">Type to search your workspace.</div>`; return; }
    const [docs, templates] = await Promise.all([api.documents(), api.templates()]);
    const docHits = docs.filter((d) => !d.deletedAt && d.title.toLowerCase().includes(q));
    const tplHits = templates.filter((t) => t.name.toLowerCase().includes(q) || t.capability.toLowerCase().includes(q));
    const capHits = state.capabilities.filter((c) => c.name.toLowerCase().includes(q));
    results.innerHTML = `
      ${docHits.length ? `<div class="command-label">Documents</div>` + docHits.map((d) => `<button data-doc="${d.id}"><span>📄</span>${esc(d.title)}<small>${esc(d.capability)}</small></button>`).join('') : ''}
      ${tplHits.length ? `<div class="command-label">Templates</div>` + tplHits.map((t) => `<button data-tpl="${t.id}"><span>▤</span>${esc(t.name)}<small>${esc(t.capability)}</small></button>`).join('') : ''}
      ${capHits.length ? `<div class="command-label">Capabilities</div>` + capHits.map((c) => `<button data-cap="${c.id}"><span>✦</span>${esc(c.name)}</button>`).join('') : ''}
      ${!docHits.length && !tplHits.length && !capHits.length ? `<div class="empty-command">No matches found.</div>` : ''}`;
    results.querySelectorAll('[data-doc]').forEach((b) => b.addEventListener('click', () => { overlay.remove(); go({ name: 'workspace', docId: b.dataset.doc }); }));
    results.querySelectorAll('[data-tpl]').forEach((b) => b.addEventListener('click', () => { overlay.remove(); startWorkflow(b.dataset.tpl); }));
    results.querySelectorAll('[data-cap]').forEach((b) => b.addEventListener('click', () => { overlay.remove(); go({ name: 'templates', filterCap: b.dataset.cap }); }));
  };
  input.addEventListener('input', search);
  search();
}

// ---------- Dashboard ----------
async function dashboardView(root) {
  const [docs, templates, history] = await Promise.all([api.documents(), api.templates(), api.history()]);
  const active = docs.filter((d) => !d.deletedAt);
  const recent = [...active].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
  root.innerHTML = `
    <div class="dashboard-head">
      <div><p class="eyebrow">${new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      <h1 class="title">Magandang araw, ${esc((state.user.name || 'Teacher').split(' ')[0])}</h1>
      <p class="subtitle">Start a task and Maestra will only ask for what's missing.</p></div>
      <button class="button" id="dash-new">＋ New work</button>
    </div>
    <div class="stat-grid">
      <div class="stat"><span>Documents</span><strong>${active.length}</strong><small>${docs.filter((d) => d.favorite).length} favorites</small></div>
      <div class="stat"><span>This week</span><strong>${history.filter((r) => Date.now() - new Date(r.createdAt) < 7 * 864e5).length}</strong><small>AI generations</small></div>
      <div class="stat"><span>Drafts</span><strong>${active.filter((d) => d.status === 'Draft' || d.status === 'In Progress').length}</strong><small>in progress</small></div>
      <div class="stat"><span>Final</span><strong>${active.filter((d) => d.status === 'Final').length}</strong><small>ready to share</small></div>
    </div>
    <div class="dashboard-grid">
      <div style="display:grid;gap:20px">
        <section class="card"><div class="card-heading"><h2>Quick actions</h2></div>
          <div class="quick-grid">${state.capabilities.slice(0, 6).map((c) =>
            `<button class="quick" data-cap="${c.id}"><span class="q-icon">✦</span><strong>${esc(c.name)}</strong><small>Guided workflow</small></button>`).join('')}</div></section>
        <section class="card recent-panel"><div class="card-heading"><h2>Recent work</h2><button class="button ghost" data-nav-jump="documents">View all</button></div>
          <div class="work-list">${recent.length ? recent.map(workItem).join('') : `<p class="card-copy">Nothing yet. Your generated documents will appear here.</p>`}</div></section>
      </div>
      <div class="dashboard-side">
        <section class="card favorite-templates"><div class="card-heading"><h2>Templates</h2></div>
          ${templates.slice(0, 4).map((t) => `<button class="template-line" data-tpl="${t.id}"><span>▤</span><div><strong>${esc(t.name)}</strong><small>${esc(t.description)}</small></div><em>Start →</em></button>`).join('')}</section>
        <section class="card announcements-panel"><div class="card-heading"><h2>Tips</h2></div>
          <div class="tip"><span>💡</span><p>Select any text in a document to ask AI to improve, simplify, translate, or expand just that part.</p></div>
          <div class="tip" style="margin-top:10px"><span>🔗</span><p>After a lesson plan, generate a matching assessment without re-entering details.</p></div></section>
      </div>
    </div>`;
  bindCommon(root);
  root.querySelector('#dash-new').addEventListener('click', () => go({ name: 'templates' }));
}

function workItem(d) {
  return `<div class="work-item" data-doc="${d.id}" role="button" tabindex="0">
    <span class="doc-icon">📄</span>
    <div><strong>${esc(d.title)}</strong><span>${esc(d.capability)} · ${timeAgo(d.updatedAt)}</span></div></div>`;
}

function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

// ---------- Templates gallery ----------
async function templatesView(root) {
  const templates = await api.templates();
  const filterCap = state.route.filterCap;
  let filter = filterCap ? state.capabilities.find((c) => c.id === filterCap)?.name : 'All';
  root.innerHTML = `<p class="eyebrow">Guided workflows</p><h1 class="title">Templates</h1>
    <p class="subtitle">Pick a template. Maestra collects only what's missing, then generates a draft you can edit.</p>
    <div style="height:22px"></div>
    <div class="template-filter" role="tablist"><button data-f="All">All</button>${state.capabilities.map((c) => `<button data-f="${esc(c.name)}">${esc(c.name)}</button>`).join('')}</div>
    <div class="template-gallery" id="tpl-gallery"></div>`;
  const draw = () => {
    root.querySelector('#tpl-gallery').innerHTML = templates
      .filter((t) => filter === 'All' || t.capability === filter)
      .map((t) => `<article class="card template-card">
        <div class="template-art"><span aria-hidden="true">▤</span></div>
        <span class="doc-label">${esc(t.capability)}</span><h2>${esc(t.name)}</h2><p>${esc(t.description)}</p>
        <div><button class="button" data-start="${t.id}">Start workflow</button><button class="button secondary" data-info="${t.id}">Details</button></div></article>`).join('');
    root.querySelectorAll('.template-filter button').forEach((b) => {
      b.classList.toggle('active', b.dataset.f === filter);
      b.addEventListener('click', () => { filter = b.dataset.f; draw(); });
    });
    root.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', () => startWorkflow(b.dataset.start)));
    root.querySelectorAll('[data-info]').forEach((b) => b.addEventListener('click', () => {
      const t = templates.find((x) => x.id === b.dataset.info);
      modal(`<div class="modal-box"><h2>${esc(t.name)}</h2><p class="card-copy">${esc(t.description)}</p>
        <p class="card-copy"><strong>Required:</strong> ${t.requiredFields.map(esc).join(', ') || '—'}</p>
        <p class="card-copy"><strong>Optional:</strong> ${(t.optionalFields || []).map(esc).join(', ') || '—'}</p>
        <p class="card-copy"><strong>Structure:</strong> ${(t.outputStructure || []).map(esc).join(' → ')}</p>
        <div class="modal-footer"><button class="button secondary" id="m-close">Close</button><button class="button" id="m-start">Start workflow</button></div></div>`)
        .querySelector('#m-close').addEventListener('click', (e) => e.target.closest('.modal').remove());
      document.getElementById('m-start').addEventListener('click', () => { document.querySelector('.modal').remove(); startWorkflow(t.id); });
    }));
  };
  draw();
  bindCommon(root);
}

// ---------- Guided input engine ----------
async function startWorkflow(templateId, inheritedContext = {}) {
  const templates = await api.templates();
  const template = templates.find((t) => t.id === templateId);
  if (!template) return toast('That template is unavailable.');
  const profile = state.profile;

  // Determine known values from profile + inherited context; ask only for missing required fields.
  const KNOWN = {
    'Grade level': () => (profile.gradeLevels || []).join(', ') || inheritedContext.gradeLevel,
    Subject: () => (profile.subjects || []).join(', ') || inheritedContext.subject,
    'Topic / competency': () => inheritedContext.topic,
    Quarter: () => inheritedContext.quarter,
    Week: () => inheritedContext.week,
    Duration: () => profile.duration,
    Assessmenttype: () => inheritedContext.assessmentType,
    'Assessment type': () => inheritedContext.assessmentType,
  };
  const normalize = (s) => s.replace(/\s*\/\s*/g, '').toLowerCase();
  const values = {};
  const missing = [];
  for (const f of template.requiredFields) {
    const key = Object.keys(KNOWN).find((k) => normalize(k) === normalize(f));
    const val = key ? KNOWN[key]?.() : undefined;
    if (val) values[f] = val; else missing.push(f);
  }

  go({
    name: 'workflow',
    template, values, missing,
    optional: template.optionalFields || [],
    inherited: inheritedContext,
  });
}

// ---------- Competency picker (in-workflow) ----------
async function openCompetencyPicker(onPick) {
  const grades = ['All', ...Array.from({ length: 10 }, (_, i) => `Grade ${i + 1}`)];
  const subjects = ['All', 'Science', 'Mathematics', 'English', 'Filipino', 'Araling Panlipunan', 'GMRC', 'EPP/TLE', 'MAPEH', 'Reading and Literacy'];
  const overlay = modal(`<div class="modal-box" style="width:min(680px,100%);padding:0;overflow:hidden">
    <div class="search-command"><span aria-hidden="true">⌕</span>
      <input id="cp-q" placeholder="Search competencies by keyword or code…" aria-label="Search competencies">
      <button class="tool" id="cp-close" aria-label="Close">✕</button></div>
    <div style="display:flex;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line)">
      <select class="filter-select" id="cp-grade" aria-label="Grade level">${grades.map((g) => `<option${g === ((state.profile.gradeLevels || [])[0] || 'All') ? ' selected' : ''}>${g}</option>`).join('')}</select>
      <select class="filter-select" id="cp-subject" aria-label="Subject">${subjects.map((s) => `<option>All</option>`).join('')}</select>
    </div>
    <div class="command-results" id="cp-results" style="max-height:420px"></div>
    <div class="card-copy" style="padding:8px 14px;border-top:1px solid var(--line)">Source: DepEd curriculum guides (reference library). Click a competency to use it.</div>
  </div>`);
  const input = overlay.querySelector('#cp-q');
  const results = overlay.querySelector('#cp-results');
  let grade = overlay.querySelector('#cp-grade').value;
  let subject = 'All';
  // populate subject options
  const subjSel = overlay.querySelector('#cp-subject');
  subjSel.innerHTML = subjects.map((s) => `<option>${s}</option>`).join('');

  const draw = async () => {
    results.innerHTML = '<p class="empty-command">Searching…</p>';
    const params = new URLSearchParams({ grade, subject });
    if (input.value.trim()) params.set('q', input.value.trim());
    try {
      const resp = await fetch(`/api/competencies?${params}`, { credentials: 'same-origin' });
      const data = await resp.json();
      results.innerHTML = data.competencies.length ? data.competencies.map((c) => `
        <button data-code="${esc(c.code)}" data-desc="${esc(c.description)}">
          <span>📘</span><div><strong>${esc(c.description)}</strong>
          <small style="color:var(--muted)">${esc(c.code)} · ${esc(c.gradeLevel)} · ${esc(c.subject)}${c.quarterTerm ? ` · ${esc(c.quarterTerm)}` : ''}</small></div>
        </button>`).join('')
        : '<p class="empty-command">No matches. Try another keyword, grade, or subject.</p>';
      results.querySelectorAll('[data-code]').forEach((b) => b.addEventListener('click', () => {
        onPick({ code: b.dataset.code, description: b.dataset.desc });
        overlay.remove();
      }));
    } catch {
      results.innerHTML = '<p class="empty-command">Could not load competencies. Please try again.</p>';
    }
  };
  input.addEventListener('input', () => { clearTimeout(overlay._t); overlay._t = setTimeout(draw, 250); });
  overlay.querySelector('#cp-grade').addEventListener('change', (e) => { grade = e.target.value; draw(); });
  subjSel.addEventListener('change', (e) => { subject = e.target.value; draw(); });
  overlay.querySelector('#cp-close').addEventListener('click', () => overlay.remove());
  input.focus();
  draw();
}

function workflowView(root) {
  const { template, values, missing, optional, inherited } = state.route;
  const competencySuggestions = (state.profile.savedCompetencies || []);
  const datalist = competencySuggestions.length
    ? `<datalist id="competency-options">${competencySuggestions.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>` : '';
  const isCompetencyField = (f) => /competency|topic/i.test(f);
  const inputFor = (f) => `<span style="display:flex;gap:7px">
    <input id="wf-${slug(f)}" placeholder="${esc(exampleFor(f))}" ${isCompetencyField(f) && competencySuggestions.length ? 'list="competency-options"' : ''} style="flex:1">
    ${isCompetencyField(f) ? `<button type="button" class="tool" data-browse="${esc(f)}" title="Browse the DepEd competency library">Browse…</button>` : ''}
  </span>`;
  const inputs = [
    ...missing.map((f) => field(f, inputFor(f))),
    ...optional.map((f) => field(f, inputFor(f), true)),
  ];
  root.innerHTML = `
    <div class="module-layout">
      <div class="card workflow-card">
        <div class="workflow-steps">
          <span class="step active"><b>1</b> Details</span><i></i>
          <span class="step"><b>2</b> Generate</span><i></i>
          <span class="step"><b>3</b> Review &amp; edit</span>
        </div>
        <p class="eyebrow">${esc(template.capability)}</p>
        <h1 class="title" style="font-size:30px">${esc(template.name)}</h1>
        <div class="workflow-meta">
          ${Object.entries(values).map(([k, v]) => `<span class="tag">✓ ${esc(k)}: ${esc(v)}</span>`).join('')}
          ${inherited.from ? `<span class="tag">↳ From: ${esc(inherited.from)}</span>` : ''}
        </div>
        <form id="wf-form">
          ${missing.length === 0 && optional.length === 0 ? `<p class="notice">Everything needed is already known from your profile. Ready to generate.</p>` : ''}
          ${inputs.join('')}
          ${datalist}
          <div class="form-actions">
            <button type="button" class="button ghost" id="wf-back">Back</button>
            <button class="button" type="submit">Generate draft</button>
          </div>
        </form>
      </div>
      <div class="card"><div class="card-heading"><h2>How this works</h2></div>
        <div class="generation-check"><span>✓</span><div><strong>We use your saved context</strong><small>Grade levels, subjects, school, and duration come from your profile.</small></div></div>
        <div class="generation-check"><span>✓</span><div><strong>Only missing info is requested</strong><small>No giant forms.</small></div></div>
        <div class="generation-check"><span>✓</span><div><strong>Official references are never invented</strong><small>Assumptions are clearly labeled in your draft.</small></div></div>
        <div class="tip" style="margin-top:14px"><span>🔒</span><p>Avoid entering learner names. Use initials or group descriptions.</p></div>
      </div>
    </div>`;

  root.querySelector('#wf-back').addEventListener('click', () => go({ name: 'templates' }));
  root.querySelectorAll('[data-browse]').forEach((b) => b.addEventListener('click', () => {
    const fieldName = b.dataset.browse;
    openCompetencyPicker(({ code, description }) => {
      const el = document.getElementById(`wf-${slug(fieldName)}`);
      if (el) {
        el.value = `${description} (${code})`;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  }));
  root.querySelector('#wf-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const context = { ...values, capability: template.capability, template: template.name };
    missing.forEach((f) => (context[f] = document.getElementById(`wf-${slug(f)}`)?.value.trim()));
    optional.forEach((f) => { const val = document.getElementById(`wf-${slug(f)}`)?.value.trim(); if (val) context[f] = val; });
    runGenerationFlow(context, template);
  });
}

function slug(s) { return s.replace(/[^a-z0-9]/gi, '-').toLowerCase(); }
function exampleFor(f) {
  return ({ quarter: 'e.g. Quarter 2', week: 'e.g. Week 3' })[slug(f)] || `Enter ${f.toLowerCase()}`;
}

// ---------- Generation flow with progress stages ----------
async function runGenerationFlow(context, template, sourceDoc = null) {
  go({ name: 'generating', context, template });
}

function generatingView(root) {
  const { template, context } = state.route;
  const stages = ['Understanding your request', 'Preparing relevant information', 'Generating content', 'Checking the result', 'Preparing your document'];
  root.innerHTML = `<div class="card editor-card" style="max-width:720px;margin:auto">
    <div class="generation-progress">
      <span class="progress-orb" aria-hidden="true">✦</span>
      <h2>Preparing your ${esc(template.name)}</h2>
      <p class="card-copy">This usually takes one to three minutes. You can keep this tab open.</p>
      <p class="card-copy"><strong id="gen-elapsed">0:00</strong> elapsed</p>
      <div>${stages.map((s, i) => `<div class="progress-stage" data-stage="${i}">${s}…</div>`).join('')}</div>
      <div id="gen-failed"></div>
    </div></div>`;

  const stageEl = (i) => root.querySelector(`[data-stage="${i}"]`);
  const setStage = (label) => {
    let matched = stages.findIndex((s) => label.toLowerCase().includes(s.split(' ')[0].toLowerCase()) || s.toLowerCase().includes(label.toLowerCase().split('—')[0].trim()));
    if (matched === -1) matched = label.toLowerCase().includes('regenerat') ? 3 : 2;
    for (let i = 0; i < stages.length; i++) {
      const el = stageEl(i);
      el.classList.toggle('done', i < matched);
      el.classList.toggle('current', i === matched);
    }
    stageEl(matched).textContent = `${label}`;
  };
  stageEl(0).classList.add('current');

  // Elapsed timer
  const start = Date.now();
  const timer = setInterval(() => {
    const s = Math.floor((Date.now() - start) / 1000);
    const el = root.querySelector('#gen-elapsed');
    if (el) el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 1000);

  const fail = (message) => {
    clearInterval(timer);
    const area = root.querySelector('#gen-failed');
    for (let i = 0; i < stages.length; i++) { stageEl(i).classList.remove('current'); }
    area.innerHTML = `<div class="announcement" role="alert" style="text-align:left">
      <strong>We couldn't generate the document right now.</strong>
      <p>${esc(message)}</p>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="button" id="gen-retry">Try again</button>
        <button class="button secondary" id="gen-back">Back to templates</button>
      </div>
      <p class="card-copy" style="margin-top:8px">Your inputs are kept — "Try again" reuses them.</p></div>`;
    area.querySelector('#gen-retry').addEventListener('click', () => generatingView(root));
    area.querySelector('#gen-back').addEventListener('click', () => go({ name: 'templates' }));
  };

  (async () => {
    try {
      const { jobId } = await api.startGeneration({ capability: template.capability, context });
      // Poll real server-side progress.
      const poll = setInterval(async () => {
        try {
          const st = await api.generationStatus(jobId);
          if (st.stage) setStage(st.stage);
          if (st.status === 'done') {
            clearInterval(poll); clearInterval(timer);
            openWorkspaceFromResult(st.result, template, context);
          } else if (st.status === 'failed') {
            clearInterval(poll);
            fail(st.error || 'The AI service did not respond. Please try again.');
          }
        } catch (err) { /* transient poll errors: keep polling */ }
      }, 2000);
      // Safety net: stop polling after 12 minutes and report.
      setTimeout(() => {
        if (root.querySelector('#gen-elapsed')) {
          clearInterval(poll); clearInterval(timer);
          fail('This is taking unusually long. The AI service may be busy — please try again in a minute.');
        }
      }, 12 * 60_000);
    } catch (err) {
      fail(err.message);
    }
  })();
}

async function openWorkspaceFromResult(result, template, context) {
  // Save as a real document immediately so nothing is lost.
  const doc = await api.createDocument({
    title: result.title || template.name,
    capability: template.capability,
    documentType: template.name,
    status: 'In Progress',
    contentHtml: result.contentHtml,
    context,
    references: result.references || [],
    relatedWork: result.relatedWork || [],
    validation: result.validation || null,
  });
  if (result.assumptions?.length) toast(`Note: ${result.assumptions[0]}`);
  else toast('Document generated');
  go({ name: 'workspace', docId: doc.id });
}

// ---------- Document workspace ----------
async function workspaceView(root) {
  let doc;
  try { doc = await api.document(state.route.docId); } catch (err) { toast(err.message); return go({ name: 'documents' }); }

  root.innerHTML = `
    <div class="workspace-toolbar">
      <button class="button ghost" id="ws-back">← My Documents</button>
      <input class="doc-title-input" id="ws-title" value="${esc(doc.title)}" aria-label="Document title" style="flex:1;border:1px solid transparent;background:transparent">
      <span id="save-status" class="pin" role="status">Saved</span>
    </div>
    <div class="card editor-card">
      <div class="editor-toolbar">
        <div class="toolbar-actions" role="toolbar" aria-label="AI actions">
          ${['Improve', 'Rewrite', 'Simplify', 'Expand', 'Shorten', 'Translate', 'Change Tone'].map((a) => `<button class="tool" data-ai="${a}">${a}</button>`).join('')}
          <button class="tool" data-history-panel>Versions (${doc.versionCount})</button>
          <button class="tool" data-sources>Sources</button>
        </div>
        <div class="toolbar-actions">
          <button class="tool" data-export="docx">Export DOCX</button>
          <button class="tool" data-export="pdf">Export PDF</button>
          <button class="tool" onclick="window.print()">Print</button>
        </div>
      </div>
      <input class="doc-title-input" value="" tabindex="-1" aria-hidden="true" style="display:none">
      <div class="editor" id="ws-editor" contenteditable="true" aria-label="Document content">${doc.contentHtml}</div>
    </div>

    <div class="workspace-toolbar">
      <div class="card" style="flex:1;padding:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <strong style="font-size:13px">Was this useful?</strong>
        <button class="tool" data-fb="yes">👍 Helpful</button>
        <button class="tool" data-fb="no">👎 Not helpful</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:40px"><div class="card-heading"><h2>Continue related work</h2></div>
      <div class="toolbar-actions" id="related-work">
        ${(doc.relatedWork || []).map((r) => {
          const label = typeof r === 'string' ? r : r.label;
          const tpl = typeof r === 'string' ? null : r.template;
          return `<button class="button secondary" data-related="${esc(label)}" data-template="${esc(tpl || '')}">＋ ${esc(label)}</button>`;
        }).join('') || '<p class="card-copy">Generate related documents from this one without re-entering details.</p>'}
      </div>
      <div id="refine-area"></div>
    </div>`;

  const editor = root.querySelector('#ws-editor');
  const statusEl = root.querySelector('#save-status');
  let currentDoc = doc;

  const setStatus = (s) => (statusEl.textContent = s);

  // Autosave with debounce; failures keep local copy and warn.
  const scheduleSave = (source = 'edit') => {
    setStatus('Saving…');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(async () => {
      try {
        currentDoc = await api.updateDocument(doc.id, {
          title: root.querySelector('#ws-title').value.trim() || 'Untitled document',
          contentHtml: editor.innerHTML,
          source,
        });
        setStatus(`Saved · v${currentDoc.versionCount}`);
        root.querySelector('[data-history-panel]').textContent = `Versions (${currentDoc.versionCount})`;
      } catch {
        setStatus('Unable to save');
        localStorage.setItem(`draft:${doc.id}`, editor.innerHTML);
        toast("Couldn't reach the server. A local backup of your work was kept.");
      }
    }, 900);
  };

  // Draft recovery after interruption
  const localDraft = localStorage.getItem(`draft:${doc.id}`);
  if (localDraft && localDraft !== doc.contentHtml) {
    const bar = h(`<div class="announcement" role="alert"><strong>An unsaved local draft was recovered.</strong><p>You can restore it or discard it.</p>
      <div style="margin-top:8px;display:flex;gap:8px"><button class="button" id="draft-restore">Restore draft</button><button class="button ghost" id="draft-discard">Discard</button></div></div>`);
    root.querySelector('.workspace-toolbar').after(bar);
    bar.querySelector('#draft-restore').addEventListener('click', () => { editor.innerHTML = localDraft; scheduleSave('recovered draft'); bar.remove(); });
    bar.querySelector('#draft-discard').addEventListener('click', () => { localStorage.removeItem(`draft:${doc.id}`); bar.remove(); });
  }

  editor.addEventListener('input', () => scheduleSave());
  root.querySelector('#ws-title').addEventListener('input', () => scheduleSave());

  root.querySelector('#ws-back').addEventListener('click', () => go({ name: 'documents' }));

  // Contextual AI editing on selection
  root.querySelectorAll('[data-ai]').forEach((btn) => btn.addEventListener('click', async () => {
    const selection = window.getSelection();
    const selectedText = selection && !selection.isCollapsed ? selection.toString().trim() : '';
    const instructionMap = {
      Improve: 'Improve the writing quality while keeping meaning.',
      Rewrite: 'Rewrite this text freshly.',
      Simplify: 'Simplify the language.',
      Expand: 'Expand with more detail and examples.',
      Shorten: 'Make this more concise.',
      Translate: 'Translate to Filipino, keeping technical terms in English.',
      'Change Tone': 'Adjust to a professional yet warm tone.',
    };
    const area = root.querySelector('#refine-area');
    area.innerHTML = `<div class="generation-progress" style="min-height:120px;padding:26px;text-align:left">
      <span class="progress-orb" style="width:32px;height:32px;font-size:15px">✦</span> <strong>${btn.dataset.ai}…</strong>
      <div class="progress-stage current">Working on ${selectedText ? 'the selected text' : 'the document'}</div></div>`;
    try {
      const result = await api.refine({
        documentId: doc.id,
        capability: doc.capability,
        title: root.querySelector('#ws-title').value,
        contentHtml: editor.innerHTML,
        selectedText,
        selectionOnly: !!selectedText,
        instruction: instructionMap[btn.dataset.ai],
      });
      const proposal = selectedText ? result.contentHtml : stripOuterH1(result.contentHtml);
      area.innerHTML = `<div class="card" style="background:var(--mint,#f2faf7)">
        <div class="card-heading"><h2 style="font-size:15px">Proposed change</h2></div>
        <div class="editor" style="min-height:0;max-height:300px;overflow:auto;border:1px solid var(--line);border-radius:9px">${proposal}</div>
        <div class="modal-footer"><button class="button ghost" id="rf-reject">Keep original</button><button class="button" id="rf-accept">Accept change</button></div></div>`;
      area.querySelector('#rf-accept').addEventListener('click', () => {
        if (selectedText) {
          replaceSelection(editor, proposal);
        } else {
          editor.innerHTML = result.contentHtml;
        }
        area.innerHTML = '';
        scheduleSave(btn.dataset.ai);
        toast('Change applied');
      });
      area.querySelector('#rf-reject').addEventListener('click', () => (area.innerHTML = ''));
    } catch (err) {
      area.innerHTML = '';
      toast(err.message);
    }
  }));

  // Version history panel
  root.querySelector('[data-history-panel]').addEventListener('click', async () => {
    const fresh = await api.document(doc.id);
    modal(`<div class="modal-box" style="width:min(620px,100%)"><h2>Version history</h2>
      <div style="max-height:400px;overflow:auto">${fresh.versions.slice().reverse().map((v) => `
        <div class="deadline"><div class="date-chip"><b>v${v.number}</b></div>
        <div style="flex:1"><strong>${esc(v.source)}</strong><small>${new Date(v.createdAt).toLocaleString()}</small></div>
        <button class="tool" data-view="${v.id}">View</button><button class="button secondary" data-restore="${v.id}">Restore</button></div>`).join('')}
      </div><div class="modal-footer"><button class="button secondary" id="vh-close">Close</button></div></div>`);
    const m = document.querySelector('.modal');
    m.querySelector('#vh-close').addEventListener('click', () => m.remove());
    m.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
      const v = fresh.versions.find((x) => x.id === b.dataset.view);
      m.querySelector('div[style]').insertAdjacentHTML('beforeend', '');
      window.open('', '_blank')?.document.write(`<title>Version preview</title><body style="font-family:sans-serif;max-width:720px;margin:40px auto">${v.contentHtml}</body>`);
    }));
    m.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', async () => {
      try {
        currentDoc = await api.restoreVersion(doc.id, b.dataset.restore);
        editor.innerHTML = currentDoc.contentHtml;
        m.remove();
        toast(`Restored · now v${currentDoc.versionCount}`);
        root.querySelector('[data-history-panel]').textContent = `Versions (${currentDoc.versionCount})`;
      } catch (err) { toast(err.message); }
    }));
  });

  // Sources
  root.querySelector('[data-sources]').addEventListener('click', () => {
    const refs = currentDoc.references || [];
    modal(`<div class="modal-box" style="width:min(560px,100%)"><h2>Sources used</h2>
      ${refs.length ? refs.map((r) => `<div class="deadline"><div><strong>${esc(r.title)}</strong>
        <small>${esc(r.category)} · ${esc(r.type)}${r.version ? ` · v${esc(r.version)}` : ''}${r.section ? ` · ${esc(r.section)}` : ''}</small></div></div>`).join('')
        : '<p class="card-copy">This document did not materially depend on stored knowledge references.</p>'}
      <div class="modal-footer"><button class="button secondary" id="src-close">Close</button></div></div>`)
      .querySelector('#src-close').addEventListener('click', (e) => e.target.closest('.modal').remove());
  });

  // Export — real files generated server-side.
  root.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', async () => {
    scheduleSave.flush?.();
    setStatus('Saving…');
    try {
      await api.updateDocument(doc.id, { title: root.querySelector('#ws-title').value, contentHtml: editor.innerHTML, source: 'edit' });
      const blob = await api.exportDocument(doc.id, b.dataset.export);
      const url = URL.createObjectURL(blob);
      const a = h(`<a href="${url}" download="${esc(root.querySelector('#ws-title').value || 'document')}.${b.dataset.export}"></a>`);
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setStatus('Saved'); toast(`Exported as ${b.dataset.export.toUpperCase()}`);
    } catch (err) { setStatus('Unable to save'); toast(err.message); }
  }));

  // Feedback
  root.querySelectorAll('[data-fb]').forEach((b) => b.addEventListener('click', async () => {
    try { await api.feedback(doc.id, { helpful: b.dataset.fb === 'yes' }); toast('Thanks for the feedback'); } catch (e) { toast(e.message); }
  }));

  // Workflow chaining: carry context forward into the related capability's template.
  root.querySelectorAll('[data-related]').forEach((b) => b.addEventListener('click', () => {
    const tplId = b.dataset.template;
    if (!tplId) return toast('That related workflow is unavailable.');
    const ctx = { ...(currentDoc.context || {}) };
    ctx.topic = ctx['Topic / competency'] || ctx.topic;
    ctx.learningCompetency = ctx['Learning competency'] || ctx.learningCompetency;
    ctx.from = currentDoc.title;
    startWorkflow(tplId, ctx);
  }));

  bindCommon(root);
}

function replaceSelection(editor, html) {
  const sel = window.getSelection();
  if (!sel.rangeCount) { editor.insertAdjacentHTML('beforeend', html); return; }
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const frag = range.createContextualFragment(html);
  range.insertNode(frag);
}

function stripOuterH1(html) {
  return html.replace(/^<h1>[\s\S]*?<\/h1>/i, '');
}

// ---------- My Documents ----------
async function documentsView(root) {
  const all = await api.documents();
  let view = 'active'; // active | favorites | archived | trash
  let q = '';
  let sortBy = 'updated';
  let statusFilter = '';

  root.innerHTML = `<p class="eyebrow">Workspace</p>
    <div class="dashboard-head"><h1 class="title">My Documents</h1>
      <button class="button" id="docs-new">＋ New work</button></div>
    <div class="workspace-toolbar">
      <div class="search"><input id="doc-q" placeholder="Search documents…" value="${esc(q)}" aria-label="Search documents"></div>
      <select class="filter-select" id="doc-sort" aria-label="Sort by"><option value="updated">Recently updated</option><option value="created">Newest first</option><option value="title">Title A–Z</option><option value="capability">By capability</option></select>
      <select class="filter-select" id="doc-status" aria-label="Filter by status"><option value="">All statuses</option><option>Draft</option><option>In Progress</option><option>Final</option><option>Archived</option></select>
    </div>
    <div class="template-filter" role="tablist">
      <button data-v="active">Documents</button><button data-v="favorites">Favorites ★</button>
      <button data-v="archived">Archive</button><button data-v="trash">Trash</button>
    </div>
    <div class="documents" id="doc-grid"></div>`;

  const grid = root.querySelector('#doc-grid');
  const draw = () => {
    let list = all.filter((d) =>
      view === 'trash' ? !!d.deletedAt : view === 'archived' ? d.archived && !d.deletedAt : view === 'favorites' ? d.favorite && !d.deletedAt && !d.archived : !d.deletedAt && !d.archived);
    if (q) list = list.filter((d) => d.title.toLowerCase().includes(q.toLowerCase()) || (d.tags || []).some((t) => t.toLowerCase().includes(q.toLowerCase())) || d.capability.toLowerCase().includes(q.toLowerCase()));
    if (statusFilter) list = list.filter((d) => d.status === statusFilter);
    const sorters = { updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt), created: (a, b) => b.createdAt.localeCompare(a.createdAt), title: (a, b) => a.title.localeCompare(b.title), capability: (a, b) => a.capability.localeCompare(b.capability) };
    list.sort(sorters[sortBy]);
    grid.innerHTML = list.length ? list.map((d) => `
      <article class="card document-card" data-doc="${d.id}" role="button" tabindex="0">
        <button class="star" data-star="${d.id}" aria-label="Toggle favorite">${d.favorite ? '★' : '☆'}</button>
        <span class="doc-label">${esc(d.capability)}</span><h3>${esc(d.title)}</h3>
        <p>${esc(d.status)} · updated ${timeAgo(d.updatedAt)}</p>
        ${(d.tags || []).length ? `<p>${d.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join(' ')}</p>` : ''}
        <div style="display:flex;gap:6px;margin-top:11px;flex-wrap:wrap">
          ${view === 'trash'
            ? `<button class="tool" data-untrash="${d.id}">Restore</button><button class="tool" data-purge="${d.id}">Delete forever</button>`
            : `<button class="tool" data-open="${d.id}">Open</button><button class="tool" data-dupe="${d.id}">Duplicate</button><button class="tool" data-archive="${d.id}">${d.archived ? 'Unarchive' : 'Archive'}</button><button class="tool" data-trash="${d.id}">Trash</button>`}
        </div></article>`).join('')
      : `<p class="card-copy empty-preview" style="grid-column:1/-1"><span class="spark">🗂</span>No documents here yet.</p>`;

    grid.querySelectorAll('article[data-doc]').forEach((el) => el.addEventListener('click', (e) => {
      if (e.target.closest('button')) return; // action buttons handle themselves
      go({ name: 'workspace', docId: el.dataset.doc });
    }));
    grid.querySelectorAll('[data-star]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const d = all.find((x) => x.id === b.dataset.star);
      await api.updateDocument(d.id, { favorite: !d.favorite });
      d.favorite = !d.favorite; draw();
    }));
    grid.querySelectorAll('[data-dupe]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      try { const nd = await api.duplicateDocument(b.dataset.dupe); all.push(nd); toast('Duplicated'); draw(); } catch (err) { toast(err.message); }
    }));
    grid.querySelectorAll('[data-archive]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const d = all.find((x) => x.id === b.dataset.archive);
      await api.updateDocument(d.id, { archived: !d.archived, status: !d.archived ? 'Archived' : 'Draft' });
      d.archived = !d.archived; draw(); toast(d.archived ? 'Archived' : 'Moved out of archive');
    }));
    grid.querySelectorAll('[data-trash]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api.deleteDocument(b.dataset.trash);
      const d = all.find((x) => x.id === b.dataset.trash); d.deletedAt = new Date().toISOString();
      draw(); toast('Moved to trash');
    }));
    grid.querySelectorAll('[data-untrash]').forEach((b) => b.addEventListener('click', async () => {
      await api.restoreDocument(b.dataset.untrash);
      const d = all.find((x) => x.id === b.dataset.untrash); delete d.deletedAt; draw(); toast('Restored');
    }));
    grid.querySelectorAll('[data-purge]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Permanently delete this document? This cannot be undone.')) return;
      await api.deleteDocument(b.dataset.purge, true);
      all = all.filter((x) => x.id !== b.dataset.purge); draw(); toast('Deleted permanently');
    }));
  };

  root.querySelectorAll('[data-v]').forEach((b) => {
    b.classList.toggle('active', b.dataset.v === 'active');
    b.addEventListener('click', () => {
      view = b.dataset.v;
      root.querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('active', x === b));
      draw();
    });
  });
  root.querySelector('#doc-q').addEventListener('input', (e) => { q = e.target.value; draw(); });
  root.querySelector('#doc-sort').addEventListener('change', (e) => { sortBy = e.target.value; draw(); });
  root.querySelector('#doc-status').addEventListener('change', (e) => { statusFilter = e.target.value; draw(); });

  root.querySelector('#docs-new').addEventListener('click', () => go({ name: 'templates' }));
  draw();
  bindCommon(root);
}

// ---------- History / Settings / Help ----------
async function historyView(root) {
  const requests = await api.history();
  root.innerHTML = `<p class="eyebrow">Activity</p><h1 class="title">AI Generation History</h1>
    <p class="subtitle">What you generated and when. Internal system details are never shown.</p><div style="height:20px"></div>
    <div class="card">${requests.length ? requests.map((r) => `<div class="deadline">
      <div class="date-chip"><b>${new Date(r.createdAt).getDate()}</b>${new Date(r.createdAt).toLocaleString('en', { month: 'short' })}</div>
      <div style="flex:1"><strong>${esc(r.title || r.capability)}</strong><small>${esc(r.capability)} · ${new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${r.validation ? ` · validation: ${esc(r.validation)}` : ''}</small></div>
      ${r.documentId ? `<button class="button secondary" data-doc="${r.documentId}">Open</button>` : ''}</div>`).join('')
      : '<p class="card-copy">No generations yet.</p>'}</div>`;
  root.querySelectorAll('[data-doc]').forEach((b) => b.addEventListener('click', () => go({ name: 'workspace', docId: b.dataset.doc })));
  bindCommon(root);
}

async function settingsView(root) {
  const tab = state.route.tab || 'profile';
  root.innerHTML = `<h1 class="title">Settings</h1><div style="height:20px"></div>
    <div class="settings-grid"><div class="settings-tabs" role="tablist">
      ${[['profile', 'Teaching profile'], ['competencies', 'Competency reference'], ['account', 'Account'], ['privacy', 'Privacy']].map(([id, label]) =>
        `<button data-tab="${id}" class="${tab === id ? 'active' : ''}">${label}</button>`).join('')}
    </div><div id="settings-body" class="card"></div></div>`;

  const body = root.querySelector('#settings-body');
  if (tab === 'profile') {
    const p = state.profile;
    body.innerHTML = `<h2>Teaching profile</h2><p class="card-copy">Maestra uses this so workflows don't ask again. You can disable its use below.</p>
      <form id="pf-form" style="margin-top:15px">
        <label style="font-weight:600;font-size:13px;display:flex;gap:8px;align-items:center;margin-bottom:14px">
          <input type="checkbox" id="pf-context" ${p.contextEnabled !== false ? 'checked' : ''} style="width:auto"> Let AI use my profile context when generating
        </label>
        ${field('Name', `<input id="pf-name" value="${esc(state.user.name)}">`)}
        ${field('Position', `<input id="pf-position" value="${esc(p.position || '')}">`)}
        <div class="form-row">
          ${field('Grade level(s)', `<input id="pf-grades" value="${esc((p.gradeLevels || []).join(', '))}">`)}
          ${field('Subject(s)', `<input id="pf-subjects" value="${esc((p.subjects || []).join(', '))}">`)}
        </div>
        ${field('School', `<input id="pf-school" value="${esc(p.school || '')}">`)}
        <div class="form-row">
          ${field('Division', `<input id="pf-division" value="${esc(p.division || '')}">`)}
          ${field('Region', `<input id="pf-region" value="${esc(p.region || '')}">`)}
        </div>
        ${field('Preferred language', `<input id="pf-language" value="${esc(p.language || '')}">`)}
        ${field('Common class duration', `<input id="pf-duration" value="${esc(p.duration || '')}">`)}
        ${field('Teaching preferences', `<textarea id="pf-preferences">${esc(p.preferences || '')}</textarea>`, true)}
        <button class="button" type="submit">Save profile</button>
      </form>`;
    body.querySelector('#pf-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const g = (id) => body.querySelector(`#${id}`).value.trim();
      try {
        const r = await api.saveProfile({
          contextEnabled: body.querySelector('#pf-context').checked,
          name: g('pf-name'), position: g('pf-position'),
          gradeLevels: splitCsv(g('pf-grades')), subjects: splitCsv(g('pf-subjects')),
          school: g('pf-school'), division: g('pf-division'), region: g('pf-region'),
          language: g('pf-language'), duration: g('pf-duration'), preferences: g('pf-preferences'),
        });
        state.profile = r.profile; state.user.name = g('pf-name');
        toast('Profile updated');
      } catch (err) { toast(err.message); }
    });
  } else if (tab === 'competencies') {
    competenciesTab(body);
  } else if (tab === 'privacy') {
    body.innerHTML = `<h2>Privacy</h2>
      <p class="card-copy">Documents are private to your account. Server-side ownership checks are enforced on every request.</p>
      <p class="card-copy">Avoid entering learner personally identifying information; drafts are instructed to use initials or groups.</p>
      <p class="card-copy">Deleted documents stay in Trash until permanently removed. Version history belongs to each document and is removed with it.</p>
      <p class="card-copy">You can disable AI use of your profile context under Teaching profile.</p>`;
  } else {
    body.innerHTML = `<h2>Account</h2>
      <div class="info-grid" style="grid-template-columns:1fr">
        <div><small>Email</small><strong>${esc(state.user.email)}</strong></div>
        <div><small>Role</small><strong>${esc(state.user.role)}</strong></div>
        <div><small>Password</small><strong>Changed via sign-in screen reset</strong></div>
      </div>`;
  }
  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => go({ name: 'settings', tab: b.dataset.tab })));
  bindCommon(root);
}

// ---------- Competency reference library ----------
async function competenciesTab(body) {
  const grades = ['All', ...Array.from({ length: 10 }, (_, i) => `Grade ${i + 1}`)];
  const subjects = ['All', 'Science', 'Mathematics', 'English', 'Filipino', 'Araling Panlipunan', 'GMRC', 'EPP/TLE', 'MAPEH'];
  const saved = new Set(state.profile.savedCompetencies || []);
  let grade = (state.profile.gradeLevels || [])[0] || 'All';
  let subject = 'All';
  let q = '';

  body.innerHTML = `<h2>DepEd learning competencies</h2>
    <p class="card-copy" id="comp-source">Loading official curriculum reference…</p>
    <div class="workspace-toolbar" style="margin:12px 0">
      <div class="search"><input id="comp-q" placeholder="Search keyword or code (e.g. water cycle, S6ES)" aria-label="Search competencies"></div>
      <select class="filter-select" id="comp-grade" aria-label="Grade level">${grades.map((g) => `<option${g === grade ? ' selected' : ''}>${g}</option>`).join('')}</select>
      <select class="filter-select" id="comp-subject" aria-label="Subject">${subjects.map((s) => `<option${s === subject ? ' selected' : ''}>${s}</option>`).join('')}</select>
    </div>
    <div id="comp-list"></div>`;

  const draw = async () => {
    const params = new URLSearchParams({ grade, subject });
    if (q) params.set('q', q);
    const resp = await fetch(`/api/competencies?${params}`, { credentials: 'same-origin' });
    if (!resp.ok) { body.querySelector('#comp-list').innerHTML = '<p class="card-copy">Could not load the competency reference.</p>'; return; }
    const data = await resp.json();
    body.querySelector('#comp-source').textContent = `Source: ${data.source}. Saved references appear as suggestions in every workflow.`;
    const list = data.competencies;
    body.querySelector('#comp-list').innerHTML = list.length ? list.map((c) => `
      <div class="deadline"><div style="flex:1">
        <strong>${esc(c.description)}</strong>
        <small>${esc(c.code)} · ${esc(c.gradeLevel)} · ${esc(c.subject)}${c.quarterTerm ? ` · ${esc(c.quarterTerm)}` : ''}</small>
      </div>${saved.has(c.code)
        ? '<span class="tag">✓ Saved</span>'
        : `<button class="tool" data-save="${esc(c.code)}">Save</button>`}</div>`).join('')
      : '<p class="card-copy empty-preview">No competencies match. Try a different grade, subject, or keyword.</p>';
    body.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', async () => {
      const response = await fetch('/api/competencies', {
        method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ codes: [b.dataset.save] }),
      });
      if (response.ok) { saved.add(b.dataset.save); state.profile.savedCompetencies = [...saved]; toast('Saved to your profile'); draw(); }
      else toast('Could not save. Please try again.');
    }));
  };

  body.querySelector('#comp-q').addEventListener('input', (e) => { q = e.target.value.trim(); clearTimeout(body._t); body._t = setTimeout(draw, 250); });
  body.querySelector('#comp-grade').addEventListener('change', (e) => { grade = e.target.value; draw(); });
  body.querySelector('#comp-subject').addEventListener('change', (e) => { subject = e.target.value; draw(); });
  await draw();
}

// ---------- Admin ----------
async function adminView(root) {
  let ov;
  try { ov = await (await fetch('/api/admin/overview', { credentials: 'same-origin' })).json(); }
  catch { root.innerHTML = '<p class="card-copy">Admin access required.</p>'; return; }
  if (ov.error) { root.innerHTML = `<div class="card"><p class="card-copy">${esc(ov.error)}</p></div>`; return; }

  root.innerHTML = `<p class="eyebrow">Administration</p><h1 class="title">System management</h1>
    <p class="subtitle">Manage the competency library, knowledge references, and templates. Changes apply to all teachers.</p>
    <div class="stat-grid">
      <div class="stat"><span>Users</span><strong>${ov.users}</strong></div>
      <div class="stat"><span>Competencies</span><strong>${ov.competencyCount}</strong></div>
      <div class="stat"><span>Templates</span><strong>${ov.templates.length}</strong></div>
      <div class="stat"><span>Custom knowledge</span><strong>${ov.knowledge.length}</strong></div>
    </div>

    <section class="card" style="margin-bottom:20px"><div class="card-heading"><h2>Import learning competencies</h2></div>
      <p class="card-copy">Paste JSON or CSV rows. CSV format: <code>code, grade, subject, description, quarter</code> — one per line. Duplicates by code are skipped.</p>
      <textarea id="adm-import" style="min-height:160px;font-family:ui-monospace,monospace" placeholder='S6ES-IVa-8, Grade 6, Science, Describe the water cycle and its importance, Q4
S6MT-Ia-c-1, Grade 6, Science, Describe mixtures and compounds, Q1'></textarea>
      <div style="margin-top:12px;display:flex;gap:10px;align-items:center">
        <button class="button" id="adm-do-import">Import</button><span id="adm-import-result" class="card-copy"></span>
      </div></section>

    <section class="card" style="margin-bottom:20px"><div class="card-heading"><h2>Knowledge references</h2></div>
      <div id="adm-knowledge">${ov.knowledge.map((k) => `
        <div class="deadline"><div style="flex:1"><strong>${esc(k.title)}</strong><small>${esc(k.category)} · ${esc(k.type)} · v${esc(k.version || '1')} ${k.active === false ? '· inactive' : ''}</small></div>
        <button class="tool" data-ktoggle="${esc(k.id)}" data-active="${k.active !== false}">${k.active === false ? 'Activate' : 'Deactivate'}</button></div>`).join('') || '<p class="card-copy">No custom references yet. Add one below.</p>'}</div>
      <details style="margin-top:14px"><summary style="cursor:pointer;font-weight:600">Add a knowledge reference</summary>
        <form id="adm-kform" style="margin-top:12px">
          ${field('Title', `<input id="ak-title" required>`)}
          <div class="form-row">
            ${field('Category', `<select id="ak-cat"><option>Official DepEd References</option><option>Educational Best Practices</option><option>Professional Standards</option><option>Promotion</option><option>Administrative References</option><option>Curriculum</option><option>Templates</option><option>Terminology</option></select>`)}
            ${field('Type', `<select id="ak-type"><option>OFFICIAL REQUIREMENT</option><option>RECOMMENDATION</option><option>EXAMPLE</option><option>ASSUMPTION</option></select>`)}
          </div>
          ${field('Text shown to the AI', `<textarea id="ak-text" required></textarea>`)}
          <button class="button" type="submit">Add reference</button>
        </form></details></section>

    <section class="card" style="margin-bottom:40px"><div class="card-heading"><h2>Templates</h2></div>
      ${ov.templates.map((t) => `
        <div class="deadline"><div style="flex:1"><strong>${esc(t.name)}</strong><small>${esc(t.capability)} · v${esc(t.version)}${t.active === false ? ' · inactive' : ''}</small></div>
        <button class="tool" data-ttoggle="${esc(t.id)}" data-active="${t.active !== false}">${t.active === false ? 'Activate' : 'Deactivate'}</button></div>`).join('')}
      <p class="card-copy" style="margin-top:10px">Deactivating hides a template from teachers without deleting anything.</p></section>`;

  const importBtn = root.querySelector('#adm-do-import');
  importBtn.addEventListener('click', async () => {
    const text = root.querySelector('#adm-import').value;
    const out = root.querySelector('#adm-import-result');
    importBtn.disabled = true;
    try {
      const resp = await fetch('/api/admin/competencies/import', {
        method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ text }),
      });
      const data = await resp.json();
      out.textContent = resp.ok ? `✓ Imported ${data.added} new competencies (${data.total} total)` : data.error;
      if (resp.ok) root.querySelector('#adm-import').value = '';
    } catch { out.textContent = 'Import failed. Please try again.'; }
    importBtn.disabled = false;
  });

  const toggle = async (url, bodyData) => {
    const resp = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(bodyData) });
    if (resp.ok) adminView(root); else toast((await resp.json()).error || 'Action failed.');
  };
  root.querySelectorAll('[data-ktoggle]').forEach((b) => b.addEventListener('click', () =>
    toggle('/api/admin/knowledge/update', { id: b.dataset.ktoggle, active: b.dataset.active === 'false' })));
  root.querySelectorAll('[data-ttoggle]').forEach((b) => b.addEventListener('click', () =>
    toggle('/api/admin/templates/update', { id: b.dataset.ttoggle, active: b.dataset.active === 'false' })));

  root.querySelector('#adm-kform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const g = (id) => root.querySelector(`#${id}`).value.trim();
    const resp = await fetch('/api/admin/knowledge', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ title: g('ak-title'), category: g('ak-cat'), type: g('ak-type'), text: g('ak-text'), version: '1.0' }),
    });
    if (resp.ok) { toast('Reference added'); adminView(root); } else toast((await resp.json()).error);
  });
}

function helpView(root) {
  root.innerHTML = `<h1 class="title">Help center</h1><div style="height:20px"></div>
    <div class="faq">
      <details><summary>How do I create a lesson plan?</summary><p>Pick Templates → Daily Lesson Log. Your grade level and subject are filled from your profile automatically; you'll only be asked for what's missing.</p></details>
      <details><summary>Can AI edit part of my document?</summary><p>Yes. Select text in the editor, then choose an action such as Improve, Simplify, or Translate. You always confirm before changes are applied.</p></details>
      <details><summary>Are my documents private?</summary><p>Yes. Only your account can access them, verified server-side on every request.</p></details>
      <details><summary>Does Maestra invent DepEd requirements?</summary><p>No. Official references are only used when available; anything uncertain is labeled as an assumption.</p></details>
    </div>`;
  bindCommon(root);
}

// ---------- Render dispatch ----------
function bindCommon(root) {
  root.querySelectorAll('[data-nav-jump]').forEach((b) => b.addEventListener('click', () => go({ name: b.dataset.navJump })));
  root.querySelectorAll('.work-item[data-doc]').forEach((el) => el.addEventListener('click', () => go({ name: 'workspace', docId: el.dataset.doc })));
  root.querySelectorAll('[data-tpl]').forEach((b) => b.addEventListener('click', () => startWorkflow(b.dataset.tpl)));
  root.querySelectorAll('[data-cap]').forEach((b) => b.addEventListener('click', () => go({ name: 'templates', filterCap: b.dataset.cap })));
}

async function render() {
  if (!state.user) return authScreen();
  const route = state.route;
  const root = document.createElement('div');
  try {
    if (route.name === 'dashboard') { shell('', 'Dashboard'); await dashboardView(document.getElementById('page-root')); }
    else if (route.name === 'templates') { shell('', 'Templates'); await templatesView(document.getElementById('page-root')); }
    else if (route.name === 'workflow') { shell('', 'Guided workflow'); workflowView(document.getElementById('page-root')); }
    else if (route.name === 'generating') { shell('', 'Generating'); generatingView(document.getElementById('page-root')); }
    else if (route.name === 'workspace') { shell('', 'Document workspace'); await workspaceView(document.getElementById('page-root')); }
    else if (route.name === 'documents') { shell('', 'My Documents'); await documentsView(document.getElementById('page-root')); }
    else if (route.name === 'history') { shell('', 'AI History'); await historyView(document.getElementById('page-root')); }
    else if (route.name === 'settings') { shell('', 'Settings'); await settingsView(document.getElementById('page-root')); }
    else if (route.name === 'admin') { shell('', 'Admin'); await adminView(document.getElementById('page-root')); }
    else if (route.name === 'help') { shell('', 'Help'); helpView(document.getElementById('page-root')); }
    else { shell('', 'Dashboard'); await dashboardView(document.getElementById('page-root')); }
  } catch (err) {
    console.error(err);
    if (err.status === 401) { state.user = null; return authScreen(); }
    document.getElementById('page-root').innerHTML = `<div class="card" style="max-width:520px;margin:60px auto;text-align:center;padding:40px">
      <h2 style="font:700 22px Fraunces,serif">Something went wrong</h2>
      <p class="card-copy" style="margin:12px 0 20px">${esc(err.message || "We couldn't load this page. Your work has been saved.")}</p>
      <button class="button" id="retry-btn">Go to Dashboard</button></div>`;
    document.getElementById('retry-btn').addEventListener('click', () => go({ name: 'dashboard' }));
  }
}

// ---------- Init ----------
(async function init() {
  try {
    const me = await api.me();
    state.user = me.user;
    state.profile = me.profile;
    state.capabilities = await api.capabilities();
    if (!state.profile.onboardingComplete) return onboardingScreen(0);
    go({ name: 'dashboard' });
  } catch {
    // Landing page links here with #register to go straight to account creation.
    authScreen(location.hash === '#register' ? 'register' : 'login');
  }
})();
