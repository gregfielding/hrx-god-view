import React, { useMemo, useState } from 'react';
import {
  Box,
  Card,
  CardHeader,
  CardContent,
  Typography,
  Chip,
  Grid,
  Button,
  Snackbar,
  Alert,
  List,
  ListItem,
  ListItemText,
  Divider,
  CircularProgress,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  ContentCopy as CopyIcon,
} from '@mui/icons-material';
import { httpsCallable } from 'firebase/functions';
import { addDoc, collection } from 'firebase/firestore';
import { functions, db } from '../firebase';

type RecommendedContact = {
  role: string;
  titleGuess?: string;
  seniority?: string;
  linkedinUrl?: string;
  email?: string;
  phone?: string;
};

type OrgStructure = {
  ops?: string;
  hr?: string;
  warehouse?: string;
  it?: string;
  finance?: string;
  procurement?: string;
  logistics?: string;
  safety?: string;
};

type AIEnrichment = {
  businessSummary?: string;
  suggestedApproach?: string;
  likelyPainPoints?: string[];
  generatedScripts?: Record<string, string>;
  suggestedTags?: string[];
  recommendedContacts?: RecommendedContact[];
  inferredOrgStructure?: OrgStructure;
  hiringTrends?: string[];
  topJobTitles?: string[];
  competitorCompanies?: string[];
  redFlags?: string[];
  qaNotes?: string;
  model?: string;
  tokenUsage?: { input?: number; output?: number };
};

interface Props {
  company: any;
  tenantId: string;
}

const Fallback: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <Typography variant="body2" color="text.secondary">{children ?? '—'}</Typography>
);

