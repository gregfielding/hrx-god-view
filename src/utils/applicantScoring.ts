/**
 * Applicant Scoring Utilities
 * 
 * Two-score system:
 * 1. Profile Score (0-100): Rule-based calculation of profile completeness
 * 2. Fit Score (0-100): AI-powered job-specific qualification match
 */

import { warnLegacyCertUsageDetected } from './certifications/certificationsLogging';

interface UserProfile {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  phoneE164?: string;
  dob?: string;
  address?: any;
  addressInfo?: any;
  phoneVerified?: boolean;
  workEligibility?: boolean;
  skills?: string[];
  workHistory?: any[];
  education?: any[];
  certifications?: any[];
  languages?: string[];
  loginCount?: number;
  updatedAt?: any;
  createdAt?: any;
  applicationData?: any;
  professionalBio?: string;
  bio?: string;
  summary?: string;
  resume?: { storagePath?: string; downloadUrl?: string };
}

/**
 * Completeness score (0–100) for AI score formula.
 * Includes bio and resume (resume weighted heavy). Use for scoreSummary.completenessScore.
 */
export function calculateCompletenessScore(user: UserProfile): number {
  let score = 0;

  // Basic Info (15 points)
  const hasBasicInfo = !!(
    user.firstName &&
    user.lastName &&
    user.email &&
    (user.phone || user.phoneE164) &&
    user.dob &&
    (user.address || user.addressInfo)
  );
  if (hasBasicInfo) score += 15;

  // Verification (12 points)
  if (user.phoneVerified) score += 6;
  if (user.workEligibility) score += 6;

  // Skills (12 points)
  if (user.skills && user.skills.length >= 3) score += 12;
  else if (user.skills && user.skills.length > 0) score += Math.round((user.skills.length / 3) * 12);

  // Work History (10 points)
  if (user.workHistory && user.workHistory.length > 0) score += 10;

  // Certifications (8 points)
  if (user.certifications && user.certifications.length > 0) {
    warnLegacyCertUsageDetected({ surface: 'calculateApplicantFitScore', field: 'user.certifications' });
    score += 8;
  }

  // Education (4 points)
  if (user.education && user.education.length > 0) score += 4;

  // Bio (8 points) – professionalBio, bio, or summary
  const hasBio = !!(
    (user.professionalBio && String(user.professionalBio).trim()) ||
    (user.bio && String(user.bio).trim()) ||
    (user.summary && String(user.summary).trim())
  );
  if (hasBio) score += 8;

  // Resume (25 points) – weighted heavy
  const hasResume = !!(user.resume && (user.resume.storagePath || user.resume.downloadUrl));
  if (hasResume) score += 25;

  // Engagement (8 points total)
  if (user.loginCount && user.loginCount > 3) score += 2;
  if (user.updatedAt) {
    const updatedDate = user.updatedAt.toDate ? user.updatedAt.toDate() : new Date(user.updatedAt);
    const daysSinceUpdate = (Date.now() - updatedDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceUpdate <= 30) score += 2;
  }
  if (user.applicationData && Object.keys(user.applicationData).length > 1) score += 2;
  if (user.languages && user.languages.length > 0) score += 2;

  return Math.min(Math.round(score), 100);
}

/**
 * Calculate Profile Score (0-100)
 * Rule-based - instant, no AI costs
 */
export const calculateProfileScore = (user: UserProfile): number => {
  let score = 0;

  // Basic Info Complete (20 points)
  const hasBasicInfo = !!(
    user.firstName &&
    user.lastName &&
    user.email &&
    (user.phone || user.phoneE164) &&
    user.dob &&
    (user.address || user.addressInfo)
  );
  if (hasBasicInfo) score += 20;

  // Verification Status (20 points)
  if (user.phoneVerified) score += 10;
  if (user.workEligibility) score += 10;

  // Skills Added (15 points) - Minimum 3 skills
  if (user.skills && user.skills.length >= 3) score += 15;
  else if (user.skills && user.skills.length > 0) score += (user.skills.length / 3) * 15;

  // Work History (15 points) - At least 1 job entry
  if (user.workHistory && user.workHistory.length > 0) {
    score += 15;
  }

  // Certifications (10 points)
  if (user.certifications && user.certifications.length > 0) {
    warnLegacyCertUsageDetected({ surface: 'calculateProfileScore', field: 'user.certifications' });
    score += 10;
  }

  // Education (5 points)
  if (user.education && user.education.length > 0) score += 5;

  // Engagement Bonuses (max 15 bonus points)
  if (user.loginCount && user.loginCount > 3) score += 5;
  
  // Profile updated recently (within 30 days)
  if (user.updatedAt) {
    const updatedDate = user.updatedAt.toDate ? user.updatedAt.toDate() : new Date(user.updatedAt);
    const daysSinceUpdate = (Date.now() - updatedDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceUpdate <= 30) score += 5;
  }

  // Multiple applications shows engagement
  if (user.applicationData && Object.keys(user.applicationData).length > 1) score += 3;

  // Languages (2 points)
  if (user.languages && user.languages.length > 0) score += 2;

  // Cap at 100
  return Math.min(Math.round(score), 100);
};

/**
 * Get score color based on value
 */
export const getScoreColor = (score: number | null | undefined): 'success' | 'warning' | 'error' | 'default' => {
  if (score === null || score === undefined) return 'default';
  if (score >= 70) return 'success';
  if (score >= 40) return 'warning';
  return 'error';
};

/**
 * Get score label with icon
 */
export const getScoreLabel = (score: number | null | undefined): string => {
  if (score === null || score === undefined) return '-';
  return `${score}`;
};

/**
 * Check if Fit Score should be calculated
 * Only calculate if profile is reasonably complete
 */
export const shouldCalculateFitScore = (profileScore: number): boolean => {
  return profileScore >= 40;
};

/**
 * Check if cached Fit Score is still valid
 * Invalidate after 7 days or if job requirements change
 */
export const isFitScoreCacheValid = (
  fitScoreCalculatedAt: any,
  jobRequirementsHash: string,
  currentJobRequirementsHash: string
): boolean => {
  if (!fitScoreCalculatedAt) return false;
  if (jobRequirementsHash !== currentJobRequirementsHash) return false;

  const calculatedDate = fitScoreCalculatedAt.toDate ? fitScoreCalculatedAt.toDate() : new Date(fitScoreCalculatedAt);
  const daysSinceCalculation = (Date.now() - calculatedDate.getTime()) / (1000 * 60 * 60 * 24);
  
  return daysSinceCalculation <= 7;
};

/**
 * Generate hash of job requirements for cache invalidation
 */
export const hashJobRequirements = (jobOrder: any): string => {
  const requirements = {
    jobTitle: jobOrder.jobTitle,
    skillsRequired: jobOrder.skillsRequired || [],
    experienceRequired: jobOrder.experienceRequired,
    educationRequired: jobOrder.educationRequired,
    licensesCerts: jobOrder.licensesCerts || [],
    physicalRequirements: jobOrder.physicalRequirements || []
  };
  
  return JSON.stringify(requirements);
};

