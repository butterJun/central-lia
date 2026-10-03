import { extractText, getDocumentProxy } from 'unpdf';
import { errorMessage } from '../lib/errors.ts';
import { isMarkdownName, MIME, type DriveFile, type DriveGateway } from '../drive/types.ts';
import { readWorkbook, workbookToText, type SheetTable } from './spreadsheet.ts';

/**
 * Turns a Drive file into processable content, by format. Unsupported formats
 * are reported with a reason instead of inventing content.
 */

export type ExtractResult =
  | { kind: 'text'; text: string }
  | { kind: 'spreadsheet'; text: string; tables: SheetTable[] }
  | { kind: 'unsupported'; reason: string };

/** Below this many characters a PDF is considered scanned (no selectable text). */
const MIN_PDF_TEXT_CHARS = 20;
/** Larger files are reported instead of downloaded (prototype limit; Google's export limit is 10 MB). */
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

export class ExtractionError extends Error {}

export async function extractContent(gateway: DriveGateway, file: DriveFile): Promise<ExtractResult> {
  const mime = file.mimeType;
  if (mime === MIME.googleDoc) return { kind: 'text', text: normalizeText(await gateway.exportDocument(file)) };
  if (mime === MIME.googleSheet) return spreadsheetResult(await gateway.exportSpreadsheet(file));
  if (file.size !== null && file.size > MAX_FILE_BYTES) {
    const megabytes = (file.size / 1024 / 1024).toFixed(1);
    return { kind: 'unsupported', reason: `Arquivo de ${megabytes} MB excede o limite de ${MAX_FILE_BYTES / 1024 / 1024} MB deste protótipo.` };
  }
  if (!file.canDownload) {
    return { kind: 'unsupported', reason: 'O proprietário bloqueou o download deste arquivo.' };
  }
  if (mime === MIME.xlsx) return spreadsheetResult(await gateway.download(file));
  if (isMarkdownName(file.name) || mime === MIME.markdown || mime === MIME.plainText) {
    return { kind: 'text', text: normalizeText((await gateway.download(file)).toString('utf8')) };
  }
  if (mime === MIME.pdf) return pdfResult(await gateway.download(file));
  return { kind: 'unsupported', reason: unsupportedReason(mime) };
}

function normalizeText(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
}

async function spreadsheetResult(bytes: Buffer): Promise<ExtractResult> {
  try {
    const tables = await readWorkbook(bytes);
    return { kind: 'spreadsheet', tables, text: workbookToText(tables) };
  } catch (error) {
    throw new ExtractionError(`Planilha ilegível: ${errorMessage(error)}`);
  }
}

async function pdfResult(bytes: Buffer): Promise<ExtractResult> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    const content = (Array.isArray(text) ? text.join('\n') : text).trim();
    if (content.length < MIN_PDF_TEXT_CHARS) {
      return { kind: 'unsupported', reason: 'PDF sem texto selecionável (digitalizado); exigiria OCR, fora do escopo.' };
    }
    return { kind: 'text', text: content };
  } catch (error) {
    throw new ExtractionError(`PDF ilegível: ${errorMessage(error)}`);
  }
}

function unsupportedReason(mime: string): string {
  if (mime === MIME.docx) {
    return 'Documento Word (.docx) não é lido diretamente. No Drive, abra-o e use "Arquivo › Salvar como Google Docs".';
  }
  if (mime.startsWith('image/')) return 'Imagem: formato ainda não processado (exigiria OCR).';
  if (mime.startsWith('video/') || mime.startsWith('audio/')) {
    return 'Vídeo/áudio: formato ainda não processado (exigiria transcrição).';
  }
  if (mime.startsWith('application/vnd.google-apps.')) return 'Tipo nativo do Google ainda não processado.';
  return `Formato ainda não processado (${mime}).`;
}
