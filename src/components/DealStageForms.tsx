import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField as MuiTextField,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  Checkbox,
  Radio,
  RadioGroup,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Chip,
  Alert,
  Divider,
  Grid,
  Autocomplete,
  Switch,
  FormLabel,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemText,
  IconButton,
  CircularProgress,
  Paper,
  Snackbar,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  CheckCircle as CheckCircleIcon,
  Warning as WarningIcon,
  RadioButtonUnchecked as RadioButtonUncheckedIcon,
  Add as AddIcon,
  Remove as RemoveIcon,
  Save as SaveIcon,
  ArrowForward as ArrowForwardIcon,
  Psychology as PsychologyIcon,
  Business as BusinessIcon,
  Person as PersonIcon,
  Description as DescriptionIcon,
  RateReview as RateReviewIcon,
  Gavel as GavelIcon,
  Handshake as HandshakeIcon,
  Assignment as AssignmentIcon,
  PlayArrow as PlayArrowIcon,
  Check as CheckIcon,
  Bedtime as BedtimeIcon,
  Cancel as CancelIcon,
  CloudUpload as CloudUploadIcon,
  Undo as UndoIcon,
  Delete as DeleteIcon
} from '@mui/icons-material';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';

import { useAuth } from '../contexts/AuthContext';
import { db, storage } from '../firebase';


interface Contact {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  title?: string;
}

interface DealStageData {
  discovery?: DiscoveryData;
  qualification?: QualificationData;
  scoping?: ScopingData;
  proposalDrafted?: ProposalDraftedData;
  proposalReview?: ProposalReviewData;
  negotiation?: NegotiationData;
  verbalAgreement?: VerbalAgreementData;
  closedWon?: ClosedWonData;
  onboarding?: OnboardingData;
  liveAccount?: LiveAccountData;
  dormant?: DormantData;
}

interface DiscoveryData {
  usesAgencies?: boolean;
  currentStaffCount?: number;
  currentAgencyCount?: number;
  jobTitles?: string[];
  shifts?: string[];
  satisfactionLevel?: 'very_happy' | 'somewhat' | 'frustrated';
  struggles?: string[];
  onsiteSupervisor?: boolean;
  seasonalOrYearRound?: 'seasonal' | 'year_round';
  hasUsedBefore?: boolean;
  lastUsed?: string;
  reasonStopped?: string;
  openToUsingAgain?: boolean;
  strugglingToHire?: boolean;
  openToAgency?: boolean;
  noInterest?: boolean;
  dripMarketingTag?: string;
  additionalContacts?: Contact[];
  notes?: string;
}

interface QualificationData {
  openToNewAgency?: boolean;
  decisionMakers?: Contact[];
  mustHave?: string;
  mustAvoid?: string;
  potentialObstacles?: string[];
  staffPlacementTimeline?: {
    starting?: number;
    after30Days?: number;
    after90Days?: number;
    after180Days?: number;
  };
  expectedAveragePayRate?: number;
  expectedAverageMarkup?: number;
  vendorSetupSteps?: {
    step1?: string;
    step2?: string;
    step3?: string;
    step4?: string;
  };
  expectedCloseDate?: string;
  notes?: string;
}

interface ScopingData {
  competingAgencies?: number;
  replaceAgency?: boolean;
  rolloverStaff?: boolean;
  onsite?: boolean;
  compliance?: {
    backgroundCheck?: boolean;
    backgroundCheckDetails?: string;
    drugScreen?: boolean;
    drugScreenDetails?: string;
    eVerify?: boolean;
    ppe?: string[];
    dressCode?: string;
  };
  shiftPolicies?: {
    timeclockSystem?: string;
    overtime?: string;
    attendance?: string;
    callOff?: string;
    noCallNoShow?: string;
    discipline?: string;
    injuryReporting?: string;
  };
  invoicing?: {
    poRequired?: boolean;
    paymentTerms?: string;
    deliveryMethod?: 'email' | 'portal' | 'mail';
    frequency?: 'weekly' | 'biweekly' | 'monthly';
  };
  contactRoles?: {
    hr?: Contact;
    operations?: Contact;
    procurement?: Contact;
    billing?: Contact;
    safety?: Contact;
    invoice?: Contact;
  };
  preApproval?: boolean;
  notes?: string;
}

interface ProposalDraftedData {
  rateSheetUploaded?: boolean;
  positionRates?: Array<{
    jobTitle: string;
    markupPercent: number;
    payRate: number;
    billRate: number;
  }>;
  rollovers?: Array<{
    howMany: number;
    fromAgency: string;
    positions: string;
    markupPercent: number;
  }>;
  notes?: string;
}

interface ProposalReviewData {
  underReviewBy?: Contact[];
  expectedProposalResponseDate?: string;
  notes?: string;
}

interface NegotiationData {
  requestedChanges?: string[];
  concessions?: Array<{
    request: string;
    response: string;
  }>;
  notes?: string;
}

interface VerbalAgreementData {
  verbalFrom?: Contact;
  verbalDate?: string;
  method?: 'phone' | 'email' | 'in_person' | 'other';
  conditionsToFulfill?: string[];
  approvalsNeeded?: string[];
  insuranceSubmitted?: boolean;
  notes?: string;
}

 interface ContractData {
  fileName: string;
  fileSize: number;
  fileType: string;
  downloadURL: string;
  storagePath: string;
  uploadedAt: string;
  uploadedBy: string;
}

interface ClosedWonData {
  status?: 'won' | 'lost';
  signedContractFile?: File | null;
  signedContractUrl?: string;
  signedContract?: ContractData | null;
  dateSigned?: string;
  expirationDate?: string;
  rateSheetOnFile?: boolean;
  msaSigned?: boolean;
  notes?: string;
  // Lost deal fields
  lostReason?: string;
  competitor?: string;
  lostTo?: string;
  priceDifference?: number;
  decisionMaker?: string;
  feedback?: string;
  lessonsLearned?: string;
}

interface OnboardingData {
  onboardingStartDate?: string;
  onboardingContacts?: Contact[];
  recruitingIntroduced?: boolean;
  checklistGenerated?: boolean;
  convertedToJobOrder?: boolean;
  insuranceSubmitted?: boolean;
  notes?: string;
}

interface LiveAccountData {
  // Future tracking fields - placeholder for future implementation
  _placeholder?: boolean;
  notes?: string;
}

interface DormantData {
  lastOrderDate?: string;
  daysSinceLastOrder?: number;
  dormantReason?: 'no_orders' | 'cold_pipeline' | 'win_back_campaign' | 'other';
  winBackAttempts?: number;
  lastContactDate?: string;
  contactMethod?: 'phone' | 'email' | 'in_person' | 'other';
  notes?: string;
  reengagementPlan?: string;
  assignedTo?: string; // salesperson ID
}

// Wrap MUI TextField to commit changes on blur and maintain local input while typing
const TextField = (props: any) => {
  const { value, onChange, onBlur, ...rest } = props;
  const [local, setLocal] = React.useState(value);
  React.useEffect(() => { setLocal(value); }, [value]);
  return (
    <MuiTextField
      {...rest}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={(e) => {
        if (onChange) onChange(e);
        if (onBlur) onBlur(e);
      }}
    />
  );
};



interface DealStageFormsProps {
  dealId: string;
  tenantId: string;
  currentStage: string;
  stageData: DealStageData;
  onStageDataChange: (stageData: DealStageData) => void;
  onStageAdvance: (newStage: string) => void;
  onStageIncomplete?: (stageKey: string) => void;
  associatedContacts?: Contact[];
}

const STAGES = [
  { key: 'discovery', label: 'Discovery', icon: <PsychologyIcon /> },
  { key: 'qualification', label: 'Qualification', icon: <BusinessIcon /> },
  { key: 'scoping', label: 'Scoping', icon: <PersonIcon /> },
  { key: 'proposalDrafted', label: 'Proposal Drafted', icon: <DescriptionIcon /> },
  { key: 'proposalReview', label: 'Proposal Review', icon: <RateReviewIcon /> },
  { key: 'negotiation', label: 'Negotiation', icon: <GavelIcon /> },
  { key: 'verbalAgreement', label: 'Verbal Agreement', icon: <HandshakeIcon /> },
  { key: 'closedWon', label: 'Closing', icon: <CheckIcon /> },
  { key: 'onboarding', label: 'Onboarding', icon: <AssignmentIcon /> },
  { key: 'liveAccount', label: 'Live Account', icon: <PlayArrowIcon /> },
  { key: 'dormant', label: 'Dormant', icon: <BedtimeIcon /> }
];

