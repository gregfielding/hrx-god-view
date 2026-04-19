import React, { useState, useCallback, useEffect } from 'react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import {
  Autocomplete,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  Link,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
  Checkbox,
  FormControlLabel,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import FavoriteButton from '../../../components/FavoriteButton';
import UserTableIndeedFlexBadge from '../../../components/tables/UserTableIndeedFlexBadge';
import { pickResumeFromUserDoc } from '../../../utils/userResumeOpen';
import { formatPhoneNumber } from '../../../utils/formatPhone';
import type { ReadinessBreakdownRow } from '../../../utils/recruiterUsersReadinessDisplay';
import type { RecordHeaderEntitySlot } from '../../../utils/recruiterUsersEntityWorkReadiness';
import { recordHeaderTooltipComponentsProps } from './recordHeaderStyles';
import RecordHeaderScoreSummaryBlock from './RecordHeaderScoreSummaryBlock';
import type { ScoreSummary, ScoringDistribution } from '../../../utils/scoreSummary';
import type { PrescreenCategoryScoresV1 } from '../../../types/prescreenCategoryScores';
import type { WorkerRiskProfileV1 } from '../../../types/workerRiskProfile';
import type { AccusourceScreeningLineItem } from '../../../utils/accusourceScreeningLineItems';
import { getCalendarDayLocal, parseCalendarDateLocal } from '../../../utils/dateUtils';
import { googleMapsSearchUrl } from '../../../utils/recordHeaderAddress';
import type { EmergencyContact } from '../../../types/UserProfile';
import type { RecordHeaderAssignmentLine } from '../../../utils/recordHeaderAssignments';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../../firebase';

type TenantUserGroupOption = { id: string; title: string };

const colTitleSx = {
  fontSize: '0.65rem',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  color: 'text.secondary',
  mb: 0.65,
  display: 'block',
};

const bodySx = {
  fontSize: '0.78rem',
  lineHeight: 1.45,
  color: 'text.secondary',
  display: 'block',
};

/** Inline copy control: tiny icon, tucked next to value (no flex-grow on text). */
const copyIconButtonSx = {
  p: 0.125,
  ml: 0.125,
  flexShrink: 0,
  color: 'text.secondary',
  minWidth: 18,
  width: 18,
  height: 18,
  borderRadius: 0.75,
  '&:hover': { color: 'primary.main', bgcolor: 'action.hover' },
} as const;

const copyIconGlyphSx = { fontSize: 11 } as const;

export type RecruiterUserProfileTableHeaderProps = {
  firstName: string;
  lastName: string;
  initials: string;
  email: string;
  /** Two-line home address (street + city/state/zip); built from user doc in parent */
  recordHeaderAddressLines?: { line1: string; line2: string } | null;
  phone: string;
  avatarUrl: string;
  onboardingInProgress: boolean;
  onboardingAccent: string;
  uid: string;
  canViewAdminContent: boolean;
  targetUserSecurityLevel: string;
  isFavorite: (itemId: string) => boolean;
  toggleFavorite: (itemId: string) => string[];
  scoreSummary: ScoreSummary | undefined;
  scoringDistribution: ScoringDistribution | null;
  categoryScores: PrescreenCategoryScoresV1 | null;
  riskProfile: WorkerRiskProfileV1 | null;
  recordHeaderCreatedLabel: string | null;
  headerUserGroups: Array<{ id: string; title: string }>;
  viewerSecurityLevel: number;
  userDocForTableIcons: Record<string, unknown>;
  /** AccuSource line items + package hint for compliance column */
  screeningLines: AccusourceScreeningLineItem[];
  screeningPackageHint: string | null;
  entitySlots: RecordHeaderEntitySlot[];
  interviewSummaryLine: string | null;
  readinessRows: ReadinessBreakdownRow[];
  recordHeaderFileInputRef: React.RefObject<HTMLInputElement>;
  handleRecordHeaderAvatarFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  canEditRecordAvatar: boolean;
  recordHeaderAvatarHover: boolean;
  setRecordHeaderAvatarHover: (v: boolean) => void;
  handleRecordHeaderAvatarClick: () => void;
  recordHeaderAvatarBusy: boolean;
  /** Signal strip — contact + record utilities */
  contactActionIcons?: React.ReactNode;
  /** Calendar DOB from user doc (`dob` / `dateOfBirth`) */
  dateOfBirth?: Date | string | { toDate?: () => Date } | null;
  /** Last four SSN digits only (0–4 chars), already normalized */
  lastFourSsnDigits?: string;
  /** Indeed Flex flag (`users.addedToIndeedFlex`) */
  addedToIndeedFlex?: boolean;
  onIndeedFlexChange?: (checked: boolean) => void;
  /** Managers+ (security ≥ 4) can toggle */
  canEditIndeedFlex?: boolean;
  /** From Quick profile; shown above Created when present */
  emergencyContact?: EmergencyContact | null;
  /** Opens quick profile modal (parent passes when viewer can edit) */
  onContactEditClick?: () => void;
  /** Up to 3 active / upcoming assignments (Employment column, above Groups) */
  assignmentLines?: RecordHeaderAssignmentLine[];
  /** When set, each group row shows a remove control (managers+). */
  onRemoveUserFromGroup?: (groupId: string) => void | Promise<void>;
  /** Tenant used to list `tenants/{id}/userGroups` for the add-to-group modal. */
  tenantIdForUserGroups?: string | null;
  /** Persist adding the target user to a group (managers+). */
  onAddUserToGroup?: (groupId: string) => void | Promise<void>;
};

