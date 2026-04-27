/**
 * GroupMembersTable
 *
 * Shared "members of this group" table used by both classic User Groups
 * (`src/pages/AgencyProfile/components/UserGroupDetails.tsx`) and saved
 * Smart Groups (`src/pages/SavedSmartGroupDetailPage.tsx`).
 *
 * The table itself is a pure presentational component. The parent owns:
 *   - the source list (`members` post-filter / post-sort)
 *   - the current page slice (`paginatedMembers`)
 *   - all per-row data lookups (employment chips, last note, background, etc.)
 *   - selection / pagination / sort state
 *   - bulk action plumbing (the `MessageDrawer` itself stays in the parent so
 *     that the parent can decide what "all results" means for that surface)
 *   - "Group Status" read/write — for User Groups this is persisted on the
 *     `userGroups/{id}.memberStatusById` map; Smart Groups can use the same
 *     shape (the smart-group document) or skip the column entirely by leaving
 *     the column rendering to the default chip + change handler.
 *
 * The bulk-selection toolbar (visible when `selectedIds.size > 0`) and the
 * `StandardTablePagination` row are rendered inside this component so callers
 * get the full "select-all-on-page → select-all-results → bulk action → page
 * through results" flow for free.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Stack,
  Chip,
  Avatar,
  Tooltip,
  Menu,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Checkbox,
  TableSortLabel,
  IconButton,
} from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import SmsIcon from '@mui/icons-material/Sms';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PersonIcon from '@mui/icons-material/Person';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import BlockIcon from '@mui/icons-material/Block';
import { useNavigate } from 'react-router-dom';

import StandardTablePagination from '../components/StandardTablePagination';
import FavoriteButton from '../components/FavoriteButton';
import RecruiterUserTableContactBlock from '../components/tables/RecruiterUserTableContactBlock';
import { useTenantRecruiterNamesByUid } from '../hooks/useTenantRecruiterNamesByUid';
import OrderInterviewInlineAction from '../components/recruiter/OrderInterviewInlineAction';
import BulkOrderInterviewButton from '../components/recruiter/BulkOrderInterviewButton';
import { TABLE_AVATAR_SIZE } from '../utils/uiConstants';
import { formatOneDecimal, normalizeScoreSummary as _normalizeScoreSummary } from '../utils/scoreSummary';
import { getRecruiterScoreDisplayForAdminUi } from '../utils/scoring/recruiterScoreSnapshot';
import { getRecruiterMasterDisplayForAdminUi } from '../utils/scoring/recruiterMasterScoreDisplay';
import {
  getBackgroundBreakdownRows,
  getReadinessBreakdownRows,
  recruiterTableLetterGrade,
} from '../utils/recruiterUsersReadinessDisplay';
import {
  getWorkReadinessEntityChipsDisplay,
  getRecruiterUserTopConcernDetailed,
} from '../utils/recruiterUsersEntityWorkReadiness';
import {
  normalizeRiskProfileFromUserDoc,
  workerRiskPrimaryLine,
  workerRiskTooltipContent,
} from '../utils/workerRiskProfileDisplay';
import {
  formatCategoryScoresCompactPreview,
  formatCategoryScoresCompactPreviewFromPartial,
} from '../utils/parseRecruiterCategoryScores';
import { WorkHistoryJobTitlesCell } from '../components/recruiter/ApplicantsUsersStyleTableCells';

// Suppress unused-import lint: this re-export keeps the symbol available for
// future callers that build their own per-row score normalization without
// having to dig the helper out of utils/scoreSummary.
void _normalizeScoreSummary;

export type GroupMembersSortKey =
  | 'hrxSignup'
  | 'name'
  | 'workReadiness'
  | 'score'
  | 'groupStatus'
  | 'lastLogin';

export type GroupMemberPreferenceStatus = 'preferred' | 'member' | 'not_preferred';

export interface GroupMembersRowDataLookups {
  /** Per-user employment chips (active / onboarding / inactive across entities). */
  entityEmploymentChipsByUser: Map<string, unknown> | undefined;
  /** Per-user employment breakdown rows used by `getReadinessBreakdownRows`. */
  employmentBreakdownByUserId: Map<string, unknown> | undefined;
  /** Per-user latest recruiter note (preview shown in Person column). */
  latestNoteByUserId: Map<string, unknown> | undefined;
  /** Per-user latest interview, used to surface the submitter name. */
  latestInterviewByUserId: Map<string, { createdByName?: string | null }> | undefined;
  /** Per-user latest Accusource background (drives Backgrounds column + concern). */
  latestBackgroundByUserId: Map<string, unknown> | undefined;
  /** Per-user category scores snapshot (drives Score column composition). */
  categoryScoresByUserId: Record<string, unknown>;
  /** tenant userGroups map for the Person column's "in groups" line. */
  groupTitleLookup: Map<string, string>;
}

