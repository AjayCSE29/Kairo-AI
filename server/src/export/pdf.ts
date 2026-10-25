import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';
import { marked, type Token } from 'marked';
import type { ClaimStatus, GraphDTO, GraphNodeDTO, SessionDetailDTO, SourceDTO } from '../../../shared/types';
import { MODELS } from '../../../shared/models';

const require = createRequire(import.meta.url);

const PAGE_MARGIN = { top: 48, bottom: 50, left: 48, right: 48 };
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN.left - PAGE_MARGIN.right;
const DISCLAIMER =
  'Evidence statuses reflect the cited material available to this run. They are not a certification of absolute truth or independent verification.';

const COLORS = {
  text: '#171717',
  secondary: '#555555',
  muted: '#777777',
  faint: '#929292',
  border: '#d4d4d4',
  rule: '#bdbdbd',
  panel: '#f2f2f2',
  panelBorder: '#dddddd',
  link: '#2c5168',
  supported: '#3f7254',
  contradicted: '#9a4d46',
  insufficient: '#8a6d32',
  question: '#3d3d3d',
  memo: '#faf6e9',
  memoBorder: '#bfb38f',
};

interface Fonts {
  body: string;
  bold: string;
  mono: string;
}

interface InlineRun {
  text: string;
  font: 'body' | 'bold' | 'mono';
  color?: string;
  link?: string;
  underline?: boolean;
}

interface BlockOptions {
  x: number;
  width: number;
  color?: string;
  size?: number;
}

function resolvePackageFile(packagePath: string): string | null {
  try {
    return require.resolve(packagePath);
  } catch {
    return null;
  }
}

function registerFonts(doc: PDFKit.PDFDocument): Fonts {
  const manropeRegular = resolvePackageFile('@fontsource/manrope/files/manrope-latin-400-normal.woff');
  const manropeBold = resolvePackageFile('@fontsource/manrope/files/manrope-latin-700-normal.woff');
  const plexMono = resolvePackageFile('@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff');

  if (manropeRegular) doc.registerFont('KairoBody', manropeRegular);
  if (manropeBold) doc.registerFont('KairoBold', manropeBold);
  if (plexMono) doc.registerFont('KairoMono', plexMono);

  const useManrope = Boolean(manropeRegular && manropeBold);
  return {
    body: useManrope ? 'KairoBody' : 'Helvetica',
    bold: useManrope ? 'KairoBold' : 'Helvetica-Bold',
    mono: plexMono ? 'KairoMono' : 'Courier',
  };
}

function fontFor(run: InlineRun, fonts: Fonts): string {
  if (run.font === 'bold') return fonts.bold;
  if (run.font === 'mono') return fonts.mono;
  return fonts.body;
}

function safeLink(href: string | null | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') return href;
  } catch {
    return undefined;
  }
  return undefined;
}

function collectInline(tokens: Token[] | undefined, context: { font: 'body' | 'bold' | 'mono'; color: string }, output: InlineRun[]) {
  if (!tokens) return;
  for (const token of tokens) {
    if (token.type === 'strong') {
      collectInline(token.tokens, { ...context, font: 'bold' }, output);
      continue;
    }
    if (token.type === 'em' || token.type === 'del') {
      collectInline(token.tokens, context, output);
      continue;
    }
    if (token.type === 'link') {
      const link = safeLink(token.href);
      collectInline(token.tokens, { ...context, color: link ? COLORS.link : context.color }, output);
      if (link) {
        const start = output.length - countTokenRuns(token.tokens);
        for (let index = Math.max(0, start); index < output.length; index += 1) {
          output[index].link = link;
          output[index].underline = true;
        }
      }
      continue;
    }
    if (token.type === 'codespan') {
      output.push({ text: token.text, font: 'mono', color: '#3b3b3b' });
      continue;
    }
    if (token.type === 'br') {
      output.push({ text: '\n', font: context.font, color: context.color });
      continue;
    }
    if (token.type === 'escape') {
      output.push({ text: token.text, font: context.font, color: context.color });
      continue;
    }
    if (token.type === 'image') {
      output.push({
        text: token.text ? `[Image: ${token.text}]` : '[Image]',
        font: context.font,
        color: context.color,
      });
      continue;
    }
    if (token.type === 'text') {
      if (token.tokens?.length) {
        collectInline(token.tokens, context, output);
      } else if (token.text) {
        output.push({ text: token.text, font: context.font, color: context.color });
      }
      continue;
    }
    const fallback = 'text' in token && typeof token.text === 'string' ? token.text : token.raw;
    if (fallback) output.push({ text: fallback, font: context.font, color: context.color });
  }
}

