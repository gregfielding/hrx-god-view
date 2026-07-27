/**
 * Indeed Flex agency-portal capture — shared types + defensive normalizer
 * (PI-7, 2026-07-27).
 *
 * The Chrome extension (browser-extensions/indeed-flex-sync) captures the
 * agency portal's own JSON API responses as a recruiter browses a job and
 * POSTs them RAW to `indeedFlexPortalIngest`. Following the hard-won
 * Fieldglass lesson — "the extension extracts NOTHING so a portal change
 * can't break it" — all field extraction happens HERE on the server.
 *
 * Observed API (agency.indeedflex.com → flex-core-us.indeed.com/api/v2):
 *   GET /agency_portal/agencies/{agencyId}/jobs/{jobId}?…&with_pay_rates=true
 *   GET /agency_portal/agencies/{agencyId}/agency_shifts?job_id={jobId}
 *   GET /agency_portal/agencies/{agencyId}/workers?booked_agency_shift_ids[]={shiftId}
 * Live sample: agency 3403, job 532423, venue 11020, role 1,
 * agency_shift 2020327, booked worker "Engelbert Sanchez" (Milwaukee).
 *
 * The raw JSON key names are NOT yet pinned (CORS blocked a direct probe);
 * the normalizer therefore reads each field from a list of candidate keys
 * in BOTH snake_case and camelCase and is validated against the first real
 * extension payload in Slice 2. Keep it tolerant — never throw on a missing
 * field, surface what parsed and let the caller decide.
 */

/* ────────────────────────────────────────────────────────────────────
 * Wire envelope — exactly what the extension POSTs
 * ──────────────────────────────────────────────────────────────────── */

export interface FlexPortalCaptureEnvelope {
  tenantId: string;
  /** C1's Indeed Flex agency id (3403 in prod) — from the API path. */
  agencyId: string;
  /** URL params the SPA carries; jobId is the canonical Flex job id. */
  context: {
    jobId: string;
    roleId?: string | null;
    venueId?: string | null;
    /** The /platforms/{platformId}/ segment of the portal URL. */
    platformId?: string | null;
    url?: string | null;
  };
  /** Raw JSON body of the jobs/{jobId}?with_pay_rates=true response. */
  job?: unknown;
  /** Raw JSON body of the agency_shifts response. */
  shifts?: unknown;
  /** Raw JSON body of the workers (booked roster) response. */
  roster?: unknown;
  /** ms epoch stamped by the extension at capture. */
  capturedAt?: number;
}

/* ────────────────────────────────────────────────────────────────────
 * Normalized shapes — what the reconciler works with
 * ──────────────────────────────────────────────────────────────────── */

export interface NormalizedFlexRate {
  /** e.g. "Standard", "Overtime". */
  label: string;
  /** Worker pay, dollars. */
  payRate: number | null;
  /** Agency charge/bill rate, dollars — often absent on this view. */
  chargeRate: number | null;
}

export interface NormalizedFlexShift {
  /** agency_shift_id — the stable per-shift Flex id (e.g. "2020327"). */
  flexShiftId: string;
  /** yyyy-mm-dd (worksite-local calendar day). */
  date: string;
  /** "HH:MM" 24h, or null when the API gives only a datetime we couldn't split. */
  startTime: string | null;
  endTime: string | null;
  /** ISO timestamps as given, kept for audit / tz work. */
  startsAt: string | null;
  endsAt: string | null;
  workersRequested: number | null;
  workersBooked: number | null;
}

export interface NormalizedFlexBookedWorker {
  /** Flex worker id — the stable join key when present. */
  flexWorkerId: string | null;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  /** The agency "branch"/unique-identifier tag (e.g. "Milwaukee", "CORT-PHILLY"). */
  branch: string | null;
  /** agency_shift_id(s) this worker is booked on. */
  flexShiftIds: string[];
}

