// Thin API client. All privileged calls happen server-side; no keys ever reach the browser.

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (response.headers.get('content-type')?.includes('application/json')) {
    const payload = await response.json();
    if (!response.ok) throw Object.assign(new Error(payload.error || 'Something went wrong. Please try again.'), { status: response.status, code: payload.code, entitlement: payload.entitlement });
    return payload;
  }
  if (!response.ok) throw new Error('Something went wrong. Please try again.');
  return response;
}

export const api = {
  register: (p) => request('/api/register', { method: 'POST', body: p }),
  login: (p) => request('/api/login', { method: 'POST', body: p }),
  logout: () => request('/api/logout', { method: 'POST' }),
  me: () => request('/api/me'),
  saveProfile: (p) => request('/api/profile', { method: 'PUT', body: p }),
  requestReset: (email) => request('/api/password-reset', { method: 'POST', body: { email } }),
  confirmReset: (p) => request('/api/password-reset/confirm', { method: 'POST', body: p }),

  requestMagicLink: (email) => request('/api/magic-request', { method: 'POST', body: { email } }),
  verifyMagicLink: (token) => request(`/api/magic/verify?token=${encodeURIComponent(token)}`),
  setPassword: (p) => request('/api/set-password', { method: 'POST', body: p }),

  aiConfig: (includeKeys = false) => request(`/api/admin/ai-config${includeKeys ? '?includeKeys=true' : ''}`),
  saveAiConfig: (p) => request('/api/admin/ai-config', { method: 'PUT', body: p }),

  billingQuote: (plan) => request('/api/billing/quote', { method: 'POST', body: { plan } }),
  createOrder: (p) => request('/api/billing/orders', { method: 'POST', body: p }),
  myOrders: () => request('/api/billing/orders').then((r) => r.orders),
  adminOrders: () => request('/api/admin/billing/orders').then((r) => r.orders),
  adminSubscriptionDirectory: () => request('/api/admin/users/subscriptions'),
  approveOrder: (id) => request(`/api/admin/billing/orders/${id}/approve`, { method: 'POST', body: {} }),
  rejectOrder: (id, reason) => request(`/api/admin/billing/orders/${id}/reject`, { method: 'POST', body: { reason } }),
  setPaymentsEnabled: (enabled) => request('/api/admin/billing/payments-toggle', { method: 'POST', body: { enabled } }),
  report: () => request('/api/admin/report'),
  activity: (query = {}) => {
    const qs = new URLSearchParams();
    if (query.q) qs.set('q', query.q);
    if (query.teacher) qs.set('teacher', query.teacher);
    if (query.capability) qs.set('capability', query.capability);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request(`/api/admin/activity${suffix}`);
  },

  documents: () => request('/api/documents').then((r) => r.documents),
  document: (id) => request(`/api/documents/${id}`).then((r) => r.document),
  createDocument: (p) => request('/api/documents', { method: 'POST', body: p }).then((r) => r.document),
  updateDocument: (id, p) => request(`/api/documents/${id}`, { method: 'PUT', body: p }).then((r) => r.document),
  setDocumentStatus: (id, status) => request(`/api/documents/${id}/status`, { method: 'POST', body: { status } }).then((r) => r.document),
  deleteDocument: (id, permanent = false) => request(`/api/documents/${id}${permanent ? '?permanent=true' : ''}`, { method: 'DELETE' }),
  restoreDocument: (id) => request(`/api/documents/${id}/restore-document`, { method: 'POST' }),
  duplicateDocument: (id) => request(`/api/documents/${id}/duplicate`, { method: 'POST' }).then((r) => r.document),
  restoreVersion: (docId, versionId) => request(`/api/documents/${docId}/versions/${versionId}/restore`, { method: 'POST' }).then((r) => r.document),
  feedback: (id, p) => request(`/api/documents/${id}/feedback`, { method: 'POST', body: p }),

  capabilities: () => request('/api/capabilities').then((r) => r.capabilities),
  routeText: (text) => request('/api/route', { method: 'POST', body: { text } }),
  templates: () => request('/api/templates').then((r) => r.templates),
  knowledge: (capability) => request(`/api/knowledge${capability ? `?capability=${encodeURIComponent(capability)}` : ''}`).then((r) => r.references),

  startGeneration: (p) => request('/api/generate', { method: 'POST', body: p }),
  generationStatus: (jobId) => request(`/api/generate/${jobId}`),
  refine: (p) => request('/api/refine', { method: 'POST', body: p }).then((r) => r.result),
  chains: (capability) => request('/api/chains', { method: 'POST', body: { capability } }).then((r) => r.next),
  history: () => request('/api/history').then((r) => r.requests),

  exportDocument: async (id, format) => {
    const response = await fetch(`/api/documents/${id}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ format }),
    });
    if (!response.ok) {
      let message = 'We could not export the document right now.';
      try { message = (await response.json()).error || message; } catch {}
      throw new Error(message);
    }
    return response.blob();
  },

  generateLessonSlides: (id) => request(`/api/lessons/${id}/slides`, { method: 'POST', body: {} }),
  lessonSlides: (id) => request(`/api/lessons/${id}/slides`),

  downloadLessonSlides: async (id) => {
    const response = await fetch(`/api/lessons/${id}/slides/download`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      let message = 'We could not download the slide deck.';
      try { message = (await response.json()).error || message; } catch {}
      throw new Error(message);
    }
    return response.blob();
  },
};
