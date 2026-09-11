/**
 * Sanitized Everee shapes for the returned-funds tests.
 *
 * Modeled on the real C1 Events payments of 2026-09-11 (`GET
 * /api/v2/payments/{id}` + `GET /api/v2/payables?external-worker-id=`), with
 * every id, name, and bank number replaced: routing numbers are all-zero
 * (invalid by construction) and the taxpayerIdentifier is a placeholder that
 * only exists so the tests can prove the sanitizer drops it.
 */

export const FIXTURE_ENTITY_FUNDING_ACCOUNTS = [
  { bankAccountId: 9001, routingLast4: '0001', accountLast4: '4321', label: 'Company business checking' },
];

const employee = {
  externalWorkerId: 'fixtureWorkerUid0000000001',
  employeeId: 111,
  firstName: 'Test',
  taxpayerIdentifier: '123456789',
};

const money = (amount: string) => ({ amount, currency: 'USD' });

const workerRow = (over: Record<string, unknown>) => ({
  id: 1,
  createdAt: '2026-07-30T14:16:43.841645',
  paymentId: 90000002,
  bankName: 'Worker Test Bank NA',
  accountName: 'WORKER TEST BANK',
  routingNumber: '000080123',
  accountNumberLast4: '*********7777',
  accountType: 'CHECKING',
  ruleAmount: 1,
  ruleAmountType: 'PERCENT',
  bankAccountId: 5550001,
  ...over,
});

const companyRow = (over: Record<string, unknown>) => ({
  id: 2,
  createdAt: '2026-07-30T14:16:43.843454',
  paymentId: 90000002,
  bankName: 'Company Test Bank',
  accountName: 'Business Checking',
  routingNumber: '000090001',
  accountNumberLast4: '********4321',
  accountType: 'CHECKING',
  ruleAmount: 1,
  ruleAmountType: 'PERCENT',
  status: 'DEPOSITED',
  bankAccountId: 9001,
  ...over,
});

const basePayment = {
  companyId: 3000,
  type: 'AD_HOC',
  status: 'PAID',
  queryStatus: 'PAID',
  depositStatus: 'DEPOSITED',
  fundingType: 'OPTIMISTIC_FUNDED',
  employee,
  payeeDisplayFullName: 'Worker, Test A',
  earningList: [{ id: 4, type: 'CONTRACTOR', note: '33.92 Hours - Test State', amount: money('542.72') }],
};

/** Re-issued payment: worker row zeroed, full amount re-routed to the company
 *  account on the return date (the Victor-shaped case). */
export const RETURNED_REISSUED_PAYMENT = {
  ...basePayment,
  id: 90000002,
  prevPaymentId: 90000001,
  createdAt: '2026-07-28T18:27:29.257947',
  payDate: '2026-07-30',
  grossEarnings: money('542.72'),
  netEarnings: money('542.72'),
  depositList: [
    workerRow({ status: 'DEPOSITED', updatedAt: '2026-07-30T17:06:32.346575', amounts: { amount: money('0.00'), ytdAmount: money('542.72') } }),
    companyRow({ updatedAt: '2026-09-11T12:11:56.851504', amounts: { amount: money('542.72'), ytdAmount: money('542.72') } }),
  ],
  fundingList: [{ id: 3, companyId: 3000, type: 'OPTIMISTIC_FUNDED', amount: money('542.72'), fundingDate: '2026-07-30', status: 'SUBMITTED', companyFundingId: 7001 }],
};

/** Only a company row left (the Derrick-shaped case). */
export const RETURNED_COMPANY_ROW_ONLY = {
  ...basePayment,
  id: 90000010,
  payDate: '2026-08-07',
  grossEarnings: money('187.56'),
  depositList: [companyRow({ paymentId: 90000010, updatedAt: '2026-09-11T12:11:58.909086', amounts: { amount: money('187.56') } })],
};

/** DEPOSITED with an empty depositList — happened to one returned payment
 *  on 2026-09-11 (the Moman-shaped case); nothing proves where it went. */
export const DEPOSITED_NO_DEPOSIT_ROWS = {
  ...basePayment,
  id: 90000020,
  payDate: '2026-08-13',
  grossEarnings: money('31.20'),
  depositList: [],
};

