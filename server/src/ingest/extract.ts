import path from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.csv', '.json']);
const MAX_TEXT_CHARS = 140_000;

export class UnsupportedAttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedAttachmentError';
  }
}

export function normalizeExtractedText(value: string): string {
  return value
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

export async function extractAttachmentText(filename: string, mime: string, buffer: Buffer): Promise<string> {
  const extension = path.extname(filename).toLowerCase();
  const isPdf = mime === 'application/pdf' || extension === '.pdf';
  if (isPdf) {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const result = await extractText(pdf, { mergePages: true });
      const text = Array.isArray(result.text) ? result.text.join('\n\n') : result.text;
      const normalized = normalizeExtractedText(text);
      if (!normalized) throw new UnsupportedAttachmentError('The PDF did not contain extractable text.');
      return normalized;
    } catch (error) {
      if (error instanceof UnsupportedAttachmentError) throw error;
      throw new UnsupportedAttachmentError('Could not extract text from this PDF.');
    }
  }

  if (TEXT_EXTENSIONS.has(extension) || mime.startsWith('text/') || mime === 'application/json') {
    const text = normalizeExtractedText(buffer.toString('utf8'));
    if (!text) throw new UnsupportedAttachmentError('The file is empty.');
    return text;
  }

  throw new UnsupportedAttachmentError('Only PDF, text, Markdown, CSV, and JSON files are supported.');
}
