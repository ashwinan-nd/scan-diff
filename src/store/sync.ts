/**
 * Remote-sync boundary — the seam a future backend plugs into.
 *
 * Contract rules (so wiring a server never touches pipeline or UI logic):
 *  - The unit of sync is the encoded StoredScan / StoredReport, exactly what
 *    IndexedDB holds. The backend never sees pipeline internals.
 *  - Everything is optional: the app is fully functional with NullSyncBackend
 *    (the default, local-only). UI may show sync state but must never block
 *    scanning/reviewing on network availability.
 *  - Conflict policy is last-writer-wins on `createdAt`; scan ids are
 *    client-generated and globally unique (timestamp + entropy), so pushes
 *    are idempotent puts, never merges.
 *  - Privacy stance stays local-first: sync is opt-in per device, and
 *    `deleteRemote` must hard-delete (the report is the user's evidence;
 *    the server is a mirror, not an archive).
 */

import type { StoredScan } from './codec';
import type { StoredReport } from './db';

export interface RemoteRef {
  id: string;
  /** last-modified stamp on the server, ms epoch */
  updatedAt: number;
  /** payload bytes on the server (progress display) */
  sizeBytes: number;
}

export interface SyncBackend {
  /** human-readable target ("none", "https://api.example.com") for the UI */
  readonly label: string;
  listRemoteScans(): Promise<RemoteRef[]>;
  pushScan(scan: StoredScan): Promise<RemoteRef>;
  pullScan(id: string): Promise<StoredScan | null>;
  listRemoteReports(): Promise<RemoteRef[]>;
  pushReport(report: StoredReport): Promise<RemoteRef>;
  pullReport(id: string): Promise<StoredReport | null>;
  deleteRemote(kind: 'scan' | 'report', id: string): Promise<void>;
}

/** Default: no backend. Every operation is a cheap no-op. */
export class NullSyncBackend implements SyncBackend {
  readonly label = 'none (local-only)';
  async listRemoteScans(): Promise<RemoteRef[]> {
    return [];
  }
  async pushScan(): Promise<RemoteRef> {
    throw new Error('No sync backend configured.');
  }
  async pullScan(): Promise<StoredScan | null> {
    return null;
  }
  async listRemoteReports(): Promise<RemoteRef[]> {
    return [];
  }
  async pushReport(): Promise<RemoteRef> {
    throw new Error('No sync backend configured.');
  }
  async pullReport(): Promise<StoredReport | null> {
    return null;
  }
  async deleteRemote(): Promise<void> {
    /* nothing to delete */
  }
}

let active: SyncBackend = new NullSyncBackend();

export function getSyncBackend(): SyncBackend {
  return active;
}

/** Called once at startup by whoever wires a real backend. */
export function setSyncBackend(backend: SyncBackend): void {
  active = backend;
}
