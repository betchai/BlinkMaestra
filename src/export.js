// Converts the HTML produced by the pipeline (h1/h2/p/ul/ol/table with plain text,
// including TOS exam output with <li value="N"> items and nested options) into real
// DOCX and PDF files.

import { Document, Packer, Paragraph, HeadingLevel, TableCell, TableRow, Table, WidthType } from 'docx';
import PDFDocument from 'pdfkit';
import PptxGenJS from 'pptxgenjs';

// Split a list inner HTML into TOP-LEVEL <li> groups, tracking depth so nested
// option <li>s inside a nested <ul> do not end the parent item early.
function splitTopLevelLi(inner) {
  const items = [];
  const re = /<li\b[^>]*>|<\/li>/gi;
  let depth = 0;
  let start = -1;
  let m;
  while ((m = re.exec(inner))) {
    if (m[0].startsWith('</')) {
      depth--;
      if (depth === 0) {
        items.push(inner.slice(start, m.index + 5));
        start = -1;
      }
    } else {
      if (depth === 0) start = m.index;
      depth++;
    }
  }
  return items;
}

function stripTags(s) {
  return (s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseItems(inner, fallbackStart = 1) {
  return splitTopLevelLi(inner).map((li, i) => {
    const numberMatch = li.match(/<li\b[^>]*\bvalue\s*=\s*["']?(\d+)["']?/i);
    const number = numberMatch ? Number(numberMatch[1]) : fallbackStart + i;
    const optionsMatch = li.match(/<ul[\s\S]*?<\/ul>/i);
    const sub = optionsMatch ? splitTopLevelLi(optionsMatch[0]).map(stripTags) : [];
    const noOptions = optionsMatch ? li.slice(0, optionsMatch.index) + li.slice(optionsMatch.index + optionsMatch[0].length) : li;
    const text = stripTags(noOptions.replace(/^<li\b[^>]*>/i, ''));
    return { number, text, sub };
  });
}

function parseBlocks(html) {
  const blocks = [];
  const blockRe = /<(h1|h2|p|ul|ol|table)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = blockRe.exec(html))) {
    const [, tag, inner] = match;
    if (tag === 'ul') {
      blocks.push({ type: 'bullets', items: splitTopLevelLi(inner).map(stripTags) });
    } else if (tag === 'ol') {
      blocks.push({ type: 'numbers', items: parseItems(inner) });
    } else if (tag === 'table') {
      const rows = [...inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) =>
        [...r[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => stripTags(c[1]))
      );
      blocks.push({ type: 'table', rows });
    } else {
      blocks.push({ type: tag, text: stripTags(inner) });
    }
  }
  return blocks;
}

function docxChildren(blocks) {
  const children = [];
  for (const b of blocks) {
    if (b.type === 'h1') children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: b.text }));
    else if (b.type === 'h2') children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, text: b.text }));
    else if (b.type === 'bullets') b.items.forEach((t) => children.push(new Paragraph({ text: t, bullet: { level: 0 } })));
    else if (b.type === 'numbers') {
      b.items.forEach((it) => {
        children.push(new Paragraph({ text: `${it.number}. ${it.text}` }));
        (it.sub || []).forEach((s) => children.push(new Paragraph({ text: s, indent: { left: 720 } })));
      });
    } else if (b.type === 'table') {
      const rows = b.rows.map((cells) => new TableRow({ children: cells.map((c) => new TableCell({ children: [new Paragraph(c)] })) }));
      if (rows.length) children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
    } else children.push(new Paragraph(b.text));
  }
  return children;
}

export async function toDocx(title, html) {
  const doc = new Document({ sections: [{ children: [new Paragraph({ heading: HeadingLevel.TITLE, text: title }), ...docxChildren(parseBlocks(html))] }] });
  return Packer.toBuffer(doc);
}

