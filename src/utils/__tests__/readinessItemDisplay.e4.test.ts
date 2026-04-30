/**
 * E.4 — `getReadinessItemDisplay` coverage.
 *
 * Pins the canonical (requirementType × status) → display mapping for
 * every chip surface that adopts the helper. The matrix is intentionally
 * exhaustive on the seven Everee-mirror-owned types (E.3) plus
 * `tin_verification` (E.4-new) plus `i9_section_2` (HRX-owned, E.3
 * addendum). Other canonical types get a smaller smoke-test pass — they
 * aren't Everee-sourced and their display tightens later as those
 * surfaces adopt the helper.
 *
 * Three orthogonal axes drive the size of this file:
 *   1. requirementType  (15 canonical + 2 spec-alias examples)
 *   2. status           (9 canonical incl. legacy `complete`)
 *   3. context          (chip / list / matrix / tooltip)
 *
 * Plus separate suites for:
 *   - tooltip composition (label / body / sync footer)
 *   - severity-rank ordering (hard-block sorts above blocked sorts above
 *     complete_fail … etc.)
 *   - feature-flag rollback path (USE_E4_DISPLAY_MAPPING=false)
 *   - relative-time formatting (just-now, minute, hour, day, month, year
 *     boundaries)
 */

import {
  aliasRequirementType,
  formatRelativeTime,
  getReadinessItemDisplay,
  getRequirementTypeBaseLabel,
  isE4DisplayMappingEnabled,
  shouldRenderReadinessItem,
} from '../readinessItemDisplay';

