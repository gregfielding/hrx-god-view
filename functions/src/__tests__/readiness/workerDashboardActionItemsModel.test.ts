/**
 * Parity tests for `workerDashboardActionItemsModel`.
 *
 * Pins the server-side V2 snapshot output for the case matrix in
 * `docs/WORKER_ACTION_ITEMS_V2_CURSOR_BRIEF.md` §2.6:
 *   1. DOB gate alone
 *   2. Phone gate alone
 *   3. Pending assignment + missing photo → assignment wins
 *   4. Drug schedule + verify phone → score order
 *   5. Both AI prescreen branches
 *   6. Dismissed `add_profile_photo` is excluded
 *
 * Plus a few invariants (sourceVersion, score table aligned with contract,
 * inputsHash determinism).
 */

import { expect } from 'chai';
import {
  buildWorkerDashboardActionItemsSnapshot,
  type WorkerDashboardActionItemsModelInput,
} from '../../readiness/workerDashboardActionItemsModel';
import type {
  WorkerDashboardActionItemId,
  WorkerDashboardActionItemV1,
} from '../../readiness/workerDashboardActionItemsTypes';
import { WORKER_DASHBOARD_ACTION_ITEM_PRIORITY_SCORES } from '../../readiness/workerDashboardActionItemsTypes';

const VALID_USER_BASE: Record<string, unknown> = {
  // Adult DOB so the gate doesn't fire (computed relative to today —
  // 1990-06-15 yields well over 18 for the foreseeable future).
  dob: '1990-06-15',
  phone: '5125551212',
  phoneVerified: true,
  last4SSN: '1234',
  addressInfo: {
    streetAddress: '100 Test Way',
    city: 'Austin',
    state: 'TX',
    zip: '78701',
    homeLat: 30.27,
    homeLng: -97.74,
  },
  emergencyContact: { name: 'Pat Doe', phone: '5125559999' },
  workerProfile: { photoUrl: 'https://example.com/p.jpg' },
};

function emptyCompliance() {
  return {
    backgroundApplicantAction: false,
    backgroundIssueAction: false,
    drugScheduleRequired: false,
    drugRescheduleRequired: false,
    everifyWorkerAction: false,
  };
}

function input(
  overrides: Partial<WorkerDashboardActionItemsModelInput>,
): WorkerDashboardActionItemsModelInput {
  return {
    userDoc: VALID_USER_BASE,
    pendingAssignments: [],
    compliance: emptyCompliance(),
    prescreen: { items: [] },
    tenantId: 'BCiP2bQ9CgVOCTfV6MhD',
    ...overrides,
  };
}

function ids(items: WorkerDashboardActionItemV1[]): WorkerDashboardActionItemId[] {
  return items.map((i) => i.id);
}

