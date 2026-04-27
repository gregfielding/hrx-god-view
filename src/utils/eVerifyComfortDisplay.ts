/**
 * E-Verify comfort / willingness from apply flow (requirements.eVerifyComfort → users.comfortableEVerify).
 * Also mirrored under workerAttestations.eVerifyWillingness (see workerReadinessWriteModel).
 * Stored values: Yes | No | Maybe (English).
 */

export type EVerifyComfortStatus = 'yes' | 'no' | 'maybe' | 'skipped';

/** Prefer top-level comfortableEVerify; fall back to nested attestation (same as WorkerProfileAccordions). */
export function resolveEVerifyComfortRawFromUserData(user: unknown): unknown {
  if (user == null || typeof user !== 'object') return undefined;
  const u = user as Record<string, unknown>;
  const top = u.comfortableEVerify;
  if (top != null && String(top).trim() !== '') return top;
  const att = u.workerAttestations;
  if (att != null && typeof att === 'object') {
    const w = (att as Record<string, unknown>).eVerifyWillingness;
    if (w != null && String(w).trim() !== '') return w;
  }
  return undefined;
}

export function getEVerifyComfortStatusFromUserData(user: unknown): EVerifyComfortStatus {
  return getEVerifyComfortStatus(resolveEVerifyComfortRawFromUserData(user));
}

export function getEVerifyComfortStatus(raw: unknown): EVerifyComfortStatus {
  if (raw == null || typeof raw !== 'string') return 'skipped';
  const s = raw.trim();
  if (!s) return 'skipped';
  const lower = s.toLowerCase();
  if (lower === 'yes') return 'yes';
  if (lower === 'no') return 'no';
  if (lower === 'maybe') return 'maybe';
  return 'skipped';
}

export function getEVerifyComfortLabel(status: EVerifyComfortStatus): string {
  switch (status) {
    case 'yes':
      return 'Yes';
    case 'no':
      return 'No';
    case 'maybe':
      return 'Maybe';
    case 'skipped':
      return 'Skipped';
  }
}

/** Table sort: yes → maybe → no → skipped (ascending). */
export function compareEVerifyComfort(a: EVerifyComfortStatus, b: EVerifyComfortStatus): number {
  const order: Record<EVerifyComfortStatus, number> = { yes: 0, maybe: 1, no: 2, skipped: 3 };
  return order[a] - order[b];
}
