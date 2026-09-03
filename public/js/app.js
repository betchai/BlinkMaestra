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
function authScreen(mode = 'login', prefillToken = '') {
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
           ${field('Password', `<input type="password" id="f-password" required minlength="8" autocomplete="new-password">`)}
           ${field('Confirm password', `<input type="password" id="f-confirm" required minlength="8" autocomplete="new-password">`)}
           <p class="notice">Use at least 8 characters.</p>
           <button class="button" type="submit" style="width:100%">Create account</button>
           <div class="form-actions"><button type="button" class="button ghost" data-mode="login">I already have an account</button></div>`
        : isReset
          ? `${field('Email', `<input type="email" id="f-email" required>`)}<p class="notice">If the account exists, a reset link will be issued. Ask your administrator for access in this environment.</p>
             <button class="button" type="submit" style="width:100%">Send reset request</button>
             <div class="form-actions"><button type="button" class="button ghost" data-mode="login">Back to sign in</button></div>`
          : `${field('New password', `<input type="password" id="f-password" required minlength="8">`)}
             ${field('Reset token', `<input id="f-token" required value="${esc(prefillToken)}">`, true)}
             <button class="button" type="submit" style="width:100%">Set new password</button>
             <div class="form-actions"><button type="button" class="button ghost" data-mode="login">Back to sign in</button></div>`;

  app.innerHTML = '';
  const page = h(`<div class="auth-page page" style="display:grid;place-items:center;min-height:100vh">
    <div class="card auth-card" style="width:min(430px,100%);padding:30px">
      <a class="brand" href="/" style="margin-bottom:18px;color:var(--forest);text-decoration:none"><img class="brand-logo" src="/logo.png" alt="BLinkMaestra" /><div><strong style="color:var(--ink)">BLinkMaestra</strong><small>Your teaching copilot</small></div></a>
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
        if (v('f-password') !== v('f-confirm')) {
          toast('Passwords do not match. Try again.');
          return;
        }
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

// First-time magic-link sign-ins land here to create their password. This
// "activates" the account; from now on they sign in with email + password.
function passwordSetupScreen(user) {
  app.innerHTML = '';
  const email = user?.email || '';
  const page = h(`<div class="auth-page page" style="display:grid;place-items:center;min-height:100vh">
    <div class="card auth-card" style="width:min(430px,100%);padding:30px">
      <a class="brand" href="/" style="margin-bottom:18px;color:var(--forest);text-decoration:none"><img class="brand-logo" src="/logo.png" alt="BLinkMaestra" /><div><strong style="color:var(--ink)">BLinkMaestra</strong><small>Your teaching copilot</small></div></a>
      <h1 style="font:700 24px Fraunces,serif;margin:0 0 8px">Set your password</h1>
      <p class="card-copy" style="margin:0 0 16px">Welcome${email ? ' ' + esc(email) : ''}! This is your first sign-in. Create a password — you'll use your email and this password on every future visit.</p>
      <form id="pw-setup-form">
        ${field('Full name', `<input id="ps-name" autocomplete="name">`)}
        ${field('Password', `<input type="password" id="ps-password" required minlength="8" autocomplete="new-password">`)}
        ${field('Confirm password', `<input type="password" id="ps-confirm" required minlength="8" autocomplete="new-password">`)}
        <p class="notice">Use at least 8 characters.</p>
        <button class="button" type="submit" style="width:100%">Continue</button>
      </form>
    </div></div>`);
  app.appendChild(page);

  document.getElementById('pw-setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (id) => document.getElementById(id)?.value.trim();
    const pw = v('ps-password');
    if (pw !== v('ps-confirm')) return toast('Passwords do not match.');
    try {
      const r = await api.setPassword({ password: pw, name: v('ps-name') });
      state.user = r.user;
      state.profile = r.profile;
      state.capabilities = await api.capabilities();
      if (!state.profile.onboardingComplete) return onboardingScreen(0);
      go({ name: 'dashboard' });
    } catch (err) {
      toast(err.message);
    }
  });
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
      <a class="brand" href="/" title="BLinkMaestra home" style="text-decoration:none;color:inherit"><img class="brand-logo" src="/logo.png" alt="BLinkMaestra" /><div><strong>BLinkMaestra</strong><small>Teacher workspace</small></div></a>
      <nav class="nav" aria-label="Main navigation">${navItems.map(([id, icon, label]) =>
        `<button data-nav="${id}" class="${state.route.name === id ? 'active' : ''}"><span class="symbol">${icon}</span><span>${label}</span></button>`).join('')}</nav>
      <div class="sidebar-footer"><button id="logout-btn"><span class="symbol">↵</span><span>Sign out</span></button></div>
    </aside>
    <main class="main">
      <header class="topbar">
        <div class="crumb">${crumb}</div>
        <div class="top-actions">
          <button class="global-search" id="global-search" aria-label="Global search">⌕ Search everything <kbd>/</kbd></button>
          <button class="icon-btn" id="theme-btn" aria-label="Toggle dark mode">◐</button>
          <button class="avatar" id="profile-btn" title="Your teaching profile" aria-label="Your teaching profile">${initials}</button>
        </div>
      </header>
      <div class="page" id="page-root">${contentHtml}</div>
    </main></div>`));

  app.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => go({ name: b.dataset.nav })));
  document.getElementById('logout-btn').addEventListener('click', async () => { await api.logout(); state.user = null; authScreen(); });
  document.getElementById('theme-btn').addEventListener('click', () => document.body.classList.toggle('dark'));
  document.getElementById('profile-btn').addEventListener('click', () => go({ name: 'settings', tab: 'profile' }));
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
  const overlay = modal(`<div class="modal-box"><div class="search-command"><span aria-hidden="true">⌕</span><input id="gs-input" placeholder="Search documents, templates, capabilities…" aria-label="Search"></div><div class="command-results" id="gs-results"></div></div>`, 'search-modal');
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
    const tplIcon = {
      'deped-015-tos': '📋', 'tos-v3': '🧬', 'ilaw': '📘', 'assessment': '📝',
      'activity-sheet': '✏️', 'parent-advisory': '💬', 'accomplishment-report': '🏅',
      'ppst-reflection': '💡', 'classroom-plan': '🧭', 'program-plan': '🗓️',
    };
    root.querySelector('#tpl-gallery').innerHTML = templates
      .filter((t) => filter === 'All' || t.capability === filter)
      .map((t) => `<article class="card template-card">
        <div class="template-art"><span aria-hidden="true">${tplIcon[t.id] || '▤'}</span></div>
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
  const useProfileContext = profile.contextEnabled !== false;

  // Determine known values from profile + inherited context; ask only for missing required fields.
  const KNOWN = {
    'Grade level': () => (useProfileContext && (profile.gradeLevels || []).join(', ')) || inheritedContext.gradeLevel,
    Subject: () => (useProfileContext && (profile.subjects || []).join(', ')) || inheritedContext.subject,
    'Subject / learning area': () => (useProfileContext && (profile.subjects || []).join(', ')) || inheritedContext.subject,
    'Competencies with teaching days': () => inheritedContext.competencies,
    'Number of items': () => inheritedContext.numberOfItems,
    'Item format': () => inheritedContext.itemFormat,
    Term: () => inheritedContext.term || inheritedContext.quarter,
    'Topic / competency': () => inheritedContext.topic,
    Quarter: () => inheritedContext.quarter,
    Week: () => inheritedContext.week,
    Duration: () => useProfileContext ? profile.duration : undefined,
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
  const overlay = modal(`<div class="modal-box" style="width:min(680px,100%)">
    <div class="search-command"><span aria-hidden="true">⌕</span>
      <input id="cp-q" placeholder="Search competencies by keyword or code…" aria-label="Search competencies">
      <button class="tool" id="cp-close" aria-label="Close">✕</button></div>
    <div style="display:flex;gap:8px;padding:10px 25px;border-bottom:1px solid var(--line)">
      <select class="filter-select" id="cp-grade" aria-label="Grade level">${grades.map((g) => `<option${g === ((state.profile.gradeLevels || [])[0] || 'All') ? ' selected' : ''}>${g}</option>`).join('')}</select>
      <select class="filter-select" id="cp-subject" aria-label="Subject">${subjects.map((s) => `<option>All</option>`).join('')}</select>
    </div>
    <div class="command-results" id="cp-results" style="max-height:420px"></div>
    <div class="card-copy" style="padding:8px 25px;border-top:1px solid var(--line)">Source: DepEd curriculum guides (reference library). Click a competency to use it.</div>
  </div>`, 'search-modal');
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
  const isTos = template.id === 'deped-015-tos' || template.id === 'tos-v3';
  let savedCompetencyList = [];
  const tosSelects = {
    'Assessment type': ['Summative Test 1', 'Summative Test 2', 'Full Assessment'],
    'Item format': ['Multiple Choice', 'True/False', 'Matching', 'Mixed'],
  };
  const tosCompetencyDatalist = (id) => `<datalist id="${id}">${savedCompetencyList.map((c) => `<option value="${esc(`${c.description} (${c.code})`)}"></option>`).join('')}</datalist>`;
  const inputFor = (f) => `<span style="display:flex;gap:7px">
    ${isTos && f === 'Competencies with teaching days' ? `<span id="wf-tos-competencies" style="display:grid;gap:8px;flex:1">${isTos
        ? `<span class="tos-row" style="display:flex;gap:7px;align-items:center;flex-wrap:wrap;position:relative">
             <input class="tos-name" list="tos-competency-options" placeholder="Select or type a competency…" style="flex:1">
             <button type="button" class="tool tos-browse" title="Browse the DepEd competency library">Browse…</button>
             <button type="button" class="tool tos-remove" title="Remove competency">X</button>
             <input class="tos-days" type="number" min="1" step="1" placeholder="Days taught" style="width:110px">
           </span>${tosCompetencyDatalist('tos-competency-options')}${tosCompetencyDatalist('tos-competency-options-add')}`
        : `<span class="tos-row" style="display:flex;gap:7px"><input class="tos-name" placeholder="Competency taught" style="flex:1"><button type="button" class="tool tos-remove" title="Remove competency">X</button><input class="tos-days" type="number" min="1" step="1" placeholder="Days taught" style="width:110px"></span>`}
        <button type="button" class="tool" id="tos-add" style="justify-self:start">+ Add competency</button>
      </span>`
    : isTos && tosSelects[f] ? `<select id="wf-${slug(f)}" style="flex:1">${tosSelects[f].map((o) => `<option>${o}</option>`).join('')}</select>`
    : `<input id="wf-${slug(f)}" placeholder="${esc(exampleFor(f))}" ${isCompetencyField(f) && competencySuggestions.length ? 'list="competency-options"' : ''} style="flex:1">`}
    ${isCompetencyField(f) && !(isTos && f === 'Competencies with teaching days') ? `<button type="button" class="tool" data-browse="${esc(f)}" title="Browse the DepEd competency library">Browse…</button>` : ''}
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
  if (isTos) {
    const list = root.querySelector('#wf-tos-competencies');
    const savedCodes = competencySuggestions;
    let savedCompetencyMap = {};
    if (isTos && savedCodes.length) {
      fetch('/api/competencies', { credentials: 'same-origin' })
        .then((r) => r.json())
        .then((data) => {
          savedCompetencyMap = Object.fromEntries(data.competencies.filter((c) => savedCodes.includes(c.code)).map((c) => [c.code, c]));
          const opts = Object.values(savedCompetencyMap).map((c) => `<option value="${esc(`${c.description} (${c.code})`)}"></option>`).join('');
          const dl = list.querySelector('#tos-competency-options');
          if (dl) dl.innerHTML = opts;
          const dlAdd = list.querySelector('#tos-competency-options-add');
          if (dlAdd) dlAdd.innerHTML = opts;
        })
        .catch(() => {});
    }
    function buildTosRowHtml() {
      if (isTos) {
        return `<span class="tos-row" style="display:flex;gap:7px;align-items:center;flex-wrap:wrap;position:relative">
          <input class="tos-name" list="tos-competency-options-add" placeholder="Select or type a competency…" style="flex:1">
          <button type="button" class="tool tos-browse" title="Browse the DepEd competency library">Browse…</button>
          <button type="button" class="tool tos-remove" title="Remove competency">X</button>
          <input class="tos-days" type="number" min="1" step="1" placeholder="Days taught" style="width:110px">
        </span>`;
      }
      return `<span class="tos-row" style="display:flex;gap:7px"><input class="tos-name" placeholder="Competency taught" style="flex:1"><button type="button" class="tool tos-remove" title="Remove competency">X</button><input class="tos-days" type="number" min="1" step="1" placeholder="Days taught" style="width:110px"></span>`;
    }
    list?.addEventListener('click', (e) => {
      if (e.target.matches('.tos-remove') && list.querySelectorAll('.tos-row').length > 1) e.target.closest('.tos-row').remove();
      if (e.target.matches('.tos-browse')) {
        const row = e.target.closest('.tos-row');
        const input = row?.querySelector('.tos-name');
        openCompetencyPicker(({ code, description }) => {
          if (input) {
            input.value = `${description} (${code})`;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        });
      }
    });
    root.querySelector('#tos-add')?.addEventListener('click', () => {
      const row = document.createElement('span');
      row.innerHTML = buildTosRowHtml();
      list.insertBefore(row.firstElementChild, root.querySelector('#tos-add'));
    });
  }
  root.querySelector('#wf-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const context = { ...values, capability: template.capability, template: template.name };
    missing.forEach((f) => (context[f] = document.getElementById(`wf-${slug(f)}`)?.value.trim()));
    optional.forEach((f) => { const val = document.getElementById(`wf-${slug(f)}`)?.value.trim(); if (val) context[f] = val; });
    if (isTos) {
      const rows = [...root.querySelectorAll('.tos-row')].map((row) => {
        const compName = row.querySelector('.tos-name')?.value.trim() || '';
        return `${compName} ${row.querySelector('.tos-days')?.value} days`;
      }).filter((row) => {
        const daysMatch = row.match(/(\d+)\s+days$/);
        const hasDays = daysMatch && Number(daysMatch[1]) > 0;
        const name = row.replace(/\s+\d+\s+days$/, '').trim();
        return hasDays && name && !name.startsWith('undefined');
      });
      if (!rows.length) { toast('Add at least one competency and teaching-day count.'); return; }
      context['Competencies with teaching days'] = rows.join('; ');
    }
    runGenerationFlow(context, template);
  });
}

function slug(s) { return s.replace(/[^a-z0-9]/gi, '-').toLowerCase(); }
function exampleFor(f) {
  const slugged = slug(f);
  return ({
    quarter: 'e.g. Quarter 2', week: 'e.g. Week 3',
    'difficulty-distribution': 'e.g. 60/30/10 (Easy/Average/Difficult)',
    'cognitive-distribution': 'e.g. R15 U15 Ap10 An10 E5 C5',
  })[slugged] || `Enter ${f.toLowerCase()}`;
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
      if (err.code === 'subscription_required') return go({ name: 'paywall' });
      fail(err.message);
    }
  })();
}

async function openWorkspaceFromResult(result, template, context) {
  // Save as a real document immediately so nothing is lost.
  const savedContext = result.blueprint
    ? { ...context, blueprintV3: result.blueprint }
    : context;
  const doc = await api.createDocument({
    title: result.title || template.name,
    capability: template.capability,
    documentType: template.name,
    status: 'In Progress',
    contentHtml: result.contentHtml,
    context: savedContext,
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
  try { doc = await api.document(state.route.docId); } catch (err) { if (err.code === 'subscription_required') return go({ name: 'paywall' }); toast(err.message); return go({ name: 'documents' }); }

  root.innerHTML = `
    <div class="workspace-toolbar">
      <button class="button ghost" id="ws-back">← My Documents</button>
      <input class="doc-title-input" id="ws-title" value="${esc(doc.title)}" aria-label="Document title" style="flex:1;border:1px solid transparent;background:transparent">
      <span id="save-status" class="pin" role="status">${doc.status === 'Final' ? 'Final · locked' : 'Saved'}</span>
    </div>
    ${doc.status === 'Final' ? `<div class="announcement" role="alert" style="margin-bottom:14px"><strong>✎ This document is marked final and locked.</strong><p>It is read‑only so it can’t be changed by accident. Use “Edit anyway” to make changes (this returns it to a draft).</p>
      <div style="margin-top:10px"><button class="button" id="ws-unlock">Edit anyway · unlock</button></div></div>` : ''}
    <div class="card editor-card">
      <div class="editor-toolbar">
        <div class="toolbar-actions" role="toolbar" aria-label="AI actions">
          ${['Improve', 'Rewrite', 'Simplify', 'Expand', 'Shorten', 'Translate', 'Change Tone'].map((a) => `<button class="tool" data-ai="${a}" ${doc.status === 'Final' ? 'disabled' : ''}>${a}</button>`).join('')}
          <button class="tool" data-history-panel>Versions (${doc.versionCount})</button>
          <button class="tool" data-sources>Sources</button>
        </div>
        <div class="toolbar-actions">
          ${doc.status === 'Final'
            ? `<button class="tool" data-stat-toggle data-to-draft="1">↩ Unmark final</button>`
            : `<button class="tool" data-stat-toggle data-to-final="1">✓ Mark as final</button>`}
          <button class="tool" data-export="docx">Export DOCX</button>
          <button class="tool" data-export="pdf">Export PDF</button>
          ${doc.capability === 'Lesson Planning' ? `<button class="tool" data-slides>Generate slide deck</button>` : ''}
          <button class="tool" onclick="window.print()">Print</button>
        </div>
      </div>
      <input class="doc-title-input" value="" tabindex="-1" aria-hidden="true" style="display:none">
      <div class="editor" id="ws-editor" contenteditable="${doc.status === 'Final' ? 'false' : 'true'}" aria-label="Document content">${doc.contentHtml}</div>
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

  // Final / unlock toggle in the workspace toolbar.
  const statToggle = root.querySelector('[data-stat-toggle]');
  if (statToggle) statToggle.addEventListener('click', async () => {
    const toFinal = statToggle.dataset.toFinal === '1';
    if (toFinal && !confirm('Mark this document as final? It will be locked against accidental edits. You can unlock it anytime with "Edit anyway".')) return;
    try {
      await api.setDocumentStatus(doc.id, toFinal ? 'Final' : 'Draft');
      toast(toFinal ? 'Marked as final · locked' : 'Unlocked · editable again');
      go({ name: 'workspace', docId: doc.id });
    } catch (err) { toast(err.message); }
  });

  // In a locked (Final) document, don't allow the title to be changed either.
  const titleInput = root.querySelector('#ws-title');
  if (doc.status === 'Final') titleInput.setAttribute('readonly', '');

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

  // AI slide deck — generate structured slides from the lesson plan, then download as PPTX.
  const SLIDE_STAGES = ['Extracting the topics from your lesson plan', 'Preparing relevant information', 'Drafting slide content', 'Structuring the presentation', 'Finalizing your slide deck'];
  function runSlideDeck(btn) {
    const overlay = modal(`<div class="slide-card">
      <div class="slide-card-head"><div class="slide-card-title">Generate slide deck</div><button class="slide-card-x slide-close" aria-label="Close">✕</button></div>
      <p class="slide-card-sub">Building an editable PowerPoint from your lesson plan's topics. This usually takes about 15–30 seconds.</p>
      <p class="slide-card-note">Serves as a pedagogical guide and supplementary material; you are free to refine its content and visual presentation.</p>
      <div class="slide-stages">${SLIDE_STAGES.map((s) => `<div class="slide-stage" data-key="${esc(s)}"><span class="slide-dot"></span><span class="slide-stage-label">${esc(s)}</span></div>`).join('')}</div>
      <div class="slide-foot"><span class="slide-note">Preparing…</span></div>
    </div>`);
    const stageEls = overlay.querySelectorAll('.slide-stage');
    const noteEl = overlay.querySelector('.slide-note');
    function setStage(raw) {
      const match = SLIDE_STAGES.find((s) => s.toLowerCase() === String(raw).toLowerCase());
      const active = match || String(raw || '');
      stageEls.forEach((el) => {
        el.classList.toggle('active', el.dataset.key === active);
        el.classList.toggle('done', SLIDE_STAGES.indexOf(el.dataset.key) < SLIDE_STAGES.indexOf(active) && SLIDE_STAGES.indexOf(el.dataset.key) !== -1);
      });
      noteEl.textContent = String(raw === 'queued' ? 'Getting ready…' : (active || 'Working…'));
    }
    overlay.querySelector('.slide-close').addEventListener('click', () => overlay.remove());
    setStage('queued');

    // Keep the modal keyed to this job no matter how many times the button is clicked.
    btn.disabled = true;
    btn.textContent = 'Generating slide deck…';
    btn.removeAttribute('data-ready');
    const restoreReady = () => { btn.disabled = false; btn.textContent = '✓ Slide deck ready'; btn.dataset.ready = '1'; };

    const poll = async () => {
      try {
        const s = await api.lessonSlides(doc.id);
        if (s.status === 'done' && s.result) {
          const d = s.result;
          restoreReady();
          overlay.classList.add('slide-done');
          overlay.innerHTML = `<div class="slide-card slide-card-done">
            <div class="slide-badge">✓</div>
            <div class="slide-done-title">Slide deck ready</div>
            <p class="slide-done-sub"><strong class="slide-done-name">${esc(d.title || 'Lesson deck')}</strong>${d.subject ? ` · ${esc(d.subject)}` : ''}</p>
            <p class="slide-done-meta">${(d.slides || []).length} slide${(d.slides || []).length === 1 ? '' : 's'} generated · BLinkMaestra logo fixed on every slide</p>
            <p class="slide-done-disclaimer">This presentation is intended solely as a pedagogical guide and supplementary material. It may be freely revised in both content and visual design to suit the learners' needs and the teacher's professional judgment.</p>
            <div class="slide-done-actions">
              <button class="button slide-dl">Download PPTX</button>
              <button class="button secondary slide-close">Close</button>
            </div>
          </div>`;
          overlay.querySelector('.slide-dl').addEventListener('click', async () => {
            try {
              const blob = await api.downloadLessonSlides(doc.id);
              const url = URL.createObjectURL(blob);
              const a = h(`<a href="${url}" download="${esc(d.title || 'lesson')}-slides.pptx"></a>`);
              document.body.appendChild(a); a.click(); a.remove();
              URL.revokeObjectURL(url);
              toast('Slide deck downloaded');
            } catch (err) { toast(err.message); }
          });
          overlay.querySelector('.slide-close').addEventListener('click', () => overlay.remove());
          overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
          return;
        }
        if (s.status === 'failed') {
          btn.disabled = false;
          btn.textContent = 'Generate slide deck';
          btn.removeAttribute('data-ready');
          overlay.classList.add('slide-done');
          overlay.innerHTML = `<div class="slide-card slide-card-done">
            <div class="slide-badge slide-badge-fail">!</div>
            <div class="slide-done-title">We could not generate the slide deck</div>
            <p class="slide-done-sub">${esc(s.error || 'Something went wrong while generating the deck. Please try again.')}</p>
            <div class="slide-done-actions">
              <button class="button slide-retry">Try again</button>
              <button class="button secondary slide-close">Close</button>
            </div>
          </div>`;
          overlay.querySelector('.slide-retry').addEventListener('click', () => overlay.remove() || runSlideDeck(btn));
          overlay.querySelector('.slide-close').addEventListener('click', () => overlay.remove());
          overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
          return;
        }
        setStage(s.stage);
        setTimeout(poll, 1200);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Generate slide deck';
        toast(err.message);
        overlay.remove();
      }
    };

    // Reuse an already-running job if one exists (clicking twice no longer breaks the modal).
    api.lessonSlides(doc.id)
      .then((s) => {
        if (s.status === 'queued' || s.status === 'running' || (s.status === 'done' && s.result)) { poll(); return; }
        return api.generateLessonSlides(doc.id).then(() => poll());
      })
      .catch((err) => { btn.disabled = false; btn.textContent = 'Generate slide deck'; overlay.remove(); toast(err.message); });
  }
  root.querySelectorAll('[data-slides]').forEach((b) => b.addEventListener('click', () => runSlideDeck(b)));

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
            : `<button class="tool" data-open="${d.id}">Open</button><button class="tool" data-dupe="${d.id}">Duplicate</button><button class="tool" data-stat="${d.id}" data-do-final="${d.status === 'Final' ? '' : '1'}">${d.status === 'Final' ? 'Edit anyway' : 'Mark final'}</button><button class="tool" data-archive="${d.id}">${d.archived ? 'Unarchive' : 'Archive'}</button><button class="tool" data-trash="${d.id}">Trash</button>`}
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
    grid.querySelectorAll('[data-stat]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const d = all.find((x) => x.id === b.dataset.stat);
      const toFinal = b.dataset.doFinal === '1';
      if (toFinal && !confirm('Mark this document as final? It will be locked against accidental edits. You can unlock it any time with "Edit anyway".')) return;
      const nd = await api.setDocumentStatus(d.id, toFinal ? 'Final' : 'Draft');
      Object.assign(d, nd); draw(); toast(toFinal ? 'Marked as final · locked' : 'Unlocked · editable again');
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
      ${[['profile', 'Teaching profile'], ['competencies', 'Competency reference'], ['subscription', 'Subscription'], ['account', 'Account'], ['privacy', 'Privacy']].map(([id, label]) =>
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
  } else if (tab === 'subscription') {
    subscriptionTab(body);
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

// ---------- Subscription / payments ----------
async function subscriptionTab(body) {
  const me = await api.me();
  const enabled = me.payments?.enabled;
  const plan = me.payments?.plan || {};
  const perMonth = plan.perMonth || 199;
  const annualTotal = plan.annualTotal || 1990;
  const ent = me.entitlement || {};

  if (!enabled) {
    body.innerHTML = `<h2>Subscription</h2>
      <p class="card-copy">BLinkMaestra is currently available to all teachers free of charge while it is being tested. Payment is not yet active — enjoy creating unlimited documents.</p>`;
    return;
  }

  body.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:18px">
      <div><h2 style="margin:0">Subscription</h2>
      <p class="card-copy" style="margin:4px 0 0">Manage your BLinkMaestra access and view your payment history.</p></div>
    </div>
    <div id="sub-status" class="status-banner" style="margin-bottom:20px"><p class="card-copy" id="sub-status-text" style="margin:0">Loading your account status…</p></div>

    <div class="sub-layout">
      <div class="card subscribe-card">
        <div class="card-heading"><h3>Choose a plan</h3></div>
        <p class="card-copy" style="margin-top:0">Subscribe when you're ready — your new account already includes free documents to try it out.</p>
        <div class="plan-picker" style="margin-top:14px">
          <label class="plan-option">
            <input type="radio" name="sub-plan" value="monthly" checked>
            <span class="plan-opt-body"><strong>Monthly</strong><small>PHP ${perMonth.toLocaleString()} / month</small></span>
          </label>
          <label class="plan-option">
            <input type="radio" name="sub-plan" value="annual">
            <span class="plan-opt-body"><strong>Annual</strong><small>PHP ${annualTotal.toLocaleString()} / year · about PHP ${plan.annualEffectiveMonthly === undefined ? Math.round(annualTotal / 12) : plan.annualEffectiveMonthly}/month</small><em class="best">Best value</em></span>
          </label>
        </div>
        <div class="card-heading" style="margin-top:22px"><h3>Pay with GCash</h3></div>
        <p class="card-copy" style="margin-top:0">Send the total to this GCash number, then enter the payment reference so we can verify it.</p>
        <div class="gcash-number">${esc(plan.gcashNumber || '')}</div>
        <form id="sub-order" style="margin-top:14px">
          ${field('GCash reference number', `<input id="sub-ref" placeholder="e.g. 4409 3123 4567 8901" required>`)}
          ${field('Note (optional)', `<input id="sub-note" placeholder="Anything we should know?">`)}
          <p class="card-copy sub-quote-wrap"><span id="sub-quote"></span></p>
          <button class="button" type="submit" style="width:100%;padding:12px 16px;font-size:15px">Submit payment for review</button>
        </form>
      </div>
      <div class="card subscribe-side">
        <div class="card-heading"><h3>Your payments</h3></div>
        <div id="sub-history"></div>
      </div>
    </div>`;

  const statusEl = body.querySelector('#sub-status-text');
  const pendingCount = (me.payments?.pendingOrders || []).length;
  const remaining = ent.freeAllowance - (ent.freeUsed || 0);
  const renderStatus = () => {
    const banner = body.querySelector('#sub-status');
    if (ent.status === 'active') {
      banner.className = 'status-banner ok';
      statusEl.innerHTML = `Your subscription is <strong>active</strong> until <strong>${new Date(ent.activeUntil).toLocaleDateString()}</strong>.`;
    } else if (ent.status === 'free') {
      banner.className = 'status-banner info';
      statusEl.innerHTML = `You have <strong>${remaining}</strong> of ${ent.freeAllowance} free documents remaining. Once they run out, a subscription is required to keep creating.`;
    } else if (ent.status === 'limited' && pendingCount) {
      banner.className = 'status-banner warn';
      statusEl.innerHTML = `Your free documents are used up, but a <strong>payment is currently being reviewed</strong>. You'll be sent an email once it's approved.`;
    } else if (ent.status === 'limited') {
      banner.className = 'status-banner err';
      statusEl.innerHTML = `Your free documents are used up and your subscription has expired. Please subscribe below to regain access.`;
    } else {
      banner.className = 'status-banner info';
      statusEl.innerHTML = 'You have full access.';
    }
  };
  renderStatus();

  const planEls = body.querySelectorAll('input[name="sub-plan"]');
  const quoteEl = body.querySelector('#sub-quote');
  const activePlan = () => body.querySelector('input[name="sub-plan"]:checked').value;
  const refreshQuote = async () => {
    try {
      const q = await api.billingQuote(activePlan());
      quoteEl.textContent = `Total: ${q.currency} ${q.total.toLocaleString()} — ${q.name} plan${q.effectiveMonthly ? ` (about PHP ${q.effectiveMonthly}/month)` : ''}. Send via GCash and enter your reference below.`;
    } catch { quoteEl.textContent = ''; }
  };
  refreshQuote();
  planEls.forEach((el) => el.addEventListener('change', refreshQuote));

  body.querySelector('#sub-order').addEventListener('submit', async (e) => {
    e.preventDefault();
    const g = (id) => body.querySelector(`#${id}`).value.trim();
    try {
      await api.createOrder({ plan: activePlan(), ref: g('sub-ref'), note: g('sub-note') });
      toast('Payment submitted for review! You will be notified once approved.');
      body.querySelector('#sub-ref').value = '';
      body.querySelector('#sub-note').value = '';
      renderHistory();
      renderStatus();
    } catch (err) { toast(err.message); }
  });

  const renderHistory = async () => {
    const hist = body.querySelector('#sub-history');
    let orders;
    try { orders = await api.myOrders(); } catch { hist.innerHTML = '<p class="card-copy">Could not load your payment history.</p>'; return; }
    if (!orders.length) { hist.innerHTML = '<p class="card-copy">No payments yet.</p>'; return; }
    const badges = { pending: 'Pending review', active: 'Approved', rejected: 'Rejected' };
    const orderLabel = (o) => {
      if (o.plan === 'annual') return `Annual — PHP ${Number(o.total || 0).toLocaleString()}`;
      if (o.plan === 'monthly') return `Monthly — PHP ${Number(o.total || 0).toLocaleString()}`;
      return `${o.months || 0} months — PHP ${Number(o.total || 0).toLocaleString()}`;
    };
    hist.innerHTML = orders.map((o) => `
      <div class="deadline"><div style="flex:1">
        <strong>${esc(orderLabel(o))}</strong>
        <small>Ref: ${esc(o.ref)} · ${new Date(o.createdAt).toLocaleString()}${o.expiresAt ? ` · Active until ${new Date(o.expiresAt).toLocaleDateString()}` : ''}</small>
      </div><span class="tag">${badges[o.status] || o.status}</span></div>`).join('');
  };
  await renderHistory();
}

// ---------- Admin ----------
// Horizontal "bar" list for report breakdowns (documents by template, by
// subject, etc.). Accepts an array of {month|key, count} and a label extractor.
function reportBars(items, labelOf) {
  if (!items || !items.length) return '<p class="card-copy">No data yet.</p>';
  const max = Math.max(...items.map((i) => i.count));
  return items.slice(0, 8).map((i) => `
    <div style="margin:9px 0">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
        <span>${esc(labelOf(i))}</span><strong>${i.count}</strong>
      </div>
      <div style="background:var(--line);height:8px;border-radius:6px;overflow:hidden">
        <div style="height:100%;width:${(i.count / max * 100).toFixed(1)}%;background:var(--forest);border-radius:6px"></div>
      </div>
    </div>`).join('');
}

function reportStat(label, value, sub) {
  return `<div class="stat"><span>${esc(label)}</span><strong>${value}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
}

// A titled panel that holds a chart/list/table inside a card.
function reportPanel(title, body) {
  return `<section class="card" style="margin:0;display:flex;flex-direction:column">
    <h3 style="font:700 14px 'DM Sans',system-ui,sans-serif;margin:0 0 10px;color:var(--ink)">${esc(title)}</h3>
    ${body}
  </section>`;
}

function renderAdminReport(r) {
  const money = (n) => (n || 0).toLocaleString();

  // 7-day activity as a simple inline bar chart.
  const trend = (obj, color) => {
    const days = Object.keys(obj || {}).sort();
    if (!days.length) return '<p class="card-copy">No activity yet.</p>';
    const max = Math.max(...days.map((d) => obj[d]), 1);
    return `<div style="display:flex;align-items:flex-end;gap:6px;height:64px;margin-top:8px">
      ${days.map((d) => `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%">
        <div title="${d}: ${obj[d]}" style="width:100%;min-height:2px;background:${color};border-radius:3px;height:${(obj[d] / max * 100).toFixed(0)}%"></div>
        <small style="font-size:9px;margin-top:3px;opacity:.6">${d.slice(5)}</small></div>`).join('')}
    </div>`;
  };

  const avg = (obj) => { const v = Object.values(obj || {}); let total = 0; for (const n of v) total += n; return v.length ? Math.round(total / v.length) : 0; };

  return `
    <div class="grid-2" style="margin-bottom:22px">
      <section class="card"><div class="report-hero">
        <p class="eyebrow" style="margin-bottom:6px">Reports &amp; insights</p>
        <h2 style="font:700 24px Fraunces,serif;margin:0;color:var(--ink)">Platform overview</h2>
        <p class="card-copy">${r.plan?.currency} ${money(r.subscribers?.revenue?.lifetime)} lifetime revenue · <strong>${r.documents?.total ?? 0}</strong> documents · <strong>${r.generations?.total ?? 0}</strong> AI generations</p>
        <p class="card-copy" style="margin-top:2px;font-size:12px;opacity:.7">Last refresh ${new Date(r.generatedAt).toLocaleString()}</p>
      </div></section>
      <section class="card"><div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;height:100%;align-content:center">
        ${reportStat('Docs / day (7d)', avg(r.documents?.last7), 'average')}
        ${reportStat('Gen / day (7d)', avg(r.generations?.last7), 'average')}
      </div></section>
    </div>

    <div class="stat-grid" style="margin-bottom:26px">
      ${reportStat('Teachers', r.users?.teachers ?? 0, 'accounts')}
      ${reportStat('Active subscribers', r.subscribers?.active?.total ?? 0, 'right now')}
      ${reportStat('Free tier', r.tierBreakdown ? r.tierBreakdown.free : '—', r.paymentsEnabled ? 'unsubscribed within allowance' : 'payments OFF')}
      ${reportStat('Revenue (lifetime)', `${r.plan?.currency} ${money(r.subscribers?.revenue?.lifetime)}`, `${r.subscribers?.paidAllTime?.total ?? 0} paid`)}
      ${reportStat('Documents', r.documents?.total ?? 0, 'created')}
      ${reportStat('Generations', r.generations?.total ?? 0, 'AI requests')}
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:18px;margin-bottom:26px">
      ${reportPanel('Active subscribers by plan', reportBars([...(r.subscribers?.active?.byTier || [])].map((t) => ({ key: t.plan || `${t.months} month${t.months > 1 ? 's' : ''}`, count: t.count })), (i) => `${i.key}`))}
      ${reportPanel('Paid all-time by plan', reportBars([...(r.subscribers?.paidAllTime?.byTier || [])].map((t) => ({ key: t.plan || `${t.months} month${t.months > 1 ? 's' : ''}`, count: t.count })), (i) => `${i.key}`))}
      ${reportPanel('Documents by capability', reportBars(r.documents?.byCapability || [], (i) => i.key))}
      ${reportPanel('Generations by template', reportBars(r.generations?.byTemplate || [], (i) => i.key || 'Untracked'))}
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:18px;margin-bottom:26px">
      ${reportPanel('Documents created (7 days)', trend(r.documents?.last7, 'var(--forest)'))}
      ${reportPanel('Generations (7 days)', trend(r.generations?.last7, 'var(--blue)'))}
      ${reportPanel('Orders', `
        ${r.orders ? `
        <div style="display:flex;flex-direction:column;gap:11px">
          <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding-bottom:9px"><span class="card-copy" style="margin:0">Pending review</span><strong>${r.orders?.pending ?? 0}</strong></div>
          <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding-bottom:9px"><span class="card-copy" style="margin:0">Approved / paid</span><strong>${r.orders?.paid ?? 0}</strong></div>
          <div style="display:flex;justify-content:space-between;align-items:center"><span class="card-copy" style="margin:0">Rejected</span><strong>${r.orders?.rejected ?? 0}</strong></div>
        </div>` : '<p class="card-copy">No orders yet.</p>'}`)}
    </div>

    <div style="margin-top:4px">
      <h3 style="font:700 15px 'DM Sans',system-ui,sans-serif;color:var(--ink);margin:0 0 12px">User listing &amp; document generation</h3>
      <div style="border:1px solid var(--line);border-radius:12px;overflow:auto;background:var(--card,var(--white))">
        <table style="width:100%;border-collapse:collapse;font-size:13px;text-align:left">
          <thead>
            <tr style="border-bottom:1px solid var(--line);background:var(--table-head,#f8faf9)">
              <th style="padding:12px 16px;font-weight:600;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px">Email</th>
              <th style="padding:12px 16px;font-weight:600;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px">Role</th>
              <th style="padding:12px 16px;font-weight:600;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px">Tier / Status</th>
              <th style="padding:12px 16px;font-weight:600;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px;text-align:right">Documents Generated</th>
            </tr>
          </thead>
          <tbody>
            ${(r.userList || []).map((u) => `
              <tr style="border-bottom:1px solid var(--line)">
                <td style="padding:12px 16px"><strong>${esc(u.email)}</strong><br><small style="opacity:.6">Joined ${new Date(u.createdAt).toLocaleDateString()}</small></td>
                <td style="padding:12px 16px"><span class="tag" style="text-transform:capitalize">${esc(u.role)}</span></td>
                <td style="padding:12px 16px">${esc(u.tier)}</td>
                <td style="padding:12px 16px;text-align:right"><strong>${u.documentsCount}</strong></td>
              </tr>
            `).join('')}
            ${!(r.userList || []).length ? '<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--muted)">No users found.</td></tr>' : ''}
          </tbody>
        </table>
      </div>
    </div>

    <p class="card-copy" style="margin-top:16px;font-size:12px;opacity:.7">Free allowance ${r.plan?.freeAllowance ?? 5} per teacher.</p>
  `;
}

// Renders the Admin -> Reports & insights tab (loads the report fresh each time).
async function renderAdminReportsTab(body) {
  body.innerHTML = `<p class="card-copy">Loading reports…</p>`;
  try {
    const r = await api.report();
    body.innerHTML = renderAdminReport(r);
  } catch {
    body.innerHTML = '<p class="card-copy">Could not load reports.</p>';
  }
}

// Renders the Admin -> Teacher activity tab: a feed of every document teachers
// have generated, with a content preview and a full-document view.
async function renderAdminActivityTab(body) {
  const filters = state.route.filters || {};
  const buildQuery = (over = {}) => {
    const merged = { q: filters.q, teacher: filters.teacher, capability: filters.capability, ...over };
    return merged;
  };
  const rerender = () => renderAdminActivityTab(body);

  body.innerHTML = `<p class="card-copy">Loading teacher activity…</p>`;
  let data;
  try {
    data = await api.activity(buildQuery());
  } catch {
    body.innerHTML = '<p class="card-copy">Could not load teacher activity.</p>';
    return;
  }

  const items = data.items || [];
  const capabilities = data.capabilities || [];
  const teachers = data.teachers || [];

  // Build a plain-text preview from the document HTML.
  const preview = (html, len = 180) => {
    const text = String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > len ? `${text.slice(0, len)}…` : text;
  };

  body.innerHTML = `
    <p class="subtitle">Every document teachers have generated, newest first. You can preview or open each one.</p>
    <section class="card" style="margin-bottom:16px">
      <form id="act-filters" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <input id="act-q" placeholder="Search title or content…" value="${esc(filters.q || '')}" style="flex:1;min-width:180px">
        <select id="act-teacher" style="min-width:160px">
          <option value="">All teachers</option>
          ${teachers.map((t) => `<option value="${esc(t)}"${filters.teacher === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}
        </select>
        <select id="act-capability" style="min-width:160px">
          <option value="">All capabilities</option>
          ${capabilities.map((c) => `<option value="${esc(c)}"${filters.capability === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
        <button class="button" type="submit">Filter</button>
        ${(filters.q || filters.teacher || filters.capability) ? '<button type="button" class="tool" id="act-clear">Clear</button>' : ''}
      </form>
    </section>
    <section class="card">
      <div class="card-heading"><h2>Generated documents <span style="font-weight:400;opacity:.6">(${items.length})</span></h2></div>
      ${items.length ? `<div>${items.map((d) => activityRow(d, preview(d.contentHtml))).join('')}</div>`
        : '<p class="card-copy">No documents found for this filter.</p>'}
    </section>`;

  const apply = () => {
    const next = buildQuery({
      q: body.querySelector('#act-q').value.trim(),
      teacher: body.querySelector('#act-teacher').value,
      capability: body.querySelector('#act-capability').value,
    });
    state.route.filters = next;
    rerender();
  };
  body.querySelector('#act-filters').addEventListener('submit', (e) => { e.preventDefault(); apply(); });
  body.querySelector('#act-clear')?.addEventListener('click', () => { state.route.filters = {}; rerender(); });

  // Open a full document in a modal (rendered HTML, read-only).
  body.querySelectorAll('[data-activity-view]').forEach((b) => b.addEventListener('click', () => {
    const item = items.find((d) => d.id === b.dataset.activityView);
    if (!item) return;
    const overlay = modal(`<div class="modal-box" style="width:min(760px,100%)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
        <div><h2 style="margin:0">${esc(item.title || 'Untitled')}</h2>
        <p class="card-copy" style="margin:4px 0 0">${esc(item.teacherName || item.teacherEmail)} · ${esc(item.capability)} · ${new Date(item.createdAt).toLocaleString()}</p></div>
        <button class="tool" data-close>✕</button>
      </div>
      <div class="document-content" style="margin-top:12px;border:1px solid var(--line);border-radius:12px;padding:20px;max-height:64vh;overflow:auto">${item.contentHtml}</div>
      <div class="modal-footer" style="margin-top:16px"><button class="button ghost" data-close>Close</button></div>
    </div>`);
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => overlay.remove()));
  }));
}

function activityRow(d, previewText) {
  const tag = (label, tone = '') => `<span class="tag"${tone ? ` style="background:${tone.bg};color:${tone.fg}"` : ''}>${esc(label)}</span>`;
  return `<div class="deadline" style="margin-bottom:8px">
    <div style="flex:1">
      <strong>${esc(d.title || 'Untitled document')}</strong>
      ${tag(d.capability)}
      ${d.status ? tag(d.status) : ''}
      <small>${esc(d.teacherName || d.teacherEmail || 'teacher')} · ${new Date(d.createdAt).toLocaleString()}<br>${esc(d.teacherEmail || '')}${previewText ? ` · ${esc(previewText)}` : ''}</small>
    </div>
    <button class="tool" data-activity-view="${esc(d.id)}">Open</button>
  </div>`;
}

// Renders the Admin -> Payments & subscriptions tab.
async function renderAdminPaymentsTab(body, ov) {
  const enabled = !!ov?.payments?.enabled;
  body.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:18px">
      <div><h2 style="margin:0">Payments &amp; subscriptions</h2>
      <p class="card-copy" style="margin:4px 0 0">Review GCash payments and control billing for your teachers.</p></div>
      <span class="billing-pill ${enabled ? 'on' : 'off'}">${enabled ? 'Billing enabled' : 'Billing off'}</span>
    </div>

    <div class="card billing-toggle-card">
      <div>
        <h3 style="margin:0;font-size:15px">Accept teacher payments</h3>
        <p class="card-copy" style="margin:4px 0 0">${enabled ? 'Teachers are billed after their 5 free documents run out.' : 'Everyone can currently create freely — billing is paused.'}</p>
      </div>
      <label class="switch">
        <input type="checkbox" id="adm-pay-toggle" ${enabled ? 'checked' : ''}>
        <span class="slider"></span>
      </label>
    </div>

    <div style="margin-top:24px"><div class="card-heading"><h3>Pending payments${ov?.payments?.pendingOrders ? ` <span class="tag pending-count">${ov.payments.pendingOrders}</span>` : ''}</h3></div>
      <div class="card bill-orders-card" style="padding:6px"><div id="adm-pay-orders"><p class="card-copy">Loading…</p></div></div>
    </div>`;

  const payToggleBtn = body.querySelector('#adm-pay-toggle');
  payToggleBtn.addEventListener('change', async () => {
    payToggleBtn.disabled = true;
    try {
      await api.setPaymentsEnabled(payToggleBtn.checked);
      toast('Payment setting updated.');
      adminView(body.closest('#page-root') || document.getElementById('page-root'));
    } catch (err) { toast(err.message); payToggleBtn.disabled = false; }
  });

  const holder = body.querySelector('#adm-pay-orders');
  let orders = [];
  try { orders = await api.adminOrders(); } catch { holder.innerHTML = '<p class="card-copy">Could not load payments.</p>'; return; }
  const pending = orders.filter((o) => o.status === 'pending');
  if (!pending.length) { holder.innerHTML = '<p class="card-copy" style="padding:16px 12px;margin:0">No payments waiting for review.</p>'; return; }
  const planLabel = (o) => {
    if (o.plan === 'annual') return 'Annual';
    if (o.plan === 'monthly') return 'Monthly';
    return `${o.months} month${o.months !== 1 ? 's' : ''}`;
  };
  holder.innerHTML = `
    <div class="bill-table" role="table">
      <div class="bill-row bill-head" role="row">
        <span>Teacher</span><span>Plan &amp; amount</span><span class="hide-mobile">Reference</span><span class="actions">Actions</span>
      </div>
      ${pending.map((o) => `
      <div class="bill-row" role="row">
        <span><strong>${esc(o.user?.name || o.user?.email || o.userId)}</strong><small>${o.user?.email ? esc(o.user.email) : ''}<br>Submitted ${new Date(o.createdAt).toLocaleString()}</small></span>
        <span><em class="plan-tag ${o.plan}">${esc(planLabel(o))}</em><small>PHP ${o.total.toLocaleString()}${o.note ? ` · "${esc(o.note)}"` : ''}</small></span>
        <span class="hide-mobile"><code class="ref-code">${esc(o.ref)}</code></span>
        <span class="actions">
          <button class="bill-btn approve" data-pay-approve="${esc(o.id)}">Approve</button>
          <button class="bill-btn reject" data-pay-reject="${esc(o.id)}">Reject</button>
        </span>
      </div>`).join('')}
    </div>`;
  const rerender = () => adminView(body.closest('#page-root') || document.getElementById('page-root'));
  holder.querySelectorAll('[data-pay-approve]').forEach((b) => b.addEventListener('click', async () => {
    await api.approveOrder(b.dataset.payApprove); toast('Payment approved. Access granted.'); rerender();
  }));
  holder.querySelectorAll('[data-pay-reject]').forEach((b) => b.addEventListener('click', async () => {
    const reason = prompt('Reason for rejection (optional)', '');
    if (reason === null) return;
    await api.rejectOrder(b.dataset.payReject, reason); toast('Payment rejected.'); rerender();
  }));
}

// Renders the Admin -> Users & subscriptions tab: a directory of every user with
// their subscription status, plan, free-allowance usage, expiry, and order history.
async function renderAdminUsersTab(body) {
  body.innerHTML = `<p class="card-copy">Loading users…</p>`;
  let data;
  try { data = await api.adminSubscriptionDirectory(); }
  catch { body.innerHTML = '<p class="card-copy">Could not load users.</p>'; return; }

  const users = data.users || [];
  const planInfo = data.plan || {};
  const money = (n) => (Number(n) || 0).toLocaleString();

  const statusBadge = (s) => {
    const map = {
      active: ['Approved / active', 'background:#eaf1fc;color:#0d47c7'],
      free: ['Free trial', 'background:#edf3f7;color:#164b6b'],
      limited: ['Limited — needs subscription', 'background:#fbecec;color:#a13030'],
      admin: ['Admin', 'background:#f3e9da;color:#7a5a20'],
    };
    const [label, style] = map[s] || [s, ''];
    return `<span class="tag" style="${style}">${esc(label)}</span>`;
  };

  const remaining = (u) => {
    if (u.status === 'active') return '—';
    return `${Math.max(0, u.freeAllowance - u.freeUsed)} of ${u.freeAllowance} free docs left`;
  };

  const expiry = (u) => u.activeUntil
    ? `<strong>${new Date(u.activeUntil).toLocaleDateString()}</strong>${new Date(u.activeUntil).getTime() < Date.now() ? ' <span style="color:#a13030">(expired)</span>' : ''}`
    : '—';

  body.innerHTML = `
    <div class="stat-grid" style="margin-bottom:24px">
      <div class="stat"><span>Total users</span><strong>${users.length}</strong></div>
      <div class="stat"><span>Active subscribers</span><strong>${users.filter((u) => u.status === 'active').length}</strong></div>
      <div class="stat"><span>Free trial</span><strong>${users.filter((u) => u.status === 'free').length}</strong></div>
      <div class="stat"><span>Limited / need payment</span><strong>${users.filter((u) => u.status === 'limited').length}</strong></div>
    </div>

    <p class="card-copy" style="margin-top:4px">Current pricing: <strong>Monthly — PHP ${money(planInfo.perMonth)}/mo</strong> · <strong>Annual — PHP ${money(planInfo.annualTotal)}/yr</strong>. Free allowance ${planInfo.freeAllowance} documents per teacher.</p>

    <div style="margin-top:16px;display:flex;flex-direction:column;gap:14px">
      ${users.length ? users.map((u) => `
        <div class="card" style="padding:18px;margin:0">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
            <div style="min-width:0">
              <strong style="font-size:15px">${esc(u.name || u.email)}</strong>
              <small style="display:block;color:var(--muted);margin-top:2px">${esc(u.email)}</small>
              <small style="display:block;color:var(--muted)">Joined ${new Date(u.createdAt).toLocaleDateString()}</small>
            </div>
            <div style="text-align:right">${statusBadge(u.status)}
              <div style="margin-top:8px;display:flex;gap:8px"><span class="tag">${esc(u.role)}</span></div>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:14px;background:var(--mint);border-radius:10px;padding:12px;font-size:13px">
            <div><small style="color:var(--muted);display:block">Free docs used</small><strong>${u.freeUsed} / ${u.freeAllowance}</strong></div>
            <div><small style="color:var(--muted);display:block">Free remaining</small><strong>${esc(remaining(u))}</strong></div>
            <div><small style="color:var(--muted);display:block">Active plan</small><strong>${u.activePlan ? esc(u.activePlan.plan) + ` — ${money(u.activePlan.total)}` : 'None'}</strong></div>
            <div><small style="color:var(--muted);display:block">Access until</small>${expiry(u)}</div>
          </div>

          ${u.pendingCount ? `<div style="margin-top:12px;padding:10px 12px;border:1px solid #f2dda8;background:#fdf7e9;border-radius:9px;font-size:13px"><strong>${u.pendingCount} payment(s) pending review</strong> — see Payments tab to approve.</div>` : ''}

          ${(u.subscriptions || []).length ? `<div style="margin-top:14px">
            <p style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin:0 0 8px">Payment history</p>
            <div style="border:1px solid var(--line);border-radius:10px;overflow:auto">
              <table style="width:100%;border-collapse:collapse;font-size:13px;text-align:left">
                <thead><tr style="border-bottom:1px solid var(--line);background:var(--table-head,#f8faf9)">
                  <th style="padding:9px 12px;font-size:11px;text-transform:uppercase;color:var(--muted)">Plan</th>
                  <th style="padding:9px 12px;font-size:11px;text-transform:uppercase;color:var(--muted)">Amount</th>
                  <th style="padding:9px 12px;font-size:11px;text-transform:uppercase;color:var(--muted)">Status</th>
                  <th style="padding:9px 12px;font-size:11px;text-transform:uppercase;color:var(--muted)">Reference</th>
                  <th style="padding:9px 12px;font-size:11px;text-transform:uppercase;color:var(--muted)">Paid</th>
                  <th style="padding:9px 12px;font-size:11px;text-transform:uppercase;color:var(--muted)">Expires</th>
                </tr></thead>
                <tbody>${u.subscriptions.map((s) => `
                  <tr style="border-bottom:1px solid var(--line)">
                    <td style="padding:9px 12px"><strong>${esc(s.plan)}</strong></td>
                    <td style="padding:9px 12px">PHP ${money(s.total)}</td>
                    <td style="padding:9px 12px">${s.status === 'active' ? '<span class="tag" style="background:#eaf1fc;color:#0d47c7">Approved</span>' : s.status === 'pending' ? '<span class="tag" style="background:#fff3cd;color:#8a6d1a">Pending</span>' : '<span class="tag" style="background:#fbecec;color:#a13030">Rejected</span>'}</td>
                    <td style="padding:9px 12px">${esc(s.ref || '')}</td>
                    <td style="padding:9px 12px">${s.paidAt ? new Date(s.paidAt).toLocaleDateString() : '—'}</td>
                    <td style="padding:9px 12px">${s.expiresAt ? new Date(s.expiresAt).toLocaleDateString() : '—'}</td>
                  </tr>`).join('')}</tbody>
              </table>
            </div>
          </div>` : ''}
        </div>`).join('') : '<p class="card-copy">No users yet.</p>'}
    </div>
  `;
}

async function adminView(root) {
  let ov;
  try { ov = await (await fetch('/api/admin/overview', { credentials: 'same-origin' })).json(); }
  catch { root.innerHTML = '<p class="card-copy">Admin access required.</p>'; return; }
  if (ov.error) { root.innerHTML = `<div class="card"><p class="card-copy">${esc(ov.error)}</p></div>`; return; }

  const tab = state.route.tab || 'overview';
  root.innerHTML = `<p class="eyebrow">Administration</p><h1 class="title">System management</h1>
    <div class="admin-tabs" role="tablist">
      ${[['overview', 'Overview'], ['activity', 'Teacher activity'], ['users', 'Users & subscriptions'], ['payments', 'Payments & subscriptions'], ['reports', 'Reports & insights']].map(([id, label]) =>
        `<button data-tab="${id}" class="${tab === id ? 'active' : ''}">${label}</button>`).join('')}
    </div><div id="admin-body"></div>`;

  const body = root.querySelector('#admin-body');

  // Tab navigation (shared).
  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => go({ name: 'admin', tab: b.dataset.tab })));

  if (tab === 'activity') { renderAdminActivityTab(body); return; }
  if (tab === 'reports') { renderAdminReportsTab(body); return; }
  if (tab === 'payments') { renderAdminPaymentsTab(body, ov); return; }
  if (tab === 'users') { renderAdminUsersTab(body); return; }

  body.innerHTML = `<p class="subtitle">Manage the competency library, knowledge references, the AI provider, and templates. Changes apply to all teachers.</p>
    <div class="stat-grid">
      <div class="stat"><span>Users</span><strong>${ov.users}</strong></div>
      <div class="stat"><span>Competencies</span><strong>${ov.competencyCount}</strong></div>
      <div class="stat"><span>Templates</span><strong>${ov.templates.length}</strong></div>
      <div class="stat"><span>Custom knowledge</span><strong>${ov.knowledge.length}</strong></div>
    </div>

    <section class="card ai-section" style="margin-bottom:20px"><div class="card-heading"><h2>AI provider configuration</h2></div>
      <p class="card-copy ai-lede">Manage the shared AI key pool used by every teacher. Add one or more keys (any OpenAI-compatible endpoint via the base URL); providing several keys absorbs free-tier limits and avoids "daily allowance" pauses. Keys are stored encrypted and never shown again once saved.</p>
      <div id="ai-pool-status" class="ai-status"></div>
      <div class="pool-wrap"><div id="ai-pool-editor" class="pool-editor"> </div></div>
      <form id="adm-aiform" class="ai-save-form">
        <p class="card-copy" id="ai-status" style="margin:0 0 4px"></p>
        <button class="button" type="submit">Save AI configuration</button>
      </form>
      <p class="ai-note"><strong>Free-tier note:</strong> Most free AI accounts (e.g. Groq) cap tokens per day and per minute. When a key hits its daily cap, the pool rotates to the next key; if all are capped, teachers briefly see a "try again in ~Xm" message instead of a hard failure. Adding more keys/models increases shared capacity for everyone.</p>
    </section>

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

  // Load current AI pool config (masked keys shown; real keys only when includeKeys).
  const poolEditor = root.querySelector('#ai-pool-editor');
  const poolStatus = root.querySelector('#ai-pool-status');
  let poolRows = [];
  const buildPoolRow = (entry = {}) => {
    const row = document.createElement('div');
    row.className = 'pool-row';
    row.dataset.id = entry.id || '';
    row.innerHTML = `
      <label class="pf">Label<input class="p-label" placeholder="e.g. Groq free" value="${(entry.label || '').replace(/"/g, '&quot;')}"></label>
      <label class="pf">Base URL<input class="p-baseurl" placeholder="https://api.groq.com/openai/v1" value="${(entry.baseUrl || '').replace(/"/g, '&quot;')}"></label>
      <label class="pf">Model<input class="p-model" placeholder="llama-3.3-70b-versatile" value="${(entry.model || '').replace(/"/g, '&quot;')}"></label>
      <label class="pf">API key<input class="p-key" type="password" placeholder="${entry.key ? 'unchanged' : 'sk-...'}" value="${(entry.key && !entry.key.includes('••••') ? entry.key : '').replace(/"/g, '&quot;')}"></label>
      <button type="button" class="p-remove" title="Remove this key" aria-label="Remove key">Remove</button>`;
    row.querySelector('.p-remove').addEventListener('click', () => { row.remove(); poolRows = poolRows.filter((r) => r !== row); });
    return row;
  };
  const addPoolRow = (entry) => { const row = buildPoolRow(entry); poolEditor.insertBefore(row, addBtn); poolRows.push(row); };

  (async () => {
    try {
      const cfg = await api.aiConfig(false);
      const s = cfg.ai || {};
      const pool = Array.isArray(s.pool) ? s.pool : [];
      pool.forEach((addPoolRow));
      if (!pool.length) addPoolRow();
      const n = pool.length + (cfg.effectiveEnv?.opencode || cfg.effectiveEnv?.openai ? 1 : 0);
      poolStatus.textContent = n
        ? `${n} key(s) active (${pool.length} from this form${cfg.effectiveEnv?.opencode || cfg.effectiveEnv?.openai ? ' + 1 from the Render environment' : ''}).`
        : 'No AI keys configured yet.';
    } catch { /* admin form is optional */ }
  })();

  root.querySelector('#ai-pool-editor').addEventListener('click', (e) => {
    if (e.target.id === 'ai-add-pool') addPoolRow();
  });
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.id = 'ai-add-pool';
  addBtn.className = 'button button-small add-key';
  addBtn.textContent = '+ Add another key';
  poolEditor.appendChild(addBtn);

  root.querySelector('#adm-aiform').addEventListener('submit', async (e) => {
    e.preventDefault();
    root.querySelector('#adm-aiform button[type=submit]').disabled = true;
    try {
      const pool = poolRows.map((r) => ({
        id: r.dataset.id || '',
        label: r.querySelector('.p-label').value,
        baseUrl: r.querySelector('.p-baseurl').value,
        model: r.querySelector('.p-model').value,
        key: r.querySelector('.p-key').value,
      })).filter((e) => e.label || e.baseUrl || e.model || e.key);
      await api.saveAiConfig({ pool });
      toast('AI configuration saved.');
      root.querySelector('#ai-pool-status').textContent = `${pool.length} key(s) active.`;
    } catch (err) {
      toast(err.message);
    }
    root.querySelector('#adm-aiform button[type=submit]').disabled = false;
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
  const ARTICLES = [
    { cat: 'Getting started', icon: '🌱', title: 'Welcome to BLinkMaestra — what is this?',
      body: 'BLinkMaestra is a teacher assistant that turns your working documents into DepEd-ready outputs. You describe the document you need (like a lesson plan, competency-based assessment, or class program), and Maestra drafts it for you using official references. You stay in control: every draft is editable and every AI change is something you approve first.' },
    { cat: 'Getting started', icon: '🪜', title: 'Creating my first document — step by step',
      body: 'Open Templates, pick a type that matches your need, then follow the guided workflow. Your grade level and subject are pulled from your profile automatically, so you only answer the few questions that are missing. When you are ready, hit Generate — Maestra drafts the document in your workspace where you can read, edit, and download it.' },
    { cat: 'Getting started', icon: '🗂️', title: 'What template types are available?',
      body: 'Maestra ships with templates for lesson planning (Daily Lesson Log, learning activity sheets), classroom assessment (Table of Specification, assessments with answer keys), parent communication, accomplishment reports, reflections for professional growth, and more. Each template asks only the details that matter and follows the current DepEd format it represents.' },
    { cat: 'Getting started', icon: '🧭', title: 'What is the guided workflow?',
      body: 'The guided workflow breaks document creation into small steps. It fills in whatever it already knows about you, prompts you for the rest, and shows what is still missing so nothing is left half-finished. You can review your answers before anything is generated.' },
    { cat: 'Getting started', icon: '👤', title: 'Setting up my profile and preferences',
      body: 'In Settings → Preferences you can set your name, grade level, and subject. Maestra uses these to pre-fill your documents so you do not repeat the same details every time. You can update them anytime and they apply to future documents immediately.' },

    { cat: 'Using the AI editor', icon: '✍️', title: 'How do I create a document?',
      body: 'Go to Templates, choose the type you need, and follow the workflow. Your grade level and subject are filled from your profile automatically; you will only be asked for what is missing. When you are ready, press Generate.' },
    { cat: 'Using the AI editor', icon: '✂️', title: 'Can the AI edit part of my document?',
      body: 'Yes. Select text in the editor, then choose an action like Improve, Simplify, or Translate. You always review the result and confirm before any change is applied to your document.' },
    { cat: 'Using the AI editor', icon: '🔄', title: 'Editing and revising my draft',
      body: 'Every draft opens in your document workspace. You can edit text directly, ask the AI to improve a selection, and regenerate or revise parts. You are never locked into a draft — treat it as a strong starting point and make it yours.' },
    { cat: 'Using the AI editor', icon: '💾', title: 'Are my documents saved automatically?',
      body: 'Yes. Your work is kept in My Documents and synced to your account as you go, so you can switch pages or close and come back later without losing progress.' },
    { cat: 'Using the AI editor', icon: '🎨', title: 'Why does the draft differ from the official DepEd form?',
      body: 'Maestra follows the official reference for a template whenever one is available. When a detail is not covered by an official source, Maestra uses a reasonable assumption and clearly marks it so you can double-check and adjust it before submitting.' },

    { cat: 'Privacy & data', icon: '🔒', title: 'Are my documents private?',
      body: 'Yes. Only your account can access your documents, and this is verified server-side on every request. Your materials are not shared with other teachers or used to train external models.' },
    { cat: 'Privacy & data', icon: '🛡️', title: 'Where are my API / AI keys stored?',
      body: 'AI keys configured by the admin are stored encrypted and never shown back in full once saved. Teachers generate documents through the shared, admin-managed key pool — individual teachers do not enter their own keys.' },
    { cat: 'Privacy & data', icon: '📖', title: 'Does Maestra invent DepEd requirements?',
      body: 'No. Official references are only used when one is available; anything uncertain or not covered by a source is labeled as an assumption so you can verify it yourself.' },

    { cat: 'Billing & subscription', icon: '🎁', title: 'Do I get free documents before subscribing?',
      body: 'Yes. Every new account starts with free documents to try Maestra before deciding whether to subscribe. Once those run out, a subscription keeps access going.' },
    { cat: 'Billing & subscription', icon: '📅', title: 'What plans are available, and how much do they cost?',
      body: 'Two subscription plans are offered: Monthly for PHP 199 per month, and Annual for PHP 1,990 per year (about PHP 166 per month). The Annual plan works out to roughly two months free compared to paying monthly.' },
    { cat: 'Billing & subscription', icon: '📱', title: 'How do I pay with GCash?',
      body: 'Choose a plan in Settings → Subscription, send the total to the GCash number shown, then enter your GCash reference number and submit. The admin verifies the payment and your access begins once it is approved.' },
    { cat: 'Billing & subscription', icon: '⏳', title: 'How long does payment approval take?',
      body: 'Once submitted, your payment goes to the admin for review. You will receive an email the moment it is approved, and your access begins automatically — you do not need to do anything further.' },
    { cat: 'Billing & subscription', icon: '🔁', title: 'How do I renew or upgrade my subscription?',
      body: 'Go to Settings → Subscription to see your current status. If your access has expired or you want to renew ahead of time, submit a new GCash payment for the plan you want and it will be reviewed by the admin.' },
    { cat: 'Billing & subscription', icon: '📬', title: 'What happens if my payment is rejected?',
      body: 'If a payment cannot be verified, the admin rejects it and your account status stays unchanged. You can submit a corrected payment with the right reference number. Contact your admin if you believe there was a mistake.' },

    { cat: 'Troubleshooting', icon: '⚙️', title: 'What does "daily allowance used up" mean?',
      body: 'The AI service is shared by all teachers, and the free tier has a limited number of tokens each day. When the allowance runs out, you briefly see a "try again in ~Xm" message. Other keys or a refreshed allowance kick in shortly after, so it is temporary and you do not need to do anything.' },
    { cat: 'Troubleshooting', icon: '🐌', title: 'Generation is slow or says try again later',
      body: 'This usually happens when the shared AI pool has hit its daily or per-minute cap. Wait a few minutes and try again. Adding more keys to the pool (done by the admin) increases shared capacity and reduces these pauses.' },
    { cat: 'Troubleshooting', icon: '🔑', title: 'I cannot sign in to my account',
      body: 'Check that you are using the email and password you registered with. If you have never signed in before, complete the sign-up flow for your invitation. For access issues, contact your administrator.' },
    { cat: 'Troubleshooting', icon: '🖼️', title: 'My download or preview looks off',
      body: 'Try re-generating the document after selecting a nearby template, or edit the text directly in the workspace. Formatting details can always be adjusted in the editor before you submit or print.' },
  ];

  const catMeta = {
    'Getting started': { icon: '🌱', blurb: 'New here? Start with the basics.' },
    'Using the AI editor': { icon: '✍️', blurb: 'Create, edit, and revise your documents.' },
    'Privacy & data': { icon: '🔒', blurb: 'How your information is handled.' },
    'Billing & subscription': { icon: '💳', blurb: 'Free documents, plans, and GCash payments.' },
    'Troubleshooting': { icon: '🛠️', blurb: 'Common messages and quick fixes.' },
  };

  const escA = (s) => esc(s);
  const card = (a) => `<article class="help-card">
      <button class="help-summary" type="button" data-help-toggle>
        <span class="help-icon" aria-hidden="true">${a.icon}</span>
        <span class="help-q">${escA(a.title)}</span><span class="help-caret" aria-hidden="true">›</span>
      </button>
      <div class="help-answer" hidden><p>${escA(a.body)}</p></div>
    </article>`;

  const renderSections = (list) => Object.keys(catMeta)
    .map((cat) => {
      const items = list.filter((a) => a.cat === cat);
      if (!items.length) return '';
      const m = catMeta[cat];
      return `<section class="help-section"><div class="help-cat-head"><span class="help-cat-icon">${m.icon}</span><div><h3>${escA(cat)}</h3><p>${escA(m.blurb)}</p></div></div>
        <div class="help-list">${items.map(card).join('')}</div></section>`;
    }).join('');

  const allHTML = renderSections(ARTICLES);

  root.innerHTML = `
    <header class="help-hero">
      <h1 class="title">Help center</h1>
      <p class="help-sub">Everything you need to make the most of BLinkMaestra — search a question, or browse by topic.</p>
      <div class="help-search"><span class="help-search-icon" aria-hidden="true">⌕</span>
        <input id="help-query" type="search" placeholder="Search help articles…" autocomplete="off">
        <span id="help-count" class="help-count"></span></div>
    </header>
    <div id="help-body">${allHTML}</div>
    <div class="help-section"><div class="help-cat-head"><span class="help-cat-icon">💬</span><div><h3>Still need help?</h3><p>Can’t find what you’re looking for?</p></div></div>
      <div class="help-contact"><p>Get in touch and we’ll point you in the right direction. Check your <button class="help-link" data-nav-jump="settings">Settings</button>, or contact your administrator for account and billing questions.</p></div></div>`;

  const body = root.querySelector('#help-body');
  const countEl = root.querySelector('#help-count');
  const q = root.querySelector('#help-query');

  root.addEventListener('click', (e) => {
    const sum = e.target.closest('[data-help-toggle]');
    if (sum) {
      const cardEl = sum.closest('.help-card');
      const ans = cardEl.querySelector('.help-answer');
      const open = !ans.hidden;
      ans.hidden = open;
      cardEl.classList.toggle('open', !open);
    }
  });

  const findMatches = (query) => {
    const t = query.trim().toLowerCase();
    if (!t) return ARTICLES;
    const scored = ARTICLES.map((a) => {
      const title = a.title.toLowerCase();
      const bodyTxt = a.body.toLowerCase();
      let score = 0;
      if (title === t) score = 4;
      else if (title.startsWith(t)) score = 3;
      else if (title.includes(t)) score = 2;
      else if (bodyTxt.includes(t)) score = 1;
      if (t.split(' ').every((w) => title.includes(w))) score += 1;
      return { a, score };
    }).filter((s) => s.score > 0).sort((x, y) => y.score - x.score);
    return scored.map((s) => s.a);
  };

  q.addEventListener('input', () => {
    const matches = findMatches(q.value);
    body.innerHTML = matches.length ? renderSections(matches) : `<div class="help-empty"><p>No articles match “${escA(q.value)}”. Try a different keyword.</p></div>`;
    countEl.textContent = q.value.trim() ? `${matches.length} result${matches.length === 1 ? '' : 's'}` : '';
  });

  bindCommon(root);
}

// ---------- Paywall (subscription required) ----------
async function paywallView(root) {
  let me;
  try { me = await api.me(); }
  catch { root.innerHTML = '<div class="card"><p class="card-copy">Please sign in to continue.</p></div>'; return; }
  const plan = me.payments?.plan || { perMonth: 199, annualTotal: 1990, gcashNumber: '' };
  const perMonth = plan.perMonth || 199;
  const annualTotal = plan.annualTotal || 1990;
  const annualEff = plan.annualEffectiveMonthly === undefined ? Math.round(annualTotal / 12) : plan.annualEffectiveMonthly;
  const pending = (me.payments?.pendingOrders || []);

  // A payment is already waiting for admin approval — show a review notice
  // instead of the "used up" form so the teacher isn't asked to pay again.
  if (pending.length) {
    const latest = pending[0];
    root.innerHTML = `<div class="card" style="max-width:560px;margin:48px auto;text-align:center;padding:40px">
      <h1 class="title">Payment under review</h1>
      <p class="card-copy" style="margin:12px 0 20px">Thank you — your payment of <strong>PHP ${(latest.total || 0).toLocaleString()}</strong> for <strong>${latest.months || ''} month${((latest.months || 0) > 1 ? 's' : '')}</strong> has been submitted and is awaiting approval.</p>
      <div class="card-copy" style="padding:14px;border:1px solid var(--line);border-radius:12px;text-align:left">
        <p style="margin:0 0 6px"><strong>Status:</strong> <span class="tag" style="background:#fff3cd;color:#8a6d1a">Pending review</span></p>
        <p style="margin:0 0 6px"><strong>Submitted:</strong> ${new Date(latest.createdAt).toLocaleString()}</p>
        <p style="margin:0">You'll receive an <strong>email</strong> as soon as the admin approves your payment. Once approved, your access begins automatically.</p>
      </div>
      <p class="card-copy" style="margin-top:18px">Need to check something? <a href="#" data-nav-jump="settings">Manage in Settings</a>.</p>
    </div>`;
    root.querySelectorAll('[data-nav-jump]').forEach((b) => b.addEventListener('click', () => go({ name: b.dataset.navJump })));
    return;
  }

  root.innerHTML = `<div class="card" style="max-width:560px;margin:48px auto;text-align:center;padding:40px">
    <h1 class="title">Your free documents are used up</h1>
    <p class="card-copy" style="margin:12px 0 20px">Keep creating with a BLinkMaestra subscription. Choose how many months to pay for, then submit your GCash payment for review. Your access begins the day the admin approves it.</p>
    <div style="display:flex;flex-direction:column;gap:12px;align-items:stretch;margin:0 auto;max-width:380px;text-align:left">
      <label style="font-weight:600;font-size:13px">Plan
        <select id="pw-plan" style="margin-top:4px">
          <option value="monthly">Monthly — PHP ${perMonth.toLocaleString()}/month</option>
          <option value="annual">Annual — PHP ${annualTotal.toLocaleString()}/year (about PHP ${annualEff}/month)</option>
        </select>
      </label>
      <p class="card-copy" id="pw-quote" style="font-weight:600"></p>
      <label style="font-weight:600;font-size:13px">Pay via GCash to
        <strong style="display:block;font-size:20px;color:var(--forest);margin-top:4px">${esc(plan.gcashNumber || '')}</strong>
      </label>
      <label style="font-weight:600;font-size:13px">GCash reference number
        <input id="pw-ref" placeholder="e.g. 4409 3123 4567 8901" required>
      </label>
      <label style="font-weight:600;font-size:13px">Note (optional)
        <input id="pw-note" placeholder="Anything we should know?">
      </label>
      <button class="button" id="pw-submit">Submit payment for review</button>
    </div>
    <p class="card-copy" id="pw-status" style="margin-top:16px"></p></div>`;

  const planEl = root.querySelector('#pw-plan');
  const quoteEl = root.querySelector('#pw-quote');
  const refreshQuote = () => {
    const v = planEl.value;
    quoteEl.textContent = v === 'annual'
      ? `Total: PHP ${annualTotal.toLocaleString()} — send this amount via GCash.`
      : `Total: PHP ${perMonth.toLocaleString()} — send this amount via GCash.`;
  };
  refreshQuote();
  planEl.addEventListener('change', refreshQuote);

  root.querySelector('#pw-submit').addEventListener('click', async () => {
    const btn = root.querySelector('#pw-submit');
    const status = root.querySelector('#pw-status');
    const ref = root.querySelector('#pw-ref').value.trim();
    if (!ref) { status.textContent = 'Please enter your GCash reference number.'; return; }
    btn.disabled = true;
    status.textContent = '';
    try {
      await api.createOrder({ plan: planEl.value, ref, note: root.querySelector('#pw-note').value.trim() });
      status.textContent = 'Payment submitted for review! You will be emailed once it is approved.';
      root.querySelector('#pw-ref').value = '';
    } catch (err) { status.textContent = err.message; }
    btn.disabled = false;
  });
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
    else if (route.name === 'paywall') { shell('', 'Subscription required'); paywallView(document.getElementById('page-root')); }
    else { shell('', 'Dashboard'); await dashboardView(document.getElementById('page-root')); }
  } catch (err) {
    console.error(err);
    if (err.status === 401) { state.user = null; return authScreen(); }
    if (err.code === 'subscription_required') { return go({ name: 'paywall' }); }
    document.getElementById('page-root').innerHTML = `<div class="card" style="max-width:520px;margin:60px auto;text-align:center;padding:40px">
      <h2 style="font:700 22px Fraunces,serif">Something went wrong</h2>
      <p class="card-copy" style="margin:12px 0 20px">${esc(err.message || "We couldn't load this page. Your work has been saved.")}</p>
      <button class="button" id="retry-btn">Go to Dashboard</button></div>`;
    document.getElementById('retry-btn').addEventListener('click', () => go({ name: 'dashboard' }));
  }
}

// ---------- Init ----------
async function completeAuth(r) {
  state.user = r.user;
  state.profile = r.profile;
  state.capabilities = await api.capabilities();
  if (!state.profile.onboardingComplete) return onboardingScreen(0);
  go({ name: 'dashboard' });
}

(async function init() {
  try {
    const me = await api.me();
    state.user = me.user;
    state.profile = me.profile;
    state.capabilities = await api.capabilities();
    if (!state.profile.onboardingComplete) return onboardingScreen(0);
    go({ name: 'dashboard' });
  } catch {
    // A magic sign-in link arrives as #magic=<token>. Verify it to create a session.
    const magic = (location.hash || '').match(/#magic=([^&]+)/);
    if (magic) {
      try {
        const r = await api.verifyMagicLink(decodeURIComponent(magic[1]));
        history.replaceState(null, '', location.pathname);
        // First-time sign-ins must set a password (account activation) before
        // entering the app. On every later visit they sign in with email + password.
        if (!r.user.hasPassword) {
          return passwordSetupScreen(r.user);
        }
        return completeAuth(r);
      } catch (err) {
        toast(err.message);
      }
    }
    // A password reset link arrives as #reset=<token>. Prefill the confirm screen.
    const resetMatch = (location.hash || '').match(/#reset=([^&]+)/);
    if (resetMatch) {
      history.replaceState(null, '', location.pathname);
      return authScreen('confirm', decodeURIComponent(resetMatch[1]));
    }
    // Landing page links here with #register to go straight to account creation.
    authScreen(location.hash === '#register' ? 'register' : 'login');
  }
})();
