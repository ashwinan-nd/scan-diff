/**
 * Library organization: pure, tested helpers for filtering, sorting, and
 * grouping scans — the flat undifferentiated list was a CRITIQUE.md finding
 * (colliding names, no structure at volume). UI wires these to controls;
 * nothing here touches the DOM.
 */

import type { ScanListEntry } from '../store/db';

export type ScanSort = 'newest' | 'oldest' | 'name' | 'points';

export function filterScans(scans: ScanListEntry[], query: string): ScanListEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return scans;
  return scans.filter((s) => s.label.toLowerCase().includes(q));
}

export function sortScans(scans: ScanListEntry[], sort: ScanSort): ScanListEntry[] {
  const copy = [...scans];
  switch (sort) {
    case 'newest':
      return copy.sort((a, b) => b.createdAt - a.createdAt);
    case 'oldest':
      return copy.sort((a, b) => a.createdAt - b.createdAt);
    case 'name':
      return copy.sort((a, b) => a.label.localeCompare(b.label) || b.createdAt - a.createdAt);
    case 'points':
      return copy.sort((a, b) => b.pointCount - a.pointCount);
  }
}

/**
 * Normalized label stem for grouping: lowercase, trailing separators/digits/
 * common sequence words stripped — "Kitchen — Monday", "kitchen 2" and
 * "Kitchen (rescan)" all stem to "kitchen".
 */
export function labelStem(label: string): string {
  return label
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(rescan|baseline|before|after|final|v?\d+)\b/gi, ' ')
    .replace(/[\s\-_—–·.:,]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export interface ScanGroup {
  /** display name: the stem title-cased-ish (first entry's casing preferred) */
  name: string;
  scans: ScanListEntry[];
}

/**
 * Group scans by label stem, preserving the given order inside groups.
 * Groups appear in order of their newest member; singletons collect into a
 * trailing catch-all group with name ''.
 */
export function groupScans(scans: ScanListEntry[]): ScanGroup[] {
  const byStem = new Map<string, ScanListEntry[]>();
  for (const s of scans) {
    const stem = labelStem(s.label) || s.label.toLowerCase();
    const list = byStem.get(stem);
    if (list) list.push(s);
    else byStem.set(stem, [s]);
  }
  const groups: ScanGroup[] = [];
  const singles: ScanListEntry[] = [];
  for (const [, list] of byStem) {
    if (list.length >= 2) {
      // display name from the shared prefix of the first member's label
      groups.push({ name: displayName(list), scans: list });
    } else {
      singles.push(list[0]!);
    }
  }
  groups.sort(
    (a, b) => Math.max(...b.scans.map((s) => s.createdAt)) - Math.max(...a.scans.map((s) => s.createdAt)),
  );
  if (singles.length) groups.push({ name: '', scans: singles });
  return groups;
}

function displayName(list: ScanListEntry[]): string {
  const stem = labelStem(list[0]!.label);
  if (!stem) return list[0]!.label;
  // recover casing from the original label where the stem's first word appears
  const first = stem.split(' ')[0]!;
  const m = list[0]!.label.toLowerCase().indexOf(first);
  if (m >= 0) {
    return list[0]!.label.slice(m, m + stem.length).trim() || stem;
  }
  return stem;
}

/** Does a label collide (case-insensitive, trimmed) with an existing scan? */
export function labelCollides(label: string, scans: ScanListEntry[]): boolean {
  const norm = label.trim().toLowerCase();
  return scans.some((s) => s.label.trim().toLowerCase() === norm);
}
