import React, { useState, useEffect } from 'react';
import {
  Box,
  Stepper,
  Step,
  StepLabel,
  Button,
  Typography,
  Paper,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Grid,
  Card,
  CardContent,
  Alert,
  CircularProgress,
  Autocomplete,
  Switch,
  FormControlLabel,
  Slider,
  Rating,
  Divider
} from '@mui/material';
import { collection, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { DealIntelligenceProfile, DealStakeholder, CRMDeal } from '../types/CRM';
import { useAIFieldLogging } from '../utils/aiFieldLogging';

interface DealIntelligenceWizardProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (dealId: string) => void;
  onComplete?: (profile: DealIntelligenceProfile) => void;
  deal?: CRMDeal;
  initialData?: {
    companyId?: string;
    contactIds?: string[];
    dealName?: string;
  };
}

const DealIntelligenceWizard: React.FC<DealIntelligenceWizardProps> = ({
  open,
  onClose,
  onSuccess,
  onComplete,
  deal,
  initialData
}) => {
  const { tenantId } = useAuth();
  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // AI Logging hooks for key deal intelligence fields
  const logDealName = useAIFieldLogging('deal.name', tenantId || '', 'agency');
  const logCompanyContext = useAIFieldLogging('deal.companyContext', tenantId || '', 'agency');
  const logPainProfile = useAIFieldLogging('deal.painProfile', tenantId || '', 'agency');
  const logStakeholders = useAIFieldLogging('deal.stakeholders', tenantId || '', 'agency');
  const logBuyingProcess = useAIFieldLogging('deal.buyingProcess', tenantId || '', 'agency');
  const logImplementation = useAIFieldLogging('deal.implementation', tenantId || '', 'agency');
  const logCompetitiveLandscape = useAIFieldLogging('deal.competitiveLandscape', tenantId || '', 'agency');
  const logForecast = useAIFieldLogging('deal.forecast', tenantId || '', 'agency');
  
  // Step 1: Basic Deal Info
  const [basicInfo, setBasicInfo] = useState({
    dealName: deal?.name || initialData?.dealName || '',
    companyId: deal?.companyId || initialData?.companyId || '',
    contactIds: deal?.contactIds || initialData?.contactIds || [],
    industry: '',
    estimatedHeadcount: deal?.dealProfile?.forecast?.estimatedHeadcount || 0,
    priorityScore: 5
  });
  
  // Step 2: Company Context
  const [companyContext, setCompanyContext] = useState({
    size: deal?.dealProfile?.companyContext?.size || 'medium' as 'small' | 'medium' | 'large' | 'enterprise',
    headcount: deal?.dealProfile?.companyContext?.headcount || 0,
    locations: deal?.dealProfile?.companyContext?.locations || 1,
    isUnionized: deal?.dealProfile?.companyContext?.isUnionized || false,
    hasTempLaborExperience: deal?.dealProfile?.companyContext?.hasTempLaborExperience || false,
    workforceModel: deal?.dealProfile?.companyContext?.workforceModel || 'mixed' as 'full_time' | 'flex' | 'outsourced' | 'mixed'
  });
  
  // Step 3: Pain & Need Profile
  const [painProfile, setPainProfile] = useState({
    corePain: deal?.dealProfile?.painProfile?.corePain || '',
    urgency: deal?.dealProfile?.painProfile?.urgency || 'medium' as 'low' | 'medium' | 'high',
    whyNow: deal?.dealProfile?.painProfile?.whyNow || '',
    painOwner: deal?.dealProfile?.painProfile?.painOwner || '',
    consequenceOfInaction: deal?.dealProfile?.painProfile?.consequenceOfInaction || '',
    aiSummary: deal?.dealProfile?.painProfile?.aiSummary || ''
  });
  
  // Step 4: Stakeholder Map
  const [stakeholders, setStakeholders] = useState<DealStakeholder[]>(deal?.dealProfile?.stakeholders || []);
  const [newStakeholder, setNewStakeholder] = useState<Partial<DealStakeholder>>({
    name: '',
    title: '',
    role: 'observer',
    influence: 'medium',
    personality: 'amiable',
    contactMethod: 'email',
    isContractSigner: false,
    isDecisionInfluencer: false,
    isImplementationResponsible: false,
    notes: ''
  });
  
  // Step 5: Buying Process
  const [buyingProcess, setBuyingProcess] = useState({
    hasFormalBid: deal?.dealProfile?.buyingProcess?.hasFormalBid || false,
    isCompetitive: deal?.dealProfile?.buyingProcess?.isCompetitive || false,
    competitors: deal?.dealProfile?.buyingProcess?.competitors || [] as string[],
    requiresLegalReview: deal?.dealProfile?.buyingProcess?.requiresLegalReview || false,
    requiresProcurement: deal?.dealProfile?.buyingProcess?.requiresProcurement || false,
    requiresBackgroundChecks: deal?.dealProfile?.buyingProcess?.requiresBackgroundChecks || false,
    estimatedTimeline: deal?.dealProfile?.buyingProcess?.estimatedTimeline || 30,
    processComplexityIndex: deal?.dealProfile?.buyingProcess?.processComplexityIndex || 5
  });
  
  // Step 6: Implementation Path
  const [implementation, setImplementation] = useState({
    onboardingModel: deal?.dealProfile?.implementation?.onboardingModel || 'hybrid' as 'centralized' | 'site_based' | 'hybrid',
    operationalPOC: deal?.dealProfile?.implementation?.operationalPOC || '',
    knownBlockers: deal?.dealProfile?.implementation?.knownBlockers || [] as string[],
    requiresSiteVisits: deal?.dealProfile?.implementation?.requiresSiteVisits || false,
    requiresWalkthroughs: deal?.dealProfile?.implementation?.requiresWalkthroughs || false
  });
  
  // Step 7: Competitive Landscape
  const [competitiveLandscape, setCompetitiveLandscape] = useState({
    currentVendor: deal?.dealProfile?.competitiveLandscape?.currentVendor || '',
    vendorLikes: deal?.dealProfile?.competitiveLandscape?.vendorLikes || [] as string[],
    vendorDislikes: deal?.dealProfile?.competitiveLandscape?.vendorDislikes || [] as string[],
    internalRelationships: deal?.dealProfile?.competitiveLandscape?.internalRelationships || [] as string[],
    hasWorkedWithC1: deal?.dealProfile?.competitiveLandscape?.hasWorkedWithC1 || false
  });
  
  // Step 8: Forecast & Value
  const [forecast, setForecast] = useState({
    estimatedHeadcount: deal?.dealProfile?.forecast?.estimatedHeadcount || 0,
    estimatedBillRate: deal?.dealProfile?.forecast?.estimatedBillRate || 0,
    grossProfitPerMonth: deal?.dealProfile?.forecast?.grossProfitPerMonth || 0,
    expansionOpportunities: deal?.dealProfile?.forecast?.expansionOpportunities || [] as string[],
    dealValue: deal?.dealProfile?.forecast?.dealValue || 0,
    effortToRewardRatio: deal?.dealProfile?.forecast?.effortToRewardRatio || 5,
    salesMotionType: deal?.dealProfile?.forecast?.salesMotionType || 'simple' as 'simple' | 'complex' | 'bureaucratic' | 'enterprise'
  });

  const steps = [
    'Basic Deal Info',
    'Company Context',
    'Pain & Need Profile',
    'Stakeholder Map',
    'Buying Process',
    'Implementation Path',
    'Competitive Landscape',
    'Forecast & Value'
  ];

  const handleNext = () => {
    // Log step completion for AI analysis
    const currentStepName = steps[activeStep];
    console.log(`📝 Step completed: ${currentStepName}`);
    
    // Log step-specific data for AI analysis
    switch (activeStep) {
      case 0: // Basic Deal Info
        logDealName(basicInfo.dealName, `Step 1 completed: ${basicInfo.dealName}`);
        break;
      case 1: // Company Context
        logCompanyContext(companyContext, `Step 2 completed: Company context captured`);
        break;
      case 2: // Pain & Need Profile
        logPainProfile(painProfile, `Step 3 completed: Pain profile captured`);
        break;
      case 3: // Stakeholder Map
        logStakeholders(stakeholders, `Step 4 completed: ${stakeholders.length} stakeholders mapped`);
        break;
      case 4: // Buying Process
        logBuyingProcess(buyingProcess, `Step 5 completed: Buying process complexity captured`);
        break;
      case 5: // Implementation Path
        logImplementation(implementation, `Step 6 completed: Implementation strategy captured`);
        break;
      case 6: // Competitive Landscape
        logCompetitiveLandscape(competitiveLandscape, `Step 7 completed: Competitive analysis captured`);
        break;
      case 7: // Forecast & Value
        logForecast(forecast, `Step 8 completed: Deal forecast captured`);
        break;
    }
    
    setActiveStep((prevActiveStep) => prevActiveStep + 1);
  };

  const handleBack = () => {
    console.log(`⬅️ Going back from step: ${steps[activeStep]}`);
    setActiveStep((prevActiveStep) => prevActiveStep - 1);
  };

  const handleSaveDeal = async () => {
    setLoading(true);
    setError('');
    
    try {
      // Log deal intelligence data for AI analysis
      console.log('🔄 Starting AI logging for deal intelligence...');
      
      // Log basic deal info
      await logDealName(basicInfo.dealName, 'Deal name captured from wizard');
      
      // Log company context
      await logCompanyContext(companyContext, 'Company context and structure captured');
      
      // Log pain profile
      await logPainProfile(painProfile, 'Pain points and urgency assessment captured');
      
      // Log stakeholders
      await logStakeholders(stakeholders, 'Stakeholder mapping and influence analysis captured');
      
      // Log buying process
      await logBuyingProcess(buyingProcess, 'Buying process complexity and requirements captured');
      
      // Log implementation path
      await logImplementation(implementation, 'Implementation strategy and blockers captured');
      
      // Log competitive landscape
      await logCompetitiveLandscape(competitiveLandscape, 'Competitive analysis and vendor landscape captured');
      
      // Log forecast and value
      await logForecast(forecast, 'Deal value forecast and effort-reward analysis captured');
      
      console.log('✅ AI logging completed for deal intelligence');
      
      // Create deal intelligence profile
      const dealProfile: DealIntelligenceProfile = {
        companyContext,
        painProfile,
        stakeholders,
        buyingProcess,
        implementation,
        competitiveLandscape,
        forecast,
        aiAnalysis: {
          summary: '',
          riskLevel: 'medium',
          nextSteps: [],
          confidenceLevel: 50,
          recommendedCadence: '',
          stakeholderStrategy: '',
          timelineForecast: '',
          heatmapRisks: {
            timeline: 'medium',
            political: 'medium',
            legal: 'medium',
            competitive: 'medium',
          },
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      
      // Calculate complexity score
      const complexityScore = calculateComplexityScore(dealProfile);
      
      // Create deal document with AI logging metadata
      const dealData: any = {
        name: basicInfo.dealName,
        companyId: basicInfo.companyId,
        contactIds: basicInfo.contactIds,
        stage: deal?.stage || 'qualification',
        estimatedRevenue: forecast.dealValue,
        probability: deal?.probability || 25, // Start low, will be updated by AI
        closeDate: deal?.closeDate || new Date(Date.now() + buyingProcess.estimatedTimeline * 24 * 60 * 60 * 1000).toISOString(),
        owner: deal?.owner || '', // Will be set by current user
        tags: deal?.tags || [],
        notes: deal?.notes || '',
        dealProfile,
        complexityScore,
        // AI logging metadata
        aiLogging: {
          loggedAt: serverTimestamp(),
          loggedFields: [
            'deal.name',
            'deal.companyContext', 
            'deal.painProfile',
            'deal.stakeholders',
            'deal.buyingProcess',
            'deal.implementation',
            'deal.competitiveLandscape',
            'deal.forecast'
          ],
          source: 'deal_intelligence_wizard',
          version: '1.0'
        },
        updatedAt: serverTimestamp()
      };
      
      let dealRef;
      if (deal?.id) {
        // Update existing deal
        const dealDocRef = doc(db, 'tenants', tenantId, 'crm_deals', deal.id);
        await updateDoc(dealDocRef, dealData);
        dealRef = { id: deal.id };
        console.log('🔄 Updated existing deal:', deal.id);
      } else {
        // Create new deal
        dealData.createdAt = serverTimestamp();
        dealRef = await addDoc(collection(db, 'tenants', tenantId, 'crm_deals'), dealData);
        console.log('🆕 Created new deal:', dealRef.id);
      }
      
      // Update company with deal intelligence
      if (basicInfo.companyId) {
        const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', basicInfo.companyId);
        await updateDoc(companyRef, {
          dealIntelligence: {
            complexityScore,
            urgencyLevel: painProfile.urgency,
            painPoints: [painProfile.corePain],
            decisionMakers: stakeholders.filter(s => s.role === 'decision_maker').map(s => s.name),
            influencers: stakeholders.filter(s => s.role === 'recommender').map(s => s.name),
            blockers: stakeholders.filter(s => s.role === 'blocker').map(s => s.name),
            competitiveVendors: buyingProcess.competitors,
            complianceRequirements: [],
            implementationTimeline: buyingProcess.estimatedTimeline,
            estimatedValue: forecast.dealValue,
            effortToRewardRatio: forecast.effortToRewardRatio
          },
          updatedAt: serverTimestamp()
        });
      }
      
      // Log successful deal creation
      console.log('🎉 Deal Intelligence Wizard completed successfully');
      console.log('📊 Deal Complexity Score:', complexityScore);
      console.log('👥 Stakeholders mapped:', stakeholders.length);
      console.log('💰 Estimated Value:', forecast.dealValue);
      
      // Call onComplete callback if provided (for editing existing deals)
      if (onComplete) {
        onComplete(dealProfile);
      }
      
      onSuccess(dealRef.id);
      onClose();
    } catch (err: any) {
      console.error('❌ Error in Deal Intelligence Wizard:', err);
      setError(err.message || 'Failed to save deal');
    } finally {
      setLoading(false);
    }
  };

  const calculateComplexityScore = (profile: DealIntelligenceProfile): number => {
    let score = 5; // Base score
    
    // Company size impact
    if (profile.companyContext.size === 'enterprise') score += 2;
    if (profile.companyContext.size === 'large') score += 1;
    
    // Unionization impact
    if (profile.companyContext.isUnionized) score += 2;
    
    // Stakeholder complexity
    score += Math.min(profile.stakeholders.length * 0.5, 3);
    
    // Buying process complexity
    if (profile.buyingProcess.hasFormalBid) score += 1;
    if (profile.buyingProcess.requiresLegalReview) score += 1;
    if (profile.buyingProcess.requiresProcurement) score += 1;
    if (profile.buyingProcess.isCompetitive) score += 1;
    
    // Implementation complexity
    if (profile.implementation.requiresSiteVisits) score += 1;
    if (profile.implementation.knownBlockers.length > 0) score += 1;
    
    return Math.min(Math.max(score, 1), 10);
  };

  const addStakeholder = () => {
    if (newStakeholder.name && newStakeholder.title) {
      const updatedStakeholders = [...stakeholders, newStakeholder as DealStakeholder];
      setStakeholders(updatedStakeholders);
      
      // Log stakeholder addition for AI analysis
      console.log(`👤 Stakeholder added: ${newStakeholder.name} (${newStakeholder.role})`);
      logStakeholders(updatedStakeholders, `Stakeholder added: ${newStakeholder.name} - ${newStakeholder.role}`);
      
      setNewStakeholder({
        name: '',
        title: '',
        role: 'observer',
        influence: 'medium',
        personality: 'amiable',
        contactMethod: 'email',
        isContractSigner: false,
        isDecisionInfluencer: false,
        isImplementationResponsible: false,
        notes: ''
      });
    }
  };

  const removeStakeholder = (index: number) => {
    const removedStakeholder = stakeholders[index];
    const updatedStakeholders = stakeholders.filter((_, i) => i !== index);
    setStakeholders(updatedStakeholders);
    
    // Log stakeholder removal for AI analysis
    console.log(`🗑️ Stakeholder removed: ${removedStakeholder.name}`);
    logStakeholders(updatedStakeholders, `Stakeholder removed: ${removedStakeholder.name}`);
  };

  const renderStepContent = (step: number) => {
    switch (step) {
      case 0:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>Basic Deal Information</Typography>
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Deal Name"
                  value={basicInfo.dealName}
                  onChange={(e) => setBasicInfo({...basicInfo, dealName: e.target.value})}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Industry"
                  value={basicInfo.industry}
                  onChange={(e) => setBasicInfo({...basicInfo, industry: e.target.value})}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  type="number"
                  label="Estimated Headcount"
                  value={basicInfo.estimatedHeadcount}
                  onChange={(e) => setBasicInfo({...basicInfo, estimatedHeadcount: parseInt(e.target.value) || 0})}
                />
              </Grid>
              <Grid item xs={12}>
                <Typography gutterBottom>Priority Score</Typography>
                <Slider
                  value={basicInfo.priorityScore}
                  onChange={(_, value) => setBasicInfo({...basicInfo, priorityScore: value as number})}
                  min={1}
                  max={10}
                  marks
                  valueLabelDisplay="auto"
                />
              </Grid>
            </Grid>
          </Box>
        );
      
      case 1:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>Company Context</Typography>
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Company Size</InputLabel>
                  <Select
                    value={companyContext.size}
                    onChange={(e) => setCompanyContext({...companyContext, size: e.target.value as any})}
                    label="Company Size"
                  >
                    <MenuItem value="small">Small (1-50 employees)</MenuItem>
                    <MenuItem value="medium">Medium (51-500 employees)</MenuItem>
                    <MenuItem value="large">Large (501-5000 employees)</MenuItem>
                    <MenuItem value="enterprise">Enterprise (5000+ employees)</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  type="number"
                  label="Total Headcount"
                  value={companyContext.headcount}
                  onChange={(e) => setCompanyContext({...companyContext, headcount: parseInt(e.target.value) || 0})}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  type="number"
                  label="Number of Locations"
                  value={companyContext.locations}
                  onChange={(e) => setCompanyContext({...companyContext, locations: parseInt(e.target.value) || 1})}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Workforce Model</InputLabel>
                  <Select
                    value={companyContext.workforceModel}
                    onChange={(e) => setCompanyContext({...companyContext, workforceModel: e.target.value as any})}
                    label="Workforce Model"
                  >
                    <MenuItem value="full_time">Full-Time Only</MenuItem>
                    <MenuItem value="flex">Flex/Temporary</MenuItem>
                    <MenuItem value="outsourced">Outsourced</MenuItem>
                    <MenuItem value="mixed">Mixed</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={companyContext.isUnionized}
                      onChange={(e) => setCompanyContext({...companyContext, isUnionized: e.target.checked})}
                    />
                  }
                  label="Unionized Workforce"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={companyContext.hasTempLaborExperience}
                      onChange={(e) => setCompanyContext({...companyContext, hasTempLaborExperience: e.target.checked})}
                    />
                  }
                  label="Has Temporary Labor Experience"
                />
              </Grid>
            </Grid>
          </Box>
        );
      
      case 2:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>Pain & Need Profile</Typography>
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  multiline
                  rows={3}
                  label="Core Pain Point"
                  value={painProfile.corePain}
                  onChange={(e) => setPainProfile({...painProfile, corePain: e.target.value})}
                  placeholder="What is the primary problem they're trying to solve?"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Urgency Level</InputLabel>
                  <Select
                    value={painProfile.urgency}
                    onChange={(e) => setPainProfile({...painProfile, urgency: e.target.value as any})}
                    label="Urgency Level"
                  >
                    <MenuItem value="low">Low</MenuItem>
                    <MenuItem value="medium">Medium</MenuItem>
                    <MenuItem value="high">High</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Pain Owner"
                  value={painProfile.painOwner}
                  onChange={(e) => setPainProfile({...painProfile, painOwner: e.target.value})}
                  placeholder="Who owns this problem?"
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  multiline
                  rows={3}
                  label="Why Now?"
                  value={painProfile.whyNow}
                  onChange={(e) => setPainProfile({...painProfile, whyNow: e.target.value})}
                  placeholder="What changed to make this urgent now?"
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  multiline
                  rows={3}
                  label="Consequence of Inaction"
                  value={painProfile.consequenceOfInaction}
                  onChange={(e) => setPainProfile({...painProfile, consequenceOfInaction: e.target.value})}
                  placeholder="What happens if they don't solve this problem?"
                />
              </Grid>
            </Grid>
          </Box>
        );
      
      case 3:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>Stakeholder Map</Typography>
            
            {/* Existing Stakeholders */}
            {stakeholders.length > 0 && (
              <Box mb={3}>
                <Typography variant="subtitle1" gutterBottom>Current Stakeholders</Typography>
                {stakeholders.map((stakeholder, index) => (
                  <Card key={index} sx={{ mb: 2 }}>
                    <CardContent>
                      <Box display="flex" justifyContent="space-between" alignItems="center">
                        <Box>
                          <Typography variant="h6">{stakeholder.name}</Typography>
                          <Typography variant="body2" color="textSecondary">{stakeholder.title}</Typography>
                          <Box mt={1}>
                            <Chip label={stakeholder.role} size="small" sx={{ mr: 1 }} />
                            <Chip label={stakeholder.influence} size="small" sx={{ mr: 1 }} />
                            <Chip label={stakeholder.personality} size="small" />
                          </Box>
                        </Box>
                        <Button size="small" color="error" onClick={() => removeStakeholder(index)}>
                          Remove
                        </Button>
                      </Box>
                    </CardContent>
                  </Card>
                ))}
              </Box>
            )}
            
            {/* Add New Stakeholder */}
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle1" gutterBottom>Add New Stakeholder</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Name"
                  value={newStakeholder.name}
                  onChange={(e) => setNewStakeholder({...newStakeholder, name: e.target.value})}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Title"
                  value={newStakeholder.title}
                  onChange={(e) => setNewStakeholder({...newStakeholder, title: e.target.value})}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth>
                  <InputLabel>Role</InputLabel>
                  <Select
                    value={newStakeholder.role}
                    onChange={(e) => setNewStakeholder({...newStakeholder, role: e.target.value as any})}
                    label="Role"
                  >
                    <MenuItem value="decision_maker">Decision Maker</MenuItem>
                    <MenuItem value="recommender">Recommender</MenuItem>
                    <MenuItem value="observer">Observer</MenuItem>
                    <MenuItem value="blocker">Blocker</MenuItem>
                    <MenuItem value="champion">Champion</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth>
                  <InputLabel>Influence</InputLabel>
                  <Select
                    value={newStakeholder.influence}
                    onChange={(e) => setNewStakeholder({...newStakeholder, influence: e.target.value as any})}
                    label="Influence"
                  >
                    <MenuItem value="low">Low</MenuItem>
                    <MenuItem value="medium">Medium</MenuItem>
                    <MenuItem value="high">High</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={4}>
                <FormControl fullWidth>
                  <InputLabel>Personality</InputLabel>
                  <Select
                    value={newStakeholder.personality}
                    onChange={(e) => setNewStakeholder({...newStakeholder, personality: e.target.value as any})}
                    label="Personality"
                  >
                    <MenuItem value="dominant">Dominant</MenuItem>
                    <MenuItem value="analytical">Analytical</MenuItem>
                    <MenuItem value="amiable">Amiable</MenuItem>
                    <MenuItem value="expressive">Expressive</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  multiline
                  rows={2}
                  label="Notes"
                  value={newStakeholder.notes}
                  onChange={(e) => setNewStakeholder({...newStakeholder, notes: e.target.value})}
                />
              </Grid>
              <Grid item xs={12}>
                <Button variant="contained" onClick={addStakeholder} disabled={!newStakeholder.name || !newStakeholder.title}>
                  Add Stakeholder
                </Button>
              </Grid>
            </Grid>
          </Box>
        );
      
      case 4:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>Buying Process</Typography>
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={buyingProcess.hasFormalBid}
                      onChange={(e) => setBuyingProcess({...buyingProcess, hasFormalBid: e.target.checked})}
                    />
                  }
                  label="Formal Bid Process Required"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={buyingProcess.isCompetitive}
                      onChange={(e) => setBuyingProcess({...buyingProcess, isCompetitive: e.target.checked})}
                    />
                  }
                  label="Competitive Deal"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={buyingProcess.requiresLegalReview}
                      onChange={(e) => setBuyingProcess({...buyingProcess, requiresLegalReview: e.target.checked})}
                    />
                  }
                  label="Requires Legal Review"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={buyingProcess.requiresProcurement}
                      onChange={(e) => setBuyingProcess({...buyingProcess, requiresProcurement: e.target.checked})}
                    />
                  }
                  label="Requires Procurement"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={buyingProcess.requiresBackgroundChecks}
                      onChange={(e) => setBuyingProcess({...buyingProcess, requiresBackgroundChecks: e.target.checked})}
                    />
                  }
                  label="Requires Background Checks"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  type="number"
                  label="Estimated Timeline (Days)"
                  value={buyingProcess.estimatedTimeline}
                  onChange={(e) => setBuyingProcess({...buyingProcess, estimatedTimeline: parseInt(e.target.value) || 30})}
                />
              </Grid>
              <Grid item xs={12}>
                <Typography gutterBottom>Process Complexity (1-10)</Typography>
                <Slider
                  value={buyingProcess.processComplexityIndex}
                  onChange={(_, value) => setBuyingProcess({...buyingProcess, processComplexityIndex: value as number})}
                  min={1}
                  max={10}
                  marks
                  valueLabelDisplay="auto"
                />
              </Grid>
              <Grid item xs={12}>
                <Autocomplete
                  multiple
                  freeSolo
                  options={[]}
                  value={buyingProcess.competitors}
                  onChange={(_, newValue) => setBuyingProcess({...buyingProcess, competitors: newValue})}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Competitors"
                      placeholder="Add competitor names"
                    />
                  )}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip label={option} {...getTagProps({ index })} />
                    ))
                  }
                />
              </Grid>
            </Grid>
          </Box>
        );
      
      case 5:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>Implementation Path</Typography>
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth>
                  <InputLabel>Onboarding Model</InputLabel>
                  <Select
                    value={implementation.onboardingModel}
                    onChange={(e) => setImplementation({...implementation, onboardingModel: e.target.value as any})}
                    label="Onboarding Model"
                  >
                    <MenuItem value="centralized">Centralized</MenuItem>
                    <MenuItem value="site_based">Site-Based</MenuItem>
                    <MenuItem value="hybrid">Hybrid</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Operational POC"
                  value={implementation.operationalPOC}
                  onChange={(e) => setImplementation({...implementation, operationalPOC: e.target.value})}
                  placeholder="Who will be the operational point of contact?"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={implementation.requiresSiteVisits}
                      onChange={(e) => setImplementation({...implementation, requiresSiteVisits: e.target.checked})}
                    />
                  }
                  label="Requires Site Visits"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={implementation.requiresWalkthroughs}
                      onChange={(e) => setImplementation({...implementation, requiresWalkthroughs: e.target.checked})}
                    />
                  }
                  label="Requires Walkthroughs"
                />
              </Grid>
              <Grid item xs={12}>
                <Autocomplete
                  multiple
                  freeSolo
                  options={[]}
                  value={implementation.knownBlockers}
                  onChange={(_, newValue) => setImplementation({...implementation, knownBlockers: newValue})}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Known Blockers"
                      placeholder="Add potential blockers"
                    />
                  )}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip label={option} {...getTagProps({ index })} />
                    ))
                  }
                />
              </Grid>
            </Grid>
          </Box>
        );
      
      case 6:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>Competitive Landscape</Typography>
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Current Vendor"
                  value={competitiveLandscape.currentVendor}
                  onChange={(e) => setCompetitiveLandscape({...competitiveLandscape, currentVendor: e.target.value})}
                  placeholder="Who is their current vendor?"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={competitiveLandscape.hasWorkedWithC1}
                      onChange={(e) => setCompetitiveLandscape({...competitiveLandscape, hasWorkedWithC1: e.target.checked})}
                    />
                  }
                  label="Has Worked with C1 Before"
                />
              </Grid>
              <Grid item xs={12}>
                <Autocomplete
                  multiple
                  freeSolo
                  options={[]}
                  value={competitiveLandscape.vendorLikes}
                  onChange={(_, newValue) => setCompetitiveLandscape({...competitiveLandscape, vendorLikes: newValue})}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="What They Like About Current Vendor"
                      placeholder="Add vendor strengths"
                    />
                  )}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip label={option} {...getTagProps({ index })} />
                    ))
                  }
                />
              </Grid>
              <Grid item xs={12}>
                <Autocomplete
                  multiple
                  freeSolo
                  options={[]}
                  value={competitiveLandscape.vendorDislikes}
                  onChange={(_, newValue) => setCompetitiveLandscape({...competitiveLandscape, vendorDislikes: newValue})}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="What They Dislike About Current Vendor"
                      placeholder="Add vendor weaknesses"
                    />
                  )}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip label={option} {...getTagProps({ index })} />
                    ))
                  }
                />
              </Grid>
              <Grid item xs={12}>
                <Autocomplete
                  multiple
                  freeSolo
                  options={[]}
                  value={competitiveLandscape.internalRelationships}
                  onChange={(_, newValue) => setCompetitiveLandscape({...competitiveLandscape, internalRelationships: newValue})}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Internal Relationships"
                      placeholder="Add key internal relationships"
                    />
                  )}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip label={option} {...getTagProps({ index })} />
                    ))
                  }
                />
              </Grid>
            </Grid>
          </Box>
        );
      
      case 7:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>Forecast & Value</Typography>
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  type="number"
                  label="Estimated Headcount"
                  value={forecast.estimatedHeadcount}
                  onChange={(e) => setForecast({...forecast, estimatedHeadcount: parseInt(e.target.value) || 0})}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  type="number"
                  label="Estimated Bill Rate ($/hr)"
                  value={forecast.estimatedBillRate}
                  onChange={(e) => setForecast({...forecast, estimatedBillRate: parseFloat(e.target.value) || 0})}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  type="number"
                  label="Gross Profit per Month ($)"
                  value={forecast.grossProfitPerMonth}
                  onChange={(e) => setForecast({...forecast, grossProfitPerMonth: parseFloat(e.target.value) || 0})}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  type="number"
                  label="Total Deal Value ($)"
                  value={forecast.dealValue}
                  onChange={(e) => setForecast({...forecast, dealValue: parseFloat(e.target.value) || 0})}
                />
              </Grid>
              <Grid item xs={12}>
                <Typography gutterBottom>Effort to Reward Ratio (1-10)</Typography>
                <Slider
                  value={forecast.effortToRewardRatio}
                  onChange={(_, value) => setForecast({...forecast, effortToRewardRatio: value as number})}
                  min={1}
                  max={10}
                  marks
                  valueLabelDisplay="auto"
                />
              </Grid>
              <Grid item xs={12}>
                <Autocomplete
                  multiple
                  freeSolo
                  options={[]}
                  value={forecast.expansionOpportunities}
                  onChange={(_, newValue) => setForecast({...forecast, expansionOpportunities: newValue})}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Expansion Opportunities"
                      placeholder="Add potential expansion areas"
                    />
                  )}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip label={option} {...getTagProps({ index })} />
                    ))
                  }
                />
              </Grid>
            </Grid>
          </Box>
        );
      
      default:
        return null;
    }
  };

  if (!open) return null;

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        bgcolor: 'rgba(0,0,0,0.5)',
        zIndex: 1300,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 2
      }}
    >
      <Paper
        sx={{
          width: '100%',
          maxWidth: 1200,
          maxHeight: '90vh',
          overflow: 'auto',
          p: 3
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h4">
            Deal Intelligence Wizard {deal?.id ? '(Edit Mode)' : '(Create Mode)'}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" color="primary">
              🤖 AI-Powered
            </Typography>
            <Chip 
              label="Real-time Analysis" 
              size="small" 
              color="primary" 
              variant="outlined"
            />
          </Box>
        </Box>
        
        <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
        
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        
        <Box sx={{ mb: 4 }}>
          {renderStepContent(activeStep)}
        </Box>
        
        {/* AI Analysis Summary */}
        {activeStep === steps.length - 1 && (
          <Box sx={{ mb: 4 }}>
            <Typography variant="h6" gutterBottom color="primary">
              🤖 AI Analysis Summary
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="subtitle2" color="primary" gutterBottom>
                      Deal Complexity Score
                    </Typography>
                    <Typography variant="h4" color="primary">
                      {calculateComplexityScore({
                        companyContext,
                        painProfile,
                        stakeholders,
                        buyingProcess,
                        implementation,
                        competitiveLandscape,
                        forecast,
                        aiAnalysis: { summary: '', riskLevel: 'medium', nextSteps: [], confidenceLevel: 50, recommendedCadence: '', stakeholderStrategy: '', timelineForecast: '', heatmapRisks: { timeline: 'medium', political: 'medium', legal: 'medium', competitive: 'medium' } },
                        createdAt: new Date(),
                        updatedAt: new Date()
                      })}/10
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Based on company size, stakeholders, buying process, and implementation complexity
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={6}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="subtitle2" color="primary" gutterBottom>
                      Key Insights
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Typography variant="body2">
                        📊 <strong>Stakeholders:</strong> {stakeholders.length} mapped
                      </Typography>
                      <Typography variant="body2">
                        ⏰ <strong>Urgency:</strong> {painProfile.urgency}
                      </Typography>
                      <Typography variant="body2">
                        💰 <strong>Value:</strong> ${forecast.dealValue?.toLocaleString() || '0'}
                      </Typography>
                      <Typography variant="body2">
                        🎯 <strong>Effort/Reward:</strong> {forecast.effortToRewardRatio}/10
                      </Typography>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </Box>
        )}
        
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Button
            disabled={activeStep === 0}
            onClick={handleBack}
          >
            Back
          </Button>
          
          <Box>
            <Button onClick={onClose} sx={{ mr: 1 }}>
              Cancel
            </Button>
            
            {activeStep === steps.length - 1 ? (
              <Button
                variant="contained"
                onClick={handleSaveDeal}
                disabled={loading}
              >
                {loading ? <CircularProgress size={20} /> : (deal?.id ? 'Update Deal' : 'Create Deal')}
              </Button>
            ) : (
              <Button
                variant="contained"
                onClick={handleNext}
              >
                Next
              </Button>
            )}
          </Box>
        </Box>
      </Paper>
    </Box>
  );
};

export default DealIntelligenceWizard; 