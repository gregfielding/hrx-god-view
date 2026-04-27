import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Box, Stack, Typography, Button, TextField, MenuItem, useTheme, useMediaQuery, Chip, Select, FormControl, InputLabel } from '@mui/material';
import { queueProfileUpdate } from '../../../utils/userProfileBatching';
import { DirectionsCar, DirectionsTransit, DirectionsBike, DirectionsWalk, MoreHoriz } from '@mui/icons-material';
import { storage, db } from '../../../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { arrayUnion, doc, serverTimestamp, updateDoc, getDoc, onSnapshot } from 'firebase/firestore';
import { auth } from '../../../firebase';

type Props = {
  requirements: {
    licenses?: string[];
    certifications?: string[];
    screenings?: string[];
    ppe?: string[];
    physical?: string[];
    education?: string[];
    languages?: string[];
  };
  profile?: any;
  uid: string;
  value: any;
  onChange: (v: any) => void;
  jobPosting?: any;
  preferences?: any;
};

// Reusable Yes/No/Maybe button group component
const YesNoMaybeButtons: React.FC<{
  value: string;
  onChange: (value: string) => void;
  label?: string;
}> = ({ value, onChange, label }) => {
  const options = ['Yes', 'No', 'Maybe'];
  
  const getColor = (option: string, selected: boolean) => {
    if (!selected) return 'default';
    if (option === 'Yes') return 'success';
    if (option === 'No') return 'error';
    if (option === 'Maybe') return 'warning';
    return 'default';
  };

  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1 }}>
      {options.map((option) => {
        const isSelected = value === option;
        return (
          <Chip
            key={option}
            label={option}
            onClick={() => onChange(isSelected ? '' : option)}
            color={getColor(option, isSelected) as any}
            variant={isSelected ? 'filled' : 'outlined'}
            sx={{
              minWidth: 80,
              height: 40,
              fontSize: '0.95rem',
              fontWeight: isSelected ? 600 : 500,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              '&:hover': {
                transform: 'scale(1.05)',
                boxShadow: 2
              }
            }}
          />
        );
      })}
    </Stack>
  );
};

