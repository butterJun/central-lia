import { setTimeout as sleep } from 'node:timers/promises';
import {
  DriveAuthError,
  DriveFileAccessError,
  MIME,
  type DriveFile,
  type DriveFolderInfo,
  type DriveGateway,
} from './types.ts';

/**
 * Google Drive API v3 adapter. Reads only the configured folder tree; never
 * writes. The client is injected (a `drive_v3.Drive` in production, a fake in tests).
 */

interface ApiFile {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  modifiedTime?: string | null;
  webViewLink?: string | null;
  version?: string | null;
  md5Checksum?: string | null;
  size?: string | null;
  capabilities?: { canDownload?: boolean | null } | null;
}

interface ApiResponse<T> {
  data: T;
}

/** Subset of `drive_v3.Drive` used by this adapter. */
export interface DriveApiClient {
  files: {
    list(params: Record<string, unknown>): Promise<ApiResponse<{ files?: ApiFile[]; nextPageToken?: string | null }>>;
    get(params: Record<string, unknown>, options?: Record<string, unknown>): Promise<ApiResponse<unknown>>;
    export(params: Record<string, unknown>, options?: Record<string, unknown>): Promise<ApiResponse<unknown>>;
  };
}

const FILE_FIELDS = 'id,name,mimeType,modifiedTime,webViewLink,version,md5Checksum,size,capabilities(canDownload)';
const PAGE_SIZE = 1000;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;
const FOLDER_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export class GoogleDriveGateway implements DriveGateway {
  readonly mode = 'google' as const;

  constructor(
    private readonly clientProvider: () => DriveApiClient | null,
    private readonly folderId: string,
    private readonly backoffMs = BASE_BACKOFF_MS,
  ) {
    if (!FOLDER_ID_PATTERN.test(folderId)) throw new Error('DRIVE_TEST_FOLDER_ID inválido');
  }

  isConnected(): boolean {
    return this.clientProvider() !== null;
  }

  async describeRoot(): Promise<DriveFolderInfo> {
    const response = await this.call(() =>
      this.client().files.get({ fileId: this.folderId, fields: 'id,name,webViewLink', supportsAllDrives: true }),
    );
    const data = response.data as ApiFile;
    return {
      id: this.folderId,
      name: data.name ?? this.folderId,
      webUrl: data.webViewLink ?? `https://drive.google.com/drive/folders/${this.folderId}`,
    };
  }

  async listTree(): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    const visited = new Set<string>();
    const queue: Array<{ id: string; path: string }> = [{ id: this.folderId, path: '/' }];
    while (queue.length > 0) {
      const folder = queue.shift() as { id: string; path: string };
      if (visited.has(folder.id)) continue;
      visited.add(folder.id);
      for (const item of await this.listChildren(folder.id)) {
        if (item.mimeType === MIME.folder) {
          queue.push({ id: item.id as string, path: joinPath(folder.path, item.name ?? '') });
        } else {
          files.push(toDriveFile(item, folder.path));
        }
      }
    }
    return files;
  }

  async download(file: DriveFile): Promise<Buffer> {
    const response = await this.call(
      () => this.client().files.get({ fileId: file.id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' }),
      file.name,
    );
    return Buffer.from(response.data as ArrayBuffer);
  }

  async exportDocument(file: DriveFile): Promise<string> {
    try {
      return await this.exportAs(file, MIME.markdown);
    } catch (error) {
      if (error instanceof DriveAuthError) throw error;
      return this.exportAs(file, MIME.plainText);
    }
  }

  async exportSpreadsheet(file: DriveFile): Promise<Buffer> {
    const response = await this.call(
      () => this.client().files.export({ fileId: file.id, mimeType: MIME.xlsx }, { responseType: 'arraybuffer' }),
      file.name,
    );
    return Buffer.from(response.data as ArrayBuffer);
  }

  private async exportAs(file: DriveFile, mimeType: string): Promise<string> {
    const response = await this.call(
      () => this.client().files.export({ fileId: file.id, mimeType }, { responseType: 'arraybuffer' }),
      file.name,
    );
    return Buffer.from(response.data as ArrayBuffer).toString('utf8');
  }

  private async listChildren(folderId: string): Promise<ApiFile[]> {
    const items: ApiFile[] = [];
    let pageToken: string | undefined;
    do {
      const response = await this.call(() =>
        this.client().files.list({
          q: `'${folderId}' in parents and trashed = false`,
          spaces: 'drive',
          pageSize: PAGE_SIZE,
          pageToken,
          fields: `nextPageToken,files(${FILE_FIELDS})`,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        }),
      );
      items.push(...(response.data.files ?? []));
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);
    return items;
  }

  private client(): DriveApiClient {
    const client = this.clientProvider();
    if (!client) throw new DriveAuthError('Google Drive não está conectado. Use "Conectar Google Drive".');
    return client;
  }

  /** Retries transient failures (429/5xx/network) with exponential backoff; maps permanent ones. */
  private async call<T>(operation: () => Promise<T>, fileName?: string): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        const status = httpStatus(error);
        if (status === 401 || isInvalidGrant(error)) {
          throw new DriveAuthError('Autorização do Google expirou ou foi revogada. Conecte novamente.');
        }
        if (fileName && (status === 403 || status === 404)) {
          throw new DriveFileAccessError(`Sem acesso a ${fileName} (HTTP ${status})`);
        }
        const transient = status === undefined || status === 429 || status >= 500 || isRateLimit(error);
        if (!transient || attempt >= MAX_ATTEMPTS) throw error;
        await sleep(this.backoffMs * 2 ** (attempt - 1));
      }
    }
  }
}

function joinPath(parent: string, name: string): string {
  return parent === '/' ? `/${name}` : `${parent}/${name}`;
}

function toDriveFile(item: ApiFile, folderPath: string): DriveFile {
  return {
    id: item.id as string,
    name: item.name ?? '(sem nome)',
    mimeType: item.mimeType ?? 'application/octet-stream',
    modifiedTime: item.modifiedTime ?? new Date(0).toISOString(),
    webViewLink: item.webViewLink ?? `https://drive.google.com/file/d/${item.id}/view`,
    version: item.version ?? item.md5Checksum ?? item.modifiedTime ?? 'unknown',
    path: folderPath,
    canDownload: item.capabilities?.canDownload !== false,
    size: item.size ? Number(item.size) : null,
  };
}

function httpStatus(error: unknown): number | undefined {
  const candidate = error as { status?: unknown; code?: unknown; response?: { status?: unknown } };
  const raw = candidate.response?.status ?? candidate.status ?? candidate.code;
  return typeof raw === 'number' ? raw : undefined;
}

function isInvalidGrant(error: unknown): boolean {
  const data = (error as { response?: { data?: { error?: unknown } } }).response?.data;
  return data?.error === 'invalid_grant' || String((error as Error)?.message ?? '').includes('invalid_grant');
}

function isRateLimit(error: unknown): boolean {
  const reason = JSON.stringify((error as { errors?: unknown }).errors ?? '');
  return /rateLimitExceeded|userRateLimitExceeded/.test(reason);
}