const AIEnrichmentWidget: React.FC<Props> = ({ company, tenantId }) => {
  const [enrichingFull, setEnrichingFull] = useState(false);
  const [enrichingMeta, setEnrichingMeta] = useState(false);
  const [toast, setToast] = useState<{ open: boolean; msg: string; error?: boolean }>({ open: false, msg: '' });
  const enrichment: AIEnrichment = useMemo(() => (company?.aiEnrichment || {}), [company?.aiEnrichment]);

  const signalStrength: 'low'|'medium'|'high'|undefined = (company?.aiEnrichment?.versionMeta?.signalStrength || company?.signalStrength);
  const lastEnrichedAt: any = company?.lastEnrichedAt;
  const leadScore = company?.leadScore ?? 0;

  const copyText = async (text?: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setToast({ open: true, msg: 'Copied to clipboard' });
    } catch {
      setToast({ open: true, msg: 'Copy failed', error: true });
    }
  };

  const handleEnrich = async (mode: 'full'|'metadata') => {
    try {
      mode === 'full' ? setEnrichingFull(true) : setEnrichingMeta(true);
      const fn = httpsCallable(functions, 'enrichCompanyOnDemand');
      const resp: any = await fn({ tenantId, companyId: company.id, mode });
      const r = resp?.data || {};
      setToast({ open: true, msg: r.status === 'degraded' ? 'Metadata refresh started (degraded)' : 'Enrichment started' });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('enrichCompanyOnDemand failed', e);
      setToast({ open: true, msg: 'Failed to start enrichment', error: true });
    } finally {
      setEnrichingFull(false);
      setEnrichingMeta(false);
    }
  };

  const handleAddRecommendedContact = async (rc: RecommendedContact) => {
    try {
      const nameParts = (rc.role || '').split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';
      const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
      await addDoc(contactsRef, {
        tenantId,
        companyId: company.id,
        companyName: company.companyName || company.name,
        firstName,
        lastName,
        fullName: [firstName, lastName].filter(Boolean).join(' ') || rc.role || 'Contact',
        title: rc.titleGuess || rc.role,
        jobTitle: rc.titleGuess || rc.role,
        linkedinUrl: rc.linkedinUrl || '',
        email: rc.email || '',
        phone: rc.phone || '',
        status: 'Prospect',
        role: 'decision_maker',
        leadSource: 'AI Enrichment',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      setToast({ open: true, msg: 'Contact added to CRM' });
    } catch (e:any) {
      // eslint-disable-next-line no-console
      console.error('add recommended contact failed', e);
      setToast({ open: true, msg: e?.message || 'Add failed', error: true });
    }
  };

  const scripts = enrichment.generatedScripts || {};

  const org: OrgStructure = enrichment.inferredOrgStructure || {};
  const orgKeys: Array<{ key: keyof OrgStructure; label: string }> = [
    { key: 'ops', label: 'Ops' },
    { key: 'hr', label: 'HR' },
    { key: 'warehouse', label: 'Warehouse' },
    { key: 'it', label: 'IT' },
    { key: 'finance', label: 'Finance' },
    { key: 'procurement', label: 'Procurement' },
  ];

  const fmtDate = (d: any) => {
    if (!d) return '';
    // Firestore Timestamp or ISO/string/number
    const js = (d?.toDate?.() as Date) || new Date(d);
    return js.toLocaleString();
  };

  return (
    <Card>
      <CardHeader
        title="AI Enrichment"
        titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
        action={(
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<RefreshIcon />}
              disabled={enrichingFull || enrichingMeta}
              onClick={() => handleEnrich('full')}
            >
              {enrichingFull ? 'Running…' : 'Re-Enrich'}
            </Button>
            <Button
              size="small"
              variant="text"
              disabled={enrichingFull || enrichingMeta}
              onClick={() => handleEnrich('metadata')}
            >
              {enrichingMeta ? 'Refreshing…' : 'Metadata Only'}
            </Button>
          </Box>
        )}
      />
      <CardContent sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
          <Chip label={`Lead Score: ${leadScore}`} color="primary" size="small" />
          {signalStrength && (
            <Chip label={`Signal: ${signalStrength}`} size="small" variant="outlined" />
          )}
          {lastEnrichedAt && (
            <Typography variant="caption" color="text.secondary">
              Last Enriched: {fmtDate(lastEnrichedAt)}
            </Typography>
          )}
        </Box>

        {/* Summary */}
        <Box sx={{ mb: 2 }}>
          {enrichment.businessSummary ? (
            <Typography variant="body2" color="text.secondary">{enrichment.businessSummary}</Typography>
          ) : (
            <Fallback>—</Fallback>
          )}
        </Box>

        <Grid container spacing={2}>
          {/* Left column */}
          <Grid item xs={12} md={6}>
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>Suggested Approach</Typography>
              {enrichment.suggestedApproach ? (
                <Typography variant="body2">{enrichment.suggestedApproach}</Typography>
              ) : (
                <Fallback />
              )}
            </Box>

            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>Pain Points</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {(enrichment.likelyPainPoints || []).slice(0, 8).map((p, i) => (
                  <Chip key={`pp-${i}`} size="small" label={p} />
                ))}
                {(enrichment.likelyPainPoints || []).length === 0 && <Fallback />}
              </Box>
            </Box>

            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>Scripts</Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button size="small" startIcon={<CopyIcon />} disabled={!scripts?.coldEmail} onClick={() => copyText(scripts?.coldEmail)}>Copy Cold Email</Button>
                <Button size="small" startIcon={<CopyIcon />} disabled={!scripts?.callOpening} onClick={() => copyText(scripts?.callOpening)}>Copy Call Opener</Button>
              </Box>
            </Box>

            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>Tags</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {(enrichment.suggestedTags || []).slice(0, 10).map((t, i) => (
                  <Chip key={`tag-${i}`} size="small" variant="outlined" label={t} />
                ))}
                {(enrichment.suggestedTags || []).length === 0 && <Fallback />}
              </Box>
            </Box>

            <Box>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>Recommended Contacts</Typography>
              {Array.isArray(enrichment.recommendedContacts) && enrichment.recommendedContacts.length > 0 ? (
                <List dense>
                  {enrichment.recommendedContacts.slice(0, 5).map((r, i) => (
                    <ListItem key={`rc-${i}`} secondaryAction={
                      <Button size="small" variant="outlined" onClick={() => handleAddRecommendedContact(r)}>Add to CRM</Button>
                    }>
                      <ListItemText
                        primaryTypographyProps={{ variant: 'body2' }}
                        primary={`${r.role}${r.titleGuess ? ` — ${r.titleGuess}` : ''}`}
                        secondary={r.linkedinUrl || ''}
                      />
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Fallback />
              )}
            </Box>
          </Grid>

          {/* Right column */}
          <Grid item xs={12} md={6}>
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>Org Structure</Typography>
              <Grid container spacing={1}>
                {orgKeys.map(({ key, label }) => (
                  <Grid item xs={6} key={key}>
                    <Typography variant="caption" color="text.secondary">{label}</Typography>
                    <Typography variant="body2">{org[key] || '—'}</Typography>
                  </Grid>
                ))}
              </Grid>
            </Box>

            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>Hiring Trends</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {(enrichment.hiringTrends || []).slice(0, 8).map((t, i) => (
                  <Chip key={`ht-${i}`} size="small" label={t} />
                ))}
                {(enrichment.hiringTrends || []).length === 0 && <Fallback />}
              </Box>
            </Box>

            <Box>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>Top Job Titles</Typography>
              {Array.isArray(enrichment.topJobTitles) && enrichment.topJobTitles.length > 0 ? (
                <List dense>
                  {enrichment.topJobTitles.slice(0, 5).map((t, i) => (
                    <ListItem key={`jj-${i}`}><ListItemText primaryTypographyProps={{ variant: 'body2' }} primary={t} /></ListItem>
                  ))}
                </List>
              ) : (
                <Fallback />
              )}
            </Box>
          </Grid>
        </Grid>

        <Divider sx={{ my: 2 }} />

        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>Competitors</Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {(enrichment.competitorCompanies || []).slice(0, 8).map((c, i) => (
                <Chip key={`cc-${i}`} size="small" variant="outlined" label={c} />
              ))}
              {(enrichment.competitorCompanies || []).length === 0 && <Fallback />}
            </Box>
          </Grid>
          <Grid item xs={12} md={6}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>Risks</Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {(enrichment.redFlags || []).slice(0, 8).map((r, i) => (
                <Chip key={`rf-${i}`} size="small" color="warning" label={r} />
              ))}
              {(enrichment.redFlags || []).length === 0 && <Fallback />}
            </Box>
          </Grid>
        </Grid>

        {(enrichment.qaNotes || enrichment.model || enrichment.tokenUsage) && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary">
              {enrichment.model && `Model: ${enrichment.model} `}
              {enrichment.tokenUsage && `Tokens — in: ${enrichment.tokenUsage.input ?? 0}, out: ${enrichment.tokenUsage.output ?? 0}`}
            </Typography>
            {enrichment.qaNotes && (
              <Box sx={{ mt: 0.5 }}>
                <Typography variant="caption" color="warning.main" fontWeight={600}>QA Notes</Typography>
                <Typography variant="body2">{enrichment.qaNotes}</Typography>
              </Box>
            )}
          </Box>
        )}
      </CardContent>

      <Snackbar open={toast.open} autoHideDuration={3500} onClose={() => setToast({ open: false, msg: '' })}>
        <Alert severity={toast.error ? 'error' : 'success'} onClose={() => setToast({ open: false, msg: '' })} sx={{ width: '100%' }}>
          {toast.msg}
        </Alert>
      </Snackbar>
    </Card>
  );
};

export default AIEnrichmentWidget;


