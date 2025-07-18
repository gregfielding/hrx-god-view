import React, { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  Box,
  Typography,
  TextField,
  Button,
  Chip,
  MenuItem,
  Select,
  InputLabel,
  FormControl,
  Grid,
  IconButton,
  Card,
  CardContent,
  CardHeader,
  Divider,
  Paper,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Avatar,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Badge,
  Alert,
  Tooltip,
  FormControlLabel,
  Switch,
  Snackbar,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  School as SchoolIcon,
  Work as WorkIcon,
  Star as StarIcon,
  Language as LanguageIcon,
  Description as DescriptionIcon,
  Upload as UploadIcon,
  ExpandMore as ExpandMoreIcon,
  Psychology as PsychologyIcon,
  EmojiEvents as EmojiEventsIcon,
  Timeline as TimelineIcon,
  Person as PersonIcon,
  CheckCircle,
} from '@mui/icons-material';
import Autocomplete from '@mui/material/Autocomplete';
import { EducationSection, WorkExperienceSection } from './index';
import ResumeUpload from '../../../../components/ResumeUpload';

const educationLevels = ['High School', "Associate's", "Bachelor's", "Master's", 'Doctorate'];
const skillLevels = ['Beginner', 'Intermediate', 'Advanced', 'Expert'];
const languageProficiencies = ['Basic', 'Conversational', 'Fluent', 'Native'];

export interface SkillsTabProps {
  user: any;
  onUpdate: (updated: any) => void;
  onetSkills: { name: string; type: string; level?: string }[];
  onetJobTitles: string[];
}