describe('workerDashboardActionItemsModel — buildWorkerDashboardActionItemsSnapshot', () => {
  describe('shape invariants', () => {
    it('always sets sourceVersion=1 and a non-empty inputsHash', () => {
      const out = buildWorkerDashboardActionItemsSnapshot(input({}));
      expect(out.sourceVersion).to.equal(1);
      expect(out.inputsHash).to.be.a('string').with.length.greaterThan(0);
    });

    it('uses the contract score table from the types module', () => {
      const out = buildWorkerDashboardActionItemsSnapshot(
        input({
          userDoc: { ...VALID_USER_BASE, last4SSN: '' },
        }),
      );
      const last4 = out.items.find((i) => i.id === 'add_tax_identity_last4');
      expect(last4, 'add_tax_identity_last4 should appear when last4 missing').to.exist;
      expect(last4!.priorityScore).to.equal(
        WORKER_DASHBOARD_ACTION_ITEM_PRIORITY_SCORES.add_tax_identity_last4,
      );
    });

    it('sort is stable: same input → same hash + same order', () => {
      const a = buildWorkerDashboardActionItemsSnapshot(
        input({
          userDoc: { ...VALID_USER_BASE, last4SSN: '', addressInfo: {} },
        }),
      );
      const b = buildWorkerDashboardActionItemsSnapshot(
        input({
          userDoc: { ...VALID_USER_BASE, last4SSN: '', addressInfo: {} },
        }),
      );
      expect(a.inputsHash).to.equal(b.inputsHash);
      expect(ids(a.items)).to.deep.equal(ids(b.items));
    });

    it('items are sorted by priorityScore desc', () => {
      const out = buildWorkerDashboardActionItemsSnapshot(
        input({
          userDoc: {
            ...VALID_USER_BASE,
            last4SSN: '', // 610
            addressInfo: {}, // 600 — confirm_home_address
            workerProfile: {}, // 400 — add_profile_photo (no auth avatar)
          },
          authAvatarUrl: null,
          compliance: { ...emptyCompliance(), drugScheduleRequired: true }, // 700
        }),
      );
      const scores = out.items.map((i) => i.priorityScore);
      const sorted = [...scores].sort((a, b) => b - a);
      expect(scores).to.deep.equal(sorted);
    });
  });

  describe('case 1: DOB gate alone', () => {
    it('missing DOB suppresses every other profile candidate', () => {
      const out = buildWorkerDashboardActionItemsSnapshot(
        input({
          userDoc: {
            ...VALID_USER_BASE,
            dob: undefined,
            last4SSN: '', // would otherwise produce add_tax_identity_last4
            phone: '', // phone gate would also fire — DOB still wins
            phoneVerified: false,
            addressInfo: {},
            emergencyContact: {},
            workerProfile: {},
          },
        }),
      );
      expect(ids(out.items)).to.deep.equal(['confirm_date_of_birth']);
      const item = out.items[0];
      expect(item.qaEvaluatedFields.gate).to.equal('dob');
      expect(item.qaEvaluatedFields.reason).to.equal('missing');
    });

    it('under-18 DOB swaps the i18n keys to the under-18 variants', () => {
      const today = new Date();
      const sixteenYearsAgo = new Date(
        today.getFullYear() - 16,
        today.getMonth(),
        today.getDate(),
      );
      const dob =
        sixteenYearsAgo.getFullYear() +
        '-' +
        String(sixteenYearsAgo.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(sixteenYearsAgo.getDate()).padStart(2, '0');
      const out = buildWorkerDashboardActionItemsSnapshot(
        input({ userDoc: { ...VALID_USER_BASE, dob } }),
      );
      expect(ids(out.items)).to.deep.equal(['confirm_date_of_birth']);
      expect(out.items[0].titleKey).to.equal('dashboard.actionItems.dobUnder18Title');
      expect(out.items[0].qaEvaluatedFields.reason).to.equal('under18');
    });
  });

  describe('case 2: phone gate alone', () => {
    it('missing US phone digits → only verify_phone_number with the add variant', () => {
      const out = buildWorkerDashboardActionItemsSnapshot(
        input({
          userDoc: {
            ...VALID_USER_BASE,
            phone: '',
            phoneVerified: false,
            last4SSN: '', // would otherwise show
          },
        }),
      );
      expect(ids(out.items)).to.deep.equal(['verify_phone_number']);
      expect(out.items[0].titleKey).to.equal('dashboard.actionItems.verifyPhoneTitleAdd');
      // No `?verify=phone` query because there's nothing to verify yet.
      expect(out.items[0].href).to.equal('/c1/workers/profile/personal-details');
    });

    it('valid 10-digit phone but unverified → verify variant + ?verify=phone href', () => {
      const out = buildWorkerDashboardActionItemsSnapshot(
        input({
          userDoc: {
            ...VALID_USER_BASE,
            phone: '5125551212',
            phoneVerified: false,
            last4SSN: '',
          },
        }),
      );
      expect(ids(out.items)).to.deep.equal(['verify_phone_number']);
      expect(out.items[0].titleKey).to.equal('dashboard.actionItems.verifyPhoneTitleVerify');
      expect(out.items[0].href).to.equal(
        '/c1/workers/profile/personal-details?verify=phone',
      );
    });
  });

  describe('case 3: pending assignment + missing photo → assignment wins', () => {
    it('assignment_confirmation_required appears first and pushes photo below the home cap', () => {
      const out = buildWorkerDashboardActionItemsSnapshot(
        input({
          userDoc: {
            ...VALID_USER_BASE,
            workerProfile: {}, // photo missing
          },
          authAvatarUrl: null,
          pendingAssignments: [
            { assignmentId: 'a-late', startAtMs: Date.UTC(2026, 5, 2) },
            { assignmentId: 'a-early', startAtMs: Date.UTC(2026, 4, 11) },
          ],
        }),
      );
      const list = ids(out.items);
      expect(list[0]).to.equal('assignment_confirmation_required');
      expect(list).to.include('add_profile_photo');
      // Earliest start wins.
      expect(out.items[0].qaEvaluatedFields.assignmentId).to.equal('a-early');
    });

    it('assignment with no startDate sorts after dated ones (startAtMs=0 → infinity)', () => {
      const out = buildWorkerDashboardActionItemsSnapshot(
        input({
          pendingAssignments: [
            { assignmentId: 'a-undated', startAtMs: 0 },
            { assignmentId: 'a-tomorrow', startAtMs: Date.now() + 86_400_000 },
          ],
        }),
      );
      expect(out.items[0].qaEvaluatedFields.assignmentId).to.equal('a-tomorrow');
    });
  });

  describe('case 4: drug schedule + verify phone → phone gate still suppresses profile slice', () => {
    it('drug_screen_schedule_required surfaces alongside the phone gate (job items NOT gated by Section 1)', () => {
      const out = buildWorkerDashboardActionItemsSnapshot(
        input({
          userDoc: {
            ...VALID_USER_BASE,
            phone: '5125551212',
            phoneVerified: false, // phone gate fires
            last4SSN: '',
            addressInfo: {},
          },
          compliance: { ...emptyCompliance(), drugScheduleRequired: true },
        }),
      );
      const list = ids(out.items);
      // Drug schedule (700) > verify_phone_number (640).
      expect(list[0]).to.equal('drug_screen_schedule_required');
      expect(list).to.include('verify_phone_number');
      expect(list).to.not.include('add_tax_identity_last4');
      expect(list).to.not.include('confirm_home_address');
    });

    it('reschedule trumps schedule (only the higher-severity card emits)', () => {
      const out = buildWorkerDashboardActionItemsSnapshot(
        input({
          compliance: {
            ...emptyCompliance(),
            drugScheduleRequired: true,
            drugRescheduleRequired: true,
          },
        }),
      );
      const list = ids(out.items);
      expect(list).to.include('drug_screen_reschedule_required');
      expect(list).to.not.include('drug_screen_schedule_required');
    });
  });

  describe('case 5: AI prescreen branches', () => {
    it('eligible_invite branch: emits worker_ai_prescreen_interview at score 550', () => {
      const interviewItem: WorkerDashboardActionItemV1 = {
        id: 'worker_ai_prescreen_interview',
        category: 'important',
        titleKey: 'dashboard.actionItems.aiPrescreenInterviewTitle',
        descriptionKey: 'dashboard.actionItems.aiPrescreenInterviewDescription',
        primaryLabelKey: 'dashboard.actionItems.aiPrescreenInterviewPrimary',
        primaryKind: 'navigate',
        href: '/c1/workers/prescreen?applicationId=app-1&entry=dashboard_cta',
        priorityScore:
          WORKER_DASHBOARD_ACTION_ITEM_PRIORITY_SCORES.worker_ai_prescreen_interview,
        sourceReason: 'ported',
        qaEvaluatedFields: { applicationId: 'app-1' },
      };
      const out = buildWorkerDashboardActionItemsSnapshot(
        input({ prescreen: { items: [interviewItem] } }),
      );
      const it = out.items.find((i) => i.id === 'worker_ai_prescreen_interview');
      expect(it).to.exist;
      expect(it!.priorityScore).to.equal(550);
      expect(it!.href).to.contain('applicationId=app-1');
    });

    it('ineligible_nudge branch: emits worker_ai_prescreen_complete_profile at score 545', () => {
      const profileItem: WorkerDashboardActionItemV1 = {
        id: 'worker_ai_prescreen_complete_profile',
        category: 'important',
        titleKey: 'dashboard.actionItems.aiPrescreenProfileTitle',
        descriptionKey: 'dashboard.actionItems.aiPrescreenProfileDescription',
        primaryLabelKey: 'dashboard.actionItems.aiPrescreenProfilePrimary',
        primaryKind: 'navigate',
        href: '/c1/workers/profile',
        priorityScore:
          WORKER_DASHBOARD_ACTION_ITEM_PRIORITY_SCORES.worker_ai_prescreen_complete_profile,
        sourceReason: 'ported',
        qaEvaluatedFields: { applicationId: 'app-2' },
      };
      const out = buildWorkerDashboardActionItemsSnapshot(
        input({ prescreen: { items: [profileItem] } }),
      );
      const it = out.items.find((i) => i.id === 'worker_ai_prescreen_complete_profile');
      expect(it).to.exist;
      expect(it!.priorityScore).to.equal(545);
      // Interview (550) outranks complete_profile (545) — make sure they
      // sort that way when both are present (one tenant could land on
      // the boundary mid-rollout).
      const interviewItem: WorkerDashboardActionItemV1 = {
        ...it!,
        id: 'worker_ai_prescreen_interview',
        priorityScore:
          WORKER_DASHBOARD_ACTION_ITEM_PRIORITY_SCORES.worker_ai_prescreen_interview,
      };
      const both = buildWorkerDashboardActionItemsSnapshot(
        input({ prescreen: { items: [profileItem, interviewItem] } }),
      );
      const order = ids(both.items).filter((i) => i.startsWith('worker_ai_prescreen_'));
      expect(order).to.deep.equal([
        'worker_ai_prescreen_interview',
        'worker_ai_prescreen_complete_profile',
      ]);
    });
  });

  describe('case 7: phone-gate suppression vs assignment (production-shape parity)', () => {
    /**
     * Pins the contract §1 rule:
     *   "Phone gate suppresses **profile** items only — never job items
     *    (e.g. assignment_confirmation_required)."
     *
     * Synthetic fixture matches the production sample
     * `57PR1pWmjIW5oG2tpYh9ShWMfUV2` we observed during the V2 backfill
     * smoke test (assignment + missing phoneVerified, profile otherwise
     * empty). If this rule ever silently widens to suppress *all* items,
     * recruiters lose the highest-priority card (920) — this test catches
     * the regression immediately.
     */
    function productionShapeInput(): WorkerDashboardActionItemsModelInput {
      return input({
        userDoc: {
          ...VALID_USER_BASE,
          phone: '5125551212',
          phoneVerified: false, // <-- phone gate fires
          last4SSN: '', // would otherwise emit add_tax_identity_last4
          addressInfo: {}, // would otherwise emit confirm_home_address
          emergencyContact: {}, // would otherwise emit add_emergency_contact
          workerProfile: {}, // would otherwise emit add_profile_photo
        },
        authAvatarUrl: null,
        pendingAssignments: [
          {
            assignmentId: 'TGCzno0yusWBObASQZkq__57PR1pWmjIW5oG2tpYh9ShWMfUV2',
            startAtMs: Date.UTC(2026, 4, 11),
          },
        ],
      });
    }

    it('emits exactly 2 items: assignment_confirmation_required (920) above verify_phone_number (640)', () => {
      const out = buildWorkerDashboardActionItemsSnapshot(productionShapeInput());
      expect(ids(out.items)).to.deep.equal([
        'assignment_confirmation_required',
        'verify_phone_number',
      ]);
      expect(out.items[0].priorityScore).to.equal(
        WORKER_DASHBOARD_ACTION_ITEM_PRIORITY_SCORES.assignment_confirmation_required,
      );
      expect(out.items[1].priorityScore).to.equal(
        WORKER_DASHBOARD_ACTION_ITEM_PRIORITY_SCORES.verify_phone_number,
      );
    });

    it('phone-gate item carries the contract sourceReason ("suppress other profile items only")', () => {
      const out = buildWorkerDashboardActionItemsSnapshot(productionShapeInput());
      const phone = out.items.find((i) => i.id === 'verify_phone_number');
      expect(phone, 'verify_phone_number must be present').to.exist;
      // Contract §1 rule 2 — phrasing is part of the diagnostic contract.
      expect(phone!.sourceReason).to.equal(
        'Rule 2 (Phone gate): suppress other profile items only',
      );
      expect(phone!.qaEvaluatedFields.gate).to.equal('phone');
    });

    it('does NOT leak any other profile items even though every profile field is missing', () => {
      const out = buildWorkerDashboardActionItemsSnapshot(productionShapeInput());
      const list = ids(out.items);
      // Profile slice (§1): suppressed except verify_phone_number.
      expect(list).to.not.include('add_tax_identity_last4');
      expect(list).to.not.include('confirm_home_address');
      expect(list).to.not.include('add_profile_photo');
      expect(list).to.not.include('add_emergency_contact');
      expect(list).to.not.include('sms_opt_in');
      expect(list).to.not.include('re_enable_sms_notifications');
      // Job slice: NOT gated by §1, must survive.
      expect(list).to.include('assignment_confirmation_required');
    });

    it('also emits a higher-priority compliance item alongside the phone gate (job slice not suppressed)', () => {
      // Same shape as above but swap the assignment for a BG-check error
      // (score 860). Same property: phone gate must not eat the job item.
      const out = buildWorkerDashboardActionItemsSnapshot(
        input({
          userDoc: {
            ...VALID_USER_BASE,
            phone: '5125551212',
            phoneVerified: false,
            last4SSN: '',
            addressInfo: {},
            emergencyContact: {},
            workerProfile: {},
          },
          authAvatarUrl: null,
          compliance: { ...emptyCompliance(), backgroundIssueAction: true },
        }),
      );
      const list = ids(out.items);
      expect(list[0]).to.equal('background_check_issue_requires_action');
      expect(list).to.include('verify_phone_number');
      expect(list).to.not.include('add_tax_identity_last4');
    });
  });

  describe('case 6: dismissed add_profile_photo is excluded', () => {
    it('honours `workerProfile.dashboard.dismissedActionItems.add_profile_photo === true`', () => {
      const out = buildWorkerDashboardActionItemsSnapshot(
        input({
          userDoc: {
            ...VALID_USER_BASE,
            workerProfile: {
              dashboard: { dismissedActionItems: { add_profile_photo: true } },
            },
          },
        }),
      );
      expect(ids(out.items)).to.not.include('add_profile_photo');
    });

    it('treats string "true" as dismissed (legacy data parity)', () => {
      const out = buildWorkerDashboardActionItemsSnapshot(
        input({
          userDoc: {
            ...VALID_USER_BASE,
            workerProfile: {
              dashboard: { dismissedActionItems: { add_emergency_contact: 'true' } },
            },
            emergencyContact: {},
          },
        }),
      );
      expect(ids(out.items)).to.not.include('add_emergency_contact');
    });
  });

  describe('SMS slot', () => {
    it('emits re_enable_sms_notifications when smsBlockedSystem === true', () => {
      const out = buildWorkerDashboardActionItemsSnapshot(
        input({
          userDoc: { ...VALID_USER_BASE, smsBlockedSystem: true },
        }),
      );
      expect(ids(out.items)).to.include('re_enable_sms_notifications');
    });

    it('emits sms_opt_in when smsOptIn !== true and not blocked', () => {
      const out = buildWorkerDashboardActionItemsSnapshot(
        input({
          userDoc: { ...VALID_USER_BASE, smsOptIn: false },
        }),
      );
      expect(ids(out.items)).to.include('sms_opt_in');
    });

    it('hides SMS card entirely when system is unavailable', () => {
      const out = buildWorkerDashboardActionItemsSnapshot(
        input({
          userDoc: { ...VALID_USER_BASE, smsOptIn: false, smsSystemUnavailable: true },
        }),
      );
      expect(ids(out.items)).to.not.include('sms_opt_in');
      expect(ids(out.items)).to.not.include('re_enable_sms_notifications');
    });
  });

  describe('TempWorks', () => {
    it('hides when recruiterVerified', () => {
      const out = buildWorkerDashboardActionItemsSnapshot(
        input({
          tempworks: {
            required: true,
            recruiterVerified: true,
            started: true,
            onboardingUrl: 'https://tempworks.example/x',
          },
        }),
      );
      expect(ids(out.items)).to.not.include('complete_tempworks_onboarding');
    });

    it('not started: emits start variant title', () => {
      const out = buildWorkerDashboardActionItemsSnapshot(
        input({
          tempworks: {
            required: true,
            recruiterVerified: false,
            started: false,
            onboardingUrl: 'https://tempworks.example/x',
          },
        }),
      );
      const tw = out.items.find((i) => i.id === 'complete_tempworks_onboarding');
      expect(tw).to.exist;
      expect(tw!.titleKey).to.equal('dashboard.actionItems.tempworksStartTitle');
      expect(tw!.qaEvaluatedFields.submitted).to.equal(false);
      expect(tw!.qaEvaluatedFields.hasUrl).to.equal(true);
    });

    it('submitted: emits the submitted variant title', () => {
      const out = buildWorkerDashboardActionItemsSnapshot(
        input({
          tempworks: {
            required: true,
            recruiterVerified: false,
            started: true,
            onboardingUrl: '',
          },
        }),
      );
      const tw = out.items.find((i) => i.id === 'complete_tempworks_onboarding');
      expect(tw!.titleKey).to.equal('dashboard.actionItems.tempworksSubmittedTitle');
      expect(tw!.href).to.equal(undefined);
      expect(tw!.qaEvaluatedFields.hasUrl).to.equal(false);
    });
  });

  describe('compliance branches', () => {
    it('background_check_issue beats background_check_action when both signal', () => {
      const out = buildWorkerDashboardActionItemsSnapshot(
        input({
          compliance: {
            ...emptyCompliance(),
            backgroundIssueAction: true,
            backgroundApplicantAction: true,
          },
        }),
      );
      const list = ids(out.items);
      expect(list).to.include('background_check_issue_requires_action');
      expect(list).to.not.include('background_check_action_required');
    });
  });
});
