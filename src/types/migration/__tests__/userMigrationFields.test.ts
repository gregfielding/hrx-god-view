/**
 * Tests for `buildUserMigrationFieldsPatch` — the helper the BI.1 row
 * processor (P3) will call when it touches a `users/{uid}` doc.
 *
 * Contract verified here:
 *   - Net-new user (existingFields = null) → all three fields stamped.
 *   - Existing user with no migration fields → all three stamped.
 *   - Existing user already migrated → migrationSource + migratedAt
 *     are NEVER overwritten (Appendix A.C.1: "first time only").
 *   - tempworksEmployeeIds dedups on push (set semantics, latest first).
 *   - Returns null when the patch would be empty (no-op write avoided).
 *   - Whitespace-only / empty Tempworks IDs are dropped.
 */

import { Timestamp } from 'firebase/firestore';

import {
  buildUserMigrationFieldsPatch,
  UserMigrationFields,
} from '../userMigrationFields';

const NOW = Timestamp.fromDate(new Date('2026-05-07T12:00:00Z'));
const EARLIER = Timestamp.fromDate(new Date('2026-04-01T12:00:00Z'));

describe('buildUserMigrationFieldsPatch', () => {
  it('stamps all three fields on a net-new user', () => {
    const patch = buildUserMigrationFieldsPatch({
      existingFields: null,
      newTempworksEmployeeId: 'TW-001',
      source: 'tempworks_bulk_invite',
      now: NOW,
    });
    expect(patch).toEqual({
      tempworksEmployeeIds: ['TW-001'],
      migrationSource: 'tempworks_bulk_invite',
      migratedAt: NOW,
    });
  });

  it('stamps all three fields on an existing user with no migration history', () => {
    const patch = buildUserMigrationFieldsPatch({
      existingFields: {},
      newTempworksEmployeeId: 'TW-001',
      source: 'tempworks_bulk_invite',
      now: NOW,
    });
    expect(patch).toEqual({
      tempworksEmployeeIds: ['TW-001'],
      migrationSource: 'tempworks_bulk_invite',
      migratedAt: NOW,
    });
  });

  it('does NOT overwrite migrationSource on subsequent runs', () => {
    const existing: UserMigrationFields = {
      tempworksEmployeeIds: ['TW-001'],
      migrationSource: 'tempworks_bulk_invite',
      migratedAt: EARLIER,
    };
    const patch = buildUserMigrationFieldsPatch({
      existingFields: existing,
      newTempworksEmployeeId: 'TW-002',
      source: 'tempworks_bulk_invite',
      now: NOW,
    });
    expect(patch).toEqual({
      tempworksEmployeeIds: ['TW-002', 'TW-001'],
    });
    expect(patch).not.toHaveProperty('migrationSource');
    expect(patch).not.toHaveProperty('migratedAt');
  });

  it('does NOT overwrite migratedAt even if migrationSource is unset', () => {
    const existing: UserMigrationFields = {
      migratedAt: EARLIER,
    };
    const patch = buildUserMigrationFieldsPatch({
      existingFields: existing,
      newTempworksEmployeeId: 'TW-001',
      source: 'tempworks_bulk_invite',
      now: NOW,
    });
    expect(patch?.migratedAt).toBeUndefined();
    expect(patch?.migrationSource).toBe('tempworks_bulk_invite');
  });

  it('dedups the new Tempworks ID against the existing array (set semantics)', () => {
    const existing: UserMigrationFields = {
      tempworksEmployeeIds: ['TW-001', 'TW-002'],
      migrationSource: 'tempworks_bulk_invite',
      migratedAt: EARLIER,
    };
    const patch = buildUserMigrationFieldsPatch({
      existingFields: existing,
      newTempworksEmployeeId: 'TW-001', // already present
      source: 'tempworks_bulk_invite',
      now: NOW,
    });
    expect(patch).toBeNull();
  });

  it('returns null when nothing is stale (idempotent re-run)', () => {
    const existing: UserMigrationFields = {
      tempworksEmployeeIds: ['TW-001'],
      migrationSource: 'tempworks_bulk_invite',
      migratedAt: EARLIER,
    };
    const patch = buildUserMigrationFieldsPatch({
      existingFields: existing,
      newTempworksEmployeeId: 'TW-001',
      source: 'tempworks_bulk_invite',
      now: NOW,
    });
    expect(patch).toBeNull();
  });

  it('places the newest ID first (latest first ordering)', () => {
    const existing: UserMigrationFields = {
      tempworksEmployeeIds: ['TW-001', 'TW-002'],
      migrationSource: 'tempworks_bulk_invite',
      migratedAt: EARLIER,
    };
    const patch = buildUserMigrationFieldsPatch({
      existingFields: existing,
      newTempworksEmployeeId: 'TW-003',
      source: 'tempworks_bulk_invite',
      now: NOW,
    });
    expect(patch?.tempworksEmployeeIds).toEqual(['TW-003', 'TW-001', 'TW-002']);
  });

  it('drops a whitespace-only Tempworks ID', () => {
    const patch = buildUserMigrationFieldsPatch({
      existingFields: null,
      newTempworksEmployeeId: '   ',
      source: 'tempworks_bulk_invite',
      now: NOW,
    });
    expect(patch).toEqual({
      migrationSource: 'tempworks_bulk_invite',
      migratedAt: NOW,
    });
    expect(patch).not.toHaveProperty('tempworksEmployeeIds');
  });

  it('trims a Tempworks ID before comparing for dedup', () => {
    const existing: UserMigrationFields = {
      tempworksEmployeeIds: ['TW-001'],
      migrationSource: 'tempworks_bulk_invite',
      migratedAt: EARLIER,
    };
    const patch = buildUserMigrationFieldsPatch({
      existingFields: existing,
      newTempworksEmployeeId: '  TW-001  ',
      source: 'tempworks_bulk_invite',
      now: NOW,
    });
    expect(patch).toBeNull();
  });

  it('honors a non-tempworks source on a net-new user', () => {
    const patch = buildUserMigrationFieldsPatch({
      existingFields: null,
      newTempworksEmployeeId: '',
      source: 'manual_csv',
      now: NOW,
    });
    expect(patch?.migrationSource).toBe('manual_csv');
  });
});