export async function toPdf(title, html) {
  const doc = new PDFDocument({ margin: 54, size: 'A4' });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', resolve));

  doc.fontSize(18).font('Helvetica-Bold').text(title, { paragraphGap: 12 });
  for (const b of parseBlocks(html)) {
    if (b.type === 'h1') doc.font('Helvetica-Bold').fontSize(14).text(b.text);
    else if (b.type === 'h2') doc.font('Helvetica-Bold').fontSize(12).text(b.text);
    else if (b.type === 'bullets') b.items.forEach((t) => doc.font('Helvetica').fontSize(11).text(`• ${t}`, { indent: 14 }));
    else if (b.type === 'numbers') {
      b.items.forEach((it) => {
        doc.font('Helvetica').fontSize(11).text(`${it.number}. ${it.text}`, { indent: 8 });
        (it.sub || []).forEach((s) => doc.font('Helvetica').fontSize(11).text(s, { indent: 24 }));
      });
    } else if (b.type === 'table') {
      for (const row of b.rows) doc.font('Helvetica').fontSize(10).text(row.join('   |   '), { indent: 8 });
      doc.moveDown(0.5);
    } else doc.font('Helvetica').fontSize(11).text(b.text);
    doc.moveDown(0.3);
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

// Builds a widescreen slide deck from the same parsed HTML blocks used by DOCX/PDF.
// Lesson-plan style documents come through as h1/h2 section headings with bullets,
// so each heading becomes a section slide and its following content is placed as
// bullets/paragraphs (chunked across slides when long).
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const FOREST = '087F6A';
const FOREST_DARK = '056756';
const INK = '13233E';
const MUTED = '63728B';
const CREAM = 'F7F9FC';

function pptxTextsFor(blocks) {
  return blocks
    .filter((b) => b.type === 'p' || b.type === 'bullets' || b.type === 'numbers')
    .flatMap((b) => {
      if (b.type === 'bullets') return b.items.map((t) => ({ text: t, bullet: true }));
      if (b.type === 'numbers') {
        const out = [];
        b.items.forEach((it) => {
          out.push({ text: `${it.number}. ${it.text}`, bullet: false });
          (it.sub || []).forEach((s) => out.push({ text: s, bullet: true }));
        });
        return out;
      }
      return [{ text: b.text, bullet: false }];
    });
}

export async function toPptx(title, html, meta = {}) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'BLinkMaestra';
  pptx.company = 'BLinkMaestra';

  const blocks = parseBlocks(html);

  // Title slide.
  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: FOREST_DARK };
  titleSlide.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: 0.18, fill: { color: 'E8A62B' } });
  titleSlide.addText(title, { x: 0.9, y: 2.4, w: 11.5, h: 1.8, fontSize: 30, bold: true, color: 'FFFFFF', fontFace: 'Arial', breakLine: true });
  titleSlide.addText(meta.kicker || 'Lesson Plan', { x: 0.92, y: 2.05, w: 11.5, h: 0.35, fontSize: 13, color: 'E8A62B', charSpacing: 2 });
  titleSlide.addText('BLinkMaestra', { x: 0.92, y: 6.7, w: 4, h: 0.3, fontSize: 10, color: 'CFE0DA' });
  if (meta.subject) titleSlide.addText(meta.subject, { x: 0.92, y: 4.3, w: 11.5, h: 0.4, fontSize: 16, color: 'EAF6F1' });

  // Section slides: one per h1/h2 heading (excluding the document title if repeated).
  let current = null; // { title, isH1, body: [] }
  const titleKey = title.trim().toLowerCase();
  const pushCurrent = () => {
    if (!current) return;
    const items = current.body;
    const perSlide = current.isH1 ? 7 : 8;
    const chunkSize = Math.max(perSlide, 1);
    const chunks = items.length
      ? Array.from({ length: Math.ceil(items.length / chunkSize) }, (_, i) => items.slice(i * chunkSize, i * chunkSize + chunkSize))
      : [[]];
    chunks.forEach((chunk, index) => {
      const slide = pptx.addSlide();
      slide.background = { color: index === 0 ? CREAM : 'FFFFFF' };
      slide.addShape('rect', { x: 0, y: 0, w: 0.14, h: SLIDE_H, fill: { color: FOREST } });
      slide.addText(current.title, { x: 0.7, y: 0.5, w: 11.8, h: 0.8, fontSize: current.isH1 ? 24 : 20, bold: true, color: INK, fontFace: 'Arial' });
      const body = chunk.map((it) => ({
        text: it.text,
        options: {
          bullet: it.bullet ? { code: '2022' } : false,
          color: INK, fontSize: 14, breakLine: true, paraSpaceAfter: 8,
        },
      }));
      if (body.length) {
        slide.addText(body, { x: 0.7, y: 1.5, w: 11.9, h: 5.3, valign: 'top', fit: 'shrink' });
      } else {
        slide.addText('—', { x: 0.7, y: 1.5, w: 11.9, h: 0.5, color: MUTED, fontSize: 14 });
      }
      if (meta.subject) slide.addText(meta.subject, { x: 0.9, y: 7.0, w: 8, h: 0.3, fontSize: 10, color: MUTED });
    });
    current = null;
  };

  for (const b of blocks) {
    if (b.type === 'h1' || b.type === 'h2') {
      const isTitleDup = b.text.trim().toLowerCase() === titleKey;
      if (isTitleDup) continue;
      pushCurrent();
      current = { title: b.text, isH1: b.type === 'h1', body: [] };
    } else if ((b.type === 'p' || b.type === 'bullets' || b.type === 'numbers') && current) {
      const parsed = pptxTextsFor([b]);
      current.body.push(...parsed);
    } else if (b.type === 'table' && current) {
      b.rows.forEach((row) => current.body.push({ text: row.join('   |   '), bullet: false }));
    }
  }
  pushCurrent();

  if (pptx.slides.length <= 1) {
    // Nothing structurally grouped — fall back to a single summary slide.
    const slide = pptx.addSlide();
    slide.background = { color: CREAM };
    slide.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: 0.14, fill: { color: FOREST } });
    slide.addText(title, { x: 0.7, y: 0.4, w: 11.9, h: 0.9, fontSize: 22, bold: true, color: INK });
    const body = pptxTextsFor(blocks).map((it) => ({ text: it.text, options: { bullet: it.bullet ? { code: '2022' } : false, color: INK, fontSize: 13, breakLine: true, paraSpaceAfter: 6 } }));
    if (body.length) slide.addText(body, { x: 0.7, y: 1.5, w: 11.9, h: 5.5, fit: 'shrink', valign: 'top' });
  }

  return pptx.write('nodebuffer');
}

