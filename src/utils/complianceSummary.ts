/**
 * Compliance Engine — centralized compliance summary from checklist.
 * Spec: HRX-Documents-Compliance-Scoring-v3 §5
 *
 * Expiration rules:
 * - > 30 days until expiration → Verified (completed)
 * - ≤ 30 days → Expiring Soon
 * - ≤ 0 days → Expired
 */

import type { ComplianceSummary, ComplianceOverallStatus, OnboardingChecklist } from '../types/onboarding';
import { parseExpiresAt } from './onboardingExpiration';

const EXPIRING_SOON_DAYS = 30;

/**
 * Compute compliance summary from checklist.
 * Returns: compliancePercent (0–100), overallStatus, expiredCount, expiringSoonCount, completedCount, requiredCount.
 */
export function computeComplianceSummary(checklist: OnboardingChecklist): ComplianceSummary {
  const now = new Date();
  const keys = Object.keys(checklist);
  const requiredCount = keys.length || 1;

  let completedCount = 0;
  let expiredCount = 0;
  let expiringSoonCount = 0;

  for (const key of keys) {
    const item = checklist[key];
    const expiresAt = parseExpiresAt(item.expiresAt ?? item.nextExpiringAt);

    if (item.status === 'missing' || item.status === 'submitted') {
      // not completed
      continue;
    }

    // verified (or expired)
    if (expiresAt) {
      const daysLeft = (expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
      if (daysLeft <= 0) {
        expiredCount++;
        // expired does not count as completed
        continue;
      }
      if (daysLeft <= EXPIRING_SOON_DAYS) {
        expiringSoonCount++;
      }
    }
    completedCount++;
  }

  const compliancePercent = requiredCount > 0 ? Math.round((completedCount / requiredCount) * 100) : 0;

  let overallStatus: ComplianceOverallStatus;
  if (expiredCount > 0) {
    overallStatus = 'non_compliant';
  } else if (expiringSoonCount > 0) {
    overallStatus = 'expiring_soon';
  } else if (completedCount >= requiredCount) {
    overallStatus = 'compliant';
  } else {
    overallStatus = 'incomplete';
  }

  return {
    compliancePercent,
    overallStatus,
    requiredCount,
    completedCount,
    expiredCount,
    expiringSoonCount,
    lastEvaluatedAt: now,
  };
}
