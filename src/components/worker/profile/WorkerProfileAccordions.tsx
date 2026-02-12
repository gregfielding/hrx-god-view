/**
 * Worker Profile Accordions — embeds existing profile form components in accordion layout.
 * Reuses: JobPreferencesStep, ShiftPreferencesCard, WorkExperienceStep, EducationStep,
 * QualificationsStep, BioStep from apply steps and UserProfile. Does not modify admin views.
 * Spec: HRX / C1 Job Readiness Refactor Spec — Section 3
 */

import React, { useState, useEffect } from 'react';
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Typography,
  Box,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';

import JobPreferencesStep from '../../apply/steps/JobPreferencesStep';
import WorkExperienceStep from '../../apply/steps/WorkExperienceStep';
import EducationStep from '../../apply/steps/EducationStep';
import QualificationsStep from '../../apply/steps/QualificationsStep';
import BioStep from '../../apply/steps/BioStep';
import ShiftPreferencesCard from '../../../pages/UserProfile/components/ShiftPreferencesCard';
import { READINESS_SECTION_IDS } from './readinessPrompts';

const accordionSx = {
  '&:before': { display: 'none' },
  borderColor: 'divider',
  borderRadius: '8px !important',
  mb: 1,
  boxShadow: 'none',
};

const summarySx = { '& .MuiAccordionSummary-content': { my: 1.5 } };
const detailsSx = { pt: 0, pb: 2, px: 2 };

export type ReadinessAccordionSection =
  | 'availability'
  | 'work-experience'
  | 'certifications'
  | 'skills'
  | 'bio'
  | 'education';

type Props = {
  uid: string;
  /** Controlled expanded section id; false = none expanded. */
  expandedSection?: ReadinessAccordionSection | false;
  onAccordionChange?: (section: ReadinessAccordionSection | false) => void;
};

const WorkerProfileAccordions: React.FC<Props> = ({
  uid,
  expandedSection = false,
  onAccordionChange,
}) => {
  const [qualificationsData, setQualificationsData] = useState<any>({});
  const [bioData, setBioData] = useState<any>({});
  const [educationData, setEducationData] = useState<any>({});
  const [workExperienceData, setWorkExperienceData] = useState<any>({});
  const [preferencesData, setPreferencesData] = useState<any>({});

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
      setPreferencesData({
        availableToStartDate: data?.availableToStartDate || '',
        availabilityNotes: data?.preferences?.availabilityNotes || '',
        shiftPreferences: data?.preferences?.shiftPreferences || [],
        industryPreferences: data?.preferences?.industryPreferences || [],
        targetPay: data?.preferences?.targetPay || '',
        shift: data?.preferences?.shift || '',
      });
    });
    return () => unsubscribe();
  }, [uid]);

  const handleQualificationsChange = (updated: any) =>
    setQualificationsData((prev: any) => ({ ...prev, ...updated }));
  const handleBioChange = (updated: any) =>
    setBioData((prev: any) => ({ ...prev, ...updated }));
  const handleEducationChange = (updated: any) =>
    setEducationData((prev: any) => ({ ...prev, ...updated }));
  const handleWorkExperienceChange = (updated: any) =>
    setWorkExperienceData((prev: any) => ({ ...prev, ...updated }));
  const handlePreferencesChange = (updated: any) =>
    setPreferencesData((prev: any) => ({ ...prev, ...updated }));

  const handleAccordionChange = (section: ReadinessAccordionSection) => (_: React.SyntheticEvent, expanded: boolean) => {
    onAccordionChange?.(expanded ? section : false);
  };

  return (
    <Box data-profile-section>
      {/* 1. Availability & Preferences */}
      <Accordion
        id={READINESS_SECTION_IDS.availability}
        expanded={expandedSection === 'availability'}
        onChange={handleAccordionChange('availability')}
        variant="outlined"
        sx={accordionSx}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={summarySx}>
          <Typography fontWeight={600}>Availability &amp; Preferences</Typography>
        </AccordionSummary>
        <AccordionDetails sx={detailsSx}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            More availability means more job offers.
          </Typography>
          <JobPreferencesStep value={preferencesData} onChange={handlePreferencesChange} />
          <Box sx={{ mt: 2 }}>
            <ShiftPreferencesCard uid={uid} />
          </Box>
        </AccordionDetails>
      </Accordion>

      {/* 2. Work Experience */}
      <Accordion
        id={READINESS_SECTION_IDS['work-experience']}
        expanded={expandedSection === 'work-experience'}
        onChange={handleAccordionChange('work-experience')}
        variant="outlined"
        sx={accordionSx}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={summarySx}>
          <Typography fontWeight={600}>Work Experience</Typography>
        </AccordionSummary>
        <AccordionDetails sx={detailsSx}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Add roles to show employers your experience.
          </Typography>
          <WorkExperienceStep
            value={workExperienceData}
            onChange={handleWorkExperienceChange}
            context="profile"
          />
        </AccordionDetails>
      </Accordion>

      {/* 3. Certifications */}
      <Accordion
        id={READINESS_SECTION_IDS.certifications}
        expanded={expandedSection === 'certifications'}
        onChange={handleAccordionChange('certifications')}
        variant="outlined"
        sx={accordionSx}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={summarySx}>
          <Typography fontWeight={600}>Certifications</Typography>
        </AccordionSummary>
        <AccordionDetails sx={detailsSx}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Add a certification to qualify for higher-paying shifts.
          </Typography>
          <EducationStep
            value={educationData}
            onChange={handleEducationChange}
            context="profile"
            showOnly="certifications"
          />
        </AccordionDetails>
      </Accordion>

      {/* 4. Skills & Languages */}
      <Accordion
        expanded={expandedSection === 'skills'}
        onChange={handleAccordionChange('skills')}
        variant="outlined"
        sx={accordionSx}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={summarySx}>
          <Typography fontWeight={600}>Skills &amp; Languages</Typography>
        </AccordionSummary>
        <AccordionDetails sx={detailsSx}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Skills and languages help match you to the right roles.
          </Typography>
          <QualificationsStep
            value={qualificationsData}
            onChange={handleQualificationsChange}
            context="profile"
            profileUid={uid}
          />
        </AccordionDetails>
      </Accordion>

      {/* 5. Bio */}
      <Accordion
        id={READINESS_SECTION_IDS.bio}
        expanded={expandedSection === 'bio'}
        onChange={handleAccordionChange('bio')}
        variant="outlined"
        sx={accordionSx}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={summarySx}>
          <Typography fontWeight={600}>Bio</Typography>
        </AccordionSummary>
        <AccordionDetails sx={detailsSx}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            A short bio helps recruiters understand your goals and experience.
          </Typography>
          <BioStep value={bioData} onChange={handleBioChange} />
        </AccordionDetails>
      </Accordion>

      {/* 6. Education */}
      <Accordion
        expanded={expandedSection === 'education'}
        onChange={handleAccordionChange('education')}
        variant="outlined"
        sx={accordionSx}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={summarySx}>
          <Typography fontWeight={600}>Education</Typography>
        </AccordionSummary>
        <AccordionDetails sx={detailsSx}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Add your education to qualify for more roles.
          </Typography>
          <EducationStep
            value={educationData}
            onChange={handleEducationChange}
            context="profile"
            showOnly="education"
          />
        </AccordionDetails>
      </Accordion>
    </Box>
  );
};

export default WorkerProfileAccordions;
