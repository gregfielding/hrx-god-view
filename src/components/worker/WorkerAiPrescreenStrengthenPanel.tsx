import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { alpha, type SxProps, type Theme } from '@mui/material/styles';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';

import { db } from '../../firebase';
import { useT } from '../../i18n';
import ResumeUpload from '../ResumeUpload';
import { geocodeAddressDetailed, getGeocodingErrorMessage, type GeocodeDetails } from '../../utils/geocodeAddress';
import {
  confirmPhoneCode,
  formatPhoneForDisplay,
  isValidE164,
  startPhoneVerification,
} from '../../utils/phoneVerificationTwilio';
import { userDocHasStoredResume } from '../../utils/workerProfilePrerequisites';
import {
  evaluateWorkerPhoneGate,
  isWorkerHomeAddressComplete,
} from '../../utils/workerProfileActionItemFacts';
import type { WorkerAiPrescreenAnswers } from '../../utils/workerAiPrescreenScore';
import {
  deriveSuggestedSkillsFromPrescreenAnswers,
  filterNewSkillSuggestions,
  hasExperienceBlockCompleteForAdaptive,
  isUserDocSkillsThin,
  mergeInterviewSkillLabelsIntoUserSkills,
} from '../../utils/workerAiPrescreenAdaptiveGaps';

type Props = {
  userId: string;
  tenantId: string | null;
  userDoc: Record<string, unknown> | null;
  answers: WorkerAiPrescreenAnswers;
  isLastStep: boolean;
};

type StrengthenBlockId = 'skills' | 'resume' | 'phone' | 'address';

/** Shared styles for nested optional-block accordions (single-expand group). */
const innerAccordionSx: SxProps<Theme> = (theme) => ({
  '&:before': { display: 'none' },
  boxShadow: 'none',
  bgcolor: 'background.paper',
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: 1,
  mb: 1,
  '&:last-of-type': { mb: 0 },
});

function toUsE164(raw: string): string {
  let e164 = raw.trim();
  if (!e164.startsWith('+')) {
    const digits = e164.replace(/\D/g, '');
    if (digits.length === 10) e164 = `+1${digits}`;
    else if (digits.length === 11 && digits.startsWith('1')) e164 = `+${digits}`;
    else e164 = `+${digits}`;
  }
  return e164;
}

