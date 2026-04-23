/**
 * Shared members table for tenant user groups — matches Users-style columns, Group Status, and remove.
 * Used by Agency UserGroupDetails and RecruiterUserGroupDetails.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControl,
  InputLabel,
  Menu,
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
  TableSortLabel,
  Tooltip,
  Typography,
  IconButton,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EmailIcon from '@mui/icons-material/Email';
import PersonIcon from '@mui/icons-material/Person';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import BlockIcon from '@mui/icons-material/Block';
import SmsIcon from '@mui/icons-material/Sms';
import { useNavigate } from 'react-router-dom';
import MessageDrawer, { type MessageRecipient } from '../../MessageDrawer';
import FavoriteButton from '../../FavoriteButton';
import { useFavorites } from '../../../hooks/useFavorites';
import StandardTablePagination from '../../StandardTablePagination';
import { TABLE_AVATAR_SIZE } from '../../../utils/uiConstants';
import RecruiterUserTableContactBlock from '../../tables/RecruiterUserTableContactBlock';
import { formatOneDecimal } from '../../../utils/scoreSummary';
import { getRecruiterMasterDisplayForAdminUi } from '../../../utils/scoring/recruiterMasterScoreDisplay';
import { getRecruiterScoreDisplayForAdminUi } from '../../../utils/scoring/recruiterScoreSnapshot';
import {
  getBackgroundBreakdownRows,
  getReadinessBreakdownRows,
  recruiterTableLetterGrade,
} from '../../../utils/recruiterUsersReadinessDisplay';
import {
  compareWorkReadinessForEntity,
  getWorkReadinessEntityChipsDisplay,
  getRecruiterUserTopConcernDetailed,
} from '../../../utils/recruiterUsersEntityWorkReadiness';
import {
  normalizeRiskProfileFromUserDoc,
  workerRiskPrimaryLine,
  workerRiskTooltipContent,
} from '../../../utils/workerRiskProfileDisplay';
import {
  formatCategoryScoresCompactPreview,
  formatCategoryScoresCompactPreviewFromPartial,
} from '../../../utils/parseRecruiterCategoryScores';
import { useCategoryScoresCurrentMap } from '../../../hooks/useCategoryScoresCurrentMap';
import { useRecruiterUsersRowExtras } from '../../../hooks/useRecruiterUsersRowExtras';
import { useRecruiterUsersLatestBackgroundChecks } from '../../../hooks/useRecruiterUsersLatestBackgroundChecks';
import { useRecruiterUsersEntityEmploymentChips } from '../../../hooks/useRecruiterUsersEntityEmploymentChips';
import { WorkHistoryJobTitlesCell } from '../ApplicantsUsersStyleTableCells';
export type MemberPreferenceStatus = 'preferred' | 'member' | 'not_preferred';

export type UserGroupMembersTableProps = {
  tenantId: string;
  groupId: string;
  memberIds: string[];
  memberStatusById: Record<string, string> | undefined;
  membersData: any[];
  tenantGroupRows: Array<{ id: string; title?: string }>;
  loading: boolean;
  onRemoveMember: (userId: string) => Promise<void>;
  onChangeGroupStatus: (userId: string, status: MemberPreferenceStatus) => Promise<void>;
  searchQuery?: string;
  toolbarExtra?: React.ReactNode;
};

const UserGroupMembersTable: React.FC<UserGroupMembersTableProps> = ({
  tenantId,
  groupId: _groupId,
  memberIds,
  memberStatusById,
  membersData,
  tenantGroupRows,
  loading,
  onRemoveMember,
  onChangeGroupStatus,
  searchQuery,
  toolbarExtra,
}) => {
  const navigate = useNavigate();
  const { isFavorite: isUserFavorite, toggleFavorite: toggleUserFavorite } = useFavorites('users');
  const [membersPage, setMembersPage] = useState(0);
  const [membersRowsPerPage, setMembersRowsPerPage] = useState(20);
  const [membersSortBy, setMembersSortBy] = useState<
    'hrxSignup' | 'name' | 'workReadiness' | 'score' | 'groupStatus' | 'lastLogin'
  >('hrxSignup');
  const [membersSortDirection, setMembersSortDirection] = useState<'asc' | 'desc'>('desc');
  const [groupStatusMenuAnchor, setGroupStatusMenuAnchor] = useState<{ [key: string]: HTMLElement | null }>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAllResults, setSelectAllResults] = useState(false);
  const [bulkDrawerOpen, setBulkDrawerOpen] = useState(false);
  const [bulkDrawerChannel, setBulkDrawerChannel] = useState<'email' | 'sms'>('email');

  const groupTitleLookup = useMemo(() => {
    const m = new Map<string, string>();
    tenantGroupRows.forEach((g) => m.set(g.id, g.title || g.id));
    return m;
  }, [tenantGroupRows]);

  const membersInput = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    if (!q) return membersData;
    return membersData.filter((u: any) => {
      const name = `${String(u.firstName || '')} ${String(u.lastName || '')}`.toLowerCase();
      const email = String(u.email || '').toLowerCase();
      const phone = String(u.phone || u.phoneE164 || '').toLowerCase();
      const skills = Array.isArray(u.skills) ? u.skills.map((s: any) => String(s).toLowerCase()).join(' ') : '';
      return name.includes(q) || email.includes(q) || phone.includes(q) || skills.includes(q);
    });
  }, [membersData, searchQuery]);

  const members = membersInput;

  const toMillis = (input: any): number => {
    if (!input) return 0;
    if (input instanceof Date) return input.getTime();
    if (typeof input === 'number') return input;
    if (typeof input === 'string') {
      const parsed = Date.parse(input);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    if (typeof input === 'object') {
      if (typeof input.toDate === 'function') return input.toDate().getTime();
      if (typeof input._seconds === 'number') return input._seconds * 1000;
    }
    return 0;
  };

  const getScoreNumber = (u: any): number => {
    const m = getRecruiterMasterDisplayForAdminUi({
      recruiterMasterScoreRaw: u.recruiterMasterScore,
      recruiterScoreSnapshotRaw: u.recruiterScoreSnapshot,
      userData: {
        scoreSummary: u.scoreSummary,
        riskProfile: u.riskProfile,
      },
      latestPrescreenInterviewAi: null,
    });
    if (m.score100 != null && !Number.isNaN(m.score100)) return m.score100;
    return -1;
  };

  const getNameKey = (u: any): string => {
    const first = String(u?.firstName || '').trim().toLowerCase();
    const last = String(u?.lastName || '').trim().toLowerCase();
    return `${last}|${first}|${String(u?.id || '')}`;
  };

  const getMemberPreferenceStatus = (u: any): MemberPreferenceStatus => {
    const raw = memberStatusById?.[u?.id];
    if (raw === 'preferred' || raw === 'member' || raw === 'not_preferred') return raw;
    return 'member';
  };
  const getGroupStatusKey = (u: any): number => {
    const status = getMemberPreferenceStatus(u);
    if (status === 'preferred') return 0;
    if (status === 'member') return 1;
    return 2;
  };

  const { itemsByUserId: entityEmploymentChipsByUser, employmentBreakdownByUserId, loading: _entityChipsLoading } =
    useRecruiterUsersEntityEmploymentChips(tenantId, memberIds);

  const sortedMembers = useMemo(() => {
    const copy = [...members];
    copy.sort((a: any, b: any) => {
      if (membersSortBy === 'workReadiness') {
        return compareWorkReadinessForEntity(
          entityEmploymentChipsByUser.get(a.id),
          entityEmploymentChipsByUser.get(b.id),
          'select',
          membersSortDirection,
        );
      }
      let cmp = 0;
      switch (membersSortBy) {
        case 'hrxSignup': {
          cmp = toMillis(a?.createdAt) - toMillis(b?.createdAt);
          break;
        }
        case 'name': {
          cmp = getNameKey(a).localeCompare(getNameKey(b));
          break;
        }
        case 'score': {
          cmp = getScoreNumber(a) - getScoreNumber(b);
          break;
        }
        case 'groupStatus': {
          cmp = getGroupStatusKey(a) - getGroupStatusKey(b);
          break;
        }
        case 'lastLogin': {
          cmp = toMillis(a?.lastLoginAt) - toMillis(b?.lastLoginAt);
          break;
        }
        default:
          cmp = 0;
      }
      return membersSortDirection === 'asc' ? cmp : -cmp;
    });
    return copy;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sort helpers close over getGroupStatusKey / getNameKey / getScoreNumber
  }, [members, membersSortBy, membersSortDirection, entityEmploymentChipsByUser, memberStatusById]);

  const paginatedMembers = useMemo(
    () =>
      sortedMembers.slice(
        membersPage * membersRowsPerPage,
        membersPage * membersRowsPerPage + membersRowsPerPage,
      ),
    [sortedMembers, membersPage, membersRowsPerPage],
  );

  const paginatedMemberIds = useMemo(() => paginatedMembers.map((m) => m.id), [paginatedMembers]);

  const { scoresByUserId: categoryScoresByUserId } = useCategoryScoresCurrentMap(paginatedMemberIds);
  const { latestNoteByUserId, latestInterviewByUserId } = useRecruiterUsersRowExtras(paginatedMemberIds);
  const { latestByUserId: latestBackgroundByUserId } = useRecruiterUsersLatestBackgroundChecks(
    tenantId,
    paginatedMemberIds,
  );
  const selectedCount = selectAllResults ? sortedMembers.length : selectedIds.size;
  const allOnPageSelected =
    paginatedMembers.length > 0 &&
    paginatedMembers.every((m) => (selectAllResults ? true : selectedIds.has(m.id)));
  const someOnPageSelected =
    paginatedMembers.some((m) => selectedIds.has(m.id)) || (selectAllResults && paginatedMembers.length > 0);

  const handleSelectAllOnPage = useCallback(() => {
    if (allOnPageSelected) {
      if (selectAllResults) {
        setSelectAllResults(false);
        setSelectedIds(new Set());
      } else {
        const onPageIds = new Set(paginatedMembers.map((m) => m.id));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          onPageIds.forEach((id) => next.delete(id));
          return next;
        });
      }
    } else {
      if (selectAllResults) {
        setSelectedIds(new Set(paginatedMembers.map((m) => m.id)));
        setSelectAllResults(false);
      } else {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          paginatedMembers.forEach((m) => next.add(m.id));
          return next;
        });
      }
    }
  }, [allOnPageSelected, selectAllResults, paginatedMembers]);

  const handleSelectRow = useCallback(
    (id: string) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      if (selectAllResults) setSelectAllResults(false);
    },
    [selectAllResults],
  );

  const handleSelectAllResults = useCallback(() => {
    setSelectAllResults(true);
    setSelectedIds(new Set(sortedMembers.map((m) => m.id)));
  }, [sortedMembers]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectAllResults(false);
  }, []);

  const bulkRecipientsAndIds = useMemo(() => {
    const users = selectAllResults
      ? sortedMembers
      : sortedMembers.filter((m) => selectedIds.has(m.id));
    const recipients: MessageRecipient[] = users.map((u) => ({
      userId: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Unknown',
      email: u.email ?? undefined,
      phone: u.phone ?? undefined,
    }));
    const recipientUserIds = users.map((u) => u.id);
    return { recipients, recipientUserIds };
  }, [selectAllResults, selectedIds, sortedMembers]);

  const handleMembersSort = (key: typeof membersSortBy) => {
    if (membersSortBy === key) {
      setMembersSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      setMembersPage(0);
      return;
    }
    setMembersSortBy(key);
    setMembersSortDirection(key === 'name' ? 'asc' : 'desc');
    setMembersPage(0);
  };

  const handleOpenGroupStatusMenu = (event: React.MouseEvent<HTMLElement>, userId: string) => {
    event.stopPropagation();
    setGroupStatusMenuAnchor((prev) => ({ ...prev, [userId]: event.currentTarget }));
  };
  const handleCloseGroupStatusMenu = (userId: string) => {
    setGroupStatusMenuAnchor((prev) => ({ ...prev, [userId]: null }));
  };

  const applyGroupStatus = async (userId: string, status: MemberPreferenceStatus) => {
    try {
      await onChangeGroupStatus(userId, status);
    } finally {
      handleCloseGroupStatusMenu(userId);
    }
  };

  const getGroupStatusChipProps = (status: MemberPreferenceStatus) => {
    if (status === 'preferred') {
      return { label: 'Preferred', sx: { bgcolor: '#0057B8', color: '#FFFFFF', fontWeight: 700 } };
    }
    if (status === 'not_preferred') {
      return { label: 'Not Preferred', sx: { bgcolor: '#D14343', color: '#FFFFFF', fontWeight: 700 } };
    }
    return { label: 'Member', sx: { fontWeight: 700 } };
  };

  const formatDate = (timestamp: any) => {
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

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const renderAiScore = (u: any) => {
    const cat = categoryScoresByUserId[u.id];
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
        : formatCategoryScoresCompactPreview(categoryScoresByUserId[u.id] ?? null);
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
              sx={{
                fontWeight: 700,
                color: scoreColor,
                fontSize: '0.8125rem',
                minWidth: 14,
              }}
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

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1.5, flexWrap: 'wrap', mb: 1 }}>
        {toolbarExtra}
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel id="user-group-member-order-label">Order members</InputLabel>
          <Select
            labelId="user-group-member-order-label"
            label="Order members"
            value={
              membersSortBy === 'hrxSignup' || membersSortBy === 'name'
                ? `${membersSortBy}:${membersSortDirection}`
                : ''
            }
            displayEmpty
            renderValue={(v) => {
              if (v === 'hrxSignup:desc') return 'HRX signup (newest first)';
              if (v === 'hrxSignup:asc') return 'HRX signup (oldest first)';
              if (v === 'name:asc') return 'Name (A–Z)';
              if (v === 'name:desc') return 'Name (Z–A)';
              return 'Column sort (see headers)';
            }}
            onChange={(e) => {
              const raw = String(e.target.value);
              const [k, d] = raw.split(':') as ['hrxSignup' | 'name', 'asc' | 'desc'];
              if (k === 'hrxSignup' || k === 'name') {
                setMembersSortBy(k);
                setMembersSortDirection(d);
                setMembersPage(0);
              }
            }}
          >
            <MenuItem value="hrxSignup:desc">HRX signup (newest first)</MenuItem>
            <MenuItem value="hrxSignup:asc">HRX signup (oldest first)</MenuItem>
            <MenuItem value="name:asc">Name (A–Z)</MenuItem>
            <MenuItem value="name:desc">Name (Z–A)</MenuItem>
          </Select>
        </FormControl>
      </Box>
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
                    ? `All ${sortedMembers.length} result${sortedMembers.length === 1 ? '' : 's'} selected`
                    : `${selectedCount} selected`}
                </Typography>
                <Button size="small" onClick={handleClearSelection} sx={{ textTransform: 'none' }}>
                  Clear selection
                </Button>
                {allOnPageSelected && !selectAllResults && sortedMembers.length > paginatedMembers.length && (
                  <Button size="small" variant="outlined" onClick={handleSelectAllResults} sx={{ textTransform: 'none' }}>
                    Select all {sortedMembers.length} results
                  </Button>
                )}
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<EmailIcon />}
                  onClick={() => {
                    setBulkDrawerChannel('email');
                    setBulkDrawerOpen(true);
                  }}
                  sx={{ textTransform: 'none' }}
                >
                  Bulk Email
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<SmsIcon />}
                  onClick={() => {
                    setBulkDrawerChannel('sms');
                    setBulkDrawerOpen(true);
                  }}
                  sx={{ textTransform: 'none' }}
                >
                  Bulk SMS
                </Button>
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
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                overflowY: 'auto',
                overflowX: 'auto',
                width: '100%',
                px: 0,
                '&::-webkit-scrollbar': { width: '8px', height: '8px' },
                '&::-webkit-scrollbar-track': {
                  background: 'rgba(0, 0, 0, 0.02)',
                  borderRadius: '4px',
                },
                '&::-webkit-scrollbar-thumb': {
                  background: 'rgba(0, 0, 0, 0.15)',
                  borderRadius: '4px',
                  '&:hover': { background: 'rgba(0, 0, 0, 0.25)' },
                },
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
              }}
            >
              <Table size="small" stickyHeader sx={{ width: '100%' }}>
                <TableHead
                  sx={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 10,
                    backgroundColor: 'background.paper',
                    borderRadius: 0,
                    '& .MuiTableCell-root': {
                      borderRadius: 0,
                    },
                  }}
                >
                  <TableRow sx={{ backgroundColor: 'background.paper', borderRadius: 0 }}>
                    <TableCell padding="checkbox" sx={{ width: 48, bgcolor: '#FFFFFF', borderRadius: 0, py: 1 }}>
                      <Checkbox
                        size="small"
                        checked={allOnPageSelected}
                        indeterminate={someOnPageSelected}
                        onChange={handleSelectAllOnPage}
                        aria-label="Select all on page"
                      />
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0, minWidth: 260, py: 1 }}>
                      <TableSortLabel
                        active={membersSortBy === 'hrxSignup'}
                        direction={membersSortBy === 'hrxSignup' ? membersSortDirection : 'desc'}
                        onClick={() => handleMembersSort('hrxSignup')}
                        title="Sort by HRX account signup date (users/{id}.createdAt)"
                      >
                        Person
                      </TableSortLabel>
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0, minWidth: 128, py: 1 }}>
                      <TableSortLabel
                        active={membersSortBy === 'workReadiness'}
                        direction={membersSortBy === 'workReadiness' ? membersSortDirection : 'desc'}
                        onClick={() => handleMembersSort('workReadiness')}
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
                        active={membersSortBy === 'score'}
                        direction={membersSortBy === 'score' ? membersSortDirection : 'desc'}
                        onClick={() => handleMembersSort('score')}
                      >
                        Score
                      </TableSortLabel>
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0, minWidth: 100, py: 1 }}>
                      Risk / concern
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0, minWidth: 140, py: 1 }}>
                      Work history
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', minWidth: 120, borderRadius: 0, py: 1 }}>
                      <TableSortLabel
                        active={membersSortBy === 'lastLogin'}
                        direction={membersSortBy === 'lastLogin' ? membersSortDirection : 'desc'}
                        onClick={() => handleMembersSort('lastLogin')}
                      >
                        Last activity
                      </TableSortLabel>
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                      <TableSortLabel
                        active={membersSortBy === 'groupStatus'}
                        direction={membersSortBy === 'groupStatus' ? membersSortDirection : 'asc'}
                        onClick={() => handleMembersSort('groupStatus')}
                      >
                        Group Status
                      </TableSortLabel>
                    </TableCell>
                    <TableCell sx={{ width: 48, bgcolor: '#FFFFFF', borderRadius: 0 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {members.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} sx={{ color: 'text.secondary', fontStyle: 'italic', py: 2 }}>
                        No members in this group.
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedMembers.map((u, idx) => {
                      const memberPrefStatus = getMemberPreferenceStatus(u);
                      const groupStatusChip = getGroupStatusChipProps(memberPrefStatus);
                      const userGroupIds = Array.isArray(u.userGroupIds) ? u.userGroupIds : [];
                      const entityItems = entityEmploymentChipsByUser.get(u.id);
                      const wrChips = getWorkReadinessEntityChipsDisplay(entityItems);
                      const rp = normalizeRiskProfileFromUserDoc(u.riskProfile);
                      const fromRisk = workerRiskPrimaryLine(rp);
                      const concern =
                        fromRisk ??
                        getRecruiterUserTopConcernDetailed(u, entityItems, {
                          latestAccusourceBackground: latestBackgroundByUserId.get(u.id) ?? null,
                          categoryScores: categoryScoresByUserId[u.id] ?? null,
                        });
                      const concernMuted = concern === 'None';
                      const concernTip = rp?.topRisks?.length ? workerRiskTooltipContent(rp) : '';
                      return (
                        <TableRow
                          key={u.id}
                          hover
                          sx={{
                            cursor: 'pointer',
                            backgroundColor: idx % 2 === 0 ? 'background.paper' : 'action.hover',
                            '&:hover': {
                              backgroundColor: 'action.selected',
                            },
                          }}
                          onClick={() => navigate(`/users/${u.id}`)}
                        >
                          <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()} sx={{ py: 0.5, px: 1 }}>
                            <Checkbox
                              size="small"
                              checked={selectAllResults || selectedIds.has(u.id)}
                              onChange={() => handleSelectRow(u.id)}
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
                                  <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, minWidth: 0, fontSize: '0.8125rem', lineHeight: 1.3 }} noWrap>
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
                                  latestNote={latestNoteByUserId.get(u.id) ?? null}
                                  groupTitleLookup={groupTitleLookup}
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
                                        '& .MuiChip-label': { px: 0.75, fontSize: '0.65rem', fontWeight: 600, lineHeight: 1.2 },
                                      }}
                                    />
                                  );
                                })}
                              </Stack>
                            )}
                          </TableCell>
                          <TableCell sx={{ verticalAlign: 'top', py: 0.5, px: 1, maxWidth: 280 }}>
                            <Stack spacing={0.15}>
                              {getReadinessBreakdownRows(
                                u,
                                entityItems,
                                {
                                  lastInterviewSubmitterName: latestInterviewByUserId.get(u.id)?.createdByName ?? null,
                                  latestAccusourceBackground: latestBackgroundByUserId.get(u.id) ?? null,
                                  ...(employmentBreakdownByUserId.has(u.id) && employmentBreakdownByUserId.get(u.id)
                                    ? { employmentBreakdown: employmentBreakdownByUserId.get(u.id)! }
                                    : {}),
                                },
                              ).map((row) => (
                                <Box key={row.key} component="span" sx={{ display: 'block' }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.3, fontSize: '0.65rem', fontFamily: 'inherit', display: 'block' }}>
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
                              {getBackgroundBreakdownRows(u, entityItems, {
                                latestAccusourceBackground: latestBackgroundByUserId.get(u.id) ?? null,
                              }).map((row) => (
                                <Box key={row.key} component="span" sx={{ display: 'block' }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.3, fontSize: '0.65rem', fontFamily: 'inherit', display: 'block' }}>
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
                          <TableCell sx={{ verticalAlign: 'top', py: 0.5, px: 1 }}>{renderAiScore(u)}</TableCell>
                          <TableCell sx={{ verticalAlign: 'top', py: 0.5, px: 1 }}>
                            {concernTip ? (
                              <Tooltip title={<span style={{ whiteSpace: 'pre-wrap' }}>{concernTip}</span>} placement="top" enterDelay={350}>
                                <Typography
                                  variant="body2"
                                  color={concernMuted ? 'text.secondary' : 'text.primary'}
                                  sx={{ fontWeight: 400, fontSize: '0.8125rem', lineHeight: 1.3 }}
                                >
                                  {concern}
                                </Typography>
                              </Tooltip>
                            ) : (
                              <Typography
                                variant="body2"
                                color={concernMuted ? 'text.secondary' : 'text.primary'}
                                sx={{ fontWeight: 400, fontSize: '0.8125rem', lineHeight: 1.3 }}
                              >
                                {concern}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell sx={{ verticalAlign: 'top', py: 0.5, px: 1, maxWidth: 200 }}>
                            <WorkHistoryJobTitlesCell user={u as Record<string, unknown>} />
                          </TableCell>
                          <TableCell sx={{ minWidth: 120, verticalAlign: 'top', py: 0.5, px: 1 }}>
                            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem', lineHeight: 1.3 }}>
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
                                  applyGroupStatus(u.id, 'member');
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
                                  applyGroupStatus(u.id, 'preferred');
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
                                  applyGroupStatus(u.id, 'not_preferred');
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
                            <Tooltip title="Remove from group" arrow>
                              <span>
                                <IconButton
                                  size="small"
                                  onClick={() => void onRemoveMember(u.id)}
                                  disabled={loading}
                                  sx={{ color: 'error.main' }}
                                >
                                  <DeleteOutlineIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </TableContainer>

            <StandardTablePagination
              count={sortedMembers.length}
              page={membersPage}
              rowsPerPage={membersRowsPerPage}
              onPageChange={(_e, newPage) => setMembersPage(newPage)}
              onRowsPerPageChange={(e) => {
                setMembersRowsPerPage(parseInt(e.target.value, 10));
                setMembersPage(0);
              }}
            />
      <MessageDrawer
        open={bulkDrawerOpen}
        onClose={() => setBulkDrawerOpen(false)}
        recipients={bulkRecipientsAndIds.recipients}
        tenantId={tenantId}
        bulkSystemMode={true}
        recipientUserIds={bulkRecipientsAndIds.recipientUserIds}
        defaultChannels={[bulkDrawerChannel]}
        onSend={() => {
          handleClearSelection();
          setBulkDrawerOpen(false);
        }}
      />
    </>

  );
};

export default UserGroupMembersTable;
