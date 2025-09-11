/**
 * Centralized Deal Health Calculator
 * 
 * This module provides a unified health calculation system that incorporates:
 * - Deal age (days since creation)
 * - Recent activity (days since last touch)
 * - Deal probability
 * - Missing critical data
 * - Stage progression
 * - Target close date overdue
 */

export type HealthBucket = 'healthy' | 'watch' | 'at_risk' | 'stale';
export type HealthStatus = 'green' | 'yellow' | 'red'; // For backward compatibility

export interface DealHealthResult {
  bucket: HealthBucket;
  status: HealthStatus; // For backward compatibility
  score: number; // 0-100
  reasons: string[];
  display: {
    label: string;
    color: 'success' | 'warning' | 'error';
    emoji: string;
  };
}

export interface DealAge {
  days: number;
  date: Date;
}

/**
 * Calculate deal age from creation date
 */
export function calculateDealAge(createdAt: any): DealAge | null {
  let createdAtDate: Date | null = null;
  
  if (createdAt?.toDate) {
    createdAtDate = createdAt.toDate();
  } else if (createdAt instanceof Date) {
    createdAtDate = createdAt;
  } else if (typeof createdAt === 'string' || typeof createdAt === 'number') {
    const parsed = new Date(createdAt);
    createdAtDate = isNaN(parsed.getTime()) ? null : parsed;
  }
  
  if (!createdAtDate) return null;
  
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - createdAtDate.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return {
    days: diffDays,
    date: createdAtDate
  };
}

/**
 * Calculate days since last activity/touch
 */
export function calculateDaysSinceLastTouch(deal: any): number {
  const lastTouch = deal.updatedAt || deal.lastActivityAt;
  
  if (!lastTouch) return 999; // No activity recorded
  
  const lastTouchDate = lastTouch instanceof Date ? lastTouch : 
                       lastTouch?.toDate ? lastTouch.toDate() : new Date(lastTouch);
  
  return Math.floor((Date.now() - lastTouchDate.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Calculate deal probability (with activity bonus)
 */
export function calculateDealProbability(deal: any): number {
  // Stage-based probability mapping
  const stageProbabilities: Record<string, number> = {
    'discovery': 10,
    'qualification': 25,
    'scoping': 40,
    'proposalDrafted': 60,
    'proposalReview': 70,
    'negotiation': 80,
    'onboarding': 90,
    'closedWon': 100,
    'closedLost': 0
  };
  
  const stageProb = stageProbabilities[deal.stage] || 30;
  const dealProb = typeof deal.probability === 'number' ? deal.probability : stageProb;
  
  // Activity bonus calculation
  const daysSinceTouch = calculateDaysSinceLastTouch(deal);
  let activityBonus = 0;
  
  if (daysSinceTouch <= 3) activityBonus = 15;
  else if (daysSinceTouch <= 7) activityBonus = 10;
  else if (daysSinceTouch <= 14) activityBonus = 5;
  else if (daysSinceTouch <= 30) activityBonus = 0;
  else if (daysSinceTouch <= 60) activityBonus = -5;
  else activityBonus = -10;
  
  // Combine and clamp
  const combined = Math.round((stageProb + dealProb) / 2) + activityBonus;
  return Math.max(0, Math.min(100, combined));
}

/**
 * Main health calculation function
 */
export function calculateDealHealth(deal: any): DealHealthResult {
  const age = calculateDealAge(deal?.createdAt);
  const daysSinceLastTouch = calculateDaysSinceLastTouch(deal);
  const probability = calculateDealProbability(deal);
  const stage = deal.stage;
  
  // Start with perfect score
  let score = 100;
  const reasons: string[] = [];
  
  // Age penalty (1 point per day after 14 days)
  if (age) {
    const agePenalty = Math.max(0, age.days - 14) * 1;
    score -= agePenalty;
    if (age.days > 30) {
      reasons.push(`Open ${age.days} days`);
    }
  } else {
    score -= 20; // No creation date
    reasons.push('No creation date');
  }
  
  // Inactivity penalty (3 points per day after 3 days of no activity)
  const inactivityPenalty = Math.max(0, daysSinceLastTouch - 3) * 3;
  score -= inactivityPenalty;
  if (daysSinceLastTouch > 7) {
    reasons.push(`No activity ${daysSinceLastTouch} days`);
  }
  
  // Probability penalty (lower probability = lower health)
  const probPenalty = Math.max(0, 50 - probability) * 0.5;
  score -= probPenalty;
  if (probability < 30) {
    reasons.push(`Low probability (${probability}%)`);
  }
  
  // Missing critical data penalty
  const missingCriticalData = !deal.associations?.contacts?.length || 
                             !deal.associations?.salespeople?.length ||
                             !deal.notes;
  if (missingCriticalData) {
    score -= 10;
    reasons.push('Missing required data');
  }
  
  // Stalled in mid/late stages penalty
  const earlyStages = ['discovery', 'qualification'];
  if (age && !earlyStages.includes(stage) && age.days > 21) {
    score -= 5;
    reasons.push('Stalled in mid-stage');
  }
  
  // Target close date overdue penalty (if available)
  if (deal.targetCloseDate) {
    const targetDate = deal.targetCloseDate instanceof Date ? deal.targetCloseDate : 
                      deal.targetCloseDate?.toDate ? deal.targetCloseDate.toDate() : 
                      new Date(deal.targetCloseDate);
    const overdueDays = Math.max(0, Math.floor((Date.now() - targetDate.getTime()) / (1000 * 60 * 60 * 24)));
    if (overdueDays > 0) {
      score -= overdueDays * 2;
      reasons.push(`Past target by ${overdueDays} days`);
    }
  }
  
  // Clamp score between 0 and 100
  score = Math.max(0, Math.min(100, score));
  
  // Determine health bucket
  let bucket: HealthBucket;
  if (score >= 75) bucket = 'healthy';
  else if (score >= 55) bucket = 'watch';
  else if (score >= 35) bucket = 'at_risk';
  else bucket = 'stale';
  
  // Map to legacy status for backward compatibility
  let status: HealthStatus;
  if (bucket === 'healthy') status = 'green';
  else if (bucket === 'watch') status = 'yellow';
  else status = 'red';
  
  // Display configuration
  const displayMap = {
    healthy: { label: 'Healthy', color: 'success' as const, emoji: '🟢' },
    watch: { label: 'Watch', color: 'warning' as const, emoji: '🟡' },
    at_risk: { label: 'At Risk', color: 'error' as const, emoji: '🟠' },
    stale: { label: 'Stale', color: 'error' as const, emoji: '🔴' }
  };
  
  return {
    bucket,
    status,
    score,
    reasons,
    display: displayMap[bucket]
  };
}

/**
 * Legacy function for backward compatibility with Pipeline tab
 */
export function getDealHealthLegacy(deal: any): HealthStatus {
  return calculateDealHealth(deal).status;
}
