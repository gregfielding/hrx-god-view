import { buildTaxPayrollQueueRows } from '../onboardingQueueBuilders';
import type { WorkerPayrollAccount } from '../../types/payroll';
import { workerPayrollAccountId } from '../../types/payroll';

describe('buildTaxPayrollQueueRows', () => {
  const uid = 'user1';
  const pipelineId = `${uid}__select`;
  const entityKey = 'select';
  const payrollDocId = workerPayrollAccountId(uid, entityKey);

  const baseAccount: WorkerPayrollAccount = {
    tenantId: 't1',
    userId: uid,
    entityId: 'ent1',
    entityKey,
    workerType: 'w2',
    payrollProvider: 'tempworks',
    payrollMode: 'integrated',
    payrollStatus: 'complete',
  };

  const baseEmployment = {
    [pipelineId]: {
      workerType: 'w2',
      employmentEntryMode: 'on_call_pool',
      status: 'active',
      taxIdentityStatus: 'complete',
    },
  };

  it('includes a row when any of I-9 / direct deposit / tax forms is not Ready', () => {
    const rows = buildTaxPayrollQueueRows(
      [
        {
          id: pipelineId,
          userId: uid,
          userName: 'Test Worker',
          entityKey,
          entityName: 'C1 Select LLC',
          status: 'in_progress',
          externalOnboardingSteps: {
            i9_employee_section: {
              status: 'invite_sent',
              externalSource: 'tempworks',
            },
            direct_deposit: {
              status: 'invite_sent',
              externalSource: 'tempworks',
            },
            tax_withholding_forms: {
              status: 'completed',
              externalSource: 'tempworks',
              verifiedAt: new Date(),
            },
          },
          steps: [{ id: 'everee', workflowStatus: 'in_progress' }],
        },
      ],
      baseEmployment,
      { [uid]: { firstName: 'Test', lastName: 'Worker' } },
      {},
      {},
      undefined,
      new Map(),
      { [payrollDocId]: baseAccount },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].i9CompleteLabel).not.toBe('Ready');
    expect(rows[0].directDepositLabel).toBe('Ready');
  });

  it('omits the row when I-9, direct deposit, and tax forms are all Ready (onboarded for this slice) even if pipeline status is still in progress', () => {
    const rows = buildTaxPayrollQueueRows(
      [
        {
          id: pipelineId,
          userId: uid,
          userName: 'Lee Hudson',
          entityKey,
          entityName: 'C1 Select LLC',
          status: 'in_progress',
          externalOnboardingSteps: {
            i9_employee_section: {
              status: 'completed',
              externalSource: 'tempworks',
              verifiedAt: new Date(),
            },
            direct_deposit: {
              status: 'invite_sent',
              externalSource: 'tempworks',
            },
            tax_withholding_forms: {
              status: 'completed',
              externalSource: 'tempworks',
              verifiedAt: new Date(),
            },
          },
          steps: [{ id: 'everee', workflowStatus: 'in_progress' }],
        },
      ],
      baseEmployment,
      { [uid]: { firstName: 'Lee', lastName: 'Hudson' } },
      {},
      {},
      undefined,
      new Map(),
      { [payrollDocId]: baseAccount },
    );

    expect(rows).toHaveLength(0);
  });
});
