import React, { useMemo, useRef, useState } from 'react';
import { Box, Stack, Typography, Button, Card, CardContent, CardHeader, TextField, MenuItem } from '@mui/material';
import { storage, db } from '../../../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { arrayUnion, doc, serverTimestamp, updateDoc, getDoc } from 'firebase/firestore';

type Props = {
  requirements: {
    licenses?: string[];
    certifications?: string[];
    screenings?: string[];
    ppe?: string[];
    physical?: string[];
    education?: string[];
  };
  profile?: any;
  uid: string;
  value: any;
  onChange: (v: any) => void;
  jobPosting?: any;
};

const RequirementsAcknowledgementStep: React.FC<Props> = ({ requirements, profile, uid, value, onChange, jobPosting }) => {
  const setUploaded = (name: string) => onChange({ ...value, uploaded: { ...(value?.uploaded || {}), [name]: true } });
  const clearUploaded = (name: string) => {
    const uploaded = { ...(value?.uploaded || {}) } as Record<string, boolean>;
    delete uploaded[name];
    onChange({ ...value, uploaded });
  };
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingCert, setPendingCert] = useState<string | null>(null);
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const showLicensesCerts = jobPosting?.showLicensesCerts === true;
  const showDrugScreening = jobPosting?.showDrugScreening === true;
  const showBackgroundScreening = jobPosting?.showBackgroundChecks === true;
  const showAdditionalScreenings = jobPosting?.showAdditionalScreenings === true;
  const showEVerify = jobPosting?.eVerifyRequired === true;

  // Debounced write to users/{uid}
  const userWriteDebounceRef = useRef<any>(null);
  const debouncedWriteUser = (partial: any) => {
    if (userWriteDebounceRef.current) clearTimeout(userWriteDebounceRef.current);
    userWriteDebounceRef.current = setTimeout(async () => {
      try {
        const userRef = doc(db, 'users', uid);
        await updateDoc(userRef, { ...partial, updatedAt: serverTimestamp() });
      } catch {}
    }, 350);
  };

  const profileCerts: string[] = Array.isArray(profile?.certifications)
    ? profile.certifications.map((c: any) => (typeof c === 'string' ? c : c?.name)).filter(Boolean)
    : [];

  // Map uploaded certification objects by requirement name for easy lookup
  const initialUploadsByName: Record<string, any[]> = useMemo(() => {
    const out: Record<string, any[]> = {};
    if (Array.isArray(profile?.certifications)) {
      for (const c of profile.certifications) {
        if (c && typeof c === 'object' && c.name) {
          const key = String(c.name);
          if (!out[key]) out[key] = [];
          out[key].push(c);
        }
      }
    }
    return out;
  }, [profile]);

  const [uploadsByName, setUploadsByName] = useState<Record<string, any[]>>(initialUploadsByName);

  const toDate = (v: any): Date | undefined => {
    if (!v) return undefined;
    if (v instanceof Date) return v;
    // Firestore Timestamp
    if (typeof v === 'object' && typeof v.toDate === 'function') return v.toDate();
    if (typeof v === 'string' || typeof v === 'number') return new Date(v as any);
    return undefined;
  };

  const formatDateTime = (v: any) => {
    const d = toDate(v);
    return d ? d.toLocaleString() : '';
  };

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

      // Upsert metadata into user profile (keep only latest for this requirement name)
      const userRef = doc(db, 'users', uid);
      const certObj = {
        name: pendingCert,
        fileUrl: url,
        fileName: file.name,
        uploadedAt: new Date(),
      } as any;
      await updateDoc(userRef, { certifications: arrayUnion(certObj), updatedAt: serverTimestamp() });

      // Mark requirement satisfied
      setUploaded(pendingCert);
      setUploadsByName((prev) => ({ ...prev, [pendingCert]: [ ...(prev[pendingCert] || []), { ...certObj, uploadedAt: new Date() } ] }));
    } catch (err) {
      console.warn('Certification upload failed:', err);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
      setUploading((u) => (pendingCert ? { ...u, [pendingCert]: false } : u));
      setPendingCert(null);
    }
  };

  const handleDelete = async (name: string, obj: any) => {
    try {
      const userRef = doc(db, 'users', uid);
      const snap = await getDoc(userRef);
      const data = snap.exists() ? (snap.data() as any) : {};
      const current: any[] = Array.isArray(data?.certifications) ? data.certifications : [];
      const filtered = current.filter((c: any) => c?.fileUrl !== obj?.fileUrl);
      await updateDoc(userRef, { certifications: filtered, updatedAt: serverTimestamp() });
    } catch (err) {
      console.warn('Certification delete failed:', err);
    } finally {
      setUploadsByName((prev) => {
        const next = { ...prev } as Record<string, any[]>;
        next[name] = (next[name] || []).filter((o) => !(o.fileUrl === obj.fileUrl && o.fileName === obj.fileName));
        if ((next[name] || []).length === 0 && !profileCerts.includes(name)) {
          clearUploaded(name);
        }
        return next;
      });
    }
  };

  return (
    <Box>
      <Stack spacing={2} sx={{ mb: 2 }}>
        {showEVerify && (
          <Card variant="outlined">
            <CardHeader
              title={<Typography variant="h6" sx={{ fontWeight: 700 }}>E-Verify</Typography>}
              action={<Box component="img" src="/img/everify.png" alt="E-Verify" sx={{ height: 28, width: 'auto' }} />}
            />
            <CardContent>
              <Stack spacing={2}>
                <Typography color="text.secondary">
                  This position requires that employees be E-Verified. This process involves matching your social security number with tax records and other government documents to confirm your identity. Are you comfortable with us running you through E-Verify?
                </Typography>
                <TextField
                  select
                  size="small"
                  label="Are you comfortable with E-Verify?"
                  value={value?.eVerifyComfort || ''}
                  onChange={(e) => { onChange({ ...value, eVerifyComfort: e.target.value }); debouncedWriteUser({ comfortableEVerify: e.target.value }); }}
                  sx={{ maxWidth: 360 }}
                >
                  <MenuItem value="">Select an option</MenuItem>
                  <MenuItem value="Yes">Yes</MenuItem>
                  <MenuItem value="No">No</MenuItem>
                  <MenuItem value="Maybe">Maybe</MenuItem>
                </TextField>
              </Stack>
            </CardContent>
          </Card>
        )}
        {/* Drug Screening summary card */}
        {showDrugScreening && (
          <Card variant="outlined">
            <CardHeader title={<Typography variant="h6" sx={{ fontWeight: 700 }}>Drug Screening</Typography>} />
            <CardContent>
              <Stack spacing={2}>
                <Typography color="text.secondary">
                  This position requires a drug screening. Are you comfortable that you would pass a drug screening?
                </Typography>
                <TextField
                  select
                  size="small"
                  label="Would you pass a drug screening?"
                  value={value?.drugScreeningComfort || ''}
                  onChange={(e) => { onChange({ ...value, drugScreeningComfort: e.target.value }); debouncedWriteUser({ comfortablePassDrug: e.target.value }); }}
                  sx={{ maxWidth: 360 }}
                >
                  <MenuItem value="">Select an option</MenuItem>
                  <MenuItem value="Yes">Yes</MenuItem>
                  <MenuItem value="No">No</MenuItem>
                  <MenuItem value="Maybe">Maybe</MenuItem>
                </TextField>
                {value?.drugScreeningComfort === 'Maybe' && (
                  <TextField
                    fullWidth
                    multiline
                    minRows={3}
                    label="Please explain why you might not pass a drug test"
                    value={value?.drugExplanation || ''}
                    onChange={(e) => { onChange({ ...value, drugExplanation: e.target.value }); debouncedWriteUser({ passDrugExplanation: e.target.value }); }}
                    onBlur={(e) => debouncedWriteUser({ passDrugExplanation: (e.target as HTMLInputElement).value })}
                  />
                )}
              </Stack>
            </CardContent>
          </Card>
        )}

        {/* Removed Physical, PPE, and Uniform requirement cards per request */}
        {showAdditionalScreenings && Array.isArray(jobPosting?.additionalScreenings) && jobPosting.additionalScreenings.length > 0 && (
          <Card variant="outlined">
            <CardHeader title={<Typography variant="h6" sx={{ fontWeight: 700 }}>Additional Screenings</Typography>} />
            <CardContent>
              <Stack spacing={2}>
                {jobPosting.additionalScreenings.map((screenName: string) => (
                  <Stack key={`add-screen-${screenName}`} spacing={1}>
                    <Typography sx={{ fontWeight: 700 }}>{screenName}</Typography>
                    <Typography color="text.secondary">
                      Are you comfortable taking a {screenName}?
                    </Typography>
                    <TextField
                      select
                      size="small"
                      label={`Comfortable with ${screenName}?`}
                      value={(value?.additionalScreenings || {})[screenName] || ''}
                      onChange={(e) => {
                        const next = { ...(value?.additionalScreenings || {}), [screenName]: e.target.value };
                        onChange({ ...value, additionalScreenings: next });
                        const dynamicKey = `comfortableWith${screenName.replace(/[^a-zA-Z0-9]+/g,'')}`;
                        debouncedWriteUser({ [dynamicKey]: e.target.value });
                      }}
                      sx={{ maxWidth: 360 }}
                    >
                      <MenuItem value="">Select an option</MenuItem>
                      <MenuItem value="Yes">Yes</MenuItem>
                      <MenuItem value="No">No</MenuItem>
                      <MenuItem value="Maybe">Maybe</MenuItem>
                    </TextField>
                  </Stack>
                ))}
              </Stack>
            </CardContent>
          </Card>
        )}

        {showBackgroundScreening && (
          <Card variant="outlined">
            <CardHeader title={<Typography variant="h6" sx={{ fontWeight: 700 }}>Background Screening</Typography>} />
            <CardContent>
              <Stack spacing={2}>
                <Typography color="text.secondary">
                  This position requires a background screening. Are you comfortable that you would pass a background screening?
                </Typography>
                <TextField
                  select
                  size="small"
                  label="Would you pass a background screening?"
                  value={value?.backgroundScreeningComfort || ''}
                  onChange={(e) => { onChange({ ...value, backgroundScreeningComfort: e.target.value }); debouncedWriteUser({ comfortablePassBackground: e.target.value }); }}
                  sx={{ maxWidth: 360 }}
                >
                  <MenuItem value="">Select an option</MenuItem>
                  <MenuItem value="Yes">Yes</MenuItem>
                  <MenuItem value="No">No</MenuItem>
                  <MenuItem value="Maybe">Maybe</MenuItem>
                </TextField>
                {value?.backgroundScreeningComfort === 'Maybe' && (
                  <TextField
                    fullWidth
                    multiline
                    minRows={3}
                    label="Please explain why you might not pass a background screening"
                    value={value?.backgroundExplanation || ''}
                    onChange={(e) => { onChange({ ...value, backgroundExplanation: e.target.value }); debouncedWriteUser({ passBackgroundExplanation: e.target.value }); }}
                    onBlur={(e) => debouncedWriteUser({ passBackgroundExplanation: (e.target as HTMLInputElement).value })}
                  />
                )}
              </Stack>
            </CardContent>
          </Card>
        )}

        {showLicensesCerts && (requirements.certifications || []).map((name, idx) => {
          const profileUploadsForName: any[] = Array.isArray(profile?.certifications)
            ? profile.certifications.filter((c: any) => c && typeof c === 'object' && c.name === name && (c.fileUrl || c.downloadUrl))
            : [];
          const computedUploads = uploadsByName[name] && uploadsByName[name].length ? uploadsByName[name] : profileUploadsForName;
          const uploads = computedUploads || [];
          const onProfile = uploads.length > 0;
          return (
            <Card key={`cert-${name}`} variant="outlined">
              {idx === 0 && (
                <CardHeader title={<Typography variant="h6" sx={{ fontWeight: 700 }}>Required Licenses & Certifications</Typography>} />
              )}
              <CardContent>
                <Stack spacing={1}>
                  <Typography sx={{ fontWeight: 700 }}>{name}</Typography>
                  <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
                    {!onProfile && uploads.length === 0 && (
                      <Button size="small" variant="outlined" onClick={() => handlePickFile(name)} disabled={!!uploading[name]}>
                        {uploading[name] ? 'Uploading…' : 'Upload'}
                      </Button>
                    )}
                    {uploads.map((u, i) => (
                      <Stack key={`cert-${name}-${i}`} direction="row" alignItems="center" spacing={1} sx={{ ml: 0 }}>
                        <Typography variant="body2" color="text.secondary">
                          {u.fileName || 'File'} • {formatDateTime(u.uploadedAt)}
                        </Typography>
                        <Button size="small" variant="text" href={u.fileUrl} target="_blank" rel="noopener noreferrer">View</Button>
                        <Button size="small" color="error" onClick={() => handleDelete(name, u)}>Delete</Button>
                        <Button size="small" variant="text" onClick={() => handlePickFile(name)} disabled={!!uploading[name]}>
                          {uploading[name] ? 'Uploading…' : 'Replace'}
                        </Button>
                      </Stack>
                    ))}
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          );
        })}
        {/* Removed legacy checkbox acknowledgement sections */}
      </Stack>

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


