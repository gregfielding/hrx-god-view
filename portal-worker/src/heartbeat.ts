/**
 * Worker presence: tenants/{t}/portal_workers/{workerId} (one per process)
 * plus a rolling summary at tenants/{t}/integration_health/portal_worker
 * for a future Scheduling Health tile and for the dead-man alert.
 */
import os from 'node:os';
import type {
  PortalActionType,
  PortalProvider,
  PortalWorkerDoc,
  PortalWorkerSessionInfo,
} from '../../shared/portalActions.ts';
import type { WorkerConfig } from './config.ts';
import { WORKER_VERSION } from './config.ts';
import { Timestamp, type Firestore } from './firebase.ts';
import { log } from './logger.ts';
import { queueCounts, type QueueCounts } from './queue.ts';

export class Heartbeat {
  private status: PortalWorkerDoc['status'] = 'starting';
  private busyWith: PortalWorkerDoc['busyWith'] = null;
  private sessions: PortalWorkerDoc['sessions'] = {};
  private counters: PortalWorkerDoc['counters'] = { succeeded: 0, failed: 0, needsHuman: 0 };
  private timer: NodeJS.Timeout | null = null;
  private readonly startedAt = Timestamp.now();
  private lastCounts: QueueCounts | null = null;
  private lastCountsAt = 0;

  constructor(
    private readonly db: Firestore,
    private readonly config: WorkerConfig,
  ) {}

  private get ref() {
    return this.db.collection('tenants').doc(this.config.tenantId).collection('portal_workers').doc(this.config.workerId);
  }

  private get healthRef() {
    return this.db.collection('tenants').doc(this.config.tenantId).collection('integration_health').doc('portal_worker');
  }

  setStatus(status: PortalWorkerDoc['status']): void {
    this.status = status;
  }

  setBusy(actionId: string, provider: PortalProvider, action: PortalActionType): void {
    this.status = 'busy';
    this.busyWith = { actionId, provider, action, since: new Date().toISOString() };
  }

  setIdle(): void {
    this.status = 'idle';
    this.busyWith = null;
  }

  setSession(provider: PortalProvider, info: Omit<PortalWorkerSessionInfo, 'checkedAt'>): void {
    this.sessions[provider] = { ...info, checkedAt: new Date().toISOString() };
  }

  getSession(provider: PortalProvider): PortalWorkerSessionInfo | undefined {
    return this.sessions[provider];
  }

  bump(counter: keyof PortalWorkerDoc['counters']): void {
    this.counters[counter] += 1;
  }

  start(): void {
    void this.beat();
    this.timer = setInterval(() => void this.beat(), this.config.heartbeatMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.status = 'stopped';
    this.busyWith = null;
    try {
      await this.ref.set({ ...this.snapshot(), stoppedAt: Timestamp.now() }, { merge: true });
      await this.healthRef.set(
        { workers: { [this.config.workerId]: { status: 'stopped', stoppedAt: new Date().toISOString() } }, updatedAt: Timestamp.now() },
        { merge: true },
      );
    } catch (err) {
      log.warn('final heartbeat failed', { err });
    }
  }

  private snapshot(): PortalWorkerDoc {
    return {
      workerId: this.config.workerId,
      hostname: os.hostname(),
      pid: process.pid,
      version: WORKER_VERSION,
      enabledProviders: this.config.enabledProviders,
      startedAt: this.startedAt,
      lastHeartbeatAt: Timestamp.now(),
      stoppedAt: null,
      status: this.status,
      busyWith: this.busyWith,
      sessions: this.sessions,
      counters: this.counters,
    };
  }

  async beat(): Promise<void> {
    try {
      const snap = this.snapshot();
      await this.ref.set(snap, { merge: true });

      // Queue counts are 5 aggregation reads — refresh at most once a minute.
      if (Date.now() - this.lastCountsAt > 60_000) {
        this.lastCounts = await queueCounts(this.db, this.config.tenantId);
        this.lastCountsAt = Date.now();
      }
      await this.healthRef.set(
        {
          workers: {
            [this.config.workerId]: {
              hostname: snap.hostname,
              status: snap.status,
              lastHeartbeatAt: new Date().toISOString(),
              busyWith: snap.busyWith,
              sessions: snap.sessions,
              enabledProviders: snap.enabledProviders,
              version: snap.version,
            },
          },
          queue: this.lastCounts,
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      );
    } catch (err) {
      log.warn('heartbeat failed', { err });
    }
  }
}