function countTokenRuns(tokens: Token[] | undefined): number {
  if (!tokens) return 0;
  let count = 0;
  for (const token of tokens) {
    if (token.type === 'strong' || token.type === 'em' || token.type === 'del' || token.type === 'link') {
      count += countTokenRuns(token.tokens);
    } else if (token.type !== 'br') {
      count += 1;
    }
  }
  return Math.max(1, count);
}

function mergeRuns(runs: InlineRun[]): InlineRun[] {
  const merged: InlineRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const previous = merged[merged.length - 1];
    if (previous && previous.font === run.font && previous.color === run.color && previous.link === run.link) {
      previous.text += run.text;
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

function inlineRuns(tokens: Token[] | undefined, color = COLORS.text, font: 'body' | 'bold' | 'mono' = 'body'): InlineRun[] {
  const runs: InlineRun[] = [];
  collectInline(tokens, { font, color }, runs);
  return mergeRuns(runs);
}

function plainInline(tokens: Token[] | undefined, fallback = ''): string {
  return inlineRuns(tokens).map(run => run.text).join('').replace(/\s+/g, ' ').trim() || fallback;
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function renderInline(
  doc: PDFKit.PDFDocument,
  tokens: Token[] | undefined,
  fonts: Fonts,
  options: BlockOptions & { font?: 'body' | 'bold'; moveDown?: number },
) {
  const runs = inlineRuns(tokens, options.color, options.font);
  if (!runs.length) return;
  const size = options.size ?? 9.5;
  runs.forEach((run, index) => {
    doc.font(fontFor(run, fonts)).fontSize(size).fillColor(run.color ?? options.color ?? COLORS.text);
    const textOptions: PDFKit.Mixins.TextOptions = {
      continued: index < runs.length - 1,
      width: options.width,
      lineGap: 1.5,
      ...(run.link ? { link: run.link, underline: run.underline } : {}),
    };
    if (index === 0) doc.text(run.text, options.x, doc.y, textOptions);
    else doc.text(run.text, textOptions);
  });
  if (options.moveDown) doc.moveDown(options.moveDown);
}

function sectionHeading(doc: PDFKit.PDFDocument, title: string, fonts: Fonts, kicker?: string) {
  const needed = 46;
  ensureSpace(doc, needed);
  doc.moveDown(0.65);
  if (kicker) {
    doc.font(fonts.mono).fontSize(7).fillColor(COLORS.muted).text(kicker.toUpperCase(), {
      characterSpacing: 0.7,
      width: CONTENT_WIDTH,
    });
    doc.moveDown(0.2);
  }
  doc.font(fonts.bold).fontSize(14).fillColor(COLORS.text).text(title, { width: CONTENT_WIDTH });
  doc.moveDown(0.3);
  doc.save().strokeColor(COLORS.rule).lineWidth(0.6).moveTo(PAGE_MARGIN.left, doc.y).lineTo(doc.page.width - PAGE_MARGIN.right, doc.y).stroke().restore();
  doc.moveDown(0.6);
}

function renderCodeBlock(doc: PDFKit.PDFDocument, text: string, fonts: Fonts, options: BlockOptions) {
  doc.font(fonts.mono).fontSize(8);
  const height = Math.min(doc.heightOfString(text || ' ', { width: options.width - 14 }) + 14, 600);
  ensureSpace(doc, height);
  const startY = doc.y;
  doc.save().fillColor(COLORS.panel).rect(options.x, startY, options.width, height).fill().restore();
  doc.save().fillColor(COLORS.rule).rect(options.x, startY, 2, height).fill().restore();
  doc.font(fonts.mono).fontSize(8).fillColor('#303030').text(text || ' ', options.x + 9, startY + 7, {
    width: options.width - 16,
    height: height - 12,
  });
  doc.y = startY + height + 7;
}

function renderTable(doc: PDFKit.PDFDocument, token: Extract<Token, { type: 'table' }>, fonts: Fonts, options: BlockOptions) {
  const columnCount = Math.max(1, token.header.length);
  const columnWidth = options.width / columnCount;
  const rows = [token.header, ...token.rows];
  for (const [rowIndex, row] of rows.entries()) {
    const font = rowIndex === 0 ? fonts.bold : fonts.body;
    doc.font(font).fontSize(8);
    const heights = row.map(cell =>
      doc.heightOfString(plainInline(cell.tokens, cell.text), { width: columnWidth - 8 }),
    );
    const rowHeight = Math.max(18, ...heights) + 8;
    ensureSpace(doc, rowHeight + 1);
    const startY = doc.y;
    if (rowIndex === 0) {
      doc.save().fillColor(COLORS.panel).rect(options.x, startY, options.width, rowHeight).fill().restore();
    }
    row.forEach((cell, columnIndex) => {
      doc
        .font(font)
        .fontSize(8)
        .fillColor(rowIndex === 0 ? COLORS.text : COLORS.secondary)
        .text(plainInline(cell.tokens, cell.text), options.x + columnIndex * columnWidth + 4, startY + 4, {
          width: columnWidth - 8,
          height: rowHeight - 8,
        });
    });
    doc
      .save()
      .strokeColor(COLORS.border)
      .lineWidth(0.5)
      .moveTo(options.x, startY + rowHeight)
      .lineTo(options.x + options.width, startY + rowHeight)
      .stroke()
      .restore();
    doc.y = startY + rowHeight;
  }
  doc.moveDown(0.55);
}

function renderList(doc: PDFKit.PDFDocument, token: Extract<Token, { type: 'list' }>, fonts: Fonts, options: BlockOptions, depth: number) {
  const indent = 14 * depth;
  let number = typeof token.start === 'number' ? token.start : 1;
  token.items.forEach((item, index) => {
    const marker = token.ordered ? `${number + index}.` : '•';
    ensureSpace(doc, 20);
    const y = doc.y;
    doc.font(token.ordered ? fonts.body : fonts.bold).fontSize(9.5).fillColor(COLORS.secondary);
    doc.text(marker, options.x + indent, y, { width: 18 });
    const markerBottom = doc.y;
    const contentTokens = item.tokens.filter(child => child.type !== 'list');
    const nestedLists = item.tokens.filter((child): child is Extract<Token, { type: 'list' }> => child.type === 'list');
    const inline = contentTokens.flatMap(child => {
      if (child.type === 'paragraph' || child.type === 'text' || child.type === 'heading') return child.tokens ?? [];
      if (child.type === 'code') return [];
      return 'tokens' in child && child.tokens ? child.tokens : [];
    });
    if (inline.length) {
      renderInline(doc, inline, fonts, { ...options, x: options.x + indent + 18, width: options.width - indent - 18 });
      doc.moveDown(0.2);
    }
    doc.y = Math.max(doc.y, markerBottom);
    for (const child of contentTokens) {
      if (child.type === 'code') {
        renderCodeBlock(doc, child.text, fonts, {
          ...options,
          x: options.x + indent + 18,
          width: options.width - indent - 18,
        });
      }
    }
    for (const nested of nestedLists) {
      renderList(doc, nested, fonts, { ...options, width: options.width - indent - 18 }, depth + 1);
    }
  });
  doc.moveDown(0.35);
}

function renderBlocks(doc: PDFKit.PDFDocument, tokens: Token[], fonts: Fonts, options: BlockOptions) {
  for (const token of tokens) {
    if (token.type === 'heading') {
      const sizes = [18, 15, 12.5, 11, 10.5, 10];
      const size = sizes[Math.min(token.depth - 1, sizes.length - 1)] ?? 10;
      ensureSpace(doc, size * 2.2);
      doc.font(fonts.bold).fontSize(size).fillColor(options.color ?? COLORS.text).text(plainInline(token.tokens, token.text), options.x, doc.y, {
        width: options.width,
        lineGap: 1,
      });
      doc.moveDown(token.depth <= 2 ? 0.55 : 0.35);
      continue;
    }
    if (token.type === 'paragraph' || token.type === 'text') {
      ensureSpace(doc, 18);
      renderInline(doc, token.tokens, fonts, { ...options, size: options.size ?? 9.5, moveDown: 0.5 });
      continue;
    }
    if (token.type === 'space') {
      if (doc.y < doc.page.height - doc.page.margins.bottom - 6) doc.moveDown(0.1);
      continue;
    }
    if (token.type === 'list') {
      renderList(doc, token as Extract<Token, { type: 'list' }>, fonts, options, 0);
      continue;
    }
    if (token.type === 'code') {
      renderCodeBlock(doc, token.text, fonts, options);
      continue;
    }
    if (token.type === 'blockquote') {
      ensureSpace(doc, 20);
      const startY = doc.y;
      const blockquote = token as Extract<Token, { type: 'blockquote' }>;
      renderBlocks(doc, blockquote.tokens ?? [], fonts, {
        ...options,
        x: options.x + 12,
        width: options.width - 12,
        color: COLORS.secondary,
      });
      doc.save().fillColor(COLORS.rule).rect(options.x, startY, 2, Math.max(10, doc.y - startY)).fill().restore();
      doc.moveDown(0.4);
      continue;
    }
    if (token.type === 'hr') {
      ensureSpace(doc, 12);
      doc.save().strokeColor(COLORS.rule).lineWidth(0.6).moveTo(options.x, doc.y).lineTo(options.x + options.width, doc.y).stroke().restore();
      doc.moveDown(0.7);
      continue;
    }
    if (token.type === 'table') {
      renderTable(doc, token as Extract<Token, { type: 'table' }>, fonts, options);
      continue;
    }
    if (token.type === 'html') {
      if (token.text.trim()) {
        ensureSpace(doc, 16);
        doc.font(fonts.body).fontSize(9).fillColor(COLORS.secondary).text(token.text.trim(), options.x, doc.y, {
          width: options.width,
        });
        doc.moveDown(0.45);
      }
    }
  }
}

function renderAnswer(doc: PDFKit.PDFDocument, session: SessionDetailDTO, fonts: Fonts) {
  const markdown = session.answer?.markdown ?? '_No answer was produced._';
  renderBlocks(doc, marked.lexer(markdown), fonts, {
    x: PAGE_MARGIN.left,
    width: CONTENT_WIDTH,
    size: 9.5,
    color: COLORS.text,
  });
}

function statusColor(status: ClaimStatus): string {
  if (status === 'Supported') return COLORS.supported;
  if (status === 'Contradicted') return COLORS.contradicted;
  if (status === 'Insufficient evidence') return COLORS.insufficient;
  return COLORS.muted;
}

function renderSources(doc: PDFKit.PDFDocument, sources: SourceDTO[], fonts: Fonts) {
  if (!sources.length) {
    doc.font(fonts.body).fontSize(9.5).fillColor(COLORS.muted).text('No sources were collected.', { width: CONTENT_WIDTH });
    return;
  }
  for (const source of sources) {
    ensureSpace(doc, 58);
    const startY = doc.y;
    doc.font(fonts.mono).fontSize(7.5).fillColor(COLORS.secondary).text(`[${source.id}]`, PAGE_MARGIN.left, startY, {
      width: 32,
    });
    doc.font(fonts.bold).fontSize(9.5).fillColor(COLORS.text).text(source.title, PAGE_MARGIN.left + 34, startY, {
      width: CONTENT_WIDTH - 34,
    });
    doc.font(fonts.body).fontSize(7.5).fillColor(COLORS.muted).text(
      `${source.domain}${source.kind ? ` · ${source.kind}` : ''}${source.date ? ` · ${source.date}` : ''} · ${source.relevance}% relevance`,
      PAGE_MARGIN.left + 34,
      doc.y,
      { width: CONTENT_WIDTH - 34 },
    );
    const link = safeLink(source.url);
    if (link) {
      doc.font(fonts.mono).fontSize(7).fillColor(COLORS.link).text(link, PAGE_MARGIN.left + 34, doc.y + 1, {
        width: CONTENT_WIDTH - 34,
        link,
        underline: true,
      });
    }
    doc.font(fonts.body).fontSize(8).fillColor(COLORS.secondary).text(source.excerpt, PAGE_MARGIN.left + 34, doc.y + 3, {
      width: CONTENT_WIDTH - 34,
      lineGap: 1,
    });
    if (source.relationship) {
      doc.font(fonts.body).fontSize(7.5).fillColor(COLORS.muted).text(source.relationship, PAGE_MARGIN.left + 34, doc.y + 2, {
        width: CONTENT_WIDTH - 34,
      });
    }
    doc.save().strokeColor(COLORS.border).lineWidth(0.5).moveTo(PAGE_MARGIN.left, doc.y + 6).lineTo(doc.page.width - PAGE_MARGIN.right, doc.y + 6).stroke().restore();
    doc.y += 12;
  }
}

function renderClaims(doc: PDFKit.PDFDocument, session: SessionDetailDTO, fonts: Fonts) {
  if (!session.claims.length) {
    doc.font(fonts.body).fontSize(9.5).fillColor(COLORS.muted).text('No claims were extracted.', { width: CONTENT_WIDTH });
    return;
  }
  for (const claim of session.claims) {
    ensureSpace(doc, 58);
    const startY = doc.y;
    doc.font(fonts.mono).fontSize(7.5).fillColor(COLORS.secondary).text(claim.id, PAGE_MARGIN.left, startY, { width: 32 });
    doc.font(fonts.bold).fontSize(7.5).fillColor(statusColor(claim.status)).text(claim.status, PAGE_MARGIN.left + 34, startY, {
      width: CONTENT_WIDTH - 34,
    });
    doc.font(fonts.bold).fontSize(9.5).fillColor(COLORS.text).text(claim.text, PAGE_MARGIN.left + 34, doc.y + 2, {
      width: CONTENT_WIDTH - 34,
    });
    if (claim.detail) {
      doc.font(fonts.body).fontSize(8).fillColor(COLORS.secondary).text(claim.detail, PAGE_MARGIN.left + 34, doc.y + 2, {
        width: CONTENT_WIDTH - 34,
        lineGap: 1,
      });
    }
    doc.font(fonts.body).fontSize(7.5).fillColor(COLORS.muted).text(
      `Evidence: ${claim.sourceIds.join(', ') || 'none'}`,
      PAGE_MARGIN.left + 34,
      doc.y + 2,
      { width: CONTENT_WIDTH - 34 },
    );
    doc.save().strokeColor(COLORS.border).lineWidth(0.5).moveTo(PAGE_MARGIN.left, doc.y + 6).lineTo(doc.page.width - PAGE_MARGIN.right, doc.y + 6).stroke().restore();
    doc.y += 12;
  }
}

interface MeasuredNode {
  id: string;
  kind: GraphNodeDTO['kind'];
  label: string;
  status?: ClaimStatus;
  x: number;
  y: number;
  width: number;
  height: number;
}

function measureGraphNodes(doc: PDFKit.PDFDocument, graph: GraphDTO, fonts: Fonts): MeasuredNode[] {
  const nodes: MeasuredNode[] = graph.nodes.map(node => {
    const width = node.kind === 'question' ? 224 : node.kind === 'claim' ? 188 : 158;
    const fontSize = node.kind === 'question' ? 8 : 7;
    doc.font(node.kind === 'source' ? fonts.body : fonts.bold).fontSize(fontSize);
    const measured = doc.heightOfString(node.label, { width: width - 14, lineGap: 0.7 });
    return {
      id: node.id,
      kind: node.kind,
      label: node.label,
      ...(node.status ? { status: node.status } : {}),
      x: node.position.x,
      y: node.position.y,
      width,
      height: Math.min(104, Math.max(38, measured + 22)),
    };
  });
  for (const memo of graph.memos) {
    const width = 168;
    const label = memo.text || 'Empty memo';
    doc.font(fonts.body).fontSize(7);
    const measured = doc.heightOfString(label, { width: width - 14, lineGap: 0.7 });
    nodes.push({
      id: memo.id,
      kind: 'memo',
      label,
      x: memo.position.x,
      y: memo.position.y,
      width,
      height: Math.min(100, Math.max(42, measured + 20)),
    });
  }
  return nodes;
}

function nodeBorder(node: MeasuredNode): string {
  if (node.kind === 'question') return COLORS.question;
  if (node.kind === 'memo') return COLORS.memoBorder;
  if (node.kind === 'claim') return statusColor(node.status ?? 'Not checked');
  return '#a6a6a6';
}

function nodeFill(node: MeasuredNode): string {
  if (node.kind === 'question') return '#f3f3f3';
  if (node.kind === 'memo') return COLORS.memo;
  return '#ffffff';
}

function renderGraph(doc: PDFKit.PDFDocument, graph: GraphDTO, fonts: Fonts) {
  doc.addPage();
  doc.font(fonts.bold).fontSize(14).fillColor(COLORS.text).text('Evidence graph', { width: CONTENT_WIDTH });
  doc.moveDown(0.2);
  doc.font(fonts.body).fontSize(7.5).fillColor(COLORS.muted).text(
    'Saved layout at export time. Positions and memos may have been arranged manually.',
    { width: CONTENT_WIDTH },
  );
  doc.moveDown(0.6);

  const nodes = measureGraphNodes(doc, graph, fonts);
  if (!nodes.length) {
    doc.font(fonts.body).fontSize(9.5).fillColor(COLORS.muted).text('No graph data was available for this session.', {
      width: CONTENT_WIDTH,
    });
    return;
  }

  const minX = Math.min(...nodes.map(node => node.x)) - 12;
  const minY = Math.min(...nodes.map(node => node.y)) - 12;
  const maxX = Math.max(...nodes.map(node => node.x + node.width)) + 12;
  const maxY = Math.max(...nodes.map(node => node.y + node.height)) + 12;
  const graphWidth = Math.max(1, maxX - minX);
  const graphHeight = Math.max(1, maxY - minY);
  const startY = doc.y;
  const legendHeight = 42;
  const availableHeight = doc.page.height - doc.page.margins.bottom - startY - legendHeight;
  const scale = Math.max(0.14, Math.min(CONTENT_WIDTH / graphWidth, availableHeight / graphHeight, 1.05));
  const offsetX = PAGE_MARGIN.left + (CONTENT_WIDTH - graphWidth * scale) / 2 - minX * scale;
  const offsetY = startY + (availableHeight - graphHeight * scale) / 2 - minY * scale;
  const byId = new Map(nodes.map(node => [node.id, node]));

  doc.save().lineWidth(0.7).strokeColor('#b4b4b4');
  for (const edge of graph.edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;
    const x1 = offsetX + (source.x + source.width / 2) * scale;
    const y1 = offsetY + (source.y + source.height / 2) * scale;
    const x2 = offsetX + (target.x + target.width / 2) * scale;
    const y2 = offsetY + (target.y + target.height / 2) * scale;
    if (edge.dashed) {
      doc.save().strokeColor('#a77670').dash(2.5, { space: 2 }).moveTo(x1, y1).lineTo(x2, y2).stroke().undash().restore();
    } else {
      doc.moveTo(x1, y1).lineTo(x2, y2).stroke();
    }
  }
  doc.restore();

  for (const node of nodes) {
    const x = offsetX + node.x * scale;
    const y = offsetY + node.y * scale;
    const width = node.width * scale;
    const height = node.height * scale;
    doc.save().roundedRect(x, y, width, height, 2.5).fillAndStroke(nodeFill(node), nodeBorder(node)).restore();
    const labelSize = Math.max(4.3, (node.kind === 'question' ? 8 : 7) * scale);
    doc.font(fonts.mono).fontSize(Math.max(4, 5.7 * scale)).fillColor(COLORS.muted).text(
      node.kind === 'question' ? 'QUESTION' : node.kind === 'memo' ? 'MEMO' : node.id,
      x + 5,
      y + 4,
      { width: width - 10 },
    );
    doc.font(node.kind === 'source' ? fonts.body : fonts.bold).fontSize(labelSize).fillColor(COLORS.text).text(
      node.label,
      x + 5,
      y + 12,
      { width: width - 10, height: height - 16, ellipsis: true, lineGap: 0.5 },
    );
  }

  const legendY = doc.page.height - doc.page.margins.bottom - 26;
  const legend = [
    { label: 'Question', x: PAGE_MARGIN.left, fill: '#f3f3f3', border: COLORS.question },
    { label: 'Claim', x: PAGE_MARGIN.left + 74, fill: '#ffffff', border: COLORS.contradicted },
    { label: 'Source', x: PAGE_MARGIN.left + 140, fill: '#ffffff', border: '#a6a6a6' },
    { label: 'Memo', x: PAGE_MARGIN.left + 207, fill: COLORS.memo, border: COLORS.memoBorder },
  ];
  for (const item of legend) {
    doc.save().roundedRect(item.x, legendY, 6, 6, 1).fillAndStroke(item.fill, item.border).restore();
    doc.font(fonts.body).fontSize(6.5).fillColor(COLORS.muted).text(item.label, item.x + 10, legendY - 1, { lineBreak: false });
  }
  doc.save().lineWidth(0.7).strokeColor('#a77670').dash(2.5, { space: 2 }).moveTo(PAGE_MARGIN.left + 275, legendY + 3).lineTo(PAGE_MARGIN.left + 299, legendY + 3).stroke().undash().restore();
  doc.font(fonts.body).fontSize(6.5).fillColor(COLORS.muted).text('Challenges', PAGE_MARGIN.left + 304, legendY - 1, { lineBreak: false });
}

function addPageChrome(doc: PDFKit.PDFDocument, fonts: Fonts, title: string) {
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    const page = doc.page;
    const top = 24;
    const bottom = page.height - 28;
    doc.font(fonts.mono).fontSize(6.5).fillColor(COLORS.faint);
    doc.text('KAIRO · EVIDENCE EXPORT', PAGE_MARGIN.left, top, {
      width: CONTENT_WIDTH - 100,
      lineBreak: false,
    });
    doc.text(title, PAGE_MARGIN.left, top, {
      width: CONTENT_WIDTH,
      align: 'right',
      lineBreak: false,
    });
    doc.text(`PAGE ${index + 1} OF ${range.count}`, PAGE_MARGIN.left, bottom, {
      width: CONTENT_WIDTH,
      align: 'right',
      lineBreak: false,
    });
    doc.text('kairo', PAGE_MARGIN.left, bottom, { width: CONTENT_WIDTH, lineBreak: false });
  }
}

function renderDocument(doc: PDFKit.PDFDocument, session: SessionDetailDTO, graph: GraphDTO, fonts: Fonts) {
  const model = MODELS.find(item => item.id === session.modelId);
  doc.font(fonts.mono).fontSize(8).fillColor(COLORS.muted).text('KAIRO · EVIDENCE EXPORT', { characterSpacing: 1.1 });
  doc.moveDown(0.7);
  doc.font(fonts.bold).fontSize(23).fillColor(COLORS.text).text(session.title, { width: CONTENT_WIDTH, lineGap: 1 });
  doc.moveDown(0.4);
  doc.font(fonts.body).fontSize(10).fillColor(COLORS.secondary).text(session.query, { width: CONTENT_WIDTH, lineGap: 2 });
  doc.moveDown(0.7);
  const metadata = [
    model?.name ?? session.modelId,
    session.mode,
    `${session.effort} effort`,
    session.date,
    session.verified ? 'JEV evidence review requested' : 'JEV not requested',
    session.usage ? `${session.usage.totalTokens.toLocaleString()} tokens` : 'usage unavailable',
  ];
  doc.font(fonts.body).fontSize(7.5).fillColor(COLORS.muted).text(metadata.join('  ·  '), { width: CONTENT_WIDTH, lineGap: 1 });
  doc.moveDown(0.5);
  doc.save().strokeColor(COLORS.rule).lineWidth(0.6).moveTo(PAGE_MARGIN.left, doc.y).lineTo(doc.page.width - PAGE_MARGIN.right, doc.y).stroke().restore();

  sectionHeading(doc, 'Answer', fonts, 'Synthesis');
  renderAnswer(doc, session, fonts);

  sectionHeading(doc, 'Sources', fonts, `${session.sources.length} collected`);
  renderSources(doc, session.sources, fonts);

  sectionHeading(doc, 'Claims', fonts, session.verified ? 'JEV review' : 'Not verified');
  renderClaims(doc, session, fonts);

  renderGraph(doc, graph, fonts);

  ensureSpace(doc, 60);
  doc.moveDown(0.8);
  doc.save().strokeColor(COLORS.rule).lineWidth(0.6).moveTo(PAGE_MARGIN.left, doc.y).lineTo(doc.page.width - PAGE_MARGIN.right, doc.y).stroke().restore();
  doc.moveDown(0.6);
  doc.font(fonts.body).fontSize(7.5).fillColor(COLORS.muted).text(DISCLAIMER, { width: CONTENT_WIDTH, lineGap: 1 });
}

export async function renderSessionPdf(session: SessionDetailDTO, graph: GraphDTO): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: PAGE_MARGIN,
    bufferPages: true,
    info: {
      Title: session.title,
      Author: 'Kairo',
      Subject: session.query,
      Creator: 'Kairo',
      Producer: 'Kairo',
      CreationDate: new Date(),
    },
  });
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const fonts = registerFonts(doc);
  renderDocument(doc, session, graph, fonts);
  addPageChrome(doc, fonts, session.title);
  doc.end();
  return finished;
}
