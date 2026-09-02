// Converts the HTML produced by the pipeline (h1/h2/p/ul/ol/table with plain text,
// including TOS exam output with <li value="N"> items and nested options) into real
// DOCX and PDF files.

import { Document, Packer, Paragraph, HeadingLevel, TableCell, TableRow, Table, WidthType } from 'docx';
import PDFDocument from 'pdfkit';

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