function entityChipVisuals(slot: RecordHeaderEntitySlot): { color: 'success' | 'warning' | 'error' | 'default'; variant: 'filled' | 'outlined' } {
  if (!slot.displayState) return { color: 'default', variant: 'outlined' };
  if (slot.displayState === 'active') return { color: 'success', variant: 'filled' };
  if (slot.displayState === 'onboarding') return { color: 'warning', variant: 'outlined' };
  return { color: 'error', variant: 'outlined' };
}

const RecruiterUserProfileTableHeader: React.FC<RecruiterUserProfileTableHeaderProps> = ({
  firstName,
  lastName,
  initials,
  email,
  recordHeaderAddressLines,
  phone,
  avatarUrl,
  onboardingInProgress,
  onboardingAccent,
  uid,
  canViewAdminContent,
  targetUserSecurityLevel,
  isFavorite,
  toggleFavorite,
  scoreSummary,
  scoringDistribution,
  categoryScores,
  riskProfile,
  recordHeaderCreatedLabel,
  headerUserGroups,
  viewerSecurityLevel,
  userDocForTableIcons,
  screeningLines,
  screeningPackageHint,
  entitySlots,
  interviewSummaryLine,
  readinessRows,
  recordHeaderFileInputRef,
  handleRecordHeaderAvatarFileChange,
  canEditRecordAvatar,
  recordHeaderAvatarHover,
  setRecordHeaderAvatarHover,
  handleRecordHeaderAvatarClick,
  recordHeaderAvatarBusy,
  contactActionIcons,
  dateOfBirth,
  lastFourSsnDigits = '',
  addedToIndeedFlex = false,
  onIndeedFlexChange,
  canEditIndeedFlex = false,
  emergencyContact,
  onContactEditClick,
  assignmentLines = [],
  onRemoveUserFromGroup,
  tenantIdForUserGroups = null,
  onAddUserToGroup,
}: RecruiterUserProfileTableHeaderProps) => {
  const theme = useTheme();
  const location = useLocation();
  const [removingGroupId, setRemovingGroupId] = useState<string | null>(null);
  const [addGroupModalOpen, setAddGroupModalOpen] = useState(false);
  const [addGroupOptions, setAddGroupOptions] = useState<TenantUserGroupOption[]>([]);
  const [addGroupOptionsLoading, setAddGroupOptionsLoading] = useState(false);
  const [selectedGroupToAdd, setSelectedGroupToAdd] = useState<TenantUserGroupOption | null>(null);
  const [addingToGroup, setAddingToGroup] = useState(false);
  const userGroupHref = (groupId: string) =>
    location.pathname.includes('/recruiter') ? `/recruiter/user-groups/${groupId}` : `/usergroups/${groupId}`;

  const handleRemoveGroupClick = useCallback(
    async (groupId: string) => {
      if (!onRemoveUserFromGroup || removingGroupId) return;
      setRemovingGroupId(groupId);
      try {
        await Promise.resolve(onRemoveUserFromGroup(groupId));
      } finally {
        setRemovingGroupId(null);
      }
    },
    [onRemoveUserFromGroup, removingGroupId],
  );

  useEffect(() => {
    if (!addGroupModalOpen || !tenantIdForUserGroups) return;
    let cancelled = false;
    (async () => {
      setAddGroupOptionsLoading(true);
      try {
        const gq = collection(db, 'tenants', tenantIdForUserGroups, 'userGroups');
        const snap = await getDocs(gq);
        const memberIds = new Set(headerUserGroups.map((g) => g.id));
        const opts: TenantUserGroupOption[] = snap.docs
          .map((d) => {
            const data = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              title: String(data?.title || data?.name || d.id),
            };
          })
          .filter((g) => !memberIds.has(g.id))
          .sort((a, b) => a.title.localeCompare(b.title));
        if (!cancelled) setAddGroupOptions(opts);
      } catch (e) {
        console.error('Failed to load user groups for add modal:', e);
        if (!cancelled) setAddGroupOptions([]);
      } finally {
        if (!cancelled) setAddGroupOptionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [addGroupModalOpen, tenantIdForUserGroups, headerUserGroups]);

  const handleConfirmAddToGroup = useCallback(async () => {
    if (!onAddUserToGroup || !selectedGroupToAdd || addingToGroup) return;
    setAddingToGroup(true);
    try {
      await Promise.resolve(onAddUserToGroup(selectedGroupToAdd.id));
      setAddGroupModalOpen(false);
      setSelectedGroupToAdd(null);
    } finally {
      setAddingToGroup(false);
    }
  }, [onAddUserToGroup, selectedGroupToAdd, addingToGroup]);

  const canManageGroupsSection = viewerSecurityLevel >= 4 && viewerSecurityLevel <= 7;
  const showAddGroupControl = Boolean(tenantIdForUserGroups && onAddUserToGroup);

  /** Admin: five columns (Contact … Employment … Risk); otherwise four (no Risk). */
  const gridColMd = canViewAdminContent ? 2.4 : 3;
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  const handleCopy = async (text: string, notice: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyNotice(notice);
    } catch {
      setCopyNotice('Could not copy');
    }
  };

  const phoneDisplay = phone ? formatPhoneNumber(phone) : '';

  const dobYmd = getCalendarDayLocal(dateOfBirth ?? null);
  const dobParsed = parseCalendarDateLocal(dateOfBirth ?? null);
  const dobDisplay =
    dobParsed != null
      ? dobParsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : null;
  const lastFourDisplay = lastFourSsnDigits.length === 4 ? `••••${lastFourSsnDigits}` : null;

  const addr1 = recordHeaderAddressLines?.line1?.trim() ?? '';
  const addr2 = recordHeaderAddressLines?.line2?.trim() ?? '';
  const hasAddressBlock = Boolean(addr1 || addr2);
  const mapsQuery = [addr1, addr2].filter(Boolean).join(', ');
  const mapsUrl = googleMapsSearchUrl(mapsQuery);

  const ecName = emergencyContact?.name?.trim() ?? '';
  const ecPhoneRaw = emergencyContact?.phone?.trim() ?? '';
  const ecPhoneDisplay = ecPhoneRaw ? formatPhoneNumber(ecPhoneRaw) || ecPhoneRaw : '';
  const showEmergencyLine = Boolean(ecName || ecPhoneDisplay);
  const emergencyLineText = [ecName, ecPhoneDisplay].filter(Boolean).join(' · ');

  return (
    <Box sx={{ width: '100%' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: { xs: 1.5, md: 2 },
          flexWrap: 'nowrap',
          width: '100%',
        }}
      >
        <Box
          position="relative"
          onMouseEnter={() => setRecordHeaderAvatarHover(true)}
          onMouseLeave={() => setRecordHeaderAvatarHover(false)}
          sx={{ flexShrink: 0 }}
        >
          <Avatar
            src={avatarUrl || undefined}
            sx={{
              width: 120,
              height: 120,
              bgcolor: avatarUrl ? 'transparent' : 'primary.main',
              fontSize: '2.5rem',
              fontWeight: 600,
              border: onboardingInProgress ? `2px solid ${onboardingAccent}` : undefined,
              boxSizing: 'border-box',
            }}
          >
            {!avatarUrl && initials}
          </Avatar>
          <input
            type="file"
            accept="image/*"
            ref={recordHeaderFileInputRef}
            style={{ display: 'none' }}
            onChange={handleRecordHeaderAvatarFileChange}
          />
          {canEditRecordAvatar && recordHeaderAvatarHover && (
            <Tooltip title="Replace photo">
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRecordHeaderAvatarClick();
                }}
                disabled={recordHeaderAvatarBusy}
                sx={{
                  position: 'absolute',
                  bottom: -4,
                  right: -4,
                  bgcolor: 'grey.300',
                  color: 'grey.700',
                  width: 28,
                  height: 28,
                  '&:hover': { bgcolor: 'grey.400' },
                }}
              >
                {recordHeaderAvatarBusy ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <CameraAltIcon sx={{ fontSize: 16 }} />
                )}
              </IconButton>
            </Tooltip>
          )}
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          {/* Name row */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              flexWrap: 'wrap',
            }}
          >
            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0, flex: '1 1 auto' }}>
              <Typography
                variant="h5"
                sx={{ fontWeight: 700, minWidth: 0, fontSize: '1.5rem', lineHeight: 1.15 }}
                noWrap
              >
                {`${firstName} ${lastName}`.trim() || 'User Profile'}
              </Typography>
              {canViewAdminContent &&
                uid &&
                targetUserSecurityLevel &&
                !['5', '6', '7'].includes(String(targetUserSecurityLevel)) && (
                  <FavoriteButton
                    itemId={uid}
                    favoriteType="users"
                    isFavorite={isFavorite}
                    toggleFavorite={toggleFavorite}
                    size="small"
                    tooltipText={{
                      favorited: 'Remove from favorites',
                      notFavorited: 'Add to favorites',
                    }}
                    sx={{
                      p: 0.125,
                      opacity: 0.72,
                      '& .MuiSvgIcon-root': { fontSize: 17 },
                    }}
                  />
                )}
            </Stack>
          </Box>

          {/* Signal strip */}
          {contactActionIcons ? (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '3px',
                mt: 0.75,
                pb: '8px',
              }}
            >
              {contactActionIcons}
              <Box sx={{ display: 'inline-flex', alignItems: 'center', ml: 0.25 }}>
                <UserTableIndeedFlexBadge user={userDocForTableIcons} compact />
              </Box>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', mt: 0.5, pb: '8px' }}>
              <UserTableIndeedFlexBadge user={userDocForTableIcons} compact />
            </Box>
          )}

          {/* Contact / Readiness / Screening / Employment / (Risk if admin) — tight top padding handled below */}
          <Grid
            container
            spacing={2}
            sx={{
              mt: 0,
              '& > .MuiGrid-item:first-of-type': { paddingTop: 0 },
              [theme.breakpoints.up('md')]: {
                '& > .MuiGrid-item': { paddingTop: 0 },
              },
            }}
          >
            <Grid item xs={12} md={gridColMd}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.25,
                  flexWrap: 'wrap',
                  mb: 0.65,
                }}
              >
                <Typography component="span" sx={{ ...colTitleSx, mb: 0 }}>
                  Contact
                </Typography>
                {onContactEditClick ? (
                  <Tooltip title="Edit quick profile & location" arrow placement="top" componentsProps={recordHeaderTooltipComponentsProps}>
                    <IconButton
                      size="small"
                      aria-label="Edit quick profile"
                      onClick={onContactEditClick}
                      sx={copyIconButtonSx}
                    >
                      <EditOutlinedIcon sx={copyIconGlyphSx} />
                    </IconButton>
                  </Tooltip>
                ) : null}
              </Box>
              {email ? (
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="flex-start"
                  spacing={0}
                  sx={{ alignSelf: 'flex-start', minWidth: 0, maxWidth: '100%', mt: 0, gap: 0.25 }}
                >
                  <Typography
                    variant="body2"
                    noWrap
                    component="span"
                    sx={{ ...bodySx, fontWeight: 500, color: 'text.primary', minWidth: 0, flex: '0 1 auto' }}
                  >
                    {email}
                  </Typography>
                  <Tooltip title="Copy email" arrow placement="top" componentsProps={recordHeaderTooltipComponentsProps}>
                    <IconButton
                      size="small"
                      aria-label="Copy email"
                      onClick={() => void handleCopy(email.trim(), 'Email copied')}
                      sx={copyIconButtonSx}
                    >
                      <ContentCopyIcon sx={copyIconGlyphSx} />
                    </IconButton>
                  </Tooltip>
                </Stack>
              ) : null}
              {phone ? (
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="flex-start"
                  spacing={0}
                  sx={{ alignSelf: 'flex-start', minWidth: 0, maxWidth: '100%', mt: 0.35, gap: 0.25 }}
                >
                  <Typography variant="body2" noWrap component="span" sx={{ ...bodySx, minWidth: 0, flex: '0 1 auto' }}>
                    {phoneDisplay}
                  </Typography>
                  <Tooltip title="Copy phone number" arrow placement="top" componentsProps={recordHeaderTooltipComponentsProps}>
                    <IconButton
                      size="small"
                      aria-label="Copy phone number"
                      onClick={() => void handleCopy(phoneDisplay, 'Phone number copied')}
                      sx={copyIconButtonSx}
                    >
                      <ContentCopyIcon sx={copyIconGlyphSx} />
                    </IconButton>
                  </Tooltip>
                </Stack>
              ) : null}
              {hasAddressBlock ? (
                <Stack
                  direction="row"
                  alignItems="flex-start"
                  justifyContent="flex-start"
                  spacing={0}
                  sx={{ alignSelf: 'flex-start', minWidth: 0, maxWidth: '100%', mt: 0.35, gap: 0.25 }}
                >
                  <Box sx={{ minWidth: 0, flex: '0 1 auto' }}>
                    {addr1 ? (
                      <Typography variant="body2" sx={{ ...bodySx, lineHeight: 1.45, display: 'block' }}>
                        {addr1}
                      </Typography>
                    ) : null}
                    {addr2 ? (
                      <Typography
                        variant="body2"
                        sx={{
                          ...bodySx,
                          lineHeight: 1.45,
                          display: 'block',
                          mt: addr1 ? 0.2 : 0,
                        }}
                      >
                        {addr2}
                      </Typography>
                    ) : null}
                  </Box>
                  <Tooltip
                    title="Open in Google Maps"
                    arrow
                    placement="top"
                    componentsProps={recordHeaderTooltipComponentsProps}
                  >
                    <IconButton
                      component="a"
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      size="small"
                      aria-label="Open address in Google Maps"
                      sx={copyIconButtonSx}
                    >
                      <OpenInNewIcon sx={copyIconGlyphSx} />
                    </IconButton>
                  </Tooltip>
                </Stack>
              ) : null}
              {dobDisplay && dobYmd ? (
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="flex-start"
                  spacing={0}
                  sx={{ alignSelf: 'flex-start', minWidth: 0, maxWidth: '100%', mt: 0.35, gap: 0.25 }}
                >
                  <Typography variant="body2" noWrap component="span" sx={{ ...bodySx, minWidth: 0, flex: '0 1 auto' }}>
                    <Box component="span" sx={{ fontWeight: 600, color: 'text.secondary', mr: 0.35 }}>
                      DOB
                    </Box>
                    {dobDisplay}
                  </Typography>
                  <Tooltip title="Copy date of birth" arrow placement="top" componentsProps={recordHeaderTooltipComponentsProps}>
                    <IconButton
                      size="small"
                      aria-label="Copy date of birth"
                      onClick={() => void handleCopy(dobYmd, 'Date of birth copied')}
                      sx={copyIconButtonSx}
                    >
                      <ContentCopyIcon sx={copyIconGlyphSx} />
                    </IconButton>
                  </Tooltip>
                </Stack>
              ) : null}
              {lastFourDisplay ? (
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="flex-start"
                  spacing={0}
                  sx={{ alignSelf: 'flex-start', minWidth: 0, maxWidth: '100%', mt: 0.35, gap: 0.25 }}
                >
                  <Typography variant="body2" noWrap component="span" sx={{ ...bodySx, minWidth: 0, flex: '0 1 auto' }}>
                    <Box component="span" sx={{ fontWeight: 600, color: 'text.secondary', mr: 0.35 }}>
                      Last 4 (SSN)
                    </Box>
                    {lastFourDisplay}
                  </Typography>
                  <Tooltip title="Copy last 4 of SSN" arrow placement="top" componentsProps={recordHeaderTooltipComponentsProps}>
                    <IconButton
                      size="small"
                      aria-label="Copy last four of Social Security number"
                      onClick={() => void handleCopy(lastFourSsnDigits, 'Last 4 (SSN) copied')}
                      sx={copyIconButtonSx}
                    >
                      <ContentCopyIcon sx={copyIconGlyphSx} />
                    </IconButton>
                  </Tooltip>
                </Stack>
              ) : null}
              {showEmergencyLine ? (
                <Typography variant="body2" sx={{ ...bodySx, mt: 0.35 }}>
                  <Box component="span" sx={{ fontWeight: 600, color: 'text.secondary', mr: 0.35 }}>
                    Emergency
                  </Box>
                  {emergencyLineText}
                </Typography>
              ) : null}
              {recordHeaderCreatedLabel ? (
                <Typography variant="body2" sx={{ ...bodySx, mt: 0.35 }}>
                  Created {recordHeaderCreatedLabel}
                </Typography>
              ) : null}
            </Grid>

            <Grid item xs={12} md={gridColMd}>
              <Typography component="span" sx={colTitleSx}>
                Readiness
              </Typography>
              {!canViewAdminContent && interviewSummaryLine ? (
                <Typography variant="body2" sx={{ ...bodySx, fontWeight: 500, color: 'text.primary', mb: 0.5 }}>
                  {interviewSummaryLine}
                </Typography>
              ) : null}
              {readinessRows.length > 0 && (
                <Stack spacing={0.2}>
                  {readinessRows.map((row) => (
                    <Box key={row.key} component="span">
                      <Typography variant="body2" sx={{ ...bodySx, fontSize: '0.74rem', fontWeight: 500 }}>
                        {row.text}
                      </Typography>
                      {row.sublines?.map((line, i) => (
                        <Typography
                          key={i}
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: 'block', pl: 0.5, fontSize: '0.68rem', lineHeight: 1.25 }}
                        >
                          {line}
                        </Typography>
                      ))}
                    </Box>
                  ))}
                </Stack>
              )}
              <FormControlLabel
                sx={{
                  mt:
                    readinessRows.length > 0 || (!canViewAdminContent && interviewSummaryLine)
                      ? 0.35
                      : 0.75,
                  mr: 0,
                  ml: -0.75,
                  alignItems: 'center',
                  '& .MuiFormControlLabel-label': {
                    fontSize: '0.72rem',
                    color: 'text.secondary',
                    fontWeight: 500,
                  },
                }}
                control={
                  <Checkbox
                    size="small"
                    checked={!!addedToIndeedFlex}
                    disabled={!canEditIndeedFlex}
                    onChange={(e) => onIndeedFlexChange?.(e.target.checked)}
                    sx={{
                      py: 0,
                      pl: 0,
                      pr: 0.5,
                      '& .MuiSvgIcon-root': { fontSize: 18 },
                    }}
                  />
                }
                label="Indeed Flex"
              />
            </Grid>

            <Grid item xs={12} md={gridColMd}>
              <Typography component="span" sx={colTitleSx}>
                Screening
              </Typography>
              {screeningPackageHint ? (
                <Typography variant="body2" sx={{ ...bodySx, fontSize: '0.72rem', mb: 0.5 }}>
                  {screeningPackageHint}
                </Typography>
              ) : null}
              {screeningLines.length > 0 ? (
                <Stack spacing={0.35}>
                  {screeningLines.map((line) => (
                    <Typography key={line.id} variant="body2" sx={{ ...bodySx, fontSize: '0.74rem' }}>
                      <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
                        {line.name}
                        {line.type ? ` (${line.type})` : ''}:
                      </Box>{' '}
                      {line.status}
                    </Typography>
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" sx={{ ...bodySx, fontSize: '0.74rem' }}>
                  {screeningPackageHint ? '—' : 'No active screening package on file'}
                </Typography>
              )}
              <Typography component="span" sx={{ ...colTitleSx, mt: 1.25 }}>
                Certifications
              </Typography>
              <Typography variant="body2" sx={{ ...bodySx, fontSize: '0.72rem', fontStyle: 'italic' }}>
                —
              </Typography>
            </Grid>

            <Grid item xs={12} md={gridColMd}>
              <Typography component="span" sx={colTitleSx}>
                Employment
              </Typography>
              {entitySlots.length > 0 ? (
                <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 0.35 }}>
                  {entitySlots.map((slot) => {
                    const v = entityChipVisuals(slot);
                    return (
                      <Chip
                        key={slot.entityKey}
                        size="small"
                        label={`${slot.title}: ${slot.statusLabel}`}
                        color={v.color}
                        variant={v.variant}
                        sx={{
                          height: 24,
                          maxWidth: '100%',
                          '& .MuiChip-label': { px: 0.75, fontSize: '0.68rem', fontWeight: 600 },
                        }}
                      />
                    );
                  })}
                </Stack>
              ) : (
                <Typography variant="body2" sx={{ ...bodySx, fontSize: '0.74rem' }}>
                  —
                </Typography>
              )}

              {assignmentLines.length > 0 ? (
                <Box sx={{ mt: 1.25 }}>
                  <Typography component="span" sx={colTitleSx}>
                    Assignments
                  </Typography>
                  <Stack spacing={0.4} sx={{ mt: 0.35 }}>
                    {assignmentLines.map((line) => (
                      <Box key={line.id || line.primary}>
                        <Typography
                          variant="body2"
                          sx={{
                            ...bodySx,
                            fontWeight: 500,
                            color: 'text.primary',
                            fontSize: '0.74rem',
                            lineHeight: 1.35,
                          }}
                        >
                          {line.primary}
                        </Typography>
                        {line.secondary ? (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: 'block', fontSize: '0.68rem', lineHeight: 1.3, mt: 0.1 }}
                          >
                            {line.secondary}
                          </Typography>
                        ) : null}
                      </Box>
                    ))}
                  </Stack>
                </Box>
              ) : null}

              {canManageGroupsSection && (headerUserGroups.length > 0 || showAddGroupControl) && (
                <Box sx={{ mt: 1.25 }}>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.25,
                      flexWrap: 'wrap',
                      minHeight: 0,
                      mb: 0.65,
                    }}
                  >
                    <Typography
                      component="span"
                      sx={{
                        ...colTitleSx,
                        mb: 0,
                        lineHeight: 1.15,
                        display: 'inline-flex',
                        alignItems: 'center',
                      }}
                    >
                      Groups
                    </Typography>
                    {showAddGroupControl ? (
                      <Tooltip title="Add to group" placement="top" componentsProps={recordHeaderTooltipComponentsProps}>
                        <IconButton
                          size="small"
                          aria-label="Add user to a group"
                          onClick={() => {
                            setSelectedGroupToAdd(null);
                            setAddGroupModalOpen(true);
                          }}
                          sx={{
                            p: 0.25,
                            ml: 0,
                            alignSelf: 'center',
                            color: 'primary.main',
                            '&:hover': { bgcolor: 'action.hover' },
                          }}
                        >
                          <AddIcon sx={{ fontSize: 16, display: 'block' }} />
                        </IconButton>
                      </Tooltip>
                    ) : null}
                  </Box>
                  <Stack spacing={0.35} sx={{ width: '100%' }}>
                    {headerUserGroups.map((g) => (
                      <Box
                        key={g.id}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 0.75,
                          width: '100%',
                          minWidth: 0,
                        }}
                      >
                        <Tooltip title={g.title} placement="top" enterDelay={400} componentsProps={recordHeaderTooltipComponentsProps}>
                          <Link
                            component={RouterLink}
                            to={userGroupHref(g.id)}
                            underline="hover"
                            variant="body2"
                            sx={{
                              ...bodySx,
                              fontWeight: 500,
                              color: 'primary.main',
                              wordBreak: 'break-word',
                              flex: 1,
                              minWidth: 0,
                            }}
                          >
                            {g.title}
                          </Link>
                        </Tooltip>
                        {onRemoveUserFromGroup ? (
                          <Tooltip title="Remove from group" placement="top" componentsProps={recordHeaderTooltipComponentsProps}>
                            <IconButton
                              size="small"
                              aria-label={`Remove from ${g.title}`}
                              disabled={removingGroupId !== null}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                void handleRemoveGroupClick(g.id);
                              }}
                              sx={{
                                flexShrink: 0,
                                p: 0.125,
                                color: 'error.main',
                                '&:hover': { bgcolor: 'action.hover' },
                              }}
                            >
                              {removingGroupId === g.id ? (
                                <CircularProgress size={14} color="inherit" />
                              ) : (
                                <CloseIcon sx={{ fontSize: 16 }} />
                              )}
                            </IconButton>
                          </Tooltip>
                        ) : null}
                      </Box>
                    ))}
                  </Stack>
                </Box>
              )}
            </Grid>

            {canViewAdminContent && (
              <Grid item xs={12} md={gridColMd}>
                <Typography component="span" sx={colTitleSx}>
                  Risk &amp; recommendations
                </Typography>
                <Box sx={{ mt: 0.35 }}>
                  <RecordHeaderScoreSummaryBlock
                    scoreSummary={scoreSummary}
                    scoringDistribution={scoringDistribution}
                    categoryScores={categoryScores}
                    riskProfile={riskProfile}
                    interviewSummaryLine={interviewSummaryLine}
                  />
                </Box>
              </Grid>
            )}
          </Grid>
        </Box>
      </Box>
      <Snackbar
        open={Boolean(copyNotice)}
        autoHideDuration={2200}
        onClose={() => setCopyNotice(null)}
        message={copyNotice ?? ''}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />

      <Dialog
        open={addGroupModalOpen}
        onClose={() => {
          if (addingToGroup) return;
          setAddGroupModalOpen(false);
          setSelectedGroupToAdd(null);
        }}
        maxWidth="sm"
        fullWidth
        scroll="paper"
      >
        <DialogTitle sx={{ fontSize: '1rem', fontWeight: 700 }}>Add to group</DialogTitle>
        <DialogContent dividers sx={{ pt: 1.5 }}>
          <Autocomplete
            options={addGroupOptions}
            loading={addGroupOptionsLoading}
            value={selectedGroupToAdd}
            onChange={(_, v) => setSelectedGroupToAdd(v)}
            getOptionLabel={(o) => o.title}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Group"
                placeholder="Search or pick a group"
                size="small"
                variant="outlined"
              />
            )}
          />
          {!addGroupOptionsLoading && addGroupOptions.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
              No additional groups available, or this user is already in all groups.
            </Typography>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 2, py: 1.5 }}>
          <Button
            onClick={() => {
              setAddGroupModalOpen(false);
              setSelectedGroupToAdd(null);
            }}
            disabled={addingToGroup}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={!selectedGroupToAdd || addingToGroup || addGroupOptions.length === 0}
            onClick={() => void handleConfirmAddToGroup()}
          >
            {addingToGroup ? 'Adding…' : 'Add'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default RecruiterUserProfileTableHeader;
