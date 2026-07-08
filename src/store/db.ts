/**
 * IndexedDB persistence: two object stores, scans and reports.
 * Local-first — nothing leaves the device. Deleting removes the rows.
 * Browser-API boundary file (like capture/webxr.ts): everything else stays pure.
 */

import type { ScanSession } from '../core/types';
import { ScanDiffError } from '../core/types';
import { decodeScan, encodeScan, type StoredScan } from './codec';

const DB_NAME = 'scan-diff';
const DB_VERSION = 1;

export interface StoredReport {
  id: string;
  title: string;
  createdAt: number;
  scanAId: string;
  scanBId: string;
  html: string;
}

export interface ScanListEntry {
  id: string;
  label: string;
  createdAt: number;
  pointCount: number;
  hasAnchor: boolean;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('scans')) db.createObjectStore('scans', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('reports')) db.createObjectStore('reports', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new ScanDiffError('store-failure', 'Could not open local storage.'));
  });
}

function tx<T>(
  storeName: 'scans' | 'reports',
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const req = fn(t.objectStore(storeName));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () =>
          reject(new ScanDiffError('store-failure', `Local storage ${mode === 'readonly' ? 'read' : 'write'} failed.`));
        t.oncomplete = () => db.close();
      }),
  );
}

export async function saveScan(session: ScanSession): Promise<void> {
  await tx('scans', 'readwrite', (s) => s.put(encodeScan(session)));
}

export async function getScan(id: string): Promise<ScanSession | null> {
  const r = await tx<StoredScan | undefined>('scans', 'readonly', (s) => s.get(id) as IDBRequest<StoredScan | undefined>);
  return r ? decodeScan(r) : null;
}

export async function listScans(): Promise<ScanListEntry[]> {
  const all = await tx<StoredScan[]>('scans', 'readonly', (s) => s.getAll() as IDBRequest<StoredScan[]>);
  return all
    .map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: r.createdAt,
      pointCount: r.pointCount,
      hasAnchor: r.anchor !== null,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteScan(id: string): Promise<void> {
  await tx('scans', 'readwrite', (s) => s.delete(id));
}

export async function saveReport(report: StoredReport): Promise<void> {
  await tx('reports', 'readwrite', (s) => s.put(report));
}

export async function listReports(): Promise<Array<Omit<StoredReport, 'html'>>> {
  const all = await tx<StoredReport[]>('reports', 'readonly', (s) => s.getAll() as IDBRequest<StoredReport[]>);
  return all
    .map(({ html: _html, ...meta }) => meta)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function getReport(id: string): Promise<StoredReport | null> {
  const r = await tx<StoredReport | undefined>('reports', 'readonly', (s) => s.get(id) as IDBRequest<StoredReport | undefined>);
  return r ?? null;
}

export async function deleteReport(id: string): Promise<void> {
  await tx('reports', 'readwrite', (s) => s.delete(id));
}
