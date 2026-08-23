export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
export function toast(message) {
  document.querySelector('.toast')?.remove();
  const el = h(`<div class="toast" role="status">${esc(message)}</div>`);
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3200);
}

export function modal(contentHtml) {
  const overlay = h(`<div class="modal search-modal" role="dialog" aria-modal="true">${contentHtml}</div>`);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  return overlay;
}

export function field(label, inputHtml, optional = false) {
  return `<div class="field"><label>${esc(label)}${optional ? ' <span class="optional">(optional)</span>' : ''}</label>${inputHtml}</div>`;
}
