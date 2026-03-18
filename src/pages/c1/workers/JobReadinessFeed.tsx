import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Box,
  Stack,
  Typography,
  Button,
  CircularProgress,
  Chip,
  LinearProgress,
  Fade,
  Card,
  CardContent,
  Paper,
} from '@mui/material';
import { doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { useNavigate } from 'react-router-dom';

import { db, storage } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { useT } from '../../../i18n';
import ReadinessEngineCard from '../../../components/worker/jobReadiness/ReadinessEngineCard';
import SkillsStep from '../../../components/apply/steps/SkillsStep';
import ResumeUpload from '../../../components/ResumeUpload';
import { buildJobReadinessEngine, getLifecycleStatePresentation } from '../../../utils/jobReadinessEngine';
import type { DesiredWorkType, TargetIndustry } from '../../../utils/jobReadinessOpportunityMap';
import { deriveWorkEligibilityFromAttestation, type WorkEligibilityAttestation } from '../../../types/workEligibility';
import {
  buildReadinessIntentWritePatch,
  buildReadinessResponseWritePatch,
} from '../../../utils/workerReadinessWriteModel';
import type { HomeReadinessLaunchStep } from '../../../components/worker/home/types';

type ScheduleIntentOption = 'full_time' | 'part_time' | 'gig';
const ALL_SCHEDULE_OPTIONS: ScheduleIntentOption[] = ['full_time', 'part_time', 'gig'];

type CertPromptKey = 'food_handler' | 'alcohol' | 'forklift' | 'other';

interface JobReadinessFeedProps {
  launchStep?: HomeReadinessLaunchStep;
}

const JobReadinessFeed: React.FC<JobReadinessFeedProps> = ({ launchStep = 'start' }) => {
  const { user } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const [userDoc, setUserDoc] = useState<Record<string, unknown> | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [isCardTransitioning, setIsCardTransitioning] = useState(false);
  const [selectedScheduleIntent, setSelectedScheduleIntent] = useState<ScheduleIntentOption[]>([]);
  const [targetIndustries, setTargetIndustries] = useState<TargetIndustry[]>([]);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [showIntentReadyTransition, setShowIntentReadyTransition] = useState(false);
  const [hideIntentBlock, setHideIntentBlock] = useState(false);
  const [showProfilePhotoStep, setShowProfilePhotoStep] = useState(false);
  const [, setShowEducationStep] = useState(false);
  const [showResumeStep, setShowResumeStep] = useState(false);
  const [resumeGateChoice, setResumeGateChoice] = useState<'unknown' | 'yes' | 'no'>('unknown');
  const [, setShowWorkExperienceStep] = useState(false);
  const [, setShowEmergencyContactStep] = useState(false);
  const [showWorkAuthorizationStep, setShowWorkAuthorizationStep] = useState(false);
  const [, setShowPostWorkAuthorizationHeadline] = useState(false);
  const [showCertificationsStep, setShowCertificationsStep] = useState(false);
  const [, setShowPostCertificationsHeadline] = useState(false);
  const [showSkillsStep, setShowSkillsStep] = useState(false);
  const [, setShowPostSkillsHeadline] = useState(false);
  const [, setEducationStepCompleted] = useState(false);
  const [resumeStepCompleted, setResumeStepCompleted] = useState(false);
  const [, setEmergencyContactStepCompleted] = useState(false);
  const [workAuthorizationStepCompleted, setWorkAuthorizationStepCompleted] = useState(false);
  const [certificationsStepCompleted, setCertificationsStepCompleted] = useState(false);
  const [skillsStepCompleted, setSkillsStepCompleted] = useState(false);
  const [profilePhotoStepCompleted, setProfilePhotoStepCompleted] = useState(false);
  const [, setWorkStepCompleted] = useState(false);
  const [, setSelectedEducationLevel] = useState('');
  const [certificationsValue, setCertificationsValue] = useState<Record<string, unknown>>({ certifications: [] });
  const [skillsValue, setSkillsValue] = useState<Record<string, unknown>>({ skills: [] });
  const [certPromptAnswers, setCertPromptAnswers] = useState<Record<CertPromptKey, boolean | null>>({
    food_handler: null,
    alcohol: null,
    forklift: null,
    other: null,
  });
  const [certUploadDone, setCertUploadDone] = useState<Record<CertPromptKey, boolean>>({
    food_handler: false,
    alcohol: false,
    forklift: false,
    other: false,
  });
  const [certUploadSkipped, setCertUploadSkipped] = useState<Record<CertPromptKey, boolean>>({
    food_handler: false,
    alcohol: false,
    forklift: false,
    other: false,
  });
  const [certUploadError, setCertUploadError] = useState<string | null>(null);
  const [certUploadingKey, setCertUploadingKey] = useState<CertPromptKey | null>(null);
  const [forkliftTypeDetail, setForkliftTypeDetail] = useState('');
  const [otherCredentialKind, setOtherCredentialKind] = useState('');
  const [workAuthorizationValue, setWorkAuthorizationValue] = useState<{
    workAuthorized: boolean | 'unsure' | null;
    requireSponsorship: boolean | 'unsure' | null;
  }>({
    workAuthorized: null,
    requireSponsorship: null,
  });
  const [workAuthorizationSubstep, setWorkAuthorizationSubstep] = useState<'authorized' | 'sponsorship'>('authorized');
  const [certificationsIntent, setCertificationsIntent] = useState<'unknown' | 'yes' | 'no'>('unknown');
  const [photoUploadError, setPhotoUploadError] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [resumeParsingStatus, setResumeParsingStatus] = useState<'idle' | 'uploading' | 'parsing' | 'completed' | 'error'>('idle');
  const [resumeProcessingActive, setResumeProcessingActive] = useState(false);
  const [resumeProcessingStartMs, setResumeProcessingStartMs] = useState<number | null>(null);
  const scheduleSettledTimerRef = useRef<number | null>(null);
  const transitionFadeOutTimerRef = useRef<number | null>(null);
  const transitionShowEducationTimerRef = useRef<number | null>(null);
  const postResumeToEducationTimerRef = useRef<number | null>(null);
  const postEducationToEmergencyTimerRef = useRef<number | null>(null);
  const emergencyContactAdvanceTimerRef = useRef<number | null>(null);
  const workAuthorizationAdvanceTimerRef = useRef<number | null>(null);
  const postWorkAuthorizationHeadlineHideTimerRef = useRef<number | null>(null);
  const postWorkAuthorizationToCertificationsTimerRef = useRef<number | null>(null);
  const postCertificationsHeadlineHideTimerRef = useRef<number | null>(null);
  const postCertificationsToSkillsTimerRef = useRef<number | null>(null);
  const postSkillsHeadlineHideTimerRef = useRef<number | null>(null);
  const postSkillsToWorkTimerRef = useRef<number | null>(null);
  const transitionTriggeredRef = useRef(false);
  const launchContextAppliedRef = useRef(false);
  const resumeAdvanceTimerRef = useRef<number | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!user?.uid) return;
    const userRef = doc(db, 'users', user.uid);
    const unsub = onSnapshot(userRef, (snap) => {
      setLoadingUser(false);
      if (!snap.exists()) {
        setUserDoc(null);
        return;
      }
      const data = snap.data() as Record<string, unknown>;
      setUserDoc(data);
      const workerProfile = ((data.workerProfile as Record<string, unknown> | undefined) || {}) as Record<string, unknown>;
      const workerExperience = ((workerProfile.experience as Record<string, unknown> | undefined) || {}) as Record<string, unknown>;
      const levelFromProfile = String(workerExperience.educationLevel || data.educationLevel || '').trim();
      setSelectedEducationLevel(levelFromProfile);
      const attestation = ((data.workEligibilityAttestation as Record<string, unknown> | undefined) || {}) as Record<string, unknown>;
      if (Object.keys(attestation).length > 0) {
        setWorkAuthorizationValue({
          workAuthorized:
            typeof attestation.authorizedToWorkUS === 'boolean' ? Boolean(attestation.authorizedToWorkUS) : null,
          requireSponsorship:
            typeof attestation.requireSponsorship === 'boolean' ? Boolean(attestation.requireSponsorship) : null,
        });
      } else {
        setWorkAuthorizationValue({
          workAuthorized: typeof data.workEligibility === 'boolean' ? Boolean(data.workEligibility) : null,
          requireSponsorship: typeof data.requireSponsorship === 'boolean' ? Boolean(data.requireSponsorship) : null,
        });
      }
      const workerCredentials = ((workerProfile.credentials as Record<string, unknown> | undefined) || {}) as Record<string, unknown>;
      const canonicalCertifications = Array.isArray(workerCredentials.certifications) ? workerCredentials.certifications : [];
      const legacyCertifications = Array.isArray(data.certifications) ? data.certifications : [];
      setCertificationsValue({
        certifications: canonicalCertifications.length > 0 ? canonicalCertifications : legacyCertifications,
      });
      const canonicalSkills = Array.isArray(workerProfile.skills) ? workerProfile.skills : [];
      const legacySkills = Array.isArray(data.skills) ? data.skills : [];
      setSkillsValue({
        skills: canonicalSkills.length > 0 ? canonicalSkills : legacySkills,
      });

      const prefs = ((data.workerProfile as Record<string, unknown> | undefined)?.preferences || {}) as Record<string, unknown>;
      const hasPersistedScheduleOptions = Object.prototype.hasOwnProperty.call(
        prefs,
        'scheduleIntentOptions',
      );
      const persistedScheduleOptions = (Array.isArray(prefs.scheduleIntentOptions) ? prefs.scheduleIntentOptions : [])
        .map((v) => String(v || '').toLowerCase())
        .filter((v): v is ScheduleIntentOption => v === 'full_time' || v === 'part_time' || v === 'gig');
      if (hasPersistedScheduleOptions) {
        setSelectedScheduleIntent(Array.from(new Set(persistedScheduleOptions)));
      } else {
        const persistedWorkType = String(prefs.desiredWorkType || '').toLowerCase();
        if (persistedWorkType === 'full_time' || persistedWorkType === 'part_time' || persistedWorkType === 'gig' || persistedWorkType === 'any') {
          if (persistedWorkType === 'any') {
            setSelectedScheduleIntent(ALL_SCHEDULE_OPTIONS);
          } else {
            setSelectedScheduleIntent([persistedWorkType]);
          }
        }
      }

      const persistedIndustriesRaw = prefs.targetIndustries;
      if (Array.isArray(persistedIndustriesRaw)) {
        const normalized = persistedIndustriesRaw
          .map((v) => String(v || '').toLowerCase())
          .filter((v): v is TargetIndustry => v === 'hospitality' || v === 'industrial');
        if (normalized.length > 0) {
          setTargetIndustries(normalized);
        }
      }

      const responseMap = (
        ((data.workerProfile as Record<string, unknown> | undefined)?.readiness as Record<string, unknown> | undefined)?.responses ||
        data.jobReadinessEngineResponses ||
        {}
      ) as Record<string, unknown>;
      const nextResponses: Record<string, string> = {};
      for (const [key, row] of Object.entries(responseMap)) {
        if (!row || typeof row !== 'object') continue;
        const value = String((row as Record<string, unknown>).value || '').trim();
        if (value) nextResponses[key] = value;
      }
      setResponses(nextResponses);
    });
    return () => unsub();
  }, [user?.uid]);

  const desiredWorkType = useMemo<DesiredWorkType>(() => {
    if (selectedScheduleIntent.length === 0) return 'any';
    if (selectedScheduleIntent.length > 1) return 'any';
    const single = selectedScheduleIntent[0];
    return single === 'full_time' || single === 'part_time' || single === 'gig' ? single : 'any';
  }, [selectedScheduleIntent]);

  const intentReady = targetIndustries.length > 0 && selectedScheduleIntent.length > 0;
  const TOTAL_WIZARD_STEPS = 7;
  const hasSkills = useMemo(() => {
    const workerProfile = ((userDoc?.workerProfile as Record<string, unknown> | undefined) || {}) as Record<string, unknown>;
    const canonicalSkills = Array.isArray(workerProfile.skills) ? workerProfile.skills : [];
    const legacySkills = Array.isArray(userDoc?.skills) ? userDoc.skills : [];
    return canonicalSkills.length > 0 || legacySkills.length > 0;
  }, [userDoc]);
  const hasSkillsInStepState = useMemo(() => {
    const rows = Array.isArray(skillsValue.skills) ? skillsValue.skills : [];
    return rows.length > 0;
  }, [skillsValue.skills]);
  const effectiveHasSkills = hasSkills || hasSkillsInStepState;
  const hasProfilePhoto = useMemo(() => {
    const photo = String(
      ((userDoc?.workerProfile as Record<string, unknown> | undefined)?.photoUrl as string | undefined) ||
      (userDoc?.avatar as string | undefined) ||
      ''
    ).trim();
    return photo.length > 0;
  }, [userDoc]);

  const includesHospitality = targetIndustries.includes('hospitality');
  const includesIndustrial = targetIndustries.includes('industrial');
  const showReadinessContent = intentReady
    && profilePhotoStepCompleted
    && resumeStepCompleted
    && workAuthorizationStepCompleted
    && certificationsStepCompleted
    && skillsStepCompleted;

  const currentWizardStep = useMemo(() => {
    if (!hideIntentBlock) {
      return targetIndustries.length === 0 ? 1 : 2;
    }
    if (showProfilePhotoStep) return 3;
    if (showResumeStep) return 4;
    if (showWorkAuthorizationStep) return 5;
    if (showCertificationsStep) return 6;
    if (showSkillsStep) return 7;
    if (showReadinessContent) return TOTAL_WIZARD_STEPS;
    return 1;
  }, [
    hideIntentBlock,
    showProfilePhotoStep,
    showResumeStep,
    showWorkAuthorizationStep,
    showCertificationsStep,
    showSkillsStep,
    showReadinessContent,
    targetIndustries.length,
  ]);

  useEffect(() => {
    const normalizedLaunchStep: HomeReadinessLaunchStep =
      launchStep === 'education' || launchStep === 'work_experience'
        ? 'start'
        : launchStep;

    if (normalizedLaunchStep === 'start') {
      launchContextAppliedRef.current = false;
      return;
    }
    if (loadingUser) return;
    if (launchContextAppliedRef.current) return;

    launchContextAppliedRef.current = true;
    transitionTriggeredRef.current = true;

    if (targetIndustries.length === 0) setTargetIndustries(['hospitality']);
    if (selectedScheduleIntent.length === 0) setSelectedScheduleIntent(['gig']);
    setHideIntentBlock(true);
    setShowIntentReadyTransition(false);
    setShowEmergencyContactStep(false);
    setShowPostWorkAuthorizationHeadline(false);
    setShowPostCertificationsHeadline(false);
    setShowPostSkillsHeadline(false);

    if (normalizedLaunchStep === 'resume') {
      setShowProfilePhotoStep(false);
      setProfilePhotoStepCompleted(true);
      setShowResumeStep(true);
      setResumeStepCompleted(false);
      setShowEducationStep(false);
      setEducationStepCompleted(false);
      setShowWorkAuthorizationStep(false);
      setWorkAuthorizationStepCompleted(false);
      setShowCertificationsStep(false);
      setCertificationsStepCompleted(false);
      setShowSkillsStep(false);
      setSkillsStepCompleted(false);
      setShowWorkExperienceStep(false);
      setWorkStepCompleted(false);
      return;
    }

    if (normalizedLaunchStep === 'work_authorization') {
      setShowProfilePhotoStep(false);
      setProfilePhotoStepCompleted(true);
      setShowResumeStep(false);
      setResumeStepCompleted(true);
      setShowEducationStep(false);
      setEducationStepCompleted(true);
      setShowWorkAuthorizationStep(true);
      setWorkAuthorizationSubstep('authorized');
      setWorkAuthorizationStepCompleted(false);
      setShowCertificationsStep(false);
      setCertificationsStepCompleted(false);
      setShowSkillsStep(false);
      setSkillsStepCompleted(false);
      setShowWorkExperienceStep(false);
      setWorkStepCompleted(false);
      return;
    }

    if (normalizedLaunchStep === 'certifications') {
      setShowProfilePhotoStep(false);
      setProfilePhotoStepCompleted(true);
      setShowResumeStep(false);
      setResumeStepCompleted(true);
      setShowEducationStep(false);
      setEducationStepCompleted(true);
      setShowWorkAuthorizationStep(false);
      setWorkAuthorizationStepCompleted(true);
      setShowCertificationsStep(true);
      setCertificationsStepCompleted(false);
      setShowSkillsStep(false);
      setSkillsStepCompleted(false);
      setShowWorkExperienceStep(false);
      setWorkStepCompleted(false);
      return;
    }

    if (normalizedLaunchStep === 'skills') {
      setShowProfilePhotoStep(false);
      setProfilePhotoStepCompleted(true);
      setShowResumeStep(false);
      setResumeStepCompleted(true);
      setShowEducationStep(false);
      setEducationStepCompleted(true);
      setShowWorkAuthorizationStep(false);
      setWorkAuthorizationStepCompleted(true);
      setShowCertificationsStep(false);
      setCertificationsStepCompleted(true);
      setShowSkillsStep(true);
      setSkillsStepCompleted(false);
      setShowWorkExperienceStep(false);
      setWorkStepCompleted(false);
      return;
    }

    if (normalizedLaunchStep === 'profile_photo') {
      setShowProfilePhotoStep(true);
      setProfilePhotoStepCompleted(false);
      setShowResumeStep(false);
      setResumeStepCompleted(false);
      setShowEducationStep(false);
      setEducationStepCompleted(false);
      setShowWorkAuthorizationStep(false);
      setWorkAuthorizationStepCompleted(false);
      setShowCertificationsStep(false);
      setCertificationsStepCompleted(false);
      setShowSkillsStep(false);
      setSkillsStepCompleted(false);
      setShowWorkExperienceStep(false);
      setWorkStepCompleted(false);
    }
  }, [
    launchStep,
    loadingUser,
    selectedScheduleIntent.length,
    targetIndustries.length,
  ]);

  const startPostResumeSequence = useCallback(() => {
    if (postResumeToEducationTimerRef.current) window.clearTimeout(postResumeToEducationTimerRef.current);
    postResumeToEducationTimerRef.current = window.setTimeout(() => {
      setShowWorkAuthorizationStep(true);
      setWorkAuthorizationStepCompleted(false);
    }, 250);
  }, []);

  const persistWorkAuthorization = useCallback(async (next: { workAuthorized: boolean | 'unsure'; requireSponsorship: boolean | 'unsure' }) => {
    if (!user?.uid) return;
    const attestation = {
      authorizedToWorkUS: next.workAuthorized === 'unsure' ? null : next.workAuthorized,
      requireSponsorship: next.requireSponsorship === 'unsure' ? null : next.requireSponsorship,
      attestedAt: serverTimestamp(),
      uncertain:
        next.workAuthorized === 'unsure' || next.requireSponsorship === 'unsure',
    };
    const canDerive =
      typeof attestation.authorizedToWorkUS === 'boolean' &&
      typeof attestation.requireSponsorship === 'boolean';
    const workEligibility = canDerive
      ? deriveWorkEligibilityFromAttestation(attestation as WorkEligibilityAttestation)
      : null;
    await updateDoc(doc(db, 'users', user.uid), {
      workEligibilityAttestation: attestation,
      ...(workEligibility !== null ? { workEligibility } : {}),
      ...(attestation.requireSponsorship !== null ? { requireSponsorship: attestation.requireSponsorship } : {}),
      updatedAt: serverTimestamp(),
    });
  }, [user?.uid]);

  const advanceFromSkills = useCallback(() => {
    setShowSkillsStep(false);
    setSkillsStepCompleted(true);
  }, []);

  const uploadCertFile = useCallback(async (key: CertPromptKey, file: File) => {
    if (!user?.uid) return;
    try {
      setCertUploadError(null);
      setCertUploadingKey(key);
      const certNameByKey: Record<CertPromptKey, string> = {
        food_handler: 'Food Handler',
        alcohol: 'State Alcohol Certification',
        forklift: 'Forklift Certification',
        other: otherCredentialKind.trim() || 'Other Credential',
      };
      const baseCertName = certNameByKey[key];
      const certName = key === 'forklift' && forkliftTypeDetail.trim()
        ? `${baseCertName} (${forkliftTypeDetail.trim()})`
        : baseCertName;
      const certSlug = certName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const path = `users/${user.uid}/certifications/${certSlug}/${Date.now()}-${file.name}`;
      const fileRef = ref(storage, path);
      await uploadBytes(fileRef, file);
      const fileUrl = await getDownloadURL(fileRef);
      const existing = Array.isArray(certificationsValue.certifications)
        ? certificationsValue.certifications as Record<string, unknown>[]
        : [];
      const entry: Record<string, unknown> = {
        name: certName,
        fileName: file.name,
        fileUrl,
        uploadedAt: new Date(),
        source: 'job_readiness',
      };
      const updated = [...existing, entry];
      setCertificationsValue((prev) => ({ ...prev, certifications: updated }));
      await updateDoc(doc(db, 'users', user.uid), {
        certifications: updated,
        'workerProfile.credentials.certifications': updated,
        updatedAt: serverTimestamp(),
      });
      setCertUploadDone((prev) => ({ ...prev, [key]: true }));
      setCertUploadSkipped((prev) => ({ ...prev, [key]: false }));
    } catch (error) {
      console.error('Failed to upload certification file:', error);
      setCertUploadError(t('jobReadiness.uploadCertError'));
    } finally {
      setCertUploadingKey(null);
    }
  }, [certificationsValue.certifications, forkliftTypeDetail, otherCredentialKind, t, user?.uid]);

  const advanceToNextStep = useCallback(() => {
    if (!profilePhotoStepCompleted) {
      if (hasProfilePhoto) {
        setShowProfilePhotoStep(false);
        setProfilePhotoStepCompleted(true);
        setShowResumeStep(true);
        setResumeGateChoice('unknown');
        setResumeStepCompleted(false);
        setShowEducationStep(false);
        setEducationStepCompleted(false);
        setShowWorkExperienceStep(false);
        setShowWorkAuthorizationStep(false);
        setShowCertificationsStep(false);
        setShowSkillsStep(false);
        setShowPostSkillsHeadline(false);
        setShowPostCertificationsHeadline(false);
        setShowPostWorkAuthorizationHeadline(false);
        setShowEmergencyContactStep(false);
        setEmergencyContactStepCompleted(false);
        setWorkAuthorizationStepCompleted(false);
        setCertificationsStepCompleted(false);
        setSkillsStepCompleted(false);
        setWorkStepCompleted(false);
        return;
      }
      setShowProfilePhotoStep(true);
      setProfilePhotoStepCompleted(false);
      setShowResumeStep(false);
      setResumeGateChoice('unknown');
      setShowEducationStep(false);
      setShowWorkExperienceStep(false);
      setShowWorkAuthorizationStep(false);
      setShowCertificationsStep(false);
      setShowSkillsStep(false);
      setShowPostSkillsHeadline(false);
      setShowPostCertificationsHeadline(false);
      setShowPostWorkAuthorizationHeadline(false);
      setShowEmergencyContactStep(false);
      setResumeStepCompleted(false);
      setEducationStepCompleted(false);
      setEmergencyContactStepCompleted(false);
      setWorkAuthorizationStepCompleted(false);
      setCertificationsStepCompleted(false);
      setSkillsStepCompleted(false);
      setWorkStepCompleted(false);
      return;
    }
    if (!resumeStepCompleted) {
      setShowResumeStep(true);
      setResumeGateChoice('unknown');
      setShowEducationStep(false);
      setShowWorkExperienceStep(false);
      setShowWorkAuthorizationStep(false);
      setShowCertificationsStep(false);
      setShowSkillsStep(false);
      setShowPostSkillsHeadline(false);
      setShowPostCertificationsHeadline(false);
      setShowPostWorkAuthorizationHeadline(false);
      setShowEmergencyContactStep(false);
      setResumeStepCompleted(false);
      setEducationStepCompleted(false);
      setEmergencyContactStepCompleted(false);
      setWorkAuthorizationStepCompleted(false);
      setCertificationsStepCompleted(false);
      setSkillsStepCompleted(false);
      setWorkStepCompleted(false);
      return;
    }
    if (!workAuthorizationStepCompleted) {
      setShowResumeStep(false);
      setShowWorkAuthorizationStep(true);
      setShowCertificationsStep(false);
      setShowSkillsStep(false);
      setWorkAuthorizationSubstep('authorized');
      return;
    }
    if (!certificationsStepCompleted) {
      setShowWorkAuthorizationStep(false);
      setShowCertificationsStep(true);
      setShowSkillsStep(false);
      return;
    }
    if (!skillsStepCompleted) {
      setShowCertificationsStep(false);
      setShowSkillsStep(true);
      return;
    }
  }, [
    certificationsStepCompleted,
    hasProfilePhoto,
    profilePhotoStepCompleted,
    resumeStepCompleted,
    skillsStepCompleted,
    workAuthorizationStepCompleted,
  ]);

  useEffect(() => {
    if (!showResumeStep) return undefined;
    if (resumeAdvanceTimerRef.current) window.clearTimeout(resumeAdvanceTimerRef.current);
    if (resumeGateChoice !== 'yes') return undefined;
    if (resumeParsingStatus !== 'completed') return undefined;
    const startedAt = resumeProcessingStartMs ?? Date.now();
    const elapsed = Date.now() - startedAt;
    const delay = Math.max(0, 10000 - elapsed);
    resumeAdvanceTimerRef.current = window.setTimeout(() => {
      setResumeProcessingActive(false);
      setShowResumeStep(false);
      setResumeStepCompleted(true);
      startPostResumeSequence();
    }, delay);
    return () => {
      if (resumeAdvanceTimerRef.current) {
        window.clearTimeout(resumeAdvanceTimerRef.current);
      }
    };
  }, [resumeGateChoice, resumeParsingStatus, resumeProcessingStartMs, showResumeStep, startPostResumeSequence]);

  const workAuthorizationComplete = workAuthorizationValue.workAuthorized !== null
    && workAuthorizationValue.requireSponsorship !== null;

  useEffect(() => {
    if (!showCertificationsStep) return;
    setShowSkillsStep(false);
    setShowPostCertificationsHeadline(false);
    setCertificationsIntent('unknown');
    setCertPromptAnswers({
      food_handler: null,
      alcohol: null,
      forklift: null,
      other: null,
    });
    setCertUploadDone({
      food_handler: false,
      alcohol: false,
      forklift: false,
      other: false,
    });
    setCertUploadSkipped({
      food_handler: false,
      alcohol: false,
      forklift: false,
      other: false,
    });
    setForkliftTypeDetail('');
    setOtherCredentialKind('');
    setCertUploadError(null);
    setCertUploadingKey(null);
  }, [showCertificationsStep]);

  useEffect(() => {
    if (!showWorkAuthorizationStep) return;
    setWorkAuthorizationSubstep('authorized');
  }, [showWorkAuthorizationStep]);

  useEffect(() => {
    if (!intentReady) {
      transitionTriggeredRef.current = false;
      setShowIntentReadyTransition(false);
      setHideIntentBlock(false);
      setShowProfilePhotoStep(false);
      setShowResumeStep(false);
      setResumeGateChoice('unknown');
      setShowEducationStep(false);
      setShowWorkExperienceStep(false);
      setShowWorkAuthorizationStep(false);
      setShowCertificationsStep(false);
      setShowSkillsStep(false);
      setShowPostWorkAuthorizationHeadline(false);
      setShowPostCertificationsHeadline(false);
      setShowEmergencyContactStep(false);
      setResumeStepCompleted(false);
      setProfilePhotoStepCompleted(false);
      setEducationStepCompleted(false);
      setEmergencyContactStepCompleted(false);
      setWorkAuthorizationStepCompleted(false);
      setCertificationsStepCompleted(false);
      setSkillsStepCompleted(false);
      setWorkStepCompleted(false);
      setCertPromptAnswers({
        food_handler: null,
        alcohol: null,
        forklift: null,
        other: null,
      });
      setCertUploadDone({
        food_handler: false,
        alcohol: false,
        forklift: false,
        other: false,
      });
      setCertUploadSkipped({
        food_handler: false,
        alcohol: false,
        forklift: false,
        other: false,
      });
      setForkliftTypeDetail('');
      setOtherCredentialKind('');
      setCertUploadError(null);
      setCertUploadingKey(null);
      setResumeParsingStatus('idle');
      setResumeProcessingActive(false);
      setResumeProcessingStartMs(null);
      if (scheduleSettledTimerRef.current) window.clearTimeout(scheduleSettledTimerRef.current);
      if (transitionFadeOutTimerRef.current) window.clearTimeout(transitionFadeOutTimerRef.current);
      if (transitionShowEducationTimerRef.current) window.clearTimeout(transitionShowEducationTimerRef.current);
      if (postResumeToEducationTimerRef.current) window.clearTimeout(postResumeToEducationTimerRef.current);
      if (postEducationToEmergencyTimerRef.current) window.clearTimeout(postEducationToEmergencyTimerRef.current);
      if (emergencyContactAdvanceTimerRef.current) window.clearTimeout(emergencyContactAdvanceTimerRef.current);
      if (workAuthorizationAdvanceTimerRef.current) window.clearTimeout(workAuthorizationAdvanceTimerRef.current);
      if (postWorkAuthorizationHeadlineHideTimerRef.current) {
        window.clearTimeout(postWorkAuthorizationHeadlineHideTimerRef.current);
      }
      if (postWorkAuthorizationToCertificationsTimerRef.current) {
        window.clearTimeout(postWorkAuthorizationToCertificationsTimerRef.current);
      }
      if (postCertificationsHeadlineHideTimerRef.current) {
        window.clearTimeout(postCertificationsHeadlineHideTimerRef.current);
      }
      if (postCertificationsToSkillsTimerRef.current) {
        window.clearTimeout(postCertificationsToSkillsTimerRef.current);
      }
      if (postSkillsHeadlineHideTimerRef.current) {
        window.clearTimeout(postSkillsHeadlineHideTimerRef.current);
      }
      if (postSkillsToWorkTimerRef.current) {
        window.clearTimeout(postSkillsToWorkTimerRef.current);
      }
      if (resumeAdvanceTimerRef.current) window.clearTimeout(resumeAdvanceTimerRef.current);
      return undefined;
    }

    if (transitionTriggeredRef.current) return undefined;
    if (scheduleSettledTimerRef.current) window.clearTimeout(scheduleSettledTimerRef.current);
    scheduleSettledTimerRef.current = window.setTimeout(() => {
      transitionTriggeredRef.current = true;
      setShowIntentReadyTransition(true);
      transitionFadeOutTimerRef.current = window.setTimeout(() => {
        setHideIntentBlock(true);
        setShowIntentReadyTransition(false);
      }, 1000);
      transitionShowEducationTimerRef.current = window.setTimeout(() => {
        advanceToNextStep();
      }, 1300);
    }, 750);

    return () => {
      if (scheduleSettledTimerRef.current) window.clearTimeout(scheduleSettledTimerRef.current);
    };
  }, [advanceToNextStep, intentReady, selectedScheduleIntent, targetIndustries]);

  useEffect(() => () => {
    if (scheduleSettledTimerRef.current) window.clearTimeout(scheduleSettledTimerRef.current);
    if (transitionFadeOutTimerRef.current) window.clearTimeout(transitionFadeOutTimerRef.current);
    if (transitionShowEducationTimerRef.current) window.clearTimeout(transitionShowEducationTimerRef.current);
    if (postResumeToEducationTimerRef.current) window.clearTimeout(postResumeToEducationTimerRef.current);
    if (postEducationToEmergencyTimerRef.current) window.clearTimeout(postEducationToEmergencyTimerRef.current);
    if (emergencyContactAdvanceTimerRef.current) window.clearTimeout(emergencyContactAdvanceTimerRef.current);
    if (workAuthorizationAdvanceTimerRef.current) window.clearTimeout(workAuthorizationAdvanceTimerRef.current);
    if (postWorkAuthorizationHeadlineHideTimerRef.current) {
      window.clearTimeout(postWorkAuthorizationHeadlineHideTimerRef.current);
    }
    if (postWorkAuthorizationToCertificationsTimerRef.current) {
      window.clearTimeout(postWorkAuthorizationToCertificationsTimerRef.current);
    }
    if (postCertificationsHeadlineHideTimerRef.current) {
      window.clearTimeout(postCertificationsHeadlineHideTimerRef.current);
    }
    if (postCertificationsToSkillsTimerRef.current) {
      window.clearTimeout(postCertificationsToSkillsTimerRef.current);
    }
    if (postSkillsHeadlineHideTimerRef.current) {
      window.clearTimeout(postSkillsHeadlineHideTimerRef.current);
    }
    if (postSkillsToWorkTimerRef.current) {
      window.clearTimeout(postSkillsToWorkTimerRef.current);
    }
    if (resumeAdvanceTimerRef.current) window.clearTimeout(resumeAdvanceTimerRef.current);
  }, []);

  const handleResumeParsingStatusChange = useCallback((status: 'idle' | 'uploading' | 'parsing' | 'completed' | 'error') => {
    setResumeParsingStatus(status);
    if ((status === 'uploading' || status === 'parsing') && !resumeProcessingStartMs) {
      setResumeProcessingStartMs(Date.now());
      setResumeProcessingActive(true);
    }
    if (status === 'error') {
      setResumeProcessingActive(false);
    }
  }, [resumeProcessingStartMs]);

  const engine = useMemo(
    () =>
      buildJobReadinessEngine({
        userDoc,
        desiredWorkType,
        targetIndustries,
        responses,
      }),
    [userDoc, desiredWorkType, targetIndustries, responses]
  );
  const persistIntent = useCallback(
    async (
      nextWorkType: DesiredWorkType,
      nextIndustries: TargetIndustry[],
      nextScheduleOptions: ScheduleIntentOption[],
    ) => {
      if (!user?.uid) return;
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(
        userRef,
        buildReadinessIntentWritePatch(nextWorkType, nextIndustries, nextScheduleOptions),
      );
    },
    [user?.uid]
  );

  const persistEngineResponse = useCallback(
    async (requirementId: string, value: string) => {
      if (!user?.uid) return;
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, buildReadinessResponseWritePatch(requirementId, value));
    },
    [user?.uid]
  );

  const handleIndustryToggle = useCallback(async (industry: TargetIndustry | 'both') => {
    const normalized: TargetIndustry[] = (() => {
      if (industry === 'both') {
        const allSelected = targetIndustries.length === 2
          && targetIndustries.includes('hospitality')
          && targetIndustries.includes('industrial');
        return allSelected ? [] : ['hospitality', 'industrial'];
      }
      const nextSet = targetIndustries.includes(industry)
        ? targetIndustries.filter((i) => i !== industry)
        : [...targetIndustries, industry];
      return Array.from(new Set(nextSet));
    })();
    setTargetIndustries(normalized);
    await persistIntent(desiredWorkType, normalized, selectedScheduleIntent);
  }, [desiredWorkType, persistIntent, selectedScheduleIntent, targetIndustries]);

  const handleScheduleIntentToggle = useCallback(async (option: ScheduleIntentOption) => {
    const nextSelection: ScheduleIntentOption[] = (() => {
      const hasOption = selectedScheduleIntent.includes(option);
      if (hasOption) {
        return selectedScheduleIntent.filter((v) => v !== option);
      }
      return Array.from(new Set([...selectedScheduleIntent, option]));
    })();

    setSelectedScheduleIntent(nextSelection);
    const nextDesiredWorkType: DesiredWorkType =
      nextSelection.length === 0 || nextSelection.length > 1
        ? 'any'
        : (nextSelection[0] as DesiredWorkType);
    await persistIntent(nextDesiredWorkType, targetIndustries, nextSelection);
  }, [persistIntent, selectedScheduleIntent, targetIndustries]);

  const handleCardAction = useCallback(
    async (value: string) => {
      const card = engine.nextCard;
      if (!card) return;
      if (value === 'upload_photo') {
        photoInputRef.current?.click();
        return;
      }
      if (value === 'webcam_capture') {
        cameraInputRef.current?.click();
        return;
      }
      if (value === 'open_profile') {
        const hash = card.profileSectionId ? `#${card.profileSectionId}` : '';
        navigate(`/c1/workers/profile?from=readiness${hash}`);
      }
      if (value === 'open_resource') {
        if (card.profileSectionId) {
          navigate(`/c1/workers/profile?from=readiness#${card.profileSectionId}`);
        }
      }

      if (card.requirementId && ['yes', 'no', 'done', 'continue', 'open_profile', 'open_resource'].includes(value)) {
        const isPhotoCard = card.requirementId === 'profile_photo';
        if (isPhotoCard && (value === 'open_profile' || value === 'open_resource')) {
          return;
        }
        const persistedValue =
          value === 'done' || value === 'continue' || value === 'open_profile' || value === 'open_resource'
            ? 'completed'
            : value;
        setIsCardTransitioning(true);
        await persistEngineResponse(card.requirementId, persistedValue);
        setResponses((prev) => ({ ...prev, [card.requirementId]: persistedValue }));
        window.setTimeout(() => setIsCardTransitioning(false), 180);
      }
    },
    [engine.nextCard, navigate, persistEngineResponse]
  );

  const uploadProfilePhoto = useCallback(async (file: File) => {
    if (!user?.uid) return;
    if (!file.type.startsWith('image/')) {
      setPhotoUploadError(t('jobReadiness.chooseImageFile'));
      return;
    }

    try {
      setPhotoUploadError(null);
      setPhotoUploading(true);
      const storageRef = ref(storage, `avatars/${user.uid}.jpg`);
      await uploadBytes(storageRef, file, { contentType: file.type || 'image/jpeg' });
      const photoUrl = await getDownloadURL(storageRef);
      await updateDoc(doc(db, 'users', user.uid), {
        avatar: photoUrl,
        'workerProfile.photoUrl': photoUrl,
        updatedAt: serverTimestamp(),
      });
      await persistEngineResponse('profile_photo', 'completed');
      setResponses((prev) => ({ ...prev, profile_photo: 'completed' }));
      if (showProfilePhotoStep) {
        setShowProfilePhotoStep(false);
        setProfilePhotoStepCompleted(true);
        setShowResumeStep(true);
        setResumeStepCompleted(false);
        setResumeGateChoice('unknown');
      }
    } catch (error) {
      console.error('Failed to upload profile photo from readiness card:', error);
      setPhotoUploadError(t('jobReadiness.uploadPhotoError'));
    } finally {
      setPhotoUploading(false);
    }
  }, [persistEngineResponse, showProfilePhotoStep, t, user?.uid]);

  const handlePhotoInputChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await uploadProfilePhoto(file);
    event.target.value = '';
  }, [uploadProfilePhoto]);

  if (!user?.uid || loadingUser) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 700, mx: 'auto', px: 1, py: 2 }}>
      <Stack spacing={2.5}>
        <Typography variant="h4" sx={{ fontWeight: 800 }}>
          {t('jobReadiness.letsHelpYouGetHired')}
        </Typography>
        <Box>
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.75 }}>
            <Typography variant="caption" color="text.secondary">
              {t('jobReadiness.stepOf', { current: currentWizardStep, total: TOTAL_WIZARD_STEPS })}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {Math.round((currentWizardStep / TOTAL_WIZARD_STEPS) * 100)}%
            </Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={(currentWizardStep / TOTAL_WIZARD_STEPS) * 100}
            sx={{ height: 8, borderRadius: 2 }}
          />
        </Box>
        <Fade in={!hideIntentBlock} timeout={300}>
          <Stack spacing={2.5} sx={{ display: hideIntentBlock ? 'none' : 'flex' }}>
            {targetIndustries.length === 0 && (
              <Stack spacing={1.25}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  {t('jobReadiness.whatTypeOfWork')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('jobReadiness.selectOneOrMore')}
                </Typography>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  <Button
                    size="small"
                    variant={targetIndustries.includes('hospitality') ? 'contained' : 'outlined'}
                    color="primary"
                    onClick={() => handleIndustryToggle('hospitality')}
                  >
                    {t('jobReadiness.hospitality')}
                  </Button>
                  <Button
                    size="small"
                    variant={targetIndustries.includes('industrial') ? 'contained' : 'outlined'}
                    color="primary"
                    onClick={() => handleIndustryToggle('industrial')}
                  >
                    {t('jobReadiness.industrial')}
                  </Button>
                  <Button
                    size="small"
                    variant={
                      targetIndustries.includes('hospitality') && targetIndustries.includes('industrial')
                        ? 'contained'
                        : 'outlined'
                    }
                    color="primary"
                    onClick={() => handleIndustryToggle('both')}
                  >
                    {t('jobReadiness.both')}
                  </Button>
                </Stack>
              </Stack>
            )}

            {targetIndustries.length > 0 && !intentReady && (
              <Stack spacing={1.25}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  {t('jobReadiness.whatSchedule')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('jobReadiness.selectAllThatApply')}
                </Typography>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  <Button
                    size="small"
                    variant={selectedScheduleIntent.includes('full_time') ? 'contained' : 'outlined'}
                    color="primary"
                    onClick={() => handleScheduleIntentToggle('full_time')}
                  >
                    {t('jobReadiness.fullTime')}
                  </Button>
                  <Button
                    size="small"
                    variant={selectedScheduleIntent.includes('part_time') ? 'contained' : 'outlined'}
                    color="primary"
                    onClick={() => handleScheduleIntentToggle('part_time')}
                  >
                    {t('jobReadiness.partTime')}
                  </Button>
                  <Button
                    size="small"
                    variant={selectedScheduleIntent.includes('gig') ? 'contained' : 'outlined'}
                    color="primary"
                    onClick={() => handleScheduleIntentToggle('gig')}
                  >
                    {t('jobReadiness.gigWork')}
                  </Button>
                </Stack>
              </Stack>
            )}

            {intentReady && showIntentReadyTransition && (
              <Fade in timeout={250}>
                <Typography variant="body2" color="primary.main" sx={{ fontWeight: 700 }}>
                  {t('jobReadiness.greatLetsGetReady')}
                </Typography>
              </Fade>
            )}
          </Stack>
        </Fade>

        {showProfilePhotoStep && (
          <Fade in timeout={280}>
            <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
                  {t('jobReadiness.addProfilePhoto')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  {t('jobReadiness.photoHelps')}
                </Typography>
                {hasProfilePhoto && (
                  <Typography variant="caption" color="success.main" sx={{ display: 'block', mb: 1.5, fontWeight: 700 }}>
                    {t('jobReadiness.photoAlreadySet')}
                  </Typography>
                )}
                {photoUploadError && (
                  <Typography variant="caption" color="error.main" sx={{ display: 'block', mb: 1 }}>
                    {photoUploadError}
                  </Typography>
                )}
                {photoUploading && (
                  <Box sx={{ mt: 1, mb: 1.5 }}>
                    <LinearProgress />
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                      {t('jobReadiness.uploadingProfilePhoto')}
                    </Typography>
                  </Box>
                )}
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1.5 }}>
                  <Button
                    variant="contained"
                    size="small"
                    onClick={() => photoInputRef.current?.click()}
                    disabled={photoUploading}
                  >
                    {t('apply.uploadPhoto')}
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={photoUploading}
                  >
                    {t('apply.takePhoto')}
                  </Button>
                </Stack>
                <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
                  <Button
                    variant="text"
                    size="small"
                    onClick={() => {
                      setShowProfilePhotoStep(false);
                      setProfilePhotoStepCompleted(true);
                      setShowResumeStep(true);
                      setResumeStepCompleted(false);
                      setResumeGateChoice('unknown');
                    }}
                  >
                    {t('apply.skipForNow')}
                  </Button>
                  <Button
                    variant="contained"
                    size="small"
                    onClick={() => {
                      setShowProfilePhotoStep(false);
                      setProfilePhotoStepCompleted(true);
                      setShowResumeStep(true);
                      setResumeStepCompleted(false);
                      setResumeGateChoice('unknown');
                    }}
                    disabled={!hasProfilePhoto && !responses.profile_photo}
                  >
                    {t('common.next')}
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          </Fade>
        )}

        {showResumeStep && (
          <Fade in timeout={280}>
            <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
                  {t('jobReadiness.resumePromptTitle')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  {t('jobReadiness.resumePromptSubtitle')}
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1.5 }}>
                  <Button
                    size="small"
                    variant={resumeGateChoice === 'yes' ? 'contained' : 'outlined'}
                    onClick={() => setResumeGateChoice('yes')}
                  >
                    {t('jobReadiness.yesUploadResume')}
                  </Button>
                  <Button
                    size="small"
                    variant={resumeGateChoice === 'no' ? 'contained' : 'outlined'}
                    onClick={() => setResumeGateChoice('no')}
                  >
                    {t('jobReadiness.noContinueWithoutResume')}
                  </Button>
                </Stack>
                {resumeGateChoice === 'yes' && (
                  <ResumeUpload
                    userId={user.uid}
                    tenantId={String(userDoc?.tenantId || '') || undefined}
                    onParsingStatusChange={handleResumeParsingStatusChange}
                    onResumeParsed={() => {
                      setResumeParsingStatus('completed');
                    }}
                    hideTitle
                    compact
                    hideCaptureActions
                  />
                )}
                {resumeProcessingActive && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="body2" color="primary.main" sx={{ fontWeight: 700, mb: 0.75 }}>
                      {t('jobReadiness.parsingResume')}
                    </Typography>
                    <LinearProgress />
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block' }}>
                      {t('jobReadiness.resumeTakesTenSeconds')}
                    </Typography>
                  </Box>
                )}
                <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1.5 }}>
                  {resumeGateChoice === 'no' && (
                    <Button
                      variant="contained"
                      size="small"
                      onClick={() => {
                        if (resumeAdvanceTimerRef.current) {
                          window.clearTimeout(resumeAdvanceTimerRef.current);
                        }
                        setResumeProcessingActive(false);
                        setShowResumeStep(false);
                        setResumeStepCompleted(true);
                        startPostResumeSequence();
                      }}
                    >
                      {t('common.next')}
                    </Button>
                  )}
                  <Button
                    variant="text"
                    size="small"
                    onClick={() => {
                      if (resumeAdvanceTimerRef.current) {
                        window.clearTimeout(resumeAdvanceTimerRef.current);
                      }
                      setResumeProcessingActive(false);
                      setShowResumeStep(false);
                      setResumeStepCompleted(true);
                      startPostResumeSequence();
                    }}
                  >
                    {t('apply.skipForNow')}
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          </Fade>
        )}

        {showWorkAuthorizationStep && (
          <Fade in timeout={280}>
            <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
                  {t('jobReadiness.workAuthorizationTitle')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {t('jobReadiness.workAuthorizationSubtitle')}
                </Typography>
                <Stack spacing={1.25}>
                  {workAuthorizationSubstep === 'authorized' ? (
                    <>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        {t('profile.authorizedToWork')}
                      </Typography>
                      <Stack direction="row" spacing={1}>
                        <Button
                          size="small"
                          variant={workAuthorizationValue.workAuthorized === true ? 'contained' : 'outlined'}
                          onClick={() => setWorkAuthorizationValue((prev) => ({ ...prev, workAuthorized: true }))}
                        >
                          {t('common.yes')}
                        </Button>
                        <Button
                          size="small"
                          variant={workAuthorizationValue.workAuthorized === false ? 'contained' : 'outlined'}
                          onClick={() => setWorkAuthorizationValue((prev) => ({ ...prev, workAuthorized: false }))}
                        >
                          {t('common.no')}
                        </Button>
                        <Button
                          size="small"
                          variant={workAuthorizationValue.workAuthorized === 'unsure' ? 'contained' : 'outlined'}
                          onClick={() => setWorkAuthorizationValue((prev) => ({ ...prev, workAuthorized: 'unsure' }))}
                        >
                          {t('jobReadiness.notSure')}
                        </Button>
                      </Stack>
                    </>
                  ) : (
                    <>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        {t('profile.requireSponsorship')}
                      </Typography>
                      <Stack direction="row" spacing={1}>
                        <Button
                          size="small"
                          variant={workAuthorizationValue.requireSponsorship === true ? 'contained' : 'outlined'}
                          onClick={() => setWorkAuthorizationValue((prev) => ({ ...prev, requireSponsorship: true }))}
                        >
                          {t('common.yes')}
                        </Button>
                        <Button
                          size="small"
                          variant={workAuthorizationValue.requireSponsorship === false ? 'contained' : 'outlined'}
                          onClick={() => setWorkAuthorizationValue((prev) => ({ ...prev, requireSponsorship: false }))}
                        >
                          {t('common.no')}
                        </Button>
                        <Button
                          size="small"
                          variant={workAuthorizationValue.requireSponsorship === 'unsure' ? 'contained' : 'outlined'}
                          onClick={() => setWorkAuthorizationValue((prev) => ({ ...prev, requireSponsorship: 'unsure' }))}
                        >
                          {t('jobReadiness.notSure')}
                        </Button>
                      </Stack>
                    </>
                  )}
                </Stack>
                <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
                  <Button
                    variant="contained"
                    size="small"
                    disabled={workAuthorizationSubstep === 'authorized'
                      ? workAuthorizationValue.workAuthorized === null
                      : workAuthorizationValue.requireSponsorship === null}
                    onClick={() => {
                      if (workAuthorizationSubstep === 'authorized') {
                        setWorkAuthorizationSubstep('sponsorship');
                        return;
                      }
                      persistWorkAuthorization({
                        workAuthorized: workAuthorizationValue.workAuthorized ?? 'unsure',
                        requireSponsorship: workAuthorizationValue.requireSponsorship ?? 'unsure',
                      });
                      setShowWorkAuthorizationStep(false);
                      setWorkAuthorizationStepCompleted(true);
                      setShowCertificationsStep(true);
                    }}
                  >
                    {workAuthorizationSubstep === 'authorized' ? t('common.next') : t('jobReadiness.saveAndContinue')}
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          </Fade>
        )}

        {showCertificationsStep && (
          <Fade in timeout={280}>
            <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
                  {t('profile.certifications')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {includesHospitality && includesIndustrial
                    ? t('jobReadiness.certPromptBoth')
                    : includesHospitality
                      ? t('jobReadiness.certPromptHospitality')
                      : t('jobReadiness.certPromptIndustrial')}
                </Typography>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                  {t('jobReadiness.uploadCertNowQuestion')}
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1.5 }}>
                  <Button
                    size="small"
                    variant={certificationsIntent === 'yes' ? 'contained' : 'outlined'}
                    onClick={() => setCertificationsIntent('yes')}
                  >
                    {t('common.yes')}
                  </Button>
                  <Button
                    size="small"
                    variant={certificationsIntent === 'no' ? 'contained' : 'outlined'}
                    onClick={() => setCertificationsIntent('no')}
                  >
                    {t('common.no')}
                  </Button>
                </Stack>
                {certificationsIntent === 'yes' && (
                  <Paper
                    variant="outlined"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={async (event) => {
                      event.preventDefault();
                      const file = event.dataTransfer.files?.[0];
                      if (!file) return;
                      await uploadCertFile(includesHospitality ? 'food_handler' : includesIndustrial ? 'forklift' : 'other', file);
                    }}
                    sx={{ p: 2, borderStyle: 'dashed' }}
                  >
                    <Typography variant="body2" sx={{ mb: 1 }}>
                      {t('jobReadiness.dragDropCert')}
                    </Typography>
                    <Button component="label" variant="outlined" size="small">
                      {t('jobReadiness.uploadCertification')}
                      <input
                        hidden
                        type="file"
                        onChange={async (event) => {
                          const file = event.target.files?.[0];
                          if (!file) return;
                          await uploadCertFile(includesHospitality ? 'food_handler' : includesIndustrial ? 'forklift' : 'other', file);
                          event.target.value = '';
                        }}
                      />
                    </Button>
                  </Paper>
                )}
                {certUploadError && (
                  <Typography variant="caption" color="error.main" sx={{ display: 'block', mt: 1 }}>
                    {certUploadError}
                  </Typography>
                )}
                {certUploadingKey && (
                  <Box sx={{ mt: 1 }}>
                    <LinearProgress />
                    <Typography variant="caption" color="text.secondary">
                      {t('jobReadiness.uploadingCertification')}
                    </Typography>
                  </Box>
                )}
                <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
                  <Button
                    variant="contained"
                    size="small"
                    disabled={certificationsIntent === 'unknown'}
                    onClick={() => {
                      setShowCertificationsStep(false);
                      setCertificationsStepCompleted(true);
                      setShowSkillsStep(true);
                    }}
                  >
                    {t('common.next')}
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          </Fade>
        )}

        {showSkillsStep && (
          <Fade in timeout={280}>
            <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'divider', boxShadow: 'none' }}>
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
                  {t('apply.stepSkills')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {t('jobReadiness.skillsSubtitle')}
                </Typography>
                <SkillsStep
                  value={skillsValue}
                  onChange={(next) => setSkillsValue(next)}
                  context="profile"
                />
                <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
                  <Button
                    variant="text"
                    size="small"
                    onClick={advanceFromSkills}
                  >
                    {t('apply.skipForNow')}
                  </Button>
                  <Button
                    variant="contained"
                    size="small"
                    disabled={!effectiveHasSkills}
                    onClick={advanceFromSkills}
                  >
                    {t('common.next')}
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          </Fade>
        )}


        {showReadinessContent && (
          <>
            {photoUploading && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={16} />
                <Typography variant="caption" color="text.secondary">
                  {t('jobReadiness.uploadingProfilePhoto')}
                </Typography>
              </Box>
            )}
            {photoUploadError && (
              <Typography variant="caption" color="error.main">
                {photoUploadError}
              </Typography>
            )}
            <Typography variant="body2" color="text.secondary">
              {engine.summary}
            </Typography>
            <Box>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.75 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  {t('jobReadiness.readinessScore', { percent: engine.readinessScorePercent })}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('jobReadiness.impactWeightedProgress')}
                </Typography>
              </Stack>
              <LinearProgress variant="determinate" value={engine.readinessScorePercent} sx={{ height: 9, borderRadius: 2 }} />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                {engine.readinessScoreSummary}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                {engine.unlockSummary}
              </Typography>
            </Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {engine.eligibilitySummary}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {engine.limitingSummary}
            </Typography>
            {engine.topLimitingFactors.length > 0 && (
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                {engine.topLimitingFactors.slice(0, 3).map((factor) => {
                  const state = getLifecycleStatePresentation(factor.state);
                  return (
                    <Chip
                      key={factor.requirementId}
                      size="small"
                      color={state.color}
                      variant="outlined"
                      label={`${factor.label}: ${state.label}`}
                    />
                  );
                })}
              </Stack>
            )}

            {engine.topActions.length > 0 && (
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                {engine.topActions.map((a) => (
                  <Chip key={a.requirementId} label={a.label} size="small" variant="outlined" />
                ))}
              </Stack>
            )}

            {engine.nextCard ? (
              <Fade in={!isCardTransitioning} key={engine.nextCard.id} timeout={200}>
                <Box>
                  <ReadinessEngineCard card={engine.nextCard} onAction={handleCardAction} />
                </Box>
              </Fade>
            ) : (
              <Box sx={{ p: 2, border: '1px dashed', borderColor: 'divider', borderRadius: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  {t('jobReadiness.allSetForNow')}
                </Typography>
              </Box>
            )}
          </>
        )}

        {showReadinessContent && (
          <Button variant="text" onClick={() => navigate('/c1/workers/profile')}>
            {t('jobReadiness.openFullProfile')}
          </Button>
        )}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handlePhotoInputChange}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={handlePhotoInputChange}
        />
      </Stack>
    </Box>
  );
};

export default JobReadinessFeed;
