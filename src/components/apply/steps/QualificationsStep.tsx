import React from 'react';
import { Box, Typography, TextField, Card, CardHeader, CardContent, Button, Stack, Alert, Divider, Chip, Grid, useTheme, useMediaQuery } from '@mui/material';
import { CheckCircle } from '@mui/icons-material';
import Autocomplete from '@mui/material/Autocomplete';
import { doc, onSnapshot, updateDoc, serverTimestamp, collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { auth, db } from '../../../firebase';
import { logger } from '../../../utils/logger';
import onetSkills from '../../../data/onetSkills.json';
import onetJobTitles from '../../../data/onetJobTitles.json';
import SkillsTab from '../../../pages/UserProfile/components/SkillsTab/SkillsTab';
import { mapParsedExperienceToRows } from '../../../utils/resumeToWorkHistory';
// Local debounce for onChange/onBlur saves (keeps dependencies minimal)
// Using native month inputs for broad compatibility without extra dependencies

type Props = {
  value: any;
  onChange: (v: any) => void;
  context?: 'application' | 'profile';
  tenantId?: string;
  jobId?: string;
  jobPosting?: any;
};

const QualificationsStep: React.FC<Props> = ({ value, onChange, context = 'application', tenantId, jobId, jobPosting }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  
  const job = jobPosting; // job-driven gating comes from parent (Wizard)
  const debounceRef = React.useRef<any>(null);
  const debouncedUpdate = (ref: any, data: any) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try { await updateDoc(ref, data); } catch {}
    }, 500);
  };
  
  // Transform the qualifications data into user-like format for SkillsTab
  const userData = {
    ...value,
    skills: value?.skills || [],
    certifications: value?.certifications || [],
    languages: value?.languages || [],
    education: value?.education || [],
    workHistory: value?.workHistory || [],
    salaryExpectations: value?.salaryExpectations || {}
  };
  
  
  
  const [tempBio, setTempBio] = React.useState<string>(value?.bio || '');
  React.useEffect(() => {
    setTempBio(value?.bio || '');
  }, [value?.bio]);

  // Live-read user bio from Firestore (simple onSnapshot). If the local value is empty, hydrate from DB.
  React.useEffect(() => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    const userRef = doc(db, 'users', currentUser.uid);
    const unsub = onSnapshot(userRef, (snap) => {
      const bioFromDb = (snap.data() as any)?.bio || '';
      const resumeFromDb = (snap.data() as any)?.resume || null;
      const expFromDb = (snap.data() as any)?.experienceSummary || '';
      if (!value?.bio && !tempBio && bioFromDb) {
        setTempBio(bioFromDb);
        onChange({ ...value, bio: bioFromDb });
      }
      // Determine resume presence for gating Professional Bio
      try {
        const has = !!(resumeFromDb?.downloadUrl || resumeFromDb?.storagePath);
        setHasResume(has);
      } catch {}
      // Keep expSummary synced with DB value to avoid clearing on save
      if (typeof expFromDb === 'string' && expFromDb !== expSummary) {
        setExpSummary(expFromDb);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTempBio(e.target.value);
  };

  const handleSaveBio = () => {
    onChange({ ...value, bio: tempBio });
    try {
      const uid = auth.currentUser?.uid;
      if (uid) {
        const userRef = doc(db, 'users', uid);
        updateDoc(userRef, { bio: tempBio });
      }
    } catch {}
  };

  const [hasResume, setHasResume] = React.useState<boolean>(false);
  const showBio = context === 'profile' ? true : hasResume;

  // Show Experience immediately while posting loads; then respect explicit flag when available
  // Default to showing while posting loads (null/undefined), then respect flag
  const showExperience = context === 'profile' || (job == null ? true : !!job.showExperience);
  const showLanguages = context === 'profile' || (job == null ? true : !!job.showLanguages);

  const [expSummary, setExpSummary] = React.useState<string>(value?.experienceSummary || '');
  // Only adopt incoming prop value when it is defined to avoid clearing local edits
  React.useEffect(() => {
    if (typeof value?.experienceSummary === 'string') {
      setExpSummary(value.experienceSummary);
    }
  }, [value?.experienceSummary]);

  const [userLanguages, setUserLanguages] = React.useState<string[]>(value?.languages || []);
  // Only adopt incoming prop value when it is defined to avoid clearing local edits
  React.useEffect(() => {
    if (Array.isArray(value?.languages)) {
      setUserLanguages(value.languages);
    }
  }, [value?.languages]);

  const [workRows, setWorkRows] = React.useState<Array<{ id: string; employer: string; title: string; startDate?: string; endDate?: string }>>(value?.workHistory || []);
  // Hydrate from Firestore directly to avoid draft state overwriting persisted rows
  React.useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const ref = doc(db, 'users', uid);
    const unsub = onSnapshot(ref, (snap) => {
      const data = snap.data() as any;
      const rows = Array.isArray(data?.workHistory) ? data.workHistory : [];
      setWorkRows((prev) => {
        // If local has edits (ids not in Firestore), merge uniquely by id
        const byId: Record<string, any> = {};
        rows.forEach((r: any) => { if (r?.id) byId[r.id] = r; });
        prev.forEach((r) => { if (r?.id && !(r.id in byId)) byId[r.id] = r; });
        return Object.values(byId);
      });
    });
    return () => unsub();
  }, []);

  const addWorkRow = () => {
    const row = { id: `${Date.now()}_${Math.random().toString(36).slice(2,7)}`, employer: '', title: '', startDate: '', endDate: '' };
    setWorkRows((prev) => {
      const next = [...prev, row];
      onChange({ ...value, workHistory: next });
      const uid = auth.currentUser?.uid;
      if (uid) debouncedUpdate(doc(db, 'users', uid), { workHistory: next, updatedAt: serverTimestamp() });
      return next;
    });
  };
  const removeWorkRow = (id: string) => {
    const next = workRows.filter(r => r.id !== id);
    setWorkRows(next);
    onChange({ ...value, workHistory: next });
    const uid = auth.currentUser?.uid;
    if (uid) debouncedUpdate(doc(db, 'users', uid), { workHistory: next, updatedAt: serverTimestamp() });
  };

  const updateRow = (id: string, field: string, v: string) => {
    setWorkRows((prev) => {
      const next = prev.map(r => r.id === id ? { ...r, [field]: v } : r);
      onChange({ ...value, workHistory: next });
      const uid = auth.currentUser?.uid;
      if (uid) debouncedUpdate(doc(db, 'users', uid), { workHistory: next, updatedAt: serverTimestamp() });
      return next;
    });
  };

  const saveExpSummary = async () => {
    // Persist both summary and latest rows to avoid losing in-progress rows on re-render
    onChange({ ...value, experienceSummary: expSummary, workHistory: workRows });
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try { await updateDoc(doc(db, 'users', uid), { experienceSummary: expSummary, workHistory: workRows, updatedAt: serverTimestamp() }); } catch {}
  };

  // Helpers to convert between display MM/yyyy and input type=month (YYYY-MM)
  const toInputMonth = (val?: string) => {
    if (!val) return '';
    if (/^\d{2}\/\d{4}$/.test(val)) {
      const [mm, yyyy] = val.split('/');
      return `${yyyy}-${mm}`;
    }
    if (/^\d{4}-\d{2}$/.test(val)) return val;
    return '';
  };
  const fromInputMonth = (val?: string) => {
    if (!val) return '';
    if (/^\d{4}-\d{2}$/.test(val)) {
      const [yyyy, mm] = val.split('-');
      return `${mm}/${yyyy}`;
    }
    return '';
  };

  const languagesHelper = Array.isArray(job?.languages) && job.languages.length ? `Language Required: ${job.languages.join(', ')}` : undefined;

  

  // One-time autofill of workHistory from latest parsed resume if empty
  React.useEffect(() => {
    const run = async () => {
      if (context !== 'application') return;
      if (!showExperience) return;
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      if ((workRows || []).length > 0) return;
      // Avoid repeated autofills within this session
      if ((value && value._workHistoryPrefilled) === true) return;
      try {
        const q = query(
          collection(db, 'parsedResumes'),
          where('userId', '==', uid),
          orderBy('uploadDate', 'desc'),
          limit(1)
        );
        const snap = await getDocs(q);
        if (snap.empty) return;
        const parsed = snap.docs[0].data() as any;
        const rows = mapParsedExperienceToRows(parsed?.parsedData || {});
        if (rows.length === 0) return;
        setWorkRows(rows);
        onChange({ ...value, workHistory: rows, _workHistoryPrefilled: true });
        await updateDoc(doc(db, 'users', uid), { workHistory: rows, workHistoryAutoFilledAt: serverTimestamp(), updatedAt: serverTimestamp() });
      } catch {}
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, showExperience]);

  return (
    <Box>
      {showBio && (
        <Card variant="outlined" sx={{ mb: 3, boxShadow: isMobile ? 0 : undefined, border: isMobile ? '1px solid' : undefined, borderColor: isMobile ? 'divider' : undefined }}>
          <CardHeader
            title={<Typography variant="h6">Professional Bio</Typography>}
            action={
              <Button variant="contained" size="small" onClick={handleSaveBio} disabled={(tempBio || '') === (value?.bio || '')}>
                Save
              </Button>
            }
            sx={{ px: { xs: 2, md: 3 }, py: { xs: 1, md: 2 } }}
          />
          <CardContent sx={{ p: { xs: 2, md: 3 } }}>
            <TextField
              fullWidth
              multiline
              minRows={6}
              placeholder="Write a short bio about yourself. You can edit the one we generated from your resume."
              value={tempBio}
              onChange={handleBioChange}
            />
          </CardContent>
        </Card>
      )}

      {showExperience && (
        <Card variant="outlined" sx={{ mb: 3, boxShadow: isMobile ? 0 : undefined, border: isMobile ? '1px solid' : undefined, borderColor: isMobile ? 'divider' : undefined }}>
          <CardHeader title={<Typography variant="h6">Experience & Work History</Typography>} action={<></>} sx={{ px: { xs: 2, md: 3 }, py: { xs: 1, md: 2 } }} />
          <CardContent sx={{ p: { xs: 2, md: 3 } }}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>Tell us about your most relevant work experience</Typography>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }}>
              <TextField
                fullWidth
                multiline
                minRows={5}
                value={expSummary}
                onChange={(e) => {
                  const v = e.target.value;
                  setExpSummary(v);
                  // Keep wizard state in sync so Next button validation passes without forcing an explicit Save
                  onChange({ ...value, experienceSummary: v });
                }}
                placeholder="Describe your most relevant experience..."
              />
              <Button
                sx={{ ml: 2, whiteSpace: 'nowrap', alignSelf: 'flex-start' }}
                variant="contained"
                size="small"
                onClick={saveExpSummary}
              >
                Save
              </Button>
            </Stack>

            <Divider sx={{ my: 2 }} />

            <Stack spacing={1} sx={{ mb: 2 }}>
              {workRows.map((row) => (
                <Stack key={row.id} direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'stretch', md: 'center' }}>
                  <TextField label="Employer" value={row.employer} onChange={(e) => updateRow(row.id, 'employer', e.target.value)} onBlur={(e) => updateRow(row.id, 'employer', e.target.value)} sx={{ flex: 2 }} />
                  <TextField label="Job Title" value={row.title} onChange={(e) => updateRow(row.id, 'title', e.target.value)} onBlur={(e) => updateRow(row.id, 'title', e.target.value)} sx={{ flex: 2 }} />
                  <TextField
                    label="Start Date"
                    type="month"
                    value={toInputMonth(row.startDate)}
                    onChange={(e) => updateRow(row.id, 'startDate', fromInputMonth(e.target.value))}
                    sx={{ flex: 1 }}
                    InputLabelProps={{ shrink: true }}
                    inputProps={{ autoComplete: 'off' }}
                  />
                  <TextField
                    label="End Date"
                    type="month"
                    value={toInputMonth(row.endDate)}
                    onChange={(e) => updateRow(row.id, 'endDate', fromInputMonth(e.target.value))}
                    sx={{ flex: 1 }}
                    InputLabelProps={{ shrink: true }}
                    inputProps={{ autoComplete: 'off' }}
                  />
                  <Button color="error" onClick={() => removeWorkRow(row.id)}>Delete</Button>
                </Stack>
              ))}
            </Stack>
            <Button variant="outlined" size="small" onClick={addWorkRow}>Add Work History</Button>
          </CardContent>
        </Card>
      )}

      {/* Skills 
         - Keep only core skills here
         - Hide Industry, Education, Work Experience, Certs/References to avoid duplication on Application */}
      <SkillsTab
        user={userData}
        onUpdate={(updated) => onChange({ ...value, ...updated })}
        onetSkills={onetSkills as any}
        onetJobTitles={onetJobTitles as any}
        hideCertsAndReferences={true}
        hideIndustryPreferences={true}
        hideEducation={true}
        hideWorkExperience={true}
        hideLanguages={true}
      />

      {/* Conditional Languages */}
      {showLanguages && (
        <Card variant="outlined" sx={{ mt: 3, boxShadow: isMobile ? 0 : undefined, border: isMobile ? '1px solid' : undefined, borderColor: isMobile ? 'divider' : undefined }}>
          <CardHeader title={<Typography variant="h6">Languages</Typography>} sx={{ px: { xs: 2, md: 3 }, py: { xs: 1, md: 2 } }} />
          <CardContent sx={{ p: { xs: 2, md: 3 } }}>
            {languagesHelper && (
              <Alert severity="info" sx={{ mb: 2 }}>
                {languagesHelper}
              </Alert>
            )}
            
            
            <Grid container spacing={2}>
              {/* Selected Languages */}
              <Grid item xs={12} md={8}>
                <Typography variant="subtitle2" gutterBottom>
                  Selected languages
                </Typography>
                <Box display="flex" flexWrap="wrap" gap={1}>
                  {userLanguages.map((lang) => (
                    <Chip
                      key={lang}
                      label={lang}
                      onDelete={() => {
                        const newLanguages = userLanguages.filter(l => l !== lang);
                        setUserLanguages(newLanguages);
                        onChange({ ...value, languages: newLanguages });
                        const uid = auth.currentUser?.uid;
                        if (uid) debouncedUpdate(doc(db, 'users', uid), { languages: newLanguages, updatedAt: serverTimestamp() });
                      }}
                      color="primary"
                      variant="filled"
                      icon={<CheckCircle fontSize="small" />}
                      sx={{
                        '& .MuiChip-icon': { color: 'inherit' },
                      }}
                    />
                  ))}
                </Box>
              </Grid>
              
              {/* Suggested Languages */}
              <Grid item xs={12} md={4}>
                <Typography variant="subtitle2" gutterBottom>
                  Suggested languages (tap to add)
                </Typography>
                <Box display="flex" flexWrap="wrap" gap={1}>
                  {[
                    'English','Spanish','French','German','Italian','Portuguese','Chinese','Japanese','Korean','Arabic','Russian','Hindi','Dutch','Swedish','Norwegian','Danish','Finnish','Polish','Czech','Hungarian','Greek','Turkish','Hebrew','Thai','Vietnamese','Indonesian','Malay','Tagalog'
                  ].map((lang) => (
                    <Chip
                      key={lang}
                      label={lang}
                      onClick={() => {
                        if (userLanguages.includes(lang)) return;
                        const newLanguages = [...userLanguages, lang];
                        setUserLanguages(newLanguages);
                        onChange({ ...value, languages: newLanguages });
                        const uid = auth.currentUser?.uid;
                        if (uid) debouncedUpdate(doc(db, 'users', uid), { languages: newLanguages, updatedAt: serverTimestamp() });
                      }}
                      size="small"
                      variant="outlined"
                      sx={{
                        cursor: userLanguages.includes(lang) ? 'default' : 'pointer',
                        opacity: userLanguages.includes(lang) ? 0.5 : 1,
                      }}
                    />
                  ))}
                </Box>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      )}

    </Box>
  );
};

export default QualificationsStep;