const RequirementsAcknowledgementStep: React.FC<Props> = ({ requirements, profile, uid, value, onChange, jobPosting, preferences }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const setUploaded = (name: string) => onChange({ ...value, uploaded: { ...(value?.uploaded || {}), [name]: true } });
  const clearUploaded = (name: string) => {
    const uploaded = { ...(value?.uploaded || {}) } as Record<string, boolean>;
    delete uploaded[name];
    onChange({ ...value, uploaded });
  };
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingCert, setPendingCert] = useState<string | null>(null);
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  
  // Get languages, physical requirements, uniform requirements, and PPE arrays
  // Check both jobPosting and requirements prop as fallback
  const requiredLanguages = (Array.isArray(jobPosting?.languages) && jobPosting.languages.length > 0)
    ? jobPosting.languages.filter(Boolean)
    : Array.isArray(requirements?.languages) && requirements.languages.length > 0
    ? requirements.languages.filter(Boolean)
    : [];
  const requiredPhysical = (Array.isArray(jobPosting?.physicalRequirements) && jobPosting.physicalRequirements.length > 0)
    ? jobPosting.physicalRequirements.filter(Boolean)
    : Array.isArray(requirements?.physical) && requirements.physical.length > 0
    ? requirements.physical.filter(Boolean)
    : [];
  const requiredUniform = Array.isArray(jobPosting?.uniformRequirements) ? jobPosting.uniformRequirements.filter(Boolean) : [];
  // Check both requiredPpe and ppeRequirements (ppeRequirements is what's saved in job postings)
  const requiredPpe = (Array.isArray(jobPosting?.requiredPpe) && jobPosting.requiredPpe.length > 0)
    ? jobPosting.requiredPpe.filter(Boolean)
    : (Array.isArray(jobPosting?.ppeRequirements) && jobPosting.ppeRequirements.length > 0)
    ? jobPosting.ppeRequirements.filter(Boolean)
    : Array.isArray(requirements?.ppe) && requirements.ppe.length > 0
    ? requirements.ppe.filter(Boolean)
    : [];
  const customUniformText = typeof jobPosting?.customUniformRequirements === 'string' && jobPosting.customUniformRequirements.trim() 
    ? jobPosting.customUniformRequirements.trim() 
    : '';

  // Show flags control visibility on public job posting, but on application form
  // we should always ask about requirements that exist
  const showLicensesCerts = jobPosting?.showLicensesCerts === true;
  // Always show drug screening if it's required (check both show flag and existence)
  const showDrugScreening = jobPosting?.showDrugScreening === true || jobPosting?.drugScreeningRequired === true;
  // Always show background screening if it's required
  const showBackgroundScreening = jobPosting?.showBackgroundChecks === true || jobPosting?.backgroundCheckRequired === true;
  const showAdditionalScreenings = jobPosting?.showAdditionalScreenings === true;
  // Always show E-Verify if it's required
  const showEVerify = jobPosting?.eVerifyRequired === true;
  // Show language/physical/uniform/PPE questions if they exist (not just if show flag is true)
  const showLanguages = (jobPosting?.showLanguages === true || requiredLanguages.length > 0);
  const showPhysicalRequirements = (jobPosting?.showPhysicalRequirements === true || requiredPhysical.length > 0);
  const showUniformRequirements = (jobPosting?.showUniformRequirements === true || requiredUniform.length > 0);
  const showCustomUniformRequirements = (jobPosting?.showCustomUniformRequirements === true || customUniformText.length > 0);
  const showRequiredPpe = (jobPosting?.showRequiredPpe === true || requiredPpe.length > 0);

  // Debug logging
  useEffect(() => {
    if (jobPosting) {
      console.log('🔍 Requirements Step - Full Job Posting:', jobPosting);
      console.log('🔍 Requirements Step - Extracted Values:', {
        showLanguages,
        requiredLanguages,
        requiredLanguagesLength: requiredLanguages.length,
        showPhysicalRequirements,
        requiredPhysical,
        requiredPhysicalLength: requiredPhysical.length,
        showRequiredPpe,
        requiredPpe,
        requiredPpeLength: requiredPpe.length,
        'jobPosting.languages': jobPosting.languages,
        'jobPosting.showLanguages': jobPosting.showLanguages,
        'jobPosting.physicalRequirements': jobPosting.physicalRequirements,
        'jobPosting.showPhysicalRequirements': jobPosting.showPhysicalRequirements,
        'jobPosting.requiredPpe': jobPosting.requiredPpe,
        'jobPosting.ppeRequirements': jobPosting.ppeRequirements,
        'jobPosting.showRequiredPpe': jobPosting.showRequiredPpe,
      });
    }
  }, [jobPosting, showLanguages, requiredLanguages, showPhysicalRequirements, requiredPhysical, showRequiredPpe, requiredPpe]);
  
  // Format languages for question (e.g., "English and Spanish" or "English, Spanish, and French")
  const languagesText = requiredLanguages.length > 0 
    ? requiredLanguages.length === 1 
      ? requiredLanguages[0]
      : requiredLanguages.length === 2
      ? requiredLanguages.join(' and ')
      : requiredLanguages.slice(0, -1).join(', ') + ', and ' + requiredLanguages[requiredLanguages.length - 1]
    : '';
  
  // Format physical requirements for question (e.g., "Standing, Lifting 25lbs, and Carrying 25lbs")
  const physicalText = requiredPhysical.length > 0
    ? requiredPhysical.length === 1
      ? requiredPhysical[0]
      : requiredPhysical.length === 2
      ? requiredPhysical.join(' and ')
      : requiredPhysical.slice(0, -1).join(', ') + ', and ' + requiredPhysical[requiredPhysical.length - 1]
    : '';
  
  // Format uniform requirements for question (e.g., "Non-Slip Shoes and Black Pants")
  const uniformText = requiredUniform.length > 0
    ? requiredUniform.length === 1
      ? requiredUniform[0]
      : requiredUniform.length === 2
      ? requiredUniform.join(' and ')
      : requiredUniform.slice(0, -1).join(', ') + ', and ' + requiredUniform[requiredUniform.length - 1]
    : '';
  
  // Format PPE for question (e.g., "Safety Glasses" or "Safety Glasses, Hard Hat, and Safety Vest")
  const ppeText = requiredPpe.length > 0
    ? requiredPpe.length === 1
      ? requiredPpe[0]
      : requiredPpe.length === 2
      ? requiredPpe.join(' and ')
      : requiredPpe.slice(0, -1).join(', ') + ', and ' + requiredPpe[requiredPpe.length - 1]
    : '';

  // Use batched updates instead of immediate writes (imported at top)
  const debouncedWriteUser = (partial: any) => {
    // Queue each field for batched save
    Object.keys(partial).forEach(key => {
      queueProfileUpdate(key, partial[key]);
    });
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
    <Box sx={{ pb: 5 }}>
      <Stack spacing={3}>
        {showEVerify && (
          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>E-Verify</Typography>
              <Box component="img" src="/img/everify.png" alt="E-Verify" sx={{ height: 28, width: 'auto' }} />
            </Stack>
            <Typography color="text.secondary" sx={{ mb: 1.5 }}>
              This position requires that employees be E-Verified. This process involves matching your social security number with tax records and other government documents to confirm your identity. Are you comfortable with us running you through E-Verify?
            </Typography>
            <YesNoMaybeButtons
              value={value?.eVerifyComfort || ''}
              onChange={(val) => {
                onChange({ ...value, eVerifyComfort: val });
                debouncedWriteUser({ comfortableEVerify: val });
              }}
            />
          </Box>
        )}
        {/* Drug Screening */}
        {showDrugScreening && (
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
              Drug Screening
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 1.5 }}>
              This position requires a drug screening. Are you comfortable that you would pass a drug screening?
            </Typography>
            <YesNoMaybeButtons
              value={value?.drugScreeningComfort || ''}
              onChange={(val) => {
                onChange({ ...value, drugScreeningComfort: val });
                debouncedWriteUser({ comfortablePassDrug: val });
              }}
            />
            {value?.drugScreeningComfort === 'Maybe' && (
              <TextField
                fullWidth
                multiline
                minRows={3}
                label="Please explain why you might not pass a drug test"
                value={value?.drugExplanation || ''}
                onChange={(e) => { onChange({ ...value, drugExplanation: e.target.value }); debouncedWriteUser({ passDrugExplanation: e.target.value }); }}
                onBlur={(e) => debouncedWriteUser({ passDrugExplanation: (e.target as HTMLInputElement).value })}
                sx={{ mt: 2 }}
              />
            )}
          </Box>
        )}

        {/* Additional Screenings */}
        {showAdditionalScreenings && Array.isArray(jobPosting?.additionalScreenings) && jobPosting.additionalScreenings.length > 0 && (
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
              Additional Screenings
            </Typography>
            <Stack spacing={3}>
              {jobPosting.additionalScreenings.map((screenName: string) => (
                <Box key={`add-screen-${screenName}`}>
                  <Typography sx={{ fontWeight: 700, mb: 1 }}>{screenName}</Typography>
                  <Typography color="text.secondary" sx={{ mb: 1.5 }}>
                    Are you comfortable taking a {screenName}?
                  </Typography>
                  <YesNoMaybeButtons
                    value={(value?.additionalScreenings || {})[screenName] || ''}
                    onChange={(val) => {
                      const next = { ...(value?.additionalScreenings || {}), [screenName]: val };
                      onChange({ ...value, additionalScreenings: next });
                      const dynamicKey = `comfortableWith${screenName.replace(/[^a-zA-Z0-9]+/g,'')}`;
                      debouncedWriteUser({ [dynamicKey]: val });
                    }}
                  />
                </Box>
              ))}
            </Stack>
          </Box>
        )}

        {showBackgroundScreening && (
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
              Background Screening
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 1.5 }}>
              This position requires a background screening. Are you comfortable that you would pass a background screening?
            </Typography>
            <YesNoMaybeButtons
              value={value?.backgroundScreeningComfort || ''}
              onChange={(val) => {
                onChange({ ...value, backgroundScreeningComfort: val });
                debouncedWriteUser({ comfortablePassBackground: val });
              }}
            />
            {value?.backgroundScreeningComfort === 'Maybe' && (
              <TextField
                fullWidth
                multiline
                minRows={3}
                label="Please explain why you might not pass a background screening"
                value={value?.backgroundExplanation || ''}
                onChange={(e) => { onChange({ ...value, backgroundExplanation: e.target.value }); debouncedWriteUser({ passBackgroundExplanation: e.target.value }); }}
                onBlur={(e) => debouncedWriteUser({ passBackgroundExplanation: (e.target as HTMLInputElement).value })}
                sx={{ mt: 2 }}
              />
            )}
          </Box>
        )}
      </Stack>

      {/* Language Requirements */}
      {showLanguages && requiredLanguages.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
            Language Requirements
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 1.5 }}>
            Are you comfortable speaking {languagesText}?
          </Typography>
          <YesNoMaybeButtons
            value={value?.languagesComfort || ''}
            onChange={(val) => {
              onChange({ ...value, languagesComfort: val });
              debouncedWriteUser({ comfortableWithLanguages: val });
            }}
          />
        </Box>
      )}

      {/* Physical Requirements */}
      {showPhysicalRequirements && requiredPhysical.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
            Physical Requirements
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 1.5 }}>
            Are you comfortable with {physicalText}?
          </Typography>
          <YesNoMaybeButtons
            value={value?.physicalRequirementsComfort || ''}
            onChange={(val) => {
              onChange({ ...value, physicalRequirementsComfort: val });
              debouncedWriteUser({ comfortableWithPhysicalRequirements: val });
            }}
          />
        </Box>
      )}

      {/* Uniform Requirements */}
      {showUniformRequirements && requiredUniform.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
            Uniform Requirements
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 1.5 }}>
            Are you comfortable wearing {uniformText}?
          </Typography>
          <YesNoMaybeButtons
            value={value?.uniformRequirementsComfort || ''}
            onChange={(val) => {
              onChange({ ...value, uniformRequirementsComfort: val });
              debouncedWriteUser({ comfortableWithUniformRequirements: val });
            }}
          />
        </Box>
      )}

      {/* Custom Uniform Requirements */}
      {showCustomUniformRequirements && customUniformText && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
            Custom Uniform Requirements
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 1.5 }}>
            Are you comfortable wearing {customUniformText}?
          </Typography>
          <YesNoMaybeButtons
            value={value?.customUniformRequirementsComfort || ''}
            onChange={(val) => {
              onChange({ ...value, customUniformRequirementsComfort: val });
              debouncedWriteUser({ comfortableWithCustomUniformRequirements: val });
            }}
          />
        </Box>
      )}

      {/* Required PPE */}
      {showRequiredPpe && requiredPpe.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
            Required PPE
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 1.5 }}>
            Are you comfortable wearing {ppeText}?
          </Typography>
          <YesNoMaybeButtons
            value={value?.requiredPpeComfort || ''}
            onChange={(val) => {
              onChange({ ...value, requiredPpeComfort: val });
              debouncedWriteUser({ comfortableWithRequiredPpe: val });
            }}
          />
        </Box>
      )}

      {/* Transport Method */}
      <Box sx={{ mt: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
          How will you get to work?
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1 }}>
          {[
            { value: 'Car', label: 'Car', icon: DirectionsCar },
            { value: 'Public Transit', label: 'Public Transit', icon: DirectionsTransit },
            { value: 'Bike', label: 'Bike', icon: DirectionsBike },
            { value: 'Walk', label: 'Walk', icon: DirectionsWalk },
            { value: 'Other', label: 'Other', icon: MoreHoriz },
          ].map((option) => {
            const isSelected = value?.transportMethod === option.value;
            const Icon = option.icon;
            return (
              <Chip
                key={option.value}
                icon={<Icon />}
                label={option.label}
                onClick={() => {
                  const newValue = isSelected ? '' : option.value;
                  onChange({ ...value, transportMethod: newValue });
                  debouncedWriteUser({ transportMethod: newValue });
                }}
                color={isSelected ? 'success' : 'default'}
                variant={isSelected ? 'filled' : 'outlined'}
                sx={{
                  height: 40,
                  fontSize: '0.95rem',
                  fontWeight: isSelected ? 600 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    transform: 'scale(1.05)',
                    boxShadow: 2
                  }
                }}
              />
            );
          })}
        </Stack>
      </Box>

      {/* When can you start? - Only show for Career jobs, not Gig jobs with specific dates */}
      {jobPosting?.jobType !== 'gig' && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
            When can you start?
          </Typography>
          <AvailabilitySection 
            value={preferences || {}} 
            onChange={(v) => {
              // This will be handled by the parent Wizard component
              // We need to update preferences, not requirements
              const currentPreferences = preferences || {};
              const updatedPreferences = { ...currentPreferences, ...v };
              // Store in a way that Wizard can pick up
              onChange({ ...value, _preferencesUpdate: updatedPreferences });
            }} 
          />
        </Box>
      )}

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

