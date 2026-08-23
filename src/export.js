// Converts the limited HTML subset produced by the pipeline (h1/h2/p/ul/ol/table with plain text)
// into real DOCX and PDF files.

import { Document, Packer, Paragraph, HeadingLevel, TextRun, Table, TableRow, TableCell, WidthType } from 'docx';
import PDFDocument from 'pdfkit';

function parseBlocks(html) {
  const blocks = [];
  const blockRe = /<(h1|h2|p|ul|ol|table)>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = blockRe.exec(html))) {
    const [, tag, inner] = match;
    if (tag === 'ul' || tag === 'ol') {
      const items = [...inner.matchAll(/<li>([\s\S]*?)<\/li>/gi)].map((m) => stripTags(m[1]));
      blocks.push({ type: tag === 'ul' ? 'bullets' : 'numbers', items });
    } else if (tag === 'table') {
      const rows = [...inner.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map((r) =>
        [...r[1].matchAll(/<t[hd]>([\s\S]*?)<\/t[hd]>/gi)].map((c) => stripTags(c[1]))
      );
      blocks.push({ type: 'table', rows });
    } else {
      blocks.push({ type: tag, text: stripTags(inner) });
    }
  }
  return blocks;
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();
}

function docxChildren(blocks) {
  const children = [];
  for (const b of blocks) {
    if (b.type === 'h1') children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: b.text }));
    else if (b.type === 'h2') children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, text: b.text }));
    else if (b.type === 'bullets') b.items.forEach((t) => children.push(new Paragraph({ text: t, bullet: { level: 0 } })));
    else if (b.type === 'numbers') b.items.forEach((t, i) => children.push(new Paragraph({ text: `${i + 1}. ${t}` })));
    else if (b.type === 'table') {
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

  const write = (text, opts = {}) => {
    if (!text) return;
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size || 11);
    if (opts.indent) doc.list([text], { indent: opts.indent });
    else doc.text(text);
  };

  doc.fontSize(18).font('Helvetica-Bold').text(title, { paragraphGap: 12 });
  for (const b of parseBlocks(html)) {
    if (b.type === 'h1') write(b.text, { bold: true, size: 14 });
    else if (b.type === 'h2') write(b.text, { bold: true, size: 12 });
    else if (b.type === 'bullets') b.items.forEach((t) => doc.font('Helvetica').fontSize(11).text(`• ${t}`, { indent: 14 }));
    else if (b.type === 'numbers') b.items.forEach((t, i) => doc.font('Helvetica').fontSize(11).text(`${i + 1}. ${t}`, { indent: 14 }));
    else if (b.type === 'table') {
      for (const row of b.rows) {
        doc.font('Helvetica').fontSize(10).text(row.join('   |   '), { indent: 8 });
      }
      doc.moveDown(0.5);
    } else write(b.text);
    doc.moveDown(0.3);
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}