export interface GroupMembersTableProps {
  tenantId: string;
  /** Full filtered + sorted list. Used for pagination total and bulk recipients. */
  members: any[];
  /** Current page slice (length === rowsPerPage at most). */
  paginatedMembers: any[];
  loading?: boolean;

  // Selection
  selectedIds: Set<string>;
  selectAllResults: boolean;
  onSelectRow: (id: string) => void;
  onSelectAllOnPage: () => void;
  onClearSelection: () => void;
  onSelectAllResults: () => void;

  // Bulk actions (optional — toolbar buttons hidden when not provided)
  onBulkEmail?: () => void;
  onBulkSms?: () => void;

  // Sort
  sortBy: GroupMembersSortKey;
  sortDirection: 'asc' | 'desc';
  onSortChange: (key: GroupMembersSortKey) => void;

  // Pagination
  page: number;
  rowsPerPage: number;
  onPageChange: (page: number) => void;
  onRowsPerPageChange: (rows: number) => void;

  // Per-row data lookups
  rowDataLookups: GroupMembersRowDataLookups;

  // Favorites (Person column heart)
  isUserFavorite: (id: string) => boolean;
  /**
   * Mirrors the `toggleFavorite` signature returned by `useFavorites('users')`
   * — it returns the updated favorite-id list so callers (and `<FavoriteButton>`)
   * can react synchronously to the change.
   */
  toggleUserFavorite: (id: string) => string[];

  // Group status column
  getMemberPreferenceStatus: (user: any) => GroupMemberPreferenceStatus;
  onChangeGroupStatus: (userId: string, status: GroupMemberPreferenceStatus) => void;

  // Remove (optional — when omitted, the trash column header is still rendered
  // but the icon button is hidden so column widths line up between surfaces).
  onRemoveMember?: (userId: string) => void;

  // Row click (optional — defaults to navigate(`/users/${id}`)).
  onRowClick?: (userId: string) => void;

  /** Override the empty-state copy (defaults to "No members in this group."). */
  emptyStateText?: string;
}

