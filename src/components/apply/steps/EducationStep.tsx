import React, { useState, useMemo, useRef } from 'react';
import { queueProfileUpdate, flushProfileUpdates } from '../../../utils/userProfileBatching';
import { 
  Box, 
  Typography, 
  Button, 
  Chip, 
  Stack, 
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  useTheme, 
  useMediaQuery,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  IconButton,
  Alert
} from '@mui/material';
import { AddCircle, Delete as DeleteIcon, ExpandMore, School, CalendarToday, Verified, CheckCircle, Upload as UploadIcon, Visibility as ViewIcon } from '@mui/icons-material';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, db, storage } from '../../../firebase';
import credentialsSeed from '../../../data/credentialsSeed.json';

type Props = {
  value: any;
  onChange: (v: any) => void;
  context?: 'application' | 'profile';
  tenantId?: string;
  jobId?: string;
  jobPosting?: any;
  showOnly?: 'education' | 'certifications' | 'both';
  onRequiredCertsStatusChange?: (hasMissing: boolean) => void;
};

const degreeTypes = [
  'High School Diploma',
  'GED',
  'Some College',
  "Associate's",
  "Bachelor's",
  "Master's",
  'Doctorate',
  'Certificate',
  'Trade School',
  'Culinary School',
  'Other',
];

const quickAddEducation = [
  'High School Diploma',
  'GED',
  'Culinary School',
];

const quickAddCertifications = [
  'CNA',
  'ServSafe Manager',
  'Food Handler Card',
  'CPR / First Aid',
  'First Aid / CPR',
];

// Get all active certifications from credentialsSeed
const certificationOptions = credentialsSeed
  .filter(cred => cred.is_active && cred.type === 'Certification')
  .map(cred => cred.name)
  .sort();

// Also include licenses for completeness
const licenseOptions = credentialsSeed
  .filter(cred => cred.is_active && cred.type === 'License')
  .map(cred => cred.name)
  .sort();

// Combine and deduplicate
const allCertificationOptions = Array.from(new Set([...certificationOptions, ...licenseOptions])).sort();

// Generate years from 1970 to 2026 for date picker
const yearOptions = Array.from({ length: 57 }, (_, i) => 2026 - i);