// When can you start? component
const AvailabilitySection: React.FC<{ value: any; onChange: (v: any) => void }> = ({ value, onChange }) => {
  const [availableToStartDate, setAvailableToStartDate] = React.useState<string>(value?.availableToStartDate || '');
  
  // Sync with external value changes
  React.useEffect(() => {
    if (value?.availableToStartDate !== undefined) {
      setAvailableToStartDate(value.availableToStartDate || '');
    }
  }, [value?.availableToStartDate]);

  // Debounced Firestore updater - increased debounce to prevent excessive writes
  const debounceRef = React.useRef<any>(null);
  const debouncedUpdate = (data: any) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        const userRef = doc(db, 'users', uid);
        await updateDoc(userRef, { ...data, updatedAt: serverTimestamp() });
      } catch {}
    }, 2000); // Increased from 400ms to 2000ms to reduce Firestore writes
  };

  // Removed onSnapshot listener to prevent feedback loop - value is synced via props

  return (
    <TextField
      label="Start date"
      type="date"
      value={availableToStartDate || ''}
      onChange={(e) => {
        const v = e.target.value;
        setAvailableToStartDate(v);
        onChange({ availableToStartDate: v });
        debouncedUpdate({ availableToStartDate: v });
      }}
      onBlur={(e) => debouncedUpdate({ availableToStartDate: e.target.value })}
      InputLabelProps={{ shrink: true }}
      fullWidth
      sx={{ maxWidth: 360 }}
    />
  );
};

export default RequirementsAcknowledgementStep;