const formatDate = (timestamp: any): string => {
  if (!timestamp) return 'N/A';
  let date: Date;
  if (timestamp instanceof Date) {
    date = timestamp;
  } else if (typeof timestamp === 'number') {
    date = new Date(timestamp);
  } else if (timestamp?.toDate) {
    date = timestamp.toDate();
  } else if (timestamp?._seconds) {
    date = new Date(timestamp._seconds * 1000);
  } else {
    return 'N/A';
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const getGroupStatusChipProps = (status: GroupMemberPreferenceStatus) => {
  if (status === 'preferred') {
    return { label: 'Preferred', sx: { bgcolor: '#0057B8', color: '#FFFFFF', fontWeight: 700 } };
  }
  if (status === 'not_preferred') {
    return { label: 'Not Preferred', sx: { bgcolor: '#D14343', color: '#FFFFFF', fontWeight: 700 } };
  }
  return { label: 'Member', sx: { fontWeight: 700 } };
};

const renderAiScore = (
  u: any,
  categoryScoresByUserId: Record<string, unknown>,
): React.ReactElement => {
  const cat = (categoryScoresByUserId as Record<string, any>)[u.id];
  const masterDisp = getRecruiterMasterDisplayForAdminUi({
    recruiterMasterScoreRaw: u.recruiterMasterScore,
    recruiterScoreSnapshotRaw: u.recruiterScoreSnapshot,
    userData: {
      scoreSummary: u.scoreSummary,
      riskProfile: u.riskProfile,
      ...(cat ? { categoryScoresCurrent: cat } : {}),
    },
    latestPrescreenInterviewAi: null,
  });
  const snapDisp = getRecruiterScoreDisplayForAdminUi(u.recruiterScoreSnapshot);
  const rawScore = masterDisp.score100;
  const compositeScore = snapDisp.hasSnapshot ? snapDisp.compositeScore100 : null;
  const categoryPreview =
    snapDisp.hasSnapshot && Object.keys(snapDisp.categoryScores || {}).length > 0
      ? formatCategoryScoresCompactPreviewFromPartial(snapDisp.categoryScores)
      : formatCategoryScoresCompactPreview(((categoryScoresByUserId as any)[u.id] ?? null) as any);
  const categoryLine1 = categoryPreview.slice(0, 3).join(' · ');
  const categoryLine2 = categoryPreview.slice(3).join(' · ');

  if (rawScore === null || Number.isNaN(rawScore)) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.25 }}>
        <Typography variant="body2" color="text.secondary">
          N/A
        </Typography>
        {categoryLine1.length > 0 && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: '0.65rem', lineHeight: 1.25, display: 'block', opacity: 0.88 }}
          >
            {categoryLine1}
          </Typography>
        )}
        {categoryLine2.length > 0 && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: '0.65rem', lineHeight: 1.25, display: 'block', opacity: 0.88 }}
          >
            {categoryLine2}
          </Typography>
        )}
      </Box>
    );
  }
  const displayScore = Math.round(rawScore);
  const grade = masterDisp.grade ?? recruiterTableLetterGrade(displayScore);

  let scoreColor: 'success.main' | 'warning.main' | 'text.primary' = 'text.primary';
  if (displayScore >= 80) scoreColor = 'success.main';
  else if (displayScore >= 60) scoreColor = 'warning.main';

  return (
    <Tooltip
      arrow
      title={
        <Box sx={{ p: 0.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
            Master Recruiter Score
          </Typography>
          <Typography variant="caption" color="inherit" sx={{ display: 'block', mb: 0.5, opacity: 0.9 }}>
            Blended category (50%) · interview (35%) · profile Hiring Score (15%).
          </Typography>
          <Stack spacing={0.25}>
            <Typography variant="body2">
              Master: <strong>{Math.round(rawScore)}</strong>
            </Typography>
            {compositeScore != null ? (
              <Typography variant="caption" color="inherit" sx={{ opacity: 0.9 }}>
                Composite Hiring Score (supporting): <strong>{Math.round(compositeScore)}</strong>
              </Typography>
            ) : null}
            <Typography variant="body2">
              Interview: <strong>{formatOneDecimal(u.scoreSummary?.interviewAvg)}</strong>/10
              {u.scoreSummary?.interviewCount ? ` (${u.scoreSummary.interviewCount})` : ''}
            </Typography>
            <Typography variant="body2">
              Reviews: <strong>{formatOneDecimal(u.scoreSummary?.reviewAvg)}</strong>/5
              {u.scoreSummary?.reviewCount ? ` (${u.scoreSummary.reviewCount})` : ''}
            </Typography>
          </Stack>
        </Box>
      }
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.25 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
          <Typography
            component="span"
            variant="body2"
            sx={{ fontWeight: 700, color: scoreColor, fontSize: '0.8125rem', minWidth: 14 }}
          >
            {grade}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {displayScore}
          </Typography>
        </Box>
        {categoryLine1.length > 0 && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: '0.65rem', lineHeight: 1.25, display: 'block', opacity: 0.88 }}
          >
            {categoryLine1}
          </Typography>
        )}
        {categoryLine2.length > 0 && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: '0.65rem', lineHeight: 1.25, display: 'block', opacity: 0.88 }}
          >
            {categoryLine2}
          </Typography>
        )}
      </Box>
    </Tooltip>
  );
};

