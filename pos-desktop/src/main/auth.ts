import { safeStorage } from 'electron';
import bcrypt from 'bcryptjs';
import type { ApiClient } from '@moto/api-client';
import type { Session } from '@moto/shared';
import type { LocalDb } from './db/database';

type OfflineProfile = { session: Session; passwordHash: string; passwordCiphertext?: string; verifiedAt: number };

export class AuthStore {
  private session: Session | null = null;
  private locked = false;
  private generation = 0;
  private refreshing: Promise<string | null> | null = null;
  constructor(private db: LocalDb) {
    this.session = this.readCached();
    this.locked = this.db.getMeta('auth_locked') === '1';
  }

  private encrypt(s: string): string | null {
    return safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s).toString('base64') : null;
  }
  private decrypt(b64: string): string {
    const buf = Buffer.from(b64, 'base64');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS_ENCRYPTION_UNAVAILABLE');
    return safeStorage.decryptString(buf);
  }

  private readCached(): Session | null {
    const raw = this.db.getMeta('session');
    if (!raw) return null;
    try {
      return JSON.parse(this.decrypt(raw)) as Session;
    } catch {
      this.db.setMeta('session', null);
      return null;
    }
  }

  current(): Session | null {
    const verified = Number(this.db.getMeta('auth_verified_at'));
    return !this.locked && verified > 0 ? this.session : null;
  }

  lock() { this.locked = true; this.db.setMeta('auth_locked', '1'); }

  token(): string | null {
    return this.session?.token ?? null;
  }

  refreshToken(): string | undefined { return this.session?.refreshToken; }

  setSession(s: Session | null) {
    this.generation++;
    this.session = s;
    this.locked = false;
    this.db.setMeta('auth_locked', null);
    this.db.setMeta('session', s ? this.encrypt(JSON.stringify(s)) : null);
    if (s) this.db.setMeta('auth_verified_at', String(Date.now()));
  }

  private readOfflineProfiles(): Map<string, OfflineProfile> {
    const raw = this.db.getMeta('offline_profiles');
    if (raw) {
      try {
        const profiles = JSON.parse(this.decrypt(raw)) as Record<string, OfflineProfile>;
        return new Map(Object.entries(profiles));
      } catch {
        this.db.setMeta('offline_profiles', null);
      }
    }

    const legacyRaw = this.db.getMeta('offline_profile');
    if (!legacyRaw) return new Map();
    try {
      const session = JSON.parse(this.decrypt(legacyRaw)) as Session;
      const username = session.user.username.toLowerCase();
      const passwordHash = this.db.getMeta(`pw:${username}`);
      const verifiedAt = Number(this.db.getMeta('auth_verified_at'));
      if (!passwordHash || !Number.isFinite(verifiedAt) || verifiedAt <= 0) return new Map();
      return new Map([[username, { session, passwordHash, verifiedAt }]]);
    } catch {
      this.db.setMeta('offline_profile', null);
      return new Map();
    }
  }

  private readOfflineRefreshTokens(): Map<string, string> {
    const raw = this.db.getMeta('offline_refresh_tokens');
    if (!raw) return new Map();
    try {
      return new Map(Object.entries(JSON.parse(this.decrypt(raw)) as Record<string, string>));
    } catch {
      this.db.setMeta('offline_refresh_tokens', null);
      return new Map();
    }
  }

  private saveOfflineRefreshTokens(tokens: Map<string, string>) {
    if (!tokens.size || !safeStorage.isEncryptionAvailable()) {
      this.db.setMeta('offline_refresh_tokens', null);
      return;
    }
    this.db.setMeta('offline_refresh_tokens', this.encrypt(JSON.stringify(Object.fromEntries(tokens))));
  }

  private saveOfflineProfiles(profiles: Map<string, OfflineProfile>) {
    if (!profiles.size || !safeStorage.isEncryptionAvailable()) {
      this.db.setMeta('offline_profiles', null);
      return;
    }
    this.db.setMeta('offline_profiles', this.encrypt(JSON.stringify(Object.fromEntries(profiles))));
  }

  private offlineSession(s: Session): Session {
    return { ...s, token: '', refreshToken: undefined };
  }

  async login(api: ApiClient | null, online: boolean, username: string, password: string): Promise<Session> {
    if (online && api) {
      const s = await api.auth.login(username, password);
      this.setSession(s);
      if (safeStorage.isEncryptionAvailable()) {
        const profiles = this.readOfflineProfiles();
        profiles.set(username.toLowerCase(), { session: this.offlineSession(s), passwordHash: await bcrypt.hash(password, 10), passwordCiphertext: this.encrypt(password) ?? undefined, verifiedAt: Number(this.db.getMeta('auth_verified_at')) });
        this.saveOfflineProfiles(profiles);
        const refreshTokens = this.readOfflineRefreshTokens();
        if (s.refreshToken) refreshTokens.set(username.toLowerCase(), s.refreshToken);
        this.saveOfflineRefreshTokens(refreshTokens);
      }
      return s;
    }
    const usernameKey = username.toLowerCase();
    const profile = this.readOfflineProfiles().get(usernameKey);
    if (!profile || profile.session.user.username !== usernameKey || profile.verifiedAt <= 0 || !(await bcrypt.compare(password, profile.passwordHash))) {
      throw new Error('OFFLINE_LOGIN_FAILED');
    }
    const passwordCiphertext = this.encrypt(password);
    if (passwordCiphertext) {
      const profiles = this.readOfflineProfiles();
      profiles.set(usernameKey, { ...profile, passwordCiphertext });
      this.saveOfflineProfiles(profiles);
    }
    const refreshToken = this.readOfflineRefreshTokens().get(usernameKey);
    this.session = { ...profile.session, refreshToken };
    this.locked = false;
    this.db.setMeta('auth_locked', null);
    this.db.setMeta('auth_verified_at', String(profile.verifiedAt));
    this.generation++;
    return profile.session;
  }

  /** Re-authenticate the offline user when connectivity returns, without prompting again. */
  async reconnect(api: ApiClient): Promise<boolean> {
    const username = this.session?.user.username.toLowerCase();
    if (!username) return false;
    const profile = this.readOfflineProfiles().get(username);
    if (!profile?.passwordCiphertext) return false;
    try {
      const password = this.decrypt(profile.passwordCiphertext);
      const s = await api.auth.login(username, password);
      this.setSession(s);
      const profiles = this.readOfflineProfiles();
      profiles.set(username, { ...profile, session: this.offlineSession(s), verifiedAt: Date.now(), passwordCiphertext: profile.passwordCiphertext });
      this.saveOfflineProfiles(profiles);
      const refreshTokens = this.readOfflineRefreshTokens();
      if (s.refreshToken) refreshTokens.set(username, s.refreshToken);
      this.saveOfflineRefreshTokens(refreshTokens);
      return true;
    } catch {
      return false;
    }
  }

  async refresh(api: ApiClient): Promise<string | null> {
    if (this.refreshing) return this.refreshing;
    const rt = this.session?.refreshToken;
    if (!rt) return null;
    const version = this.generation;
    this.refreshing = (async () => {
      try {
        const s = await api.auth.refresh(rt);
        if (version !== this.generation) return null;
        const wasLocked = this.locked;
        this.setSession(s);
        this.locked = wasLocked;
        this.db.setMeta('auth_locked', wasLocked ? '1' : null);
        const profiles = this.readOfflineProfiles();
        const username = s.user.username.toLowerCase();
        const existing = profiles.get(username);
        if (existing) profiles.set(username, { ...existing, session: this.offlineSession(s), verifiedAt: Date.now() });
        this.saveOfflineProfiles(profiles);
        const refreshTokens = this.readOfflineRefreshTokens();
        if (s.refreshToken) refreshTokens.set(username, s.refreshToken);
        this.saveOfflineRefreshTokens(refreshTokens);
        return s.token;
      } catch (error) {
        if (version === this.generation && (error as { status?: number }).status === 401) {
          const username = this.session?.user.username;
          this.logout();
          this.db.setMeta('auth_verified_at', null);
          if (username) {
            const profiles = this.readOfflineProfiles();
            profiles.delete(username.toLowerCase());
            this.saveOfflineProfiles(profiles);
            const refreshTokens = this.readOfflineRefreshTokens();
            refreshTokens.delete(username.toLowerCase());
            this.saveOfflineRefreshTokens(refreshTokens);
          }
        }
        return null;
      } finally { this.refreshing = null; }
    })();
    return this.refreshing;
  }

  logout() {
    const username = this.session?.user.username.toLowerCase();
    this.setSession(null);
    if (username) {
      const refreshTokens = this.readOfflineRefreshTokens();
      refreshTokens.delete(username);
      this.saveOfflineRefreshTokens(refreshTokens);
    }
  }
}
