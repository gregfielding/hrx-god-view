import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Card,
  CardContent,
  CardHeader,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  ListItemSecondaryAction,
  Avatar,
  Alert,
  CircularProgress,
  LinearProgress,
  Switch,
  FormControlLabel,
  Autocomplete,
} from '@mui/material';
import {
  Email as EmailIcon,
  Send as SendIcon,
  ContentCopy as CopyIcon,
  SmartToy as AIIcon,
} from '@mui/icons-material';
import { collection, query, where, getDocs } from 'firebase/firestore';

import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { 
  CRMDeal, 
  CRMContact, 
  CRMCompany, 
  DealIntelligenceProfile,
  DealStakeholder,
  AIEmailDraft 
} from '../types/CRM';

interface AIEmailAssistantProps {
  open: boolean;
  onClose: () => void;
  deal?: CRMDeal;
  stakeholder?: DealStakeholder;
  onSend?: (emailData: any) => void;
}

interface EmailTemplate {
  id: string;
  name: string;
  type: 'intro' | 'follow_up' | 'proposal' | 'closing';
  subject: string;
  body: string;
  tone: 'professional' | 'friendly' | 'urgent' | 'casual';
  variables: string[];
}

const AIEmailAssistant: React.FC<AIEmailAssistantProps> = ({
  open,
  onClose,
  deal,
  stakeholder,
  onSend,
}) => {
  const { tenantId, user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [emailData, setEmailData] = useState({
    to: '',
    subject: '',
    body: '',
    tone: 'professional' as 'professional' | 'friendly' | 'urgent' | 'casual',
    type: 'intro' as 'intro' | 'follow_up' | 'proposal' | 'closing',
    includePersonalization: true,
    includeCallToAction: true,
    suggestedSendTime: '',
  });
  const [dealProfile, setDealProfile] = useState<DealIntelligenceProfile | null>(null);
  const [company, setCompany] = useState<CRMCompany | null>(null);
  const [availableContacts, setAvailableContacts] = useState<CRMContact[]>([]);
  const [selectedContact, setSelectedContact] = useState<CRMContact | null>(null);
  const [generatedDrafts, setGeneratedDrafts] = useState<AIEmailDraft[]>([]);
  const [selectedDraft, setSelectedDraft] = useState<AIEmailDraft | null>(null);

  // Email templates
  const emailTemplates: EmailTemplate[] = [
    {
      id: 'intro',
      name: 'Introduction Email',
      type: 'intro',
      subject: 'Introduction - [Company Name] Staffing Solutions',
      body: `Hi [Stakeholder Name],

I hope this email finds you well. I'm reaching out because I understand [Company Name] is experiencing [Pain Point] and I believe our staffing solutions could help address this challenge.

Based on my research, [Company Name] is a [Size] company in the [Industry] sector, and I've helped similar organizations overcome [Pain Point] through our flexible workforce solutions.

Would you be available for a brief 15-minute call next week to discuss how we might be able to support [Company Name]'s staffing needs?

Best regards,
[Your Name]`,
      tone: 'professional',
      variables: ['Stakeholder Name', 'Company Name', 'Pain Point', 'Size', 'Industry', 'Your Name'],
    },
    {
      id: 'follow_up',
      name: 'Follow-up Email',
      type: 'follow_up',
      subject: 'Following up - [Company Name] Staffing Discussion',
      body: `Hi [Stakeholder Name],

I wanted to follow up on our recent conversation about [Company Name]'s staffing needs. I've been thinking about the [Pain Point] you mentioned and wanted to share some additional insights.

[Personalized insight based on deal intelligence]

I'd love to schedule a more detailed discussion to explore how our solutions could specifically address [Company Name]'s unique challenges. Would [Suggested Time] work for you?

Looking forward to our next conversation.

Best regards,
[Your Name]`,
      tone: 'friendly',
      variables: ['Stakeholder Name', 'Company Name', 'Pain Point', 'Suggested Time', 'Your Name'],
    },
    {
      id: 'proposal',
      name: 'Proposal Email',
      type: 'proposal',
      subject: 'Proposal - [Company Name] Staffing Solution',
      body: `Hi [Stakeholder Name],

Thank you for the opportunity to propose a staffing solution for [Company Name]. Based on our discussions and understanding of your [Pain Point], I've prepared a comprehensive proposal that addresses your specific needs.

Key highlights of our proposed solution:
• [Solution Point 1]
• [Solution Point 2]
• [Solution Point 3]

I've attached the detailed proposal for your review. I'm available to walk through any questions you may have and discuss next steps.

When would be a good time to discuss this proposal in detail?

Best regards,
[Your Name]`,
      tone: 'professional',
      variables: ['Stakeholder Name', 'Company Name', 'Pain Point', 'Solution Point 1', 'Solution Point 2', 'Solution Point 3', 'Your Name'],
    },
  ];

  useEffect(() => {
    if (open && deal) {
      loadDealData();
    }
  }, [open, deal]);

  const loadDealData = async () => {
    if (!deal) return;

    setLoading(true);
    try {
      // Load deal profile
      if (deal.dealProfile) {
        setDealProfile(deal.dealProfile);
      }

      // Load company data
      if (!tenantId) throw new Error('Missing tenantId');
      const companiesRef = collection(db, 'tenants', tenantId as string, 'crm_companies');
      const companyQuery = query(companiesRef, where('__name__', '==', deal.companyId));
      const companySnapshot = await getDocs(companyQuery);
      if (!companySnapshot.empty) {
        setCompany({ id: companySnapshot.docs[0].id, ...companySnapshot.docs[0].data() } as CRMCompany);
      }

      // Load contacts
      const contactsRef = collection(db, 'tenants', tenantId as string, 'crm_contacts');
      const contactsQuery = query(contactsRef, where('companyId', '==', deal.companyId));
      const contactsSnapshot = await getDocs(contactsQuery);
      const contactsData = contactsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CRMContact));
      setAvailableContacts(contactsData);

      // Set default recipient if stakeholder is provided
      if (stakeholder) {
        const matchingContact = contactsData.find(c => 
          c.fullName.toLowerCase().includes(stakeholder.name.toLowerCase()) ||
          c.title.toLowerCase().includes(stakeholder.title.toLowerCase())
        );
        if (matchingContact) {
          setSelectedContact(matchingContact);
          setEmailData(prev => ({ ...prev, to: matchingContact.email }));
        }
      }
    } catch (error) {
      console.error('Error loading deal data:', error);
    } finally {
      setLoading(false);
    }
  };

  const generatePersonalizedEmail = async () => {
    if (!dealProfile || !company || !selectedContact) {
      alert('Please ensure deal intelligence profile, company, and contact are loaded.');
      return;
    }

    setGenerating(true);
    try {
      // Simulate AI email generation
      await new Promise(resolve => setTimeout(resolve, 2000));

      const template = emailTemplates.find(t => t.type === emailData.type) || emailTemplates[0];
      
      let personalizedBody = template.body;
      let personalizedSubject = template.subject;

      // Replace variables with actual data
      const replacements = {
        '[Stakeholder Name]': selectedContact.fullName,
        '[Company Name]': company.companyName,
        '[Pain Point]': dealProfile.painProfile.corePain,
        '[Size]': dealProfile.companyContext.size,
        '[Industry]': company.industry || 'your industry',
        '[Your Name]': user?.displayName || 'Your Name',
        '[Suggested Time]': emailData.suggestedSendTime || 'next week',
        '[Solution Point 1]': 'Flexible staffing solutions tailored to your needs',
        '[Solution Point 2]': 'Proven track record in your industry',
        '[Solution Point 3]': 'Comprehensive onboarding and support',
      };

      Object.entries(replacements).forEach(([placeholder, value]) => {
        personalizedBody = personalizedBody.replace(new RegExp(placeholder, 'g'), value);
        personalizedSubject = personalizedSubject.replace(new RegExp(placeholder, 'g'), value);
      });

      // Add AI-generated insights if enabled
      if (emailData.includePersonalization) {
        const insight = generatePersonalizedInsight();
        if (insight) {
          personalizedBody = personalizedBody.replace(
            '[Personalized insight based on deal intelligence]',
            insight
          );
        }
      }

      // Add call-to-action if enabled
      if (emailData.includeCallToAction) {
        const cta = generateCallToAction();
        personalizedBody += `\n\n${cta}`;
      }

      const draft: AIEmailDraft = {
        id: `draft-${Date.now()}`,
        dealId: deal!.id,
        stakeholderId: stakeholder?.name || selectedContact.id,
        type: emailData.type,
        subject: personalizedSubject,
        body: personalizedBody,
        tone: emailData.tone,
        suggestedSendTime: emailData.suggestedSendTime,
        isGenerated: true,
        createdAt: new Date(),
      };

      setGeneratedDrafts(prev => [draft, ...prev]);
      setSelectedDraft(draft);
      setEmailData(prev => ({
        ...prev,
        subject: personalizedSubject,
        body: personalizedBody,
      }));

    } catch (error) {
      console.error('Error generating email:', error);
    } finally {
      setGenerating(false);
    }
  };

  const generatePersonalizedInsight = (): string => {
    if (!dealProfile) return '';

    const insights = [
      `Based on my experience with similar ${dealProfile.companyContext.size} companies in the ${company?.industry || 'industry'}, organizations facing ${dealProfile.painProfile.corePain} typically see 30-40% improvement in efficiency within the first 90 days.`,
      `I noticed that ${dealProfile.painProfile.urgency === 'high' ? 'the urgency of your situation' : 'your current challenges'} aligns with what we've successfully addressed for other companies in your sector.`,
      `Given ${dealProfile.companyContext.workforceModel === 'flex' ? 'your experience with flexible staffing' : 'your current workforce model'}, I believe our approach would integrate seamlessly with your existing processes.`,
    ];

    return insights[Math.floor(Math.random() * insights.length)];
  };

  const generateCallToAction = (): string => {
    const ctas = [
      "I'd love to schedule a 15-minute call to discuss how we can help [Company Name] overcome these challenges. Would you be available for a brief conversation?",
      "Let's set up a time to explore how our solutions can address [Company Name]'s specific needs. When would work best for you?",
      "I'm confident we can help [Company Name] achieve better results. Would you be open to a quick discussion about next steps?",
    ];

    return ctas[Math.floor(Math.random() * ctas.length)];
  };

  const handleSendEmail = () => {
    if (onSend) {
      onSend({
        ...emailData,
        dealId: deal?.id,
        stakeholderId: stakeholder?.name || selectedContact?.id,
        generatedDraft: selectedDraft,
      });
    }
    onClose();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const getToneColor = (tone: string) => {
    switch (tone) {
      case 'professional': return 'primary';
      case 'friendly': return 'success';
      case 'urgent': return 'error';
      case 'casual': return 'warning';
      default: return 'default';
    }
  };

  if (loading) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
        <DialogContent>
          <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
            <CircularProgress />
          </Box>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <AIIcon color="primary" />
          <Typography variant="h6">AI Email Assistant</Typography>
          {deal && (
            <Chip label={deal.name} color="primary" size="small" />
          )}
        </Box>
      </DialogTitle>

      <DialogContent>
        <Grid container spacing={3}>
          {/* Email Configuration */}
          <Grid item xs={12} md={4}>
            <Card>
              <CardHeader title="Email Configuration" />
              <CardContent>
                <Grid container spacing={2}>
                  <Grid item xs={12}>
                    <FormControl fullWidth>
                      <InputLabel>Email Type</InputLabel>
                      <Select
                        value={emailData.type}
                        onChange={(e) => setEmailData(prev => ({ ...prev, type: e.target.value as any }))}
                        label="Email Type"
                      >
                        {emailTemplates.map(template => (
                          <MenuItem key={template.id} value={template.type}>
                            {template.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>

                  <Grid item xs={12}>
                    <FormControl fullWidth>
                      <InputLabel>Tone</InputLabel>
                      <Select
                        value={emailData.tone}
                        onChange={(e) => setEmailData(prev => ({ ...prev, tone: e.target.value as any }))}
                        label="Tone"
                      >
                        <MenuItem value="professional">Professional</MenuItem>
                        <MenuItem value="friendly">Friendly</MenuItem>
                        <MenuItem value="urgent">Urgent</MenuItem>
                        <MenuItem value="casual">Casual</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>

                  <Grid item xs={12}>
                    <Autocomplete
                      options={availableContacts}
                      getOptionLabel={(contact) => `${contact.fullName} - ${contact.title}`}
                      value={selectedContact}
                      onChange={(_, newValue) => {
                        setSelectedContact(newValue);
                        setEmailData(prev => ({ ...prev, to: newValue?.email || '' }));
                      }}
                      renderInput={(params) => (
                        <TextField
                          {...(params as any)}
                          label="Recipient"
                          placeholder="Select contact..."
                          size="small"
                        />
                      )}
                    />
                  </Grid>

                  <Grid item xs={12}>
                    <TextField
                      fullWidth
                      label="Suggested Send Time"
                      value={emailData.suggestedSendTime}
                      onChange={(e) => setEmailData(prev => ({ ...prev, suggestedSendTime: e.target.value }))}
                      placeholder="e.g., Tuesday 2 PM"
                    />
                  </Grid>

                  <Grid item xs={12}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={emailData.includePersonalization}
                          onChange={(e) => setEmailData(prev => ({ ...prev, includePersonalization: e.target.checked }))}
                        />
                      }
                      label="Include AI Personalization"
                    />
                  </Grid>

                  <Grid item xs={12}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={emailData.includeCallToAction}
                          onChange={(e) => setEmailData(prev => ({ ...prev, includeCallToAction: e.target.checked }))}
                        />
                      }
                      label="Include Call-to-Action"
                    />
                  </Grid>

                  <Grid item xs={12}>
                    <Button
                      fullWidth
                      variant="contained"
                      startIcon={generating ? <CircularProgress size={16} /> : <AIIcon />}
                      onClick={generatePersonalizedEmail}
                      disabled={generating || !selectedContact}
                    >
                      {generating ? 'Generating...' : 'Generate AI Email'}
                    </Button>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>

            {/* Deal Intelligence Summary */}
            {dealProfile && (
              <Card sx={{ mt: 2 }}>
                <CardHeader title="Deal Intelligence" />
                <CardContent>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    <strong>Pain Point:</strong> {dealProfile.painProfile.corePain}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    <strong>Urgency:</strong> 
                    <Chip 
                      label={dealProfile.painProfile.urgency} 
                      size="small" 
                      color={dealProfile.painProfile.urgency === 'high' ? 'error' : 'default'}
                      sx={{ ml: 1 }}
                    />
                  </Typography>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    <strong>Risk Level:</strong>
                    <Chip 
                      label={dealProfile.aiAnalysis.riskLevel} 
                      size="small" 
                      color={getToneColor(dealProfile.aiAnalysis.riskLevel)}
                      sx={{ ml: 1 }}
                    />
                  </Typography>
                </CardContent>
              </Card>
            )}
          </Grid>

          {/* Email Preview */}
          <Grid item xs={12} md={8}>
            <Card>
              <CardHeader 
                title="Email Preview"
                action={
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <IconButton onClick={() => copyToClipboard(emailData.body)}>
                      <CopyIcon />
                    </IconButton>
                    <IconButton onClick={() => copyToClipboard(emailData.subject)}>
                      <CopyIcon />
                    </IconButton>
                  </Box>
                }
              />
              <CardContent>
                <TextField
                  fullWidth
                  label="To"
                  value={emailData.to}
                  onChange={(e) => setEmailData(prev => ({ ...prev, to: e.target.value }))}
                  sx={{ mb: 2 }}
                />
                
                <TextField
                  fullWidth
                  label="Subject"
                  value={emailData.subject}
                  onChange={(e) => setEmailData(prev => ({ ...prev, subject: e.target.value }))}
                  sx={{ mb: 2 }}
                />
                
                <TextField
                  fullWidth
                  multiline
                  rows={15}
                  label="Email Body"
                  value={emailData.body}
                  onChange={(e) => setEmailData(prev => ({ ...prev, body: e.target.value }))}
                  sx={{ mb: 2 }}
                />

                {generating && (
                  <Box sx={{ mt: 2 }}>
                    <LinearProgress />
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      AI is generating personalized content...
                    </Typography>
                  </Box>
                )}

                {selectedDraft && (
                  <Alert severity="success" sx={{ mt: 2 }}>
                    <Typography variant="body2">
                      AI-generated email ready! Review and customize as needed.
                    </Typography>
                  </Alert>
                )}
              </CardContent>
            </Card>

            {/* Generated Drafts History */}
            {generatedDrafts.length > 0 && (
              <Card sx={{ mt: 2 }}>
                <CardHeader title="Generated Drafts" />
                <CardContent>
                  <List>
                    {generatedDrafts.slice(0, 3).map((draft) => (
                      <ListItem
                        key={draft.id}
                        button
                        onClick={() => {
                          setSelectedDraft(draft);
                          setEmailData(prev => ({
                            ...prev,
                            subject: draft.subject,
                            body: draft.body,
                            tone: draft.tone,
                            type: draft.type,
                          }));
                        }}
                        selected={selectedDraft?.id === draft.id}
                      >
                        <ListItemAvatar>
                          <Avatar sx={{ bgcolor: `${getToneColor(draft.tone)}.main` }}>
                            <EmailIcon />
                          </Avatar>
                        </ListItemAvatar>
                        <ListItemText
                          primary={draft.subject}
                          secondary={`${draft.type} - ${draft.tone} tone`}
                        />
                        <ListItemSecondaryAction>
                          <Chip
                            label={draft.type}
                            size="small"
                            color={getToneColor(draft.tone)}
                          />
                        </ListItemSecondaryAction>
                      </ListItem>
                    ))}
                  </List>
                </CardContent>
              </Card>
            )}
          </Grid>
        </Grid>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="contained"
          startIcon={<SendIcon />}
          onClick={handleSendEmail}
          disabled={!emailData.to || !emailData.subject || !emailData.body}
        >
          Send Email
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AIEmailAssistant; 