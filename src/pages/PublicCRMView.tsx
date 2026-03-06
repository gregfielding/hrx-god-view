import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box,
  Typography,
  Tabs,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Alert,
  CircularProgress,
  Chip,
  Card,
  CardContent,
  Stack,
} from '@mui/material';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import StageChip from '../components/StageChip';

type TabValue = 'opportunities' | 'pipeline';

function getDealCompanyName(deal: any): string {
  const primary = deal?.associations?.companies?.[0];
  if (primary && typeof primary === 'object' && primary.snapshot?.companyName) return primary.snapshot.companyName;
  if (primary && typeof primary === 'object' && primary.snapshot?.name) return primary.snapshot.name;
  if (deal?.externalCompanyName) return deal.externalCompanyName;
  return '—';
}

function formatDateOnly(raw: any): string {
  if (!raw) return '—';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return '—';
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const y = d.getUTCFullYear();
  return `${m}/${day}/${y}`;
}

function getDealInitialValue(deal: any): string {
  if (deal.stageData?.qualification) {
    const qualData = deal.stageData.qualification;
    const payRate = qualData.expectedAveragePayRate || 16;
    const markup = qualData.expectedAverageMarkup || 40;
    const timeline = qualData.staffPlacementTimeline;
    if (timeline) {
      const billRate = payRate * (1 + markup / 100);
      const annualHoursPerEmployee = 2080;
      const annualRevenuePerEmployee = billRate * annualHoursPerEmployee;
      const startingCount = timeline.starting || 0;
      if (startingCount > 0) {
        const minRevenue = annualRevenuePerEmployee * startingCount;
        return `$${minRevenue.toLocaleString()}`;
      }
    }
  }
  if (deal.estimatedRevenue != null && deal.estimatedRevenue !== '') {
    const n = Number(deal.estimatedRevenue);
    if (!Number.isNaN(n)) return `$${Math.round(n).toLocaleString()}`;
  }
  return '—';
}

function getDealPotentialValue(deal: any): string {
  if (deal.stageData?.qualification) {
    const qualData = deal.stageData.qualification;
    const payRate = qualData.expectedAveragePayRate || 16;
    const markup = qualData.expectedAverageMarkup || 40;
    const timeline = qualData.staffPlacementTimeline;
    if (timeline) {
      const billRate = payRate * (1 + markup / 100);
      const annualHoursPerEmployee = 2080;
      const annualRevenuePerEmployee = billRate * annualHoursPerEmployee;
      const after180DaysCount = timeline.after180Days ?? timeline.after90Days ?? timeline.after30Days ?? timeline.starting ?? 0;
      if (after180DaysCount > 0) {
        const maxRevenue = annualRevenuePerEmployee * after180DaysCount;
        return `$${maxRevenue.toLocaleString()}`;
      }
    }
  }
  return '—';
}

function getDealCloseDate(deal: any): string {
  const raw = deal.closeDate || deal.stageData?.qualification?.expectedCloseDate;
  return formatDateOnly(raw);
}

function getDealExpectedStart(deal: any): string {
  return formatDateOnly(deal.stageData?.qualification?.expectedStartDate);
}

function getDealActualClose(deal: any): string {
  return formatDateOnly(deal.stageData?.closedWon?.dateSigned);
}

function getDealDecisionMakerDisplay(deal: any): { name: string; title: string | null } {
  const dm = deal.stageData?.qualification?.decisionMaker;
  if (!dm) return { name: '', title: null };
  const name = dm.fullName || `${dm.firstName || ''} ${dm.lastName || ''}`.trim() || dm.name || '';
  const title = dm.title ? String(dm.title).trim() : null;
  return { name, title: title || null };
}

