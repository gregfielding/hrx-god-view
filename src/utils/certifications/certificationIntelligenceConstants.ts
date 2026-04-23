import { EXPIRING_SOON_DAYS } from './evaluateCertificationRequirement';

/**
 * Intelligence-layer thresholds (insight only — not execution gating).
 * Aligned with engine `expiring_soon` where applicable.
 */
export const CERT_EXPIRING_SOON_DAYS = EXPIRING_SOON_DAYS;

/** Share of “expiring soon” vs approval pool that flags high-risk renewal pressure in summary gaps. */
export const CERT_HIGH_RISK_PERCENT = 0.3;

/** Minimum approved headcount for a required catalog before workforce intelligence flags gap / high risk. */
export const CERT_MIN_APPROVED_WORKERS = 2;

/** Minimum expired count vs workforce size that can contribute to HIGH risk (paired with share term). */
export const CERT_HIGH_RISK_EXPIRED_COUNT_FLOOR = 2;

/** Workforce share for “many expiring” in summary gap heuristic (pending vs total workers). */
export const CERT_GAP_PENDING_WORKFORCE_SHARE = 0.15;

/** Floor count paired with `CERT_GAP_PENDING_WORKFORCE_SHARE` for pending gap strings. */
export const CERT_GAP_PENDING_MIN_COUNT = 3;

/** Medium / high risk: share of evaluated workers in expiring_soon bucket. */
export const CERT_RISK_MEDIUM_EXPIRING_SHARE = 0.15;

/** Medium risk: pending volume vs workforce. */
export const CERT_RISK_MEDIUM_PENDING_SHARE = 0.12;

/** High risk: expired bucket vs workforce (count above max of floor and share×total). */
export const CERT_RISK_HIGH_EXPIRED_WORKFORCE_SHARE = 0.1;
