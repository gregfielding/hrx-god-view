/**
 * QA coverage: six scenarios + edge cases from docs/WORKFORCE_SYSTEM_POLISH_QA.md.
 * Validates readiness logic for Admin and Worker UI expectations.
 */
import { getWorkerReadiness, getReadinessStatusLabel, type WorkerReadinessResult } from '../workerReadiness';

describe('workerReadiness', () => {
  describe('getReadinessStatusLabel', () => {
    it('returns standard UI labels (no raw enums)', () => {
      expect(getReadinessStatusLabel('ready')).toBe('Ready');
      expect(getReadinessStatusLabel('onboarding')).toBe('Onboarding');
      expect(getReadinessStatusLabel('not_ready')).toBe('Not ready');
      expect(getReadinessStatusLabel('at_risk')).toBe('At risk');
      expect(getReadinessStatusLabel('blocked')).toBe('Blocked');
    });
  });

  describe('Scenario 1: Fully complete worker → Ready', () => {
    it('returns ready when active employment, all required compliance complete, payroll complete', () => {
      const result = getWorkerReadiness({
        employments: [{ id: 'e1', status: 'active', entityKey: 'workforce', onboardingPipelineId: 'p1' }],
        complianceItems: [
          { tenantId: 't1', userId: 'u1', category: 'eligibility', type: 'i9', required: true, status: 'complete' } as any,
        ],
        payrollByKey: { u1__workforce: { payrollStatus: 'complete', payrollProvider: 'tempworks' } },
        pipelineStepCounts: { p1: { complete: 5, total: 5 } },
      });
      expect(result.status).toBe('ready');
      expect(result.reasons).toHaveLength(0);
    });

    it('returns ready when no required compliance items and no payroll', () => {
      const result = getWorkerReadiness({
        employments: [{ id: 'e1', status: 'active', entityKey: 'workforce' }],
        complianceItems: [],
        payrollByKey: {},
      });
      expect(result.status).toBe('ready');
      expect(result.reasons).toHaveLength(0);
    });
  });

  describe('Scenario 2: Onboarding incomplete → Onboarding', () => {
    it('returns onboarding when employment status is onboarding and steps not all complete', () => {
      const result = getWorkerReadiness({
        employments: [{ id: 'e1', status: 'onboarding', entityKey: 'workforce', onboardingPipelineId: 'p1' }],
        complianceItems: [],
        payrollByKey: {},
        pipelineStepCounts: { p1: { complete: 2, total: 5 } },
      });
      expect(result.status).toBe('onboarding');
      expect(result.reasons).toContain('Complete onboarding to start working');
    });
  });

  describe('Scenario 3: Payroll incomplete → Not ready', () => {
    it('returns not_ready with Payroll setup incomplete when payroll in progress', () => {
      const result = getWorkerReadiness({
        employments: [{ id: 'e1', status: 'active', entityKey: 'workforce' }],
        complianceItems: [],
        payrollByKey: { u1__workforce: { payrollStatus: 'invite_sent', payrollProvider: 'tempworks' } },
      });
      expect(result.status).toBe('not_ready');
      expect(result.reasons).toContain('Payroll setup incomplete');
    });

    it('returns not_ready for not_started payroll when provider is tempworks', () => {
      const result = getWorkerReadiness({
        employments: [{ id: 'e1', status: 'active', entityKey: 'workforce' }],
        complianceItems: [],
        payrollByKey: { u1__workforce: { payrollStatus: 'not_started', payrollProvider: 'tempworks' } },
      });
      expect(result.status).toBe('not_ready');
      expect(result.reasons).toContain('Payroll setup incomplete');
    });
  });

  describe('Scenario 4: Expired required compliance item → Blocked', () => {
    it('returns blocked with reason when required item (with expiration) is expired', () => {
      const past = new Date();
      past.setDate(past.getDate() - 1);
      const result = getWorkerReadiness({
        employments: [{ id: 'e1', status: 'active', entityKey: 'workforce' }],
        complianceItems: [
          {
            tenantId: 't1',
            userId: 'u1',
            category: 'credential',
            type: 'work_permit',
            required: true,
            status: 'expired',
            expiresAt: past.toISOString(),
          } as any,
        ],
        payrollByKey: {},
      });
      expect(result.status).toBe('blocked');
      expect(result.reasons.some((r) => r.includes('expired'))).toBe(true);
    });
  });

  describe('Scenario 5: Expiring-soon required item → At risk', () => {
    it('returns at_risk with expires soon reason when required item expires within 30 days', () => {
      const inTenDays = new Date();
      inTenDays.setDate(inTenDays.getDate() + 10);
      const result = getWorkerReadiness({
        employments: [{ id: 'e1', status: 'active', entityKey: 'workforce' }],
        complianceItems: [
          {
            tenantId: 't1',
            userId: 'u1',
            category: 'credential',
            type: 'drivers_license',
            required: true,
            status: 'complete',
            expiresAt: inTenDays.toISOString(),
          } as any,
        ],
        payrollByKey: {},
      });
      expect(result.status).toBe('at_risk');
      expect(result.reasons.some((r) => r.includes('expires soon'))).toBe(true);
    });
  });

  describe('Scenario 6: No active/onboarding employment → Not ready', () => {
    it('returns not_ready with No employment record when no employments', () => {
      const result = getWorkerReadiness({
        employments: [],
        complianceItems: [],
        payrollByKey: {},
      });
      expect(result.status).toBe('not_ready');
      expect(result.reasons).toContain('No employment record');
    });

    it('returns not_ready with No active or onboarding employment when all inactive/terminated', () => {
      const result = getWorkerReadiness({
        employments: [
          { id: 'e1', status: 'terminated', entityKey: 'workforce' },
          { id: 'e2', status: 'inactive', entityKey: 'select' },
        ],
        complianceItems: [],
        payrollByKey: {},
      });
      expect(result.status).toBe('not_ready');
      expect(result.reasons).toContain('No active or onboarding employment');
    });
  });

  describe('Edge cases', () => {
    it('Payroll blocked → Blocked', () => {
      const result = getWorkerReadiness({
        employments: [{ id: 'e1', status: 'active', entityKey: 'workforce' }],
        complianceItems: [],
        payrollByKey: { u1__workforce: { payrollStatus: 'blocked', payrollProvider: 'tempworks' } },
      });
      expect(result.status).toBe('blocked');
      expect(result.reasons).toContain('Payroll setup blocked');
    });

    it('Multiple reasons: expired compliance wins (blocked), reasons list expired item', () => {
      const past = new Date();
      past.setDate(past.getDate() - 1);
      const result = getWorkerReadiness({
        employments: [{ id: 'e1', status: 'active', entityKey: 'workforce' }],
        complianceItems: [
          {
            tenantId: 't1',
            userId: 'u1',
            category: 'credential',
            type: 'work_permit',
            required: true,
            status: 'expired',
            expiresAt: past.toISOString(),
          } as any,
        ],
        payrollByKey: { u1__workforce: { payrollStatus: 'not_started', payrollProvider: 'tempworks' } },
      });
      expect(result.status).toBe('blocked');
      expect(result.reasons.some((r) => r.includes('expired'))).toBe(true);
    });

    it('Required compliance incomplete → not_ready', () => {
      const result = getWorkerReadiness({
        employments: [{ id: 'e1', status: 'active', entityKey: 'workforce' }],
        complianceItems: [
          { tenantId: 't1', userId: 'u1', category: 'screening', type: 'background_check', required: true, status: 'pending' } as any,
        ],
        payrollByKey: {},
      });
      expect(result.status).toBe('not_ready');
      expect(result.reasons.some((r) => r.includes('incomplete'))).toBe(true);
    });

    it('Manual payroll provider does not force not_ready for incomplete', () => {
      const result = getWorkerReadiness({
        employments: [{ id: 'e1', status: 'active', entityKey: 'workforce' }],
        complianceItems: [],
        payrollByKey: { u1__workforce: { payrollStatus: 'not_started', payrollProvider: 'manual' } },
      });
      expect(result.status).toBe('ready');
    });
  });
});
