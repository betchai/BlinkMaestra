import { randomUUID } from 'node:crypto';
import { db, save, audit } from './db.js';

function safeDocument(d) {
  return { ...d, versions: undefined, versionCount: d.versions.length };
}
export { safeDocument };

export async function listDocuments(userId) {
  const data = await db();
  return data.documents.filter((d) => d.ownerId === userId).map(safeDocument);
}

export async function createDocument(userId, p) {
  const data = await db();
  const now = new Date().toISOString();
  const d = {
    id: randomUUID(),
    ownerId: userId,
    title: p.title || 'Untitled document',
    capability: p.capability || 'General',
    documentType: p.documentType || 'Document',
    status: p.status || 'Draft',
    locked: !!p.locked,
    tags: p.tags || [],
    folder: p.folder || 'My Documents',
    favorite: false,
    archived: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    contentHtml: p.contentHtml || '',
    context: p.context || {},
    references: p.references || [],
    relatedWork: p.relatedWork || [],
    validation: p.validation || null,
    feedback: null,
    versions: [{ id: randomUUID(), number: 1, contentHtml: p.contentHtml || '', createdAt: now, source: 'create' }],
  };
  data.documents.push(d);
  await audit(data, userId, 'document-create', { id: d.id });
  await save(data);
  return safeDocument(d);
}

async function findRaw(userId, docId) {
  const data = await db();
  const d = data.documents.find((x) => x.id === docId && x.ownerId === userId);
  if (!d) throw Object.assign(new Error('That document was not found.'), { status: 404 });
  return { data, d };
}

export async function getDocument(userId, docId) {
  const { d } = await findRaw(userId, docId);
  return { ...d, versionCount: d.versions.length };
}

export async function updateDocument(userId, docId, p) {
  const { data, d } = await findRaw(userId, docId);
  const changed = typeof p.contentHtml === 'string' && p.contentHtml !== d.contentHtml;
  if (changed) {
    // A Final document is locked against accidental edits. Use "edit anyway" to unlock it.
    if (d.locked) throw Object.assign(new Error('This document is marked as final and locked. Use "Edit anyway" to unlock it before making changes.'), { status: 423, code: 'doc_locked' });
    // Keep the previous state as a restorable version; never silently overwrite.
    d.versions.push({
      id: randomUUID(),
      number: d.versions.length + 1,
      contentHtml: d.contentHtml,
      createdAt: d.updatedAt,
      source: p.source || 'edit',
    });
    if (d.versions.length > 50) d.versions = d.versions.slice(-50);
  }
  delete p.versions;
  Object.assign(d, p, { id: d.id, ownerId: d.ownerId, updatedAt: new Date().toISOString() });
  await audit(data, userId, 'document-update', { id: docId });
  await save(data);
  return safeDocument(d);
}

export async function softDeleteDocument(userId, docId) {
  const { data, d } = await findRaw(userId, docId);
  d.deletedAt = new Date().toISOString();
  d.status = 'Deleted';
  await save(data);
  return safeDocument(d);
}

// Set a document's workflow status. Marking Final locks it (accidental-edit guard);
// marking Draft unlocks it (the "Edit anyway" path). Admins always bypass.
export async function setDocumentStatus(userId, docId, status) {
  const { data, d } = await findRaw(userId, docId);
  if (status === 'Final') {
    d.status = 'Final';
    d.locked = true;
    d.unlockedAt = null;
  } else if (status === 'In Progress') {
    d.status = 'In Progress';
    d.locked = false;
  } else {
    d.status = 'Draft';
    d.locked = false;
  }
  d.updatedAt = new Date().toISOString();
  await audit(data, userId, 'document-status', { id: docId, status: d.status });
  await save(data);
  return safeDocument(d);
}

export async function restoreDocument(userId, docId) {
  const { data, d } = await findRaw(userId, docId);
  d.deletedAt = null;
  d.status = 'Draft';
  await save(data);
  return safeDocument(d);
}

export async function purgeDocument(userId, docId) {
  const { data } = await findRaw(userId, docId);
  data.documents = data.documents.filter((x) => !(x.id === docId && x.ownerId === userId));
  await audit(data, userId, 'document-purge', { id: docId });
  await save(data);
}

export async function duplicateDocument(userId, docId) {
  const { d: source } = await findRaw(userId, docId);
  return createDocument(userId, {
    ...source,
    title: `${source.title} (Copy)`,
    status: 'Draft',
    deletedAt: null,
    favorite: false,
  });
}

export async function restoreVersion(userId, docId, versionId) {
  const { data, d } = await findRaw(userId, docId);
  const v = d.versions.find((x) => x.id === versionId);
  if (!v) throw Object.assign(new Error('That version was not found.'), { status: 404 });
  d.versions.push({
    id: randomUUID(),
    number: d.versions.length + 1,
    contentHtml: d.contentHtml,
    createdAt: d.updatedAt,
    source: 'before restore',
  });
  d.contentHtml = v.contentHtml;
  d.updatedAt = new Date().toISOString();
  await save(data);
  return safeDocument(d);
}
