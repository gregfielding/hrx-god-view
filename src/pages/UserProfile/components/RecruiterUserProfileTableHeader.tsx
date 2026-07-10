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
import DownloadIcon from '@mui/icons-material/Download';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
// Verdict icons for the Screening block. Match the vocabulary + colors used in
// AccusourceOrderServiceLinesTable's StatusChip so recruiters see the same
// visual for "Passed" everywhere.
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import FavoriteButton from '../../../components/FavoriteButton';
import { PhoneVerifiedInlineCheck } from '../../../components/PhoneVerifiedInlineCheck';
import UserTableIndeedFlexBadge from '../../../components/tables/UserTableIndeedFlexBadge';
import UserTableFieldglassBadge from '../../../components/tables/UserTableFieldglassBadge';
import UserTableEvereeAddressBlockedBadge from '../../../components/tables/UserTableEvereeAddressBlockedBadge';
import { pickResumeFromUserDoc } from '../../../utils/userResumeOpen';
import { formatPhoneNumber } from '../../../utils/formatPhone';
import type { ReadinessBreakdownRow } from '../../../utils/recruiterUsersReadinessDisplay';
import type { RecordHeaderEntitySlot } from '../../../utils/recruiterUsersEntityWorkReadiness';
import {
  recordHeaderBodyTextSx,
  recordHeaderColumnTitleSx,
  recordHeaderTooltipComponentsProps,
} from './recordHeaderStyles';
import RecordHeaderScoreSummaryBlock from './RecordHeaderScoreSummaryBlock';
import type { ScoreSummary, ScoringDistribution } from '../../../utils/scoreSummary';
import type { WorkerInterviewAiBlock } from '../../../types/workerAiPrescreenInterview';
import type { PrescreenCategoryScoresV1 } from '../../../types/prescreenCategoryScores';
import type { WorkerRiskProfileV1 } from '../../../types/workerRiskProfile';
import type { AccusourceScreeningLineItem } from '../../../utils/accusourceScreeningLineItems';
import { getCalendarDayLocal, parseCalendarDateLocal } from '../../../utils/dateUtils';
import { googleMapsSearchUrl } from '../../../utils/recordHeaderAddress';
import type { EmergencyContact } from '../../../types/UserProfile';
import type { RecordHeaderAssignmentLine } from '../../../utils/recordHeaderAssignments';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '../../../firebase';
import DnrSection from '../../../components/dnr/DnrSection';

