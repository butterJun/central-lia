import { describe, expect, it } from 'vitest';
import { GoogleDriveGateway, type DriveApiClient } from '../src/server/drive/google-drive.ts';
import { DriveAuthError, DriveFileAccessError, MIME } from '../src/server/drive/types.ts';
import { decryptSecret, encryptSecret } from '../src/server/lib/crypto.ts';

type ListParams = { q: string; pageToken?: string };

function fakeClient(options: { failListTimes?: number; status?: number; fileStatus?: number } = {}) {
  const calls: ListParams[] = [];
  let failures = options.failListTimes ?? 0;
  const pages: Record<string, Array<{ files: object[]; nextPageToken?: string }>> = {
    root: [
      { files: [{ id: 'f1', name: 'INDEX.md', mimeType: 'text/markdown', version: '3', modifiedTime: '2026-10-01T10:00:00Z', webViewLink: 'https://drive/f1' }], nextPageToken: 'p2' },
      { files: [{ id: 'sub', name: 'Atas', mimeType: MIME.folder }] },
    ],
    sub: [{ files: [{ id: 'f2', name: 'Ata nova', mimeType: MIME.googleDoc, version: '7', capabilities: { canDownload: true } }] }],
  };
  const client: DriveApiClient = {
    files: {
      async list(params) {
        const query = params as unknown as ListParams;
        calls.push(query);
        if (options.status) throw Object.assign(new Error('auth'), { response: { status: options.status } });
        if (failures > 0) {
          failures -= 1;
          throw Object.assign(new Error('rate limit'), { response: { status: 429 } });
        }
        const folder = /'([^']+)' in parents/.exec(query.q)?.[1] ?? '';
        const page = query.pageToken === 'p2' ? 1 : 0;
        return { data: pages[folder]?.[page] ?? { files: [] } };
      },
      async get(params) {
        if (options.fileStatus) throw Object.assign(new Error('forbidden'), { response: { status: options.fileStatus } });
        if ((params as { alt?: string }).alt === 'media') return { data: new TextEncoder().encode('# conteúdo').buffer };
        return { data: { name: 'LIA case teste', webViewLink: 'https://drive/root' } };
      },
      async export(params) {
        return { data: new TextEncoder().encode(`exportado como ${(params as { mimeType: string }).mimeType}`).buffer };
      },
    },
  };
  return { client, calls };
}

describe('Google Drive adapter', () => {
  it('walks subfolders, follows every page and keeps the folder path', async () => {
    const { client, calls } = fakeClient();
    const gateway = new GoogleDriveGateway(() => client, 'root', 1);
    const files = await gateway.listTree();
    expect(files.map((file) => `${file.path}/${file.name}`)).toEqual(['//INDEX.md', '/Atas/Ata nova']);
    expect(files[0]).toMatchObject({ id: 'f1', version: '3', webViewLink: 'https://drive/f1' });
    expect(calls.map((call) => call.pageToken ?? '-')).toEqual(['-', 'p2', '-']);
    expect(calls.every((call) => call.q.endsWith('and trashed = false'))).toBe(true);
  });

  it('retries rate-limit errors with backoff', async () => {
    const { client, calls } = fakeClient({ failListTimes: 2 });
    const files = await new GoogleDriveGateway(() => client, 'root', 1).listTree();
    expect(files).toHaveLength(2);
    expect(calls.length).toBe(5);
  });

  it('maps 401 to an authorization error and 403 on a file to a per-file access error', async () => {
    const auth = fakeClient({ status: 401 });
    await expect(new GoogleDriveGateway(() => auth.client, 'root', 1).listTree()).rejects.toBeInstanceOf(DriveAuthError);
    const forbidden = fakeClient({ fileStatus: 403 });
    const gateway = new GoogleDriveGateway(() => forbidden.client, 'root', 1);
    const file = { id: 'f1', name: 'INDEX.md', mimeType: 'text/markdown', modifiedTime: '', webViewLink: '', version: '1', path: '/', canDownload: true, size: null };
    await expect(gateway.download(file)).rejects.toBeInstanceOf(DriveFileAccessError);
  });

  it('exports Google Docs as Markdown and reports a missing connection', async () => {
    const { client } = fakeClient();
    const gateway = new GoogleDriveGateway(() => client, 'root', 1);
    const doc = { id: 'f2', name: 'Ata nova', mimeType: MIME.googleDoc, modifiedTime: '', webViewLink: '', version: '7', path: '/', canDownload: true, size: null };
    expect(await gateway.exportDocument(doc)).toBe('exportado como text/markdown');
    expect(await gateway.describeRoot()).toMatchObject({ name: 'LIA case teste' });
    await expect(new GoogleDriveGateway(() => null, 'root').listTree()).rejects.toBeInstanceOf(DriveAuthError);
  });

  it('refuses folder ids that could alter the Drive query', () => {
    expect(() => new GoogleDriveGateway(() => null, "x' or '1'='1")).toThrow(/inválido/);
  });
});

describe('token encryption at rest', () => {
  it('round-trips and fails with a different secret', () => {
    const secret = 'a'.repeat(32);
    const sealed = encryptSecret('{"refresh_token":"abc"}', secret);
    expect(sealed).not.toContain('abc');
    expect(decryptSecret(sealed, secret)).toBe('{"refresh_token":"abc"}');
    expect(() => decryptSecret(sealed, 'b'.repeat(32))).toThrow();
  });
});
