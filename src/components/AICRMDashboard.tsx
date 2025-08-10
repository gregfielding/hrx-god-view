import React, { useState, useEffect } from 'react';
import {
  Box,
  Grid,
  Card,
  CardContent,
  CardHeader,
  Typography,
  Button,
  Chip,
  Avatar,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  ListItemSecondaryAction,
  IconButton,
  LinearProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tooltip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import {
  TrendingUp as TrendingUpIcon,
  AttachMoney as MoneyIcon,
  People as PeopleIcon,
  Business as BusinessIcon,
  Assignment as DealIcon,
  Psychology as PsychologyIcon,
  Assessment as RiskIcon,
  CheckCircle as CheckIcon,
  Warning as WarningIcon,
  Info as InfoIcon,
  Add as AddIcon,
  Visibility as ViewIcon,
  Lightbulb as InsightIcon,
  Analytics as AnalyticsIcon,
} from '@mui/icons-material';
import { collection, onSnapshot } from 'firebase/firestore';

import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { 
  CRMDeal, 
  CRMContact, 
  CRMCompany, 
  DealIntelligenceProfile,
  CRMDashboardMetrics,
  AIDealInsight,
  AITaskSuggestion 
} from '../types/CRM';

import DealIntelligenceWizard from './DealIntelligenceWizard';
import StageChip from './StageChip';

const AICRMDashboard: React.FC = () => {
  const { tenantId, user } = useAuth();
  const [metrics, setMetrics] = useState<CRMDashboardMetrics>({
    totalContacts: 0,
    totalCompanies: 0,
    totalDeals: 0,
    totalPipelineValue: 0,
    averageDealSize: 0,
    winRate: 0,
    averageSalesCycle: 0,
    topDeals: [],
    recentActivity: [],
  });
  const [deals, setDeals] = useState<CRMDeal[]>([]);
  const [contacts, setContacts] = useState<CRMContact[]>([]);
  const [companies, setCompanies] = useState<CRMCompany[]>([]);
  const [aiInsights, setAiInsights] = useState<AIDealInsight[]>([]);
  const [taskSuggestions, setTaskSuggestions] = useState<AITaskSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDeal, setSelectedDeal] = useState<CRMDeal | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [showInsightDialog, setShowInsightDialog] = useState(false);
  const [selectedInsight, setSelectedInsight] = useState<AIDealInsight | null>(null);

  // Real-time data listeners
  useEffect(() => {
    if (!tenantId) return;

    const dealsRef = collection(db, 'tenants', tenantId, 'crm_deals');
    const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
    const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');

    const dealsUnsubscribe = onSnapshot(dealsRef, (snapshot) => {
      const dealsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CRMDeal));
      setDeals(dealsData);
      calculateMetrics(dealsData, contacts, companies);
    });

    const contactsUnsubscribe = onSnapshot(contactsRef, (snapshot) => {
      const contactsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CRMContact));
      setContacts(contactsData);
      calculateMetrics(deals, contactsData, companies);
    });

    const companiesUnsubscribe = onSnapshot(companiesRef, (snapshot) => {
      const companiesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CRMCompany));
      setCompanies(companiesData);
      calculateMetrics(deals, contacts, companiesData);
    });

    setLoading(false);

    return () => {
      dealsUnsubscribe();
      contactsUnsubscribe();
      companiesUnsubscribe();
    };
  }, [tenantId]);

  const calculateMetrics = (dealsData: CRMDeal[], contactsData: CRMContact[], companiesData: CRMCompany[]) => {
    const totalPipelineValue = dealsData.reduce((sum, deal) => sum + (deal.estimatedRevenue || 0), 0);
    const activeDeals = dealsData.filter(d => d.stage !== 'closed-won' && d.stage !== 'closed-lost');
    const averageDealSize = activeDeals.length > 0 ? totalPipelineValue / activeDeals.length : 0;
    
    const closedWon = dealsData.filter(d => d.stage === 'closed-won').length;
    const closedLost = dealsData.filter(d => d.stage === 'closed-lost').length;
    const winRate = (closedWon + closedLost) > 0 ? (closedWon / (closedWon + closedLost)) * 100 : 0;

    // Top deals by value
    const topDeals = dealsData
      .filter(d => d.stage !== 'closed-lost')
      .sort((a, b) => (b.estimatedRevenue || 0) - (a.estimatedRevenue || 0))
      .slice(0, 5);

    setMetrics({
      totalContacts: contactsData.length,
      totalCompanies: companiesData.length,
      totalDeals: dealsData.length,
      totalPipelineValue,
      averageDealSize,
      winRate,
      averageSalesCycle: 45, // Placeholder - would calculate from actual data
      topDeals,
      recentActivity: [], // Would populate from activity logs
    });
  };

  const generateAIInsights = async () => {
    // Simulate AI insights generation
    const insights: AIDealInsight[] = deals
      .filter(deal => !deal.dealProfile)
      .map(deal => ({
        id: `insight-${deal.id}`,
        dealId: deal.id,
        type: 'recommendation',
        title: 'Complete Deal Intelligence Profile',
        description: `Deal "${deal.name}" lacks detailed intelligence data. Complete the wizard to get AI-powered insights.`,
        severity: 'medium',
        category: 'stakeholder',
        actionable: true,
        actionItems: ['Open Deal Intelligence Wizard'],
        createdAt: new Date(),
      }));

    // Add risk insights for deals with profiles
    deals
      .filter(deal => deal.dealProfile)
      .forEach(deal => {
        const profile = deal.dealProfile!;
        if (profile.aiAnalysis.riskLevel === 'high') {
          insights.push({
            id: `risk-${deal.id}`,
            dealId: deal.id,
            type: 'risk',
            title: 'High Risk Deal Detected',
            description: `Deal "${deal.name}" has multiple risk factors that need attention.`,
            severity: 'high',
            category: 'timeline',
            actionable: true,
            actionItems: ['Review risk factors', 'Schedule stakeholder meeting'],
            createdAt: new Date(),
          });
        }
      });

    setAiInsights(insights);
  };

  const generateTaskSuggestions = async () => {
    const suggestions: AITaskSuggestion[] = [];

    deals.forEach(deal => {
      if (deal.dealProfile) {
        const profile = deal.dealProfile;
        
        // Suggest follow-up tasks based on deal stage and AI analysis
        if (profile.aiAnalysis.nextSteps.length > 0) {
          suggestions.push({
            id: `task-${deal.id}-1`,
            dealId: deal.id,
            type: 'call',
            title: profile.aiAnalysis.nextSteps[0],
            description: `AI-recommended next step for deal "${deal.name}"`,
            priority: profile.aiAnalysis.riskLevel === 'high' ? 'high' : 'medium',
            suggestedDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Tomorrow
            assignedTo: user?.uid || '',
            reason: 'AI recommendation based on deal intelligence',
            isAccepted: false,
            createdAt: new Date(),
          });
        }
      }
    });

    setTaskSuggestions(suggestions);
  };

  useEffect(() => {
    generateAIInsights();
    generateTaskSuggestions();
  }, [deals]);

  const getRiskColor = (riskLevel: string) => {
    switch (riskLevel) {
      case 'high': return 'error';
      case 'medium': return 'warning';
      case 'low': return 'success';
      default: return 'default';
    }
  };

  const getInsightIcon = (type: string) => {
    switch (type) {
      case 'risk': return <RiskIcon />;
      case 'opportunity': return <TrendingUpIcon />;
      case 'recommendation': return <InsightIcon />;
      case 'warning': return <WarningIcon />;
      default: return <InfoIcon />;
    }
  };

  const handleWizardComplete = (profile: DealIntelligenceProfile) => {
    console.log('Deal Intelligence Profile completed:', profile);
    // Refresh insights after wizard completion
    generateAIInsights();
  };

  const handleInsightClick = (insight: AIDealInsight) => {
    setSelectedInsight(insight);
    setShowInsightDialog(true);
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <LinearProgress sx={{ width: '100%' }} />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" fontWeight="bold">
          AI-Powered CRM Dashboard
        </Typography>
        <Button
          variant="contained"
          startIcon={<PsychologyIcon />}
          onClick={() => setShowWizard(true)}
        >
          Deal Intelligence Wizard
        </Button>
      </Box>

      {/* Key Metrics */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Avatar sx={{ bgcolor: 'primary.main' }}>
                  <MoneyIcon />
                </Avatar>
                <Box>
                  <Typography variant="h4" fontWeight="bold">
                    ${metrics.totalPipelineValue.toLocaleString()}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Total Pipeline Value
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Avatar sx={{ bgcolor: 'success.main' }}>
                  <DealIcon />
                </Avatar>
                <Box>
                  <Typography variant="h4" fontWeight="bold">
                    {metrics.totalDeals}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Active Deals
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Avatar sx={{ bgcolor: 'info.main' }}>
                  <PeopleIcon />
                </Avatar>
                <Box>
                  <Typography variant="h4" fontWeight="bold">
                    {metrics.totalContacts}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Total Contacts
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Avatar sx={{ bgcolor: 'warning.main' }}>
                  <BusinessIcon />
                </Avatar>
                <Box>
                  <Typography variant="h4" fontWeight="bold">
                    {metrics.totalCompanies}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Total Companies
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* AI Insights and Recommendations */}
      <Grid container spacing={3}>
        <Grid item xs={12} md={8}>
          <Card>
            <CardHeader
              title="AI Insights & Recommendations"
              action={
                <IconButton>
                  <AnalyticsIcon />
                </IconButton>
              }
            />
            <CardContent>
              {aiInsights.length === 0 ? (
                <Alert severity="info">
                  No AI insights available. Complete Deal Intelligence profiles to get personalized recommendations.
                </Alert>
              ) : (
                <List>
                  {aiInsights.slice(0, 5).map((insight) => (
                    <ListItem
                      key={insight.id}
                      button
                      onClick={() => handleInsightClick(insight)}
                      sx={{ mb: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}
                    >
                      <ListItemAvatar>
                        <Avatar sx={{ bgcolor: `${getRiskColor(insight.severity)}.main` }}>
                          {getInsightIcon(insight.type)}
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={insight.title}
                        secondary={insight.description}
                      />
                      <ListItemSecondaryAction>
                        <Chip
                          label={insight.severity}
                          color={getRiskColor(insight.severity)}
                          size="small"
                        />
                      </ListItemSecondaryAction>
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card>
            <CardHeader title="AI Task Suggestions" />
            <CardContent>
              {taskSuggestions.length === 0 ? (
                <Alert severity="info">
                  No task suggestions available. Complete Deal Intelligence profiles to get AI recommendations.
                </Alert>
              ) : (
                <List>
                  {taskSuggestions.slice(0, 3).map((task) => (
                    <ListItem key={task.id} sx={{ mb: 1 }}>
                      <ListItemText
                        primary={task.title}
                        secondary={`${task.type} - ${task.suggestedDate}`}
                      />
                      <ListItemSecondaryAction>
                        <Chip
                          label={task.priority}
                          color={task.priority === 'high' ? 'error' : 'default'}
                          size="small"
                        />
                      </ListItemSecondaryAction>
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Top Deals with Intelligence */}
      <Card sx={{ mt: 3 }}>
        <CardHeader
          title="Top Deals with AI Intelligence"
          action={
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => setShowWizard(true)}
            >
              Add Intelligence
            </Button>
          }
        />
        <CardContent>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Deal Name</TableCell>
                  <TableCell>Company</TableCell>
                  <TableCell>Value</TableCell>
                  <TableCell>Stage</TableCell>
                  <TableCell>AI Intelligence</TableCell>
                  <TableCell>Risk Level</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {metrics.topDeals.map((deal) => {
                  const company = companies.find(c => c.id === deal.companyId);
                  const hasIntelligence = !!deal.dealProfile;
                  
                  return (
                    <TableRow key={deal.id}>
                      <TableCell>
                        <Typography variant="body2" fontWeight="medium">
                          {deal.name}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {company?.companyName || 'Unknown'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight="medium">
                          ${deal.estimatedRevenue?.toLocaleString() || 0}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <StageChip
                          stage={deal.stage}
                          size="small"
                          useCustomColors={true}
                        />
                      </TableCell>
                      <TableCell>
                        {hasIntelligence ? (
                          <Chip
                            icon={<CheckIcon />}
                            label="Complete"
                            color="success"
                            size="small"
                          />
                        ) : (
                          <Chip
                            icon={<WarningIcon />}
                            label="Incomplete"
                            color="warning"
                            size="small"
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        {hasIntelligence && deal.dealProfile?.aiAnalysis.riskLevel && (
                          <Chip
                            label={deal.dealProfile.aiAnalysis.riskLevel}
                            color={getRiskColor(deal.dealProfile.aiAnalysis.riskLevel)}
                            size="small"
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <Tooltip title="View Deal">
                            <IconButton size="small">
                              <ViewIcon />
                            </IconButton>
                          </Tooltip>
                          {!hasIntelligence && (
                            <Tooltip title="Add Intelligence">
                              <IconButton
                                size="small"
                                onClick={() => {
                                  setSelectedDeal(deal);
                                  setShowWizard(true);
                                }}
                              >
                                <PsychologyIcon />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Box>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Deal Intelligence Wizard */}
      {selectedDeal && (
        <DealIntelligenceWizard
          open={showWizard}
          onClose={() => setShowWizard(false)}
          onSuccess={(dealId) => {
            console.log('Deal Intelligence Wizard completed for deal:', dealId);
            // Refresh insights after wizard completion
            generateAIInsights();
          }}
          deal={selectedDeal}
          onComplete={handleWizardComplete}
        />
      )}

      {/* Insight Detail Dialog */}
      <Dialog open={showInsightDialog} onClose={() => setShowInsightDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {selectedInsight && getInsightIcon(selectedInsight.type)}
            <Typography variant="h6">
              {selectedInsight?.title}
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          {selectedInsight && (
            <Box>
              <Typography variant="body1" sx={{ mb: 2 }}>
                {selectedInsight.description}
              </Typography>
              
              <Typography variant="h6" sx={{ mb: 1 }}>
                Action Items:
              </Typography>
              <List>
                {selectedInsight.actionItems.map((item, index) => (
                  <ListItem key={index}>
                    <ListItemText primary={item} />
                  </ListItem>
                ))}
              </List>
              
              <Box sx={{ mt: 2 }}>
                <Chip
                  label={`Severity: ${selectedInsight.severity}`}
                  color={getRiskColor(selectedInsight.severity)}
                  sx={{ mr: 1 }}
                />
                <Chip
                  label={`Category: ${selectedInsight.category}`}
                  variant="outlined"
                />
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowInsightDialog(false)}>
            Close
          </Button>
          {selectedInsight?.actionable && (
            <Button variant="contained">
              Take Action
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AICRMDashboard; 