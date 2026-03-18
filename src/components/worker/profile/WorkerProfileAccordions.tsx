/**
 * Worker Profile Accordions — editor-focused groups for worker data only.
 */

import React, { useState, useEffect } from 'react';
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Typography,
  Box,
  Chip,
  Stack,
  Button,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';

import { db } from '../../../firebase';
import WorkExperienceStep from '../../apply/steps/WorkExperienceStep';
import EducationStep from '../../apply/steps/EducationStep';
import QualificationsStep from '../../apply/steps/QualificationsStep';
import BioStep from '../../apply/steps/BioStep';
import ShiftPreferencesCard from '../../../pages/UserProfile/components/ShiftPreferencesCard';
import type { DesiredWorkType, TargetIndustry } from '../../../utils/jobReadinessOpportunityMap';
import { buildReadinessIntentWritePatch } from '../../../utils/workerReadinessWriteModel';
import ResumeUpload from '../../ResumeUpload';

const accordionSx = {
  '&:before': { display: 'none' },
  borderColor: 'divider',
  borderRadius: '8px !important',
  mb: 1,
  boxShadow: 'none',
  '& .MuiAccordionSummary-root': {
    transition: 'background-color 0.2s ease',
    '&:hover': { bgcolor: 'action.hover' },
  },
};

const summarySx = { '& .MuiAccordionSummary-content': { my: 1.5 } };
const detailsSx = { pt: 0, pb: 2, px: 2 };

export type WorkerProfileEditorSection =
  | 'work-preferences'
  | 'skills-experience'
  | 'certifications-documents';

// Backward-compatible alias for older imports.
export type ReadinessAccordionSection = WorkerProfileEditorSection;

type ScheduleIntentOption = 'full_time' | 'part_time' | 'gig';
const ALL_SCHEDULE_OPTIONS: ScheduleIntentOption[] = ['full_time', 'part_time', 'gig'];

type Props = {
  uid: string;
  expandedSection?: WorkerProfileEditorSection | false;
  onAccordionChange?: (section: WorkerProfileEditorSection | false) => void;
};