const WorkerAiPrescreenStrengthenPanel: React.FC<Props> = ({
  userId,
  tenantId,
  userDoc,
  answers,
  isLastStep,
}) => {
  const t = useT();
  const experienceGate = hasExperienceBlockCompleteForAdaptive(answers);

  const suggestions = useMemo(
    () => filterNewSkillSuggestions(userDoc, deriveSuggestedSkillsFromPrescreenAnswers(answers)),
    [userDoc, answers],
  );

  const [skillsSaved, setSkillsSaved] = useState(false);
  const [selectedSkillKeys, setSelectedSkillKeys] = useState<Set<string>>(new Set());
  const [skillsSaving, setSkillsSaving] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedSkillKeys(new Set(suggestions.map((s) => s.key)));
  }, [suggestions]);

  const showSkillsBlock =
    experienceGate &&
    isUserDocSkillsThin(userDoc) &&
    suggestions.length > 0 &&
    !skillsSaved;

  const [resumeChoice, setResumeChoice] = useState<'unasked' | 'yes' | 'no'>('unasked');
  const showResumeBlock =
    experienceGate && !userDocHasStoredResume(userDoc) && resumeChoice !== 'no';

  const phoneGate = userDoc ? evaluateWorkerPhoneGate(userDoc) : { needsAction: true };
  const [phoneSkipped, setPhoneSkipped] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [resendSec, setResendSec] = useState(0);

  useEffect(() => {
    if (!userDoc || phoneInput.trim()) return;
    const e164 = String(userDoc.phoneE164 || '').trim();
    if (e164) {
      setPhoneInput(formatPhoneForDisplay(e164) || e164);
      return;
    }
    const raw = String(userDoc.phone || '').trim();
    if (raw) setPhoneInput(raw);
  }, [userDoc, phoneInput]);

  useEffect(() => {
    if (resendSec <= 0) return;
    const id = window.setInterval(() => setResendSec((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [resendSec]);

  const showPhoneBlock = isLastStep && phoneGate.needsAction && !phoneSkipped;

  const addrInitRef = useRef(false);
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [stateUS, setStateUS] = useState('');
  const [zip, setZip] = useState('');
  const [geoPreview, setGeoPreview] = useState<GeocodeDetails | null>(null);
  const [addressBusy, setAddressBusy] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [addressSaved, setAddressSaved] = useState(false);

  /** Only one optional block expanded at a time to reduce visual noise. */
  const [expandedBlock, setExpandedBlock] = useState<StrengthenBlockId | null>(null);

  const handleBlockChange = useCallback((id: StrengthenBlockId) => (_: unknown, expanded: boolean) => {
    setExpandedBlock(expanded ? id : null);
  }, []);

  useEffect(() => {
    setSkillsSaved(false);
    setResumeChoice('unasked');
    setPhoneSkipped(false);
    setAddressSaved(false);
    setGeoPreview(null);
    setCodeSent(false);
    setCodeInput('');
    setPhoneError(null);
    setStreet('');
    setCity('');
    setStateUS('');
    setZip('');
    addrInitRef.current = false;
    setExpandedBlock(null);
  }, [userId]);

  useEffect(() => {
    if (!isLastStep || !userDoc || addrInitRef.current) return;
    const addr = (userDoc.addressInfo || {}) as Record<string, unknown>;
    setStreet(String(addr.streetAddress ?? '').trim());
    setCity(String(addr.city ?? userDoc.city ?? '').trim());
    setStateUS(String(addr.state ?? userDoc.state ?? '').trim());
    setZip(String(addr.zip ?? addr.zipCode ?? userDoc.zip ?? '').trim());
    addrInitRef.current = true;
  }, [isLastStep, userDoc]);

  const showAddressBlock =
    isLastStep && userDoc && !isWorkerHomeAddressComplete(userDoc) && !addressSaved;

  useEffect(() => {
    const available: StrengthenBlockId[] = [];
    if (showSkillsBlock) available.push('skills');
    if (showResumeBlock) available.push('resume');
    if (showPhoneBlock) available.push('phone');
    if (showAddressBlock) available.push('address');
    setExpandedBlock((prev) => {
      if (available.length === 0) return null;
      if (available.length === 1) return available[0];
      if (prev && available.includes(prev)) return prev;
      return null;
    });
  }, [showSkillsBlock, showResumeBlock, showPhoneBlock, showAddressBlock]);

  const phoneComplete = isLastStep && userDoc && !evaluateWorkerPhoneGate(userDoc).needsAction;
  const resumeOnProfile = experienceGate && userDocHasStoredResume(userDoc);
  const resumeSkipped = experienceGate && resumeChoice === 'no';

  const showPanel =
    showSkillsBlock ||
    showResumeBlock ||
    showPhoneBlock ||
    showAddressBlock ||
    (experienceGate && skillsSaved) ||
    (resumeOnProfile && !showResumeBlock) ||
    (resumeSkipped && !showResumeBlock) ||
    (isLastStep && phoneComplete && !showPhoneBlock) ||
    addressSaved;

  const toggleSkillKey = useCallback((key: string) => {
    setSelectedSkillKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleSaveSkills = async () => {
    setSkillsError(null);
    const labels = suggestions.filter((s) => selectedSkillKeys.has(s.key)).map((s) => s.label);
    if (labels.length === 0) {
      setSkillsError(t('workerAiPrescreen.strengthen.skillsPickOne'));
      return;
    }
    setSkillsSaving(true);
    try {
      const merged = mergeInterviewSkillLabelsIntoUserSkills(userDoc?.skills, labels);
      await updateDoc(doc(db, 'users', userId), {
        skills: merged,
        updatedAt: serverTimestamp(),
      });
      setSkillsSaved(true);
    } catch (e) {
      setSkillsError(e instanceof Error ? e.message : t('workerAiPrescreen.strengthen.skillsSaveFailed'));
    } finally {
      setSkillsSaving(false);
    }
  };

  const handleSendCode = async () => {
    setPhoneError(null);
    const e164 = toUsE164(phoneInput);
    if (!isValidE164(e164)) {
      setPhoneError(t('workerAiPrescreen.strengthen.phoneInvalid'));
      return;
    }
    setPhoneBusy(true);
    try {
      await startPhoneVerification(e164);
      setCodeSent(true);
      setResendSec(60);
    } catch (e) {
      setPhoneError(e instanceof Error ? e.message : t('workerAiPrescreen.strengthen.phoneSendFailed'));
    } finally {
      setPhoneBusy(false);
    }
  };

  const handleVerifyCode = async () => {
    setPhoneError(null);
    const e164 = toUsE164(phoneInput);
    if (!isValidE164(e164)) {
      setPhoneError(t('workerAiPrescreen.strengthen.phoneInvalid'));
      return;
    }
    if (codeInput.trim().length !== 6) {
      setPhoneError(t('workerAiPrescreen.strengthen.codeInvalid'));
      return;
    }
    setPhoneBusy(true);
    try {
      await confirmPhoneCode(codeInput.trim(), e164);
      setCodeSent(false);
      setCodeInput('');
    } catch (e) {
      setPhoneError(e instanceof Error ? e.message : t('workerAiPrescreen.strengthen.codeFailed'));
    } finally {
      setPhoneBusy(false);
    }
  };

  const handlePreviewAddress = async () => {
    setAddressError(null);
    setGeoPreview(null);
    const line = [street, city, stateUS, zip].map((x) => String(x).trim()).filter(Boolean).join(', ');
    if (!street.trim() || !city.trim() || !stateUS.trim() || !zip.trim()) {
      setAddressError(t('workerAiPrescreen.strengthen.addressFieldsRequired'));
      return;
    }
    setAddressBusy(true);
    try {
      const g = await geocodeAddressDetailed(line);
      setGeoPreview(g);
    } catch (e) {
      setAddressError(getGeocodingErrorMessage(e));
    } finally {
      setAddressBusy(false);
    }
  };

  const handleSaveAddress = async () => {
    setAddressError(null);
    if (!geoPreview) {
      setAddressError(t('workerAiPrescreen.strengthen.addressPreviewFirst'));
      return;
    }
    const prev = ((userDoc?.addressInfo as Record<string, unknown>) || {}) as Record<string, unknown>;
    setAddressBusy(true);
    try {
      const streetOut = (geoPreview.street || street).trim();
      const cityOut = (geoPreview.city || city).trim();
      const stateOut = (geoPreview.state || stateUS).trim();
      const zipOut = (geoPreview.zip || zip).trim();
      await updateDoc(doc(db, 'users', userId), {
        addressInfo: {
          ...prev,
          streetAddress: streetOut,
          city: cityOut,
          state: stateOut,
          zip: zipOut,
          homeLat: geoPreview.lat,
          homeLng: geoPreview.lng,
        },
        updatedAt: serverTimestamp(),
      });
      setAddressSaved(true);
    } catch (e) {
      setAddressError(e instanceof Error ? e.message : t('workerAiPrescreen.strengthen.addressSaveFailed'));
    } finally {
      setAddressBusy(false);
    }
  };

  if (!showPanel) return null;

  return (
    <Accordion
      defaultExpanded={false}
      disableGutters
      elevation={0}
      sx={{
        mt: 2,
        border: (muiTheme) => `1px solid ${muiTheme.palette.divider}`,
        borderRadius: 1,
        '&:before': { display: 'none' },
        bgcolor: (muiTheme) => alpha(muiTheme.palette.primary.main, 0.04),
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 1.5, py: 1 }}>
        <Box>
          <Typography variant="subtitle2" fontWeight={700}>
            {!showSkillsBlock && !showResumeBlock && !showPhoneBlock && !showAddressBlock
              ? t('workerAiPrescreen.strengthen.optionalHeaderDone')
              : t('workerAiPrescreen.strengthen.optionalHeader')}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
            {!showSkillsBlock && !showResumeBlock && !showPhoneBlock && !showAddressBlock
              ? t('workerAiPrescreen.strengthen.optionalSubDone')
              : t('workerAiPrescreen.strengthen.optionalSub')}
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 1.5, pb: 1.5, pt: 0 }}>
        <Paper
          elevation={0}
          variant="outlined"
          sx={{
            p: 1.5,
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          <Stack spacing={1.25}>
            <Box>
              <Typography variant="subtitle2" fontWeight={700}>
                {t('workerAiPrescreen.strengthen.title')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.4, mt: 0.25 }}>
                {t('workerAiPrescreen.strengthen.body')}
              </Typography>
            </Box>

            {experienceGate && skillsSaved ? (
              <Alert
                severity="success"
                variant="outlined"
                icon={<CheckCircleOutlineIcon fontSize="inherit" />}
                sx={{ py: 0.5, '& .MuiAlert-message': { width: '100%' } }}
              >
                <Typography variant="body2">{t('workerAiPrescreen.strengthen.skillsDone')}</Typography>
              </Alert>
            ) : null}

            {resumeOnProfile && !showResumeBlock && experienceGate ? (
              <Alert
                severity="success"
                variant="outlined"
                icon={<CheckCircleOutlineIcon fontSize="inherit" />}
                sx={{ py: 0.5 }}
              >
                <Typography variant="body2">{t('workerAiPrescreen.strengthen.resumeOnFileShort')}</Typography>
              </Alert>
            ) : null}

            {resumeSkipped && !showResumeBlock ? (
              <Alert severity="info" variant="outlined" sx={{ py: 0.5 }}>
                <Typography variant="body2">{t('workerAiPrescreen.strengthen.resumeSkippedNote')}</Typography>
              </Alert>
            ) : null}

            {isLastStep && phoneComplete && !showPhoneBlock ? (
              <Alert
                severity="success"
                variant="outlined"
                icon={<CheckCircleOutlineIcon fontSize="inherit" />}
                sx={{ py: 0.5 }}
              >
                <Typography variant="body2">{t('workerAiPrescreen.strengthen.phoneDone')}</Typography>
              </Alert>
            ) : null}

            {addressSaved ? (
              <Alert
                severity="success"
                variant="outlined"
                icon={<CheckCircleOutlineIcon fontSize="inherit" />}
                sx={{ py: 0.5 }}
              >
                <Typography variant="body2">{t('workerAiPrescreen.strengthen.addressDone')}</Typography>
              </Alert>
            ) : null}

            {showSkillsBlock ? (
              <Accordion
                disableGutters
                elevation={0}
                expanded={expandedBlock === 'skills'}
                onChange={handleBlockChange('skills')}
                sx={innerAccordionSx}
              >
                <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 1.25, py: 0.75, minHeight: 44 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {t('workerAiPrescreen.strengthen.skillsHeading')}
                  </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ px: 1.25, pt: 0, pb: 1.25 }}>
                  <Stack direction="row" gap={0.75} flexWrap="wrap" sx={{ mb: 1 }}>
                    {suggestions.map((s) => (
                      <Chip
                        key={s.key}
                        size="small"
                        label={s.label}
                        color={selectedSkillKeys.has(s.key) ? 'primary' : 'default'}
                        variant={selectedSkillKeys.has(s.key) ? 'filled' : 'outlined'}
                        onClick={() => toggleSkillKey(s.key)}
                      />
                    ))}
                  </Stack>
                  {skillsError ? (
                    <Alert severity="error" sx={{ py: 0.25, mb: 1 }}>
                      {skillsError}
                    </Alert>
                  ) : null}
                  <Button
                    variant="contained"
                    size="small"
                    disabled={skillsSaving}
                    onClick={() => void handleSaveSkills()}
                  >
                    {skillsSaving ? <CircularProgress size={18} color="inherit" /> : t('workerAiPrescreen.strengthen.skillsConfirm')}
                  </Button>
                </AccordionDetails>
              </Accordion>
            ) : null}

            {showResumeBlock ? (
              <Accordion
                disableGutters
                elevation={0}
                expanded={expandedBlock === 'resume'}
                onChange={handleBlockChange('resume')}
                sx={innerAccordionSx}
              >
                <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 1.25, py: 0.75, minHeight: 44 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {t('workerAiPrescreen.strengthen.resumeHeading')}
                  </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ px: 1.25, pt: 0, pb: 1.25 }}>
                  {resumeChoice === 'unasked' ? (
                    <>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        {t('workerAiPrescreen.strengthen.resumePrompt')}
                      </Typography>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                        <Button size="small" variant="outlined" onClick={() => setResumeChoice('yes')}>
                          {t('common.yes')}
                        </Button>
                        <Button size="small" variant="outlined" onClick={() => setResumeChoice('no')}>
                          {t('common.no')}
                        </Button>
                      </Stack>
                    </>
                  ) : null}
                  {resumeChoice === 'yes' ? (
                    <ResumeUpload
                      userId={userId}
                      tenantId={tenantId ?? undefined}
                      compact
                      hideTitle
                      hideStoredResumeAlert
                    />
                  ) : null}
                </AccordionDetails>
              </Accordion>
            ) : null}

            {showPhoneBlock ? (
              <Accordion
                disableGutters
                elevation={0}
                expanded={expandedBlock === 'phone'}
                onChange={handleBlockChange('phone')}
                sx={innerAccordionSx}
              >
                <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 1.25, py: 0.75, minHeight: 44 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {t('workerAiPrescreen.strengthen.phoneHeading')}
                  </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ px: 1.25, pt: 0, pb: 1.25 }}>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75 }}>
                    {t('workerAiPrescreen.strengthen.phoneHint')}
                  </Typography>
                  <Stack spacing={1}>
                    <TextField
                      size="small"
                      fullWidth
                      label={t('workerAiPrescreen.strengthen.phoneLabel')}
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(e.target.value)}
                      disabled={phoneBusy}
                    />
                    {!codeSent ? (
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        <Button size="small" variant="contained" disabled={phoneBusy} onClick={() => void handleSendCode()}>
                          {phoneBusy ? <CircularProgress size={18} color="inherit" /> : t('workerAiPrescreen.strengthen.sendCode')}
                        </Button>
                        <Button size="small" variant="text" disabled={phoneBusy} onClick={() => setPhoneSkipped(true)}>
                          {t('workerAiPrescreen.strengthen.skipForNow')}
                        </Button>
                      </Stack>
                    ) : (
                      <>
                        <TextField
                          size="small"
                          fullWidth
                          label={t('workerAiPrescreen.strengthen.codeLabel')}
                          value={codeInput}
                          onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          disabled={phoneBusy}
                        />
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          <Button size="small" variant="contained" disabled={phoneBusy} onClick={() => void handleVerifyCode()}>
                            {phoneBusy ? <CircularProgress size={18} color="inherit" /> : t('workerAiPrescreen.strengthen.verifyCode')}
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={phoneBusy || resendSec > 0}
                            onClick={() => void handleSendCode()}
                          >
                            {resendSec > 0
                              ? t('workerAiPrescreen.strengthen.resendIn', { seconds: resendSec })
                              : t('workerAiPrescreen.strengthen.resend')}
                          </Button>
                          <Button size="small" variant="text" disabled={phoneBusy} onClick={() => setPhoneSkipped(true)}>
                            {t('workerAiPrescreen.strengthen.skipForNow')}
                          </Button>
                        </Stack>
                      </>
                    )}
                    {phoneError ? (
                      <Alert severity="error" sx={{ py: 0.25 }}>
                        {phoneError}
                      </Alert>
                    ) : null}
                  </Stack>
                </AccordionDetails>
              </Accordion>
            ) : null}

            {showAddressBlock ? (
              <Accordion
                disableGutters
                elevation={0}
                expanded={expandedBlock === 'address'}
                onChange={handleBlockChange('address')}
                sx={innerAccordionSx}
              >
                <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 1.25, py: 0.75, minHeight: 44 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {t('workerAiPrescreen.strengthen.addressHeading')}
                  </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ px: 1.25, pt: 0, pb: 1.25 }}>
                  <Stack spacing={1}>
                    <TextField
                      size="small"
                      fullWidth
                      label={t('workerAiPrescreen.strengthen.street')}
                      value={street}
                      onChange={(e) => {
                        setStreet(e.target.value);
                        setGeoPreview(null);
                      }}
                      disabled={addressBusy}
                    />
                    <TextField
                      size="small"
                      fullWidth
                      label={t('workerAiPrescreen.strengthen.city')}
                      value={city}
                      onChange={(e) => {
                        setCity(e.target.value);
                        setGeoPreview(null);
                      }}
                      disabled={addressBusy}
                    />
                    <TextField
                      size="small"
                      fullWidth
                      label={t('workerAiPrescreen.strengthen.state')}
                      value={stateUS}
                      onChange={(e) => {
                        setStateUS(e.target.value);
                        setGeoPreview(null);
                      }}
                      disabled={addressBusy}
                    />
                    <TextField
                      size="small"
                      fullWidth
                      label={t('workerAiPrescreen.strengthen.zip')}
                      value={zip}
                      onChange={(e) => {
                        setZip(e.target.value);
                        setGeoPreview(null);
                      }}
                      disabled={addressBusy}
                    />
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <Button size="small" variant="outlined" disabled={addressBusy} onClick={() => void handlePreviewAddress()}>
                        {addressBusy ? <CircularProgress size={18} /> : t('workerAiPrescreen.strengthen.addressPreview')}
                      </Button>
                    </Stack>
                    {geoPreview ? (
                      <Alert severity="success" sx={{ py: 0.5 }}>
                        <Typography variant="body2">{geoPreview.formattedAddress}</Typography>
                        <Button
                          size="small"
                          sx={{ mt: 1 }}
                          variant="contained"
                          disabled={addressBusy}
                          onClick={() => void handleSaveAddress()}
                        >
                          {t('workerAiPrescreen.strengthen.addressConfirmSave')}
                        </Button>
                      </Alert>
                    ) : null}
                    {addressError ? (
                      <Alert severity="error" sx={{ py: 0.25 }}>
                        {addressError}
                      </Alert>
                    ) : null}
                  </Stack>
                </AccordionDetails>
              </Accordion>
            ) : null}
          </Stack>
        </Paper>
      </AccordionDetails>
    </Accordion>
  );
};

export default WorkerAiPrescreenStrengthenPanel;