const DealStageForms: React.FC<DealStageFormsProps> = ({
  dealId,
  tenantId,
  currentStage,
  stageData,
  onStageDataChange,
  onStageAdvance,
  onStageIncomplete,
  associatedContacts = []
}) => {
  const { user } = useAuth();
  const [activeStep, setActiveStep] = useState(STAGES.findIndex(s => s.key === currentStage));
  const [expandedStep, setExpandedStep] = useState<number | false>(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastSeverity, setToastSeverity] = useState<'success' | 'error' | 'warning' | 'info'>('success');
  const [hasInitialized, setHasInitialized] = useState(false);
  const [uploadingContract, setUploadingContract] = useState(false);

  useEffect(() => {
    // Find the current stage index, default to 0 (Discovery) if not found
    const stageIndex = STAGES.findIndex(s => s.key === currentStage);
    const newActiveStep = stageIndex >= 0 ? stageIndex : 0;
    setActiveStep(newActiveStep);
    
    // Only auto-expand on initial load, not on every data change
    if (!hasInitialized) {
      setExpandedStep(newActiveStep);
      setHasInitialized(true);
    }
    
    // If currentStage is not found or is invalid, set it to 'discovery'
    if (stageIndex === -1 && currentStage !== 'discovery') {
      console.warn(`Invalid currentStage: ${currentStage}. Defaulting to 'discovery'`);
      onStageAdvance('discovery');
    }
    
    // Check for local backup data
    try {
      const localData = localStorage.getItem(`deal_stage_data_${dealId}`);
      if (localData) {
        const parsed = JSON.parse(localData);
        const backupAge = new Date().getTime() - new Date(parsed.timestamp).getTime();
        const oneDay = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
        
        // Only show backup notification if backup is less than 24 hours old
        if (backupAge < oneDay) {
          setToastMessage('Local backup data found. Click "Save Progress" to restore your changes.');
          setToastSeverity('info');
          setShowToast(true);
        }
      }
    } catch (error) {
      console.error('Error loading local backup:', error);
    }
  }, [currentStage, dealId, onStageAdvance, hasInitialized]);

  const getStageStatus = (stageKey: string, index: number) => {
    const stageIndex = STAGES.findIndex(s => s.key === stageKey);
    const currentIndex = STAGES.findIndex(s => s.key === currentStage);
    
    // If currentStage is not found, default to first stage (discovery)
    const effectiveCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
    
    if (stageIndex < effectiveCurrentIndex) return 'completed';
    if (stageIndex === effectiveCurrentIndex) return 'active';
    return 'pending';
  };

  const getStageIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircleIcon color="success" />;
      case 'active':
        return <WarningIcon color="warning" />;
      default:
        return <RadioButtonUncheckedIcon color="disabled" />;
    }
  };

  const getStageColor = (stageKey: string) => {
    switch (stageKey) {
      case 'discovery':
        return '#87CEEB'; // light blue
      case 'qualification':
        return '#4682B4'; // medium blue
      case 'scoping':
        return '#1E90FF'; // darker blue
      case 'proposalDrafted':
        return '#FFD700'; // yellow
      case 'proposalReview':
        return '#FFA500'; // orange
      case 'negotiation':
        return '#FF6347'; // reddish-orange
      case 'verbalAgreement':
        return '#90EE90'; // light green
      case 'closedWon':
        return '#228B22'; // dark green
      case 'closedLost':
        return '#DC143C'; // red
      case 'onboarding':
        return '#9370DB'; // purple
      case 'liveAccount':
        return '#4B0082'; // dark purple/indigo
      case 'dormant':
        return '#000000'; // black
      default:
        return '#666666'; // default gray
    }
  };

  const validateStage = (stageKey: string, data: any): boolean => {
    const newErrors: { [key: string]: string } = {};
    
    // If data is undefined or null, consider it valid (no validation errors)
    if (!data) {
      setErrors(newErrors);
      return true;
    }
    
    switch (stageKey) {
      case 'discovery':
        // Discovery stage is optional - no required fields for now
        break;
      case 'qualification':
        // Qualification stage is optional - no required fields for now
        break;
      case 'scoping':
        // Scoping stage is optional - no required fields for now
        break;
      case 'proposalDrafted':
        // Proposal Drafted stage is optional - no required fields for now
        break;
      case 'proposalReview':
        // Proposal Review stage is optional - no required fields for now
        break;
      case 'negotiation':
        // Negotiation stage is optional - no required fields for now
        break;
      case 'verbalAgreement':
        // Verbal Agreement stage is optional - no required fields for now
        break;
      case 'closedWon':
        // Closed Won stage is optional - no required fields for now
        break;
      case 'closedLost':
        // Closed Lost stage is optional - no required fields for now
        break;
      case 'onboarding':
        // Onboarding stage is optional - no required fields for now
        break;
      case 'liveAccount':
        // Live Account stage is optional - no required fields for now
        break;
      case 'dormant':
        // Dormant stage is optional - no required fields for now
        break;
      default:
        // Unknown stage - no validation
        break;
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleStageDataChange = (stageKey: string, field: string, value: any) => {
    const stageDataForKey = stageData[stageKey as keyof DealStageData] as Record<string, any> | undefined;
    const oldValue = stageDataForKey ? stageDataForKey[field] : undefined;
    
    const updatedData = {
      ...stageData,
      [stageKey]: {
        ...(stageDataForKey || {}),
        [field]: value
      }
    };
    onStageDataChange(updatedData);
    // Auto-save on change/blur
    (async () => {
      try {
        await updateDoc(doc(db, 'tenants', tenantId, 'crm_deals', dealId), {
          stageData: updatedData,
          updatedAt: serverTimestamp()
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('Auto-save failed', e);
      }
    })();

    // TODO: Re-enable AI logging once Cloud Function is properly configured
    // Log field change for AI analysis (fire-and-forget)
    (async () => {
      try {
        const functions = getFunctions();
        const logAIAction = httpsCallable(functions, 'logAIActionCallable');
        await logAIAction({
          userId: user?.uid,
          actionType: 'deal_field_changed',
          sourceModule: 'DealStageForms',
          success: true,
          eventType: `deal.${stageKey}.${field}_changed`,
          targetType: 'deal',
          targetId: dealId,
          tenantId: tenantId,
          aiRelevant: true,
          contextType: 'crm',
          traitsAffected: null,
          aiTags: ['deal', 'field_change', stageKey, field],
          urgencyScore: 5,
          reason: `Field ${field} in ${stageKey} stage changed from ${JSON.stringify(oldValue)} to ${JSON.stringify(value)}`,
          versionTag: 'v1',
          latencyMs: 0,
          inputPrompt: JSON.stringify({ stageKey, field, oldValue, newValue: value }),
          composedPrompt: `Deal field change: ${stageKey}.${field} updated`,
          aiResponse: 'Field change logged for AI analysis'
        });
      } catch (error) {
        console.error('Error logging field change:', error);
      }
    })();
  };

  const handleSave = async () => {
    setSaving(true);
    
    // Check for local backup data first
    try {
      const localData = localStorage.getItem(`deal_stage_data_${dealId}`);
      if (localData) {
        const parsed = JSON.parse(localData);
        // Merge local backup with current data
        const mergedStageData = { ...stageData, ...parsed.stageData };
        onStageDataChange(mergedStageData);
      }
    } catch (error) {
      console.error('Error loading local backup:', error);
    }
    
    try {
      // Save to Firestore
      const dealRef = doc(db, 'tenants', tenantId, 'crm_deals', dealId);
      await updateDoc(dealRef, {
        stageData: stageData,
        lastUpdated: serverTimestamp(),
        updatedBy: user?.uid || 'unknown'
      });
      
      // Log stage data save for AI analysis
      try {
        const functions = getFunctions();
        const logAIAction = httpsCallable(functions, 'logAIActionCallable');
        await logAIAction({
          userId: user?.uid,
          actionType: 'deal_stage_saved',
          sourceModule: 'DealStageForms',
          success: true,
          eventType: 'deal.stage_data_saved',
          targetType: 'deal',
          targetId: dealId,
          tenantId: tenantId,
          aiRelevant: true,
          contextType: 'crm',
          traitsAffected: null,
          aiTags: ['deal', 'stage_save', currentStage],
          urgencyScore: 6,
          reason: `Stage data saved for ${currentStage} stage`,
          versionTag: 'v1',
          latencyMs: 0,
          inputPrompt: JSON.stringify({ currentStage, stageData }),
          composedPrompt: `Deal stage data saved: ${currentStage}`,
          aiResponse: 'Stage data saved and logged for AI analysis'
        });
      } catch (error) {
        console.error('Error logging stage save:', error);
      }
      
      // Clear any local backup
      localStorage.removeItem(`deal_stage_data_${dealId}`);
      
      // Show success toast
      setToastMessage('Progress Saved');
      setToastSeverity('success');
      setShowToast(true);
      setSaving(false);
    } catch (error: any) {
      console.error('Error saving stage data:', error);
      
      // Save to local storage as backup
      try {
        localStorage.setItem(`deal_stage_data_${dealId}`, JSON.stringify({
          stageData,
          timestamp: new Date().toISOString(),
          userId: user?.uid || 'unknown'
        }));
      } catch (localError) {
        console.error('Failed to save to local storage:', localError);
      }
      
      // Check if it's a permissions error
      if (error.code === 'permission-denied' || error.message?.includes('permission')) {
        setToastMessage('Permission denied. Your changes are saved locally. Contact your administrator for access.');
        setToastSeverity('error');
      } else if (error.code === 'unavailable' || error.message?.includes('network')) {
        setToastMessage('Network error. Your changes are saved locally. Please try again when connected.');
        setToastSeverity('warning');
      } else {
        setToastMessage('Error saving to server. Your changes are saved locally.');
        setToastSeverity('error');
      }
      
      setShowToast(true);
      setSaving(false);
    }
  };

  const handleAdvanceStage = () => {
    // Check if activeStep is valid
    if (activeStep < 0 || activeStep >= STAGES.length) {
      console.error('Invalid activeStep:', activeStep);
      setToastMessage('Error: Invalid stage. Please refresh the page.');
      setToastSeverity('error');
      setShowToast(true);
      return;
    }

    const currentStage = STAGES[activeStep];
    if (!currentStage) {
      console.error('Current stage not found at index:', activeStep);
      setToastMessage('Error: Current stage not found. Please refresh the page.');
      setToastSeverity('error');
      setShowToast(true);
      return;
    }

    const currentStageKey = currentStage.key;
    if (validateStage(currentStageKey, stageData[currentStageKey as keyof DealStageData])) {
      const nextStage = STAGES[activeStep + 1]?.key;
      if (nextStage) {
        // Log stage advancement for AI analysis (fire-and-forget)
        (async () => {
          try {
            const functions = getFunctions();
            const logAIAction = httpsCallable(functions, 'logAIActionCallable');
            await logAIAction({
              userId: user?.uid,
              actionType: 'deal_stage_advanced',
              sourceModule: 'DealStageForms',
              success: true,
              eventType: 'deal.stage_advanced',
              targetType: 'deal',
              targetId: dealId,
              tenantId: tenantId,
              aiRelevant: true,
              contextType: 'crm',
              traitsAffected: null,
              aiTags: ['deal', 'stage_advance', currentStageKey, nextStage],
              urgencyScore: 7,
              reason: `Deal advanced from ${currentStageKey} to ${nextStage}`,
              versionTag: 'v1',
              latencyMs: 0,
              inputPrompt: JSON.stringify({ fromStage: currentStageKey, toStage: nextStage }),
              composedPrompt: `Deal stage advancement: ${currentStageKey} → ${nextStage}`,
              aiResponse: 'Stage advancement logged for AI analysis'
            });
          } catch (error) {
            console.error('Error logging stage advancement:', error);
          }
        })();
        
        onStageAdvance(nextStage);
      } else {
        setToastMessage('Already at the final stage.');
        setToastSeverity('info');
        setShowToast(true);
      }
    }
  };

  const handleMarkStageComplete = (stageKey: string) => {
    // Mark the current stage as complete by advancing to the next stage
    const currentIndex = STAGES.findIndex(s => s.key === stageKey);
    if (currentIndex === -1) {
      console.error('Stage not found:', stageKey);
      setToastMessage('Error: Stage not found.');
      setToastSeverity('error');
      setShowToast(true);
      return;
    }
    
    if (currentIndex < STAGES.length - 1) {
      const nextStage = STAGES[currentIndex + 1];
      if (nextStage) {
        onStageAdvance(nextStage.key);
        
        // Show success message
        setToastMessage(`${STAGES[currentIndex].label} marked as complete`);
        setToastSeverity('success');
        setShowToast(true);
      }
    } else {
      setToastMessage('Already at the final stage.');
      setToastSeverity('info');
      setShowToast(true);
    }
  };

  const renderDiscoveryForm = () => {
    const data = stageData.discovery || {};
    
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>Discovery Questions</Typography>
        
        <FormControl component="fieldset" sx={{ mb: 3 }}>
          <FormLabel component="legend">Do they currently use staffing agencies?</FormLabel>
          <RadioGroup
            value={data.usesAgencies ?? ''}
            onChange={(e) => handleStageDataChange('discovery', 'usesAgencies', e.target.value === 'true')}
          >
            <FormControlLabel value="true" control={<Radio />} label="Yes" />
            <FormControlLabel value="false" control={<Radio />} label="No" />
          </RadioGroup>
        </FormControl>

        {data.usesAgencies === true && (
          <Box sx={{ ml: 2, mb: 3 }}>
            <Grid container spacing={2}>
              <Grid item xs={6}>
                <TextField
                  label="Current Staff Count"
                  type="number"
                  value={data.currentStaffCount || ''}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleStageDataChange('discovery', 'currentStaffCount', parseInt(e.target.value))}
                  fullWidth
                  size="small"
                />
              </Grid>
              <Grid item xs={6}>
                <TextField
                  label="Current Agency Count"
                  type="number"
                  value={data.currentAgencyCount || ''}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleStageDataChange('discovery', 'currentAgencyCount', parseInt(e.target.value))}
                  fullWidth
                  size="small"
                />
              </Grid>
            </Grid>

            <FormControl fullWidth sx={{ mt: 3 }}>
              <InputLabel>Satisfaction Level With Current Staffing Agencies</InputLabel>
              <Select
                value={data.satisfactionLevel || ''}
                label="Satisfaction Level"
                onChange={(e) => handleStageDataChange('discovery', 'satisfactionLevel', e.target.value)}
              >
                <MenuItem value="very_happy">Very Happy</MenuItem>
                <MenuItem value="somewhat">Somewhat Satisfied</MenuItem>
                <MenuItem value="frustrated">Frustrated</MenuItem>
              </Select>
            </FormControl>

             {/* Current Struggles - Chip Input */}
             <Box sx={{ mt: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Current Struggles
              </Typography>
              <TextField
                placeholder="Describe challenges (3-5 bullets or sentences)"
                size="small"
                multiline
                rows={3}
                fullWidth
                value={(data as any).struggles || ''}
                onChange={(e) => handleStageDataChange('discovery', 'struggles', e.target.value)}
                helperText="Free text. Example: turnover, absenteeism, skills gap, scheduling, quality"
              />
            </Box>
            
            {/* Job Titles Needed - Chip Input */}
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Job Titles Needed
              </Typography>
              <Autocomplete
                multiple
                freeSolo
                options={[]}
                value={data.jobTitles || []}
                onChange={(_, newValue) => {
                  handleStageDataChange('discovery', 'jobTitles', newValue);
                }}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => {
                    const { key, ...chipProps } = getTagProps({ index });
                    return (
                      <Chip
                        key={String(key)}
                        variant="outlined"
                        label={option}
                        {...chipProps}
                        size="small"
                      />
                    );
                  })
                }
                renderInput={(params) => (
                  <TextField
                    {...(params as any)}
                    placeholder="Type job titles and press Enter or comma"
                    size="small"
                    helperText="Separate multiple titles with commas or press Enter"
                  />
                )}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ',') {
                    event.preventDefault();
                    const input = event.target as HTMLInputElement;
                    const value = input.value.trim();
                    if (value) {
                      const currentTitles = data.jobTitles || [];
                      if (!currentTitles.includes(value)) {
                        handleStageDataChange('discovery', 'jobTitles', [...currentTitles, value]);
                      }
                      input.value = '';
                    }
                  }
                }}
              />
            </Box>
            
            

            {/* Shifts Needed - Chip Input */}
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Shifts Needed
              </Typography>
              <Autocomplete
                multiple
                freeSolo
                options={['1st Shift', '2nd Shift', '3rd Shift', 'Night Shift', 'Weekend Shift', 'Flexible']}
                value={data.shifts || []}
                onChange={(_, newValue) => {
                  handleStageDataChange('discovery', 'shifts', newValue);
                }}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => {
                    const { key, ...chipProps } = getTagProps({ index });
                    return (
                      <Chip
                        key={String(key)}
                        variant="outlined"
                        label={option}
                        {...chipProps}
                        size="small"
                      />
                    );
                  })
                }
                renderInput={(params) => (
                  <TextField
                    {...(params as any)}
                    placeholder="Type shifts and press Enter or comma"
                    size="small"
                    helperText="Separate multiple shifts with commas or press Enter (e.g., 1st Shift, 2nd Shift, Night Shift)"
                  />
                )}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ',') {
                    event.preventDefault();
                    const input = event.target as HTMLInputElement;
                    const value = input.value.trim();
                    if (value) {
                      const currentShifts = data.shifts || [];
                      if (!currentShifts.includes(value)) {
                        handleStageDataChange('discovery', 'shifts', [...currentShifts, value]);
                      }
                      input.value = '';
                    }
                  }
                }}
              />
            </Box>

           

            <FormControlLabel
              control={
                <Switch
                  checked={data.onsiteSupervisor || false}
                  onChange={(e) => handleStageDataChange('discovery', 'onsiteSupervisor', e.target.checked)}
                />
              }
              label="Onsite supervisor required"
              sx={{ mt: 2, mb: 2 }}
            />

            <FormControl fullWidth sx={{ mt: 2 }}>
              <InputLabel>Seasonal or Year Round</InputLabel>
              <Select
                value={data.seasonalOrYearRound || ''}
                label="Seasonal or Year Round"
                onChange={(e) => handleStageDataChange('discovery', 'seasonalOrYearRound', e.target.value)}
              >
                <MenuItem value="seasonal">Seasonal</MenuItem>
                <MenuItem value="year_round">Year Round</MenuItem>
              </Select>
            </FormControl>
          </Box>
        )}

        <Divider sx={{ my: 3 }} />

        {data.usesAgencies === false && (
          <>
            <FormControl component="fieldset" sx={{ mb: 3 }}>
              <FormLabel component="legend">Have they used staffing agencies before?</FormLabel>
              <RadioGroup
                value={data.hasUsedBefore ?? ''}
                onChange={(e) => handleStageDataChange('discovery', 'hasUsedBefore', e.target.value === 'true')}
              >
                <FormControlLabel value="true" control={<Radio />} label="Yes" />
                <FormControlLabel value="false" control={<Radio />} label="No" />
              </RadioGroup>
            </FormControl>

            {data.hasUsedBefore === true && (
              <Box sx={{ ml: 2, mb: 3 }}>
                <TextField
                  label="When did they last use an agency?"
                  value={data.lastUsed || ''}
                  onChange={(e) => handleStageDataChange('discovery', 'lastUsed', e.target.value)}
                  fullWidth
                  size="small"
                  sx={{ mb: 2 }}
                  helperText="Approximate timeframe"
                />
                
                <TextField
                  label="Why did they stop?"
                  value={data.reasonStopped || ''}
                  onChange={(e) => handleStageDataChange('discovery', 'reasonStopped', e.target.value)}
                  fullWidth
                  multiline
                  rows={2}
                  size="small"
                  sx={{ mb: 2 }}
                  helperText="What led to them stopping use of staffing agencies?"
                />

                {/* <FormControlLabel
                  control={
                    <Switch
                      checked={data.openToUsingAgain || false}
                      onChange={(e) => handleStageDataChange('discovery', 'openToUsingAgain', e.target.checked)}
                    />
                  }
                  label="Open to using an agency again"
                  sx={{ mb: 2 }}
                /> */}
              </Box>
            )}
          </>
        )}

        {/* {data.hasUsedBefore === false && (
          <Box sx={{ ml: 2 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={data.strugglingToHire || false}
                  onChange={(e) => handleStageDataChange('discovery', 'strugglingToHire', e.target.checked)}
                />
              }
              label="Struggling to hire"
              sx={{ mb: 2 }}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={data.openToAgency || false}
                  onChange={(e) => handleStageDataChange('discovery', 'openToAgency', e.target.checked)}
                />
              }
              label="Open to using an agency"
            />
          </Box>
        )} */}

        {/* <Divider sx={{ my: 3 }} />

        <FormControlLabel
          control={
            <Switch
              checked={data.noInterest || false}
              onChange={(e) => handleStageDataChange('discovery', 'noInterest', e.target.checked)}
            />
          }
          label="No current interest in staffing services"
          sx={{ mb: 2 }}
        /> */}

        {data.noInterest && (
          <Box sx={{ ml: 2, mb: 3 }}>
            <TextField
              label="Drip Marketing Tag"
              value={data.dripMarketingTag || ''}
              onChange={(e) => handleStageDataChange('discovery', 'dripMarketingTag', e.target.value)}
              fullWidth
              size="small"
              sx={{ mb: 2 }}
              helperText="Tag for future marketing campaigns"
            />
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Additional contacts for future follow-up:
            </Typography>
            <TextField
              label="Additional Contacts"
              value={data.additionalContacts?.map(c => c.fullName).join(', ') || ''}
              onChange={(e) => {
                // This would need to be enhanced with contact selection
                console.log('Contact selection would be implemented here');
              }}
              fullWidth
              multiline
              rows={2}
              size="small"
              helperText="Add contacts for future marketing (contact picker coming soon)"
            />
          </Box>
        )}

        <Divider sx={{ my: 3 }} />

        <Typography variant="h6" gutterBottom>Additional Notes</Typography>
        <TextField
          label="Discovery Notes"
          value={data.notes || ''}
          onBlur={(e) => handleStageDataChange('discovery', 'notes', e.target.value)}
          fullWidth
          multiline
          rows={3}
          size="small"
          helperText="Add any additional comments or observations about this discovery phase"
        />
      </Box>
    );
  };

  const renderQualificationForm = () => {
    const data = stageData.qualification || {};
    
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>Qualification Questions</Typography>
        
        <FormControl component="fieldset" sx={{ mb: 3 }}>
          <FormLabel component="legend">Are they open to a new agency?</FormLabel>
          <RadioGroup
            value={data.openToNewAgency ?? ''}
            onChange={(e) => handleStageDataChange('qualification', 'openToNewAgency', e.target.value === 'true')}
          >
            <FormControlLabel value="true" control={<Radio />} label="Yes" />
            <FormControlLabel value="false" control={<Radio />} label="No" />
          </RadioGroup>
        </FormControl>

        <Typography variant="subtitle2" sx={{ mb: 2 }}>
          Decision Makers (choose from Associated Deal Contacts)
        </Typography>
        
        {associatedContacts.length > 0 ? (
          <FormGroup sx={{ mb: 2 }}>
            {associatedContacts.map((contact) => (
              <FormControlLabel
                key={contact.id}
                control={
                  <Checkbox
                    checked={data.decisionMakers?.some(dm => dm.id === contact.id) || false}
                    onChange={(e) => {
                      const currentDecisionMakers = data.decisionMakers || [];
                      if (e.target.checked) {
                        // Add contact to decision makers
                        handleStageDataChange('qualification', 'decisionMakers', [
                          ...currentDecisionMakers,
                          contact
                        ]);
                      } else {
                        // Remove contact from decision makers
                        handleStageDataChange('qualification', 'decisionMakers', 
                          currentDecisionMakers.filter(dm => dm.id !== contact.id)
                        );
                      }
                    }}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2">{contact.fullName}</Typography>
                    {contact.title && (
                      <Typography variant="caption" color="text.secondary">
                        {contact.title}
                      </Typography>
                    )}
                  </Box>
                }
              />
            ))}
          </FormGroup>
        ) : (
          <Alert severity="info" sx={{ mb: 2 }}>
            No contacts associated with this deal yet. Add contacts in the Associations panel first.
          </Alert>
        )}
        
        {data.decisionMakers && data.decisionMakers.length > 0 && (
          <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Selected Decision Makers:
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {data.decisionMakers.map((contact) => (
                <Chip
                  key={contact.id}
                  label={contact.fullName}
                  size="small"
                  onDelete={() => {
                    const currentDecisionMakers = data.decisionMakers || [];
                    handleStageDataChange('qualification', 'decisionMakers', 
                      currentDecisionMakers.filter(dm => dm.id !== contact.id)
                    );
                  }}
                />
              ))}
            </Box>
          </Box>
        )}

        <TextField
          label="Must Have Requirements"
          value={data.mustHave || ''}
          onBlur={(e) => handleStageDataChange('qualification', 'mustHave', e.target.value)}
          fullWidth
          multiline
          rows={3}
          size="small"
          sx={{ mb: 2 }}
        />

        <TextField
          label="Must Avoid"
          value={data.mustAvoid || ''}
          onBlur={(e) => handleStageDataChange('qualification', 'mustAvoid', e.target.value)}
          fullWidth
          multiline
          rows={2}
          size="small"
          sx={{ mb: 2 }}
        />

        <TextField
          label="Potential Obstacles"
          value={data.potentialObstacles?.join(', ') || ''}
          onChange={(e) => {
            const value = e.target.value;
            if (value.endsWith(',') || value === '') {
              const obstacles = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
              handleStageDataChange('qualification', 'potentialObstacles', obstacles);
            } else {
              handleStageDataChange('qualification', 'potentialObstacles', [value]);
            }
          }}
          onBlur={(e) => {
            const value = e.target.value;
            const obstacles = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
            handleStageDataChange('qualification', 'potentialObstacles', obstacles);
          }}
          fullWidth
          multiline
          rows={2}
          size="small"
          sx={{ mb: 2 }}
          helperText="What could prevent this deal from closing? Separate with commas"
        />

        <Typography variant="h6" gutterBottom sx={{ mt: 3 }}>Staff Placement Timeline</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          How many staff should we expect to place?
        </Typography>
        
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={6} md={3}>
            <TextField
              label="Starting"
              type="number"
              value={data.staffPlacementTimeline?.starting || ''}
              onChange={(e) => handleStageDataChange('qualification', 'staffPlacementTimeline', {
                ...data.staffPlacementTimeline,
                starting: parseInt(e.target.value) || 0
              })}
              fullWidth
              size="small"
              placeholder="Starting"
            />
          </Grid>
          <Grid item xs={6} md={3}>
            <TextField
              label="After 30 Days"
              type="number"
              value={data.staffPlacementTimeline?.after30Days || ''}
              onChange={(e) => handleStageDataChange('qualification', 'staffPlacementTimeline', {
                ...data.staffPlacementTimeline,
                after30Days: parseInt(e.target.value) || 0
              })}
              fullWidth
              size="small"
              placeholder="After 30 Days"
            />
          </Grid>
          <Grid item xs={6} md={3}>
            <TextField
              label="After 90 Days"
              type="number"
              value={data.staffPlacementTimeline?.after90Days || ''}
              onChange={(e) => handleStageDataChange('qualification', 'staffPlacementTimeline', {
                ...data.staffPlacementTimeline,
                after90Days: parseInt(e.target.value) || 0
              })}
              fullWidth
              size="small"
              placeholder="After 90 Days"
            />
          </Grid>
          <Grid item xs={6} md={3}>
            <TextField
              label="After 180 Days"
              type="number"
              value={data.staffPlacementTimeline?.after180Days || ''}
              onChange={(e) => handleStageDataChange('qualification', 'staffPlacementTimeline', {
                ...data.staffPlacementTimeline,
                after180Days: parseInt(e.target.value) || 0
              })}
              fullWidth
              size="small"
              placeholder="After 180 Days"
            />
          </Grid>
        </Grid>

        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12} md={6}>
            <TextField
              label="Expected Average Pay Rate"
              type="number"
              value={data.expectedAveragePayRate || ''}
              onChange={(e) => handleStageDataChange('qualification', 'expectedAveragePayRate', parseFloat(e.target.value) || 0)}
              fullWidth
              size="small"
              InputProps={{
                startAdornment: <Typography sx={{ mr: 1 }}>$</Typography>
              }}
              helperText="Expected average hourly pay rate"
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              label="Expected Average Markup"
              type="number"
              value={data.expectedAverageMarkup || ''}
              onChange={(e) => handleStageDataChange('qualification', 'expectedAverageMarkup', parseFloat(e.target.value) || 0)}
              fullWidth
              size="small"
              InputProps={{
                endAdornment: <Typography sx={{ ml: 1 }}>%</Typography>
              }}
              helperText="Expected average markup percentage"
            />
          </Grid>
        </Grid>

        <Divider sx={{ my: 3 }} />

        <Typography variant="h6" gutterBottom>Vendor Setup Steps</Typography>
        
        <TextField
          label="Step 1"
          value={data.vendorSetupSteps?.step1 || ''}
          onChange={(e) => handleStageDataChange('qualification', 'vendorSetupSteps', {
            ...data.vendorSetupSteps,
            step1: e.target.value
          })}
          fullWidth
          size="small"
          sx={{ mb: 2 }}
        />

        <TextField
          label="Step 2"
          value={data.vendorSetupSteps?.step2 || ''}
          onChange={(e) => handleStageDataChange('qualification', 'vendorSetupSteps', {
            ...data.vendorSetupSteps,
            step2: e.target.value
          })}
          fullWidth
          size="small"
          sx={{ mb: 2 }}
        />

        <TextField
          label="Step 3"
          value={data.vendorSetupSteps?.step3 || ''}
          onChange={(e) => handleStageDataChange('qualification', 'vendorSetupSteps', {
            ...data.vendorSetupSteps,
            step3: e.target.value
          })}
          fullWidth
          size="small"
          sx={{ mb: 2 }}
        />

        <TextField
          label="Step 4"
          value={data.vendorSetupSteps?.step4 || ''}
          onChange={(e) => handleStageDataChange('qualification', 'vendorSetupSteps', {
            ...data.vendorSetupSteps,
            step4: e.target.value
          })}
          fullWidth
          size="small"
          sx={{ mb: 2 }}
        />

        <TextField
          label="Expected Close Date"
          type="date"
          value={data.expectedCloseDate || ''}
          onChange={(e) => handleStageDataChange('qualification', 'expectedCloseDate', e.target.value)}
          fullWidth
          size="small"
          sx={{ mb: 2 }}
          helperText="When do you expect this deal to close?"
        />

        <Divider sx={{ my: 3 }} />

        <Typography variant="h6" gutterBottom>Additional Notes</Typography>
        <TextField
          label="Qualification Notes"
          value={data.notes || ''}
          onBlur={(e) => handleStageDataChange('qualification', 'notes', e.target.value)}
          fullWidth
          multiline
          rows={3}
          size="small"
          helperText="Add any additional comments or observations about this qualification phase"
        />
      </Box>
    );
  };

  const renderDormantForm = () => {
    const data = stageData.dormant || {};
    
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>Dormant Account Management</Typography>
        
        <Alert severity="info" sx={{ mb: 3 }}>
          This account has been marked as dormant. Use this stage to track reengagement efforts and win-back campaigns.
        </Alert>

        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={6}>
            <TextField
              label="Last Order Date"
              type="date"
              value={data.lastOrderDate || ''}
              onChange={(e) => handleStageDataChange('dormant', 'lastOrderDate', e.target.value)}
              fullWidth
              size="small"
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              label="Days Since Last Order"
              type="number"
              value={data.daysSinceLastOrder || ''}
              onChange={(e) => handleStageDataChange('dormant', 'daysSinceLastOrder', parseInt(e.target.value))}
              fullWidth
              size="small"
            />
          </Grid>
        </Grid>

        <FormControl fullWidth sx={{ mb: 3 }}>
          <InputLabel>Dormant Reason</InputLabel>
          <Select
            value={data.dormantReason || ''}
            label="Dormant Reason"
            onChange={(e) => handleStageDataChange('dormant', 'dormantReason', e.target.value)}
          >
            <MenuItem value="no_orders">No orders in 60+ days</MenuItem>
            <MenuItem value="cold_pipeline">Pipeline went cold after onboarding</MenuItem>
            <MenuItem value="win_back_campaign">Win-back campaign initiated</MenuItem>
            <MenuItem value="other">Other</MenuItem>
          </Select>
        </FormControl>

        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={6}>
            <TextField
              label="Win-back Attempts"
              type="number"
              value={data.winBackAttempts || ''}
              onChange={(e) => handleStageDataChange('dormant', 'winBackAttempts', parseInt(e.target.value))}
              fullWidth
              size="small"
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              label="Last Contact Date"
              type="date"
              value={data.lastContactDate || ''}
              onChange={(e) => handleStageDataChange('dormant', 'lastContactDate', e.target.value)}
              fullWidth
              size="small"
            />
          </Grid>
        </Grid>

        <FormControl fullWidth sx={{ mb: 3 }}>
          <InputLabel>Last Contact Method</InputLabel>
          <Select
            value={data.contactMethod || ''}
            label="Last Contact Method"
            onChange={(e) => handleStageDataChange('dormant', 'contactMethod', e.target.value)}
          >
            <MenuItem value="phone">Phone</MenuItem>
            <MenuItem value="email">Email</MenuItem>
            <MenuItem value="in_person">In Person</MenuItem>
            <MenuItem value="other">Other</MenuItem>
          </Select>
        </FormControl>

        <TextField
          label="Reengagement Plan"
          value={data.reengagementPlan || ''}
          onChange={(e) => handleStageDataChange('dormant', 'reengagementPlan', e.target.value)}
          fullWidth
          multiline
          rows={4}
          size="small"
          sx={{ mb: 2 }}
          helperText="Describe the strategy for reengaging this account"
        />

        <TextField
          label="Notes"
          value={data.notes || ''}
          onBlur={(e) => handleStageDataChange('dormant', 'notes', e.target.value)}
          fullWidth
          multiline
          rows={3}
          size="small"
          sx={{ mb: 2 }}
        />
      </Box>
    );
  };



  const renderScopingForm = () => {
    const data = stageData.scoping || {};
    
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>Scoping Requirements</Typography>
        
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={6}>
            <TextField
              label="Number of Competing Agencies"
              type="number"
              value={data.competingAgencies || ''}
              onChange={(e) => handleStageDataChange('scoping', 'competingAgencies', parseInt(e.target.value))}
              fullWidth
              size="small"
            />
          </Grid>
          <Grid item xs={6}>
            <FormControlLabel
              control={
                <Switch
                  checked={data.onsite || false}
                  onChange={(e) => handleStageDataChange('scoping', 'onsite', e.target.checked)}
                />
              }
              label="Onsite work required"
            />
          </Grid>
        </Grid>

        <FormControlLabel
          control={
            <Switch
              checked={data.replaceAgency || false}
              onChange={(e) => handleStageDataChange('scoping', 'replaceAgency', e.target.checked)}
            />
          }
          label="Replacing existing agency"
          sx={{ mb: 2 }}
        />

        <FormControlLabel
          control={
            <Switch
              checked={data.rolloverStaff || false}
              onChange={(e) => handleStageDataChange('scoping', 'rolloverStaff', e.target.checked)}
            />
          }
          label="Rollover existing staff"
          sx={{ mb: 3 }}
        />

        <Divider sx={{ my: 3 }} />

        <Typography variant="h6" gutterBottom>Compliance Requirements</Typography>
        
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={4}>
            <FormControlLabel
              control={
                <Switch
                  checked={data.compliance?.backgroundCheck || false}
                  onChange={(e) => handleStageDataChange('scoping', 'compliance', {
                    ...data.compliance,
                    backgroundCheck: e.target.checked
                  })}
                />
              }
              label="Background Check"
            />
          </Grid>
          <Grid item xs={4}>
            <FormControlLabel
              control={
                <Switch
                  checked={data.compliance?.drugScreen || false}
                  onChange={(e) => handleStageDataChange('scoping', 'compliance', {
                    ...data.compliance,
                    drugScreen: e.target.checked
                  })}
                />
              }
              label="Drug Screen"
            />
          </Grid>
          <Grid item xs={4}>
            <FormControlLabel
              control={
                <Switch
                  checked={data.compliance?.eVerify || false}
                  onChange={(e) => handleStageDataChange('scoping', 'compliance', {
                    ...data.compliance,
                    eVerify: e.target.checked
                  })}
                />
              }
              label="E-Verify"
            />
          </Grid>
        </Grid>

        {/* Conditional Background Check Details */}
        {data.compliance?.backgroundCheck && (
          <TextField
            label="Background Check Details"
            value={data.compliance?.backgroundCheckDetails || ''}
            onChange={(e) => handleStageDataChange('scoping', 'compliance', {
              ...data.compliance,
              backgroundCheckDetails: e.target.value
            })}
            fullWidth
            size="small"
            multiline
            rows={2}
            sx={{ mb: 2 }}
            helperText="Specify background check requirements, type, frequency, etc."
          />
        )}

        {/* Conditional Drug Screen Details */}
        {data.compliance?.drugScreen && (
          <TextField
            label="Drug Screen Details"
            value={data.compliance?.drugScreenDetails || ''}
            onChange={(e) => handleStageDataChange('scoping', 'compliance', {
              ...data.compliance,
              drugScreenDetails: e.target.value
            })}
            fullWidth
            size="small"
            multiline
            rows={2}
            sx={{ mb: 2 }}
            helperText="Specify drug screen type, frequency, panel, etc."
          />
        )}

        <TextField
          label="Required PPE"
          value={data.compliance?.ppe?.join(', ') || ''}
          onChange={(e) => {
            const value = e.target.value;
            if (value.endsWith(',') || value === '') {
              const ppe = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
              handleStageDataChange('scoping', 'compliance', {
                ...data.compliance,
                ppe: ppe
              });
            } else {
              handleStageDataChange('scoping', 'compliance', {
                ...data.compliance,
                ppe: [value]
              });
            }
          }}
          onBlur={(e) => {
            const value = e.target.value;
            const ppe = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
            handleStageDataChange('scoping', 'compliance', {
              ...data.compliance,
              ppe: ppe
            });
          }}
          fullWidth
          size="small"
          sx={{ mb: 2 }}
          helperText="Separate multiple items with commas (e.g., Hard Hat, Safety Glasses, Steel Toe Boots)"
        />

        <TextField
          label="Dress Code"
          value={data.compliance?.dressCode || ''}
          onChange={(e) => handleStageDataChange('scoping', 'compliance', {
            ...data.compliance,
            dressCode: e.target.value
          })}
          fullWidth
          size="small"
          sx={{ mb: 3 }}
        />

        <Divider sx={{ my: 3 }} />

        <Typography variant="h6" gutterBottom>Shift Policies</Typography>
        
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={6}>
            <TextField
              label="Timeclock System"
              value={data.shiftPolicies?.timeclockSystem || ''}
              onChange={(e) => handleStageDataChange('scoping', 'shiftPolicies', {
                ...data.shiftPolicies,
                timeclockSystem: e.target.value
              })}
              fullWidth
              size="small"
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              label="Overtime Policy"
              value={data.shiftPolicies?.overtime || ''}
              onChange={(e) => handleStageDataChange('scoping', 'shiftPolicies', {
                ...data.shiftPolicies,
                overtime: e.target.value
              })}
              fullWidth
              size="small"
            />
          </Grid>
        </Grid>

        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={6}>
            <TextField
              label="Attendance Policy"
              value={data.shiftPolicies?.attendance || ''}
              onChange={(e) => handleStageDataChange('scoping', 'shiftPolicies', {
                ...data.shiftPolicies,
                attendance: e.target.value
              })}
              fullWidth
              size="small"
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              label="Call-off Policy"
              value={data.shiftPolicies?.callOff || ''}
              onChange={(e) => handleStageDataChange('scoping', 'shiftPolicies', {
                ...data.shiftPolicies,
                callOff: e.target.value
              })}
              fullWidth
              size="small"
            />
          </Grid>
        </Grid>

        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={6}>
            <TextField
              label="No Call No Show Policy"
              value={data.shiftPolicies?.noCallNoShow || ''}
              onChange={(e) => handleStageDataChange('scoping', 'shiftPolicies', {
                ...data.shiftPolicies,
                noCallNoShow: e.target.value
              })}
              fullWidth
              size="small"
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              label="Discipline Policy"
              value={data.shiftPolicies?.discipline || ''}
              onChange={(e) => handleStageDataChange('scoping', 'shiftPolicies', {
                ...data.shiftPolicies,
                discipline: e.target.value
              })}
              fullWidth
              size="small"
            />
          </Grid>
        </Grid>

        <TextField
          label="Injury Reporting Process"
          value={data.shiftPolicies?.injuryReporting || ''}
          onChange={(e) => handleStageDataChange('scoping', 'shiftPolicies', {
            ...data.shiftPolicies,
            injuryReporting: e.target.value
          })}
          fullWidth
          multiline
          rows={2}
          size="small"
          sx={{ mb: 3 }}
        />

        <Divider sx={{ my: 3 }} />

        <Typography variant="h6" gutterBottom>Invoicing Requirements</Typography>
        
        <FormControlLabel
          control={
            <Switch
              checked={data.invoicing?.poRequired || false}
              onChange={(e) => handleStageDataChange('scoping', 'invoicing', {
                ...data.invoicing,
                poRequired: e.target.checked
              })}
            />
          }
          label="Purchase Order Required"
          sx={{ mb: 2 }}
        />

        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
          <InputLabel>Payment Terms</InputLabel>
          <Select
            value={data.invoicing?.paymentTerms || ''}
            label="Payment Terms"
            onChange={(e) => handleStageDataChange('scoping', 'invoicing', {
              ...data.invoicing,
              paymentTerms: e.target.value
            })}
          >
            <MenuItem value="due_on_receipt">Due On Receipt</MenuItem>
            <MenuItem value="net_7">Net 7</MenuItem>
            <MenuItem value="net_15">Net 15</MenuItem>
            <MenuItem value="net_30">Net 30</MenuItem>
            <MenuItem value="net_45">Net 45</MenuItem>
            <MenuItem value="net_60">Net 60</MenuItem>
          </Select>
        </FormControl>

        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={6}>
            <FormControl fullWidth>
              <InputLabel>Delivery Method</InputLabel>
              <Select
                value={data.invoicing?.deliveryMethod || ''}
                label="Delivery Method"
                onChange={(e) => handleStageDataChange('scoping', 'invoicing', {
                  ...data.invoicing,
                  deliveryMethod: e.target.value
                })}
              >
                <MenuItem value="email">Email</MenuItem>
                <MenuItem value="portal">Portal</MenuItem>
                <MenuItem value="mail">Mail</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={6}>
            <FormControl fullWidth>
              <InputLabel>Invoice Frequency</InputLabel>
              <Select
                value={data.invoicing?.frequency || ''}
                label="Invoice Frequency"
                onChange={(e) => handleStageDataChange('scoping', 'invoicing', {
                  ...data.invoicing,
                  frequency: e.target.value
                })}
              >
                <MenuItem value="weekly">Weekly</MenuItem>
                <MenuItem value="biweekly">Bi-weekly</MenuItem>
                <MenuItem value="monthly">Monthly</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>

        <Divider sx={{ my: 3 }} />

        <Typography variant="h6" gutterBottom>Contact Roles</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Assign contacts to key roles
        </Typography>
        
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={6}>
            <FormControl fullWidth size="small">
              <InputLabel>HR Contact</InputLabel>
              <Select
                value={data.contactRoles?.hr?.id || ''}
                onChange={(e) => {
                  const selectedContact = associatedContacts.find(c => c.id === e.target.value);
                  handleStageDataChange('scoping', 'contactRoles', {
                    ...data.contactRoles,
                    hr: selectedContact || null
                  });
                }}
                label="HR Contact"
              >
                <MenuItem value="">
                  <em>Select HR Contact</em>
                </MenuItem>
                {associatedContacts.map((contact) => (
                  <MenuItem key={contact.id} value={contact.id}>
                    {contact.fullName} {contact.title && `(${contact.title})`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Operations Contact</InputLabel>
              <Select
                value={data.contactRoles?.operations?.id || ''}
                onChange={(e) => {
                  const selectedContact = associatedContacts.find(c => c.id === e.target.value);
                  handleStageDataChange('scoping', 'contactRoles', {
                    ...data.contactRoles,
                    operations: selectedContact || null
                  });
                }}
                label="Operations Contact"
              >
                <MenuItem value="">
                  <em>Select Operations Contact</em>
                </MenuItem>
                {associatedContacts.map((contact) => (
                  <MenuItem key={contact.id} value={contact.id}>
                    {contact.fullName} {contact.title && `(${contact.title})`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
        </Grid>

        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Procurement Contact</InputLabel>
              <Select
                value={data.contactRoles?.procurement?.id || ''}
                onChange={(e) => {
                  const selectedContact = associatedContacts.find(c => c.id === e.target.value);
                  handleStageDataChange('scoping', 'contactRoles', {
                    ...data.contactRoles,
                    procurement: selectedContact || null
                  });
                }}
                label="Procurement Contact"
              >
                <MenuItem value="">
                  <em>Select Procurement Contact</em>
                </MenuItem>
                {associatedContacts.map((contact) => (
                  <MenuItem key={contact.id} value={contact.id}>
                    {contact.fullName} {contact.title && `(${contact.title})`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Billing Contact</InputLabel>
              <Select
                value={data.contactRoles?.billing?.id || ''}
                onChange={(e) => {
                  const selectedContact = associatedContacts.find(c => c.id === e.target.value);
                  handleStageDataChange('scoping', 'contactRoles', {
                    ...data.contactRoles,
                    billing: selectedContact || null
                  });
                }}
                label="Billing Contact"
              >
                <MenuItem value="">
                  <em>Select Billing Contact</em>
                </MenuItem>
                {associatedContacts.map((contact) => (
                  <MenuItem key={contact.id} value={contact.id}>
                    {contact.fullName} {contact.title && `(${contact.title})`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
        </Grid>

        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Safety Contact</InputLabel>
              <Select
                value={data.contactRoles?.safety?.id || ''}
                onChange={(e) => {
                  const selectedContact = associatedContacts.find(c => c.id === e.target.value);
                  handleStageDataChange('scoping', 'contactRoles', {
                    ...data.contactRoles,
                    safety: selectedContact || null
                  });
                }}
                label="Safety Contact"
              >
                <MenuItem value="">
                  <em>Select Safety Contact</em>
                </MenuItem>
                {associatedContacts.map((contact) => (
                  <MenuItem key={contact.id} value={contact.id}>
                    {contact.fullName} {contact.title && `(${contact.title})`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Invoice Contact</InputLabel>
              <Select
                value={data.contactRoles?.invoice?.id || ''}
                onChange={(e) => {
                  const selectedContact = associatedContacts.find(c => c.id === e.target.value);
                  handleStageDataChange('scoping', 'contactRoles', {
                    ...data.contactRoles,
                    invoice: selectedContact || null
                  });
                }}
                label="Invoice Contact"
              >
                <MenuItem value="">
                  <em>Select Invoice Contact</em>
                </MenuItem>
                {associatedContacts.map((contact) => (
                  <MenuItem key={contact.id} value={contact.id}>
                    {contact.fullName} {contact.title && `(${contact.title})`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
        </Grid>

        <FormControlLabel
          control={
            <Switch
              checked={data.preApproval || false}
              onChange={(e) => handleStageDataChange('scoping', 'preApproval', e.target.checked)}
            />
          }
          label="Pre-approval required for all placements"
          sx={{ mb: 2 }}
        />

        <Divider sx={{ my: 3 }} />

        <Typography variant="h6" gutterBottom>Additional Notes</Typography>
        <TextField
          label="Scoping Notes"
          value={data.notes || ''}
          onBlur={(e) => handleStageDataChange('scoping', 'notes', e.target.value)}
          fullWidth
          multiline
          rows={3}
          size="small"
          helperText="Add any additional comments or observations about this scoping phase"
        />
      </Box>
    );
  };

  const renderProposalDraftedForm = () => {
    const data = stageData.proposalDrafted || {};
    const positionRates = data.positionRates || [];

    const addPosition = () => {
      const newPosition = {
        jobTitle: '',
        markupPercent: 0,
        payRate: 0,
        billRate: 0
      };
      handleStageDataChange('proposalDrafted', 'positionRates', [...positionRates, newPosition]);
    };

    const removePosition = (index: number) => {
      const updatedRates = positionRates.filter((_, i) => i !== index);
      handleStageDataChange('proposalDrafted', 'positionRates', updatedRates);
    };

    const updatePosition = (index: number, field: string, value: any) => {
      const updatedRates = [...positionRates];
      updatedRates[index] = { ...updatedRates[index], [field]: value };
      handleStageDataChange('proposalDrafted', 'positionRates', updatedRates);
    };

    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>Proposal Details</Typography>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" gutterBottom>Positions</Typography>
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={addPosition}
            size="small"
          >
            Add Position
          </Button>
        </Box>

        {positionRates.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
            <Typography variant="body2">No positions added yet. Click &quot;Add Position&quot; to get started.</Typography>
          </Box>
        ) : (
          <TableContainer component={Paper} sx={{ mb: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Job Title</TableCell>
                  <TableCell align="right">Markup %</TableCell>
                  <TableCell align="right">Pay Rate ($)</TableCell>
                  <TableCell align="right">Bill Rate ($)</TableCell>
                  <TableCell align="center" width={50}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {positionRates.map((position, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <TextField
                        value={position.jobTitle}
                        onChange={(e) => updatePosition(index, 'jobTitle', e.target.value)}
                        size="small"
                        fullWidth
                        placeholder="e.g., Forklift Driver"
                      />
                    </TableCell>
                    <TableCell align="right">
                      <TextField
                        type="number"
                        value={position.markupPercent}
                        onChange={(e) => updatePosition(index, 'markupPercent', parseFloat(e.target.value) || 0)}
                        size="small"
                        fullWidth
                        inputProps={{ min: 0, max: 100, step: 0.1 }}
                        placeholder="0"
                      />
                    </TableCell>
                    <TableCell align="right">
                      <TextField
                        type="number"
                        value={position.payRate}
                        onChange={(e) => updatePosition(index, 'payRate', parseFloat(e.target.value) || 0)}
                        size="small"
                        fullWidth
                        inputProps={{ min: 0, step: 0.01 }}
                        placeholder="0.00"
                      />
                    </TableCell>
                    <TableCell align="right">
                      <TextField
                        type="number"
                        value={position.billRate}
                        onChange={(e) => updatePosition(index, 'billRate', parseFloat(e.target.value) || 0)}
                        size="small"
                        fullWidth
                        inputProps={{ min: 0, step: 0.01 }}
                        placeholder="0.00"
                      />
                    </TableCell>
                    <TableCell align="center">
                      <IconButton
                        onClick={() => removePosition(index)}
                        size="small"
                        color="error"
                      >
                        <RemoveIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {/* Conditional Rollovers Section */}
        {stageData.scoping?.rolloverStaff && (
          <>
            <Divider sx={{ my: 3 }} />
            
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6" gutterBottom>Rollovers</Typography>
              <Button
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() => {
                  const currentRollovers = data.rollovers || [];
                  const newRollover = {
                    howMany: 0,
                    fromAgency: '',
                    positions: '',
                    markupPercent: 0
                  };
                  handleStageDataChange('proposalDrafted', 'rollovers', [...currentRollovers, newRollover]);
                }}
                size="small"
              >
                Add Rollover
              </Button>
            </Box>

            {(!data.rollovers || data.rollovers.length === 0) ? (
              <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
                <Typography variant="body2">No rollover employees added yet. Click &quot;Add Rollover&quot; to get started.</Typography>
              </Box>
            ) : (
              <TableContainer component={Paper} sx={{ mb: 3 }}>
                <Table size="small">
                  <TableHead>
                                      <TableRow>
                    <TableCell>How Many</TableCell>
                    <TableCell>From Agency</TableCell>
                    <TableCell>Position(s)</TableCell>
                    <TableCell align="right">Markup %</TableCell>
                    <TableCell align="center" width={50}>Actions</TableCell>
                  </TableRow>
                  </TableHead>
                  <TableBody>
                    {(data.rollovers || []).map((rollover, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <TextField
                            type="number"
                            value={rollover.howMany}
                            onChange={(e) => {
                              const updatedRollovers = [...(data.rollovers || [])];
                              updatedRollovers[index] = { ...updatedRollovers[index], howMany: parseInt(e.target.value) || 0 };
                              handleStageDataChange('proposalDrafted', 'rollovers', updatedRollovers);
                            }}
                            size="small"
                            fullWidth
                            inputProps={{ min: 0, step: 1 }}
                            placeholder="0"
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            value={rollover.fromAgency}
                            onChange={(e) => {
                              const updatedRollovers = [...(data.rollovers || [])];
                              updatedRollovers[index] = { ...updatedRollovers[index], fromAgency: e.target.value };
                              handleStageDataChange('proposalDrafted', 'rollovers', updatedRollovers);
                            }}
                            size="small"
                            fullWidth
                            placeholder="e.g., ABC Staffing"
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            value={rollover.positions}
                            onChange={(e) => {
                              const updatedRollovers = [...(data.rollovers || [])];
                              updatedRollovers[index] = { ...updatedRollovers[index], positions: e.target.value };
                              handleStageDataChange('proposalDrafted', 'rollovers', updatedRollovers);
                            }}
                            size="small"
                            fullWidth
                            placeholder="e.g., Forklift Driver, Warehouse Associate"
                          />
                        </TableCell>
                        <TableCell align="right">
                          <TextField
                            type="number"
                            value={rollover.markupPercent}
                            onChange={(e) => {
                              const updatedRollovers = [...(data.rollovers || [])];
                              updatedRollovers[index] = { ...updatedRollovers[index], markupPercent: parseFloat(e.target.value) || 0 };
                              handleStageDataChange('proposalDrafted', 'rollovers', updatedRollovers);
                            }}
                            size="small"
                            fullWidth
                            inputProps={{ min: 0, max: 100, step: 0.1 }}
                            placeholder="0"
                          />
                        </TableCell>
                        <TableCell align="center">
                          <IconButton
                            onClick={() => {
                              const updatedRollovers = (data.rollovers || []).filter((_, i) => i !== index);
                              handleStageDataChange('proposalDrafted', 'rollovers', updatedRollovers);
                            }}
                            size="small"
                            color="error"
                          >
                            <RemoveIcon />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </>
        )}

        <Divider sx={{ my: 3 }} />

        <Typography variant="h6" gutterBottom>Additional Notes</Typography>
        <TextField
          label="Proposal Drafted Notes"
          value={data.notes || ''}
          onBlur={(e) => handleStageDataChange('proposalDrafted', 'notes', e.target.value)}
          fullWidth
          multiline
          rows={3}
          size="small"
          helperText="Add any additional comments or observations about this proposal"
        />
      </Box>
    );
  };

  const renderProposalReviewForm = () => {
    const data = stageData.proposalReview || {};

    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>Proposal Review</Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Track the proposal review process and expected response timeline.
        </Typography>

        <FormControl fullWidth size="small" sx={{ mb: 3 }}>
          <InputLabel>Proposal Being Reviewed By</InputLabel>
          <Select
            multiple
            value={data.underReviewBy?.map(contact => contact.id) || []}
            onChange={(e) => {
              const selectedIds = e.target.value as string[];
              const selectedContacts = associatedContacts.filter(contact => 
                selectedIds.includes(contact.id)
              );
              handleStageDataChange('proposalReview', 'underReviewBy', selectedContacts);
            }}
            label="Proposal Being Reviewed By"
            renderValue={(selected) => (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {selected.map((contactId) => {
                  const contact = associatedContacts.find(c => c.id === contactId);
                  return (
                    <Chip 
                      key={contactId} 
                      label={contact?.fullName || contactId} 
                      size="small" 
                    />
                  );
                })}
              </Box>
            )}
          >
            {associatedContacts.map((contact) => (
              <MenuItem key={contact.id} value={contact.id}>
                {contact.fullName} {contact.title && `(${contact.title})`}
              </MenuItem>
            ))}
          </Select>
          <FormHelperText>
            Select the contacts who are reviewing the proposal
          </FormHelperText>
        </FormControl>

        <TextField
          label="Expected Proposal Response Date"
          type="date"
          value={data.expectedProposalResponseDate || ''}
          onChange={(e) => handleStageDataChange('proposalReview', 'expectedProposalResponseDate', e.target.value)}
          fullWidth
          size="small"
          sx={{ mb: 3 }}
          InputLabelProps={{
            shrink: true,
          }}
          helperText="When do you expect to receive a response on the proposal?"
        />

        <Divider sx={{ my: 3 }} />

        <Typography variant="h6" gutterBottom>Additional Notes</Typography>
        <TextField
          label="Proposal Review Notes"
          value={data.notes || ''}
          onBlur={(e) => handleStageDataChange('proposalReview', 'notes', e.target.value)}
          fullWidth
          multiline
          rows={3}
          size="small"
          helperText="Add any additional comments or observations about the proposal review process"
        />
      </Box>
    );
  };

  const renderNegotiationForm = () => {
    const data = stageData.negotiation || {};

    const addConcession = () => {
      const currentConcessions = data.concessions || [];
      const newConcessions = [...currentConcessions, { request: '', response: '' }];
      handleStageDataChange('negotiation', 'concessions', newConcessions);
    };

    const removeConcession = (index: number) => {
      const currentConcessions = data.concessions || [];
      const newConcessions = currentConcessions.filter((_, i) => i !== index);
      handleStageDataChange('negotiation', 'concessions', newConcessions);
    };

    const updateConcession = (index: number, field: 'request' | 'response', value: string) => {
      const currentConcessions = data.concessions || [];
      const newConcessions = currentConcessions.map((concession, i) => 
        i === index ? { ...concession, [field]: value } : concession
      );
      handleStageDataChange('negotiation', 'concessions', newConcessions);
    };

    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>Negotiation</Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Track requested changes and concessions during the negotiation process.
        </Typography>

        <Typography variant="h6" gutterBottom sx={{ mt: 3 }}>Requested Changes</Typography>
        <TextField
          label="Requested Changes"
          value={data.requestedChanges?.join(', ') || ''}
          onChange={(e) => {
            const changes = e.target.value.split(',').map(s => s.trim()).filter(s => s);
            handleStageDataChange('negotiation', 'requestedChanges', changes);
          }}
          fullWidth
          multiline
          rows={3}
          size="small"
          sx={{ mb: 3 }}
          helperText="Enter requested changes, separated by commas"
        />

        <Typography variant="h6" gutterBottom sx={{ mt: 3 }}>Concessions</Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Track concessions with their requests and responses.
        </Typography>

        {(data.concessions || []).map((concession, index) => (
          <Box key={index} sx={{ mb: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="subtitle2">Concession {index + 1}</Typography>
              <IconButton
                onClick={() => removeConcession(index)}
                color="error"
                size="small"
              >
                <RemoveIcon />
              </IconButton>
            </Box>
            
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  label="Request"
                  value={concession.request}
                  onChange={(e) => updateConcession(index, 'request', e.target.value)}
                  fullWidth
                  size="small"
                  multiline
                  rows={2}
                  helperText="What was requested?"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label="Response"
                  value={concession.response}
                  onChange={(e) => updateConcession(index, 'response', e.target.value)}
                  fullWidth
                  size="small"
                  multiline
                  rows={2}
                  helperText="What was the response?"
                />
              </Grid>
            </Grid>
          </Box>
        ))}

        <Button
          startIcon={<AddIcon />}
          onClick={addConcession}
          variant="outlined"
          sx={{ mb: 3 }}
        >
          Add Concession
        </Button>

        <Divider sx={{ my: 3 }} />

        <Typography variant="h6" gutterBottom>Additional Notes</Typography>
        <TextField
          label="Negotiation Notes"
          value={data.notes || ''}
          onBlur={(e) => handleStageDataChange('negotiation', 'notes', e.target.value)}
          fullWidth
          multiline
          rows={3}
          size="small"
          helperText="Add any additional comments or observations about the negotiation process"
        />
      </Box>
    );
  };

  const renderVerbalAgreementForm = () => {
    const data = stageData.verbalAgreement || {};

    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>Verbal Agreement</Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Document the verbal agreement details and next steps.
        </Typography>

        <FormControl fullWidth size="small" sx={{ mb: 3 }}>
          <InputLabel>Verbal From</InputLabel>
          <Select
            value={data.verbalFrom?.id || ''}
            onChange={(e) => {
              const selectedContact = associatedContacts.find(contact => contact.id === e.target.value);
              handleStageDataChange('verbalAgreement', 'verbalFrom', selectedContact);
            }}
            label="Verbal From"
          >
            {associatedContacts.map((contact) => (
              <MenuItem key={contact.id} value={contact.id}>
                {contact.fullName} {contact.title && `(${contact.title})`}
              </MenuItem>
            ))}
          </Select>
          <FormHelperText>
            Who provided the verbal agreement?
          </FormHelperText>
        </FormControl>

        <TextField
          label="Verbal Date"
          type="date"
          value={data.verbalDate || ''}
          onChange={(e) => handleStageDataChange('verbalAgreement', 'verbalDate', e.target.value)}
          fullWidth
          size="small"
          sx={{ mb: 3 }}
          InputLabelProps={{
            shrink: true,
          }}
          helperText="When was the verbal agreement given?"
        />

        <FormControl fullWidth size="small" sx={{ mb: 3 }}>
          <InputLabel>Method</InputLabel>
          <Select
            value={data.method || ''}
            onChange={(e) => handleStageDataChange('verbalAgreement', 'method', e.target.value)}
            label="Method"
          >
            <MenuItem value="phone">Phone</MenuItem>
            <MenuItem value="email">Email</MenuItem>
            <MenuItem value="in_person">In Person</MenuItem>
            <MenuItem value="other">Other</MenuItem>
          </Select>
          <FormHelperText>
            How was the verbal agreement communicated?
          </FormHelperText>
        </FormControl>

        <Typography variant="h6" gutterBottom sx={{ mt: 3 }}>Conditions to Fulfill</Typography>
        <TextField
          label="Conditions to Fulfill"
          value={data.conditionsToFulfill?.join(', ') || ''}
          onChange={(e) => {
            const conditions = e.target.value.split(',').map(s => s.trim()).filter(s => s);
            handleStageDataChange('verbalAgreement', 'conditionsToFulfill', conditions);
          }}
          fullWidth
          multiline
          rows={3}
          size="small"
          sx={{ mb: 3 }}
          helperText="Enter conditions that need to be fulfilled, separated by commas"
        />

        <Typography variant="h6" gutterBottom sx={{ mt: 3 }}>Approvals Needed</Typography>
        <TextField
          label="Approvals Needed"
          value={data.approvalsNeeded?.join(', ') || ''}
          onChange={(e) => {
            const approvals = e.target.value.split(',').map(s => s.trim()).filter(s => s);
            handleStageDataChange('verbalAgreement', 'approvalsNeeded', approvals);
          }}
          fullWidth
          multiline
          rows={3}
          size="small"
          sx={{ mb: 3 }}
          helperText="Enter approvals that are still needed, separated by commas"
        />

        {/* Moved Insurance Submitted checkbox to Onboarding stage */}

        <Divider sx={{ my: 3 }} />

        <Typography variant="h6" gutterBottom>Additional Notes</Typography>
        <TextField
          label="Verbal Agreement Notes"
          value={data.notes || ''}
          onBlur={(e) => handleStageDataChange('verbalAgreement', 'notes', e.target.value)}
          fullWidth
          multiline
          rows={3}
          size="small"
          helperText="Add any additional comments or observations about the verbal agreement"
        />
      </Box>
    );
  };

  const renderClosedWonForm = () => {
    const data = stageData.closedWon || {};

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file || !dealId || !tenantId) return;

      // Validate file size (10MB max)
      if (file.size > 10 * 1024 * 1024) {
        alert('Contract file size must be less than 10MB');
        return;
      }

      // Validate file type
      const validTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
      if (!validTypes.includes(file.type)) {
        alert('Please upload a PDF or Word document');
        return;
      }

      setUploadingContract(true);
      try {
        // Upload to Firebase Storage
        const fileName = `contract_${Date.now()}_${file.name}`;
        const storageRef = ref(storage, `deals/${tenantId}/${dealId}/contracts/${fileName}`);
        await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(storageRef);

        // Save contract metadata to stage data
        const contractData = {
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          downloadURL: downloadURL,
          storagePath: storageRef.fullPath,
          uploadedAt: new Date().toISOString(),
          uploadedBy: user?.uid || 'unknown'
        };

        handleStageDataChange('closedWon', 'signedContract', contractData);
        
        // Clear the file input
        event.target.value = '';
      } catch (error) {
        console.error('Error uploading contract:', error);
        alert('Failed to upload contract. Please try again.');
      } finally {
        setUploadingContract(false);
      }
    };

    const handleDeleteContract = async () => {
      if (!data.signedContract?.storagePath) return;

      try {
        // Delete from Firebase Storage
        const storageRef = ref(storage, data.signedContract.storagePath);
        await deleteObject(storageRef);

        // Remove from stage data
        handleStageDataChange('closedWon', 'signedContract', null);
      } catch (error) {
        console.error('Error deleting contract:', error);
        alert('Failed to delete contract. Please try again.');
      }
    };

    const handleDownloadContract = () => {
      if (data.signedContract?.downloadURL) {
        window.open(data.signedContract.downloadURL, '_blank');
      }
    };

    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>Closing</Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Document the signed contract and important dates.
        </Typography>

        <FormControl fullWidth size="small" sx={{ mb: 3 }}>
          <InputLabel>Closing Status</InputLabel>
          <Select
            value={data.status || ''}
            onChange={(e) => handleStageDataChange('closedWon', 'status', e.target.value)}
            label="Closing Status"
          >
            <MenuItem value="won">Won</MenuItem>
            <MenuItem value="lost">Lost</MenuItem>
          </Select>
        </FormControl>

        {data.status === 'won' && (
          <>
            <Typography variant="h6" gutterBottom sx={{ mt: 3 }}>Signed Contract</Typography>
            
            <Box sx={{ mb: 3 }}>
              {!data.signedContract ? (
                <>
                  <input
                    accept=".pdf,.doc,.docx"
                    style={{ display: 'none' }}
                    id="signed-contract-upload"
                    type="file"
                    onChange={handleFileUpload}
                    disabled={uploadingContract}
                  />
                  <label htmlFor="signed-contract-upload">
                    <Button
                      variant="outlined"
                      component="span"
                      startIcon={uploadingContract ? <CircularProgress size={16} /> : <CloudUploadIcon />}
                      sx={{ mb: 2 }}
                      disabled={uploadingContract}
                    >
                      {uploadingContract ? 'Uploading...' : 'Upload Signed Contract'}
                    </Button>
                  </label>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Supported formats: PDF, DOC, DOCX (max 10MB)
                  </Typography>
                </>
              ) : (
                <Box sx={{ 
                  border: '1px solid #e0e0e0', 
                  borderRadius: 1, 
                  p: 2, 
                  bgcolor: 'grey.50',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <DescriptionIcon color="primary" />
                    <Box>
                      <Typography variant="body2" fontWeight="medium">
                        {data.signedContract.fileName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {(data.signedContract.fileSize / 1024 / 1024).toFixed(2)} MB • 
                        Uploaded {new Date(data.signedContract.uploadedAt).toLocaleDateString()}
                      </Typography>
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={handleDownloadContract}
                      startIcon={<CloudUploadIcon />}
                    >
                      Download
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      onClick={handleDeleteContract}
                      startIcon={<DeleteIcon />}
                    >
                      Delete
                    </Button>
                  </Box>
                </Box>
              )}
            </Box>

            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12} md={6}>
                <TextField
                  label="Date Signed"
                  type="date"
                  value={data.dateSigned || ''}
                  onChange={(e) => handleStageDataChange('closedWon', 'dateSigned', e.target.value)}
                  fullWidth
                  size="small"
                  InputLabelProps={{
                    shrink: true,
                  }}
                  helperText="When was the contract signed?"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label="Expiration Date"
                  type="date"
                  value={data.expirationDate || ''}
                  onChange={(e) => handleStageDataChange('closedWon', 'expirationDate', e.target.value)}
                  fullWidth
                  size="small"
                  InputLabelProps={{
                    shrink: true,
                  }}
                  helperText="When does the contract expire?"
                />
              </Grid>
            </Grid>

            {/* <FormControlLabel
              control={
                <Checkbox
                  checked={data.rateSheetOnFile || false}
                  onChange={(e) => handleStageDataChange('closedWon', 'rateSheetOnFile', e.target.checked)}
                />
              }
              label="Rate Sheet On File"
              sx={{ mb: 2 }}
            />

            <FormControlLabel
              control={
                <Checkbox
                  checked={data.msaSigned || false}
                  onChange={(e) => handleStageDataChange('closedWon', 'msaSigned', e.target.checked)}
                />
              }
              label="MSA Signed"
              sx={{ mb: 3 }}
            /> */}

            <Divider sx={{ my: 3 }} />
          </>
        )}

        {data.status === 'lost' && (
          <>
            <Alert severity="warning" sx={{ mb: 3 }}>
              This deal has been marked as lost. Please provide details to help improve future opportunities and determine if follow-up is needed.
            </Alert>

            <FormControl fullWidth sx={{ mb: 3 }}>
              <InputLabel>Primary Reason for Loss</InputLabel>
              <Select
                value={data.lostReason || ''}
                label="Primary Reason for Loss"
                onChange={(e) => handleStageDataChange('closedWon', 'lostReason', e.target.value)}
              >
                <MenuItem value="price">Price/Competitive Pricing</MenuItem>
                <MenuItem value="timing">Timing/Not Ready</MenuItem>
                <MenuItem value="competitor">Lost to Competitor</MenuItem>
                <MenuItem value="no_need">No Longer Need</MenuItem>
                <MenuItem value="internal_decision">Internal Decision</MenuItem>
                <MenuItem value="other">Other</MenuItem>
              </Select>
            </FormControl>

            {data.lostReason === 'competitor' && (
              <Box sx={{ ml: 2, mb: 3 }}>
                <TextField
                  label="Competitor Name"
                  value={data.competitor || ''}
                  onChange={(e) => handleStageDataChange('closedWon', 'competitor', e.target.value)}
                  fullWidth
                  size="small"
                  sx={{ mb: 2 }}
                />
                <TextField
                  label="What did they offer?"
                  value={data.lostTo || ''}
                  onChange={(e) => handleStageDataChange('closedWon', 'lostTo', e.target.value)}
                  fullWidth
                  multiline
                  rows={2}
                  size="small"
                />
              </Box>
            )}

            {data.lostReason === 'price' && (
              <Box sx={{ ml: 2, mb: 3 }}>
                <TextField
                  label="Price Difference ($)"
                  type="number"
                  value={data.priceDifference || ''}
                  onChange={(e) => handleStageDataChange('closedWon', 'priceDifference', parseFloat(e.target.value))}
                  fullWidth
                  size="small"
                  sx={{ mb: 2 }}
                />
              </Box>
            )}

            <TextField
              label="Decision Maker"
              value={data.decisionMaker || ''}
              onChange={(e) => handleStageDataChange('closedWon', 'decisionMaker', e.target.value)}
              fullWidth
              size="small"
              sx={{ mb: 2 }}
            />

            <TextField
              label="Customer Feedback"
              value={data.feedback || ''}
              onChange={(e) => handleStageDataChange('closedWon', 'feedback', e.target.value)}
              fullWidth
              multiline
              rows={3}
              size="small"
              sx={{ mb: 2 }}
              helperText="What did the customer say about why they chose not to proceed?"
            />

            <TextField
              label="Lessons Learned"
              value={data.lessonsLearned || ''}
              onChange={(e) => handleStageDataChange('closedWon', 'lessonsLearned', e.target.value)}
              fullWidth
              multiline
              rows={3}
              size="small"
              sx={{ mb: 2 }}
              helperText="What could we have done differently?"
            />

            <Divider sx={{ my: 3 }} />
          </>
        )}

        <Typography variant="h6" gutterBottom>Additional Notes</Typography>
        <TextField
          label="Closed Won Notes"
          value={data.notes || ''}
          onBlur={(e) => handleStageDataChange('closedWon', 'notes', e.target.value)}
          fullWidth
          multiline
          rows={3}
          size="small"
          helperText="Add any additional comments or observations about the closed deal"
        />
      </Box>
    );
  };

  const renderOnboardingForm = () => {
    const data = (stageData.onboarding || {}) as OnboardingData;
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>Onboarding Plan</Typography>

        <TextField
          label="Onboarding Start Date"
          type="date"
          value={data.onboardingStartDate || ''}
          onChange={(e) => handleStageDataChange('onboarding', 'onboardingStartDate', e.target.value)}
          fullWidth
          size="small"
          sx={{ mb: 2 }}
          InputLabelProps={{ shrink: true }}
        />

        <FormControlLabel
          control={
            <Checkbox
              checked={data.recruitingIntroduced || false}
              onChange={(e) => handleStageDataChange('onboarding', 'recruitingIntroduced', e.target.checked)}
            />
          }
          label="Recruiting team introduced"
          sx={{ mb: 1 }}
        />

        <FormControlLabel
          control={
            <Checkbox
              checked={data.checklistGenerated || false}
              onChange={(e) => handleStageDataChange('onboarding', 'checklistGenerated', e.target.checked)}
            />
          }
          label="Onboarding checklist generated"
          sx={{ mb: 1 }}
        />

        <FormControlLabel
          control={
            <Checkbox
              checked={data.convertedToJobOrder || false}
              onChange={(e) => handleStageDataChange('onboarding', 'convertedToJobOrder', e.target.checked)}
            />
          }
          label="Converted to Job Order"
          sx={{ mb: 1 }}
        />

        <FormControlLabel
          control={
            <Checkbox
              checked={data.insuranceSubmitted || false}
              onChange={(e) => handleStageDataChange('onboarding', 'insuranceSubmitted', e.target.checked)}
            />
          }
          label="Insurance Submitted"
          sx={{ mb: 2 }}
        />

        <TextField
          label="Onboarding Notes"
          value={data.notes || ''}
          onBlur={(e) => handleStageDataChange('onboarding', 'notes', e.target.value)}
          fullWidth
          multiline
          rows={3}
          size="small"
          helperText="Add any additional onboarding notes"
        />
      </Box>
    );
  };

  const renderStageForm = (stageKey: string) => {
    switch (stageKey) {
      case 'discovery':
        return renderDiscoveryForm();
      case 'qualification':
        return renderQualificationForm();
      case 'scoping':
        return renderScopingForm();
      case 'proposalDrafted':
        return renderProposalDraftedForm();
      case 'proposalReview':
        return renderProposalReviewForm();
      case 'negotiation':
        return renderNegotiationForm();
      case 'verbalAgreement':
        return renderVerbalAgreementForm();
      case 'onboarding':
        return renderOnboardingForm();
      case 'closedWon':
        return renderClosedWonForm();
      case 'dormant':
        return renderDormantForm();
      default:
        return (
          <Box sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>{STAGES.find(s => s.key === stageKey)?.label} Stage</Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>
              Form for {STAGES.find(s => s.key === stageKey)?.label} stage coming soon...
            </Typography>
            
            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" gutterBottom>Additional Notes</Typography>
            <TextField
              label={`${STAGES.find(s => s.key === stageKey)?.label} Notes`}
              value={stageData[stageKey as keyof DealStageData]?.notes || ''}
              onBlur={(e) => handleStageDataChange(stageKey, 'notes', e.target.value)}
              fullWidth
              multiline
              rows={3}
              size="small"
              helperText={`Add any additional comments or observations about this ${STAGES.find(s => s.key === stageKey)?.label.toLowerCase()} phase`}
            />
          </Box>
        );
    }
  };

  return (
    <Box>
      {/* <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5">Deal Stage Forms</Typography>
      </Box> */}

      <Paper elevation={1} sx={{ borderRadius: 0 }}>
        {STAGES.map((stage, index) => {
          const status = getStageStatus(stage.key, index);
          const isExpanded = expandedStep === index;
          
          return (
            <Accordion
              key={stage.key}
              expanded={isExpanded}
              onChange={() => setExpandedStep(isExpanded ? false : index)}
              sx={{
                '&:before': { display: 'none' },
                borderBottom: '1px solid',
                borderColor: 'divider'
              }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                  {getStageIcon(status)}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ color: getStageColor(stage.key) }}>
                      {stage.icon}
                    </Box>
                    <Typography variant="subtitle1">{stage.label}</Typography>
                  </Box>
                  <Box sx={{ ml: 'auto', display: 'flex', gap: 1, alignItems: 'center' }}>
                    {/* <Chip
                      label={status === 'completed' ? 'Completed' : status === 'active' ? 'In Progress' : 'Not Started'}
                      color={status === 'completed' ? 'success' : status === 'active' ? 'warning' : 'default'}
                      size="small"
                    /> */}
                    {status === 'active' && (
                      <Chip
                        label="Mark as Complete"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMarkStageComplete(stage.key);
                        }}
                        color="primary"
                        size="small"
                        clickable
                        sx={{ 
                          ml: 1,
                          mr: 1.5,
                          cursor: 'pointer'
                        }}
                      />
                    )}
                    {status === 'completed' && onStageIncomplete && (
                      <Chip
                        label="Revert"
                        onClick={(e) => {
                          e.stopPropagation();
                          onStageIncomplete(stage.key);
                        }}
                        color="warning"
                        size="small"
                        clickable
                        icon={<UndoIcon fontSize="small" />}
                        sx={{ ml: 1, mr: 1.5, cursor: 'pointer' }}
                      />
                    )}
                  </Box>
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ p: 0 }}>
                {renderStageForm(stage.key)}
              </AccordionDetails>
            </Accordion>
          );
        })}
      </Paper>

      {Object.keys(errors).length > 0 && (
        <Alert severity="error" sx={{ mt: 2 }}>
          Please fix the following errors:
          <List dense>
            {Object.entries(errors).map(([field, error]) => (
              <ListItem key={field}>
                <ListItemText primary={`${field}: ${error}`} />
              </ListItem>
            ))}
          </List>
        </Alert>
      )}

      <Snackbar
        open={showToast}
        autoHideDuration={3000}
        onClose={() => setShowToast(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setShowToast(false)}
          severity={toastSeverity}
          sx={{ width: '100%' }}
        >
          {toastMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default DealStageForms; 