/**
 * User Profile → Certifications tab: worker credentials, expirations, and onboarding-synced compliance items.
 * (Tab label is Certifications; assignment-specific requirements live on Assignments.)
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { p } from '../../../data/firestorePaths';
import {
  getComplianceTypeLabel,
  getComplianceTypeConfig,
  getComplianceStatusDisplayLabel,
  type WorkerComplianceItem,
  type ComplianceStatus,
} from '../../../types/compliance';
import { getExpirationState, hasExpiredCompliance, hasExpiringSoonCompliance } from '../../../utils/complianceExpiration';
import ComplianceCredentialModal, { CREDENTIAL_EDIT_TYPES } from './ComplianceCredentialModal';

const STATUS_COLOR: Record<ComplianceStatus, 'default' | 'warning' | 'success' | 'error'> = {
  not_started: 'default',
  pending: 'warning',
  submitted: 'warning',
  in_review: 'warning',
  complete: 'success',
  expired: 'error',
  failed: 'error',
  waived: 'default',
};

const CATEGORY_ORDER = ['eligibility', 'screening', 'acknowledgment', 'credential'] as const;

interface ComplianceTabProps {
  uid: string;
  tenantId: string | null;
}

function formatDate(value: unknown): string {
  if (!value) return '—';
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toLocaleDateString();
  }
  if (typeof value === 'string') return new Date(value).toLocaleDateString();
  return '—';
}

/** Map shared getExpirationState to legacy 'expiring' for row styling. */
function expStateToLegacy(state: 'expired' | 'expiring_soon' | 'ok'): 'expired' | 'expiring' | 'ok' {
  return state === 'expiring_soon' ? 'expiring' : state;
}