describe('readinessItemDisplay — E.4 canonical chip mapping', () => {
  // ── Feature-flag isolation ─────────────────────────────────────────────
  // Snapshot the env var so a test that intentionally toggles it doesn't
  // poison the whole suite. Mirrors the pattern in
  // workAuthCollectionFlag.test.ts.
  const ORIGINAL_ENV = process.env.REACT_APP_USE_E4_DISPLAY_MAPPING;
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.REACT_APP_USE_E4_DISPLAY_MAPPING;
    } else {
      process.env.REACT_APP_USE_E4_DISPLAY_MAPPING = ORIGINAL_ENV;
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // 1. Type-alias normalization (spec-descriptive → canonical)
  // ─────────────────────────────────────────────────────────────────────
  describe('aliasRequirementType — spec descriptive names → canonical', () => {
    it('maps i9_worker_portion → i9_section_1', () => {
      expect(aliasRequirementType('i9_worker_portion')).toBe('i9_section_1');
    });
    it('maps i9_employer_portion → i9_section_2', () => {
      expect(aliasRequirementType('i9_employer_portion')).toBe('i9_section_2');
    });
    it('maps w4 → tax_w4', () => {
      expect(aliasRequirementType('w4')).toBe('tax_w4');
    });
    it('maps w9 → tax_w9', () => {
      expect(aliasRequirementType('w9')).toBe('tax_w9');
    });
    it('maps handbook → handbook_acknowledgement', () => {
      expect(aliasRequirementType('handbook')).toBe('handbook_acknowledgement');
    });
    it('maps policies → policy_acknowledgement', () => {
      expect(aliasRequirementType('policies')).toBe('policy_acknowledgement');
    });
    it('maps tin → tin_verification', () => {
      expect(aliasRequirementType('tin')).toBe('tin_verification');
    });
    it('passes canonical names through unchanged', () => {
      expect(aliasRequirementType('i9_section_1')).toBe('i9_section_1');
      expect(aliasRequirementType('tin_verification')).toBe('tin_verification');
      expect(aliasRequirementType('direct_deposit')).toBe('direct_deposit');
    });
    it('passes unknown names through unchanged (forward-compat)', () => {
      expect(aliasRequirementType('some_future_type')).toBe('some_future_type');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 2. Base labels per type
  // ─────────────────────────────────────────────────────────────────────
  describe('getRequirementTypeBaseLabel — Everee-owned + HRX-owned items', () => {
    const cases: Array<[string, string]> = [
      ['direct_deposit', 'Direct deposit'],
      ['i9_section_1', 'I-9 (worker)'],
      ['i9_section_2', 'I-9 (employer)'],
      ['tax_w4', 'W-4'],
      ['tax_w9', 'W-9'],
      ['handbook_acknowledgement', 'Handbook'],
      ['policy_acknowledgement', 'Policies'],
      ['tin_verification', 'SSN'],
      ['e_verify', 'E-Verify'],
      ['background_check', 'Background check'],
      ['drug_screen', 'Drug screen'],
      ['ic_agreement', 'IC agreement'],
    ];
    it.each(cases)('%s → "%s"', (type, expected) => {
      expect(getRequirementTypeBaseLabel(type)).toBe(expected);
    });

    it('descriptive aliases produce the same canonical base label', () => {
      expect(getRequirementTypeBaseLabel('w4')).toBe('W-4');
      expect(getRequirementTypeBaseLabel('handbook')).toBe('Handbook');
      expect(getRequirementTypeBaseLabel('i9_worker_portion')).toBe('I-9 (worker)');
    });

    it('unknown type falls back to humanized form', () => {
      expect(getRequirementTypeBaseLabel('some_new_thing')).toBe('Some New Thing');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 3. Per-type × per-status canonical display matrix (the spec table)
  // ─────────────────────────────────────────────────────────────────────
  describe('canonical (type × status) → label + color matrix', () => {
    describe('direct_deposit', () => {
      it('complete_pass → "Direct deposit: Set up" / success', () => {
        const d = getReadinessItemDisplay({
          requirementType: 'direct_deposit',
          status: 'complete_pass',
        });
        expect(d.label).toBe('Direct deposit: Set up');
        expect(d.color).toBe('success');
        expect(d.hidden).toBe(false);
      });
      it('incomplete → "Direct deposit: Not started" / default (NOT warning)', () => {
        // Per spec: direct_deposit missing is informational, not a hard
        // block. I-9 / W-4 / W-9 missing are warning. This test pins
        // that distinction.
        const d = getReadinessItemDisplay({
          requirementType: 'direct_deposit',
          status: 'incomplete',
        });
        expect(d.label).toBe('Direct deposit: Not started');
        expect(d.color).toBe('default');
      });
    });

    describe('i9_section_1 (worker portion)', () => {
      it('complete_pass → "I-9 (worker): Signed" / success', () => {
        const d = getReadinessItemDisplay({
          requirementType: 'i9_section_1',
          status: 'complete_pass',
        });
        expect(d.label).toBe('I-9 (worker): Signed');
        expect(d.color).toBe('success');
      });
      it('incomplete → "I-9 (worker): Not started" / WARNING (missing is blocking-tier)', () => {
        const d = getReadinessItemDisplay({
          requirementType: 'i9_section_1',
          status: 'incomplete',
        });
        expect(d.label).toBe('I-9 (worker): Not started');
        expect(d.color).toBe('warning');
      });
      it('not_applicable → hidden in chip context (1099 worker)', () => {
        const d = getReadinessItemDisplay({
          requirementType: 'i9_section_1',
          status: 'not_applicable',
        });
        expect(d.hidden).toBe(true);
      });
    });

    describe('i9_section_2 (employer portion, HRX-owned)', () => {
      it('complete_pass → "I-9 (employer): Signed" / success', () => {
        const d = getReadinessItemDisplay({
          requirementType: 'i9_section_2',
          status: 'complete_pass',
        });
        expect(d.label).toBe('I-9 (employer): Signed');
        expect(d.color).toBe('success');
      });
      it('incomplete → "I-9 (employer): Not started" / warning', () => {
        const d = getReadinessItemDisplay({
          requirementType: 'i9_section_2',
          status: 'incomplete',
        });
        expect(d.label).toBe('I-9 (employer): Not started');
        expect(d.color).toBe('warning');
      });
    });

    describe('tax_w4', () => {
      it('complete_pass → "W-4: Filed" / success', () => {
        const d = getReadinessItemDisplay({
          requirementType: 'tax_w4',
          status: 'complete_pass',
        });
        expect(d.label).toBe('W-4: Filed');
        expect(d.color).toBe('success');
      });
      it('incomplete → "W-4: Not started" / warning', () => {
        const d = getReadinessItemDisplay({
          requirementType: 'tax_w4',
          status: 'incomplete',
        });
        expect(d.label).toBe('W-4: Not started');
        expect(d.color).toBe('warning');
      });
      it('not_applicable hides for chip (1099 worker skips W-4)', () => {
        expect(
          getReadinessItemDisplay({ requirementType: 'tax_w4', status: 'not_applicable' }).hidden,
        ).toBe(true);
      });
    });

    describe('tax_w9', () => {
      it('complete_pass → "W-9: Signed" / success', () => {
        const d = getReadinessItemDisplay({
          requirementType: 'tax_w9',
          status: 'complete_pass',
        });
        expect(d.label).toBe('W-9: Signed');
        expect(d.color).toBe('success');
      });
      it('incomplete → "W-9: Not started" / warning', () => {
        const d = getReadinessItemDisplay({
          requirementType: 'tax_w9',
          status: 'incomplete',
        });
        expect(d.color).toBe('warning');
      });
      it('not_applicable hides for chip (W-2 worker skips W-9)', () => {
        expect(
          getReadinessItemDisplay({ requirementType: 'tax_w9', status: 'not_applicable' }).hidden,
        ).toBe(true);
      });
    });

    describe('handbook_acknowledgement', () => {
      it('complete_pass → "Handbook: Signed" / success', () => {
        const d = getReadinessItemDisplay({
          requirementType: 'handbook_acknowledgement',
          status: 'complete_pass',
        });
        expect(d.label).toBe('Handbook: Signed');
        expect(d.color).toBe('success');
      });
      it('incomplete → "Handbook: Not started" / default (NOT warning)', () => {
        const d = getReadinessItemDisplay({
          requirementType: 'handbook_acknowledgement',
          status: 'incomplete',
        });
        expect(d.color).toBe('default');
      });
    });

    describe('policy_acknowledgement', () => {
      it('complete_pass → "Policies: Signed" / success', () => {
        const d = getReadinessItemDisplay({
          requirementType: 'policy_acknowledgement',
          status: 'complete_pass',
        });
        expect(d.label).toBe('Policies: Signed');
        expect(d.color).toBe('success');
      });
      it('incomplete → "Policies: Not started" / default', () => {
        const d = getReadinessItemDisplay({
          requirementType: 'policy_acknowledgement',
          status: 'incomplete',
        });
        expect(d.color).toBe('default');
      });
    });

    describe('tin_verification — 4-state Everee-driven', () => {
      it('complete_pass (Everee VERIFIED) → "SSN: IRS verified" / success', () => {
        const d = getReadinessItemDisplay({
          requirementType: 'tin_verification',
          status: 'complete_pass',
        });
        expect(d.label).toBe('SSN: IRS verified');
        expect(d.color).toBe('success');
      });

      it('in_progress (Everee SENT_FOR_VERIFICATION) → "SSN: Submitted to IRS" / info', () => {
        const d = getReadinessItemDisplay({
          requirementType: 'tin_verification',
          status: 'in_progress',
        });
        expect(d.label).toBe('SSN: Submitted to IRS');
        expect(d.color).toBe('info');
      });

      it('incomplete (Everee NEEDS_VERIFICATION) → "SSN: Not submitted" / default', () => {
        const d = getReadinessItemDisplay({
          requirementType: 'tin_verification',
          status: 'incomplete',
        });
        expect(d.label).toBe('SSN: Not submitted');
        expect(d.color).toBe('default');
      });

      it('blocked (Everee MISMATCH) → "SSN: IRS rejected — needs correction" / error', () => {
        const d = getReadinessItemDisplay({
          requirementType: 'tin_verification',
          status: 'blocked',
        });
        expect(d.label).toBe('SSN: IRS rejected — needs correction');
        expect(d.color).toBe('error');
      });

      it('legacy `complete` value still maps to "SSN: IRS verified" / success', () => {
        // Pre-§6e items might still carry the deprecated `complete` value.
        // Treat it as `complete_pass` for backwards compat.
        const d = getReadinessItemDisplay({
          requirementType: 'tin_verification',
          status: 'complete',
        });
        expect(d.label).toBe('SSN: IRS verified');
        expect(d.color).toBe('success');
      });
    });

    describe('e_verify (HRX-owned, vendor adjudicated)', () => {
      it('complete_pass → "E-Verify: Authorized" / success', () => {
        const d = getReadinessItemDisplay({
          requirementType: 'e_verify',
          status: 'complete_pass',
        });
        expect(d.label).toBe('E-Verify: Authorized');
        expect(d.color).toBe('success');
      });
      it('needs_review → "E-Verify: Needs review" / warning', () => {
        const d = getReadinessItemDisplay({
          requirementType: 'e_verify',
          status: 'needs_review',
        });
        expect(d.label).toBe('E-Verify: Needs review');
        expect(d.color).toBe('warning');
      });
    });

    describe('blocked items get error chip color across types', () => {
      it.each(['direct_deposit', 'i9_section_1', 'tax_w4', 'background_check'] as const)(
        '%s blocked → error',
        (type) => {
          const d = getReadinessItemDisplay({ requirementType: type, status: 'blocked' });
          expect(d.color).toBe('error');
        },
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 4. Per-context N/A handling
  // ─────────────────────────────────────────────────────────────────────
  describe('not_applicable handling per render context', () => {
    const naInput = {
      requirementType: 'tax_w9' as const,
      status: 'not_applicable' as const,
    };

    it('chip context → hidden: true (default behavior)', () => {
      expect(getReadinessItemDisplay(naInput).hidden).toBe(true);
      expect(getReadinessItemDisplay(naInput, { context: 'chip' }).hidden).toBe(true);
    });

    it('list context → hidden: true (chip-strip lists prune N/A too)', () => {
      expect(getReadinessItemDisplay(naInput, { context: 'list' }).hidden).toBe(true);
    });

    it('matrix context → hidden: false, label "—", icon: null, color: default', () => {
      // Matrix needs a placeholder so the column stays consistent across
      // worker rows. Spec calls this "muted —".
      const d = getReadinessItemDisplay(naInput, { context: 'matrix' });
      expect(d.hidden).toBe(false);
      expect(d.label).toBe('—');
      expect(d.icon).toBeNull();
      expect(d.color).toBe('default');
    });

    it('tooltip context → hidden: false, includes "Not applicable for this worker type."', () => {
      const d = getReadinessItemDisplay(naInput, { context: 'tooltip' });
      expect(d.hidden).toBe(false);
      expect(d.tooltip).toContain('Not applicable for this worker type');
    });

    it('shouldRenderReadinessItem mirrors hidden semantics', () => {
      expect(shouldRenderReadinessItem(naInput)).toBe(false);
      expect(shouldRenderReadinessItem(naInput, { context: 'matrix' })).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 5. Tooltip composition — title + optional body + optional sync footer
  // ─────────────────────────────────────────────────────────────────────
  describe('tooltip composition', () => {
    it('always starts with the full label as the first line', () => {
      const d = getReadinessItemDisplay({
        requirementType: 'tin_verification',
        status: 'complete_pass',
      });
      const lines = d.tooltip.split('\n');
      expect(lines[0]).toBe('SSN: IRS verified');
    });

    it('blocked TIN MISMATCH includes actionable next-step copy', () => {
      // Spec example tooltip — pin the intent. Exact wording can drift
      // (one substring assertion per concept) but the recruiter MUST see
      // (a) what's wrong and (b) what to do next.
      const d = getReadinessItemDisplay({
        requirementType: 'tin_verification',
        status: 'blocked',
      });
      expect(d.tooltip).toContain('SSN: IRS rejected — needs correction');
      expect(d.tooltip).toMatch(/IRS could not verify/i);
      expect(d.tooltip).toMatch(/Everee onboarding portal/i);
    });

    it('blocked items without bespoke body get the generic "Action needed" line', () => {
      const d = getReadinessItemDisplay({
        requirementType: 'direct_deposit',
        status: 'blocked',
      });
      expect(d.tooltip).toContain('Action needed');
    });

    it('needs_review on background_check explains CSA adjudication', () => {
      const d = getReadinessItemDisplay({
        requirementType: 'background_check',
        status: 'needs_review',
      });
      expect(d.tooltip).toMatch(/CSA review/i);
    });

    it('Everee-sourced item with sync timestamp adds "Synced from Everee {timeAgo}." footer', () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const d = getReadinessItemDisplay({
        requirementType: 'tin_verification',
        status: 'complete_pass',
        evereeSourced: true,
        lastEvereeSyncAt: fiveMinutesAgo,
      });
      const lines = d.tooltip.split('\n');
      // Footer is the last line; allow some flex on rounding (4-6 minutes
      // depending on test execution time).
      expect(lines[lines.length - 1]).toMatch(/^Synced from Everee \d+ minutes? ago\.$/);
    });

    it('non-Everee-sourced item with sync timestamp uses generic "Last updated" footer', () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const d = getReadinessItemDisplay({
        requirementType: 'i9_section_2',
        status: 'complete_pass',
        evereeSourced: false,
        lastEvereeSyncAt: oneHourAgo,
      });
      expect(d.tooltip).toMatch(/Last updated /);
      expect(d.tooltip).not.toMatch(/Synced from Everee/);
    });

    it('omits the sync footer when no timestamp is provided', () => {
      const d = getReadinessItemDisplay({
        requirementType: 'tin_verification',
        status: 'complete_pass',
      });
      expect(d.tooltip).not.toMatch(/Synced from Everee/);
      expect(d.tooltip).not.toMatch(/Last updated/);
    });

    it('accepts ISO string for lastEvereeSyncAt', () => {
      const d = getReadinessItemDisplay({
        requirementType: 'tin_verification',
        status: 'complete_pass',
        evereeSourced: true,
        lastEvereeSyncAt: new Date(Date.now() - 60 * 1000).toISOString(),
      });
      expect(d.tooltip).toMatch(/Synced from Everee/);
    });

    it('accepts millis number for lastEvereeSyncAt', () => {
      const d = getReadinessItemDisplay({
        requirementType: 'tin_verification',
        status: 'complete_pass',
        evereeSourced: true,
        lastEvereeSyncAt: Date.now() - 60 * 1000,
      });
      expect(d.tooltip).toMatch(/Synced from Everee/);
    });

    it('accepts Firestore-Timestamp-shaped object (toMillis()) for lastEvereeSyncAt', () => {
      const fakeTimestamp = { toMillis: () => Date.now() - 30 * 1000 };
      const d = getReadinessItemDisplay({
        requirementType: 'tin_verification',
        status: 'complete_pass',
        evereeSourced: true,
        lastEvereeSyncAt: fakeTimestamp,
      });
      expect(d.tooltip).toMatch(/Synced from Everee/);
    });

    it('ignores invalid lastEvereeSyncAt values (NaN date, bad string)', () => {
      const d = getReadinessItemDisplay({
        requirementType: 'tin_verification',
        status: 'complete_pass',
        evereeSourced: true,
        lastEvereeSyncAt: 'not a date',
      });
      // No crash; no footer.
      expect(d.tooltip).not.toMatch(/Synced from Everee/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 6. Hard-block + severity rank
  // ─────────────────────────────────────────────────────────────────────
  describe('hardBlock + severityRank — surfaces sort blocked items to top', () => {
    it('blocked + blocking=true → hardBlock=true, rank=100', () => {
      const d = getReadinessItemDisplay({
        requirementType: 'tin_verification',
        status: 'blocked',
        blocking: true,
      });
      expect(d.hardBlock).toBe(true);
      expect(d.severityRank).toBe(100);
    });

    it('blocked + blocking=false (or undefined) → hardBlock=false, rank=80', () => {
      const d = getReadinessItemDisplay({
        requirementType: 'tin_verification',
        status: 'blocked',
        blocking: false,
      });
      expect(d.hardBlock).toBe(false);
      expect(d.severityRank).toBe(80);
    });

    it('severity ordering across statuses is monotonic in the documented direction', () => {
      const r = (status: string) =>
        getReadinessItemDisplay({ requirementType: 'tin_verification', status }).severityRank;
      // hard-block > blocked > complete_fail > needs_review > expired >
      // incomplete > in_progress > complete_pass > not_applicable
      expect(
        getReadinessItemDisplay({
          requirementType: 'tin_verification',
          status: 'blocked',
          blocking: true,
        }).severityRank,
      ).toBeGreaterThan(r('blocked'));
      expect(r('blocked')).toBeGreaterThan(r('complete_fail'));
      expect(r('complete_fail')).toBeGreaterThan(r('needs_review'));
      expect(r('needs_review')).toBeGreaterThan(r('expired'));
      expect(r('expired')).toBeGreaterThan(r('incomplete'));
      expect(r('incomplete')).toBeGreaterThan(r('in_progress'));
      expect(r('in_progress')).toBeGreaterThan(r('complete_pass'));
      expect(r('complete_pass')).toBeGreaterThan(r('not_applicable'));
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 7. requirementLabel override (custom items + tenant overrides)
  // ─────────────────────────────────────────────────────────────────────
  describe('requirementLabel override', () => {
    it('non-empty requirementLabel replaces the base label entirely', () => {
      const d = getReadinessItemDisplay({
        requirementType: 'custom',
        status: 'complete_pass',
        requirementLabel: 'Forklift cert (CA-3 ed.)',
      });
      expect(d.label).toBe('Forklift cert (CA-3 ed.): Complete');
    });

    it('empty / whitespace requirementLabel falls through to base label', () => {
      const d = getReadinessItemDisplay({
        requirementType: 'custom',
        status: 'complete_pass',
        requirementLabel: '   ',
      });
      expect(d.label).toBe('Other: Complete');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 8. Feature-flag rollback path
  // ─────────────────────────────────────────────────────────────────────
  describe('USE_E4_DISPLAY_MAPPING — feature-flag rollback', () => {
    it('defaults to enabled when env unset', () => {
      delete process.env.REACT_APP_USE_E4_DISPLAY_MAPPING;
      expect(isE4DisplayMappingEnabled()).toBe(true);
    });

    it('respects explicit "true" env override', () => {
      process.env.REACT_APP_USE_E4_DISPLAY_MAPPING = 'true';
      expect(isE4DisplayMappingEnabled()).toBe(true);
    });

    it('respects explicit "false" env override (rollback)', () => {
      process.env.REACT_APP_USE_E4_DISPLAY_MAPPING = 'false';
      expect(isE4DisplayMappingEnabled()).toBe(false);
    });

    it('falls through to default for unrecognized env values', () => {
      process.env.REACT_APP_USE_E4_DISPLAY_MAPPING = '1';
      expect(isE4DisplayMappingEnabled()).toBe(true);
    });

    it('legacy path renders humanized label + basic color (no spec copy)', () => {
      process.env.REACT_APP_USE_E4_DISPLAY_MAPPING = 'false';
      const d = getReadinessItemDisplay({
        requirementType: 'tin_verification',
        status: 'complete_pass',
      });
      // Legacy: just `humanizeRequirementType` style — "Tin Verification".
      // Critically NOT "SSN: IRS verified".
      expect(d.label).toBe('Tin Verification');
      expect(d.color).toBe('success');
    });

    it('legacy path still hides not_applicable in chip context', () => {
      process.env.REACT_APP_USE_E4_DISPLAY_MAPPING = 'false';
      const d = getReadinessItemDisplay({
        requirementType: 'tax_w9',
        status: 'not_applicable',
      });
      expect(d.hidden).toBe(true);
    });

    it('legacy path keeps hardBlock + severityRank semantics (sort still works)', () => {
      process.env.REACT_APP_USE_E4_DISPLAY_MAPPING = 'false';
      const d = getReadinessItemDisplay({
        requirementType: 'tin_verification',
        status: 'blocked',
        blocking: true,
      });
      expect(d.hardBlock).toBe(true);
      expect(d.severityRank).toBe(100);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 9. formatRelativeTime — tooltip footer helper
  // ─────────────────────────────────────────────────────────────────────
  describe('formatRelativeTime — relative time strings for tooltip footer', () => {
    const NOW = new Date('2026-04-30T10:00:00Z');

    const ago = (ms: number) => new Date(NOW.getTime() - ms);

    it('< 30s → "just now"', () => {
      expect(formatRelativeTime(ago(10 * 1000), NOW)).toBe('just now');
    });

    it('45s → "45 seconds ago"', () => {
      expect(formatRelativeTime(ago(45 * 1000), NOW)).toBe('45 seconds ago');
    });

    it('60s → "1 minute ago"', () => {
      expect(formatRelativeTime(ago(60 * 1000), NOW)).toBe('1 minute ago');
    });

    it('5 minutes → "5 minutes ago"', () => {
      expect(formatRelativeTime(ago(5 * 60 * 1000), NOW)).toBe('5 minutes ago');
    });

    it('1 hour → "1 hour ago"', () => {
      expect(formatRelativeTime(ago(60 * 60 * 1000), NOW)).toBe('1 hour ago');
    });

    it('3 hours → "3 hours ago"', () => {
      expect(formatRelativeTime(ago(3 * 60 * 60 * 1000), NOW)).toBe('3 hours ago');
    });

    it('1 day → "1 day ago"', () => {
      expect(formatRelativeTime(ago(24 * 60 * 60 * 1000), NOW)).toBe('1 day ago');
    });

    it('5 days → "5 days ago"', () => {
      expect(formatRelativeTime(ago(5 * 24 * 60 * 60 * 1000), NOW)).toBe('5 days ago');
    });

    it('60 days → "2 months ago"', () => {
      expect(formatRelativeTime(ago(60 * 24 * 60 * 60 * 1000), NOW)).toBe('2 months ago');
    });

    it('400 days → "1 year ago"', () => {
      expect(formatRelativeTime(ago(400 * 24 * 60 * 60 * 1000), NOW)).toBe('1 year ago');
    });

    it('future date (negative ms) clamps to "just now"', () => {
      const future = new Date(NOW.getTime() + 60 * 1000);
      expect(formatRelativeTime(future, NOW)).toBe('just now');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 10. shortLabel
  // ─────────────────────────────────────────────────────────────────────
  describe('shortLabel — compact form for dense surfaces', () => {
    it('complete_pass → just the base label (color carries the "done" signal)', () => {
      const d = getReadinessItemDisplay({
        requirementType: 'tin_verification',
        status: 'complete_pass',
      });
      expect(d.shortLabel).toBe('SSN');
    });

    it('non-complete uses base · suffix form', () => {
      const d = getReadinessItemDisplay({
        requirementType: 'tin_verification',
        status: 'blocked',
      });
      expect(d.shortLabel).toBe('SSN · IRS rejected — needs correction');
    });

    it('not_applicable uses just the base (matrix-friendly)', () => {
      const d = getReadinessItemDisplay({
        requirementType: 'tax_w9',
        status: 'not_applicable',
      });
      expect(d.shortLabel).toBe('W-9');
    });
  });
});
