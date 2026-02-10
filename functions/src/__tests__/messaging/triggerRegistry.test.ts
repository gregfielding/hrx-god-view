import { expect } from 'chai';
import {
  SYSTEM_TRIGGER_CATALOG,
  SYSTEM_TRIGGER_KEYS,
  isSystemTriggerKey,
  mapApplicationStatusToTriggerKey,
  mapAssignmentStatusToTriggerKey,
} from '../../messaging/triggerRegistry';

describe('triggerRegistry', () => {
  it('contains unique trigger keys in the catalog', () => {
    const keys = SYSTEM_TRIGGER_CATALOG.map((entry) => entry.key);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).to.equal(keys.length);
  });

  it('maps application statuses to trigger keys', () => {
    expect(mapApplicationStatusToTriggerKey('screened')).to.equal(
      SYSTEM_TRIGGER_KEYS.applicationStatusScreened
    );
    expect(mapApplicationStatusToTriggerKey('advanced')).to.equal(
      SYSTEM_TRIGGER_KEYS.applicationStatusAdvanced
    );
    expect(mapApplicationStatusToTriggerKey('interview')).to.equal(
      SYSTEM_TRIGGER_KEYS.applicationStatusInterview
    );
    expect(mapApplicationStatusToTriggerKey('offer')).to.equal(
      SYSTEM_TRIGGER_KEYS.applicationStatusOffer
    );
    expect(mapApplicationStatusToTriggerKey('hired')).to.equal(
      SYSTEM_TRIGGER_KEYS.applicationStatusHired
    );
    expect(mapApplicationStatusToTriggerKey('rejected')).to.equal(
      SYSTEM_TRIGGER_KEYS.applicationStatusRejected
    );
    expect(mapApplicationStatusToTriggerKey('unknown')).to.equal(null);
  });

  it('maps assignment statuses to trigger keys', () => {
    expect(mapAssignmentStatusToTriggerKey('confirmed')).to.equal(
      SYSTEM_TRIGGER_KEYS.assignmentStatusConfirmed
    );
    expect(mapAssignmentStatusToTriggerKey('active')).to.equal(
      SYSTEM_TRIGGER_KEYS.assignmentStatusActive
    );
    expect(mapAssignmentStatusToTriggerKey('completed')).to.equal(
      SYSTEM_TRIGGER_KEYS.assignmentStatusCompleted
    );
    expect(mapAssignmentStatusToTriggerKey('canceled')).to.equal(
      SYSTEM_TRIGGER_KEYS.assignmentStatusCancelled
    );
    expect(mapAssignmentStatusToTriggerKey('cancelled')).to.equal(
      SYSTEM_TRIGGER_KEYS.assignmentStatusCancelled
    );
    expect(mapAssignmentStatusToTriggerKey('unknown')).to.equal(null);
  });

  it('validates known trigger keys', () => {
    expect(isSystemTriggerKey(SYSTEM_TRIGGER_KEYS.accountCreated)).to.equal(
      true
    );
    expect(isSystemTriggerKey(SYSTEM_TRIGGER_KEYS.assignmentCreated)).to.equal(
      true
    );
    expect(isSystemTriggerKey('not_real_trigger')).to.equal(false);
  });
});
