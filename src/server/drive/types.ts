/**
 * Port for reading the configured Drive folder. Implemented by the Google Drive
 * API adapter and by a local-folder adapter used for offline demos and tests.
 */

export const MIME = {
  folder: 'application/vnd.google-apps.folder',
  googleDoc: 'application/vnd.google-apps.document',
  googleSheet: 'application/vnd.google-apps.spreadsheet',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  markdown: 'text/markdown',
  plainText: 'text/plain',
} as const;

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink: string;
  /** Changes whenever the file changes (Drive `version`, or mtime+size locally). */
  version: string;
  /** Folder path inside the configured root, e.g. `/Atas`. */
  path: string;
  canDownload: boolean;
  /** Bytes, when known (Google-native documents have no size). */
  size: number | null;
}

export interface DriveFolderInfo {
  id: string;
  name: string;
  webUrl: string;
}

export interface DriveGateway {
  readonly mode: 'google' | 'local';
  isConnected(): boolean;
  describeRoot(): Promise<DriveFolderInfo>;
  /** Every non-folder file under the root, walking subfolders and all result pages. */
  listTree(): Promise<DriveFile[]>;
  download(file: DriveFile): Promise<Buffer>;
  /** Google Docs → text (Markdown when available). */
  exportDocument(file: DriveFile): Promise<string>;
  /** Google Sheets → .xlsx bytes. */
  exportSpreadsheet(file: DriveFile): Promise<Buffer>;
}

/** Authorization is missing, expired or revoked: the whole sync must stop and ask for reconnection. */
export class DriveAuthError extends Error {}

/** A single file cannot be read (permission removed, deleted between listing and download...). */
export class DriveFileAccessError extends Error {}

const MIME_LABELS: Record<string, string> = {
  [MIME.folder]: 'Pasta',
  [MIME.googleDoc]: 'Google Docs',
  [MIME.googleSheet]: 'Google Sheets',
  [MIME.xlsx]: 'Planilha .xlsx',
  [MIME.docx]: 'Documento Word .docx',
  [MIME.pdf]: 'PDF',
  [MIME.markdown]: 'Markdown',
  [MIME.plainText]: 'Texto',
};

export function isMarkdownName(name: string): boolean {
  return /\.(md|markdown)$/i.test(name);
}

export function describeMimeType(mimeType: string, name: string): string {
  if (isMarkdownName(name)) return 'Markdown';
  if (MIME_LABELS[mimeType]) return MIME_LABELS[mimeType];
  if (mimeType.startsWith('image/')) return 'Imagem';
  if (mimeType.startsWith('video/')) return 'Vídeo';
  if (mimeType.startsWith('audio/')) return 'Áudio';
  return mimeType;
}
