import React, { useState, useEffect } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Card,
  CardContent,
  Typography,
  Link,
  Stack,
  Chip,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import { getWorkAuthorizedStatus } from '../../../utils/workAuthorizedDisplay';
import WorkAuthorizedChip from '../../../components/WorkAuthorizedChip';
import QualificationsStep from '../../../components/apply/steps/QualificationsStep';
import BioStep from '../../../components/apply/steps/BioStep';
import EducationStep from '../../../components/apply/steps/EducationStep';
import WorkExperienceStep from '../../../components/apply/steps/WorkExperienceStep';
import ShiftPreferencesCard from './ShiftPreferencesCard';
import { toChipLabel } from '../../../utils/chipLabel';
import { resolveWorkerPreferences } from '../../../utils/workerPreferencesCanonical';

type Props = {
  uid: string;
};

const QualificationsTab: React.FC<Props> = ({ uid }) => {
  const [qualificationsData, setQualificationsData] = useState<any>({});
  const [bioData, setBioData] = useState<any>({});
  const [educationData, setEducationData] = useState<any>({});
  const [workExperienceData, setWorkExperienceData] = useState<any>({});
  const [completion, setCompletion] = useState<Record<string, boolean>>({
    workAuthorization: false,
    resume: false,
    bio: false,
    education: false,
    certifications: false,
    workExperience: false,
    languages: false,
    availability: false,
  });
  const [workAuthorizedStatus, setWorkAuthorizedStatus] = useState<'yes' | 'no' | 'skipped'>('skipped');
  const [resumeUrl, setResumeUrl] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | false>(false);
  const [editingSection, setEditingSection] = useState<string | null>(null);

  const handleAccordionChange = (_: React.SyntheticEvent, panel: string | false) => {
    setExpanded(panel);
  };

  useEffect(() => {
    if (!uid) return;

    const userRef = doc(db, 'users', uid);
    const unsubscribe = onSnapshot(userRef, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as Record<string, any>;

      setQualificationsData({
        skills: data.skills || [],
        languages: data.languages || [],
        workHistory: data.workHistory || [],
        experienceSummary: data.experienceSummary || '',
        bio: data.bio || '',
      });
      setBioData({
        professionalBio: data.professionalBio ?? data.bio ?? '',
        bio: data.bio ?? '',
      });
      const educationArray = Array.isArray(data.education) ? data.education : [];
      const certificationsArray = Array.isArray(data.certifications) ? data.certifications : [];
      setEducationData({
        education: educationArray,
        certifications: certificationsArray,
      });
      setWorkExperienceData({
        workExperience: data.workExperience || data.workHistory || [],
        workHistory: data.workHistory || data.workExperience || [],
      });

      const workEligibilityAttestation = data.workEligibilityAttestation || {};
      setWorkAuthorizedStatus(getWorkAuthorizedStatus(data));
      const hasWorkAuth =
        (typeof workEligibilityAttestation.authorizedToWorkUS === 'boolean' ||
          typeof data.workEligibility === 'boolean') &&
        (typeof workEligibilityAttestation.requireSponsorship === 'boolean' ||
          typeof data.requireSponsorship === 'boolean');
      const resumeObj = data.resume || {};
      const hasResumeUrl = Boolean(
        resumeObj.downloadUrl ||
          resumeObj.fileName ||
          resumeObj.storagePath ||
          data.resumeStoragePath ||
          data.resumeUrl
      );
      setResumeUrl(resumeObj.downloadUrl || data.resumeUrl || null);
      const resumeComplete = hasResumeUrl;
      const certificationsComplete = certificationsArray.length > 0;
      const educationComplete = educationArray.length > 0;
      const workHistoryArr = data.workHistory || data.workExperience || [];
      const workExperienceComplete = Array.isArray(workHistoryArr) && workHistoryArr.length > 0;
      const languagesComplete = Array.isArray(data.languages) && data.languages.length > 0;
      const bioComplete = Boolean(
        (data.professionalBio || data.bio || '').toString().trim()
      );
      const prefs = (data.workerProfile?.preferences || data.preferences || {}) as Record<string, unknown>;
      const resolved = resolveWorkerPreferences(prefs);
      const availabilityComplete = Boolean(
        resolved.legacyTargetIndustriesSubset.length > 0 ||
          resolved.legacyScheduleIntentOptions.length > 0 ||
          (Array.isArray(prefs.shiftPreferences) && prefs.shiftPreferences.length > 0)
      );

      setCompletion({
        workAuthorization: hasWorkAuth,
        resume: resumeComplete,
        bio: bioComplete,
        education: educationComplete,
        certifications: certificationsComplete,
        workExperience: workExperienceComplete,
        languages: languagesComplete,
        availability: availabilityComplete,
      });
    });

    return () => unsubscribe();
  }, [uid]);

  const handleChange = (updated: any) => {
    setQualificationsData((prev: any) => ({ ...prev, ...updated }));
  };

  const handleBioChange = (updated: any) => {
    setBioData((prev: any) => ({ ...prev, ...updated }));
  };

  const handleEducationChange = (updated: any) => {
    setEducationData((prev: any) => ({ ...prev, ...updated }));
  };

  const handleWorkExperienceChange = (updated: any) => {
    setWorkExperienceData((prev: any) => ({ ...prev, ...updated }));
  };

  const bioText = (bioData?.professionalBio || bioData?.bio || '').toString().trim();
  const educationList = Array.isArray(educationData?.education) ? educationData.education : [];
  const certificationsList = Array.isArray(educationData?.certifications) ? educationData.certifications : [];
  const workExpList = workExperienceData?.workExperience || workExperienceData?.workHistory || [];
  const skillsList = qualificationsData?.skills || [];
  const languagesList = qualificationsData?.languages || [];

  return (
    <Box
      sx={{
        bgcolor: 'grey.50',
        minHeight: '100%',
        py: 2,
        px: { xs: 2, md: 3 },
      }}
    >
      <Card
        variant="outlined"
        sx={{
          borderRadius: 2,
          borderColor: 'divider',
          boxShadow: 'none',
          bgcolor: 'background.paper',
        }}
      >
        <CardContent sx={{ px: 0, py: 0, '&:last-child': { pb: 0 } }}>
          <Typography sx={{ px: 2, py: 1.5, fontWeight: 700 }}>
            Qualifications
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, pb: 1 }}>
            Overview of this user&apos;s work profile.
          </Typography>

          {/* Work authorization */}
          <Accordion
            expanded={expanded === 'work-authorization'}
            onChange={(e, isExp) => handleAccordionChange(e, isExp ? 'work-authorization' : false)}
            disableGutters
            sx={{ boxShadow: 'none', '&:before': { display: 'none' }, borderTop: '1px solid', borderColor: 'divider' }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack direction="row" alignItems="center" spacing={1}>
                {completion.workAuthorization && <CheckCircleIcon color="success" sx={{ fontSize: 18 }} />}
                <Typography sx={{ fontWeight: 500 }}>Work authorization</Typography>
              </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              <WorkAuthorizedChip status={workAuthorizedStatus} />
            </AccordionDetails>
          </Accordion>

          {/* Resume */}
          <Accordion
            expanded={expanded === 'resume'}
            onChange={(e, isExp) => handleAccordionChange(e, isExp ? 'resume' : false)}
            disableGutters
            sx={{ boxShadow: 'none', '&:before': { display: 'none' }, borderTop: '1px solid', borderColor: 'divider' }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack direction="row" alignItems="center" spacing={1}>
                {completion.resume && <CheckCircleIcon color="success" sx={{ fontSize: 18 }} />}
                <Typography sx={{ fontWeight: 500 }}>Resume</Typography>
              </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              {completion.resume && resumeUrl ? (
                <Link href={resumeUrl} target="_blank" rel="noopener noreferrer" variant="body2">
                  View resume
                </Link>
              ) : completion.resume ? (
                <Typography variant="body2" color="text.secondary">Resume on file.</Typography>
              ) : (
                <Typography variant="body2" color="text.secondary">No resume on file.</Typography>
              )}
            </AccordionDetails>
          </Accordion>

          {/* Bio */}
          <Accordion
            expanded={expanded === 'bio'}
            onChange={(e, isExp) => handleAccordionChange(e, isExp ? 'bio' : false)}
            disableGutters
            sx={{ boxShadow: 'none', '&:before': { display: 'none' }, borderTop: '1px solid', borderColor: 'divider' }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack direction="row" alignItems="center" spacing={1}>
                {completion.bio && <CheckCircleIcon color="success" sx={{ fontSize: 18 }} />}
                <Typography sx={{ fontWeight: 500 }}>Bio</Typography>
              </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              {editingSection === 'bio' ? (
                <BioStep value={bioData} onChange={handleBioChange} compact profileUserId={uid} />
              ) : bioText ? (
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{bioText}</Typography>
              ) : (
                <Typography variant="body2" color="text.secondary">No bio.</Typography>
              )}
              {editingSection !== 'bio' && (
                <Link component="button" variant="body2" sx={{ mt: 1 }} onClick={() => setEditingSection('bio')}>
                  Edit
                </Link>
              )}
              {editingSection === 'bio' && (
                <Link component="button" variant="body2" sx={{ mt: 1 }} onClick={() => setEditingSection(null)}>
                  Done
                </Link>
              )}
            </AccordionDetails>
          </Accordion>

          {/* Education */}
          <Accordion
            expanded={expanded === 'education'}
            onChange={(e, isExp) => handleAccordionChange(e, isExp ? 'education' : false)}
            disableGutters
            sx={{ boxShadow: 'none', '&:before': { display: 'none' }, borderTop: '1px solid', borderColor: 'divider' }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack direction="row" alignItems="center" spacing={1}>
                {completion.education && <CheckCircleIcon color="success" sx={{ fontSize: 18 }} />}
                <Typography sx={{ fontWeight: 500 }}>Education</Typography>
              </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              {editingSection === 'education' ? (
                <EducationStep value={educationData} onChange={handleEducationChange} context="profile" showOnly="education" />
              ) : educationList.length > 0 ? (
                <Stack spacing={0.75}>
                  {educationList.map((item: any, i: number) => (
                    <Typography key={i} variant="body2">
                      {[item.degreeType || item.degree, item.school || item.institution].filter(Boolean).join(' — ') || 'Education entry'}
                    </Typography>
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">No education on file.</Typography>
              )}
              {editingSection !== 'education' && (
                <Link component="button" variant="body2" sx={{ mt: 1 }} onClick={() => setEditingSection('education')}>
                  Edit
                </Link>
              )}
              {editingSection === 'education' && (
                <Link component="button" variant="body2" sx={{ mt: 1 }} onClick={() => setEditingSection(null)}>
                  Done
                </Link>
              )}
            </AccordionDetails>
          </Accordion>

          {/* Certifications & Licenses */}
          <Accordion
            expanded={expanded === 'certifications'}
            onChange={(e, isExp) => handleAccordionChange(e, isExp ? 'certifications' : false)}
            disableGutters
            sx={{ boxShadow: 'none', '&:before': { display: 'none' }, borderTop: '1px solid', borderColor: 'divider' }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack direction="row" alignItems="center" spacing={1}>
                {completion.certifications && <CheckCircleIcon color="success" sx={{ fontSize: 18 }} />}
                <Typography sx={{ fontWeight: 500 }}>Certifications &amp; Licenses</Typography>
              </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              {editingSection === 'certifications' ? (
                <EducationStep value={educationData} onChange={handleEducationChange} context="profile" showOnly="certifications" />
              ) : certificationsList.length > 0 ? (
                <Stack spacing={0.75}>
                  {certificationsList.map((item: any, i: number) => (
                    <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Typography variant="body2">
                        {item.name || item.certificationName || toChipLabel(item) || 'Certification'}
                      </Typography>
                      {item.fileUrl && (
                        <Link href={item.fileUrl} target="_blank" rel="noopener noreferrer" variant="body2">
                          View file
                        </Link>
                      )}
                    </Box>
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">No certifications on file.</Typography>
              )}
              {editingSection !== 'certifications' && (
                <Link component="button" variant="body2" sx={{ mt: 1 }} onClick={() => setEditingSection('certifications')}>
                  Edit
                </Link>
              )}
              {editingSection === 'certifications' && (
                <Link component="button" variant="body2" sx={{ mt: 1 }} onClick={() => setEditingSection(null)}>
                  Done
                </Link>
              )}
            </AccordionDetails>
          </Accordion>

          {/* Work experience */}
          <Accordion
            expanded={expanded === 'work-experience'}
            onChange={(e, isExp) => handleAccordionChange(e, isExp ? 'work-experience' : false)}
            disableGutters
            sx={{ boxShadow: 'none', '&:before': { display: 'none' }, borderTop: '1px solid', borderColor: 'divider' }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack direction="row" alignItems="center" spacing={1}>
                {completion.workExperience && <CheckCircleIcon color="success" sx={{ fontSize: 18 }} />}
                <Typography sx={{ fontWeight: 500 }}>Work experience</Typography>
              </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              {editingSection === 'work-experience' ? (
                <WorkExperienceStep value={workExperienceData} onChange={handleWorkExperienceChange} context="profile" />
              ) : workExpList.length > 0 ? (
                <Stack spacing={0.75}>
                  {workExpList.map((item: any, i: number) => (
                    <Typography key={i} variant="body2">
                      {[item.jobTitle || item.title, item.employer || item.company].filter(Boolean).join(' at ') || 'Work experience'}
                    </Typography>
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">No work experience on file.</Typography>
              )}
              {editingSection !== 'work-experience' && (
                <Link component="button" variant="body2" sx={{ mt: 1 }} onClick={() => setEditingSection('work-experience')}>
                  Edit
                </Link>
              )}
              {editingSection === 'work-experience' && (
                <Link component="button" variant="body2" sx={{ mt: 1 }} onClick={() => setEditingSection(null)}>
                  Done
                </Link>
              )}
            </AccordionDetails>
          </Accordion>

          {/* Skills & Languages */}
          <Accordion
            expanded={expanded === 'skills-languages'}
            onChange={(e, isExp) => handleAccordionChange(e, isExp ? 'skills-languages' : false)}
            disableGutters
            sx={{ boxShadow: 'none', '&:before': { display: 'none' }, borderTop: '1px solid', borderColor: 'divider' }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack direction="row" alignItems="center" spacing={1}>
                {(completion.languages || (skillsList.length > 0)) && <CheckCircleIcon color="success" sx={{ fontSize: 18 }} />}
                <Typography sx={{ fontWeight: 500 }}>Skills &amp; Languages</Typography>
              </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              {editingSection === 'skills-languages' ? (
                <QualificationsStep value={qualificationsData} onChange={handleChange} context="profile" profileUid={uid} />
              ) : (skillsList.length > 0 || languagesList.length > 0) ? (
                <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 0.5 }}>
                  {skillsList.map((s: any, i: number) => (
                    <Chip key={`s-${i}`} label={toChipLabel(s)} size="small" variant="outlined" />
                  ))}
                  {languagesList.map((l: any, i: number) => (
                    <Chip key={`l-${i}`} label={toChipLabel(l)} size="small" variant="outlined" />
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">No skills or languages on file.</Typography>
              )}
              {editingSection !== 'skills-languages' && (
                <Link component="button" variant="body2" sx={{ mt: 1 }} onClick={() => setEditingSection('skills-languages')}>
                  Edit
                </Link>
              )}
              {editingSection === 'skills-languages' && (
                <Link component="button" variant="body2" sx={{ mt: 1 }} onClick={() => setEditingSection(null)}>
                  Done
                </Link>
              )}
            </AccordionDetails>
          </Accordion>

          {/* Availability and preferences */}
          <Accordion
            expanded={expanded === 'availability'}
            onChange={(e, isExp) => handleAccordionChange(e, isExp ? 'availability' : false)}
            disableGutters
            sx={{ boxShadow: 'none', '&:before': { display: 'none' }, borderTop: '1px solid', borderColor: 'divider' }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack direction="row" alignItems="center" spacing={1}>
                {completion.availability && <CheckCircleIcon color="success" sx={{ fontSize: 18 }} />}
                <Typography sx={{ fontWeight: 500 }}>Availability and preferences</Typography>
              </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              <ShiftPreferencesCard uid={uid} titleOverride="Availability and preferences" displayOnly />
            </AccordionDetails>
          </Accordion>
        </CardContent>
      </Card>
    </Box>
  );
};

export default QualificationsTab;