const EducationStep: React.FC<Props> = ({ value, onChange, context = 'application', tenantId, jobId, jobPosting, showOnly = 'both', onRequiredCertsStatusChange }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  
  const [educationDialogOpen, setEducationDialogOpen] = useState(false);
  const [certificationDialogOpen, setCertificationDialogOpen] = useState(false);
  const [quickAddEducationValue, setQuickAddEducationValue] = useState<string | null>(null);
  const [quickAddCertificationValue, setQuickAddCertificationValue] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [newEducation, setNewEducation] = useState({
    school: '',
    degree: '',
    field: '',
    startYear: '',
    endYear: '',
    showDates: false,
  });

  const [newCertification, setNewCertification] = useState({
    name: '',
    issuer: '',
    expirationDate: '',
    showExpiration: false,
    file: null as File | null,
  });

  // Use batched updates, but flush immediately for array operations (education, certifications)
  const debouncedUpdate = (ref: any, data: any) => {
    // Queue each field for batched save
    Object.keys(data).forEach(key => {
      if (key !== 'updatedAt') {
        queueProfileUpdate(key, data[key]);
      }
    });
    // Flush immediately for critical array operations (education, certifications)
    if (data.education || data.certifications) {
      flushProfileUpdates(true);
    }
  };

  const education = value?.education || [];
  const certifications = value?.certifications || [];

  // Get required education from job posting (supports array or single string)
  const requiredEducation = useMemo(() => {
    if (!jobPosting) return [];
    const edu = jobPosting.educationLevels ||
                jobPosting.educationRequired ||
                (jobPosting.requirements && Array.isArray(jobPosting.requirements.education) ? jobPosting.requirements.education : []) ||
                (jobPosting.jobOrder && jobPosting.jobOrder.educationRequired ? [jobPosting.jobOrder.educationRequired] : []) ||
                [];
    if (Array.isArray(edu)) return edu.filter(Boolean).map((e: any) => typeof e === 'string' ? e : String(e));
    if (edu && typeof edu === 'string') return [edu.trim()].filter(Boolean);
    return [];
  }, [jobPosting]);

  // Get required certifications from job posting
  const requiredCertifications = useMemo(() => {
    if (!jobPosting) return [];
    const certs = jobPosting.licensesCerts || 
                  jobPosting.requiredCertifications || 
                  (jobPosting.requirements && Array.isArray(jobPosting.requirements.certifications) ? jobPosting.requirements.certifications : []) ||
                  [];
    return Array.isArray(certs) ? certs.filter(Boolean).map((c: any) => typeof c === 'string' ? c : String(c)) : [];
  }, [jobPosting]);

  // Check which required education user has
  const userEducationDegrees = useMemo(() => {
    return education.map((e: any) => e?.degree || String(e || '')).filter(Boolean);
  }, [education]);

  // Check which required certifications user has
  const userCertificationNames = useMemo(() => {
    return certifications.map((c: any) => c?.name || String(c || '')).filter(Boolean);
  }, [certifications]);

  // Missing required education
  const missingRequiredEducation = useMemo(() => {
    return requiredEducation.filter((req: string) => {
      const reqLower = req.toLowerCase();
      return !userEducationDegrees.some((userEdu: string) => 
        userEdu.toLowerCase().includes(reqLower) || reqLower.includes(userEdu.toLowerCase())
      );
    });
  }, [requiredEducation, userEducationDegrees]);

  // Missing required certifications
  const missingRequiredCertifications = useMemo(() => {
    return requiredCertifications.filter((req: string) => {
      const reqLower = req.toLowerCase();
      return !userCertificationNames.some((userCert: string) => 
        userCert.toLowerCase().includes(reqLower) || reqLower.includes(userCert.toLowerCase())
      );
    });
  }, [requiredCertifications, userCertificationNames]);

  // Check if all required education is added
  const allRequiredEducationAdded = useMemo(() => {
    return requiredEducation.length > 0 && missingRequiredEducation.length === 0;
  }, [requiredEducation.length, missingRequiredEducation.length]);

  // Check if all required certifications are added
  const allRequiredCertificationsAdded = useMemo(() => {
    return requiredCertifications.length > 0 && missingRequiredCertifications.length === 0;
  }, [requiredCertifications.length, missingRequiredCertifications.length]);

  // Notify parent when required certs status changes (for button text)
  React.useEffect(() => {
    if (onRequiredCertsStatusChange && showOnly === 'certifications') {
      const hasMissing = requiredCertifications.length > 0 && missingRequiredCertifications.length > 0;
      onRequiredCertsStatusChange(hasMissing);
    }
  }, [requiredCertifications.length, missingRequiredCertifications.length, onRequiredCertsStatusChange, showOnly]);

  const handleQuickAddEducation = (degree: string, e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    setQuickAddEducationValue(degree);
    setNewEducation({
      school: '',
      degree: degree,
      field: '',
      startYear: '',
      endYear: '',
      showDates: false,
    });
    setEducationDialogOpen(true);
  };

  const handleSaveEducation = () => {
    const entry: any = {
      school: newEducation.school.trim(),
      degree: newEducation.degree,
    };
    if (newEducation.field) entry.field = newEducation.field.trim();
    if (newEducation.showDates) {
      if (newEducation.startYear) entry.startYear = newEducation.startYear;
      if (newEducation.endYear) entry.endYear = newEducation.endYear;
    }
    
    const updated = [...education, entry];
    onChange({ ...value, education: updated });
    const uid = auth.currentUser?.uid;
    if (uid) {
      debouncedUpdate(doc(db, 'users', uid), { education: updated, updatedAt: serverTimestamp() });
    }
    setEducationDialogOpen(false);
    setNewEducation({
      school: '',
      degree: '',
      field: '',
      startYear: '',
      endYear: '',
      showDates: false,
    });
    setQuickAddEducationValue(null);
  };

  const handleDeleteEducation = (idx: number) => {
    const updated = education.filter((_, i) => i !== idx);
    onChange({ ...value, education: updated });
    const uid = auth.currentUser?.uid;
    if (uid) {
      debouncedUpdate(doc(db, 'users', uid), { education: updated, updatedAt: serverTimestamp() });
    }
  };

  const handleOpenEducationDialog = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    setNewEducation({
      school: '',
      degree: '',
      field: '',
      startYear: '',
      endYear: '',
      showDates: false,
    });
    setQuickAddEducationValue(null);
    setEducationDialogOpen(true);
  };

  const handleQuickAddCertification = (certName: string) => {
    setQuickAddCertificationValue(certName);
    setNewCertification({
      name: certName,
      issuer: '',
      expirationDate: '',
      showExpiration: false,
      file: null,
    });
    setCertificationDialogOpen(true);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setNewCertification(prev => ({ ...prev, file }));
    }
  };

  const handleSaveCertification = async () => {
    if (!newCertification.name.trim()) return;

    setUploading(true);
    try {
      let fileUrl: string | undefined;
      let fileName: string | undefined;
      let uploadedAt: Date | undefined;

      // Upload file if provided
      const uid = auth.currentUser?.uid;
      if (newCertification.file && uid) {
        const certSlug = newCertification.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const path = `users/${uid}/certifications/${certSlug}/${Date.now()}-${newCertification.file.name}`;
        const fileRef = ref(storage, path);
        
        await uploadBytes(fileRef, newCertification.file);
        fileUrl = await getDownloadURL(fileRef);
        fileName = newCertification.file.name;
        uploadedAt = new Date();
      }

      const entry: any = {
        name: newCertification.name.trim(),
      };
      
      if (newCertification.issuer) {
        entry.issuer = newCertification.issuer.trim();
      }
      
      if (newCertification.showExpiration && newCertification.expirationDate) {
        entry.expirationDate = newCertification.expirationDate;
      }
      
      if (fileUrl) {
        entry.fileUrl = fileUrl;
        entry.fileName = fileName;
        entry.uploadedAt = uploadedAt;
      }
      
      const updated = [...certifications, entry];
      onChange({ ...value, certifications: updated });
      
      if (uid) {
        // Flush immediately for file uploads
        await updateDoc(doc(db, 'users', uid), { certifications: updated, updatedAt: serverTimestamp() });
      }
      
      setCertificationDialogOpen(false);
      setNewCertification({
        name: '',
        issuer: '',
        expirationDate: '',
        showExpiration: false,
        file: null,
      });
      setQuickAddCertificationValue(null);
    } catch (error) {
      console.error('Error saving certification:', error);
      alert('Failed to save certification');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteCertification = (idx: number) => {
    const updated = certifications.filter((_, i) => i !== idx);
    onChange({ ...value, certifications: updated });
    const uid = auth.currentUser?.uid;
    if (uid) {
      debouncedUpdate(doc(db, 'users', uid), { certifications: updated, updatedAt: serverTimestamp() });
    }
  };

  const handleOpenCertificationDialog = () => {
    setNewCertification({
      name: '',
      issuer: '',
      expirationDate: '',
      showExpiration: false,
      file: null,
    });
    setQuickAddCertificationValue(null);
    setCertificationDialogOpen(true);
  };

  return (
    <Box>
      {/* Job requirement callout when this job has education requirements */}
      {(showOnly === 'both' || showOnly === 'education') && requiredEducation.length > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <strong>This job requires:</strong> {requiredEducation.join(', ')}.
        </Alert>
      )}
      {/* Required Education Section */}
      {(showOnly === 'both' || showOnly === 'education') && requiredEducation.length > 0 && (
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
            🔑 Required Education
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Must confirm before continuing
          </Typography>
          
          <Box 
            sx={{ 
              p: 2.5, 
              bgcolor: 'warning.50',
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'warning.main'
            }}
          >
            {allRequiredEducationAdded && (
              <Alert 
                severity="success" 
                sx={{ 
                  mb: 2,
                  '& .MuiAlert-message': {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1
                  }
                }}
              >
                🎉 Great — you've met the education requirements. Add more below to boost your profile.
              </Alert>
            )}
            
            <Stack direction="row" flexWrap="wrap" gap={1}>
              {requiredEducation.map((reqEdu: string) => {
                const hasEducation = !missingRequiredEducation.includes(reqEdu);
                return (
                  <Chip
                    key={reqEdu}
                    label={hasEducation ? `✔ ${reqEdu}` : reqEdu}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!hasEducation) handleOpenEducationDialog(e);
                    }}
                    color={hasEducation ? 'success' : 'default'}
                    variant={hasEducation ? 'filled' : 'outlined'}
                    sx={{
                      fontWeight: hasEducation ? 600 : 500,
                      cursor: hasEducation ? 'default' : 'pointer',
                      height: 40,
                      fontSize: '0.95rem',
                      transition: 'all 0.2s ease',
                      '&:hover': hasEducation ? {} : {
                        bgcolor: 'warning.main',
                        color: 'white',
                        borderColor: 'warning.main',
                        transform: 'scale(1.02)'
                      }
                    }}
                  />
                );
              })}
            </Stack>
            
            {allRequiredEducationAdded && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2, fontStyle: 'italic' }}>
                {requiredEducation.length} required education level{requiredEducation.length === 1 ? '' : 's'} confirmed ▸ Great! Add more to boost your profile
              </Typography>
            )}
          </Box>
        </Box>
      )}

      {/* Education Section */}
      {(showOnly === 'both' || showOnly === 'education') && (
      <Box sx={{ mb: 2.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
          🎓 Education
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Helps you qualify for more jobs, higher pay, and healthcare roles.
        </Typography>

        {education.length > 0 ? (
          <>
            <Stack spacing={1.5} sx={{ mb: 2 }}>
              {education.map((entry: any, idx: number) => (
                <Box
                  key={idx}
                  sx={{
                    p: 1.5,
                    borderRadius: 1,
                    border: '1px solid',
                    borderColor: 'divider',
                    bgcolor: 'white',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      borderColor: 'primary.main',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                    }
                  }}
                >
                  <Box>
                    <Typography variant="body1" sx={{ fontWeight: 500 }}>
                      {entry.degree || 'Education'}
                      {entry.school && ` @ ${entry.school}`}
                    </Typography>
                    {(entry.startYear || entry.startDate) && (
                      <Typography variant="body2" color="text.secondary">
                        {entry.startYear || entry.startDate} - {entry.endYear || entry.endDate || 'Present'}
                      </Typography>
                    )}
                  </Box>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => handleDeleteEducation(idx)}
                    sx={{ ml: 1 }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
            </Stack>
            
            {education.length === 1 && (
              <Box sx={{ mb: 2, p: 1.5, bgcolor: 'success.50', borderRadius: 1, border: '1px solid', borderColor: 'success.main' }}>
                <Typography variant="body2" color="success.dark" sx={{ fontWeight: 500 }}>
                  Nice! You're now qualified for more positions.
                </Typography>
              </Box>
            )}
          </>
        ) : (
          <Box sx={{ mb: 2 }}>
            <Box sx={{ mb: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                🎓 You haven't added education yet
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Add GED, High School Diploma, or other education.
              </Typography>
            </Box>

            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, fontSize: '0.85rem' }}>
              Quick add:
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 2 }}>
              {quickAddEducation.map((degree) => (
                <Chip
                  key={degree}
                  label={degree}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleQuickAddEducation(degree, e);
                  }}
                  variant="outlined"
                  sx={{
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      bgcolor: 'primary.main',
                      color: 'white',
                      borderColor: 'primary.main',
                      transform: 'translateY(-2px)',
                      boxShadow: '0 4px 8px rgba(0,0,0,0.15)'
                    }
                  }}
                />
              ))}
            </Stack>
          </Box>
        )}

        <Chip
          label="Add Education"
          onClick={(e) => handleOpenEducationDialog(e)}
          icon={<AddCircle />}
          color="primary"
          variant={education.length > 0 ? "outlined" : "filled"}
          sx={{ 
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            '&:hover': {
              transform: 'translateY(-2px)',
              boxShadow: '0 4px 8px rgba(0,0,0,0.1)'
            }
          }}
        />
      </Box>
      )}

      {/* Certifications Section */}
      {(showOnly === 'both' || showOnly === 'certifications') && (
      <Box sx={{ mb: 2.5 }}>
        {/* Required Certifications Section - Show at top when showOnly === 'certifications' */}
        {showOnly === 'certifications' && requiredCertifications.length > 0 && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
              🔑 Required Certifications
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              This job requires you to have the following certification{requiredCertifications.length === 1 ? '' : 's'}:
            </Typography>
            
            <Box 
              sx={{ 
                p: 2.5, 
                bgcolor: allRequiredCertificationsAdded ? 'success.50' : 'warning.50',
                borderRadius: 1,
                border: '1px solid',
                borderColor: allRequiredCertificationsAdded ? 'success.main' : 'warning.main'
              }}
            >
              {allRequiredCertificationsAdded && (
                <Alert 
                  severity="success" 
                  sx={{ 
                    mb: 2,
                    '& .MuiAlert-message': {
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1
                    }
                  }}
                >
                  ✓ Great! You've uploaded all required certifications.
                </Alert>
              )}
              
              <Stack direction="row" flexWrap="wrap" gap={1}>
                {requiredCertifications.map((reqCert: string) => {
                  const hasCertification = !missingRequiredCertifications.includes(reqCert);
                  return (
                    <Chip
                      key={reqCert}
                      label={hasCertification ? `✓ ${reqCert}` : reqCert}
                      onClick={() => !hasCertification && handleQuickAddCertification(reqCert)}
                      color={hasCertification ? 'success' : 'default'}
                      variant={hasCertification ? 'filled' : 'outlined'}
                      sx={{
                        fontWeight: hasCertification ? 600 : 500,
                        cursor: hasCertification ? 'default' : 'pointer',
                        height: 40,
                        fontSize: '0.95rem',
                        transition: 'all 0.2s ease',
                        '&:hover': hasCertification ? {} : {
                          bgcolor: 'warning.main',
                          color: 'white',
                          borderColor: 'warning.main',
                          transform: 'scale(1.02)'
                        }
                      }}
                    />
                  );
                })}
              </Stack>
              
              {!allRequiredCertificationsAdded && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                  Please upload the required certification{requiredCertifications.length === 1 ? '' : 's'} above to continue, or click "Skip for Now" to proceed without them.
                </Typography>
              )}
            </Box>
          </Box>
        )}

        <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
          ✅ Certifications
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Professional certifications and licenses that help you stand out.
        </Typography>

        {certifications.length > 0 ? (
          <>
            <Stack spacing={1.5} sx={{ mb: 2 }}>
              {certifications.map((entry: any, idx: number) => (
                <Box
                  key={idx}
                  sx={{
                    p: 1.5,
                    borderRadius: 1,
                    border: '1px solid',
                    borderColor: 'divider',
                    bgcolor: 'white',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      borderColor: 'primary.main',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                    }
                  }}
                >
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body1" sx={{ fontWeight: 500 }}>
                      {entry.name || 'Certification'}
                      {entry.issuer && ` (${entry.issuer})`}
                    </Typography>
                    {entry.expirationDate && (
                      <Typography variant="body2" color="text.secondary">
                        Expires: {entry.expirationDate}
                      </Typography>
                    )}
                    {entry.fileUrl && entry.fileName && (
                      <Typography variant="body2" color="text.secondary">
                        {entry.fileName}
                        {entry.uploadedAt && (() => {
                          try {
                            const date = entry.uploadedAt instanceof Date 
                              ? entry.uploadedAt 
                              : entry.uploadedAt?.toDate?.() || new Date(entry.uploadedAt);
                            const formatted = new Intl.DateTimeFormat('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            }).format(date);
                            return ` • Uploaded ${formatted}`;
                          } catch (e) {
                            return '';
                          }
                        })()}
                      </Typography>
                    )}
                  </Box>
                  <Stack direction="row" spacing={0.5}>
                    {entry.fileUrl && (
                      <Button
                        size="small"
                        variant="text"
                        startIcon={<ViewIcon />}
                        href={entry.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View
                      </Button>
                    )}
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => handleDeleteCertification(idx)}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                </Box>
              ))}
            </Stack>
          </>
        ) : (
          <Box sx={{ mb: 2 }}>
            <Box sx={{ mb: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                ✅ You haven't added certifications yet
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Add professional certifications like CNA, ServSafe, Food Handler, or CPR.
              </Typography>
            </Box>

            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, fontSize: '0.85rem' }}>
              Quick add:
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 2 }}>
              {quickAddCertifications.map((cert) => (
                <Chip
                  key={cert}
                  label={cert}
                  onClick={() => handleQuickAddCertification(cert)}
                  variant="outlined"
                  sx={{
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      bgcolor: 'primary.main',
                      color: 'white',
                      borderColor: 'primary.main',
                      transform: 'translateY(-2px)',
                      boxShadow: '0 4px 8px rgba(0,0,0,0.15)'
                    }
                  }}
                />
              ))}
            </Stack>
          </Box>
        )}

        {/* Required Certifications Section */}
        {requiredCertifications.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
              🔑 Required Certifications
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Must confirm before continuing
            </Typography>
            
            <Box 
              sx={{ 
                p: 2.5, 
                bgcolor: 'warning.50',
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'warning.main'
              }}
            >
              {allRequiredCertificationsAdded && (
                <Alert 
                  severity="success" 
                  sx={{ 
                    mb: 2,
                    '& .MuiAlert-message': {
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1
                    }
                  }}
                >
                  🎉 Great — you've met the certification requirements. Add more below to boost your profile.
                </Alert>
              )}
              
              <Stack direction="row" flexWrap="wrap" gap={1}>
                {requiredCertifications.map((reqCert: string) => {
                  const hasCertification = !missingRequiredCertifications.includes(reqCert);
                  return (
                    <Chip
                      key={reqCert}
                      label={hasCertification ? `✔ ${reqCert}` : reqCert}
                      onClick={() => !hasCertification && handleQuickAddCertification(reqCert)}
                      color={hasCertification ? 'success' : 'default'}
                      variant={hasCertification ? 'filled' : 'outlined'}
                      sx={{
                        fontWeight: hasCertification ? 600 : 500,
                        cursor: hasCertification ? 'default' : 'pointer',
                        height: 40,
                        fontSize: '0.95rem',
                        transition: 'all 0.2s ease',
                        '&:hover': hasCertification ? {} : {
                          bgcolor: 'warning.main',
                          color: 'white',
                          borderColor: 'warning.main',
                          transform: 'scale(1.02)'
                        }
                      }}
                    />
                  );
                })}
              </Stack>
              
              {allRequiredCertificationsAdded && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2, fontStyle: 'italic' }}>
                  {requiredCertifications.length} required certification{requiredCertifications.length === 1 ? '' : 's'} confirmed ▸ Great! Add more to boost your profile
                </Typography>
              )}
            </Box>
          </Box>
        )}

        <Chip
          label="Add Certification"
          onClick={handleOpenCertificationDialog}
          icon={<AddCircle />}
          color="primary"
          variant={certifications.length > 0 ? "outlined" : "filled"}
          sx={{ 
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            '&:hover': {
              transform: 'translateY(-2px)',
              boxShadow: '0 4px 8px rgba(0,0,0,0.1)'
            }
          }}
        />
      </Box>
      )}

      {/* Education Dialog */}
      <Dialog 
        open={educationDialogOpen} 
        onClose={() => setEducationDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            position: 'fixed',
            bottom: { xs: 0, sm: 'auto' },
            top: { xs: 'auto', sm: '50%' },
            transform: { xs: 'none', sm: 'translateY(-50%)' },
            margin: { xs: 0, sm: 'auto' },
            maxHeight: { xs: '90vh', sm: '85vh' },
            borderRadius: { xs: '16px 16px 0 0', sm: 1 }
          }
        }}
      >
        <DialogTitle>Add Education</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              select
              label="Degree / Certification"
              fullWidth
              required
              value={newEducation.degree}
              onChange={(e) => setNewEducation({ ...newEducation, degree: e.target.value })}
            >
              {degreeTypes.map((type) => (
                <MenuItem key={type} value={type}>
                  {type}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="School / Institution"
              fullWidth
              required
              value={newEducation.school}
              onChange={(e) => setNewEducation({ ...newEducation, school: e.target.value })}
              placeholder="e.g. Local High School, Community College"
              InputProps={{
                startAdornment: (
                  <Box sx={{ mr: 1, display: 'flex', alignItems: 'center' }}>
                    <School fontSize="small" color="action" />
                  </Box>
                )
              }}
            />
            <TextField
              label="Field of Study (Optional)"
              fullWidth
              value={newEducation.field}
              onChange={(e) => setNewEducation({ ...newEducation, field: e.target.value })}
            />
            
            <Accordion 
              expanded={newEducation.showDates}
              onChange={(_, expanded) => setNewEducation({ ...newEducation, showDates: expanded })}
              sx={{ boxShadow: 'none', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
            >
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CalendarToday fontSize="small" color="action" />
                  <Typography variant="body2">Add Dates (Optional)</Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={2}>
                  <TextField
                    select
                    label="Start Year"
                    fullWidth
                    value={newEducation.startYear}
                    onChange={(e) => setNewEducation({ ...newEducation, startYear: e.target.value })}
                    InputProps={{
                      startAdornment: (
                        <Box sx={{ mr: 1, display: 'flex', alignItems: 'center' }}>
                          <CalendarToday fontSize="small" color="action" />
                        </Box>
                      )
                    }}
                  >
                    {yearOptions.map((year) => (
                      <MenuItem key={year} value={year.toString()}>
                        {year}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    select
                    label="End Year"
                    fullWidth
                    value={newEducation.endYear}
                    onChange={(e) => setNewEducation({ ...newEducation, endYear: e.target.value })}
                    helperText="Leave empty if still in progress"
                    InputProps={{
                      startAdornment: (
                        <Box sx={{ mr: 1, display: 'flex', alignItems: 'center' }}>
                          <CalendarToday fontSize="small" color="action" />
                        </Box>
                      )
                    }}
                  >
                    <MenuItem value="">Present</MenuItem>
                    {yearOptions.map((year) => (
                      <MenuItem key={year} value={year.toString()}>
                        {year}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
              </AccordionDetails>
            </Accordion>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, pt: 1 }}>
          <Button onClick={() => setEducationDialogOpen(false)}>Cancel</Button>
          <Button 
            variant="contained" 
            onClick={handleSaveEducation}
            disabled={!newEducation.degree || !newEducation.school}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Certification Dialog */}
      <Dialog 
        open={certificationDialogOpen} 
        onClose={() => !uploading && setCertificationDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            position: 'fixed',
            bottom: { xs: 0, sm: 'auto' },
            top: { xs: 'auto', sm: '50%' },
            transform: { xs: 'none', sm: 'translateY(-50%)' },
            margin: { xs: 0, sm: 'auto' },
            maxHeight: { xs: '90vh', sm: '85vh' },
            borderRadius: { xs: '16px 16px 0 0', sm: 1 }
          }
        }}
      >
        <DialogTitle>Add Certification</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              select
              label="Certification Name"
              fullWidth
              required
              value={newCertification.name}
              onChange={(e) => setNewCertification({ ...newCertification, name: e.target.value })}
              InputProps={{
                startAdornment: (
                  <Box sx={{ mr: 1, display: 'flex', alignItems: 'center' }}>
                    <Verified fontSize="small" color="action" />
                  </Box>
                )
              }}
            >
              <MenuItem value="">
                <em>Select a certification...</em>
              </MenuItem>
              {allCertificationOptions.map((certName) => (
                <MenuItem key={certName} value={certName}>
                  {certName}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Issuing Organization (Optional)"
              fullWidth
              value={newCertification.issuer}
              onChange={(e) => setNewCertification({ ...newCertification, issuer: e.target.value })}
              placeholder="e.g. State Board, ServSafe, Red Cross"
            />
            
            <Accordion 
              expanded={newCertification.showExpiration}
              onChange={(_, expanded) => setNewCertification({ ...newCertification, showExpiration: expanded })}
              sx={{ boxShadow: 'none', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
            >
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CalendarToday fontSize="small" color="action" />
                  <Typography variant="body2">Add Expiration Date (Optional)</Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <TextField
                  type="month"
                  label="Expiration Date"
                  fullWidth
                  value={newCertification.expirationDate}
                  onChange={(e) => setNewCertification({ ...newCertification, expirationDate: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                  InputProps={{
                    startAdornment: (
                      <Box sx={{ mr: 1, display: 'flex', alignItems: 'center' }}>
                        <CalendarToday fontSize="small" color="action" />
                      </Box>
                    )
                  }}
                />
              </AccordionDetails>
            </Accordion>

            {/* File Upload Section */}
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Upload Document (Optional)
              </Typography>
              <Button
                variant="outlined"
                component="label"
                startIcon={<UploadIcon />}
                fullWidth
                disabled={uploading}
              >
                {newCertification.file ? newCertification.file.name : 'Choose File'}
                <input
                  type="file"
                  hidden
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={handleFileSelect}
                  ref={fileInputRef}
                />
              </Button>
              {newCertification.file && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  Selected: {newCertification.file.name}
                </Typography>
              )}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, pt: 1 }}>
          <Button 
            onClick={() => setCertificationDialogOpen(false)} 
            disabled={uploading}
          >
            Cancel
          </Button>
          <Button 
            variant="contained" 
            onClick={handleSaveCertification}
            disabled={!newCertification.name || uploading}
          >
            {uploading ? 'Uploading...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default EducationStep;