const GroupMembersTable: React.FC<GroupMembersTableProps> = ({
  tenantId,
  members,
  paginatedMembers,
  loading = false,
  selectedIds,
  selectAllResults,
  onSelectRow,
  onSelectAllOnPage,
  onClearSelection,
  onSelectAllResults,
  onBulkEmail,
  onBulkSms,
  sortBy,
  sortDirection,
  onSortChange,
  page,
  rowsPerPage,
  onPageChange,
  onRowsPerPageChange,
  rowDataLookups,
  isUserFavorite,
  toggleUserFavorite,
  getMemberPreferenceStatus,
  onChangeGroupStatus,
  onRemoveMember,
  onRowClick,
  emptyStateText = 'No members in this group.',
}) => {
  const navigate = useNavigate();
  const [groupStatusMenuAnchor, setGroupStatusMenuAnchor] = useState<{
    [key: string]: HTMLElement | null;
  }>({});

  const {
    entityEmploymentChipsByUser,
    employmentBreakdownByUserId,
    latestNoteByUserId,
    latestInterviewByUserId,
    latestBackgroundByUserId,
    categoryScoresByUserId,
    groupTitleLookup,
  } = rowDataLookups;

  // Tenant-wide recruiter name map; surfaces "CSA: <name>" on each row
  // (CSA = `users.{uid}.primaryRecruiterId` per RECRUITING_ROLE_MODEL §4.5).
  const recruiterNameByUid = useTenantRecruiterNamesByUid(tenantId);

  const handleOpenGroupStatusMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>, userId: string) => {
      event.stopPropagation();
      setGroupStatusMenuAnchor((prev) => ({ ...prev, [userId]: event.currentTarget }));
    },
    [],
  );

  const handleCloseGroupStatusMenu = useCallback((userId: string) => {
    setGroupStatusMenuAnchor((prev) => ({ ...prev, [userId]: null }));
  }, []);

  const handleStatusSelected = useCallback(
    (userId: string, status: GroupMemberPreferenceStatus) => {
      onChangeGroupStatus(userId, status);
      handleCloseGroupStatusMenu(userId);
    },
    [onChangeGroupStatus, handleCloseGroupStatusMenu],
  );

  const handleRowClick = useCallback(
    (userId: string) => {
      if (onRowClick) {
        onRowClick(userId);
        return;
      }
      navigate(`/users/${userId}`);
    },
    [navigate, onRowClick],
  );

  const selectedCount = selectAllResults ? members.length : selectedIds.size;
  const allOnPageSelected =
    paginatedMembers.length > 0 &&
    paginatedMembers.every((m) => (selectAllResults ? true : selectedIds.has(m.id)));
  const someOnPageSelected =
    paginatedMembers.some((m) => selectedIds.has(m.id)) ||
    (selectAllResults && paginatedMembers.length > 0);

  const showBulkActionButtons = Boolean(onBulkEmail || onBulkSms);

  /**
   * Resolve the current selection back to user objects so the
   * BulkOrderInterviewButton can compute eligibility (interview already
   * completed, missing phone, internal account, etc.). Mirrors the
   * "selectAllResults" semantics used by the existing bulk Email / SMS
   * buttons.
   */
  const selectedUsersForBulk = useMemo(() => {
    if (selectAllResults) return members;
    return members.filter((m) => selectedIds.has(m.id));
  }, [members, selectAllResults, selectedIds]);

  return (
    <>
      {selectedCount > 0 && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            px: 2,
            py: 1.25,
            backgroundColor: 'action.selected',
            border: '1px solid',
            borderColor: 'divider',
            borderBottom: 'none',
            borderRadius: '8px 8px 0 0',
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {selectAllResults
              ? `All ${members.length} result${members.length === 1 ? '' : 's'} selected`
              : `${selectedCount} selected`}
          </Typography>
          <Button size="small" onClick={onClearSelection} sx={{ textTransform: 'none' }}>
            Clear selection
          </Button>
          {allOnPageSelected && !selectAllResults && members.length > paginatedMembers.length && (
            <Button
              size="small"
              variant="outlined"
              onClick={onSelectAllResults}
              sx={{ textTransform: 'none' }}
            >
              Select all {members.length} results
            </Button>
          )}
          {showBulkActionButtons && onBulkEmail && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<EmailIcon />}
              onClick={onBulkEmail}
              sx={{ textTransform: 'none' }}
            >
              Bulk Email
            </Button>
          )}
          {showBulkActionButtons && onBulkSms && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<SmsIcon />}
              onClick={onBulkSms}
              sx={{ textTransform: 'none' }}
            >
              Bulk SMS
            </Button>
          )}
          {/* Order Interviews — same payload as the per-row CTA, looped
              over the eligible subset of the current selection. The
              button hides itself when no one in the selection is
              eligible (already interviewed / no phone / internal). */}
          <BulkOrderInterviewButton
            tenantId={tenantId}
            selectedUsers={selectedUsersForBulk}
          />
        </Box>
      )}

      <TableContainer
        component={Paper}
        elevation={0}
        sx={{
          borderRadius: 2,
          border: '1px solid #EAEEF4',
          ...(selectedCount > 0 && { borderRadius: '0 0 8px 8px' }),
          position: 'relative',
          width: '100%',
          px: 0,
          // `overflow: visible` lets the sticky header attach to the parent
          // page scroll container instead of being trapped inside this Box.
          overflow: 'visible',
        }}
      >
        <Table size="small" stickyHeader sx={{ width: '100%' }}>
          <TableHead
            sx={{
              zIndex: 10,
              '& .MuiTableCell-root': {
                backgroundColor: 'background.paper',
                borderRadius: 0,
                boxShadow: 'inset 0 -1px 0 rgba(0, 0, 0, 0.08)',
              },
            }}
          >
            <TableRow sx={{ backgroundColor: 'background.paper', borderRadius: 0 }}>
              <TableCell padding="checkbox" sx={{ width: 48, bgcolor: '#FFFFFF', borderRadius: 0, py: 1 }}>
                <Checkbox
                  size="small"
                  checked={allOnPageSelected}
                  indeterminate={someOnPageSelected && !allOnPageSelected}
                  onChange={onSelectAllOnPage}
                  aria-label="Select all on page"
                />
              </TableCell>
              <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0, minWidth: 260, py: 1 }}>
                <TableSortLabel
                  active={sortBy === 'hrxSignup'}
                  direction={sortBy === 'hrxSignup' ? sortDirection : 'desc'}
                  onClick={() => onSortChange('hrxSignup')}
                  title="Sort by HRX account signup date (users/{id}.createdAt)"
                >
                  Person
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0, minWidth: 128, py: 1 }}>
                <TableSortLabel
                  active={sortBy === 'workReadiness'}
                  direction={sortBy === 'workReadiness' ? sortDirection : 'desc'}
                  onClick={() => onSortChange('workReadiness')}
                >
                  Employment
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0, minWidth: 120, py: 1 }}>
                Onboarding
              </TableCell>
              <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0, minWidth: 120, py: 1 }}>
                Backgrounds
              </TableCell>
              <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0, minWidth: 72, py: 1 }}>
                <TableSortLabel
                  active={sortBy === 'score'}
                  direction={sortBy === 'score' ? sortDirection : 'desc'}
                  onClick={() => onSortChange('score')}
                >
                  Score
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0, minWidth: 100, py: 1 }}>
                Concern
              </TableCell>
              <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0, minWidth: 140, py: 1 }}>
                Work history
              </TableCell>
              <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', minWidth: 120, borderRadius: 0, py: 1 }}>
                <TableSortLabel
                  active={sortBy === 'lastLogin'}
                  direction={sortBy === 'lastLogin' ? sortDirection : 'desc'}
                  onClick={() => onSortChange('lastLogin')}
                >
                  Last
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                <TableSortLabel
                  active={sortBy === 'groupStatus'}
                  direction={sortBy === 'groupStatus' ? sortDirection : 'asc'}
                  onClick={() => onSortChange('groupStatus')}
                >
                  Status
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ width: 48, bgcolor: '#FFFFFF', borderRadius: 0 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {members.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} sx={{ color: 'text.secondary', fontStyle: 'italic', py: 2 }}>
                  {emptyStateText}
                </TableCell>
              </TableRow>
            ) : (
              paginatedMembers.map((u, idx) => {
                const memberPrefStatus = getMemberPreferenceStatus(u);
                const groupStatusChip = getGroupStatusChipProps(memberPrefStatus);
                const entityItems = entityEmploymentChipsByUser?.get(u.id);
                const wrChips = getWorkReadinessEntityChipsDisplay(entityItems as any);
                const rp = normalizeRiskProfileFromUserDoc(u.riskProfile);
                const fromRisk = workerRiskPrimaryLine(rp);
                const concern =
                  fromRisk ??
                  getRecruiterUserTopConcernDetailed(u, entityItems as any, {
                    latestAccusourceBackground: (latestBackgroundByUserId?.get(u.id) ?? null) as any,
                    categoryScores: ((categoryScoresByUserId as any)[u.id] ?? null) as any,
                  });
                const concernMuted = concern === 'None';
                const concernTip = rp?.topRisks?.length ? workerRiskTooltipContent(rp) : '';

                const empBreakdown = employmentBreakdownByUserId?.get(u.id);

                return (
                  <TableRow
                    key={u.id}
                    hover
                    sx={{
                      cursor: 'pointer',
                      backgroundColor: idx % 2 === 0 ? 'background.paper' : 'action.hover',
                      '&:hover': { backgroundColor: 'action.selected' },
                    }}
                    onClick={() => handleRowClick(u.id)}
                  >
                    <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()} sx={{ py: 0.5, px: 1 }}>
                      <Checkbox
                        size="small"
                        checked={selectAllResults || selectedIds.has(u.id)}
                        onChange={() => onSelectRow(u.id)}
                        aria-label={`Select ${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || 'Select member'}
                      />
                    </TableCell>
                    <TableCell sx={{ minWidth: 260, maxWidth: 380, verticalAlign: 'top', py: 0.5, px: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, minWidth: 0 }}>
                        <Avatar
                          src={u.avatar}
                          alt={`${u.firstName || ''} ${u.lastName || ''}`.trim()}
                          sx={{ width: TABLE_AVATAR_SIZE, height: TABLE_AVATAR_SIZE, flexShrink: 0, mt: 0.125 }}
                        >
                          {String(u.firstName || '').charAt(0)}
                        </Avatar>
                        <Box sx={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, minWidth: 0 }}>
                            <Typography
                              variant="body2"
                              sx={{ fontWeight: 600, flex: 1, minWidth: 0, fontSize: '0.8125rem', lineHeight: 1.3 }}
                              noWrap
                            >
                              {String(u.firstName || '').trim()} {String(u.lastName || '').trim()}
                            </Typography>
                            <Box onClick={(e) => e.stopPropagation()} sx={{ flexShrink: 0, ml: 0.25 }}>
                              <FavoriteButton
                                itemId={u.id}
                                favoriteType="users"
                                isFavorite={isUserFavorite}
                                toggleFavorite={toggleUserFavorite}
                                size="small"
                                tooltipText={{
                                  favorited: 'Remove from favorites',
                                  notFavorited: 'Add to favorites',
                                }}
                                sx={{ p: 0.125, '& .MuiSvgIcon-root': { fontSize: 17 } }}
                              />
                            </Box>
                          </Box>
                          <RecruiterUserTableContactBlock
                            user={u as Record<string, unknown>}
                            latestNote={(latestNoteByUserId?.get(u.id) ?? null) as any}
                            groupTitleLookup={groupTitleLookup}
                            recruiterNameByUid={recruiterNameByUid}
                            formatDate={formatDate}
                          />
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell sx={{ verticalAlign: 'top', py: 0.5, px: 1, maxWidth: 140 }}>
                      {wrChips.length === 0 ? null : (
                        <Stack spacing={0.35} alignItems="flex-start">
                          {wrChips.map((c) => {
                            const chipColor =
                              c.displayState === 'active'
                                ? 'success'
                                : c.displayState === 'onboarding'
                                  ? 'warning'
                                  : 'error';
                            const filled = c.displayState === 'active';
                            return (
                              <Chip
                                key={c.key}
                                label={c.label}
                                size="small"
                                color={chipColor}
                                variant={filled ? 'filled' : 'outlined'}
                                sx={{
                                  height: 22,
                                  maxWidth: '100%',
                                  '& .MuiChip-label': {
                                    px: 0.75,
                                    fontSize: '0.65rem',
                                    fontWeight: 600,
                                    lineHeight: 1.2,
                                  },
                                }}
                              />
                            );
                          })}
                        </Stack>
                      )}
                    </TableCell>
                    <TableCell sx={{ verticalAlign: 'top', py: 0.5, px: 1, maxWidth: 280 }}>
                      <Stack spacing={0.15}>
                        {getReadinessBreakdownRows(u, entityItems as any, {
                          lastInterviewSubmitterName:
                            latestInterviewByUserId?.get(u.id)?.createdByName ?? null,
                          latestAccusourceBackground:
                            (latestBackgroundByUserId?.get(u.id) ?? null) as any,
                          ...(empBreakdown ? { employmentBreakdown: empBreakdown as any } : {}),
                        }).map((row) => (
                          <Box key={row.key} component="span" sx={{ display: 'block' }}>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ lineHeight: 1.3, fontSize: '0.65rem', fontFamily: 'inherit', display: 'block' }}
                            >
                              {row.text}
                            </Typography>
                            {row.sublines?.map((line, i) => (
                              <Typography
                                key={i}
                                variant="caption"
                                color="text.secondary"
                                sx={{ display: 'block', pl: 0.5, fontSize: '0.6rem', lineHeight: 1.25, opacity: 0.95 }}
                              >
                                {line}
                              </Typography>
                            ))}
                          </Box>
                        ))}
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ verticalAlign: 'top', py: 0.5, px: 1, maxWidth: 260 }}>
                      <Stack spacing={0.15}>
                        {getBackgroundBreakdownRows(u, entityItems as any, {
                          latestAccusourceBackground:
                            (latestBackgroundByUserId?.get(u.id) ?? null) as any,
                        }).map((row) => (
                          <Box key={row.key} component="span" sx={{ display: 'block' }}>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ lineHeight: 1.3, fontSize: '0.65rem', fontFamily: 'inherit', display: 'block' }}
                            >
                              {row.text}
                            </Typography>
                            {row.sublines?.map((line, i) => (
                              <Typography
                                key={i}
                                variant="caption"
                                color="text.secondary"
                                sx={{ display: 'block', pl: 0.5, fontSize: '0.6rem', lineHeight: 1.25, opacity: 0.95 }}
                              >
                                {line}
                              </Typography>
                            ))}
                          </Box>
                        ))}
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ verticalAlign: 'top', py: 0.5, px: 1 }}>
                      {renderAiScore(u, categoryScoresByUserId)}
                    </TableCell>
                    <TableCell sx={{ verticalAlign: 'top', py: 0.5, px: 1 }}>
                      {concernTip ? (
                        <Tooltip
                          title={<span style={{ whiteSpace: 'pre-wrap' }}>{concernTip}</span>}
                          placement="top"
                          enterDelay={350}
                        >
                          <Typography
                            variant="caption"
                            color={concernMuted ? 'text.secondary' : 'text.primary'}
                            sx={{ fontWeight: 400, fontSize: '0.65rem', lineHeight: 1.3, fontFamily: 'inherit', display: 'block' }}
                          >
                            {concern}
                          </Typography>
                        </Tooltip>
                      ) : (
                        <Typography
                          variant="caption"
                          color={concernMuted ? 'text.secondary' : 'text.primary'}
                          sx={{ fontWeight: 400, fontSize: '0.65rem', lineHeight: 1.3, fontFamily: 'inherit', display: 'block' }}
                        >
                          {concern}
                        </Typography>
                      )}
                      <OrderInterviewInlineAction user={u as any} tenantId={tenantId} />
                    </TableCell>
                    <TableCell sx={{ verticalAlign: 'top', py: 0.5, px: 1, maxWidth: 200 }}>
                      <WorkHistoryJobTitlesCell user={u as Record<string, unknown>} />
                    </TableCell>
                    <TableCell sx={{ minWidth: 120, verticalAlign: 'top', py: 0.5, px: 1 }}>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ fontSize: '0.8125rem', lineHeight: 1.3 }}
                      >
                        {formatDate(u.lastLoginAt)}
                      </Typography>
                    </TableCell>
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <Chip
                        size="small"
                        label={groupStatusChip.label}
                        variant={memberPrefStatus === 'member' ? 'outlined' : 'filled'}
                        onClick={(e) => handleOpenGroupStatusMenu(e, u.id)}
                        sx={{ cursor: 'pointer', ...(groupStatusChip.sx || {}) }}
                      />
                      <Menu
                        anchorEl={groupStatusMenuAnchor[u.id]}
                        open={Boolean(groupStatusMenuAnchor[u.id])}
                        onClose={() => handleCloseGroupStatusMenu(u.id)}
                        sx={{ zIndex: 2000 }}
                      >
                        <MenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStatusSelected(u.id, 'member');
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <PersonIcon fontSize="small" />
                            Member
                          </Box>
                        </MenuItem>
                        <MenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStatusSelected(u.id, 'preferred');
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <CheckCircleIcon fontSize="small" />
                            Preferred
                          </Box>
                        </MenuItem>
                        <MenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStatusSelected(u.id, 'not_preferred');
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
                            <BlockIcon fontSize="small" />
                            Not Preferred
                          </Box>
                        </MenuItem>
                      </Menu>
                    </TableCell>
                    <TableCell onClick={(event) => event.stopPropagation()} sx={{ width: 48 }}>
                      {onRemoveMember ? (
                        <Tooltip title="Remove from group" arrow>
                          <span>
                            <IconButton
                              size="small"
                              onClick={() => onRemoveMember(u.id)}
                              disabled={loading}
                              sx={{ color: 'error.main' }}
                            >
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <StandardTablePagination
        count={members.length}
        page={page}
        rowsPerPage={rowsPerPage}
        onPageChange={(_e, newPage) => onPageChange(newPage)}
        onRowsPerPageChange={(e) => {
          onRowsPerPageChange(parseInt(e.target.value, 10));
          onPageChange(0);
        }}
      />
    </>
  );
};

export default GroupMembersTable;