export interface NormalizedFlexJob {
  flexJobId: string;
  roleId: string | null;
  venueId: string | null;
  /** Client-facing role/title, e.g. "EVENTS (Loader / Crew)". */
  title: string;
  /** Broad category, e.g. "Industrial". */
  category: string | null;
  /** Portal status string, e.g. "In Progress". */
  status: string | null;
  /** Free-text worksite address as shown. */
  address: string | null;
  rates: NormalizedFlexRate[];
  /** The single "primary" worker pay rate when resolvable (Standard first). */
  primaryPayRate: number | null;
}

export interface NormalizedFlexCapture {
  job: NormalizedFlexJob;
  shifts: NormalizedFlexShift[];
  roster: NormalizedFlexBookedWorker[];
  /** Anything the normalizer couldn't confidently read — surfaced, not thrown. */
  warnings: string[];
}

/* ────────────────────────────────────────────────────────────────────
 * Defensive readers
 * ──────────────────────────────────────────────────────────────────── */

function trim(v: unknown): string {
  return String(v ?? '').trim();
}

/** First present, non-empty value among candidate keys (nested via "a.b"). */
function pick(obj: unknown, keys: string[]): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const key of keys) {
    let cur: unknown = obj;
    for (const seg of key.split('.')) {
      if (cur && typeof cur === 'object' && seg in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[seg];
      } else {
        cur = undefined;
        break;
      }
    }
    if (cur !== undefined && cur !== null && cur !== '') return cur;
  }
  return undefined;
}

function pickStr(obj: unknown, keys: string[]): string | null {
  const v = pick(obj, keys);
  return v === undefined ? null : trim(v) || null;
}

function pickNum(obj: unknown, keys: string[]): number | null {
  const v = pick(obj, keys);
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Unwrap the common { data: … } / { results: … } / bare-array envelopes. */
function unwrap(body: unknown): unknown {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    if (Array.isArray(o.data)) return o.data;
    if (Array.isArray(o.results)) return o.results;
    if (Array.isArray(o.workers)) return o.workers;
    if (Array.isArray(o.shifts)) return o.shifts;
    if (Array.isArray(o.agency_shifts)) return o.agency_shifts;
    if (o.data && typeof o.data === 'object') return o.data;
  }
  return body;
}

function asArray(body: unknown): Record<string, unknown>[] {
  const u = unwrap(body);
  return Array.isArray(u) ? (u.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]) : [];
}