const WorkerProfileAccordions: React.FC<Props> = ({
  uid,
  expandedSection = false,
  onAccordionChange,
}) => {
  const [qualificationsData, setQualificationsData] = useState<Record<string, unknown>>({});
  const [bioData, setBioData] = useState<Record<string, unknown>>({});
  const [educationData, setEducationData] = useState<Record<string, unknown>>({});
  const [workExperienceData, setWorkExperienceData] = useState<Record<string, unknown>>({});
  const [targetIndustries, setTargetIndustries] = useState<TargetIndustry[]>([]);
  const [selectedScheduleIntent, setSelectedScheduleIntent] = useState<ScheduleIntentOption[]>([]);
  const [resumePresent, setResumePresent] = useState(false);
  const [tenantId, setTenantId] = useState<string | undefined>(undefined);
  const [requirementAttestations, setRequirementAttestations] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!uid) return;
    const userRef = doc(db, 'users', uid);
    const unsubscribe = onSnapshot(userRef, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setQualificationsData({
        skills: data?.skills || [],
        languages: data?.languages || [],
        workHistory: data?.workHistory || [],
        experienceSummary: data?.experienceSummary || '',
        bio: data?.bio || '',
      });
      setBioData({
        professionalBio: data?.professionalBio || data?.bio || '',
        bio: data?.bio || '',
      });
      const educationArray = Array.isArray(data?.education) ? data.education : [];
      const certificationsArray = Array.isArray(data?.certifications) ? data.certifications : [];
      setEducationData({
        education: educationArray,
        certifications: certificationsArray,
      });
      setWorkExperienceData({
        workExperience: data?.workExperience || data?.workHistory || [],
        workHistory: data?.workHistory || data?.workExperience || [],
      });
      setResumePresent(Boolean(data?.resume?.fileUrl || data?.resumeUrl));
      setTenantId(
        typeof data?.tenantId === 'string'
          ? data.tenantId
          : typeof data?.activeTenantId === 'string'
            ? data.activeTenantId
            : undefined,
      );
      const att = (data?.workerAttestations || {}) as Record<string, unknown>;
      const additional = (att.additionalScreenings || {}) as Record<string, unknown>;
      const mapped: Record<string, string> = {};
      const mapMaybeString = (label: string, value: unknown) => {
        const v = String(value || '').trim();
        if (!v) return;
        mapped[label] = v;
      };
      mapMaybeString('Drug screening', data?.comfortablePassDrug ?? att.drugScreeningWillingness);
      mapMaybeString('Background check', data?.comfortablePassBackground ?? att.backgroundCheckWillingness);
      mapMaybeString('E-Verify', data?.comfortableEVerify ?? att.eVerifyWillingness);
      mapMaybeString('Language requirements', data?.comfortableWithLanguages ?? att.languageRequirementWillingness);
      mapMaybeString('Physical requirements', data?.comfortableWithPhysicalRequirements ?? att.physicalRequirementWillingness);
      mapMaybeString('Uniform requirements', data?.comfortableWithUniformRequirements ?? att.uniformRequirementWillingness);
      mapMaybeString('Custom uniform requirements', data?.comfortableWithCustomUniformRequirements ?? att.customUniformRequirementWillingness);
      mapMaybeString('Required PPE', data?.comfortableWithRequiredPpe ?? att.requiredPpeWillingness);
      mapMaybeString('Transportation', data?.transportMethod ?? (data?.workerProfile as any)?.preferences?.transportMethod);
      Object.entries(additional).forEach(([k, v]) => {
        const vv = String(v || '').trim();
        if (!vv) return;
        mapped[`Additional: ${k}`] = vv;
      });
      setRequirementAttestations(mapped);
      const workerProfile = (data?.workerProfile || {}) as Record<string, unknown>;
      const workerPreferences = (workerProfile.preferences || {}) as Record<string, unknown>;
      const persistedIndustries = (Array.isArray(workerPreferences.targetIndustries)
        ? workerPreferences.targetIndustries
        : [])
        .map((v) => String(v || '').toLowerCase())
        .filter((v): v is TargetIndustry => v === 'hospitality' || v === 'industrial');
      setTargetIndustries(persistedIndustries);

      const hasPersistedScheduleOptions = Object.prototype.hasOwnProperty.call(
        workerPreferences,
        'scheduleIntentOptions',
      );
      const persistedScheduleOptions = (Array.isArray(workerPreferences.scheduleIntentOptions)
        ? workerPreferences.scheduleIntentOptions
        : [])
        .map((v) => String(v || '').toLowerCase())
        .filter((v): v is ScheduleIntentOption => v === 'full_time' || v === 'part_time' || v === 'gig');
      if (hasPersistedScheduleOptions) {
        setSelectedScheduleIntent(Array.from(new Set(persistedScheduleOptions)));
      } else {
        const persistedWorkType = String(workerPreferences.desiredWorkType || '').toLowerCase();
        if (persistedWorkType === 'full_time' || persistedWorkType === 'part_time' || persistedWorkType === 'gig') {
          setSelectedScheduleIntent([persistedWorkType as ScheduleIntentOption]);
        } else if (persistedWorkType === 'any') {
          setSelectedScheduleIntent([...ALL_SCHEDULE_OPTIONS]);
        } else {
          setSelectedScheduleIntent([]);
        }
      }
    });
    return () => unsubscribe();
  }, [uid]);

  const handleQualificationsChange = (updated: Record<string, unknown>) =>
    setQualificationsData((prev) => ({ ...prev, ...updated }));
  const handleBioChange = (updated: Record<string, unknown>) =>
    setBioData((prev) => ({ ...prev, ...updated }));
  const handleEducationChange = (updated: Record<string, unknown>) =>
    setEducationData((prev) => ({ ...prev, ...updated }));
  const handleWorkExperienceChange = (updated: Record<string, unknown>) =>
    setWorkExperienceData((prev) => ({ ...prev, ...updated }));
  const desiredWorkType: DesiredWorkType = selectedScheduleIntent.length === 1
    ? selectedScheduleIntent[0]
    : 'any';
  const anyWorkSelected = selectedScheduleIntent.length === ALL_SCHEDULE_OPTIONS.length;

  const persistJobPreferences = async (
    nextIndustries: TargetIndustry[],
    nextScheduleOptions: ScheduleIntentOption[],
  ) => {
    if (!uid) return;
    const nextDesiredWorkType: DesiredWorkType = nextScheduleOptions.length === 1
      ? nextScheduleOptions[0]
      : 'any';
    await updateDoc(
      doc(db, 'users', uid),
      buildReadinessIntentWritePatch(nextDesiredWorkType, nextIndustries, nextScheduleOptions),
    );
  };

  const handleIndustryToggle = async (industry: TargetIndustry) => {
    const next = targetIndustries.includes(industry)
      ? targetIndustries.filter((i) => i !== industry)
      : [...targetIndustries, industry];
    const normalized = Array.from(new Set(next));
    setTargetIndustries(normalized);
    await persistJobPreferences(normalized, selectedScheduleIntent);
  };

  const handleScheduleToggle = async (option: ScheduleIntentOption | 'any') => {
    const nextSelection: ScheduleIntentOption[] = (() => {
      if (option === 'any') {
        return selectedScheduleIntent.length === ALL_SCHEDULE_OPTIONS.length
          ? []
          : [...ALL_SCHEDULE_OPTIONS];
      }
      const hasOption = selectedScheduleIntent.includes(option);
      if (hasOption) return selectedScheduleIntent.filter((v) => v !== option);
      return Array.from(new Set([...selectedScheduleIntent, option]));
    })();
    setSelectedScheduleIntent(nextSelection);
    await persistJobPreferences(targetIndustries, nextSelection);
  };

  const handleAccordionChange = (section: WorkerProfileEditorSection) => (_: React.SyntheticEvent, expanded: boolean) => {
    onAccordionChange?.(expanded ? section : false);
  };

  const hasIndustries = targetIndustries.length > 0;
  const hasScheduleIntent = selectedScheduleIntent.length > 0;
  const hasSkills = Array.isArray(qualificationsData.skills) && qualificationsData.skills.length > 0;
  const hasWorkHistory = Array.isArray(workExperienceData.workExperience) && workExperienceData.workExperience.length > 0;
  const hasBio = typeof bioData.bio === 'string' && bioData.bio.trim().length > 0;
  const hasEducation = Array.isArray(educationData.education) && educationData.education.length > 0;
  const hasCertifications = Array.isArray(educationData.certifications) && educationData.certifications.length > 0;

  const workPreferencesStatus: 'complete' | 'action_required' | 'recommended' =
    hasIndustries && hasScheduleIntent ? 'complete' : 'action_required';
  const skillsExperienceStatus: 'complete' | 'action_required' | 'recommended' =
    hasSkills && hasWorkHistory ? 'complete' : (hasBio || hasEducation ? 'recommended' : 'action_required');
  const certificationsDocumentsStatus: 'complete' | 'action_required' | 'recommended' =
    hasCertifications && resumePresent ? 'complete' : (hasCertifications || resumePresent ? 'recommended' : 'action_required');

  const renderStatusChip = (status: 'complete' | 'action_required' | 'recommended') => {
    const color = status === 'complete' ? 'success' : status === 'action_required' ? 'warning' : 'default';
    const label = status === 'complete' ? 'Complete' : status === 'action_required' ? 'Action required' : 'Recommended';
    return (
      <Chip
        size="small"
        variant="outlined"
        color={color}
        label={label}
        sx={{ ml: 1 }}
      />
    );
  };

  return (
    <Box data-profile-section>
      {/* 1. Work Preferences */}
      <Accordion
        id="profile-work-preferences"
        expanded={expandedSection === 'work-preferences'}
        onChange={handleAccordionChange('work-preferences')}
        variant="outlined"
        sx={accordionSx}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={summarySx}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Typography fontWeight={600}>Work Preferences</Typography>
            {renderStatusChip(workPreferencesStatus)}
          </Box>
        </AccordionSummary>
        <AccordionDetails sx={detailsSx}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Set your target work types, schedule intent, and availability.
          </Typography>
          <Stack spacing={2}>
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                What type of work are you interested in?
              </Typography>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <Button
                  size="small"
                  variant={targetIndustries.includes('hospitality') ? 'contained' : 'outlined'}
                  onClick={() => handleIndustryToggle('hospitality')}
                >
                  Hospitality
                </Button>
                <Button
                  size="small"
                  variant={targetIndustries.includes('industrial') ? 'contained' : 'outlined'}
                  onClick={() => handleIndustryToggle('industrial')}
                >
                  Industrial
                </Button>
              </Stack>
            </Box>
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                What kind of schedule are you looking for?
              </Typography>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <Button
                  size="small"
                  variant={selectedScheduleIntent.includes('full_time') ? 'contained' : 'outlined'}
                  onClick={() => handleScheduleToggle('full_time')}
                >
                  Full-Time
                </Button>
                <Button
                  size="small"
                  variant={selectedScheduleIntent.includes('part_time') ? 'contained' : 'outlined'}
                  onClick={() => handleScheduleToggle('part_time')}
                >
                  Part-Time
                </Button>
                <Button
                  size="small"
                  variant={selectedScheduleIntent.includes('gig') ? 'contained' : 'outlined'}
                  onClick={() => handleScheduleToggle('gig')}
                >
                  Gig Work
                </Button>
                <Button
                  size="small"
                  variant={anyWorkSelected ? 'contained' : 'outlined'}
                  onClick={() => handleScheduleToggle('any')}
                >
                  Any Work
                </Button>
              </Stack>
            </Box>
            <Typography variant="caption" color="text.secondary">
              Saved preference: {desiredWorkType === 'any' ? 'Any work schedule' : desiredWorkType.replace('_', ' ')}
            </Typography>
            {Object.keys(requirementAttestations).length > 0 ? (
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 1 }}>
                  Requirement attestations (from applications)
                </Typography>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
                  {Object.entries(requirementAttestations).map(([label, value]) => (
                    <Chip key={label} size="small" variant="outlined" label={`${label}: ${value}`} />
                  ))}
                </Stack>
              </Box>
            ) : null}
            <Box sx={{ pt: 1 }}>
              <ShiftPreferencesCard uid={uid} />
            </Box>
          </Stack>
        </AccordionDetails>
      </Accordion>

      {/* 2. Skills & Experience */}
      <Accordion
        id="profile-skills-experience"
        expanded={expandedSection === 'skills-experience'}
        onChange={handleAccordionChange('skills-experience')}
        variant="outlined"
        sx={accordionSx}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={summarySx}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Typography fontWeight={600}>Skills & Experience</Typography>
            {renderStatusChip(skillsExperienceStatus)}
          </Box>
        </AccordionSummary>
        <AccordionDetails sx={detailsSx}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Keep your skills, work history, education, and summary up to date.
          </Typography>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            Skills & Languages
          </Typography>
          <QualificationsStep
            value={qualificationsData}
            onChange={handleQualificationsChange}
            context="profile"
            profileUid={uid}
          />
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 2, mb: 1 }}>
            Work History
          </Typography>
          <WorkExperienceStep
            value={workExperienceData}
            onChange={handleWorkExperienceChange}
            context="profile"
          />
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 2, mb: 1 }}>
            Education
          </Typography>
          <EducationStep
            value={educationData}
            onChange={handleEducationChange}
            context="profile"
            showOnly="education"
          />
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 2, mb: 1 }}>
            Bio / Summary
          </Typography>
          <BioStep value={bioData} onChange={handleBioChange} />
        </AccordionDetails>
      </Accordion>

      {/* 3. Certifications & Documents */}
      <Accordion
        id="profile-certifications-documents"
        expanded={expandedSection === 'certifications-documents'}
        onChange={handleAccordionChange('certifications-documents')}
        variant="outlined"
        sx={accordionSx}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={summarySx}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Typography fontWeight={600}>Certifications & Documents</Typography>
            {renderStatusChip(certificationsDocumentsStatus)}
          </Box>
        </AccordionSummary>
        <AccordionDetails sx={detailsSx}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Upload certifications and resume documents recruiters can review.
          </Typography>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            Certifications
          </Typography>
          <EducationStep
            value={educationData}
            onChange={handleEducationChange}
            context="profile"
            showOnly="certifications"
          />
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 2, mb: 1 }}>
            Resume
          </Typography>
          <ResumeUpload
            userId={uid}
            tenantId={tenantId}
            hideTitle
            compact
            onResumeParsed={() => setResumePresent(true)}
          />
        </AccordionDetails>
      </Accordion>
    </Box>
  );
};

export default WorkerProfileAccordions;
