/**
 * **E.7** — `CsaActionQueue` — unified action-queue tab for the
 * `/staff-onboarding` "To-Do" surface.
 *
 * Replaces the previous "Tax and Payroll" + "E-Verify" tabs with a
 * single tenant-wide list of (worker × action) pairs the CSA needs to
 * act on. Item types ordered by federal-deadline priority:
 *
 *   1. Address E-Verify TNC — 8 federal working days to contest
 *   2. Complete I-9 Section 2 — 3 business days from hire
 *   3. Start E-Verify case — 3 business days from hire (downstream of #2)
 *
 * Data: `useCsaActionQueueItems` provides the aggregated, sorted list.
 * UI: scope toggle (My / All) + name/email/phone search + paginated
 * card-list. The I-9 Section 2 action opens an inline dialog
 * (`I9Section2CompleteDialog`); the E-Verify actions navigate to the
 * worker profile so the existing R.5 surfaces (StartEverifySelectDialog
 * + EverifyComplianceCard TNC flow) handle the rich form work.
 *
 * Live updates: the underlying hook subscribes to `entity_employments`
 * via `onSnapshot`. When the I-9 Section 2 dialog completes, the
 * trigger-driven readiness rewrite + the entity_employments stamp
 * update flow back through the listener and the row disappears without
 * a manual refresh.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Snackbar,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';

import StandardTablePagination from '../StandardTablePagination';
import OnboardingQueueWorkerSearchField from './OnboardingQueueWorkerSearchField';
import I9Section2CompleteDialog from './I9Section2CompleteDialog';
import { useAuth } from '../../contexts/AuthContext';
import useCsaActionQueueItems from '../../hooks/useCsaActionQueueItems';
import {
  CSA_ACTION_LABELS,
  csaActionItemMatchesSearch,
  type CsaActionItem,
  type CsaActionType,
} from '../../types/csaActionQueue';
import { TABLE_AVATAR_SIZE } from '../../utils/uiConstants';

/* ────────────────────────── small helpers ────────────────────────── */

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatRelative(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  return `${months} mo ago`;
}

function actionTypeChip(actionType: CsaActionType): {
  label: string;
  color: 'error' | 'warning' | 'info';
} {
  switch (actionType) {
    case 'address_tnc':
      return { label: 'TNC — federal deadline', color: 'error' };
    case 'i9_section_2':
      return { label: 'I-9 Section 2', color: 'warning' };
    case 'start_everify':
      return { label: 'Start E-Verify', color: 'info' };
    default:
      return { label: actionType, color: 'info' };
  }
}

function buildSubLine(item: CsaActionItem): string {
  switch (item.actionType) {
    case 'address_tnc': {
      const tncAge = formatRelative(item.ageMs);
      return `${item.entityName} · TNC received ${tncAge} · Worker has 8 federal working days to contest`;
    }
    case 'i9_section_2': {
      const sec1 = formatRelative(item.ageMs);
      return `${item.entityName} · Worker signed Section 1 ${sec1}`;
    }
    case 'start_everify': {
      const fully = formatRelative(item.ageMs);
      return `${item.entityName} · I-9 fully signed ${fully}`;
    }
    default:
      return item.entityName;
  }
}

/* ────────────────────────── component ────────────────────────── */

export interface CsaActionQueueProps {
  tenantId: string | undefined;
}

