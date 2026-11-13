import { EventEmitter } from 'node:events';
import type { ApiClient } from '@moto/api-client';
import { ApiError } from '@moto/api-client';
import type { SyncOp, SyncOpResult } from '@moto/shared';
import type { LocalDb } from '../db/database';
import type { ConnectivityInfo } from '../../shared/ipc';

export interface SyncWorkerOptions {
  db: LocalDb;
  api: () => ApiClient | null;
  canSync?: () => boolean;
  authenticate?: () => Promise<boolean>;
  terminalId: () => string | null;
  branchId: () => string | null;
  intervalMs?: number;
  heartbeatMs?: number;
  batchSize?: number;
  /** Injected for tests. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

/** The server no longer knows this terminal (wiped/replaced DB): pushing can never succeed until it is re-registered. */
const isTerminalGone = (e: unknown) => e instanceof ApiError && e.status === 404 && e.code === 'TERMINAL_NOT_FOUND';

/**
 * Background worker: heartbeat → online/offline; on reconnect / interval / demand: push pending outbox ops
 * in createdAt order (batches), then pull deltas. Exponential backoff on network errors; rejected ops stop retrying.
 */
export class SyncWorker extends EventEmitter {
  private online = false;
  private syncing = false;
  private unregistered = false;
  private lastSyncAt: string | null = null;
  private error: string | null = null;
  private backoffMs = 0;
  private timer: unknown = null;
  private hbTimer: unknown = null;
  private stopped = false;
  private readonly opts: Required<Pick<SyncWorkerOptions, 'intervalMs' | 'heartbeatMs' | 'batchSize' | 'now' | 'setTimer' | 'clearTimer' | 'canSync' | 'authenticate'>> & SyncWorkerOptions;

  constructor(opts: SyncWorkerOptions) {
    super();
    this.opts = {
      intervalMs: 30_000,
      heartbeatMs: 5_000,
      batchSize: 50,
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
      canSync: () => true,
      authenticate: async () => true,
      ...opts,
    };
    this.lastSyncAt = opts.db.getState('lastSyncAt');
  }

  status(): ConnectivityInfo {
    const c = this.opts.db.counts();
    return { online: this.online, syncing: this.syncing, unregistered: this.unregistered, pending: c.pending, rejected: c.rejected, lastSyncAt: this.lastSyncAt, lastPullAt: this.opts.db.getState('lastPullAt'), error: this.error };
  }

  /** Called after the device is registered again; resumes pushing. */
  markRegistered() {
    this.unregistered = false;
    this.error = null;
    this.backoffMs = 0;
    this.emitStatus();
  }

  private emitStatus() {
    this.emit('status', this.status());
  }

  start() {
    this.stopped = false;
    void this.heartbeat();
    this.schedule(500);
  }

  stop() {
    this.stopped = true;
    if (this.timer) this.opts.clearTimer(this.timer);
    if (this.hbTimer) this.opts.clearTimer(this.hbTimer);
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    if (this.timer) this.opts.clearTimer(this.timer);
    this.timer = this.opts.setTimer(() => void this.syncNow(), ms);
  }

  async heartbeat() {
    if (this.stopped) return;
    const api = this.opts.api();
    let next = this.online;
    if (api) {
      try {
        await api.sync.health();
        next = true;
      } catch {
        next = false;
      }
    } else next = false;
    if (next !== this.online) {
      this.online = next;
      this.error = next ? null : this.error;
      this.emitStatus();
      if (next) {
        this.backoffMs = 0;
        this.schedule(100);
      }
    }
    if (this.stopped) return;
    this.hbTimer = this.opts.setTimer(() => void this.heartbeat(), this.opts.heartbeatMs);
  }

  /** Push everything pending, then pull. Safe to call concurrently (no-op while running). */
  async syncNow(): Promise<ConnectivityInfo> {
    if (this.syncing) return this.status();
    const api = this.opts.api();
    const terminalId = this.opts.terminalId();
    const branchId = this.opts.branchId();
    if (!api || !terminalId || !branchId) return this.status();
    if (!this.opts.canSync() && !(await this.opts.authenticate()) ) return this.status();
    if (!this.opts.canSync()) return this.status();
    this.syncing = true;
    this.emitStatus();
    let hadNetworkError = false;
    try {
      // Keep pulling while unregistered so the catalog stays fresh; only the push is hopeless.
      if (!this.unregistered) await this.pushAll(api, terminalId);
      await this.pull(api, branchId);
      this.online = true;
      if (!this.unregistered) this.error = null;
      this.lastSyncAt = new Date(this.opts.now()).toISOString();
      this.opts.db.setState('lastSyncAt', this.lastSyncAt);
      this.backoffMs = 0;
    } catch (e) {
      if (isTerminalGone(e)) {
        this.unregistered = true;
        this.online = true;
        this.error = 'هذا الجهاز لم يعد مسجّلاً على السيرفر — أعد تسجيل الطرفية';
        this.backoffMs = 0;
      } else {
        hadNetworkError = true;
        if (e instanceof ApiError && e.status === 0) this.online = false;
        this.error = e instanceof Error ? e.message : String(e);
        this.backoffMs = Math.min(5 * 60_000, this.backoffMs ? this.backoffMs * 2 : 2_000);
      }
    } finally {
      this.syncing = false;
      this.emitStatus();
      this.schedule(hadNetworkError ? this.backoffMs : this.opts.intervalMs);
    }
    return this.status();
  }

