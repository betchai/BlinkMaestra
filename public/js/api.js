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
    if (!response.ok) throw Object.assign(new Error(payload.error || 'Something went wrong. Please try again.'), { status: response.status });
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

  documents: () => request('/api/documents').then((r) => r.documents),
  document: (id) => request(`/api/documents/${id}`).then((r) => r.document),
  createDocument: (p) => request('/api/documents', { method: 'POST', body: p }).then((r) => r.document),
  updateDocument: (id, p) => request(`/api/documents/${id}`, { method: 'PUT', body: p }).then((r) => r.document),
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
};