export default function PublicCRMView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tenantId = searchParams.get('tenant') || '';
  const tabParam = (searchParams.get('tab') || 'opportunities') as TabValue;
  const tabValue = tabParam === 'pipeline' ? 1 : 0;

  const [deals, setDeals] = useState<any[]>([]);
  const [pipelineStages, setPipelineStages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) {
      setLoading(false);
      setError('Missing tenant. Use ?tenant=YOUR_TENANT_ID');
      return;
    }
    setLoading(true);
    setError(null);
    const fn = httpsCallable<{ tenantId: string }, { deals: any[]; pipelineStages: any[] }>(
      getFunctions(),
      'getPublicCrmView',
    );
    fn({ tenantId })
      .then((res) => {
        setDeals(res.data?.deals ?? []);
        setPipelineStages(res.data?.pipelineStages ?? []);
      })
      .catch((err: any) => {
        setError(err?.message || 'Failed to load CRM data');
        setDeals([]);
        setPipelineStages([]);
      })
      .finally(() => setLoading(false));
  }, [tenantId]);

  const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
    const tab: TabValue = newValue === 1 ? 'pipeline' : 'opportunities';
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', tab);
      return next;
    });
  };

  const dealsByStage = React.useMemo(() => {
    const map: Record<string, any[]> = {};
    pipelineStages.forEach((s: any) => {
      map[s.name || s.id] = [];
    });
    deals.forEach((d) => {
      const stage = d.stage ?? 'Unknown';
      if (!map[stage]) map[stage] = [];
      map[stage].push(d);
    });
    return pipelineStages.length
      ? pipelineStages.map((s: any) => ({ stage: s, deals: map[s.name || s.id] || [] }))
      : [{ stage: { name: 'All', order: 0 }, deals }];
  }, [deals, pipelineStages]);

  if (!tenantId) {
    return (
      <Box sx={{ p: 3, maxWidth: 600, mx: 'auto' }}>
        <Typography variant="h5" gutterBottom>Public CRM View</Typography>
        <Alert severity="info">
          Add <code>?tenant=YOUR_TENANT_ID</code> to the URL to view that tenant&apos;s CRM (read-only).
          Example: <code>/crm/public?tenant=abc123</code>
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.50', pb: 4 }}>
      <Box sx={{ px: 2, pt: 2, pb: 1 }}>
        <Typography variant="h5" fontWeight={600} color="text.primary">
          CRM
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Read-only view · Manage opportunities and pipeline
        </Typography>
      </Box>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}>
        <Tabs value={tabValue} onChange={handleTabChange} sx={{ minHeight: 40 }}>
          <Tab label="Opportunities" id="public-crm-tab-0" aria-controls="public-crm-panel-0" />
          <Tab label="Pipeline" id="public-crm-tab-1" aria-controls="public-crm-panel-1" />
        </Tabs>
      </Box>

      <Box sx={{ px: 2, pt: 2 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : tabValue === 0 ? (
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1 }}>
            <Table size="small" stickyHeader sx={{ minWidth: 800 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>Deal Name</TableCell>
                  <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem', width: 56 }}>Note</TableCell>
                  <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>Company</TableCell>
                  <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>Decision maker</TableCell>
                  <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>Stage</TableCell>
                  <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem', textAlign: 'right' }}>Initial Value</TableCell>
                  <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem', textAlign: 'right' }}>Potential Value</TableCell>
                  <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>Expected Close</TableCell>
                  <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>Expected Start</TableCell>
                  <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>Actual Close</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {deals.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                      No opportunities
                    </TableCell>
                  </TableRow>
                ) : (
                  deals.map((deal) => {
                    const dm = getDealDecisionMakerDisplay(deal);
                    return (
                      <TableRow key={deal.id} hover sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
                        <TableCell sx={{ fontWeight: 500 }}>{deal.name ?? '—'}</TableCell>
                        <TableCell sx={{ color: 'text.secondary' }}>—</TableCell>
                        <TableCell>{getDealCompanyName(deal)}</TableCell>
                        <TableCell>
                          {dm.name ? (
                            <>
                              <Typography variant="body2" sx={{ fontWeight: 500 }}>{dm.name}</Typography>
                              {dm.title && (
                                <Typography variant="caption" color="text.secondary" display="block">{dm.title}</Typography>
                              )}
                            </>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell>
                          <StageChip stage={deal.stage ?? ''} size="small" useCustomColors={true} />
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 500 }}>{getDealInitialValue(deal)}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 500 }}>{getDealPotentialValue(deal)}</TableCell>
                        <TableCell>{getDealCloseDate(deal)}</TableCell>
                        <TableCell>{getDealExpectedStart(deal)}</TableCell>
                        <TableCell>{getDealActualClose(deal)}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <Stack spacing={2}>
            {dealsByStage.map(({ stage, deals: stageDeals }) => (
              <Card key={stage.name || stage.id} variant="outlined">
                <CardContent>
                  <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                    {stage.name || stage.id} ({stageDeals.length})
                  </Typography>
                  {stageDeals.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">No deals</Typography>
                  ) : (
                    <Stack direction="row" flexWrap="wrap" gap={0.5} useFlexGap>
                      {stageDeals.map((d: any) => (
                        <Chip
                          key={d.id}
                          label={d.name ?? d.id}
                          size="small"
                          variant="outlined"
                          sx={{ textTransform: 'none' }}
                        />
                      ))}
                    </Stack>
                  )}
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}
      </Box>
    </Box>
  );
}
