import React, { useEffect, useMemo, useState } from 'react';
import { Box, Typography, Stack, Divider, TextField, Button, IconButton, Paper } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, storage } from '../../firebase';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { experienceOptions, educationOptions } from '../../data/experienceOptions';

type Props = { tenantId: string };

type OptionItem = { title: string; description?: string };
type UniformRequirement = { title: string; description: string; imageUrl?: string };
type PolicyItem = { title: string; description: string; fileUrl?: string };

type Defaults = {
  screeningPanels: OptionItem[];
  backgroundPackages: OptionItem[];
  languages: OptionItem[];
  skills: OptionItem[];
  ppe: OptionItem[];
  licenses: OptionItem[];
  certifications: OptionItem[];
  experienceLevels: OptionItem[];
  educationLevels: OptionItem[];
  physicalRequirements: OptionItem[];
  uniformRequirements: UniformRequirement[];
  injuryPolicies: PolicyItem[];
};

const DEFAULTS_DOC_ID = 'company-defaults';

const asItems = (titles: string[]): OptionItem[] => titles.map(t => ({ title: t }));

const emptyDefaults: Defaults = {
  screeningPanels: asItems(['4-Panel', '5-Panel', '7-Panel', '10-Panel']),
  backgroundPackages: asItems(['County 7-year', 'Federal + County', 'Statewide']),
  languages: asItems(['English', 'Spanish', 'French', 'German', 'Mandarin', 'Portuguese']),
  skills: asItems(['Forklift', 'Packing', 'Shipping/Receiving', 'Data Entry']),
  ppe: asItems(['Hard Hat', 'Safety Glasses', 'Steel Toe Boots', 'Gloves']),
  licenses: asItems(['Driver License', 'Forklift Certification', 'TWIC Card']),
  certifications: asItems(['OSHA 10', 'OSHA 30', 'CPR/First Aid']),
  experienceLevels: experienceOptions.map(option => ({ title: option.label, description: option.description })),
  educationLevels: educationOptions.map(option => ({ title: option.label, description: option.description })),
  physicalRequirements: asItems(['Standing', 'Walking', 'Lifting 25 lbs', 'Lifting 50 lbs']),
  uniformRequirements: [
    { title: 'Steel Toe Boots', description: 'Employee provides steel toe boots' },
  ],
  injuryPolicies: [],
};

const Section: React.FC<{ title: string; items: OptionItem[]; onAdd: (v: OptionItem) => void; onRemove: (index: number) => void; titlePlaceholder: string; descPlaceholder?: string }>
  = ({ title, items, onAdd, onRemove, titlePlaceholder, descPlaceholder }) => {
  const [value, setValue] = useState('');
  const [desc, setDesc] = useState('');
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
        <Typography variant="h6" fontWeight={700}>{title}</Typography>
        <Stack direction="row" spacing={1}>
          <TextField size="small" placeholder={titlePlaceholder} value={value} onChange={(e) => setValue(e.target.value)} />
          <TextField size="small" placeholder={descPlaceholder || 'Description (optional)'} value={desc} onChange={(e) => setDesc(e.target.value)} />
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => { if (value.trim()) { onAdd({ title: value.trim(), description: desc.trim() || undefined }); setValue(''); setDesc(''); } }}>Add</Button>
        </Stack>
      </Stack>
      <Stack spacing={1}>
        {items.map((item, idx) => (
          <Paper key={`${item.title}-${idx}`} variant="outlined" sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box>
              <Typography variant="subtitle2" fontWeight={700}>{item.title}</Typography>
              {item.description && <Typography variant="body2" color="text.secondary">{item.description}</Typography>}
            </Box>
            <IconButton aria-label="remove" onClick={() => onRemove(idx)} size="small"><DeleteIcon fontSize="small" /></IconButton>
          </Paper>
        ))}
      </Stack>
    </Box>
  );
};

