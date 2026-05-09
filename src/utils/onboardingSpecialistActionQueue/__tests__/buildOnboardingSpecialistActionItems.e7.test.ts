/**
 * E.7 — Pure aggregation tests for the Onboarding Specialist action queue.
 *
 * Pins the (worker × entity) → action-type decision rules so a future
 * refactor of the data flow can't silently change which workers surface
 * in which band. Covers:
 *
 *   - I-9 Section 2 band: W-2, Section 1 done, Section 2 not done
 *   - Start E-Verify band: both sections done, no case yet, E-Verify enabled
 *   - Address TNC band: status=tnc OR status=further_action_required
 *   - Priority short-circuit: TNC wins over Section 2 wins over Start E-Verify
 *   - Worker-type gate: 1099 contractors never enter I-9 Section 2 / Start E-Verify
 *   - Entity gate: everifyRequired=false on entity OR row hides Start E-Verify
 *   - active=false rows skipped
 *   - My/All scope filter via myWorkerUids
 *   - Display fallbacks when user/entity caches haven't loaded
 *   - ageMs: actionable-at anchored to the right field per band
 *
 * Pure JS — no Firestore mocks, no React. Runs under `craco test`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

interface MirrorLite {
  i9SignedAt?: unknown;
}

interface EmpLite {
  id: string;
  userId: string;
  entityId: string | null;
  workerType: unknown;
  active?: unknown;
  hiredAt?: unknown;
  i9Section2CompletedAt?: unknown;
  everifyRequired?: unknown;
  everifyStatus?: unknown;
  everifyTncReceivedAt?: unknown;
  updatedAt?: unknown;
}

interface EntityLite {
  id: string;
  name: string;
  everifyRequired?: boolean;
}

interface UserLite {
  uid: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
}

import {
  buildOnboardingSpecialistActionItems,
  decideActionType,
} from '../buildOnboardingSpecialistActionItems';

const NOW = 1700000000000; // fixed clock: 2023-11-14T22:13:20Z

const baseEmp = (overrides: Partial<EmpLite> = {}): EmpLite => ({
  id: 'emp-1',
  userId: 'worker-1',
  entityId: 'ent-A',
  workerType: 'w2',
  active: true,
  ...overrides,
});

const baseEntity = (overrides: Partial<EntityLite> = {}): EntityLite => ({
  id: 'ent-A',
  name: 'C1 Select',
  ...overrides,
});

const baseUser = (overrides: Partial<UserLite> = {}): UserLite => ({
  uid: 'worker-1',
  displayName: 'Greg Worker',
  email: 'greg@example.com',
  phone: '+15555550100',
  avatarUrl: 'https://avatars.example/greg.jpg',
  ...overrides,
});

const buildInput = (args: {
  emp?: Partial<EmpLite>;
  mirror?: MirrorLite | undefined;
  entity?: Partial<EntityLite>;
  user?: Partial<UserLite>;
  myWorkerUids?: ReadonlySet<string> | null;
}) => {
  const emp = baseEmp(args.emp);
  const entity = baseEntity({ id: emp.entityId ?? 'ent-A', ...args.entity });
  const user = baseUser({ uid: emp.userId, ...args.user });
  const mirror = args.mirror;
  const evereeMirrorByKey: Record<string, MirrorLite | undefined> = {};
  if (mirror !== undefined) {
    evereeMirrorByKey[`${emp.entityId}__${emp.userId}`] = mirror;
  }
  return {
    entityEmployments: [emp],
    evereeMirrorByKey,
    entityById: { [entity.id]: entity },
    userByUid: { [user.uid]: user },
    myWorkerUids: args.myWorkerUids ?? null,
    nowMs: NOW,
  };
};

describe('E.7 — buildOnboardingSpecialistActionItems', () => {
  describe('decideActionType — TNC band', () => {
    it('returns address_tnc when status === "tnc"', () => {
      const action = decideActionType({
        emp: baseEmp({ everifyStatus: 'tnc' }) as any,
        mirror: undefined,
        entity: baseEntity() as any,
      });
      expect(action).toBe('address_tnc');
    });

    it('returns address_tnc when status === "further_action_required"', () => {
      const action = decideActionType({
        emp: baseEmp({ everifyStatus: 'further_action_required' }) as any,
        mirror: undefined,
        entity: baseEntity() as any,
      });
      expect(action).toBe('address_tnc');
    });

    it('TNC wins even when section_2 is also missing (priority short-circuit)', () => {
      const action = decideActionType({
        emp: baseEmp({ everifyStatus: 'tnc', i9Section2CompletedAt: null }) as any,
        mirror: { i9SignedAt: NOW - 1000 } as any,
        entity: baseEntity() as any,
      });
      expect(action).toBe('address_tnc');
    });
  });

  describe('decideActionType — I-9 Section 2 band', () => {
    it('returns i9_section_2 when W-2 worker has Section 1 done but not Section 2', () => {
      const action = decideActionType({
        emp: baseEmp() as any,
        mirror: { i9SignedAt: NOW - 86_400_000 } as any,
        entity: baseEntity() as any,
      });
      expect(action).toBe('i9_section_2');
    });

    it('returns null when Section 1 NOT yet signed by worker', () => {
      const action = decideActionType({
        emp: baseEmp() as any,
        mirror: { i9SignedAt: null } as any,
        entity: baseEntity() as any,
      });
      expect(action).toBeNull();
    });

    it('returns null when Section 2 already stamped', () => {
      const action = decideActionType({
        emp: baseEmp({ i9Section2CompletedAt: NOW - 1000 }) as any,
        mirror: { i9SignedAt: NOW - 86_400_000 } as any,
        entity: baseEntity() as any,
      });
      // The next band (Start E-Verify) should pick it up instead, not null.
      expect(action).toBe('start_everify');
    });

    it('returns null when worker is 1099 (contractors do not sign I-9)', () => {
      const action = decideActionType({
        emp: baseEmp({ workerType: '1099' }) as any,
        mirror: { i9SignedAt: NOW - 1000 } as any,
        entity: baseEntity() as any,
      });
      expect(action).toBeNull();
    });
  });

  describe('decideActionType — Start E-Verify band', () => {
    it('returns start_everify when both sections done, no case, E-Verify enabled', () => {
      const action = decideActionType({
        emp: baseEmp({ i9Section2CompletedAt: NOW - 1000 }) as any,
        mirror: { i9SignedAt: NOW - 86_400_000 } as any,
        entity: baseEntity() as any,
      });
      expect(action).toBe('start_everify');
    });

    it('returns null when entity has everifyRequired === false', () => {
      const action = decideActionType({
        emp: baseEmp({ i9Section2CompletedAt: NOW - 1000 }) as any,
        mirror: { i9SignedAt: NOW - 86_400_000 } as any,
        entity: baseEntity({ everifyRequired: false }) as any,
      });
      expect(action).toBeNull();
    });

    it('returns null when row override has everifyRequired === false', () => {
      const action = decideActionType({
        emp: baseEmp({
          i9Section2CompletedAt: NOW - 1000,
          everifyRequired: false,
        }) as any,
        mirror: { i9SignedAt: NOW - 86_400_000 } as any,
        entity: baseEntity() as any,
      });
      expect(action).toBeNull();
    });

    it('returns null when E-Verify status is already set (case in progress)', () => {
      const action = decideActionType({
        emp: baseEmp({
          i9Section2CompletedAt: NOW - 1000,
          everifyStatus: 'employment_authorized',
        }) as any,
        mirror: { i9SignedAt: NOW - 86_400_000 } as any,
        entity: baseEntity() as any,
      });
      expect(action).toBeNull();
    });

    it('returns start_everify when status === "not_started"', () => {
      const action = decideActionType({
        emp: baseEmp({
          i9Section2CompletedAt: NOW - 1000,
          everifyStatus: 'not_started',
        }) as any,
        mirror: { i9SignedAt: NOW - 86_400_000 } as any,
        entity: baseEntity() as any,
      });
      expect(action).toBe('start_everify');
    });
  });

  describe('buildOnboardingSpecialistActionItems — composition', () => {
    it('skips inactive rows entirely (active=false)', () => {
      const items = buildOnboardingSpecialistActionItems(
        buildInput({
          emp: { active: false, everifyStatus: 'tnc' },
        }),
      );
      expect(items).toHaveLength(0);
    });

    it('skips rows without entityId or userId', () => {
      const items = buildOnboardingSpecialistActionItems(
        buildInput({ emp: { entityId: null, everifyStatus: 'tnc' } }),
      );
      expect(items).toHaveLength(0);
    });

    it('My scope: filters out workers not owned by the current Onboarding Specialist', () => {
      const items = buildOnboardingSpecialistActionItems(
        buildInput({
          emp: { everifyStatus: 'tnc' },
          myWorkerUids: new Set(['someone-else']),
        }),
      );
      expect(items).toHaveLength(0);
    });

    it('My scope: keeps workers owned by the current Onboarding Specialist', () => {
      const items = buildOnboardingSpecialistActionItems(
        buildInput({
          emp: { everifyStatus: 'tnc' },
          myWorkerUids: new Set(['worker-1']),
        }),
      );
      expect(items).toHaveLength(1);
      expect(items[0].actionType).toBe('address_tnc');
    });

    it('All scope (myWorkerUids=null): no scope filtering', () => {
      const items = buildOnboardingSpecialistActionItems(
        buildInput({ emp: { everifyStatus: 'tnc' }, myWorkerUids: null }),
      );
      expect(items).toHaveLength(1);
    });

    it('falls back to uid/entityId display when user/entity caches are empty', () => {
      const items = buildOnboardingSpecialistActionItems({
        entityEmployments: [
          baseEmp({
            everifyStatus: 'tnc',
            everifyTncReceivedAt: NOW - 5000,
          }) as any,
        ],
        evereeMirrorByKey: {},
        entityById: {},
        userByUid: {},
        myWorkerUids: null,
        nowMs: NOW,
      });
      expect(items).toHaveLength(1);
      expect(items[0].workerName).toBe('worker-1');
      expect(items[0].entityName).toBe('ent-A');
    });

    it('produces stable composite ids: `${actionType}__${entityId}__${userId}`', () => {
      const items = buildOnboardingSpecialistActionItems(
        buildInput({ emp: { everifyStatus: 'tnc' } }),
      );
      expect(items[0].id).toBe('address_tnc__ent-A__worker-1');
    });

    it('priority is mirrored on the item for inline sort', () => {
      const items = buildOnboardingSpecialistActionItems(
        buildInput({ emp: { everifyStatus: 'tnc' } }),
      );
      expect(items[0].priority).toBe(0);
    });
  });

  describe('buildOnboardingSpecialistActionItems — ageMs anchoring', () => {
    it('TNC band anchors to everifyTncReceivedAt when present', () => {
      const items = buildOnboardingSpecialistActionItems(
        buildInput({
          emp: {
            everifyStatus: 'tnc',
            everifyTncReceivedAt: NOW - 90_000,
            updatedAt: NOW - 1_000_000,
          },
        }),
      );
      expect(items[0].ageMs).toBe(90_000);
    });

    it('I-9 Section 2 anchors to mirror.i9SignedAt when present', () => {
      const items = buildOnboardingSpecialistActionItems(
        buildInput({
          emp: { hiredAt: NOW - 86_400_000 },
          mirror: { i9SignedAt: NOW - 3_600_000 },
        }),
      );
      expect(items[0].ageMs).toBe(3_600_000);
    });

    it('Start E-Verify anchors to i9Section2CompletedAt when present', () => {
      const items = buildOnboardingSpecialistActionItems(
        buildInput({
          emp: {
            i9Section2CompletedAt: NOW - 600_000,
            hiredAt: NOW - 86_400_000,
          },
          mirror: { i9SignedAt: NOW - 3_600_000 },
        }),
      );
      expect(items[0].ageMs).toBe(600_000);
    });
  });

  describe('buildOnboardingSpecialistActionItems — entity_employments-level everify override', () => {
    it('emp-level everifyRequired=false hides start_everify even when entity-level enabled', () => {
      const items = buildOnboardingSpecialistActionItems(
        buildInput({
          emp: {
            i9Section2CompletedAt: NOW - 1000,
            everifyRequired: false,
          },
          mirror: { i9SignedAt: NOW - 86_400_000 },
          entity: { everifyRequired: true },
        }),
      );
      expect(items).toHaveLength(0);
    });

    it('entity-level everifyRequired=false hides start_everify even when emp-level enabled', () => {
      const items = buildOnboardingSpecialistActionItems(
        buildInput({
          emp: {
            i9Section2CompletedAt: NOW - 1000,
            everifyRequired: true,
          },
          mirror: { i9SignedAt: NOW - 86_400_000 },
          entity: { everifyRequired: false },
        }),
      );
      expect(items).toHaveLength(0);
    });
  });
});