/** The worker fixed their bank and Everee's retry landed. */
export const RETRY_DEPOSITED_TO_WORKER = {
  ...basePayment,
  id: 90000030,
  payDate: '2026-08-07',
  grossEarnings: money('347.97'),
  depositList: [workerRow({ paymentId: 90000030, bankAccountId: 5550002, status: 'DEPOSITED', updatedAt: '2026-08-07T16:04:08.887099', amounts: { amount: money('347.97') } })],
};

export const STILL_BOUNCING = {
  ...basePayment,
  id: 90000040,
  payDate: '2026-08-20',
  depositStatus: 'FAILED',
  grossEarnings: money('120.00'),
  depositList: [workerRow({ paymentId: 90000040, status: 'FAILED', updatedAt: '2026-08-21T10:00:00.000001', amounts: { amount: money('120.00') } })],
};

export const RETRY_IN_FLIGHT = {
  ...basePayment,
  id: 90000050,
  payDate: '2026-08-20',
  depositStatus: 'PENDING',
  grossEarnings: money('120.00'),
  depositList: [workerRow({ paymentId: 90000050, status: 'PENDING', updatedAt: '2026-09-10T10:00:00.000001', amounts: { amount: money('120.00') } })],
};

/** `GET /api/v2/payables?external-worker-id=` rows: the re-issued payment's
 *  payables still point at the ORIGINAL payment id, plus an unrelated one. */
export const WORKER_PAYABLES = [
  { id: 1, companyId: 3000, workerId: 'w-uuid', externalWorkerId: employee.externalWorkerId, type: 'PAYABLE', label: 'Contractor pay — Test Venue — 2026-07-17 — 11.5 hr', verified: true, amount: { amount: 184, currency: 'USD' }, earningAmount: { amount: 184, currency: 'USD' }, payCode: 'CONTRACTOR', earningType: 'CONTRACTOR', earningTimestamp: 1784894400, paymentId: 90000001, paymentStatus: 'PAID' },
  { id: 2, companyId: 3000, workerId: 'w-uuid', externalWorkerId: employee.externalWorkerId, type: 'PAYABLE', label: 'Contractor pay — Test Venue — 2026-07-18 — 11 hrs', verified: true, amount: { amount: 176, currency: 'USD' }, earningAmount: { amount: 176, currency: 'USD' }, payCode: 'CONTRACTOR', earningType: 'CONTRACTOR', earningTimestamp: 1784894400, paymentId: 90000001, paymentStatus: 'PAID' },
  { id: 3, companyId: 3000, workerId: 'w-uuid', externalWorkerId: employee.externalWorkerId, type: 'PAYABLE', label: 'Contractor pay — Test Venue — 2026-07-19 — 11.42 h', verified: true, amount: { amount: 182.72, currency: 'USD' }, earningAmount: { amount: 182.72, currency: 'USD' }, payCode: 'CONTRACTOR', earningType: 'CONTRACTOR', earningTimestamp: 1784894400, paymentId: 90000001, paymentStatus: 'PAID' },
  { id: 4, companyId: 3000, workerId: 'w-uuid', externalWorkerId: employee.externalWorkerId, type: 'PAYABLE', label: 'Contractor pay — Test Venue — 2026-07-10 — 15 hrs', verified: true, amount: { amount: 300, currency: 'USD' }, earningAmount: { amount: 300, currency: 'USD' }, payCode: 'CONTRACTOR', earningType: 'CONTRACTOR', earningTimestamp: 1784289600, paymentId: 89999999, paymentStatus: 'PAID' },
];

const T = 'tenantFixture';
const importLine = (workDate: string, amount: number) => ({
  entryId: `import__test_venue__fixtureworkeruid0000000001__${workDate}`,
  externalId: `${T}::import-test_venue-fixtureWorkerUid0000000001::${workDate}::CONTRACTOR`,
  amount,
  workDate,
});

/** HRX lines for the same worker + entity: the three returned days, an
 *  unrelated paid day, and a grid row HRX keeps no per-line amount for. */
export const WORKER_HRX_LINES = [
  importLine('2026-07-17', 184),
  importLine('2026-07-18', 176),
  importLine('2026-07-19', 182.72),
  importLine('2026-07-10', 300),
  { entryId: 'assignFixture_2026-07-12', externalId: `${T}::assignFixture::2026-07-12::CONTRACTOR`, amount: null, workDate: '2026-07-12' },
];

export { importLine as fixtureImportLine };
