import React, { useMemo, useRef, useState } from 'react';
import { Box, Checkbox, FormControlLabel, Stack, Typography, Button } from '@mui/material';
import { storage, db } from '../../../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { arrayUnion, doc, serverTimestamp, updateDoc } from 'firebase/firestore';

type Props = {
  requirements: {
    licenses?: string[];
    certifications?: string[];
    screenings?: string[];
    ppe?: string[];
    physical?: string[];
  };
  profile?: any;
  uid: string;
  value: any;
  onChange: (v: any) => void;
};

const RequirementsAcknowledgementStep: React.FC<Props> = ({ requirements, profile, uid, value, onChange }) => {
  const acks = value?.acks || {};
  const setAck = (name: string, checked: boolean) => onChange({ ...value, acks: { ...(value?.acks || {}), [name]: checked } });
  const setUploaded = (name: string) => onChange({ ...value, uploaded: { ...(value?.uploaded || {}), [name]: true } });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingCert, setPendingCert] = useState<string | null>(null);
  const [uploading, setUploading] = useState<Record<string, boolean>>({});

  const profileCerts: string[] = Array.isArray(profile?.certifications)
    ? profile.certifications.map((c: any) => (typeof c === 'string' ? c : c?.name)).filter(Boolean)
    : [];

  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  const handlePickFile = (name: string) => {
    setPendingCert(name);
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = e.target.files && e.target.files[0];
      if (!file || !pendingCert) return;
      setUploading((u) => ({ ...u, [pendingCert]: true }));
      const certSlug = slugify(pendingCert);
      const path = `users/${uid}/certifications/${certSlug}/${Date.now()}-${file.name}`;
      const fileRef = ref(storage, path);
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);

      // Append metadata into user profile
      const userRef = doc(db, 'users', uid);
      await updateDoc(userRef, {
        certifications: arrayUnion({
          name: pendingCert,
          fileUrl: url,
          fileName: file.name,
          uploadedAt: serverTimestamp(),
        })
      });

      // Mark requirement satisfied
      setUploaded(pendingCert);
    } catch (err) {
      console.warn('Certification upload failed:', err);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
      setUploading((u) => (pendingCert ? { ...u, [pendingCert]: false } : u));
      setPendingCert(null);
    }
  };

  return (
    <Box>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>Please review required items for this job and acknowledge</Typography>
      <Stack spacing={2} sx={{ mb: 2 }}>
        {(requirements.certifications || []).map((name) => (
          <Stack key={`cert-${name}`} direction="row" alignItems="center" spacing={1}>
            <FormControlLabel
              disabled
              control={<Checkbox checked={profileCerts.includes(name) || !!(value?.uploaded || {})[name]} />}
              label={`Certification: ${name} ${profileCerts.includes(name) ? '(on profile)' : ''}`}
            />
            {!profileCerts.includes(name) && (
              <Button size="small" variant="outlined" onClick={() => handlePickFile(name)} disabled={!!uploading[name]}>
                {uploading[name] ? 'Uploading…' : 'Upload'}
              </Button>
            )}
          </Stack>
        ))}
        {(requirements.screenings || []).map((name) => (
          <FormControlLabel
            key={`screen-${name}`}
            control={<Checkbox checked={!!acks[name]} onChange={(e) => setAck(name, e.target.checked)} />}
            label={`Screening: ${name}`}
          />
        ))}
        {(requirements.ppe || []).map((name) => (
          <FormControlLabel
            key={`ppe-${name}`}
            control={<Checkbox checked={!!acks[name]} onChange={(e) => setAck(name, e.target.checked)} />}
            label={`PPE: ${name}`}
          />
        ))}
        {(requirements.physical || []).map((name) => (
          <FormControlLabel
            key={`phys-${name}`}
            control={<Checkbox checked={!!acks[name]} onChange={(e) => setAck(name, e.target.checked)} />}
            label={`Physical: ${name}`}
          />
        ))}
      </Stack>
      <Typography variant="caption" color="text.secondary">
        Note: Required items must be acknowledged or uploaded before submission.
      </Typography>

      {/* Hidden file input used for uploads */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
      />
    </Box>
  );
};

export default RequirementsAcknowledgementStep;


