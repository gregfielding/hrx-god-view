import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Accordion, AccordionSummary, AccordionDetails, Switch, TextField, Button, FormControlLabel, Select, MenuItem, InputLabel, FormControl, Snackbar, Alert, Slider, Tabs, Tab, Checkbox, OutlinedInput, TableContainer, Table, TableHead, TableBody, TableRow, Paper, TableCell
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, addDoc, deleteDoc } from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db } from '../../../firebase';

const AISettingsTab: React.FC<{ customerId: string }> = ({ customerId }) => {
  // Tab state
  const [tabIndex, setTabIndex] = useState(0);

  // Company Profiling state
  const [companyProfile, setCompanyProfile] = useState({
    website: '',
    linkedin: '',
    social: '',
    mediaFile: null as File | null,
    autoGenerate: false,
    preview: '',
  });
  const [originalCompanyProfile, setOriginalCompanyProfile] = useState(companyProfile);
  const [uploading, setUploading] = useState(false);

  // Example state for a few settings
  const [privacy, setPrivacy] = useState({
    managersCanView: true,
    workersCanView: false,
  });
  const [originalPrivacy, setOriginalPrivacy] = useState(privacy);
  const [toneLevel, setToneLevel] = useState(5);
  const [originalToneLevel, setOriginalToneLevel] = useState(5);
  const [language, setLanguage] = useState('English');
  const [promptFrequency, setPromptFrequency] = useState('Daily');
  const [goalOrientation, setGoalOrientation] = useState('Retention');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(true);

  // Social posts state
  const [postForm, setPostForm] = useState({ title: '', body: '' });
  const [socialPosts, setSocialPosts] = useState<any[]>([]);
  // HR docs state
  const [docForm, setDocForm] = useState({ title: '', file: null as File | null });
  const [docs, setDocs] = useState<any[]>([]);
  const storage = getStorage();

  // Fetch settings on mount
  useEffect(() => {
    const fetchSettings = async () => {
      setLoading(true);
      try {
        const settingsRef = doc(db, 'customers', customerId, 'aiSettings', 'settings');
        const snap = await getDoc(settingsRef);
        if (snap.exists()) {
          const data = snap.data();
          const loadedPrivacy = {
            managersCanView: data.privacy?.managersCanView ?? privacy.managersCanView,
            workersCanView: data.privacy?.workersCanView ?? privacy.workersCanView,
          };
          setPrivacy(loadedPrivacy);
          setOriginalPrivacy(loadedPrivacy);
          setToneLevel(data.toneLevel || 5);
          setOriginalToneLevel(data.toneLevel || 5);
          setLanguage(data.language || language);
          setPromptFrequency(data.promptFrequency || promptFrequency);
          setGoalOrientation(data.goalOrientation || goalOrientation);
        }
        // Fetch company profile
        const profileRef = doc(db, 'customers', customerId, 'aiSettings', 'companyProfile');
        const profileSnap = await getDoc(profileRef);
        if (profileSnap.exists()) {
          const pdata = profileSnap.data();
          setCompanyProfile({
            website: pdata.website || '',
            linkedin: pdata.linkedin || '',
            social: pdata.social || '',
            mediaFile: null,
            autoGenerate: pdata.autoGenerate || false,
            preview: pdata.preview || '',
          });
          setOriginalCompanyProfile({
            website: pdata.website || '',
            linkedin: pdata.linkedin || '',
            social: pdata.social || '',
            mediaFile: null,
            autoGenerate: pdata.autoGenerate || false,
            preview: pdata.preview || '',
          });
        }
        // Fetch social posts
        const postsSnap = await getDocs(collection(db, 'customers', customerId, 'aiSettings', 'socialPosts'));
        setSocialPosts(postsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        // Fetch docs
        const docsSnap = await getDocs(collection(db, 'customers', customerId, 'aiSettings', 'docs'));
        setDocs(docsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch (err) {
        // ignore for now
      }
      setLoading(false);
    };
    fetchSettings();
    // eslint-disable-next-line
  }, [customerId]);

  // Save handler for company profile
  const handleCompanyProfileSave = async () => {
    setUploading(true);
    try {
      const profileRef = doc(db, 'customers', customerId, 'aiSettings', 'companyProfile');
      // TODO: handle media upload if needed
      await setDoc(profileRef, {
        website: companyProfile.website,
        linkedin: companyProfile.linkedin,
        social: companyProfile.social,
        autoGenerate: companyProfile.autoGenerate,
        preview: companyProfile.preview,
      }, { merge: true });
      setOriginalCompanyProfile({ ...companyProfile });
      setSuccess(true);
    } catch (err) {
      // handle error
    }
    setUploading(false);
  };

  // Save handler for all settings
  const handleSave = async (fields?: Partial<any>) => {
    setLoading(true);
    try {
      const settingsRef = doc(db, 'customers', customerId, 'aiSettings', 'settings');
      await setDoc(settingsRef, {
        privacy,
        toneLevel,
        language,
        promptFrequency,
        goalOrientation,
        ...fields,
      }, { merge: true });
      setSuccess(true);
    } catch (err) {
      // handle error
    }
    setLoading(false);
  };

  // Company Profiling form change
  const handleCompanyProfileChange = (field: string, value: any) => {
    setCompanyProfile((prev) => ({ ...prev, [field]: value }));
  };

  // Company Profiling save button enabled only if changes
  const isCompanyProfileChanged = JSON.stringify(companyProfile) !== JSON.stringify(originalCompanyProfile);

  // Social post handlers
  const handlePostSave = async () => {
    if (!postForm.title || !postForm.body) return;
    try {
      await addDoc(collection(db, 'customers', customerId, 'aiSettings', 'socialPosts'), postForm);
      setPostForm({ title: '', body: '' });
      const postsSnap = await getDocs(collection(db, 'customers', customerId, 'aiSettings', 'socialPosts'));
      setSocialPosts(postsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch {}
  };
  const handlePostDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'customers', customerId, 'aiSettings', 'socialPosts', id));
      setSocialPosts(socialPosts.filter(p => p.id !== id));
    } catch {}
  };

  // HR doc handlers
  const handleDocSave = async () => {
    if (!docForm.title || !docForm.file) return;
    try {
      const fileRef = storageRef(storage, `customers/${customerId}/aiSettings/docs/${Date.now()}_${docForm.file.name}`);
      await uploadBytes(fileRef, docForm.file);
      const url = await getDownloadURL(fileRef);
      await addDoc(collection(db, 'customers', customerId, 'aiSettings', 'docs'), {
        title: docForm.title,
        fileName: docForm.file.name,
        url,
        storagePath: fileRef.fullPath,
      });
      setDocForm({ title: '', file: null });
      const docsSnap = await getDocs(collection(db, 'customers', customerId, 'aiSettings', 'docs'));
      setDocs(docsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch {}
  };
  const handleDocDelete = async (id: string, storagePath: string) => {
    try {
      await deleteDoc(doc(db, 'customers', customerId, 'aiSettings', 'docs', id));
      await deleteObject(storageRef(storage, storagePath));
      setDocs(docs.filter(d => d.id !== id));
    } catch {}
  };

  return (
    <Box sx={{ p: 2, width: '100%' }}>
      <>
      <Box mb={3}>
        <Typography variant="subtitle1" fontWeight={600}>What information is collected?</Typography>
        <ul>
          <li>Identity & Profile Data</li>
          <li>Engagement & Sentiment Data</li>
          <li>Behavioral & Interaction Data</li>
          <li>Professional Development</li>
          <li>Workplace Support & Needs</li>
          <li>Recognition & Achievement</li>
          <li>Health & Wellness (optional)</li>
        </ul>
      </Box>
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={600}>Privacy & Transparency Controls</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Admins will always have access to Reports and Insights.
          </Typography>
          <FormControlLabel
            control={<Switch checked={privacy.managersCanView} onChange={e => setPrivacy(p => ({ ...p, managersCanView: e.target.checked }))} />}
            label="Managers can view Reports and Insights"
          />
          <FormControlLabel
            control={<Switch checked={privacy.workersCanView} onChange={e => setPrivacy(p => ({ ...p, workersCanView: e.target.checked }))} />}
            label="Workers can view their own Reports and Insights"
          />
          <Button
            variant="contained"
            sx={{ mt: 2 }}
            onClick={handleSave}
            disabled={loading || JSON.stringify(privacy) === JSON.stringify(originalPrivacy)}
          >
            Save
          </Button>
        </AccordionDetails>
      </Accordion>
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={600}>Tone & Language of AI</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Typography gutterBottom>
            Tone: {toneLevel <= 5 ? 'Friendly' : 'Formal'} ({toneLevel})
          </Typography>
          <Slider
            value={toneLevel}
            min={1}
            max={10}
            step={1}
            marks={false}
            onChange={(_, newValue) => setToneLevel(newValue as number)}
            onChangeCommitted={(_, newValue) => handleSave({ toneLevel: newValue })}
            sx={{ mb: 0, pb: 0, '&.MuiSlider-root': { paddingBottom: 0, marginBottom: 0 } }}
          />
          <Box display="flex" justifyContent="space-between" sx={{ mt: 0.5, mb: 1 }}>
            <Typography variant="body2">Friendly</Typography>
            <Typography variant="body2">Formal</Typography>
          </Box>
          <TextField
            label="Language"
            value="English"
            fullWidth
            disabled
            helperText="Web app is English-only. Language options are available in the mobile app."
            sx={{ mb: 2 }}
          />
        </AccordionDetails>
      </Accordion>
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={600}>Prompt Frequency & Focus</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel id="prompt-frequency-label">Prompt Frequency</InputLabel>
            <Select labelId="prompt-frequency-label" value={promptFrequency} label="Prompt Frequency" onChange={e => setPromptFrequency(e.target.value)}>
              <MenuItem value="Daily">Daily</MenuItem>
              <MenuItem value="Weekly">Weekly</MenuItem>
              <MenuItem value="Event-based">Event-based</MenuItem>
            </Select>
          </FormControl>
          <Button variant="contained" sx={{ mt: 2 }} onClick={handleSave}>Save</Button>
        </AccordionDetails>
      </Accordion>
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={600}>Goal Orientation</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <FormControl fullWidth>
            <InputLabel id="goal-orientation-label">Goal Orientation</InputLabel>
            <Select labelId="goal-orientation-label" value={goalOrientation} label="Goal Orientation" onChange={e => setGoalOrientation(e.target.value)}>
              <MenuItem value="Retention">Retention</MenuItem>
              <MenuItem value="Engagement">Engagement</MenuItem>
              <MenuItem value="Training">Training</MenuItem>
              <MenuItem value="Wellness">Wellness</MenuItem>
            </Select>
          </FormControl>
          <Button variant="contained" sx={{ mt: 2 }} onClick={handleSave}>Save</Button>
        </AccordionDetails>
      </Accordion>
      {/* Scaffold for future sections */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={600}>Visual & Brand Settings</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Typography>Coming soon...</Typography>
        </AccordionDetails>
      </Accordion>
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={600}>Module Activation & Control</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Typography>Coming soon...</Typography>
        </AccordionDetails>
      </Accordion>
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={600}>Reporting & Alerts</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Typography>Coming soon...</Typography>
        </AccordionDetails>
      </Accordion>
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={600}>Custom Prompts Library</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Typography>Coming soon...</Typography>
        </AccordionDetails>
      </Accordion>
      </>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>Settings updated!</Alert>
      </Snackbar>
    </Box>
  );
};

export default AISettingsTab; 