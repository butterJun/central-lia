import fs from 'node:fs/promises';
import path from 'node:path';
import { shortHash } from '../lib/text.ts';
import { DriveFileAccessError, MIME, type DriveFile, type DriveFolderInfo, type DriveGateway } from './types.ts';

/**
 * Simulates the Drive folder with a directory on disk, for running the demo and
 * the tests without Google credentials. Limitation: a renamed file gets a new id
 * (Google Drive keeps the id stable, which the Google adapter relies on).
 * Files ending in `.gdoc` are treated as native Google Docs (plain-text export).
 */

const EXTENSION_MIME: Record<string, string> = {
  '.md': MIME.markdown,
  '.markdown': MIME.markdown,
  '.txt': MIME.plainText,
  '.xlsx': MIME.xlsx,
  '.docx': MIME.docx,
  '.pdf': MIME.pdf,
  '.gdoc': MIME.googleDoc,
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4',
};

export const LOCAL_FILE_ROUTE = '/api/local-files';

export class LocalFolderGateway implements DriveGateway {
  readonly mode = 'local' as const;
  private readonly pathsById = new Map<string, string>();

  constructor(private readonly rootDir: string) {}

  isConnected(): boolean {
    return true;
  }

  async describeRoot(): Promise<DriveFolderInfo> {
    await fs.mkdir(this.rootDir, { recursive: true });
    return { id: 'local-root', name: path.basename(this.rootDir), webUrl: `file:///${this.rootDir.replace(/\\/g, '/')}` };
  }

  async listTree(): Promise<DriveFile[]> {
    await fs.mkdir(this.rootDir, { recursive: true });
    const files: DriveFile[] = [];
    await this.walk(this.rootDir, '/', files);
    return files;
  }

  async download(file: DriveFile): Promise<Buffer> {
    return this.read(file);
  }

  async exportDocument(file: DriveFile): Promise<string> {
    return (await this.read(file)).toString('utf8');
  }

  async exportSpreadsheet(file: DriveFile): Promise<Buffer> {
    return this.read(file);
  }

  /** Absolute path for a file id, used by the route that previews local files. */
  resolvePath(fileId: string): string | undefined {
    return this.pathsById.get(fileId);
  }

  private async walk(dir: string, relativeDir: string, files: DriveFile[]): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.name.startsWith('~$')) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walk(absolute, path.posix.join(relativeDir, entry.name), files);
      } else if (entry.isFile()) {
        files.push(await this.describeFile(absolute, relativeDir, entry.name));
      }
    }
  }

  private async describeFile(absolute: string, relativeDir: string, name: string): Promise<DriveFile> {
    const stats = await fs.stat(absolute);
    const relativePath = path.posix.join(relativeDir, name);
    const id = `local-${shortHash(relativePath)}`;
    this.pathsById.set(id, absolute);
    return {
      id,
      name,
      mimeType: EXTENSION_MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream',
      modifiedTime: stats.mtime.toISOString(),
      webViewLink: `${LOCAL_FILE_ROUTE}/${id}`,
      version: `${Math.round(stats.mtimeMs)}-${stats.size}`,
      path: relativeDir,
      canDownload: true,
      size: stats.size,
    };
  }

  private async read(file: DriveFile): Promise<Buffer> {
    const absolute = this.pathsById.get(file.id);
    if (!absolute) throw new DriveFileAccessError(`Arquivo ${file.name} não está mais na pasta`);
    try {
      return await fs.readFile(absolute);
    } catch (error) {
      throw new DriveFileAccessError(`Não foi possível ler ${file.name}: ${(error as Error).message}`);
    }
  }
}
