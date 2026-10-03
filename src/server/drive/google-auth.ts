import { randomBytes } from 'node:crypto';
import { drive as createDrive } from '@googleapis/drive';
import { OAuth2Client, type Credentials } from 'google-auth-library';
import type { GoogleConfig } from '../config.ts';
import { decryptSecret, encryptSecret } from '../lib/crypto.ts';
import { ValidationError } from '../lib/errors.ts';
import type { KvRepo } from '../repositories/kv-repo.ts';
import type { DriveApiClient } from './google-drive.ts';

/**
 * OAuth 2.0 web-server flow for the candidate's own Google account.
 * Tokens are kept server-side only, encrypted with APP_SECRET; the browser never sees them.
 */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const TOKENS_KEY = 'google.tokens';
const STATE_TTL_MS = 10 * 60 * 1000;

export class GoogleAuthService {
  private readonly pendingStates = new Map<string, number>();
  private oauthClient: OAuth2Client | null = null;
  private driveClient: DriveApiClient | null = null;

  constructor(
    private readonly config: GoogleConfig,
    private readonly kv: KvRepo,
    private readonly appSecret: string,
  ) {}

  isConnected(): boolean {
    return this.kv.get<string>(TOKENS_KEY) !== null;
  }

  /** URL of Google's consent screen, with a single-use `state` against CSRF. */
  createAuthUrl(): string {
    this.pruneStates();
    const state = randomBytes(24).toString('hex');
    this.pendingStates.set(state, Date.now() + STATE_TTL_MS);
    return this.newOAuthClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [DRIVE_SCOPE],
      state,
      include_granted_scopes: false,
    });
  }

  async handleCallback(code: string | undefined, state: string | undefined): Promise<void> {
    const expiresAt = state ? this.pendingStates.get(state) : undefined;
    if (!state || !expiresAt || expiresAt < Date.now()) {
      throw new ValidationError('Parâmetro state inválido ou expirado. Inicie a conexão novamente.');
    }
    this.pendingStates.delete(state);
    if (!code) throw new ValidationError('O Google não retornou o código de autorização.');
    const { tokens } = await this.newOAuthClient().getToken(code);
    this.storeTokens(tokens);
    this.resetClients();
  }

  async disconnect(): Promise<void> {
    const tokens = this.loadTokens();
    this.kv.delete(TOKENS_KEY);
    this.resetClients();
    const token = tokens?.refresh_token ?? tokens?.access_token;
    if (token) await this.newOAuthClient().revokeToken(token).catch(() => undefined);
  }

  /** Called when Google rejects the refresh token: forget it so the UI asks to reconnect. */
  invalidate(): void {
    this.kv.delete(TOKENS_KEY);
    this.resetClients();
  }

  driveApi(): DriveApiClient | null {
    if (this.driveClient) return this.driveClient;
    const tokens = this.loadTokens();
    if (!tokens) return null;
    const client = this.newOAuthClient();
    client.setCredentials(tokens);
    client.on('tokens', (refreshed) => this.storeTokens({ ...this.loadTokens(), ...refreshed }));
    this.oauthClient = client;
    this.driveClient = createDrive({ version: 'v3', auth: client }) as unknown as DriveApiClient;
    return this.driveClient;
  }

  private newOAuthClient(): OAuth2Client {
    return new OAuth2Client({
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      redirectUri: this.config.redirectUri,
    });
  }

  private storeTokens(tokens: Credentials): void {
    this.kv.set(TOKENS_KEY, encryptSecret(JSON.stringify(tokens), this.appSecret));
  }

  private loadTokens(): Credentials | null {
    const payload = this.kv.get<string>(TOKENS_KEY);
    if (!payload) return null;
    try {
      return JSON.parse(decryptSecret(payload, this.appSecret)) as Credentials;
    } catch {
      return null;
    }
  }

  private resetClients(): void {
    this.oauthClient?.removeAllListeners('tokens');
    this.oauthClient = null;
    this.driveClient = null;
  }

  private pruneStates(): void {
    const now = Date.now();
    for (const [state, expiresAt] of this.pendingStates) if (expiresAt < now) this.pendingStates.delete(state);
  }
}