const SkillsTab: React.FC<SkillsTabProps> = ({ user, onUpdate, onetSkills, onetJobTitles }) => {
  // Personal & Professional Info
  const [currentJobTitle, setCurrentJobTitle] = useState(user.currentJobTitle || '');
  const [appliedJobTitle, setAppliedJobTitle] = useState(user.appliedJobTitle || '');
  const [aspirationalJobTitles, setAspirationalJobTitles] = useState<string[]>(
    user.aspirationalJobTitles || [],
  );
  const [yearsOfExperience, setYearsOfExperience] = useState(user.yearsOfExperience || '');
  const [specialTraining, setSpecialTraining] = useState(user.specialTraining || '');

  // Demographics & Compliance
  const [dateOfBirth, setDateOfBirth] = useState(user.dateOfBirth || '');
  const [gender, setGender] = useState(user.gender || '');
  const [veteranStatus, setVeteranStatus] = useState(user.veteranStatus || '');
  const [disabilityStatus, setDisabilityStatus] = useState(user.disabilityStatus || '');
  const [workAuthorization, setWorkAuthorization] = useState(user.workAuthorization || '');
  const [workAuthExpiry, setWorkAuthExpiry] = useState(user.workAuthExpiry || '');
  const [emergencyContact, setEmergencyContact] = useState(user.emergencyContact || {
    name: '', relationship: '', phone: '', email: ''
  });

  // Compensation & Preferences
  const [salaryExpectations, setSalaryExpectations] = useState(user.salaryExpectations || {
    minimum: '', target: '', maximum: ''
  });
  const [workPreferences, setWorkPreferences] = useState(user.workPreferences || {
    schedule: 'Full-time',
    travelWillingness: 0,
    relocationWillingness: false,
    relocationLocations: [],
    benefitsPreferences: []
  });

  // New Preference Fields
  const [remoteWorkPreferences, setRemoteWorkPreferences] = useState<string[]>(
    user.remoteWorkPreferences || []
  );
  const [communicationPreferences, setCommunicationPreferences] = useState<string[]>(
    user.communicationPreferences || []
  );
  const [workEnvironmentPreferences, setWorkEnvironmentPreferences] = useState<string[]>(
    user.workEnvironmentPreferences || []
  );
  const [preferredLearningMethods, setPreferredLearningMethods] = useState<string[]>(
    user.preferredLearningMethods || []
  );
  const [industryPreferences, setIndustryPreferences] = useState<string[]>(
    user.industryPreferences || []
  );

  // Input states for new preference fields
  const [remoteWorkInput, setRemoteWorkInput] = useState('');
  const [communicationInput, setCommunicationInput] = useState('');
  const [workEnvironmentInput, setWorkEnvironmentInput] = useState('');
  const [learningMethodInput, setLearningMethodInput] = useState('');
  const [industryInput, setIndustryInput] = useState('');

  // Predefined options for the preference fields
  const remoteWorkOptions = [
    'Fully Remote', 'Hybrid (2-3 days remote)', 'Hybrid (1-2 days remote)', 
    'Office-based with flexibility', 'Fully Office-based', 'Travel-based'
  ];

  const communicationOptions = [
    'Email', 'Slack/Teams', 'Phone calls', 'Video calls', 'In-person meetings',
    'Text messages', 'Project management tools', 'Documentation', 'Social media'
  ];

  const workEnvironmentOptions = [
    'Collaborative team environment', 'Independent work', 'Fast-paced startup',
    'Structured corporate environment', 'Creative/Innovative culture', 
    'Data-driven decision making', 'Customer-focused', 'Technology-forward',
    'Work-life balance emphasis', 'Professional development focus'
  ];

  const learningMethodOptions = [
    'Hands-on training', 'Online courses', 'Mentorship programs', 'Reading/Books',
    'Video tutorials', 'Workshops/Seminars', 'Certification programs', 
    'Peer learning', 'Trial and error', 'Formal education'
  ];

  const industryOptions = [
    'Technology', 'Healthcare', 'Finance', 'Education', 'Manufacturing',
    'Retail', 'Construction', 'Transportation', 'Energy', 'Government',
    'Non-profit', 'Entertainment', 'Real Estate', 'Consulting', 'Marketing'
  ];

  // Skills & Competencies
  const [skills, setSkills] = useState<{ name: string; type: string; level?: string }[]>(
    (user.skills || []).map(
      (skillName: string) => {
        const foundSkill = onetSkills.find((s) => s.name === skillName);
        return foundSkill 
          ? { ...foundSkill, level: foundSkill.level || 'Intermediate' }
          : { name: skillName, type: 'Other', level: 'Intermediate' };
      },
    ),
  );
  const [skillInput, setSkillInput] = useState('');
  const [selectedSkillLevel, setSelectedSkillLevel] = useState('Intermediate');

  // Assessments & Verifications
  const [assessments, setAssessments] = useState(user.assessments || {
    technicalSkills: [],
    personalityResults: {},
    cognitiveScores: {},
    skillsEndorsements: []
  });

  // Certifications & Licenses
  const [certifications, setCertifications] = useState<Array<{
    name: string;
    issuer: string;
    dateObtained: string;
    expiryDate?: string;
    credentialId?: string;
  }>>(user.certifications || []);
  const [certInput, setCertInput] = useState({ name: '', issuer: '', dateObtained: '', expiryDate: '', credentialId: '' });

  // Languages
  const [languages, setLanguages] = useState<Array<{
    language: string;
    proficiency: string;
    isNative: boolean;
  }>>(user.languages || []);
  const [langInput, setLangInput] = useState({ language: '', proficiency: 'Conversational', isNative: false });

  // References & Recommendations
  const [references, setReferences] = useState<Array<{
    name: string;
    title: string;
    company: string;
    phone: string;
    email: string;
    relationship: string;
    status: 'pending' | 'completed' | 'failed';
    notes?: string;
  }>>(user.references || []);
  const [referenceInput, setReferenceInput] = useState({
    name: '', title: '', company: '', phone: '', email: '', relationship: ''
  });

  // Compliance & Background
  const [compliance, setCompliance] = useState(user.compliance || {
    drugTest: { status: 'pending', date: '', facility: '' },
    backgroundCheck: { status: 'pending', date: '', results: '' },
    i9Verification: { status: 'pending', date: '' },
    eVerify: { status: 'pending', date: '', results: '' },
    professionalLicenses: []
  });

  // Availability & Scheduling
  const [availability, setAvailability] = useState(user.availability || {
    startDate: '',
    noticePeriod: '',
    preferredShifts: [],
    weekendAvailability: false,
    holidayAvailability: false,
    overtimeWillingness: false
  });

  // Digital Presence
  const [digitalPresence, setDigitalPresence] = useState(user.digitalPresence || {
    linkedinUrl: '',
    portfolioWebsite: '',
    githubProfile: '',
    socialMediaHandles: {},
    onlinePortfolioLinks: []
  });

  // Documents
  const [resume, setResume] = useState<File | null>(null);
  const [resumeFileName, setResumeFileName] = useState(user.resumeFileName || '');
  const [additionalDocuments, setAdditionalDocuments] = useState<Array<{
    name: string;
    type: string;
    file: File | null;
    uploadDate: string;
  }>>(user.additionalDocuments || []);

  // Education & Work Experience (using existing components)
  const [employmentHistory, setEmploymentHistory] = useState<any[]>(user.employmentHistory || []);
  const [education, setEducation] = useState<any[]>(user.education || []);

  // AI-Generated Insights
  const [aiInsights, setAiInsights] = useState<{
    skillGaps: string[];
    recommendations: string[];
    marketability: number;
    lastAnalyzed: string;
  }>(user.aiInsights || {
    skillGaps: [],
    recommendations: [],
    marketability: 0,
    lastAnalyzed: new Date().toISOString(),
  });

  // Notification state for resume parsing
  const [notification, setNotification] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'info';
  }>({
    open: false,
    message: '',
    severity: 'info'
  });

  const handleAddSkill = () => {
    if (skillInput) {
      setSkills([...skills, { name: skillInput, type: 'Other', level: selectedSkillLevel }]);
      setSkillInput('');
    }
  };

  const handleDeleteSkill = (idx: number) => {
    setSkills(skills.filter((_, i) => i !== idx));
  };

  const handleAddCertification = () => {
    if (certInput.name && certInput.issuer) {
      setCertifications([...certifications, { ...certInput }]);
      setCertInput({ name: '', issuer: '', dateObtained: '', expiryDate: '', credentialId: '' });
    }
  };

  const handleDeleteCertification = (idx: number) => {
    setCertifications(certifications.filter((_, i) => i !== idx));
  };

  const handleAddLanguage = () => {
    if (langInput.language) {
      setLanguages([...languages, { ...langInput }]);
      setLangInput({ language: '', proficiency: 'Conversational', isNative: false });
    }
  };

  const handleDeleteLanguage = (idx: number) => {
    setLanguages(languages.filter((_, i) => i !== idx));
  };

  const handleAddReference = () => {
    if (referenceInput.name && referenceInput.title && referenceInput.company) {
      setReferences([...references, { ...referenceInput, status: 'pending' }]);
      setReferenceInput({
        name: '', title: '', company: '', phone: '', email: '', relationship: ''
      });
    }
  };

  const handleDeleteReference = (idx: number) => {
    setReferences(references.filter((_, i) => i !== idx));
  };

  // Handler functions for new preference fields
  const handleAddRemoteWorkPreference = () => {
    if (remoteWorkInput && !remoteWorkPreferences.includes(remoteWorkInput)) {
      setRemoteWorkPreferences([...remoteWorkPreferences, remoteWorkInput]);
      setRemoteWorkInput('');
    }
  };

  const handleDeleteRemoteWorkPreference = (preference: string) => {
    setRemoteWorkPreferences(remoteWorkPreferences.filter(p => p !== preference));
  };

  const handleAddCommunicationPreference = () => {
    if (communicationInput && !communicationPreferences.includes(communicationInput)) {
      setCommunicationPreferences([...communicationPreferences, communicationInput]);
      setCommunicationInput('');
    }
  };

  const handleDeleteCommunicationPreference = (preference: string) => {
    setCommunicationPreferences(communicationPreferences.filter(p => p !== preference));
  };

  const handleAddWorkEnvironmentPreference = () => {
    if (workEnvironmentInput && !workEnvironmentPreferences.includes(workEnvironmentInput)) {
      setWorkEnvironmentPreferences([...workEnvironmentPreferences, workEnvironmentInput]);
      setWorkEnvironmentInput('');
    }
  };

  const handleDeleteWorkEnvironmentPreference = (preference: string) => {
    setWorkEnvironmentPreferences(workEnvironmentPreferences.filter(p => p !== preference));
  };

  const handleAddLearningMethod = () => {
    if (learningMethodInput && !preferredLearningMethods.includes(learningMethodInput)) {
      setPreferredLearningMethods([...preferredLearningMethods, learningMethodInput]);
      setLearningMethodInput('');
    }
  };

  const handleDeleteLearningMethod = (method: string) => {
    setPreferredLearningMethods(preferredLearningMethods.filter(m => m !== method));
  };

  const handleAddIndustryPreference = () => {
    if (industryInput && !industryPreferences.includes(industryInput)) {
      setIndustryPreferences([...industryPreferences, industryInput]);
      setIndustryInput('');
    }
  };

  const handleDeleteIndustryPreference = (industry: string) => {
    setIndustryPreferences(industryPreferences.filter(i => i !== industry));
  };

  const handleResumeParsed = (parsedData: any) => {
    // Update the user data with parsed information
    const updates: any = {};
    
    // Update skills if parsed
    if (parsedData.skills && parsedData.skills.length > 0) {
      const newSkills = parsedData.skills.map((skill: any) => ({
        name: skill.name,
        type: skill.type || 'Other',
        level: skill.level || 'Intermediate'
      }));
      setSkills([...skills, ...newSkills.filter((newSkill: any) => 
        !skills.some(existing => existing.name === newSkill.name)
      )]);
      updates.skills = newSkills;
    }
    
    // Update education if parsed
    if (parsedData.education && parsedData.education.length > 0) {
      setEducation([...education, ...parsedData.education]);
      updates.education = parsedData.education;
    }
    
    // Update work experience if parsed
    if (parsedData.experience && parsedData.experience.length > 0) {
      setEmploymentHistory([...employmentHistory, ...parsedData.experience]);
      updates.employmentHistory = parsedData.experience;
    }
    
    // Update certifications if parsed
    if (parsedData.certifications && parsedData.certifications.length > 0) {
      const newCerts = parsedData.certifications.map((cert: any) => ({
        name: cert.name,
        issuer: cert.issuer || 'Unknown',
        dateObtained: cert.dateObtained || new Date().toISOString().split('T')[0],
        credentialId: cert.credentialId || ''
      }));
      setCertifications([...certifications, ...newCerts]);
      updates.certifications = newCerts;
    }
    
    // Update languages if parsed
    if (parsedData.languages && parsedData.languages.length > 0) {
      const newLanguages = parsedData.languages.map((lang: any) => ({
        language: lang.language,
        proficiency: lang.proficiency || 'Conversational',
        isNative: lang.isNative || false
      }));
      setLanguages([...languages, ...newLanguages.filter((newLang: any) => 
        !languages.some(existing => existing.language === newLang.language)
      )]);
      updates.languages = newLanguages;
    }
    
    // Update contact information if parsed
    if (parsedData.contact) {
      if (parsedData.contact.name && !user.firstName && !user.lastName) {
        const nameParts = parsedData.contact.name.split(' ');
        updates.firstName = nameParts[0] || '';
        updates.lastName = nameParts.slice(1).join(' ') || '';
      }
    }
    
    // Show success notification
    setNotification({
      open: true,
      message: 'Resume parsed successfully! Your profile has been updated with the extracted information.',
      severity: 'success'
    });
    
    // Update the parent component
    onUpdate(updates);
  };

  const handleCloseNotification = () => {
    setNotification(prev => ({ ...prev, open: false }));
  };

  const handleResumeUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setResume(e.target.files[0]);
      setResumeFileName(e.target.files[0].name);
    }
  };

  const handleSave = async () => {
    const updatedData = {
      currentJobTitle,
      appliedJobTitle,
      aspirationalJobTitles,
      yearsOfExperience,
      specialTraining,
      // Demographics & Compliance
      dateOfBirth,
      gender,
      veteranStatus,
      disabilityStatus,
      workAuthorization,
      workAuthExpiry,
      emergencyContact,
      // Compensation & Preferences
      salaryExpectations,
      workPreferences,
      // New Preference Fields
      remoteWorkPreferences,
      communicationPreferences,
      workEnvironmentPreferences,
      preferredLearningMethods,
      industryPreferences,
      // Skills & Competencies
      skills: skills.map((s) => ({ name: s.name, type: s.type, level: s.level })),
      assessments,
      // Certifications & References
      certifications,
      languages,
      references,
      // Compliance & Background
      compliance,
      // Availability & Scheduling
      availability,
      // Digital Presence
      digitalPresence,
      // Documents
      resume,
      resumeFileName,
      additionalDocuments,
      // Education & Experience
      education,
      employmentHistory,
      // AI Insights
      aiInsights,
    };

    // Update the user data
    onUpdate(updatedData);

    // Log the qualifications update and trigger AI review
    try {
      const functions = getFunctions();
      const logAIAction = httpsCallable(functions, 'logAIAction');
      
      // Get the current user ID from the user object or props
      const workerId = user?.uid || user?.id || 'unknown';
      
      await logAIAction({
        actionType: 'qualifications_updated',
        sourceModule: 'SkillsTab',
        userId: workerId,
        targetId: workerId,
        targetType: 'worker_qualifications',
        aiRelevant: true,
        contextType: 'worker_profile',
        urgencyScore: 5,
        eventType: 'worker.qualifications.updated',
        reason: `Worker qualifications updated with ${Object.keys(updatedData).length} fields`,
        success: true,
        latencyMs: 0,
        versionTag: 'v1',
        metadata: {
          fieldsUpdated: Object.keys(updatedData),
          skillsCount: skills.length,
          certificationsCount: certifications.length,
          languagesCount: languages.length,
          referencesCount: references.length,
          hasNewSkills: skills.some(s => s.level),
          hasNewCertifications: certifications.length > 0,
          complianceStatus: compliance,
        }
      });

      // Note: triggerAIReview function doesn't exist yet, so we'll just log the action
      // The AI engine processor will handle the review based on the log entry
      console.log('Qualifications update logged successfully. AI review will be triggered by the engine processor.');

    } catch (error) {
      console.error('Error logging qualifications update:', error);
      // Don't throw - the save should still work even if logging fails
    }
  };

  const getSkillLevelColor = (level: string) => {
    switch (level) {
      case 'Expert': return 'success';
      case 'Advanced': return 'primary';
      case 'Intermediate': return 'warning';
      case 'Beginner': return 'default';
      default: return 'default';
    }
  };

  const getProficiencyColor = (proficiency: string) => {
    switch (proficiency) {
      case 'Native': return 'success';
      case 'Fluent': return 'primary';
      case 'Conversational': return 'warning';
      case 'Basic': return 'default';
      default: return 'default';
    }
  };

  return (
    <Box sx={{ p: 0 /* removed maxWidth and mx for full width */ }}>
      <Box display="flex" flexDirection="column" mb={3}>
        <Typography variant="h6" gutterBottom>
          Qualifications & Skills
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Comprehensive overview of your professional qualifications, skills, and experience
        </Typography>
      </Box>

      <Grid container spacing={3}>
        {/* Personal & Professional Information */}
        <Grid item xs={12} md={6}>
          <Box sx={{ pt: 3, pb: 3, borderRadius: 2 }}>
            <Box display="flex" alignItems="center" mb={2}>
              <PersonIcon color="primary" sx={{ mr: 1 }} />
              <Typography variant="h6">Professional Information</Typography>
            </Box>
            <Grid container spacing={2}>
                <Grid item xs={12}>
                  <Autocomplete
                    options={onetJobTitles}
                    value={currentJobTitle}
                    onChange={(_, newValue) => setCurrentJobTitle(newValue || '')}
                    renderInput={(params) => (
                      <TextField {...params} label="Current Job Title" fullWidth />
                    )}
                  />
                </Grid>
                <Grid item xs={12}>
                  <Autocomplete
                    options={onetJobTitles}
                    value={appliedJobTitle}
                    onChange={(_, newValue) => setAppliedJobTitle(newValue || '')}
                    renderInput={(params) => (
                      <TextField {...params} label="Applied Job Title" fullWidth />
                    )}
                  />
                </Grid>
                <Grid item xs={12}>
                  <Autocomplete
                    multiple
                    options={onetJobTitles}
                    value={aspirationalJobTitles}
                    onChange={(_, newValue) => setAspirationalJobTitles(newValue)}
                    renderInput={(params) => (
                      <TextField {...params} label="Career Goals / Aspirational Roles" fullWidth />
                    )}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="Years of Experience"
                    type="number"
                    fullWidth
                    value={yearsOfExperience}
                    onChange={(e) => setYearsOfExperience(e.target.value)}
                    InputProps={{ inputProps: { min: 0, max: 50 } }}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    label="Special Training or Certifications"
                    fullWidth
                    multiline
                    minRows={2}
                    value={specialTraining}
                    onChange={(e) => setSpecialTraining(e.target.value)}
                    placeholder="Describe any special training, workshops, or additional qualifications..."
                  />
                </Grid>
              </Grid>
          </Box>
        </Grid>

        {/* Demographics & Compliance */}
        <Grid item xs={12} md={6}>
          <Box sx={{ pt: 3, pb: 3, borderRadius: 2 }}>
            <Box display="flex" alignItems="center" mb={2}>
              <PersonIcon color="secondary" sx={{ mr: 1 }} />
              <Typography variant="h6">Demographics & Compliance</Typography>
            </Box>
            <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="Date of Birth"
                    type="date"
                    fullWidth
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Gender</InputLabel>
                    <Select value={gender} onChange={(e) => setGender(e.target.value)} label="Gender">
                      <MenuItem value="">Prefer not to say</MenuItem>
                      <MenuItem value="male">Male</MenuItem>
                      <MenuItem value="female">Female</MenuItem>
                      <MenuItem value="non-binary">Non-binary</MenuItem>
                      <MenuItem value="other">Other</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Veteran Status</InputLabel>
                    <Select value={veteranStatus} onChange={(e) => setVeteranStatus(e.target.value)} label="Veteran Status">
                      <MenuItem value="">No</MenuItem>
                      <MenuItem value="veteran">Veteran</MenuItem>
                      <MenuItem value="protected-veteran">Protected Veteran</MenuItem>
                      <MenuItem value="disabled-veteran">Disabled Veteran</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Work Authorization</InputLabel>
                    <Select value={workAuthorization} onChange={(e) => setWorkAuthorization(e.target.value)} label="Work Authorization">
                      <MenuItem value="us-citizen">US Citizen</MenuItem>
                      <MenuItem value="permanent-resident">Permanent Resident</MenuItem>
                      <MenuItem value="visa-holder">Visa Holder</MenuItem>
                      <MenuItem value="other">Other</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="Work Auth Expiry"
                    type="date"
                    fullWidth
                    value={workAuthExpiry}
                    onChange={(e) => setWorkAuthExpiry(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                  />
                </Grid>
              </Grid>
          </Box>
        </Grid>

        {/* AI Insights */}
        <Grid item xs={12} md={6}>
          <Box sx={{ pt: 3, pb: 3, borderRadius: 2 }}>
            <Box display="flex" alignItems="center" mb={2}>
              <PsychologyIcon color="secondary" sx={{ mr: 1 }} />
              <Typography variant="h6">AI Career Insights</Typography>
            </Box>
            <Box mb={2}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Marketability Score
                </Typography>
                <Box display="flex" alignItems="center" gap={1}>
                  <Typography variant="h4" color="primary">
                    {aiInsights.marketability || 0}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    / 100
                  </Typography>
                </Box>
              </Box>
              
              {aiInsights.skillGaps.length > 0 && (
                <Box mb={2}>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Identified Skill Gaps
                  </Typography>
                  <Box display="flex" flexWrap="wrap" gap={1}>
                    {aiInsights.skillGaps.slice(0, 3).map((gap, idx) => (
                      <Chip key={idx} label={gap} size="small" color="warning" variant="outlined" />
                    ))}
                  </Box>
                </Box>
              )}

              {aiInsights.recommendations.length > 0 && (
                <Box>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    AI Recommendations
                  </Typography>
                  <List dense>
                    {aiInsights.recommendations.slice(0, 2).map((rec, idx) => (
                      <ListItem key={idx} sx={{ py: 0.5 }}>
                        <ListItemIcon sx={{ minWidth: 24 }}>
                          <StarIcon fontSize="small" color="primary" />
                        </ListItemIcon>
                        <ListItemText primary={rec} primaryTypographyProps={{ variant: 'body2' }} />
                      </ListItem>
                    ))}
                  </List>
                </Box>
              )}

              <Typography variant="caption" color="text.secondary" display="block" mt={1}>
                Last analyzed: {new Date(aiInsights.lastAnalyzed).toLocaleDateString()}
              </Typography>
          </Box>
        </Grid>

        {/* Skills & Competencies */}
        <Grid item xs={12}>
          <Box sx={{ pt: 3, pb: 3, borderRadius: 2 }}>
            <Box display="flex" alignItems="center" mb={2}>
              <TimelineIcon color="primary" sx={{ mr: 1 }} />
              <Typography variant="h6">Skills & Competencies</Typography>
            </Box>
            <Grid container spacing={2}>
                <Grid item xs={12} md={8}>
                  <Autocomplete
                    multiple
                    options={onetSkills}
                    groupBy={(option) => option.type}
                    getOptionLabel={(option) => option.name}
                    value={skills}
                    onChange={(_, newValue) => setSkills(newValue)}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => (
                        <Chip
                          label={`${option.name}${option.level ? ` (${option.level})` : ''}`}
                          {...getTagProps({ index })}
                          color={getSkillLevelColor(option.level || 'Intermediate')}
                          variant="outlined"
                          key={option.name}
                        />
                      ))
                    }
                    renderInput={(params) => (
                      <TextField {...params} label="Professional Skills" fullWidth />
                    )}
                  />
                </Grid>
                <Grid item xs={12} md={4}>
                  <Box display="flex" gap={1}>
                    <TextField
                      label="Add Custom Skill"
                      value={skillInput}
                      onChange={(e) => setSkillInput(e.target.value)}
                      size="small"
                      fullWidth
                    />
                    <FormControl size="small" sx={{ minWidth: 120 }}>
                      <InputLabel>Level</InputLabel>
                      <Select
                        value={selectedSkillLevel}
                        onChange={(e) => setSelectedSkillLevel(e.target.value)}
                        label="Level"
                      >
                        {skillLevels.map((level) => (
                          <MenuItem key={level} value={level}>
                            {level}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <IconButton onClick={handleAddSkill} color="primary">
                      <AddIcon />
                    </IconButton>
                  </Box>
                </Grid>
              </Grid>
          </Box>
        </Grid>

        {/* Compensation & Preferences */}
        <Grid item xs={12} md={6}>
          <Box sx={{ pt: 3, pb: 3, borderRadius: 2 }}>
            <Box display="flex" alignItems="center" mb={2}>
              <EmojiEventsIcon color="primary" sx={{ mr: 1 }} />
              <Typography variant="h6">Compensation & Preferences</Typography>
            </Box>
            <Grid container spacing={2}>
                <Grid item xs={12} sm={4}>
                  <TextField
                    label="Min Salary"
                    type="number"
                    fullWidth
                    value={salaryExpectations.minimum}
                    onChange={(e) => setSalaryExpectations({...salaryExpectations, minimum: e.target.value})}
                    InputProps={{ startAdornment: <Typography>$</Typography> }}
                  />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField
                    label="Target Salary"
                    type="number"
                    fullWidth
                    value={salaryExpectations.target}
                    onChange={(e) => setSalaryExpectations({...salaryExpectations, target: e.target.value})}
                    InputProps={{ startAdornment: <Typography>$</Typography> }}
                  />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField
                    label="Max Salary"
                    type="number"
                    fullWidth
                    value={salaryExpectations.maximum}
                    onChange={(e) => setSalaryExpectations({...salaryExpectations, maximum: e.target.value})}
                    InputProps={{ startAdornment: <Typography>$</Typography> }}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Work Schedule</InputLabel>
                    <Select 
                      value={workPreferences.schedule} 
                      onChange={(e) => setWorkPreferences({...workPreferences, schedule: e.target.value})} 
                      label="Work Schedule"
                    >
                      <MenuItem value="Full-time">Full-time</MenuItem>
                      <MenuItem value="Part-time">Part-time</MenuItem>
                      <MenuItem value="Flexible">Flexible</MenuItem>
                      <MenuItem value="Contract">Contract</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Travel Willingness</InputLabel>
                    <Select 
                      value={workPreferences.travelWillingness} 
                      onChange={(e) => setWorkPreferences({...workPreferences, travelWillingness: e.target.value})} 
                      label="Travel Willingness"
                    >
                      <MenuItem value={0}>None</MenuItem>
                      <MenuItem value={25}>25%</MenuItem>
                      <MenuItem value={50}>50%</MenuItem>
                      <MenuItem value={75}>75%</MenuItem>
                      <MenuItem value={100}>100%</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
          </Box>
        </Grid>

        {/* Work & Cultural Preferences */}
        <Grid item xs={12}>
          <Box sx={{ pt: 3, pb: 3, borderRadius: 2 }}>
            <Box display="flex" alignItems="center" mb={2}>
              <PsychologyIcon color="primary" sx={{ mr: 1 }} />
              <Typography variant="h6">Work & Cultural Preferences</Typography>
            </Box>
            <Grid container spacing={3}>
              {/* Remote Work Preferences */}
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" gutterBottom>
                  Remote Work Preferences
                </Typography>
                <Box display="flex" gap={1} mb={2}>
                  <Autocomplete
                    options={remoteWorkOptions}
                    value={remoteWorkInput}
                    onChange={(_, newValue) => setRemoteWorkInput(newValue || '')}
                    renderInput={(params) => (
                      <TextField {...params} label="Add remote work preference" size="small" fullWidth />
                    )}
                  />
                  <IconButton onClick={handleAddRemoteWorkPreference} color="primary" disabled={!remoteWorkInput}>
                    <AddIcon />
                  </IconButton>
                </Box>
                <Box display="flex" flexWrap="wrap" gap={1}>
                  {remoteWorkPreferences.map((preference, idx) => (
                    <Chip
                      key={idx}
                      label={preference}
                      onDelete={() => handleDeleteRemoteWorkPreference(preference)}
                      color="primary"
                      variant="outlined"
                      size="small"
                    />
                  ))}
                </Box>
              </Grid>

              {/* Communication Preferences */}
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" gutterBottom>
                  Communication Preferences
                </Typography>
                <Box display="flex" gap={1} mb={2}>
                  <Autocomplete
                    options={communicationOptions}
                    value={communicationInput}
                    onChange={(_, newValue) => setCommunicationInput(newValue || '')}
                    renderInput={(params) => (
                      <TextField {...params} label="Add communication preference" size="small" fullWidth />
                    )}
                  />
                  <IconButton onClick={handleAddCommunicationPreference} color="primary" disabled={!communicationInput}>
                    <AddIcon />
                  </IconButton>
                </Box>
                <Box display="flex" flexWrap="wrap" gap={1}>
                  {communicationPreferences.map((preference, idx) => (
                    <Chip
                      key={idx}
                      label={preference}
                      onDelete={() => handleDeleteCommunicationPreference(preference)}
                      color="secondary"
                      variant="outlined"
                      size="small"
                    />
                  ))}
                </Box>
              </Grid>

              {/* Work Environment Preferences */}
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" gutterBottom>
                  Work Environment Preferences
                </Typography>
                <Box display="flex" gap={1} mb={2}>
                  <Autocomplete
                    options={workEnvironmentOptions}
                    value={workEnvironmentInput}
                    onChange={(_, newValue) => setWorkEnvironmentInput(newValue || '')}
                    renderInput={(params) => (
                      <TextField {...params} label="Add work environment preference" size="small" fullWidth />
                    )}
                  />
                  <IconButton onClick={handleAddWorkEnvironmentPreference} color="primary" disabled={!workEnvironmentInput}>
                    <AddIcon />
                  </IconButton>
                </Box>
                <Box display="flex" flexWrap="wrap" gap={1}>
                  {workEnvironmentPreferences.map((preference, idx) => (
                    <Chip
                      key={idx}
                      label={preference}
                      onDelete={() => handleDeleteWorkEnvironmentPreference(preference)}
                      color="success"
                      variant="outlined"
                      size="small"
                    />
                  ))}
                </Box>
              </Grid>

              {/* Preferred Learning Methods */}
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" gutterBottom>
                  Preferred Learning Methods
                </Typography>
                <Box display="flex" gap={1} mb={2}>
                  <Autocomplete
                    options={learningMethodOptions}
                    value={learningMethodInput}
                    onChange={(_, newValue) => setLearningMethodInput(newValue || '')}
                    renderInput={(params) => (
                      <TextField {...params} label="Add learning method" size="small" fullWidth />
                    )}
                  />
                  <IconButton onClick={handleAddLearningMethod} color="primary" disabled={!learningMethodInput}>
                    <AddIcon />
                  </IconButton>
                </Box>
                <Box display="flex" flexWrap="wrap" gap={1}>
                  {preferredLearningMethods.map((method, idx) => (
                    <Chip
                      key={idx}
                      label={method}
                      onDelete={() => handleDeleteLearningMethod(method)}
                      color="warning"
                      variant="outlined"
                      size="small"
                    />
                  ))}
                </Box>
              </Grid>

              {/* Industry Preferences */}
              <Grid item xs={12}>
                <Typography variant="subtitle1" gutterBottom>
                  Industry Preferences
                </Typography>
                <Box display="flex" gap={1} mb={2}>
                  <Autocomplete
                    options={industryOptions}
                    value={industryInput}
                    onChange={(_, newValue) => setIndustryInput(newValue || '')}
                    renderInput={(params) => (
                      <TextField {...params} label="Add industry preference" size="small" fullWidth />
                    )}
                  />
                  <IconButton onClick={handleAddIndustryPreference} color="primary" disabled={!industryInput}>
                    <AddIcon />
                  </IconButton>
                </Box>
                <Box display="flex" flexWrap="wrap" gap={1}>
                  {industryPreferences.map((industry, idx) => (
                    <Chip
                      key={idx}
                      label={industry}
                      onDelete={() => handleDeleteIndustryPreference(industry)}
                      color="info"
                      variant="outlined"
                      size="small"
                    />
                  ))}
                </Box>
              </Grid>
            </Grid>
          </Box>
        </Grid>

        {/* References */}
        <Grid item xs={12} md={6}>
          <Box sx={{ pt: 3, pb: 3, borderRadius: 2 }}>
            <Box display="flex" alignItems="center" mb={2}>
              <PersonIcon color="primary" sx={{ mr: 1 }} />
              <Typography variant="h6">Professional References</Typography>
            </Box>
            <List dense>
              {references.map((ref, idx) => (
                <Paper key={idx} sx={{ p: 2, mb: 2, bgcolor: 'grey.50' }}>
                  <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                    <Box flex={1}>
                      <Typography variant="subtitle2" fontWeight="bold">
                        {ref.name} - {ref.title}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {ref.company} • {ref.relationship}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {ref.phone} • {ref.email}
                      </Typography>
                      <Chip 
                        label={ref.status} 
                        size="small" 
                        color={ref.status === 'completed' ? 'success' : ref.status === 'failed' ? 'error' : 'warning'}
                        sx={{ mt: 1 }}
                      />
                    </Box>
                    <IconButton size="small" onClick={() => handleDeleteReference(idx)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </Paper>
              ))}
              
              <Button variant="outlined" onClick={handleAddReference} startIcon={<AddIcon />} fullWidth>
                Add Reference
              </Button>
            </List>
          </Box>
        </Grid>

        {/* Certifications & Languages Row */}
        <Grid item xs={12} md={6}>
          <Box sx={{ pt: 3, pb: 3, borderRadius: 2 }}>
            <Box display="flex" alignItems="center" mb={2}>
              <EmojiEventsIcon color="primary" sx={{ mr: 1 }} />
              <Typography variant="h6">Certifications & Licenses</Typography>
            </Box>
            <List dense>
              {certifications.map((cert, idx) => (
                <Paper key={idx} sx={{ p: 2, mb: 2, bgcolor: 'grey.50' }}>
                  <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                    <Box flex={1}>
                      <Typography variant="subtitle2" fontWeight="bold">
                        {cert.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Issued by: {cert.issuer}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {cert.dateObtained} {cert.expiryDate && `- Expires: ${cert.expiryDate}`}
                      </Typography>
                      {cert.credentialId && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          ID: {cert.credentialId}
                        </Typography>
                      )}
                    </Box>
                    <IconButton size="small" onClick={() => handleDeleteCertification(idx)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </Paper>
              ))}
              
              <Box display="flex" gap={1} mt={2}>
                <TextField
                  label="Certification Name"
                  value={certInput.name}
                  onChange={(e) => setCertInput({ ...certInput, name: e.target.value })}
                  size="small"
                  fullWidth
                />
                <TextField
                  label="Issuer"
                  value={certInput.issuer}
                  onChange={(e) => setCertInput({ ...certInput, issuer: e.target.value })}
                  size="small"
                  fullWidth
                />
                <IconButton onClick={handleAddCertification} color="primary">
                  <AddIcon />
                </IconButton>
              </Box>
            </List>
          </Box>
        </Grid>

        <Grid item xs={12} md={6}>
          <Box sx={{ pt: 3, pb: 3, borderRadius: 2 }}>
            <Box display="flex" alignItems="center" mb={2}>
              <LanguageIcon color="primary" sx={{ mr: 1 }} />
              <Typography variant="h6">Languages</Typography>
            </Box>
            <List dense>
              {languages.map((lang, idx) => (
                <Box key={idx} display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                  <Box display="flex" alignItems="center" gap={1}>
                    <Typography variant="body2" fontWeight="medium">
                      {lang.language}
                    </Typography>
                    <Chip
                      label={lang.proficiency}
                      size="small"
                      color={getProficiencyColor(lang.proficiency)}
                      variant="outlined"
                    />
                    {lang.isNative && (
                      <Chip label="Native" size="small" color="success" />
                    )}
                  </Box>
                  <IconButton size="small" onClick={() => handleDeleteLanguage(idx)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
              
              <Box display="flex" gap={1} mt={2}>
                <TextField
                  label="Language"
                  value={langInput.language}
                  onChange={(e) => setLangInput({ ...langInput, language: e.target.value })}
                  size="small"
                  fullWidth
                />
                <FormControl size="small" sx={{ minWidth: 120 }}>
                  <InputLabel>Proficiency</InputLabel>
                  <Select
                    value={langInput.proficiency}
                    onChange={(e) => setLangInput({ ...langInput, proficiency: e.target.value })}
                    label="Proficiency"
                  >
                    {languageProficiencies.map((prof) => (
                      <MenuItem key={prof} value={prof}>
                        {prof}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <IconButton onClick={handleAddLanguage} color="primary">
                  <AddIcon />
                </IconButton>
              </Box>
            </List>
          </Box>
        </Grid>

        {/* Education Section */}
        <Grid item xs={12}>
          <Box sx={{ pt: 3, pb: 3, borderRadius: 2 }}>
            <Box display="flex" alignItems="center" mb={2}>
              <SchoolIcon color="primary" sx={{ mr: 1 }} />
              <Typography variant="h6">Education & Training</Typography>
            </Box>
            <EducationSection value={education} onChange={setEducation} />
          </Box>
        </Grid>

        {/* Work Experience Section */}
        <Grid item xs={12}>
          <Box sx={{ pt: 3, pb: 3, borderRadius: 2 }}>
            <Box display="flex" alignItems="center" mb={2}>
              <WorkIcon color="primary" sx={{ mr: 1 }} />
              <Typography variant="h6">Work Experience</Typography>
            </Box>
            <WorkExperienceSection
                value={employmentHistory}
                onChange={setEmploymentHistory}
                onetSkills={onetSkills}
                onetJobTitles={onetJobTitles}
              />
          </Box>
        </Grid>

        {/* Compliance & Background */}
        <Grid item xs={12} md={6}>
          <Box sx={{ pt: 3, pb: 3, borderRadius: 2 }}>
            <Box display="flex" alignItems="center" mb={2}>
              <CheckCircle color="primary" sx={{ mr: 1 }} />
              <Typography variant="h6">Compliance & Background</Typography>
            </Box>
            <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Drug Test Status</InputLabel>
                    <Select 
                      value={compliance.drugTest.status} 
                      onChange={(e) => setCompliance({
                        ...compliance, 
                        drugTest: {...compliance.drugTest, status: e.target.value}
                      })} 
                      label="Drug Test Status"
                    >
                      <MenuItem value="pending">Pending</MenuItem>
                      <MenuItem value="passed">Passed</MenuItem>
                      <MenuItem value="failed">Failed</MenuItem>
                      <MenuItem value="not-required">Not Required</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>Background Check</InputLabel>
                    <Select 
                      value={compliance.backgroundCheck.status} 
                      onChange={(e) => setCompliance({
                        ...compliance, 
                        backgroundCheck: {...compliance.backgroundCheck, status: e.target.value}
                      })} 
                      label="Background Check"
                    >
                      <MenuItem value="pending">Pending</MenuItem>
                      <MenuItem value="passed">Passed</MenuItem>
                      <MenuItem value="failed">Failed</MenuItem>
                      <MenuItem value="not-required">Not Required</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>I-9 Verification</InputLabel>
                    <Select 
                      value={compliance.i9Verification.status} 
                      onChange={(e) => setCompliance({
                        ...compliance, 
                        i9Verification: {...compliance.i9Verification, status: e.target.value}
                      })} 
                      label="I-9 Verification"
                    >
                      <MenuItem value="pending">Pending</MenuItem>
                      <MenuItem value="completed">Completed</MenuItem>
                      <MenuItem value="failed">Failed</MenuItem>
                      <MenuItem value="not-required">Not Required</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth>
                    <InputLabel>E-Verify Status</InputLabel>
                    <Select 
                      value={compliance.eVerify.status} 
                      onChange={(e) => setCompliance({
                        ...compliance, 
                        eVerify: {...compliance.eVerify, status: e.target.value}
                      })} 
                      label="E-Verify Status"
                    >
                      <MenuItem value="pending">Pending</MenuItem>
                      <MenuItem value="verified">Verified</MenuItem>
                      <MenuItem value="failed">Failed</MenuItem>
                      <MenuItem value="not-required">Not Required</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
          </Box>
        </Grid>

        {/* Availability & Scheduling */}
        <Grid item xs={12} md={6}>
          <Box sx={{ pt: 3, pb: 3, borderRadius: 2 }}>
            <Box display="flex" alignItems="center" mb={2}>
              <TimelineIcon color="primary" sx={{ mr: 1 }} />
              <Typography variant="h6">Availability & Scheduling</Typography>
            </Box>
            <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="Available Start Date"
                    type="date"
                    fullWidth
                    value={availability.startDate}
                    onChange={(e) => setAvailability({...availability, startDate: e.target.value})}
                    InputLabelProps={{ shrink: true }}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="Notice Period (weeks)"
                    type="number"
                    fullWidth
                    value={availability.noticePeriod}
                    onChange={(e) => setAvailability({...availability, noticePeriod: e.target.value})}
                    InputProps={{ inputProps: { min: 0, max: 12 } }}
                  />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <FormControlLabel
                    control={
                      <Switch 
                        checked={availability.weekendAvailability}
                        onChange={(e) => setAvailability({...availability, weekendAvailability: e.target.checked})}
                      />
                    }
                    label="Weekend Available"
                  />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <FormControlLabel
                    control={
                      <Switch 
                        checked={availability.holidayAvailability}
                        onChange={(e) => setAvailability({...availability, holidayAvailability: e.target.checked})}
                      />
                    }
                    label="Holiday Available"
                  />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <FormControlLabel
                    control={
                      <Switch 
                        checked={availability.overtimeWillingness}
                        onChange={(e) => setAvailability({...availability, overtimeWillingness: e.target.checked})}
                      />
                    }
                    label="Overtime Willing"
                  />
                </Grid>
              </Grid>
          </Box>
        </Grid>

        {/* Documents Section */}
        <Grid item xs={12}>
          <Box sx={{ pt: 3, pb: 3, borderRadius: 2 }}>
            <Box display="flex" alignItems="center" mb={2}>
              <DescriptionIcon color="primary" sx={{ mr: 1 }} />
              <Typography variant="h6">Documents & Files</Typography>
            </Box>
            <Grid container spacing={3}>
                <Grid item xs={12} md={8}>
                  <Typography variant="subtitle1" gutterBottom>
                    Resume / CV Upload & Parsing
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Upload a resume to automatically extract and update your profile information including skills, education, work experience, and certifications.
                  </Typography>
                  <ResumeUpload
                    userId={user.uid || user.id}
                    tenantId={user.tenantId}
                    onResumeParsed={handleResumeParsed}
                  />
                </Grid>
                
                <Grid item xs={12} md={4}>
                  <Typography variant="subtitle1" gutterBottom>
                    Additional Documents
                  </Typography>
                  <Button variant="outlined" component="label" startIcon={<UploadIcon />}>
                    Upload Document
                    <input type="file" hidden multiple />
                  </Button>
                  <Typography variant="caption" color="text.secondary" display="block" mt={1}>
                    Certificates, portfolios, references, etc.
                  </Typography>
                  
                  {resumeFileName && (
                    <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
                      <Typography variant="body2" color="success.main" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <CheckCircle fontSize="small" />
                        Current Resume: {resumeFileName}
                      </Typography>
                    </Box>
                  )}
                </Grid>
              </Grid>
          </Box>
        </Grid>
      </Grid>

      <Box display="flex" justifyContent="flex-start" mt={4}>
        <Button
          variant="contained"
          color="primary"
          size="large"
          onClick={handleSave}
          startIcon={<UploadIcon />}
        >
          Save All Changes
        </Button>
      </Box>

      {/* Notification Snackbar */}
      <Snackbar
        open={notification.open}
        autoHideDuration={6000}
        onClose={handleCloseNotification}
      >
        <Alert 
          onClose={handleCloseNotification} 
          severity={notification.severity}
          sx={{ width: '100%' }}
        >
          {notification.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default SkillsTab;
