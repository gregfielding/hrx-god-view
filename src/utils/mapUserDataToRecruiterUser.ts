import { calculateProfileScore } from './applicantScoring';
import { sanitizeWorkerNameParts } from './profileDisplayName';
import { normalizeScoreSummary } from './scoreSummary';
import { buildWorkHistoryJobTitles } from './workHistoryJobTitles';
import type { RecruiterUser } from '../types/recruiterUserListRow';

/**
 * Map plain Firestore user data to RecruiterUser for the given tenant; null if not in tenant or not security 0–4.
 */
export function mapUserDataToRecruiterUser(userId: string, userData: any, tenantId: string): RecruiterUser | null {
  const tenantData = userData.tenantIds?.[tenantId] || null;
  if (!tenantData) return null;

  const securityLevel = String(tenantData.securityLevel ?? userData.securityLevel ?? '0');
  if (!['0', '1', '2', '3', '4'].includes(securityLevel)) return null;

  const rawSkills = Array.isArray(userData.skills)
    ? userData.skills
    : Array.isArray(tenantData.skills)
      ? tenantData.skills
      : [];
  const normalizedSkills = rawSkills
    .map((skill: any) => {
      if (!skill) return null;
      if (typeof skill === 'string') return skill;
      if (typeof skill === 'object') {
        if (typeof skill.label === 'string') return skill.label;
        if (typeof skill.name === 'string') return skill.name;
        if (typeof skill.value === 'string') return skill.value;
      }
      return null;
    })
    .filter((skill): skill is string => !!skill);

  const mergedScoreSummary = normalizeScoreSummary({
    ...(userData.scoreSummary || {}),
    ...(tenantData?.scoreSummary || {}),
  });

  const resolvedEmail =
    [userData.email, userData.contactEmail, userData.primaryEmail, userData.profileEmail].find(
      (v: unknown) => typeof v === 'string' && String(v).trim().length > 0,
    ) || '';

  const rawDisplay = String(userData.displayName || '').trim();
  let firstName = String(userData.firstName || '').trim();
  let lastName = String(userData.lastName || '').trim();
  if (!firstName && !lastName && rawDisplay) {
    const parts = rawDisplay.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      firstName = parts[0];
      lastName = parts.slice(1).join(' ');
    } else if (parts.length === 1) {
      firstName = parts[0];
    }
  }

  const phoneForSanitize = String(userData.phone || userData.phoneE164 || '');
  const nameSanitized = sanitizeWorkerNameParts({
    firstName,
    lastName,
    preferredName: userData.preferredName,
    displayName: rawDisplay || undefined,
    email: resolvedEmail,
    phone: phoneForSanitize,
  });

  return {
    id: userId,
    firstName: nameSanitized.firstName,
    lastName: nameSanitized.lastName,
    displayName: rawDisplay || undefined,
    email: String(resolvedEmail).trim(),
    phone: userData.phone || '',
    avatar: userData.avatar || tenantData.avatar,
    securityLevel: String(securityLevel),
    employeeOnboardStatus: userData.employeeOnboardStatus,
    contractorOnboardStatus: userData.contractorOnboardStatus,
    onboardingType: userData.onboardingType,
    scoreSummary: mergedScoreSummary,
    lastLoginAt: userData.lastLoginAt,
    updatedAt: userData.updatedAt,
    createdAt: userData.createdAt,
    aiProfileScore:
      tenantData.aiProfileScore ??
      userData.aiProfileScore ??
      userData.aiScore ??
      userData.aiProfile?.score ??
      calculateProfileScore(userData),
    aiJobFitScore: tenantData.aiJobFitScore ?? userData.aiJobFitScore,
    userGroupIds: tenantData.userGroupIds || userData.userGroupIds || [],
    skills: normalizedSkills,
    city: userData.city || userData.address?.city || (userData.addressInfo && (userData.addressInfo as any).city) || '',
    state: (() => {
      const ai = userData.addressInfo && typeof userData.addressInfo === 'object' ? (userData.addressInfo as any) : null;
      const ad = userData.address && typeof userData.address === 'object' ? (userData.address as any) : null;
      const raw = userData.state || ad?.state || ai?.state || '';
      return typeof raw === 'string' ? raw.trim() : '';
    })(),
    workEligibility: userData.workEligibility,
    workEligibilityAttestation: userData.workEligibilityAttestation,
    comfortableEVerify: userData.comfortableEVerify,
    workerAttestations: userData.workerAttestations,
    resume: userData.resume ?? null,
    addedToIndeedFlex: userData.addedToIndeedFlex === true,
    addedToFieldglass: userData.addedToFieldglass === true,
    eVerifyOrders: Array.isArray(userData.eVerifyOrders) ? userData.eVerifyOrders : undefined,
    backgroundCheckOrders: Array.isArray(userData.backgroundCheckOrders) ? userData.backgroundCheckOrders : undefined,
    riskProfile: userData.riskProfile ?? undefined,
    recruiterScoreSnapshot: userData.recruiterScoreSnapshot ?? undefined,
    recruiterMasterScore: userData.recruiterMasterScore ?? undefined,
    phoneVerified: userData.phoneVerified === true,
    hasWorkerAiPrescreenInterview: userData.hasWorkerAiPrescreenInterview === true,
    interviewStatus: typeof userData.interviewStatus === 'string' ? userData.interviewStatus : undefined,
    lastInterviewCompletedAt: userData.lastInterviewCompletedAt,
    recruiterOrderInterviewSmsLastSentAt: userData.recruiterOrderInterviewSmsLastSentAt,
    workHistoryJobTitles: buildWorkHistoryJobTitles(userData),
  };
}

/** Map a Firestore user doc to RecruiterUser for the given tenant; null if not in tenant or not security 0–4. */
export function mapUserDocToRecruiterUser(userDoc: { id: string; data: () => any }, tenantId: string): RecruiterUser | null {
  return mapUserDataToRecruiterUser(userDoc.id, userDoc.data() as any, tenantId);
}