/** Split an ISO/space datetime into yyyy-mm-dd + HH:MM without tz math. */
function splitDateTime(v: string | null): { date: string | null; time: string | null; iso: string | null } {
  if (!v) return { date: null, time: null, iso: null };
  const iso = v;
  const m = v.match(/(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (m) return { date: m[1], time: m[2], iso };
  const d = v.match(/\d{4}-\d{2}-\d{2}/);
  return { date: d ? d[0] : null, time: null, iso };
}

/* ────────────────────────────────────────────────────────────────────
 * Normalizer
 * ──────────────────────────────────────────────────────────────────── */

export function normalizeFlexPortalCapture(env: FlexPortalCaptureEnvelope): NormalizedFlexCapture {
  const warnings: string[] = [];
  const flexJobId = trim(env.context?.jobId) || pickStr(unwrap(env.job), ['id', 'jobId', 'job_id']) || '';

  // ---- Job ----
  const jobObj = (unwrap(env.job) ?? {}) as Record<string, unknown>;
  const rates: NormalizedFlexRate[] = [];
  const rawRates = pick(jobObj, ['pay_rates', 'payRates', 'rates']);
  if (Array.isArray(rawRates)) {
    for (const r of rawRates) {
      rates.push({
        label: pickStr(r, ['label', 'name', 'type', 'rate_type']) || 'Standard',
        payRate: pickNum(r, ['pay_rate', 'payRate', 'worker_rate', 'workerRate', 'amount', 'rate']),
        chargeRate: pickNum(r, ['charge_rate', 'chargeRate', 'client_rate', 'clientRate', 'bill_rate', 'billRate']),
      });
    }
  }
  // Some responses expose a flat pay rate rather than an array.
  const flatPay = pickNum(jobObj, ['pay_rate', 'payRate', 'standard_pay_rate', 'worker_rate']);
  if (rates.length === 0 && flatPay !== null) {
    rates.push({ label: 'Standard', payRate: flatPay, chargeRate: pickNum(jobObj, ['charge_rate', 'chargeRate', 'client_rate']) });
  }
  const standard = rates.find((r) => /standard/i.test(r.label)) ?? rates[0];
  const primaryPayRate = standard?.payRate ?? null;
  if (rates.length === 0) warnings.push('no pay rate found on job payload');

  const job: NormalizedFlexJob = {
    flexJobId,
    roleId: trim(env.context?.roleId) || pickStr(jobObj, ['role_id', 'roleId']),
    venueId: trim(env.context?.venueId) || pickStr(jobObj, ['venue_id', 'venueId']),
    title: pickStr(jobObj, ['title', 'role_name', 'roleName', 'name', 'job_title']) || '',
    category: pickStr(jobObj, ['category', 'industry', 'sector']),
    status: pickStr(jobObj, ['status', 'state', 'job_status']),
    address: pickStr(jobObj, ['address', 'full_address', 'fullAddress', 'venue_address', 'location.address']),
    rates,
    primaryPayRate,
  };
  if (!job.flexJobId) warnings.push('no flex job id resolved');

  // ---- Shifts ----
  const shifts: NormalizedFlexShift[] = asArray(env.shifts).map((s) => {
    const startRaw = pickStr(s, ['start_time', 'startTime', 'starts_at', 'startsAt', 'start']);
    const endRaw = pickStr(s, ['end_time', 'endTime', 'ends_at', 'endsAt', 'end']);
    const dateRaw = pickStr(s, ['date', 'shift_date', 'shiftDate', 'work_date']);
    const st = splitDateTime(startRaw);
    const en = splitDateTime(endRaw);
    return {
      flexShiftId: pickStr(s, ['id', 'agency_shift_id', 'agencyShiftId', 'shift_id', 'shiftId']) || '',
      date: dateRaw || st.date || '',
      startTime: st.time,
      endTime: en.time,
      startsAt: st.iso,
      endsAt: en.iso,
      workersRequested: pickNum(s, ['workers_requested', 'workersRequested', 'requested', 'headcount']),
      workersBooked: pickNum(s, ['workers_booked', 'workersBooked', 'booked', 'filled']),
    };
  }).filter((s) => s.flexShiftId || s.date);
  if (shifts.length === 0) warnings.push('no shifts parsed');

  // ---- Roster (booked workers) ----
  const roster: NormalizedFlexBookedWorker[] = asArray(env.roster).map((w) => {
    const worker = (pick(w, ['worker', 'user']) as Record<string, unknown>) ?? w;
    const first = pickStr(worker, ['first_name', 'firstName', 'given_name']) || '';
    const last = pickStr(worker, ['last_name', 'lastName', 'family_name']) || '';
    const display = pickStr(worker, ['display_name', 'displayName', 'name', 'full_name', 'fullName'])
      || `${first} ${last}`.trim();
    const shiftIds = (() => {
      const v = pick(w, ['booked_agency_shift_ids', 'bookedAgencyShiftIds', 'agency_shift_ids', 'shift_ids']);
      if (Array.isArray(v)) return v.map(trim).filter(Boolean);
      const single = pickStr(w, ['agency_shift_id', 'agencyShiftId', 'shift_id']);
      return single ? [single] : [];
    })();
    return {
      flexWorkerId: pickStr(worker, ['id', 'worker_id', 'workerId', 'user_id', 'userId']),
      firstName: first,
      lastName: last,
      displayName: display,
      email: (pickStr(worker, ['email', 'email_address', 'emailAddress']) || '').toLowerCase() || null,
      phone: pickStr(worker, ['phone', 'phone_number', 'phoneNumber', 'mobile', 'mobile_number']),
      branch: pickStr(w, ['branch', 'unique_identifier', 'uniqueIdentifier', 'branch_name'])
        ?? pickStr(worker, ['branch', 'unique_identifier', 'branch_name']),
      flexShiftIds: shiftIds,
    };
  }).filter((w) => w.displayName || w.email);

  return { job, shifts, roster, warnings };
}
