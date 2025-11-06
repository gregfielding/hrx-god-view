import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Switch,
  FormControlLabel,
  Alert,
  CircularProgress,
  Button,
  Link as MUILink,
  Grid,
  Autocomplete,
  TextField,
  Chip,
  Divider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import {
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  Launch as LaunchIcon
} from '@mui/icons-material';
import { JobOrder } from '../../types/recruiter/jobOrder';
import { JobsBoardService, JobsBoardPost, CreatePostData } from '../../services/recruiter/jobsBoardService';
import { useAuth } from '../../contexts/AuthContext';
import { doc, updateDoc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import onetSkills from '../../data/onetSkills.json';
import credentialsSeed from '../../data/credentialsSeed.json';
import { experienceOptions, educationOptions } from '../../data/experienceOptions';
import { backgroundCheckOptions, drugScreeningOptions, additionalScreeningOptions } from '../../data/screeningsOptions';

interface GigJobsBoardToggleProps {
  jobOrder: JobOrder;
  onPostUpdated?: (post: JobsBoardPost | null) => void;
}

const GigJobsBoardToggle: React.FC<GigJobsBoardToggleProps> = ({ jobOrder, onPostUpdated }) => {
  const { tenantId } = useAuth();
  const [isActive, setIsActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectedPost, setConnectedPost] = useState<JobsBoardPost | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Requirement fields state - these will be stored on the job_order
  const [backgroundCheckPackages, setBackgroundCheckPackages] = useState<string[]>([]);
  const [showBackgroundChecks, setShowBackgroundChecks] = useState(false);
  const [drugScreeningPanels, setDrugScreeningPanels] = useState<string[]>([]);
  const [showDrugScreening, setShowDrugScreening] = useState(false);
  const [additionalScreenings, setAdditionalScreenings] = useState<string[]>([]);
  const [showAdditionalScreenings, setShowAdditionalScreenings] = useState(false);
  const [skills, setSkills] = useState<string[]>([]);
  const [showSkills, setShowSkills] = useState(false);
  const [licensesCerts, setLicensesCerts] = useState<string[]>([]);
  const [showLicensesCerts, setShowLicensesCerts] = useState(false);
  const [experienceLevels, setExperienceLevels] = useState<string[]>([]);
  const [showExperience, setShowExperience] = useState(false);
  const [educationLevels, setEducationLevels] = useState<string[]>([]);
  const [showEducation, setShowEducation] = useState(false);
  const [languages, setLanguages] = useState<string[]>([]);
  const [showLanguages, setShowLanguages] = useState(false);
  const [physicalRequirements, setPhysicalRequirements] = useState<string[]>([]);
  const [showPhysicalRequirements, setShowPhysicalRequirements] = useState(false);
  const [uniformRequirements, setUniformRequirements] = useState<string[]>([]);
  const [showUniformRequirements, setShowUniformRequirements] = useState(false);
  const [requiredPpe, setRequiredPpe] = useState<string[]>([]);
  const [showRequiredPpe, setShowRequiredPpe] = useState(false);
  const [eVerifyRequired, setEVerifyRequired] = useState<boolean>(false);
  const [savingFields, setSavingFields] = useState(false);
  const [jobDescription, setJobDescription] = useState<string>('');
  
  // Visibility and Group Restriction state
  const [visibility, setVisibility] = useState<'hidden' | 'public' | 'group_restricted'>('public');
  const [restrictedGroups, setRestrictedGroups] = useState<string[]>([]);
  const [userGroups, setUserGroups] = useState<Array<{ id: string; groupName: string }>>([]);

  // Helper to ensure a value is a flat array of strings
  const ensureStringArray = (value: any): string[] => {
    if (!value) return [];
    if (Array.isArray(value)) {
      // Flatten nested arrays and ensure all items are strings
      return value.flat().filter(item => typeof item === 'string' && item.trim() !== '');
    }
    if (typeof value === 'string') {
      return value.trim() !== '' ? [value.trim()] : [];
    }
    return [];
  };

  // Load user groups
  useEffect(() => {
    const loadUserGroups = async () => {
      if (!tenantId) return;
      
      try {
        const groupsRef = collection(db, 'tenants', tenantId, 'userGroups');
        const groupsSnap = await getDocs(groupsRef);
        const groups = groupsSnap.docs.map(doc => ({
          id: doc.id,
          groupName: doc.data().groupName || doc.data().name || doc.id
        }));
        setUserGroups(groups);
      } catch (err) {
        console.error('Error loading user groups:', err);
      }
    };
    
    loadUserGroups();
  }, [tenantId]);

  // Load existing job posting status and requirement fields
  useEffect(() => {
    const loadPostingStatus = async () => {
      if (!tenantId || !jobOrder.id || jobOrder.jobType !== 'gig') {
        setLoading(false);
        return;
      }

      try {
        // Load the latest job_order data to get current requirement fields
        const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrder.id);
        const jobOrderSnap = await getDoc(jobOrderRef);
        
        if (jobOrderSnap.exists()) {
          const jobOrderData = jobOrderSnap.data();
          
          // Load requirement fields from job_order
          setBackgroundCheckPackages(ensureStringArray(jobOrderData.backgroundCheckPackages));
          setDrugScreeningPanels(ensureStringArray(jobOrderData.drugScreeningPanels));
          setAdditionalScreenings(ensureStringArray(jobOrderData.additionalScreenings));
          setSkills(ensureStringArray(jobOrderData.skillsRequired));
          setLicensesCerts(ensureStringArray([...(jobOrderData.requiredLicenses || []), ...(jobOrderData.requiredCertifications || [])]));
          setExperienceLevels(ensureStringArray(jobOrderData.experienceRequired));
          setEducationLevels(ensureStringArray(jobOrderData.educationRequired));
          setLanguages(ensureStringArray(jobOrderData.languagesRequired));
          setPhysicalRequirements(ensureStringArray(jobOrderData.physicalRequirements));
          setUniformRequirements(ensureStringArray(jobOrderData.uniformRequirements));
          setRequiredPpe(ensureStringArray(jobOrderData.ppeRequirements));
          setEVerifyRequired(jobOrderData.eVerifyRequired || false);
          setJobDescription(jobOrderData.jobOrderDescription || jobOrderData.jobDescription || '');
          
          // Load visibility and restrictedGroups
          setVisibility(jobOrderData.visibility || jobOrderData.jobsBoardVisibility || 'public');
          setRestrictedGroups(ensureStringArray(jobOrderData.restrictedGroups));
          
          // Load "show" toggles from job_order (these are new fields we're adding)
          setShowBackgroundChecks(jobOrderData.showBackgroundChecks || false);
          setShowDrugScreening(jobOrderData.showDrugScreening || false);
          setShowAdditionalScreenings(jobOrderData.showAdditionalScreenings || false);
          setShowSkills(jobOrderData.showSkills || false);
          setShowLicensesCerts(jobOrderData.showLicensesCerts || false);
          setShowExperience(jobOrderData.showExperience || false);
          setShowEducation(jobOrderData.showEducation || false);
          setShowLanguages(jobOrderData.showLanguages || false);
          setShowPhysicalRequirements(jobOrderData.showPhysicalRequirements || false);
          setShowUniformRequirements(jobOrderData.showUniformRequirements || false);
          setShowRequiredPpe(jobOrderData.showRequiredPpe || false);
        }

        const jobsBoardService = JobsBoardService.getInstance();
        const posts = await jobsBoardService.getPostsByJobOrder(tenantId, jobOrder.id);
        
        if (posts.length > 0) {
          const activePost = posts.find(p => p.status === 'active') || posts[0];
          setConnectedPost(activePost);
          setIsActive(activePost?.status === 'active');
        } else {
          // Check if there's a stored preference indicating the posting should be active
          const shouldBeActive = localStorage.getItem(`gig-board-active-${jobOrder.id}`);
          
          if (shouldBeActive === 'true') {
            // Auto-recreate the posting if it was previously active
            console.log('Posting was deleted but should be active. Recreating...');
            try {
              const postData = buildPostData();
              const postId = await jobsBoardService.createPost(tenantId, postData);
              const newPost = await jobsBoardService.getPost(tenantId, postId);
              if (newPost) {
                setConnectedPost(newPost);
                setIsActive(true);
                if (onPostUpdated) onPostUpdated(newPost);
              }
            } catch (recreateErr: any) {
              console.error('Error auto-recreating posting:', recreateErr);
              setIsActive(false);
              setConnectedPost(null);
            }
          } else {
            setIsActive(false);
            setConnectedPost(null);
          }
        }
      } catch (err: any) {
        console.error('Error loading posting status:', err);
        setError(err.message || 'Failed to load posting status');
      } finally {
        setLoading(false);
      }
    };

    loadPostingStatus();
  }, [tenantId, jobOrder.id, jobOrder.jobType]);

  // Helper function to build post data from current state
  const buildPostData = (): CreatePostData => {
    return {
      jobOrderId: jobOrder.id,
      postTitle: jobOrder.jobOrderName || 'Gig Position',
      jobType: 'gig' as const,
      jobTitle: (jobOrder as any).gigPositions?.[0]?.jobTitle || jobOrder.jobTitle || '',
      jobDescription: jobDescription || jobOrder.jobOrderDescription || '',
      companyName: jobOrder.companyName || '',
      worksiteName: jobOrder.worksiteName || '',
      worksiteAddress: jobOrder.worksiteAddress || { street: '', city: '', state: '', zipCode: '' },
      payRate: (jobOrder as any).gigPositions?.[0]?.payRate ? parseFloat(String((jobOrder as any).gigPositions[0].payRate)) : jobOrder.payRate,
      showPayRate: jobOrder.showPayRate,
      status: 'active' as const,
      startDate: jobOrder.startDate,
      endDate: jobOrder.endDate,
      requirements: [
        ...ensureStringArray(licensesCerts),
        ...(eVerifyRequired ? ['E-Verify Required'] : []),
        ...ensureStringArray(skills),
        ...ensureStringArray(experienceLevels),
        ...ensureStringArray(educationLevels),
        ...ensureStringArray(languages),
        ...ensureStringArray(physicalRequirements),
        ...ensureStringArray(uniformRequirements),
        ...ensureStringArray(requiredPpe)
      ].filter(Boolean),
      shift: Array.isArray((jobOrder as any).shiftType) ? (jobOrder as any).shiftType : ((jobOrder as any).shiftType ? [(jobOrder as any).shiftType] : []),
      showShift: !!(jobOrder as any).shiftType,
      startTime: '',
      endTime: '',
      showStartTime: false,
      showEndTime: false,
      shiftTimes: '',
      showShiftTimes: jobOrder.showShiftTimes,
      eVerifyRequired,
      backgroundCheckPackages: ensureStringArray(backgroundCheckPackages),
      showBackgroundChecks,
      drugScreeningPanels: ensureStringArray(drugScreeningPanels),
      showDrugScreening,
      additionalScreenings: ensureStringArray(additionalScreenings),
      showAdditionalScreenings,
      skills: ensureStringArray(skills),
      benefits: '',
      // Map visibility from job order format to jobs board format
      visibility: (visibility === 'hidden' ? 'private' : (visibility === 'group_restricted' ? 'restricted' : 'public')) as 'public' | 'private' | 'restricted',
      restrictedGroups: visibility === 'group_restricted' ? restrictedGroups : [],
      maxApplications: undefined,
      expiresAt: undefined,
      autoAddToUserGroup: undefined
    };
  };

  // Save requirement fields to job_order
  const saveRequirementFields = async () => {
    if (!tenantId || !jobOrder.id || savingFields) return;

    try {
      setSavingFields(true);
      const jobOrderRef = doc(db, 'tenants', tenantId, 'job_orders', jobOrder.id);
      
      // Convert arrays back to the format expected by JobOrder type
      // Note: Some fields are arrays in the form but strings in JobOrder - we'll store as arrays
      // and convert when needed
      const updateData: any = {
        backgroundCheckPackages,
        drugScreeningPanels,
        additionalScreenings,
        skillsRequired: skills,
        // Split licensesCerts back into requiredLicenses and requiredCertifications
        // For now, we'll put all in requiredLicenses (or we could try to split by type)
        // Actually, let's keep both arrays separate and combine when displaying
        // We'll need to handle this more intelligently - for now, put all in requiredLicenses
        requiredLicenses: licensesCerts,
        requiredCertifications: [],
        // Convert experienceLevels and educationLevels back to single strings (take first value)
        experienceRequired: experienceLevels.length > 0 ? experienceLevels[0] : undefined,
        educationRequired: educationLevels.length > 0 ? educationLevels[0] : undefined,
        languagesRequired: languages,
        // Convert arrays back to strings (take first value or join)
        physicalRequirements: physicalRequirements.length > 0 ? physicalRequirements[0] : undefined,
        uniformRequirements: uniformRequirements.length > 0 ? uniformRequirements[0] : undefined,
        ppeRequirements: requiredPpe.length > 0 ? requiredPpe[0] : undefined,
        eVerifyRequired,
        // Save "show" toggles
        showBackgroundChecks,
        showDrugScreening,
        showAdditionalScreenings,
        showSkills,
        showLicensesCerts,
        showExperience,
        showEducation,
        showLanguages,
        showPhysicalRequirements,
        showUniformRequirements,
        showRequiredPpe,
        // Save job description
        jobOrderDescription: jobDescription,
        // Save visibility and restrictedGroups
        visibility,
        restrictedGroups: visibility === 'group_restricted' ? restrictedGroups : [],
        updatedAt: new Date()
      };

      await updateDoc(jobOrderRef, updateData);

      // If there's an active posting, update it too
      if (connectedPost && isActive) {
        const jobsBoardService = JobsBoardService.getInstance();
        const postData = buildPostData();
        await jobsBoardService.updatePost(tenantId, connectedPost.id, { ...postData, status: 'active' });
        const updatedPost = await jobsBoardService.getPost(tenantId, connectedPost.id);
        if (updatedPost) {
          setConnectedPost(updatedPost);
          if (onPostUpdated) onPostUpdated(updatedPost);
        }
      }
    } catch (err: any) {
      console.error('Error saving requirement fields:', err);
      setError(err.message || 'Failed to save requirement fields');
    } finally {
      setSavingFields(false);
    }
  };

  // Save fields when they change (debounced)
  useEffect(() => {
    if (!loading) {
      const timer = setTimeout(() => {
        saveRequirementFields();
      }, 1000); // Debounce for 1 second

      return () => clearTimeout(timer);
    }
  }, [
    backgroundCheckPackages, showBackgroundChecks,
    drugScreeningPanels, showDrugScreening,
    additionalScreenings, showAdditionalScreenings,
    skills, showSkills,
    licensesCerts, showLicensesCerts,
    experienceLevels, showExperience,
    educationLevels, showEducation,
    languages, showLanguages,
    physicalRequirements, showPhysicalRequirements,
    uniformRequirements, showUniformRequirements,
    requiredPpe, showRequiredPpe,
    eVerifyRequired,
    jobDescription,
    visibility,
    restrictedGroups,
    loading
  ]);

  const handleToggle = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.checked;
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const jobsBoardService = JobsBoardService.getInstance();

      if (newValue) {
        // Activate: Create or update job posting
        if (connectedPost) {
          // Update existing posting to active with current requirement fields
          const postData = buildPostData();
          await jobsBoardService.updatePost(tenantId!, connectedPost.id, { ...postData, status: 'active' });
          const updatedPost = await jobsBoardService.getPost(tenantId!, connectedPost.id);
          if (updatedPost) {
            setConnectedPost(updatedPost);
            localStorage.setItem(`gig-board-active-${jobOrder.id}`, 'true');
            setSuccess('Gig activated on jobs board');
          }
        } else {
          // Create new posting from job order data
          const postData = buildPostData();
          const postId = await jobsBoardService.createPost(tenantId!, postData);
          const newPost = await jobsBoardService.getPost(tenantId!, postId);
          if (newPost) {
            setConnectedPost(newPost);
            localStorage.setItem(`gig-board-active-${jobOrder.id}`, 'true');
            setSuccess('Gig activated on jobs board');
            if (onPostUpdated) onPostUpdated(newPost);
          }
        }
        setIsActive(true);
      } else {
        // Deactivate: Set posting to paused
        if (connectedPost) {
          await jobsBoardService.updatePost(tenantId!, connectedPost.id, {
            status: 'paused'
          });
          setConnectedPost({ ...connectedPost, status: 'paused' });
          localStorage.removeItem(`gig-board-active-${jobOrder.id}`);
          setSuccess('Gig deactivated from jobs board');
        }
        setIsActive(false);
      }
    } catch (err: any) {
      console.error('Error toggling posting status:', err);
      setError(err.message || 'Failed to update posting status');
      setIsActive(!newValue); // Revert toggle
    } finally {
      setSaving(false);
    }
  };

  // Only show for Gig job orders
  if (jobOrder.jobType !== 'gig') {
    return null;
  }

  if (loading) {
    return (
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <CircularProgress size={20} />
            <Typography variant="body2" color="text.secondary">
              Loading jobs board status...
            </Typography>
          </Box>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {isActive ? (
              <VisibilityIcon color="success" />
            ) : (
              <VisibilityOffIcon color="disabled" />
            )}
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Jobs Board Visibility
            </Typography>
          </Box>
          <FormControlLabel
            control={
              <Switch
                checked={isActive}
                onChange={handleToggle}
                disabled={saving}
                color="primary"
              />
            }
            label={isActive ? 'Active' : 'Inactive'}
            sx={{ ml: 'auto' }}
          />
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {isActive
            ? 'This gig is visible on the public jobs board. All shifts are automatically included.'
            : 'Activate this gig to make it visible on the public jobs board.'}
        </Typography>

        <Divider sx={{ my: 3 }} />

        {/* Visibility and Group Restriction Section */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
            Visibility Settings
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Visibility</InputLabel>
                <Select
                  value={visibility}
                  label="Visibility"
                  onChange={(e) => {
                    const newVisibility = e.target.value as 'hidden' | 'public' | 'group_restricted';
                    setVisibility(newVisibility);
                    if (newVisibility !== 'group_restricted') {
                      setRestrictedGroups([]);
                    }
                  }}
                  disabled={savingFields}
                >
                  <MenuItem value="public">Public - Visible to everyone</MenuItem>
                  <MenuItem value="group_restricted">Restricted - Visible to specific user groups</MenuItem>
                  <MenuItem value="hidden">Hidden - Not visible on jobs board</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              {visibility === 'group_restricted' && (
                <Autocomplete
                  multiple
                  fullWidth
                  options={userGroups}
                  getOptionLabel={(option) => option.groupName || option.id}
                  value={userGroups.filter(g => restrictedGroups.includes(g.id))}
                  onChange={(event, newValue) => {
                    setRestrictedGroups(newValue.map(g => g.id));
                  }}
                  disabled={savingFields}
                  isOptionEqualToValue={(option, value) => option.id === value.id}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="User Groups"
                      helperText="Select user groups that can see this job posting"
                    />
                  )}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip
                        variant="outlined"
                        label={option.groupName || option.id}
                        {...getTagProps({ index })}
                        key={option.id}
                      />
                    ))
                  }
                />
              )}
            </Grid>
          </Grid>
        </Box>

        <Divider sx={{ my: 3 }} />

        <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
          Job Requirements & Display Options
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Configure the requirements for this gig and choose which information to display on the public jobs board.
        </Typography>

        {/* Job Description Section */}
        <Box sx={{ mt: 2, mb: 3 }}>
          <TextField
            label="Job Description"
            fullWidth
            multiline
            rows={4}
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            disabled={savingFields}
            helperText="Provide a detailed description of the role, responsibilities, and requirements"
          />
        </Box>

        {/* E-Verify Required Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              {/* Empty left column for spacing */}
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">E-Verify Required</Typography>
                <Switch
                  checked={eVerifyRequired}
                  onChange={(e) => setEVerifyRequired(e.target.checked)}
                  disabled={savingFields}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Background Checks Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={backgroundCheckOptions.map(option => option.label)}
                value={backgroundCheckPackages}
                onChange={(event, newValue) => {
                  setBackgroundCheckPackages(newValue);
                }}
                disabled={savingFields}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Background Check Packages"
                    helperText="Select required background check packages"
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      variant="outlined"
                      label={option}
                      {...getTagProps({ index })}
                      key={option}
                    />
                  ))
                }
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Background Requirements</Typography>
                <Switch
                  checked={showBackgroundChecks}
                  onChange={(e) => setShowBackgroundChecks(e.target.checked)}
                  disabled={savingFields}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Drug Screening Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={drugScreeningOptions.map(option => option.label)}
                value={drugScreeningPanels}
                onChange={(event, newValue) => {
                  setDrugScreeningPanels(newValue);
                }}
                disabled={savingFields}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Drug Screening Panels"
                    helperText="Select required drug screening panels"
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      variant="outlined"
                      label={option}
                      {...getTagProps({ index })}
                      key={option}
                    />
                  ))
                }
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Drug Screening Requirements</Typography>
                <Switch
                  checked={showDrugScreening}
                  onChange={(e) => setShowDrugScreening(e.target.checked)}
                  disabled={savingFields}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Additional Screenings Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={additionalScreeningOptions.map(option => option.label)}
                value={additionalScreenings}
                onChange={(event, newValue) => {
                  setAdditionalScreenings(newValue);
                }}
                disabled={savingFields}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Additional Screenings"
                    helperText="Select required additional screening types"
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      variant="outlined"
                      label={option}
                      {...getTagProps({ index })}
                      key={option}
                    />
                  ))
                }
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Additional Screenings on Post</Typography>
                <Switch
                  checked={showAdditionalScreenings}
                  onChange={(e) => setShowAdditionalScreenings(e.target.checked)}
                  disabled={savingFields}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Skills Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={onetSkills.map(skill => skill.name)}
                value={skills}
                onChange={(event, newValue) => {
                  setSkills(newValue);
                }}
                disabled={savingFields}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Required Skills"
                    helperText="Select skills required for this position"
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      variant="outlined"
                      label={option}
                      {...getTagProps({ index })}
                      key={option}
                    />
                  ))
                }
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Skills on Post</Typography>
                <Switch
                  checked={showSkills}
                  onChange={(e) => setShowSkills(e.target.checked)}
                  disabled={savingFields}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Licenses & Certifications Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={credentialsSeed
                  .filter(cred => cred.is_active)
                  .map(cred => `${cred.name} (${cred.type})`)}
                value={licensesCerts}
                onChange={(event, newValue) => {
                  setLicensesCerts(newValue);
                }}
                disabled={savingFields}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Licenses & Certifications"
                    helperText="Select required licenses and certifications"
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      variant="outlined"
                      label={option}
                      {...getTagProps({ index })}
                      key={option}
                    />
                  ))
                }
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Licenses & Certifications on Post</Typography>
                <Switch
                  checked={showLicensesCerts}
                  onChange={(e) => setShowLicensesCerts(e.target.checked)}
                  disabled={savingFields}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Experience Levels Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={experienceOptions.map(exp => exp.label)}
                value={experienceLevels}
                onChange={(event, newValue) => {
                  setExperienceLevels(newValue);
                }}
                disabled={savingFields}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Experience Levels"
                    helperText="Select required experience levels"
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      variant="outlined"
                      label={option}
                      {...getTagProps({ index })}
                      key={option}
                    />
                  ))
                }
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Experience on Post</Typography>
                <Switch
                  checked={showExperience}
                  onChange={(e) => setShowExperience(e.target.checked)}
                  disabled={savingFields}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Education Levels Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                options={educationOptions.map(edu => edu.label)}
                value={educationLevels}
                onChange={(event, newValue) => {
                  setEducationLevels(newValue);
                }}
                disabled={savingFields}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Education Levels"
                    helperText="Select required education levels"
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      variant="outlined"
                      label={option}
                      {...getTagProps({ index })}
                      key={option}
                    />
                  ))
                }
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Education on Post</Typography>
                <Switch
                  checked={showEducation}
                  onChange={(e) => setShowEducation(e.target.checked)}
                  disabled={savingFields}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Language Requirements Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                freeSolo
                options={['English', 'Spanish', 'French', 'German', 'Chinese', 'Japanese', 'Korean', 'Arabic', 'Portuguese', 'Italian', 'Russian', 'Hindi']}
                value={languages}
                onChange={(event, newValue) => {
                  setLanguages(newValue);
                }}
                disabled={savingFields}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Language Requirements"
                    helperText="Select required languages for this position"
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      variant="outlined"
                      label={option}
                      {...getTagProps({ index })}
                      key={option}
                    />
                  ))
                }
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Languages on Post</Typography>
                <Switch
                  checked={showLanguages}
                  onChange={(e) => setShowLanguages(e.target.checked)}
                  disabled={savingFields}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Physical Requirements Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                freeSolo
                options={['Lifting 50+ lbs', 'Standing for extended periods', 'Walking/Climbing', 'Kneeling/Crouching', 'Heavy physical work', 'Light physical work']}
                value={physicalRequirements}
                onChange={(event, newValue) => {
                  setPhysicalRequirements(newValue);
                }}
                disabled={savingFields}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Physical Requirements"
                    helperText="Select physical requirements for this position"
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      variant="outlined"
                      label={option}
                      {...getTagProps({ index })}
                      key={option}
                    />
                  ))
                }
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Physical Requirements on Post</Typography>
                <Switch
                  checked={showPhysicalRequirements}
                  onChange={(e) => setShowPhysicalRequirements(e.target.checked)}
                  disabled={savingFields}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Uniform Requirements Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                freeSolo
                options={['Business Casual', 'Uniform Provided', 'Casual', 'Business Professional', 'Safety Uniform', 'Scrubs']}
                value={uniformRequirements}
                onChange={(event, newValue) => {
                  setUniformRequirements(newValue);
                }}
                disabled={savingFields}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Uniform Requirements"
                    helperText="Select dress code and uniform requirements"
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      variant="outlined"
                      label={option}
                      {...getTagProps({ index })}
                      key={option}
                    />
                  ))
                }
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Uniform Requirements on Post</Typography>
                <Switch
                  checked={showUniformRequirements}
                  onChange={(e) => setShowUniformRequirements(e.target.checked)}
                  disabled={savingFields}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {/* Required PPE Section */}
        <Box sx={{ mt: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6}>
              <Autocomplete
                multiple
                fullWidth
                freeSolo
                options={['Hard Hat', 'Safety Glasses', 'Steel-Toed Boots', 'High-Visibility Vest', 'Gloves', 'Respirator', 'Hearing Protection']}
                value={requiredPpe}
                onChange={(event, newValue) => {
                  setRequiredPpe(newValue);
                }}
                disabled={savingFields}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Required PPE"
                    helperText="Select required personal protective equipment"
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      variant="outlined"
                      label={option}
                      {...getTagProps({ index })}
                      key={option}
                    />
                  ))
                }
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '100%' }}>
                <Typography variant="body1">Show Required PPE on Post</Typography>
                <Switch
                  checked={showRequiredPpe}
                  onChange={(e) => setShowRequiredPpe(e.target.checked)}
                  disabled={savingFields}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>

        {savingFields && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2 }}>
            <CircularProgress size={16} />
            <Typography variant="caption" color="text.secondary">
              Saving changes...
            </Typography>
          </Box>
        )}

        {connectedPost && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 3 }}>
            <Typography variant="body2" color="text.secondary">
              View on jobs board:
            </Typography>
            <Button
              component={MUILink}
              href={`/c1/jobs-board/${connectedPost.id}`}
              target="_blank"
              rel="noopener noreferrer"
              size="small"
              startIcon={<LaunchIcon />}
              variant="outlined"
            >
              View Posting
            </Button>
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {success && (
          <Alert severity="success" sx={{ mt: 2 }} onClose={() => setSuccess(null)}>
            {success}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
};

export default GigJobsBoardToggle;

