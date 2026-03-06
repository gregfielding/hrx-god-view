import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box,
  Typography,
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
  TableSortLabel,
  Avatar,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Snackbar,
  Button,
} from '@mui/material';
import NoteIcon from '@mui/icons-material/Note';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import { httpsCallable } from 'firebase/functions';
import * as XLSX from 'xlsx';
import { functions } from '../firebase';
import StageChip from '../components/StageChip';
import DealAgeChip from '../components/DealAgeChip';
import HealthBadge from '../components/HealthBadge';
import { calculateDealAge, calculateDealHealth } from '../utils/dealHealthCalculator';

function getDealCompanyName(deal: any): string {
  if (deal?.publicPrimaryCompany?.companyName) return deal.publicPrimaryCompany.companyName;
  if (deal?.publicPrimaryCompany?.name) return deal.publicPrimaryCompany.name;
  const primary = deal?.associations?.companies?.[0];
  if (primary && typeof primary === 'object' && primary.snapshot?.companyName) return primary.snapshot.companyName;
  if (primary && typeof primary === 'object' && primary.snapshot?.name) return primary.snapshot.name;
  if (deal?.companyName) return deal.companyName;
  if (deal?.company?.companyName) return deal.company.companyName;
  if (deal?.company?.name) return deal.company.name;
  if (deal?.externalCompanyName) return deal.externalCompanyName;
  return '—';
}

function getDealCompanyLogo(deal: any): string | null {
  return (
    deal?.publicPrimaryCompany?.logo ||
    deal?.publicPrimaryCompany?.logoUrl ||
    deal?.publicPrimaryCompany?.logo_url ||
    deal?.publicPrimaryCompany?.avatar ||
    deal?.associations?.companies?.[0]?.snapshot?.logo ||
    deal?.associations?.companies?.[0]?.snapshot?.logoUrl ||
    deal?.associations?.companies?.[0]?.snapshot?.logo_url ||
    deal?.associations?.companies?.[0]?.snapshot?.avatar ||
    null
  );
}

function getAvatarColor(name: string) {
  const colors = ['#F3F4F6', '#FEF3C7', '#DBEAFE', '#D1FAE5', '#FCE7F3', '#EDE9FE', '#FEE2E2', '#FEF5E7'];
  const index = (name || 'A').charCodeAt(0) % colors.length;
  return colors[index];
}