const ComplianceTab: React.FC<ComplianceTabProps> = ({ uid, tenantId }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<(WorkerComplianceItem & { id: string })[]>([]);
  const [employmentNames, setEmploymentNames] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<'all' | 'credentials' | 'onboarding'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<(WorkerComplianceItem & { id: string }) | null>(null);

  const loadItems = async () => {
    if (!tenantId || !uid) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const ref = collection(db, p.workerComplianceItems(tenantId));
      const q = query(ref, where('userId', '==', uid));
      const snap = await getDocs(q);
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<WorkerComplianceItem, 'id'>),
      }));
      setItems(list);
      const employmentIds = [...new Set(list.map((i) => i.employmentId).filter(Boolean))] as string[];
      if (employmentIds.length > 0) {
        const names: Record<string, string> = {};
        await Promise.all(
          employmentIds.map(async (eid) => {
            try {
              const empRef = doc(db, p.entityEmployment(tenantId, eid));
              const empSnap = await getDoc(empRef);
              const data = empSnap.data() as { entityName?: string; entityKey?: string } | undefined;
              names[eid] = data?.entityName || data?.entityKey || eid;
            } catch {
              names[eid] = eid;
            }
          })
        );
        setEmploymentNames(names);
      } else {
        setEmploymentNames({});
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load compliance items');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
  }, [tenantId, uid]);

  const filteredAndSortedItems = useMemo(() => {
    let list = [...items];
    if (filter === 'credentials') {
      list = list.filter((row) => getComplianceTypeConfig(row.type)?.hasExpiration === true);
    } else if (filter === 'onboarding') {
      list = list.filter((row) => getComplianceTypeConfig(row.type)?.hasExpiration !== true);
    }
    list.sort((a, b) => {
      const stateA = getExpirationState(a);
      const stateB = getExpirationState(b);
      const order = { expired: 0, expiring_soon: 1, ok: 2 };
      if (order[stateA] !== order[stateB]) return order[stateA] - order[stateB];
      const catA = CATEGORY_ORDER.indexOf(a.category as (typeof CATEGORY_ORDER)[number]);
      const catB = CATEGORY_ORDER.indexOf(b.category as (typeof CATEGORY_ORDER)[number]);
      if (catA !== catB) return catA - catB;
      return (a.title || a.type).localeCompare(b.title || b.type);
    });
    return list;
  }, [items, filter]);

  const groupedByCategory = useMemo(() => {
    const groups: Record<string, (WorkerComplianceItem & { id: string })[]> = {};
    for (const row of filteredAndSortedItems) {
      const c = row.category || 'other';
      if (!groups[c]) groups[c] = [];
      groups[c].push(row);
    }
    return CATEGORY_ORDER.filter((c) => groups[c]?.length).map((cat) => ({ category: cat, rows: groups[cat] }));
  }, [filteredAndSortedItems]);

  const expiredExpiringCounts = useMemo(() => {
    let expired = 0;
    let expiring = 0;
    for (const row of items) {
      const state = getExpirationState(row);
      if (state === 'expired') expired += 1;
      else if (state === 'expiring_soon') expiring += 1;
    }
    return { expired, expiring };
  }, [items]);

  const showExpirationAlert = hasExpiredCompliance(items) || hasExpiringSoonCompliance(items);

  const openAddModal = () => {
    setEditingItem(null);
    setModalOpen(true);
  };
  const openEditModal = (item: WorkerComplianceItem & { id: string }) => {
    setEditingItem(item);
    setModalOpen(true);
  };
  const canEditRow = (row: WorkerComplianceItem & { id: string }) =>
    CREDENTIAL_EDIT_TYPES.includes(row.type as typeof CREDENTIAL_EDIT_TYPES[number]);

  if (!tenantId) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="info">Select a tenant to view compliance items.</Alert>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box sx={{ py: 4, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="subtitle2" color="text.secondary">
        Worker credentials and compliance records (expirations, onboarding sync). Add or edit licenses and permits here.
        Job-specific certification requirements are tracked on the <strong>Assignments</strong> tab.
      </Typography>
      <Stack direction="row" alignItems="center" flexWrap="wrap" gap={1}>
        {/* "Sync from onboarding" button intentionally hidden */}
        <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={openAddModal}>
          Add credential / permit
        </Button>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Show</InputLabel>
          <Select
            value={filter}
            label="Show"
            onChange={(e) => setFilter(e.target.value as 'all' | 'credentials' | 'onboarding')}
          >
            <MenuItem value="all">All items</MenuItem>
            <MenuItem value="credentials">Credentials & expiring only</MenuItem>
            <MenuItem value="onboarding">Onboarding items only</MenuItem>
          </Select>
        </FormControl>
      </Stack>
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {showExpirationAlert && (
        <Alert severity={expiredExpiringCounts.expired > 0 ? 'error' : 'warning'} variant="outlined">
          {expiredExpiringCounts.expired > 0 && 'Some compliance items have expired. '}
          {expiredExpiringCounts.expiring > 0 && 'Some items will expire within 30 days.'}
        </Alert>
      )}
      {items.length > 0 && (expiredExpiringCounts.expired > 0 || expiredExpiringCounts.expiring > 0) && (
        <Typography variant="body2" color="text.secondary">
          {expiredExpiringCounts.expired > 0 && (
            <Chip size="small" label={`${expiredExpiringCounts.expired} expired`} color="error" sx={{ mr: 1 }} />
          )}
          {expiredExpiringCounts.expiring > 0 && (
            <Chip size="small" label={`${expiredExpiringCounts.expiring} expiring within 30 days`} color="warning" />
          )}
        </Typography>
      )}
      {items.length === 0 ? (
        <Alert severity="info">
          No compliance items yet. Use &quot;Add credential / permit&quot; to add licenses and permits.
        </Alert>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Type</TableCell>
                <TableCell>Category</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Required</TableCell>
                <TableCell>Entity</TableCell>
                <TableCell>Issued</TableCell>
                <TableCell>Expires</TableCell>
                <TableCell>Renewal due</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {groupedByCategory.map(({ category, rows }) => (
                <React.Fragment key={category}>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell colSpan={9} sx={{ fontWeight: 600, textTransform: 'capitalize' }}>
                      {category.replace(/_/g, ' ')}
                    </TableCell>
                  </TableRow>
                  {rows.map((row) => {
                    const config = getComplianceTypeConfig(row.type);
                    const issuedAt = row.issuedAt as unknown;
                    const expiresAt = row.expiresAt as unknown;
                    const renewalDueAt = row.renewalDueAt as unknown;
                    const expState = config?.hasExpiration ? expStateToLegacy(getExpirationState(row)) : 'ok';
                    const rowSx =
                      expState === 'expired'
                        ? { borderLeft: '4px solid', borderLeftColor: 'error.main' }
                        : expState === 'expiring'
                          ? { borderLeft: '4px solid', borderLeftColor: 'warning.main' }
                          : {};
                    return (
                      <TableRow key={row.id} sx={rowSx}>
                        <TableCell>
                          <Stack direction="row" alignItems="center" spacing={0.5}>
                            {row.title || getComplianceTypeLabel(row.type)}
                            {expState === 'expiring' && (
                              <WarningAmberIcon fontSize="small" color="warning" titleAccess="Expiring within 30 days" />
                            )}
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Chip label={row.category} size="small" variant="outlined" />
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={getComplianceStatusDisplayLabel(row.status)}
                            size="small"
                            color={STATUS_COLOR[row.status as ComplianceStatus] ?? 'default'}
                          />
                        </TableCell>
                        <TableCell>{row.required ? 'Yes' : 'No'}</TableCell>
                        <TableCell>{row.employmentId ? employmentNames[row.employmentId] ?? row.employmentId : '—'}</TableCell>
                        <TableCell>{formatDate(issuedAt)}</TableCell>
                        <TableCell>{config?.hasExpiration ? formatDate(expiresAt) : '—'}</TableCell>
                        <TableCell>{config?.hasExpiration ? formatDate(renewalDueAt) : '—'}</TableCell>
                        <TableCell align="right">
                          {canEditRow(row) && (
                            <Button
                              size="small"
                              startIcon={<EditIcon />}
                              onClick={() => openEditModal(row)}
                            >
                              Edit
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {tenantId && uid && (
        <ComplianceCredentialModal
          open={modalOpen}
          onClose={() => { setModalOpen(false); setEditingItem(null); }}
          onSaved={loadItems}
          tenantId={tenantId}
          userId={uid}
          item={editingItem}
        />
      )}
    </Stack>
  );
};

export default ComplianceTab;