const CompanyDefaultsTab: React.FC<Props> = ({ tenantId }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [defaults, setDefaults] = useState<Defaults>(emptyDefaults);

  const docRef = useMemo(() => doc(db, 'tenants', tenantId, 'settings', DEFAULTS_DOC_ID), [tenantId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(docRef);
        if (!cancelled) {
          if (snap.exists()) {
            const data = snap.data() as Partial<Defaults>;
            setDefaults({ ...emptyDefaults, ...data });
          } else {
            setDefaults(emptyDefaults);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [docRef]);

  const addItem = (key: keyof Defaults, item: OptionItem) => setDefaults(prev => ({ ...prev, [key]: ([...(prev[key] as any[]), item]) as any }));
  const removeItem = (key: keyof Defaults, index: number) => setDefaults(prev => ({ ...prev, [key]: ([...(prev[key] as any[])].filter((_: any, i: number) => i !== index)) as any }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await setDoc(docRef, defaults, { merge: true });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Typography variant="body2">Loading defaults…</Typography>;

  return (
    <Box sx={{ p: 0, width: '100%' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h6" fontWeight={700}>Company Defaults</Typography>
        <Button variant="contained" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Defaults'}</Button>
      </Stack>
      <Divider sx={{ my: 2 }} />
      <Stack spacing={3}>
        <Section title="Required Licenses" items={defaults.licenses} onAdd={(v) => addItem('licenses', v)} onRemove={(i) => removeItem('licenses', i)} titlePlaceholder="e.g., Driver License" />
        <Divider />
        <Section title="Required Certifications" items={defaults.certifications} onAdd={(v) => addItem('certifications', v)} onRemove={(i) => removeItem('certifications', i)} titlePlaceholder="e.g., OSHA 10" />
        <Divider />
        <Section title="Experience Levels" items={defaults.experienceLevels} onAdd={(v) => addItem('experienceLevels', v)} onRemove={(i) => removeItem('experienceLevels', i)} titlePlaceholder="e.g., 3-5 years" />
        <Divider />
        <Section title="Education Levels" items={defaults.educationLevels} onAdd={(v) => addItem('educationLevels', v)} onRemove={(i) => removeItem('educationLevels', i)} titlePlaceholder="e.g., High School / GED" />
        <Divider />
        <Section title="Drug Screening Panels" items={defaults.screeningPanels} onAdd={(v) => addItem('screeningPanels', v)} onRemove={(i) => removeItem('screeningPanels', i)} titlePlaceholder="e.g., 10-Panel" />
        <Divider />
        <Section title="Background Check Packages" items={defaults.backgroundPackages} onAdd={(v) => addItem('backgroundPackages', v)} onRemove={(i) => removeItem('backgroundPackages', i)} titlePlaceholder="e.g., County 7-year" />
        <Divider />
        <Section title="Physical Requirements" items={defaults.physicalRequirements} onAdd={(v) => addItem('physicalRequirements', v)} onRemove={(i) => removeItem('physicalRequirements', i)} titlePlaceholder="e.g., Lifting 50 lbs" />
        <Divider />
        <Section title="Languages" items={defaults.languages} onAdd={(v) => addItem('languages', v)} onRemove={(i) => removeItem('languages', i)} titlePlaceholder="e.g., Spanish" />
        <Divider />
        <Section title="Skills" items={defaults.skills} onAdd={(v) => addItem('skills', v)} onRemove={(i) => removeItem('skills', i)} titlePlaceholder="e.g., Forklift" />
        <Divider />
        <Section title="PPE" items={defaults.ppe} onAdd={(v) => addItem('ppe', v)} onRemove={(i) => removeItem('ppe', i)} titlePlaceholder="e.g., Safety Glasses" />
        <Divider />
        <Typography variant="h6" fontWeight={700}>Uniform Requirements</Typography>
        <UniformSection tenantId={tenantId} items={defaults.uniformRequirements} onAdd={(req) => setDefaults(prev => ({ ...prev, uniformRequirements: [...prev.uniformRequirements, req] }))} onRemove={(idx) => setDefaults(prev => ({ ...prev, uniformRequirements: prev.uniformRequirements.filter((_, i) => i !== idx) }))} />
        <Divider />
        <Typography variant="h6" fontWeight={700}>Injury Policies</Typography>
        <PolicySection tenantId={tenantId} items={defaults.injuryPolicies} onAdd={(p) => setDefaults(prev => ({ ...prev, injuryPolicies: [...prev.injuryPolicies, p] }))} onRemove={(idx) => setDefaults(prev => ({ ...prev, injuryPolicies: prev.injuryPolicies.filter((_, i) => i !== idx) }))} />
      </Stack>
    </Box>
  );
};

const UniformSection: React.FC<{ tenantId: string; items: UniformRequirement[]; onAdd: (req: UniformRequirement) => void; onRemove: (index: number) => void }>
  = ({ tenantId, items, onAdd, onRemove }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const uploadImageIfNeeded = async (): Promise<string | undefined> => {
    if (!file) return undefined;
    const path = `tenants/${tenantId}/settings/uniforms/${Date.now()}_${file.name}`;
    const ref = storageRef(storage, path);
    await uploadBytes(ref, file);
    const url = await getDownloadURL(ref);
    return url;
  };
  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" mb={1}>
        <TextField size="small" label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <TextField size="small" label="Description" value={description} onChange={(e) => setDescription(e.target.value)} sx={{ minWidth: 360 }} />
        <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <Button 
          variant="contained" 
          startIcon={<AddIcon />} 
          onClick={async () => { 
            if (title.trim()) { 
              const imageUrl = await uploadImageIfNeeded(); 
              onAdd({ title: title.trim(), description: description.trim(), imageUrl }); 
              setTitle(''); setDescription(''); setFile(null); 
            } 
          }}
        >
          Add
        </Button>
      </Stack>
      <Stack spacing={1}>
        {items.map((it, idx) => (
          <Paper variant="outlined" key={`${it.title}-${idx}`} sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box>
              <Typography variant="subtitle2" fontWeight={700}>{it.title}</Typography>
              {it.description && (
                <Typography variant="body2" color="text.secondary">{it.description}</Typography>
              )}
              {it.imageUrl && (
                <Box mt={1}>
                  <img src={it.imageUrl} alt={it.title} style={{ maxHeight: 80, borderRadius: 4 }} />
                </Box>
              )}
            </Box>
            <IconButton aria-label="remove" onClick={() => onRemove(idx)} size="small"><DeleteIcon fontSize="small" /></IconButton>
          </Paper>
        ))}
      </Stack>
    </Box>
  );
};

export default CompanyDefaultsTab;

// Policy upload section (title, desc, file)
const PolicySection: React.FC<{ tenantId: string; items: PolicyItem[]; onAdd: (p: PolicyItem) => void; onRemove: (index: number) => void }>
  = ({ tenantId, items, onAdd, onRemove }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const upload = async (): Promise<string | undefined> => {
    if (!file) return undefined;
    const path = `tenants/${tenantId}/settings/policies/${Date.now()}_${file.name}`;
    const ref = storageRef(storage, path);
    await uploadBytes(ref, file);
    return await getDownloadURL(ref);
  };

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" mb={1}>
        <TextField size="small" label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <TextField size="small" label="Description" value={description} onChange={(e) => setDescription(e.target.value)} sx={{ minWidth: 360 }} />
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <Button variant="contained" startIcon={<AddIcon />} onClick={async () => {
          if (!title.trim()) return;
          const fileUrl = await upload();
          onAdd({ title: title.trim(), description: description.trim(), fileUrl });
          setTitle(''); setDescription(''); setFile(null);
        }}>Add</Button>
      </Stack>
      <Stack spacing={1}>
        {items.map((it, idx) => (
          <Paper key={`${it.title}-${idx}`} variant="outlined" sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box>
              <Typography variant="subtitle2" fontWeight={700}>{it.title}</Typography>
              <Typography variant="body2" color="text.secondary">{it.description}</Typography>
              {it.fileUrl && (
                <Typography variant="body2" sx={{ mt: 0.5 }}><a href={it.fileUrl} target="_blank" rel="noreferrer">View file</a></Typography>
              )}
            </Box>
            <IconButton aria-label="remove" onClick={() => onRemove(idx)} size="small"><DeleteIcon fontSize="small" /></IconButton>
          </Paper>
        ))}
      </Stack>
    </Box>
  );
};