function getAvatarTextColor(name: string) {
  const colors = ['#6B7280', '#92400E', '#1E40AF', '#065F46', '#BE185D', '#5B21B6', '#DC2626', '#EA580C'];
  const index = (name || 'A').charCodeAt(0) % colors.length;
  return colors[index];
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

const dealHeaderCellSx = { fontWeight: 600, textTransform: 'uppercase' as const, fontSize: '0.75rem' };

export default function PublicCRMView() {
  const [searchParams] = useSearchParams();
  const tenantId = searchParams.get('tenant') || '';

  const [deals, setDeals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<string>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteModalDealName, setNoteModalDealName] = useState('');
  const [noteModalContent, setNoteModalContent] = useState<string | null>(null);
  const [noteModalTimestamp, setNoteModalTimestamp] = useState<Date | null>(null);
  const [noteModalSnackbar, setNoteModalSnackbar] = useState<string | null>(null);

  const getDealStatus = useCallback((deal: any) => {
    const status = deal.status || 'open';
    const statusMap: Record<string, { label: string; color: string; emoji: string }> = {
      open: { label: 'Open', color: 'default', emoji: '⚪' },
      won: { label: 'Won', color: 'success', emoji: '🟢' },
      lost: { label: 'Lost', color: 'error', emoji: '🔴' },
      on_hold: { label: 'On Hold', color: 'warning', emoji: '⏸️' },
      canceled: { label: 'Canceled', color: 'error', emoji: '⚫' },
      dormant: { label: 'Dormant', color: 'default', emoji: '🟣' },
    };
    return statusMap[status] || statusMap.open;
  }, []);

  const getDealOwner = useCallback((deal: any): string => {
    const assoc = (deal.associations?.salespeople || []) as any[];
    const names: string[] = [];
    assoc.forEach((sp: any) => {
      if (typeof sp === 'string') names.push(sp);
      else if (sp?.snapshot) {
        const full = [sp.snapshot.firstName, sp.snapshot.lastName].filter(Boolean).join(' ').trim();
        names.push(sp.snapshot.displayName || sp.snapshot.name || full || sp.snapshot.email || '');
      } else if (sp?.displayName || sp?.name) names.push(sp.displayName || sp.name);
      else if (sp?.firstName || sp?.lastName) names.push([sp.firstName, sp.lastName].filter(Boolean).join(' ').trim());
    });
    if (names.filter(Boolean).length > 0) return names.filter(Boolean).join(', ');
    if (deal.salesOwnerName) return deal.salesOwnerName;
    if (deal.salespeopleNames?.length) return deal.salespeopleNames.join(', ');
    return '—';
  }, []);

  const getSortableValue = useCallback((deal: any, field: string): string | number | Date => {
    switch (field) {
      case 'name': return deal.name?.toLowerCase() || '';
      case 'company': return getDealCompanyName(deal)?.toLowerCase() || '';
      case 'decisionMaker': return getDealDecisionMakerDisplay(deal).name.toLowerCase();
      case 'stage': return deal.stage?.toLowerCase() || '';
      case 'initialValue': {
        const s = getDealInitialValue(deal);
        const n = parseFloat(s.replace(/[$,]/g, ''));
        return Number.isNaN(n) ? 0 : n;
      }
      case 'potentialValue': {
        const s = getDealPotentialValue(deal);
        const n = parseFloat(s.replace(/[$,]/g, ''));
        return Number.isNaN(n) ? 0 : n;
      }
      case 'createdAt': {
        const age = calculateDealAge(deal?.createdAt);
        return age ? age.days : 0;
      }
      case 'status': return getDealStatus(deal).label?.toLowerCase() || '';
      case 'health': return calculateDealHealth(deal).score;
      case 'closeDate': {
        const raw = deal.closeDate || deal.stageData?.qualification?.expectedCloseDate;
        return !raw ? new Date(0) : new Date(raw);
      }
      case 'expectedStart': {
        const raw = deal.stageData?.qualification?.expectedStartDate;
        return !raw ? new Date(0) : new Date(raw);
      }
      case 'actualClose': {
        const raw = deal.stageData?.closedWon?.dateSigned;
        return !raw ? new Date(0) : new Date(raw);
      }
      case 'owner': return getDealOwner(deal)?.toLowerCase() || '';
      default: return '';
    }
  }, [getDealStatus, getDealOwner]);

  const sortedDeals = useMemo(() => {
    const arr = [...deals];
    arr.sort((a, b) => {
      const aVal = getSortableValue(a, sortField);
      const bVal = getSortableValue(b, sortField);
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [deals, sortField, sortDirection, getSortableValue]);

  const handleSort = useCallback((field: string) => {
    setSortField(field);
    setSortDirection((prev) => (sortField === field ? (prev === 'asc' ? 'desc' : 'asc') : 'asc'));
  }, [sortField]);

  const handleNoteIconClick = useCallback((e: React.MouseEvent, deal: any) => {
    e.preventDefault();
    e.stopPropagation();
    setNoteModalDealName(deal?.name || 'Deal');
    const note = deal?.latestNote;
    if (note?.content) {
      setNoteModalContent(note.content);
      setNoteModalTimestamp(note.timestamp ? new Date(note.timestamp) : null);
      setNoteModalOpen(true);
      return;
    }
    setNoteModalSnackbar('No notes for this deal');
  }, []);

  const handleExportExcel = useCallback(() => {
    const rows = sortedDeals.map((deal) => ({
      'Deal Name': deal.name ?? '—',
      Note: deal?.latestNote?.content || '',
      Company: getDealCompanyName(deal),
      'Decision Maker': (() => {
        const dm = getDealDecisionMakerDisplay(deal);
        if (!dm.name) return '—';
        return dm.title ? `${dm.name} - ${dm.title}` : dm.name;
      })(),
      Stage: deal.stage ?? '—',
      'Initial Value': getDealInitialValue(deal),
      'Potential Value': getDealPotentialValue(deal),
      Age: calculateDealAge(deal?.createdAt)?.days ?? '—',
      Status: getDealStatus(deal).label,
      Health: calculateDealHealth(deal).display.label,
      'Expected Close': getDealCloseDate(deal),
      'Expected Start': getDealExpectedStart(deal),
      'Actual Close': getDealActualClose(deal),
      Owner: getDealOwner(deal),
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    (workbook as any).SheetNames.push('Opportunities');
    (workbook as any).Sheets.Opportunities = worksheet;
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `public_crm_opportunities_${stamp}.xlsx`);
  }, [sortedDeals, getDealStatus, getDealOwner]);

  useEffect(() => {
    if (!tenantId) {
      setLoading(false);
      setError('Missing tenant. Use ?tenant=YOUR_TENANT_ID');
      return;
    }
    setLoading(true);
    setError(null);
    const fn = httpsCallable<{ tenantId: string }, { deals: any[]; pipelineStages: any[] }>(
      functions,
      'getPublicCrmView',
    );
    fn({ tenantId })
      .then((res) => {
        setDeals(res.data?.deals ?? []);
      })
      .catch((err: any) => {
        setError(err?.message || 'Failed to load CRM data');
        setDeals([]);
      })
      .finally(() => setLoading(false));
  }, [tenantId]);

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
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
          <Box>
            <Typography variant="h5" fontWeight={600} color="text.primary">
              CRM
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Read-only view · Manage opportunities and pipeline
            </Typography>
          </Box>
          <Button
            variant="outlined"
            size="small"
            startIcon={<FileDownloadIcon />}
            onClick={handleExportExcel}
            disabled={sortedDeals.length === 0}
            sx={{ textTransform: 'none', flexShrink: 0 }}
          >
            Export
          </Button>
        </Box>
      </Box>
      {/* Pipeline tab intentionally hidden for public CRM */}

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
        ) : (
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1 }}>
            <Table size="small" stickyHeader sx={{ minWidth: 1000 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={dealHeaderCellSx}>
                    <TableSortLabel active={sortField === 'name'} direction={sortField === 'name' ? sortDirection : 'asc'} onClick={() => handleSort('name')}>
                      Deal Name
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ ...dealHeaderCellSx, width: 56 }}>Note</TableCell>
                  <TableCell sx={dealHeaderCellSx}>
                    <TableSortLabel active={sortField === 'company'} direction={sortField === 'company' ? sortDirection : 'asc'} onClick={() => handleSort('company')}>
                      Company
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={dealHeaderCellSx}>
                    <TableSortLabel active={sortField === 'decisionMaker'} direction={sortField === 'decisionMaker' ? sortDirection : 'asc'} onClick={() => handleSort('decisionMaker')}>
                      Decision maker
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={dealHeaderCellSx}>
                    <TableSortLabel active={sortField === 'stage'} direction={sortField === 'stage' ? sortDirection : 'asc'} onClick={() => handleSort('stage')}>
                      Stage
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ ...dealHeaderCellSx, textAlign: 'right' }}>
                    <TableSortLabel active={sortField === 'initialValue'} direction={sortField === 'initialValue' ? sortDirection : 'asc'} onClick={() => handleSort('initialValue')}>
                      Initial Value
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ ...dealHeaderCellSx, textAlign: 'right' }}>
                    <TableSortLabel active={sortField === 'potentialValue'} direction={sortField === 'potentialValue' ? sortDirection : 'asc'} onClick={() => handleSort('potentialValue')}>
                      Potential Value
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={dealHeaderCellSx}>
                    <TableSortLabel active={sortField === 'createdAt'} direction={sortField === 'createdAt' ? sortDirection : 'asc'} onClick={() => handleSort('createdAt')}>
                      Age
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={dealHeaderCellSx}>
                    <TableSortLabel active={sortField === 'status'} direction={sortField === 'status' ? sortDirection : 'asc'} onClick={() => handleSort('status')}>
                      Status
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={dealHeaderCellSx}>
                    <TableSortLabel active={sortField === 'health'} direction={sortField === 'health' ? sortDirection : 'asc'} onClick={() => handleSort('health')}>
                      Health
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={dealHeaderCellSx}>
                    <TableSortLabel active={sortField === 'closeDate'} direction={sortField === 'closeDate' ? sortDirection : 'asc'} onClick={() => handleSort('closeDate')}>
                      Expected Close
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={dealHeaderCellSx}>
                    <TableSortLabel active={sortField === 'expectedStart'} direction={sortField === 'expectedStart' ? sortDirection : 'asc'} onClick={() => handleSort('expectedStart')}>
                      Expected Start
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={dealHeaderCellSx}>
                    <TableSortLabel active={sortField === 'actualClose'} direction={sortField === 'actualClose' ? sortDirection : 'asc'} onClick={() => handleSort('actualClose')}>
                      Actual Close
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={dealHeaderCellSx}>
                    <TableSortLabel active={sortField === 'owner'} direction={sortField === 'owner' ? sortDirection : 'asc'} onClick={() => handleSort('owner')}>
                      Owner
                    </TableSortLabel>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedDeals.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={14} sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                      No opportunities
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedDeals.map((deal) => {
                    const dm = getDealDecisionMakerDisplay(deal);
                    const statusInfo = getDealStatus(deal);
                    const healthResult = calculateDealHealth(deal);
                    const ageResult = calculateDealAge(deal?.createdAt);
                    return (
                      <TableRow key={deal.id} hover sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
                        <TableCell sx={{ fontWeight: 500 }}>{deal.name ?? '—'}</TableCell>
                        <TableCell sx={{ px: 0.5 }}>
                          <Tooltip title={deal?.latestNote?.content ? 'View most recent note' : 'No notes for this deal'}>
                            <span>
                              <IconButton
                                size="small"
                                onClick={(e) => handleNoteIconClick(e, deal)}
                                sx={{ color: deal?.latestNote?.content ? 'primary.main' : 'text.disabled' }}
                                aria-label="View note"
                              >
                                <NoteIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Avatar
                              src={getDealCompanyLogo(deal) || undefined}
                              sx={{
                                width: 24,
                                height: 24,
                                backgroundColor: getAvatarColor(getDealCompanyName(deal)),
                                color: getAvatarTextColor(getDealCompanyName(deal)),
                                fontWeight: 600,
                                fontSize: '10px',
                              }}
                            >
                              {getDealCompanyName(deal)?.charAt(0)?.toUpperCase() || '?'}
                            </Avatar>
                            <Typography variant="body2" color="text.secondary">
                              {getDealCompanyName(deal)}
                            </Typography>
                          </Box>
                        </TableCell>
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
                        <TableCell>
                          {ageResult ? (
                            <DealAgeChip ageDays={ageResult.days} createdAt={ageResult.date} showEmoji variant="compact" />
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip size="small" label={statusInfo.label} color={statusInfo.color as any} variant="outlined" />
                        </TableCell>
                        <TableCell>
                          <HealthBadge bucket={healthResult.bucket as any} score={healthResult.score} reasons={healthResult.reasons} showScore={false} variant="compact" />
                        </TableCell>
                        <TableCell>{getDealCloseDate(deal)}</TableCell>
                        <TableCell>{getDealExpectedStart(deal)}</TableCell>
                        <TableCell>{getDealActualClose(deal)}</TableCell>
                        <TableCell>{getDealOwner(deal)}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>

      <Dialog open={noteModalOpen} onClose={() => setNoteModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Note - {noteModalDealName}</DialogTitle>
        <DialogContent>
          {noteModalTimestamp != null && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              {noteModalTimestamp.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
            </Typography>
          )}
          {noteModalContent != null && (
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {noteModalContent}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Chip component="button" label="Close" onClick={() => setNoteModalOpen(false)} />
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!noteModalSnackbar}
        autoHideDuration={3000}
        onClose={() => setNoteModalSnackbar(null)}
        message={noteModalSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  );
}