// Renders AI-generated slide-deck JSON ({ title, subject, slides:[{heading,bullets,notes}] })
// into a branded, editable PPTX with the BLinkMaestra logo signature pinned to the
// bottom-right of every slide. The logo is embedded as a fixed image (not text), so
// it acts as a non-editable signature.
const LOGO_SIZE_H = 0.34; // in inches; width auto-scales to preserve aspect ratio
const LOGO_X = SLIDE_W - 0.35 - 1.1;
const LOGO_Y = SLIDE_H - 0.38 - LOGO_SIZE_H;

export async function renderDeckPptx(deck, logoPath) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'BLinkMaestra';
  pptx.company = 'BLinkMaestra';

  const slides = Array.isArray(deck.slides) ? deck.slides : [];

  // Title slide.
  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: FOREST_DARK };
  titleSlide.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: 0.18, fill: { color: 'E8A62B' } });
  titleSlide.addText(deck.subject || 'Lesson Plan', { x: 0.92, y: 1.95, w: 11.5, h: 0.4, fontSize: 15, color: 'E8A62B', charSpacing: 2 });
  titleSlide.addText(deck.title || 'Lesson', { x: 0.9, y: 2.5, w: 11.5, h: 1.8, fontSize: 32, bold: true, color: 'FFFFFF', fontFace: 'Arial', breakLine: true });
  titleSlide.addText(`${slides.length} slides · BLinkMaestra`, { x: 0.92, y: 6.1, w: 6, h: 0.3, fontSize: 12, color: 'CFE0DA' });
  if (logoPath) titleSlide.addImage({ path: logoPath, x: SLIDE_W - 0.6 - 1.3, y: SLIDE_H - 0.55 - LOGO_SIZE_H, h: LOGO_SIZE_H, sizing: { type: 'contain' } });

  // Content slides (chunk bullets to keep them readable).
  slides.forEach((s, i) => {
    const bullets = s.bullets || [];
    const per = 6;
    const chunks = bullets.length ? Array.from({ length: Math.ceil(bullets.length / per) }, (_, k) => bullets.slice(k * per, k * per + per)) : [[]];
    chunks.forEach((chunk, k) => {
      const slide = pptx.addSlide();
      slide.background = { color: 'FFFFFF' };
      slide.addShape('rect', { x: 0, y: 0, w: 0.16, h: SLIDE_H, fill: { color: FOREST } });
      slide.addShape('rect', { x: 0, y: SLIDE_H - 0.16, w: SLIDE_W, h: 0.16, fill: { color: CREAM } });
      slide.addText(s.heading, { x: 0.7, y: 0.55, w: 11.8, h: 0.9, fontSize: 24, bold: true, color: INK, fontFace: 'Arial', breakLine: true });
      const body = chunk.map((b, bi) => ({
        text: b,
        options: { bullet: { code: '2022' }, color: INK, fontSize: 15, breakLine: true, paraSpaceAfter: 12 },
      }));
      if (body.length) slide.addText(body, { x: 0.7, y: 1.6, w: 11.9, h: 4.9, valign: 'top', fit: 'shrink' });
      if (slides.length > 1) slide.addText(`${i + 1}`, { x: SLIDE_W - 1.6, y: 0.45, w: 0.8, h: 0.4, fontSize: 13, color: MUTED, align: 'right' });
      if (s.notes) slide.addNotes(s.notes);
      if (logoPath) slide.addImage({ path: logoPath, x: LOGO_X, y: LOGO_Y, h: LOGO_SIZE_H, sizing: { type: 'contain' } });
    });
  });

  return pptx.write('nodebuffer');
}