type TenantUserGroupOption = { id: string; title: string };

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
  /** Twilio / Firestore `phoneVerified` */
  phoneVerified?: boolean;
  avatarUrl: string;
  onboardingInProgress: boolean;
  onboardingAccent: string;
  uid: string;
  canViewAdminContent: boolean;
  targetUserSecurityLevel: string;
  isFavorite: (itemId: string) => boolean;
  toggleFavorite: (itemId: string) => string[];
  scoreSummary: ScoreSummary | undefined;
  /** Latest prescreen `ai` block — aligns record header score with Interview tab */
  latestPrescreenInterviewAi?: WorkerInterviewAiBlock | null;
  /** Canonical recruiter score on user doc */
  recruiterScoreSnapshot?: unknown;
  recruiterMasterScore?: unknown;
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
  /** When the worker's Employer I-9 row is "Action needed", this link
   *  (Everee worker Documents tab) is used so the recruiter can jump
   *  straight to the signature surface. Null when no Everee worker id
   *  resolves — the row then renders as plain "Signature needed" text. */
  employerI9SignatureUrl?: string | null;
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
  /** SAP Fieldglass flag (`users.addedToFieldglass`) — sister checkbox to Indeed Flex. */
  addedToFieldglass?: boolean;
  onFieldglassChange?: (checked: boolean) => void;
  /** Managers+ (security ≥ 4) can toggle */
  canEditFieldglass?: boolean;
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
  phoneVerified,
  avatarUrl,
  onboardingInProgress,
  onboardingAccent,
  uid,
  canViewAdminContent,
  targetUserSecurityLevel,
  isFavorite,
  toggleFavorite,
  scoreSummary,
  latestPrescreenInterviewAi,
  recruiterScoreSnapshot,
  recruiterMasterScore,
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
  employerI9SignatureUrl = null,
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
  addedToFieldglass = false,
  onFieldglassChange,
  canEditFieldglass = false,
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

  /**
   * Column width. After the 2026-06-03 header reorg:
   * Admin: five columns (Contact · Employment-stack · Screening ·
   *   Assignments · Risk) → 2.4 each.
   * Non-admin: four columns (no Risk) → 3 each.
   */
  const gridColMd = canViewAdminContent ? 2.4 : 3;
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  /**
   * Primary recruiter (owner) for this worker — denormalized onto
   * `users.{uid}.primaryRecruiterId` by the ownership trigger. Rendered
   * as a small "OWNER" block beneath Groups so the whole header can tell
   * you at a glance who's accountable for the worker. Missing means the
   * worker is in the tenant's Unassigned pool (or ownership hasn't
   * resolved yet for a brand-new record).
   */
  const primaryRecruiterId =
    typeof userDocForTableIcons?.primaryRecruiterId === 'string' &&
    (userDocForTableIcons.primaryRecruiterId as string).trim() !== ''
      ? (userDocForTableIcons.primaryRecruiterId as string).trim()
      : null;
  const [primaryRecruiterName, setPrimaryRecruiterName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setPrimaryRecruiterName(null);
    if (!primaryRecruiterId) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', primaryRecruiterId));
        if (cancelled || !snap.exists()) return;
        const data = snap.data() as Record<string, unknown>;
        const first = typeof data.firstName === 'string' ? data.firstName : '';
        const last = typeof data.lastName === 'string' ? data.lastName : '';
        const display = typeof data.displayName === 'string' ? data.displayName.trim() : '';
        const combined = `${first} ${last}`.trim();
        setPrimaryRecruiterName(combined || display || primaryRecruiterId);
      } catch {
        // Missing recruiter user doc shouldn't crash the header; fall back
        // to showing the uid so the owner is at least addressable.
        if (!cancelled) setPrimaryRecruiterName(primaryRecruiterId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [primaryRecruiterId]);

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
        <Box sx={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
        <Box
          position="relative"
          onMouseEnter={() => setRecordHeaderAvatarHover(true)}
          onMouseLeave={() => setRecordHeaderAvatarHover(false)}
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
          {/* Download photo — bottom-left, mirrors the replace button.
              Fetches the image as a blob so cross-origin (Firebase
              Storage) downloads actually save rather than navigate. The
              browser controls the destination folder (typically
              Downloads). */}
          {avatarUrl && recordHeaderAvatarHover && (
            <Tooltip title="Download photo">
              <IconButton
                size="small"
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    const res = await fetch(avatarUrl, { mode: 'cors' });
                    const blob = await res.blob();
                    const objectUrl = URL.createObjectURL(blob);
                    const ext = (blob.type.split('/')[1] || 'jpg').split('+')[0];
                    const base =
                      [firstName, lastName].filter(Boolean).join('_').trim() || 'avatar';
                    const a = document.createElement('a');
                    a.href = objectUrl;
                    a.download = `${base}.${ext}`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(objectUrl);
                  } catch {
                    // CORS/fetch failure — open in a new tab so the user
                    // can still save it manually.
                    window.open(avatarUrl, '_blank', 'noopener,noreferrer');
                  }
                }}
                sx={{
                  position: 'absolute',
                  bottom: -4,
                  left: -4,
                  bgcolor: 'grey.300',
                  color: 'grey.700',
                  width: 28,
                  height: 28,
                  '&:hover': { bgcolor: 'grey.400' },
                }}
              >
                <DownloadIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
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
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, ml: 0.25 }}>
                <UserTableIndeedFlexBadge user={userDocForTableIcons} compact />
                <UserTableFieldglassBadge user={userDocForTableIcons} compact />
                <UserTableEvereeAddressBlockedBadge user={userDocForTableIcons} compact />
              </Box>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5, pb: '8px' }}>
              <UserTableIndeedFlexBadge user={userDocForTableIcons} compact />
              <UserTableFieldglassBadge user={userDocForTableIcons} compact />
              <UserTableEvereeAddressBlockedBadge user={userDocForTableIcons} compact />
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
                <Typography component="span" sx={{ ...recordHeaderColumnTitleSx, mb: 0 }}>
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
                    sx={{ ...recordHeaderBodyTextSx, minWidth: 0, flex: '0 1 auto' }}
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
                  <Typography variant="body2" noWrap component="span" sx={{ ...recordHeaderBodyTextSx, minWidth: 0, flex: '0 1 auto' }}>
                    {phoneDisplay}
                  </Typography>
                  <PhoneVerifiedInlineCheck verified={phoneVerified === true} />
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
                      <Typography variant="body2" sx={{ ...recordHeaderBodyTextSx, display: 'block' }}>
                        {addr1}
                      </Typography>
                    ) : null}
                    {addr2 ? (
                      <Typography
                        variant="body2"
                        sx={{
                          ...recordHeaderBodyTextSx,
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
                  <Typography variant="body2" noWrap component="span" sx={{ ...recordHeaderBodyTextSx, minWidth: 0, flex: '0 1 auto' }}>
                    <Box component="span" sx={{ mr: 0.35 }}>
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
                  <Typography variant="body2" noWrap component="span" sx={{ ...recordHeaderBodyTextSx, minWidth: 0, flex: '0 1 auto' }}>
                    <Box component="span" sx={{ mr: 0.35 }}>
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
                <Typography variant="body2" sx={{ ...recordHeaderBodyTextSx, mt: 0.35 }}>
                  <Box component="span" sx={{ mr: 0.35 }}>
                    Emergency
                  </Box>
                  {emergencyLineText}
                </Typography>
              ) : null}
              {recordHeaderCreatedLabel ? (
                <Typography variant="body2" sx={{ ...recordHeaderBodyTextSx, mt: 0.35 }}>
                  Created {recordHeaderCreatedLabel}
                </Typography>
              ) : null}
            </Grid>

            {/* Column 2 — Employment (2026-06-03 header reorg).
                Employment moved here above the former Readiness column.
                The Readiness status rows (Direct deposit, Employer I-9, …)
                now render below the entity chips; the Indeed Flex /
                Fieldglass checkboxes become an "Applications" section;
                Groups + Recruiter stack below. The standalone Employment
                column further right has been removed. */}
            <Grid item xs={12} md={gridColMd}>
              <Typography component="span" sx={recordHeaderColumnTitleSx}>
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
                          '& .MuiChip-label': { px: 0.75, fontSize: '0.74rem', fontWeight: 400 },
                        }}
                      />
                    );
                  })}
                </Stack>
              ) : (
                <Typography variant="body2" sx={recordHeaderBodyTextSx}>
                  —
                </Typography>
              )}

              {/* DNR chips + add action — per-account Do Not Return marks. */}
              {tenantIdForUserGroups ? (
                <DnrSection tenantId={tenantIdForUserGroups} userId={uid} />
              ) : null}

              {/* Readiness status rows — moved under the Employment chips. */}
              {!canViewAdminContent && interviewSummaryLine ? (
                <Typography variant="body2" sx={{ ...recordHeaderBodyTextSx, mt: 0.5 }}>
                  {interviewSummaryLine}
                </Typography>
              ) : null}
              {readinessRows.length > 0 && (
                <Stack spacing={0.2} sx={{ mt: 0.5 }}>
                  {readinessRows.map((row) => {
                    // Employer I-9 needing the employer signature: relabel
                    // "Action needed" → "Signature needed" and (when an
                    // Everee worker id resolved) link straight to the
                    // worker's Everee Documents tab in a new tab.
                    const isI9SignatureNeeded =
                      row.key === 'employer_i9' && /Action needed/i.test(row.text);
                    const displayText = isI9SignatureNeeded
                      ? row.text.replace(/Action needed/i, 'Signature needed')
                      : row.text;
                    const renderAsLink = isI9SignatureNeeded && !!employerI9SignatureUrl;
                    return (
                      <Box key={row.key} component="span">
                        {renderAsLink ? (
                          <Link
                            href={employerI9SignatureUrl!}
                            target="_blank"
                            rel="noopener noreferrer"
                            underline="hover"
                            variant="body2"
                            sx={{
                              ...recordHeaderBodyTextSx,
                              color: 'primary.main',
                              fontWeight: 400,
                            }}
                          >
                            {displayText}
                          </Link>
                        ) : (
                          <Typography variant="body2" sx={recordHeaderBodyTextSx}>
                            {displayText}
                          </Typography>
                        )}
                        {row.sublines?.map((line, i) => (
                          <Typography
                            key={i}
                            variant="body2"
                            sx={{ ...recordHeaderBodyTextSx, display: 'block', pl: 0.5 }}
                          >
                            {line}
                          </Typography>
                        ))}
                      </Box>
                    );
                  })}
                </Stack>
              )}

              {/* Applications — the Indeed Flex / Fieldglass enrollment
                  checkboxes, formerly under the Readiness column. */}
              <Typography component="span" sx={{ ...recordHeaderColumnTitleSx, mt: 1.25 }}>
                Applications
              </Typography>
              <FormControlLabel
                sx={{
                  // FormControlLabel defaults to inline-flex; forcing flex
                  // here (and on the Fieldglass row below) makes the two
                  // checkboxes stack vertically instead of wrapping side by
                  // side as the column narrows.
                  display: 'flex',
                  mt: 0.35,
                  mr: 0,
                  ml: -0.75,
                  alignItems: 'center',
                  '& .MuiFormControlLabel-label': {
                    fontSize: '0.74rem',
                    fontWeight: 400,
                    lineHeight: 1.45,
                    color: (theme) => (theme.palette.mode === 'dark' ? theme.palette.text.secondary : '#5A6372'),
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
              <FormControlLabel
                sx={{
                  display: 'flex',
                  mt: 0,
                  mr: 0,
                  ml: -0.75,
                  alignItems: 'center',
                  '& .MuiFormControlLabel-label': {
                    fontSize: '0.74rem',
                    fontWeight: 400,
                    lineHeight: 1.45,
                    color: (theme) => (theme.palette.mode === 'dark' ? theme.palette.text.secondary : '#5A6372'),
                  },
                }}
                control={
                  <Checkbox
                    size="small"
                    checked={!!addedToFieldglass}
                    disabled={!canEditFieldglass}
                    onChange={(e) => onFieldglassChange?.(e.target.checked)}
                    sx={{
                      py: 0,
                      pl: 0,
                      pr: 0.5,
                      '& .MuiSvgIcon-root': { fontSize: 18 },
                    }}
                  />
                }
                label="Fieldglass"
              />
            </Grid>

            <Grid item xs={12} md={gridColMd}>
              <Typography component="span" sx={recordHeaderColumnTitleSx}>
                Screening
              </Typography>
              {screeningPackageHint ? (
                <Typography variant="body2" sx={{ ...recordHeaderBodyTextSx, mb: 0.5 }}>
                  {screeningPackageHint}
                </Typography>
              ) : null}
              {screeningLines.length > 0 ? (
                <Stack spacing={0.35}>
                  {screeningLines.map((line) => {
                    const verdictIcon = renderVerdictIconForHeader(line.verdict);
                    return (
                      <Typography
                        key={line.id}
                        variant="body2"
                        sx={{ ...recordHeaderBodyTextSx, display: 'flex', alignItems: 'flex-start', gap: 0.5 }}
                      >
                        {verdictIcon}
                        <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
                          {line.name}
                          {line.type ? ` (${line.type})` : ''}: {line.status}
                        </Box>
                      </Typography>
                    );
                  })}
                </Stack>
              ) : (
                <Typography variant="body2" sx={recordHeaderBodyTextSx}>
                  {screeningPackageHint ? '—' : 'No active screening package on file'}
                </Typography>
              )}
              <Typography component="span" sx={{ ...recordHeaderColumnTitleSx, mt: 1.25 }}>
                Certifications
              </Typography>
              <Typography variant="body2" sx={recordHeaderBodyTextSx}>
                —
              </Typography>
            </Grid>

            {/* Column 4 — Assignments (its own column, per 2026-06-03
                request to keep 5 columns). */}
            <Grid item xs={12} md={gridColMd}>
              <Typography component="span" sx={recordHeaderColumnTitleSx}>
                Assignments
              </Typography>
              {assignmentLines.length > 0 ? (
                <Stack spacing={0.4} sx={{ mt: 0.35 }}>
                  {assignmentLines.map((line) => (
                    <Box key={line.id || line.primary}>
                      <Typography variant="body2" sx={recordHeaderBodyTextSx}>
                        {line.primary}
                      </Typography>
                      {line.secondary ? (
                        <Typography variant="body2" sx={{ ...recordHeaderBodyTextSx, display: 'block', mt: 0.1 }}>
                          {line.secondary}
                        </Typography>
                      ) : null}
                    </Box>
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" sx={recordHeaderBodyTextSx}>
                  —
                </Typography>
              )}

              {/* Groups — moved below Assignments in column 4
                  (2026-06-03 request). */}
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
                        ...recordHeaderColumnTitleSx,
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
                              ...recordHeaderBodyTextSx,
                              fontWeight: 400,
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
                <Typography component="span" sx={recordHeaderColumnTitleSx}>
                  Risk &amp; recommendations
                </Typography>
                <Box sx={{ mt: 0.35 }}>
                  <RecordHeaderScoreSummaryBlock
                    scoreSummary={scoreSummary}
                    latestPrescreenInterviewAi={latestPrescreenInterviewAi ?? null}
                    recruiterScoreSnapshot={recruiterScoreSnapshot}
                    recruiterMasterScore={recruiterMasterScore}
                    useRecruiterSnapshotOnly
                    scoringDistribution={scoringDistribution}
                    categoryScores={categoryScores}
                    riskProfile={riskProfile}
                    interviewSummaryLine={interviewSummaryLine}
                  />
                </Box>
                {/* Recruiter — moved to the bottom of the Risk &
                    Recommendations column (2026-06-03 request).
                    Surfaced from `users.{uid}.primaryRecruiterId`; null
                    renders as "Unassigned". Clicking opens the
                    recruiter's profile. */}
                <Box sx={{ mt: 1.25 }}>
                  <Typography component="span" sx={recordHeaderColumnTitleSx}>
                    Recruiter
                  </Typography>
                  <Box sx={{ mt: 0.35 }}>
                    {primaryRecruiterId ? (
                      <Link
                        component={RouterLink}
                        to={`/users/${primaryRecruiterId}`}
                        underline="hover"
                        sx={{
                          ...recordHeaderBodyTextSx,
                          color: 'primary.main',
                          fontWeight: 400,
                        }}
                      >
                        {primaryRecruiterName || '…'}
                      </Link>
                    ) : (
                      <Typography variant="body2" sx={recordHeaderBodyTextSx}>
                        Unassigned
                      </Typography>
                    )}
                  </Box>
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

/**
 * Small inline icon for the SCREENING block that reflects the per-line verdict.
 *
 * Mirrors the vocabulary + colors of `StatusChip` in
 * `AccusourceOrderServiceLinesTable.tsx` so recruiters see the same visual for
 * "Passed" in both places. Returns `null` for PENDING / unknown so those lines
 * render without an icon (no visual noise for "waiting" screenings).
 */
function renderVerdictIconForHeader(
  verdict: 'PASSED' | 'FAILED' | 'NEEDS_REVIEW' | 'PENDING' | null | undefined,
): React.ReactNode {
  switch (verdict) {
    case 'PASSED':
      return (
        <CheckCircleIcon
          fontSize="inherit"
          sx={{ color: 'success.main', fontSize: 16, flexShrink: 0, mt: '3px' }}
          aria-label="Passed"
        />
      );
    case 'FAILED':
      return (
        <CancelIcon
          fontSize="inherit"
          sx={{ color: 'error.main', fontSize: 16, flexShrink: 0, mt: '3px' }}
          aria-label="Failed"
        />
      );
    case 'NEEDS_REVIEW':
      return (
        <WarningAmberIcon
          fontSize="inherit"
          sx={{ color: 'warning.main', fontSize: 16, flexShrink: 0, mt: '3px' }}
          aria-label="Needs review"
        />
      );
    case 'PENDING':
      return (
        <HourglassEmptyIcon
          fontSize="inherit"
          sx={{ color: 'text.disabled', fontSize: 16, flexShrink: 0, mt: '3px' }}
          aria-label="Waiting"
        />
      );
    default:
      return null;
  }
}

export default RecruiterUserProfileTableHeader;
