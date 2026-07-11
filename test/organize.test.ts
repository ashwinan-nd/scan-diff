import { describe, expect, it } from 'vitest';
import { filterScans, groupScans, labelCollides, labelStem, sortScans } from '../src/ui/organize';
import type { ScanListEntry } from '../src/store/db';

const scan = (label: string, createdAt: number, pointCount = 1000): ScanListEntry => ({
  id: `${label}-${createdAt}`,
  label,
  createdAt,
  pointCount,
  hasAnchor: false,
});

const SCANS = [
  scan('Kitchen — baseline', 100),
  scan('kitchen rescan', 200),
  scan('Garage v1', 150),
  scan('Garage v2', 250),
  scan('one-off site', 300),
];

describe('filterScans', () => {
  it('matches case-insensitive substrings', () => {
    expect(filterScans(SCANS, 'KITCH').length).toBe(2);
    expect(filterScans(SCANS, 'garage').length).toBe(2);
    expect(filterScans(SCANS, 'zzz')).toEqual([]);
  });
  it('empty query returns everything', () => {
    expect(filterScans(SCANS, '  ')).toEqual(SCANS);
  });
});

describe('sortScans', () => {
  it('newest / oldest / name / points', () => {
    expect(sortScans(SCANS, 'newest')[0]!.label).toBe('one-off site');
    expect(sortScans(SCANS, 'oldest')[0]!.label).toBe('Kitchen — baseline');
    expect(sortScans(SCANS, 'name')[0]!.label).toBe('Garage v1');
    const byPoints = sortScans([scan('a', 1, 50), scan('b', 2, 5000)], 'points');
    expect(byPoints[0]!.label).toBe('b');
  });
  it('does not mutate the input', () => {
    const input = [...SCANS];
    sortScans(input, 'name');
    expect(input.map((s) => s.label)).toEqual(SCANS.map((s) => s.label));
  });
});

describe('labelStem', () => {
  it('strips sequence words, versions, punctuation, parentheticals', () => {
    expect(labelStem('Kitchen — baseline')).toBe('kitchen');
    expect(labelStem('kitchen rescan')).toBe('kitchen');
    expect(labelStem('Garage v2')).toBe('garage');
    expect(labelStem('Unit 4B (move-out)')).toBe('unit 4b');
  });
});

describe('groupScans', () => {
  it('groups stems with >=2 members, newest group first, singletons trail', () => {
    const groups = groupScans(SCANS);
    // garage group newest member 250 > kitchen 200
    expect(groups[0]!.scans.length).toBe(2);
    expect(groups[0]!.name.toLowerCase()).toContain('garage');
    expect(groups[1]!.name.toLowerCase()).toContain('kitchen');
    const trailing = groups[groups.length - 1]!;
    expect(trailing.name).toBe('');
    expect(trailing.scans[0]!.label).toBe('one-off site');
  });
  it('all singletons yields one unnamed group', () => {
    const groups = groupScans([scan('alpha', 1), scan('beta', 2)]);
    expect(groups.length).toBe(1);
    expect(groups[0]!.name).toBe('');
    expect(groups[0]!.scans.length).toBe(2);
  });
});

describe('labelCollides', () => {
  it('case-insensitive, trimmed', () => {
    expect(labelCollides('  KITCHEN — BASELINE ', SCANS)).toBe(true);
    expect(labelCollides('brand new', SCANS)).toBe(false);
  });
});