const CsaActionQueue: React.FC<CsaActionQueueProps> = ({ tenantId }) => {
  const { user, securityLevel, isHRX } = useAuth();
  const currentUserUid = user?.uid ?? null;

  // CSAs default to "mine"; HRX admins (security level 7 OR isHRX claim)
  // default to "all". Stored in component state — no sessionStorage
  // persistence yet (matches RD.1's decision; storing it would risk a
  // CSA seeing All on a fresh login when their job is fundamentally
  // about their own queue).
  const isHrxAdmin = isHRX || securityLevel === '7';
  const [scope, setScope] = useState<'mine' | 'all'>(isHrxAdmin ? 'all' : 'mine');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const [section2DialogItem, setSection2DialogItem] = useState<CsaActionItem | null>(null);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    severity: 'success' | 'info' | 'error';
    message: string;
  }>({ open: false, severity: 'success', message: '' });

  const navigate = useNavigate();

  const { items, loading, error } = useCsaActionQueueItems({
    tenantId,
    currentUserUid,
    scope,
  });

  const filtered = useMemo(
    () => items.filter((it) => csaActionItemMatchesSearch(it, search)),
    [items, search],
  );

  const pagedItems = useMemo(() => {
    const start = page * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  // Reset page on filter change so we don't stay on a now-empty page.
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPage(0);
  }, []);

  const handleScopeChange = useCallback((_e: unknown, next: 'mine' | 'all' | null) => {
    if (next != null) {
      setScope(next);
      setPage(0);
    }
  }, []);

  const handleStartEverify = useCallback(
    (item: CsaActionItem) => {
      // Navigate to worker profile → Employment tab focused on E-Verify.
      // The existing `StartEverifySelectDialog` lives there and handles
      // the rich form work; bringing it inline would mean duplicating
      // 1.6k lines of ICA-mapping + supporting-doc logic. Once the user
      // profile path lands, the row disappears from the queue via the
      // entity_employments listener.
      const params = new URLSearchParams();
      params.set('employmentFocus', 'Employment');
      params.set('employmentScrollTo', 'e_verify');
      if (item.entityKey) {
        params.set('employmentEntityKey', item.entityKey);
      }
      navigate(`/users/${encodeURIComponent(item.workerUid)}?${params.toString()}`);
    },
    [navigate],
  );

  const handleAddressTnc = useCallback(
    (item: CsaActionItem) => {
      const params = new URLSearchParams();
      params.set('employmentFocus', 'Employment');
      params.set('employmentScrollTo', 'e_verify');
      if (item.entityKey) {
        params.set('employmentEntityKey', item.entityKey);
      }
      navigate(`/users/${encodeURIComponent(item.workerUid)}?${params.toString()}`);
    },
    [navigate],
  );

  const handlePrimaryAction = useCallback(
    (item: CsaActionItem) => {
      switch (item.actionType) {
        case 'i9_section_2':
          setSection2DialogItem(item);
          break;
        case 'start_everify':
          handleStartEverify(item);
          break;
        case 'address_tnc':
          handleAddressTnc(item);
          break;
        default:
          break;
      }
    },
    [handleStartEverify, handleAddressTnc],
  );

  const handleSection2Completed = useCallback((entityEmploymentId: string) => {
    setSnackbar({
      open: true,
      severity: 'success',
      message: 'I-9 Section 2 marked complete.',
    });
    // Row disappears via the entity_employments listener — no manual refresh needed.
    void entityEmploymentId;
  }, []);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minHeight: 0 }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        alignItems={{ xs: 'flex-start', md: 'center' }}
      >
        <ToggleButtonGroup
          value={scope}
          exclusive
          size="small"
          onChange={handleScopeChange}
          sx={{
            '& .MuiToggleButton-root': {
              textTransform: 'none',
              borderRadius: '999px',
              fontSize: '13px',
              px: 1.5,
              py: 0.5,
              minHeight: 30,
              border: '1px solid rgba(0, 0, 0, 0.12)',
            },
            '& .MuiToggleButton-root.Mui-selected': {
              bgcolor: '#0057B8',
              color: 'white',
              fontWeight: 600,
              '&:hover': { bgcolor: '#004a9f' },
            },
            gap: 0.5,
          }}
        >
          <Tooltip title="Workers I'm the Candidate Success Agent for">
            <ToggleButton value="mine" aria-label="My users">
              My Users
            </ToggleButton>
          </Tooltip>
          <Tooltip title="All workers in this tenant">
            <ToggleButton value="all" aria-label="All users">
              All Users
            </ToggleButton>
          </Tooltip>
        </ToggleButtonGroup>

        <Box sx={{ flex: 1 }} />

        <OnboardingQueueWorkerSearchField
          id="csa-action-queue-search"
          value={search}
          onChange={handleSearchChange}
        />
      </Stack>

      {error ? <Alert severity="error">{error}</Alert> : null}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress size={24} />
        </Box>
      ) : null}

      {!loading && filtered.length === 0 ? (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            py: 8,
            gap: 1,
            color: 'text.secondary',
          }}
          data-testid="csa-action-queue-empty"
        >
          <CheckCircleOutlineIcon color="success" />
          <Typography variant="subtitle2" fontWeight={600}>
            All caught up — no action items pending.
          </Typography>
          <Typography variant="caption" color="text.secondary">
            When workers complete their portion of onboarding, items appear here.
          </Typography>
        </Box>
      ) : null}

      {!loading && filtered.length > 0 ? (
        <Stack spacing={1} sx={{ width: '100%' }} data-testid="csa-action-queue-list">
          {pagedItems.map((item) => {
            const chip = actionTypeChip(item.actionType);
            const labels = CSA_ACTION_LABELS[item.actionType];
            return (
              <Stack
                key={item.id}
                data-testid={`csa-action-queue-item-${item.id}`}
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                alignItems={{ sm: 'center' }}
                sx={{
                  py: 1.25,
                  px: 1.5,
                  borderRadius: 1,
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ flex: 1, minWidth: 0 }}>
                  <Avatar
                    src={item.workerAvatarUrl ?? undefined}
                    alt=""
                    sx={{ width: TABLE_AVATAR_SIZE, height: TABLE_AVATAR_SIZE, fontSize: 13 }}
                  >
                    {initials(item.workerName)}
                  </Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <Typography variant="body2" fontWeight={700} noWrap>
                        {item.workerName}
                      </Typography>
                      <Chip
                        size="small"
                        label={chip.label}
                        color={chip.color}
                        variant="outlined"
                        sx={{ fontWeight: 600 }}
                      />
                    </Stack>
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 600, color: 'text.primary', mt: 0.25 }}
                    >
                      {labels.title} — {item.workerName}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block' }}
                    >
                      {buildSubLine(item)}
                    </Typography>
                  </Box>
                </Stack>
                <Box sx={{ flexShrink: 0 }}>
                  <Button
                    variant="contained"
                    size="small"
                    sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
                    onClick={() => handlePrimaryAction(item)}
                    data-testid={`csa-action-queue-button-${item.id}`}
                  >
                    {labels.primaryButton}
                  </Button>
                </Box>
              </Stack>
            );
          })}

          <StandardTablePagination
            count={filtered.length}
            page={page}
            onPageChange={(_e, next) => setPage(next)}
            rowsPerPage={pageSize}
            rowsPerPageOptions={[25, 50, 100]}
            onRowsPerPageChange={(e) => {
              setPageSize(parseInt(e.target.value, 10) || 25);
              setPage(0);
            }}
          />
        </Stack>
      ) : null}

      <I9Section2CompleteDialog
        open={section2DialogItem != null}
        item={section2DialogItem}
        tenantId={tenantId}
        onClose={() => setSection2DialogItem(null)}
        onCompleted={handleSection2Completed}
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} variant="filled" sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default CsaActionQueue;