  /** Explicit reconnect action: verify the server first, then refresh auth and sync protected data. */
  async reconnect(): Promise<ConnectivityInfo> {
    if (this.syncing) return this.status();
    const api = this.opts.api();
    if (!api) {
      this.online = false;
      this.error = 'لا توجد جلسة دخول صالحة لإعادة الاتصال';
      this.emitStatus();
      return this.status();
    }
    try {
      await api.sync.health();
      this.online = true;
      this.error = null;
      this.backoffMs = 0;
      this.emitStatus();
    } catch (e) {
      this.online = false;
      this.error = e instanceof Error ? e.message : String(e);
      this.emitStatus();
      return this.status();
    }
    return this.syncNow();
  }

  /** Push a single op immediately (used right after a local commit when online). */
  async pushOne(opId: string): Promise<SyncOpResult | null> {
    const api = this.opts.api();
    const terminalId = this.opts.terminalId();
    // A running pushAll will pick this op up anyway; sending it twice would race the server-side claim.
    if (!api || !this.opts.canSync() || !terminalId || !this.online || this.syncing || this.unregistered) return null;
    const row = this.opts.db.pendingOps(500).find((o) => o.opId === opId);
    if (!row) return null;
    // Drain preceding dependencies (sale before return, session before movement) in one serialized path.
    await this.syncNow();
    return this.opts.db.opPayload(opId) ? null : { opId, status: 'applied' };
  }

  /** Transient server failures go back to `pending`; everything else is final. Returns true when transient. */
  private handleResult(r: SyncOpResult): boolean {
    if (r.status === 'rejected' && r.error?.code === 'TRANSIENT') {
      this.opts.db.markOp(r.opId, 'pending', { error: r.error.message });
      return true;
    }
    this.applyResult(r);
    return false;
  }

  private async pushAll(api: ApiClient, terminalId: string) {
    for (;;) {
      const batch = this.opts.db.pendingOps(this.opts.batchSize);
      if (!batch.length) return;
      const ops: SyncOp[] = batch.map((o) => {
        const localId = (o.payload as { localId?: string }).localId;
        const sale = o.type === 'sale' && localId ? this.opts.db.sale(localId) : null;
        return { opId: o.opId, type: o.type as SyncOp['type'], clientCreatedAt: o.createdAt, payload: o.payload, ...(sale ? { saleAmounts: { tax: sale.tax, total: sale.total } } : {}) };
      });
      for (const o of ops) this.opts.db.markOp(o.opId, 'sent', { bumpAttempts: true });
      let res;
      try {
        res = await api.sync.push({ terminalId, ops });
      } catch (e) {
        // The batch never landed: put it back so the panel does not show it stuck on `sent` forever.
        for (const o of ops) this.opts.db.markOp(o.opId, 'pending');
        throw e;
      }
      let transient = false;
      for (const r of res.results) if (this.handleResult(r)) transient = true;
      this.emit('data', 'sales');
      if (transient) throw new ApiError('Some operations failed transiently', 503, 'TRANSIENT');
      if (batch.length < this.opts.batchSize) return;
    }
  }

  private applyResult(r: SyncOpResult) {
    const db = this.opts.db;
    if (r.status === 'applied' || r.status === 'duplicate') {
      const op = db.opPayload(r.opId);
      if (op?.type === 'sale' && r.serverId) {
        const payload = op.payload as { localId?: string };
        if (payload.localId) db.markSaleSynced(payload.localId, r.serverId);
      }
      if (op?.type === 'register_open' && r.serverId) {
        const payload = op.payload as { sessionId?: string };
        if (payload.sessionId) db.remapSession(payload.sessionId, r.serverId);
      }
      if (op?.type === 'register_close') {
        const payload = op.payload as { sessionId?: string };
        if (payload.sessionId) db.closeLocalSession(payload.sessionId);
      }
      db.markOp(r.opId, 'applied', { serverId: r.serverId ?? null });
    } else {
      const op = db.opPayload(r.opId);
      if (op?.type === 'sale') {
        const payload = op.payload as { localId?: string };
        if (payload.localId) db.markSaleFailed(payload.localId);
      }
      db.markOp(r.opId, 'rejected', { error: `${r.error?.code ?? 'REJECTED'}: ${r.error?.message ?? ''}` });
      this.emit('rejected', r);
    }
  }

  private async pull(api: ApiClient, branchId: string) {
    const since = this.opts.db.getState('lastPullAt') ?? undefined;
    const opIds = this.opts.db.pendingOps(200).map(o => o.opId);
    const pull = since ? await api.sync.pull(branchId, since, opIds) : await api.sync.bootstrap(branchId, opIds);
    this.opts.db.db.transaction(() => {
      this.opts.db.applyPull(pull, branchId, !since);
      for (const result of pull.acknowledgedOps ?? []) this.handleResult(result);
    })();
    this.emit('data', 'catalog');
  }

  async bootstrap(api: ApiClient, branchId: string) {
    const pull = await api.sync.bootstrap(branchId, this.opts.db.pendingOps(200).map(o => o.opId));
    this.opts.db.db.transaction(() => {
      this.opts.db.applyPull(pull, branchId, true);
      for (const result of pull.acknowledgedOps ?? []) this.handleResult(result);
    })();
    this.emit('data', 'catalog');
  }

  isOnline() {
    return this.online;
  }
}
