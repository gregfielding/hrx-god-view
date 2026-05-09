import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Card,
  CardHeader,
  CardContent,
  Divider,
  Stack,
  Chip,
  Avatar,
  Tooltip,
  Snackbar,
  Alert,
  Autocomplete,
  Checkbox,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tabs,
  Tab,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { doc, getDoc, updateDoc, collection, getDocs, deleteDoc, where, documentId, query, deleteField } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useNavigate, useLocation } from 'react-router-dom';
import GroupsIcon from '@mui/icons-material/Groups';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EmailIcon from '@mui/icons-material/Email';
import SmsIcon from '@mui/icons-material/Sms';
import MessageDrawer, { type MessageRecipient } from '../../../components/MessageDrawer';
import IconButton from '@mui/material/IconButton';

import { db, storage } from '../../../firebase';
import ImageCropDialog from '../../../components/common/ImageCropDialog';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import PageHeader from '../../../components/PageHeader';
import InboxSearchBar, { compactInboxSearchBarSx } from '../../../components/InboxSearchBar';
import FavoritesFilter from '../../../components/FavoritesFilter';
import FavoriteButton from '../../../components/FavoriteButton';
import { useSetTopBarTitle } from '../../../contexts/TopBarTitleContext';
import { useFavorites } from '../../../hooks/useFavorites';
import { userMatchesSearchTerm } from '../../../utils/recruiterUserSearchMatch';
import { sanitizeWorkerNameParts } from '../../../utils/profileDisplayName';
import { normalizeScoreSummary } from '../../../utils/scoreSummary';
import { getRecruiterMasterDisplayForAdminUi } from '../../../utils/scoring/recruiterMasterScoreDisplay';
import { calculateProfileScore } from '../../../utils/applicantScoring';
import { compareWorkReadinessForEntity } from '../../../utils/recruiterUsersEntityWorkReadiness';
import { useCategoryScoresCurrentMap } from '../../../hooks/useCategoryScoresCurrentMap';
import { useRecruiterUsersRowExtras } from '../../../hooks/useRecruiterUsersRowExtras';
import { useRecruiterUsersLatestBackgroundChecks } from '../../../hooks/useRecruiterUsersLatestBackgroundChecks';
import { useRecruiterUsersEntityEmploymentChips } from '../../../hooks/useRecruiterUsersEntityEmploymentChips';
import UserGroupHiringControlPanel from '../../../components/recruiter/userGroup/UserGroupHiringControlPanel';
import GroupMembersTable, {
  type GroupMemberPreferenceStatus,
  type GroupMembersSortKey,
} from '../../../componentBlocks/GroupMembersTable';
import {
  formatEvaluateMembersOneClickSuccess,
  runEvaluateMembersOneClick,
} from '../../../utils/userGroupEvaluateMembersOneClick';
import {
  formatUserGroupHirePassedSuccess,
  runUserGroupHirePassedExecute,
} from '../../../utils/userGroupHirePassedOneClick';

import AgencyProfileHeader from './AgencyProfileHeader';
import { fetchAgencyUserGroupManagerCandidates } from '../../../utils/userGroupManagerCandidateUsers';

const userGroupLastEvaluatedStorageKey = (tid: string, gid: string) =>
  `userGroupEvaluateLastAt:${tid}:${gid}`;

const UserGroupDetails: React.FC<{ tenantId: string; groupId: string }> = ({
  tenantId,
  groupId,
}) => {
  const [group, setGroup] = useState<any>(null);
  const [editForm, setEditForm] = useState({ title: '', description: '' });
  const [allWorkers, setAllWorkers] = useState<any[]>([]);
  const [membersData, setMembersData] = useState<any[]>([]);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [selectedWorker, setSelectedWorker] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const [agency, setAgency] = useState<any>(null);
  const [tabIndex, setTabIndex] = useState(7); // User Groups tab index
  const [agencyUsers, setAgencyUsers] = useState<any[]>([]);
  const [groupManagerIds, setGroupManagerIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'members' | 'hiring' | 'details'>('members');
  const [membersSearch, setMembersSearch] = useState('');
  const [membersShowFavoritesOnly, setMembersShowFavoritesOnly] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [membersPage, setMembersPage] = useState(0);
  const [membersRowsPerPage, setMembersRowsPerPage] = useState(20);
  const [membersSortBy, setMembersSortBy] = useState<GroupMembersSortKey>('hrxSignup');
  /** Tenant user group titles for Person column (same as /users/all). */
  const [tenantGroupRows, setTenantGroupRows] = useState<Array<{ id: string; title?: string }>>([]);
  const [membersSortDirection, setMembersSortDirection] = useState<'asc' | 'desc'>('desc');
  const { isFavorite: isUserFavorite, toggleFavorite: toggleUserFavorite } = useFavorites('users');
  const { isFavorite: isGroupFavorite, toggleFavorite: toggleGroupFavorite } = useFavorites('userGroups');

  const groupDisplayTitle = editForm.title || group?.title || 'User Group';
  const topBarTitleNode = useMemo(
    () => (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
        <Typography
          sx={{
            fontSize: '20px',
            fontWeight: 600,
            color: 'inherit',
            lineHeight: 1.2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: { xs: 220, sm: 360, md: 520 },
          }}
        >
          {groupDisplayTitle}
        </Typography>
        <FavoriteButton
          itemId={groupId}
          favoriteType="userGroups"
          isFavorite={isGroupFavorite}
          toggleFavorite={toggleGroupFavorite}
          size="small"
          tooltipText={{
            favorited: 'Remove group from favorites',
            notFavorited: 'Add group to favorites',
          }}
          sx={{
            p: 0.25,
            color: 'inherit',
            '& .MuiSvgIcon-root': { fontSize: 18, color: 'inherit' },
          }}
        />
      </Box>
    ),
    [groupDisplayTitle, groupId, isGroupFavorite, toggleGroupFavorite],
  );
  useSetTopBarTitle(topBarTitleNode);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [shareSnackbarOpen, setShareSnackbarOpen] = useState(false);
  const [hirePassedBusy, setHirePassedBusy] = useState(false);
  const [evaluateMembersBusy, setEvaluateMembersBusy] = useState(false);
  const [lastEvaluatedAtIso, setLastEvaluatedAtIso] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAllResults, setSelectAllResults] = useState(false);
  const [bulkDrawerOpen, setBulkDrawerOpen] = useState(false);
  const [bulkDrawerChannel, setBulkDrawerChannel] = useState<'email' | 'sms'>('email');
  const [avatarHover, setAvatarHover] = useState(false);
  const [avatarCropOpen, setAvatarCropOpen] = useState(false);
  const [pendingAvatarSrc, setPendingAvatarSrc] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const lastSavedGroupMetaRef = useRef<{ title: string; description: string } | null>(null);

  // Check if we're accessing from the top-level usergroups page
  const isFromTopLevel = location.pathname.includes('/usergroups') || location.pathname === '/usergroups';

  useEffect(() => {
    fetchGroup();
    fetchAllWorkers();
    fetchAgency();
    fetchAgencyUsers();
    // eslint-disable-next-line
  }, [tenantId, groupId]);

  useEffect(() => {
    try {
      const v = localStorage.getItem(userGroupLastEvaluatedStorageKey(tenantId, groupId));
      setLastEvaluatedAtIso(v && v.trim() ? v.trim() : null);
    } catch {
      setLastEvaluatedAtIso(null);
    }
  }, [tenantId, groupId]);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    void (async () => {
      try {
        const snap = await getDocs(collection(db, 'tenants', tenantId, 'userGroups'));
        if (cancelled) return;
        setTenantGroupRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) })));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const fetchGroup = async () => {
    setLoading(true);
    try {
      const groupRef = doc(db, 'tenants', tenantId, 'userGroups', groupId);
      const groupSnap = await getDoc(groupRef);
      if (groupSnap.exists()) {
        const data = groupSnap.data();
        setGroup({ id: groupId, ...data });
        const nextMeta = { title: data.title || '', description: data.description || '' };
        setEditForm(nextMeta);
        lastSavedGroupMetaRef.current = nextMeta;
        setMemberIds(data.memberIds || []);
        // Prefer the new `roles.onboardingSpecialistIds` field — that's
        // the source of truth the recruiting role model resolver reads.
        // Fall back to the legacy `roles.csaIds` (rename transition
        // window) and then the older `groupManagerIds` for groups that
        // haven't been migrated yet so the panel still shows existing
        // assignments while the backfill runs.
        const onboardingSpecialistIds: string[] = Array.isArray(
          data?.roles?.onboardingSpecialistIds,
        )
          ? data.roles.onboardingSpecialistIds
          : Array.isArray(data?.roles?.csaIds)
            ? data.roles.csaIds
            : [];
        const legacyManagerIds: string[] = Array.isArray(data?.groupManagerIds) ? data.groupManagerIds : [];
        setGroupManagerIds(
          onboardingSpecialistIds.length > 0 ? onboardingSpecialistIds : legacyManagerIds,
        );
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch group');
    }
    setLoading(false);
  };

  const fetchAllWorkers = async () => {
    try {
      const qRef = collection(db, 'users');
      const snapshot = await getDocs(qRef);
      setAllWorkers(
        snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          // Include any non-internal users belonging to this tenant (workers/applicants/etc.)
          .filter((user: any) => {
            const tenantIds = user.tenantIds;
            const belongsToTenant =
              user.tenantId === tenantId ||
              user.activeTenantId === tenantId ||
              (Array.isArray(tenantIds) && tenantIds.includes(tenantId)) ||
              (tenantIds && typeof tenantIds === 'object' && !Array.isArray(tenantIds) && tenantId in tenantIds);

            const levelRaw = user.tenantIds?.[tenantId]?.securityLevel ?? user.securityLevel ?? '0';
            const levelNum = parseInt(String(levelRaw), 10) || 0;
            const isInternal = levelNum >= 5;

            return belongsToTenant && !isInternal;
          }),
      );
    } catch (err: any) {
      // ignore for now
    }
  };

  const fetchMembersByIds = async (ids: string[]) => {
    if (!tenantId) return;
    if (!ids || ids.length === 0) {
      setMembersData([]);
      return;
    }
    try {
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 10) {
        chunks.push(ids.slice(i, i + 10));
      }

      const snaps = await Promise.all(
        chunks.map((chunk) => getDocs(query(collection(db, 'users'), where(documentId(), 'in', chunk))))
      );
      const rawUsers = snaps.flatMap((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })));

      // Normalize/enrich to match the main Users table fields (so score + status display correctly)
      const users = rawUsers.map((u: any) => {
        const tenantData = u?.tenantIds?.[tenantId] || {};
        const securityLevel = String(tenantData.securityLevel || u.securityLevel || '0');

        const rawSkills = Array.isArray(u.skills)
          ? u.skills
          : Array.isArray(tenantData.skills)
          ? tenantData.skills
          : [];
        const normalizedSkills = rawSkills
          .map((skill: any) => {
            if (!skill) return null;
            if (typeof skill === 'string') return skill;
            if (typeof skill === 'object') {
              if (typeof skill.label === 'string') return skill.label;
              if (typeof skill.name === 'string') return skill.name;
              if (typeof skill.value === 'string') return skill.value;
            }
            return null;
          })
          .filter((skill: any) => typeof skill === 'string' && skill.trim().length > 0);

        const phoneRow = String(u.phone || u.phoneE164 || '');
        const nameSanitized = sanitizeWorkerNameParts({
          firstName: u.firstName,
          lastName: u.lastName,
          preferredName: u.preferredName,
          displayName: u.displayName,
          email: u.email,
          phone: phoneRow,
        });

        return {
          ...u,
          firstName: nameSanitized.firstName,
          lastName: nameSanitized.lastName,
          securityLevel,
          avatar: u.avatar || tenantData.avatar,
          phone: u.phone || '',
          scoreSummary: normalizeScoreSummary({
            ...(u.scoreSummary || {}),
            ...((tenantData as { scoreSummary?: Record<string, unknown> }).scoreSummary || {}),
          }),
          aiProfileScore:
            tenantData.aiProfileScore ??
            u.aiProfileScore ??
            u.aiScore ??
            u.aiProfile?.score ??
            calculateProfileScore(u),
          aiJobFitScore: tenantData.aiJobFitScore ?? u.aiJobFitScore,
          skills: normalizedSkills,
        };
      });

      // Preserve group order (memberIds)
      const byId = new Map(users.map((u) => [u.id, u]));
      const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
      setMembersData(ordered as any[]);
    } catch (err) {
      console.error('Failed to fetch group members:', err);
      setMembersData([]);
    }
  };

  const fetchAgency = async () => {
    try {
      const agencyRef = doc(db, 'tenants', tenantId);
      const agencySnap = await getDoc(agencyRef);
      if (agencySnap.exists()) {
        setAgency({ id: tenantId, ...agencySnap.data() });
      }
    } catch {}
  };

  const fetchAgencyUsers = async () => {
    try {
      const rows = await fetchAgencyUserGroupManagerCandidates(db, tenantId);
      setAgencyUsers(rows);
    } catch {
      setAgencyUsers([]);
    }
  };

  const handleEditChange = (field: string, value: string) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleManagersChange = async (newValue: any[]) => {
    // Single picker — writes "Onboarding Specialists" into the new
    // `roles.onboardingSpecialistIds` field that the recruiting role
    // model resolver reads, while also dual-writing to the legacy
    // `groupManagerIds` so older readers (the pre-Phase-4 ownership
    // resolver, the readiness seed runners, anything we haven't
    // migrated yet) keep working until the bandaid comes off.
    //
    // Phase 4b's onUserGroupRolesOrMembersChange trigger watches both
    // `roles.onboardingSpecialistIds` (preferred) and the legacy
    // `roles.csaIds` and fans out `recomputePrimaryForWorker` for every
    // existing member of the group as soon as this update lands. We
    // intentionally do NOT write the legacy `roles.csaIds` field — the
    // defensive read pattern at every consumer keeps that data path
    // alive until the cleanup PR drops it.
    const ids = newValue.map((u: any) => u.id);
    setGroupManagerIds(ids);
    try {
      const groupRef = doc(db, 'tenants', tenantId, 'userGroups', groupId);
      await updateDoc(groupRef, {
        'roles.onboardingSpecialistIds': ids,
        groupManagerIds: ids, // legacy mirror — drop in a follow-up release
      });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to update Onboarding Specialists');
    }
  };

  const saveGroupMetaIfChanged = async () => {
    if (!tenantId || !groupId) return;
    const title = String(editForm.title || '').trim();
    const description = String(editForm.description || '');

    // Require a non-empty title
    if (!title) {
      const last = lastSavedGroupMetaRef.current;
      if (last) setEditForm(last);
      setError('Group title is required.');
      return;
    }

    const last = lastSavedGroupMetaRef.current;
    if (last && last.title === title && last.description === description) return;

    setLoading(true);
    setError('');
    try {
      const groupRef = doc(db, 'tenants', tenantId, 'userGroups', groupId);
      await updateDoc(groupRef, { title, description });
      lastSavedGroupMetaRef.current = { title, description };
      setSuccess(true);
      setGroup((prev: any) => (prev ? { ...prev, title, description } : prev));
    } catch (err: any) {
      setError(err.message || 'Failed to update group');
    } finally {
      setLoading(false);
    }
  };

  const handleAddMember = async () => {
    if (!selectedWorker) return;
    setLoading(true);
    setError('');
    try {
      const groupRef = doc(db, 'tenants', tenantId, 'userGroups', groupId);
      const newMemberIds = memberIds.includes(selectedWorker.id)
        ? memberIds
        : [...memberIds, selectedWorker.id];
      // Default new members to "member" group status (preferred/member/not_preferred)
      const updates: any = { memberIds: newMemberIds };
      if (!memberIds.includes(selectedWorker.id)) {
        updates[`memberStatusById.${selectedWorker.id}`] = 'member';
      }
      await updateDoc(groupRef, updates);
      setMemberIds(newMemberIds);
      await fetchMembersByIds(newMemberIds);
      setSelectedWorker(null);
      setSuccess(true);
      setAddMemberOpen(false);
      // keep local group state in sync
      setGroup((prev: any) => {
        if (!prev) return prev;
        if (memberIds.includes(selectedWorker.id)) return prev;
        return {
          ...prev,
          memberStatusById: {
            ...(prev.memberStatusById || {}),
            [selectedWorker.id]: 'member',
          },
        };
      });
    } catch (err: any) {
      setError(err.message || 'Failed to add member');
    }
    setLoading(false);
  };

  const handleRemoveMember = async (userId: string) => {
    setLoading(true);
    setError('');
    try {
      const groupRef = doc(db, 'tenants', tenantId, 'userGroups', groupId);
      const newMemberIds = memberIds.filter((id) => id !== userId);
      await updateDoc(groupRef, {
        memberIds: newMemberIds,
        [`memberStatusById.${userId}`]: deleteField(),
      });
      setMemberIds(newMemberIds);
      await fetchMembersByIds(newMemberIds);
      setSuccess(true);
      setGroup((prev: any) => {
        if (!prev) return prev;
        const next = { ...(prev.memberStatusById || {}) };
        delete next[userId];
        return { ...prev, memberStatusById: next };
      });
    } catch (err: any) {
      setError(err.message || 'Failed to remove member');
    }
    setLoading(false);
  };

  const handleTabChange = (_: React.SyntheticEvent, newIndex: number) => {
    setTabIndex(newIndex);
    // Navigate to the correct tab in AgencyProfile
    const tabRoutes = [
      'overview',
      'modules',
      'locations',
      'billing',
      'contacts',
      'tenants',
      'workforce',
      'userGroups',
      'jobOrders',
      'shifts',
      'timesheets',
      'reports',
      'aiSettings',
      'activityLogs',
    ];
    if (newIndex !== 7) {
      navigate(`/tenants/${tenantId}?tab=${newIndex}`);
    }
  };

  const handleDeleteGroup = async () => {
    setDeleting(true);
    setError('');
    try {
      await deleteDoc(doc(db, 'tenants', tenantId, 'userGroups', groupId));
      if (isFromTopLevel) {
        navigate('/users/user-groups');
      } else {
        navigate(`/tenants/${tenantId}?tab=6`);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete group');
    }
    setDeleting(false);
  };

  useEffect(() => {
    fetchMembersByIds(memberIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, groupId, memberIds]);

  const members = membersData;

  useEffect(() => {
    setMembersPage(0);
  }, [membersSearch, membersShowFavoritesOnly]);

  const filteredMembers = useMemo(() => {
    let list = [...members];
    if (membersShowFavoritesOnly) {
      list = list.filter((u: { id: string }) => isUserFavorite(u.id));
    }
    if (membersSearch.trim()) {
      list = list.filter((u) => userMatchesSearchTerm(u, membersSearch));
    }
    return list;
  }, [members, membersSearch, membersShowFavoritesOnly, isUserFavorite]);

  const { scoresByUserId: categoryScoresByUserId } = useCategoryScoresCurrentMap(memberIds);
  const availableWorkers = allWorkers.filter((w) => !memberIds.includes(w.id));
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
    if (masterDisp.score100 != null && !Number.isNaN(masterDisp.score100)) return masterDisp.score100;
    return -1;
  };

  const getNameKey = (u: any): string => {
    const first = String(u?.firstName || '').trim().toLowerCase();
    const last = String(u?.lastName || '').trim().toLowerCase();
    return `${last}|${first}|${String(u?.id || '')}`;
  };

  type MemberPreferenceStatus = GroupMemberPreferenceStatus;
  const getMemberPreferenceStatus = (u: any): MemberPreferenceStatus => {
    const raw = group?.memberStatusById?.[u?.id];
    if (raw === 'preferred' || raw === 'member' || raw === 'not_preferred') return raw;
    return 'member';
  };
  const getGroupStatusKey = (u: any): number => {
    const status = getMemberPreferenceStatus(u);
    // Preferred first, then Member, then Not Preferred
    if (status === 'preferred') return 0;
    if (status === 'member') return 1;
    return 2;
  };

  const groupTitleLookup = useMemo(() => {
    const m = new Map<string, string>();
    tenantGroupRows.forEach((g) => m.set(g.id, g.title || g.id));
    return m;
  }, [tenantGroupRows]);

  const { itemsByUserId: entityEmploymentChipsByUser, employmentBreakdownByUserId, loading: _entityChipsLoading } =
    useRecruiterUsersEntityEmploymentChips(tenantId, memberIds);

  const sortedMembers = useMemo(() => {
    const copy = [...filteredMembers];
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- sort helpers close over group / getNameKey / getScoreNumber
  }, [
    filteredMembers,
    membersSortBy,
    membersSortDirection,
    entityEmploymentChipsByUser,
    group,
    categoryScoresByUserId,
  ]);

  const paginatedMembers = useMemo(
    () =>
      sortedMembers.slice(
        membersPage * membersRowsPerPage,
        membersPage * membersRowsPerPage + membersRowsPerPage,
      ),
    [sortedMembers, membersPage, membersRowsPerPage],
  );

  const paginatedMemberIds = useMemo(() => paginatedMembers.map((m) => m.id), [paginatedMembers]);

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

  const handleSelectRow = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (selectAllResults) setSelectAllResults(false);
  }, [selectAllResults]);

  const handleSelectAllResults = useCallback(() => {
    setSelectAllResults(true);
    setSelectedIds(new Set(sortedMembers.map((m) => m.id)));
  }, [sortedMembers]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectAllResults(false);
  }, []);

  const handleEvaluateMembersForNextStep = useCallback(async () => {
    if (!tenantId || !groupId) return;
    setEvaluateMembersBusy(true);
    try {
      const result = await runEvaluateMembersOneClick({ tenantId, groupId });
      const iso = new Date().toISOString();
      try {
        localStorage.setItem(userGroupLastEvaluatedStorageKey(tenantId, groupId), iso);
      } catch {
        /* ignore quota */
      }
      setLastEvaluatedAtIso(iso);
      window.alert(formatEvaluateMembersOneClickSuccess(result));
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e !== null && 'message' in e
            ? String((e as { message: unknown }).message)
            : 'Evaluate members failed';
      window.alert(msg);
    } finally {
      setEvaluateMembersBusy(false);
    }
  }, [tenantId, groupId]);

  const handleHirePassedCandidates = useCallback(async () => {
    if (!tenantId || !groupId) return;
    setHirePassedBusy(true);
    try {
      const result = await runUserGroupHirePassedExecute({ tenantId, groupId });
      window.alert(formatUserGroupHirePassedSuccess(result));
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e !== null && 'message' in e
            ? String((e as { message: unknown }).message)
            : 'Hire passed candidates failed';
      window.alert(msg);
    } finally {
      setHirePassedBusy(false);
    }
  }, [tenantId, groupId]);

  const handleGroupAvatarClick = useCallback(() => {
    avatarFileInputRef.current?.click();
  }, []);

  const handleGroupAvatarFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const src = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
      setPendingAvatarSrc(src);
      setAvatarCropOpen(true);
    } catch (err) {
      console.error('Error reading avatar file:', err);
      setError('Failed to load image.');
    }
    e.target.value = '';
  }, []);

  const handleConfirmGroupAvatarCrop = useCallback(async (blob: Blob) => {
    if (!tenantId || !groupId) return;
    setAvatarBusy(true);
    try {
      const storageRef = ref(storage, `userGroupAvatars/${tenantId}/${groupId}.jpg`);
      await uploadBytes(storageRef, blob, { contentType: blob.type || 'image/jpeg' });
      const downloadURL = await getDownloadURL(storageRef);
      const groupRef = doc(db, 'tenants', tenantId, 'userGroups', groupId);
      await updateDoc(groupRef, { avatar: downloadURL });
      setGroup((prev: any) => (prev ? { ...prev, avatar: downloadURL } : prev));
      setAvatarCropOpen(false);
      setPendingAvatarSrc(null);
    } catch (err: any) {
      console.error('Error saving group avatar:', err);
      setError(err?.message || 'Failed to save group photo.');
    } finally {
      setAvatarBusy(false);
    }
  }, [tenantId, groupId]);

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
    // Match inbox/users behavior: name asc; HRX signup newest first; everything else desc by default
    setMembersSortDirection(key === 'name' ? 'asc' : 'desc');
    setMembersPage(0);
  };

  const handleChangeGroupStatus = async (userId: string, status: MemberPreferenceStatus) => {
    if (!tenantId || !groupId) return;
    try {
      const groupRef = doc(db, 'tenants', tenantId, 'userGroups', groupId);
      await updateDoc(groupRef, { [`memberStatusById.${userId}`]: status });
      setGroup((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          memberStatusById: {
            ...(prev.memberStatusById || {}),
            [userId]: status,
          },
        };
      });
    } catch (err: any) {
      setError(err.message || 'Failed to update group status');
    }
  };

  const noop = () => {
    /* intentionally left blank */
  };

  return (
    <Box sx={{ p: 0, width: '100%' }}>
      {agency && (
        <>
          {!isFromTopLevel && (
            <>
              <AgencyProfileHeader
                uid={tenantId}
                name={agency.name}
                avatarUrl={agency.avatar || ''}
                onAvatarUpdated={noop}
              />
              <Tabs
                value={7}
                onChange={handleTabChange}
                variant="scrollable"
                scrollButtons="auto"
                allowScrollButtonsMobile
                sx={{ mb: 0 }}
              >
                <Tab label="Overview" />
                <Tab label="Modules" />
                <Tab label="Locations" />
                <Tab label="Billing Info" />
                <Tab label="Contacts" />
                <Tab label="Customers" />
                <Tab label="Workforce" />
                <Tab label="User Groups" />
                <Tab label="Job Orders" />
                <Tab label="Shifts" />
                <Tab label="Timesheets" />
                <Tab label="Reports & Insights" />
                <Tab label="AI Settings" />
                <Tab label="Activity Logs" />
              </Tabs>
            </>
          )}
        </>
      )}

      <PageHeader
        dense
        hideHeading
        title=""
        filters={
          <Box sx={{ display: 'flex', gap: 0.35, alignItems: 'center', flexWrap: 'wrap' }}>
            {([
              { id: 'members' as const, label: 'Members' },
              { id: 'hiring' as const, label: 'Hiring' },
              { id: 'details' as const, label: 'Details' },
            ]).map((t) => {
              const isActive = activeTab === t.id;
              return (
                <Button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  variant="text"
                  sx={{
                    textTransform: 'none',
                    borderRadius: '999px',
                    fontSize: '13px',
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? 'white' : 'rgba(0, 0, 0, 0.7)',
                    bgcolor: isActive ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                    px: 1.25,
                    py: 0.5,
                    minHeight: 30,
                    minWidth: 'auto',
                    whiteSpace: 'nowrap',
                    '&:hover': {
                      bgcolor: isActive ? '#004a9f' : 'rgba(0, 0, 0, 0.08)',
                    },
                  }}
                >
                  {t.label}
                </Button>
              );
            })}
          </Box>
        }
        rightActions={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
            {activeTab === 'members' && (
              <>
                <InboxSearchBar
                  value={membersSearch}
                  onChange={setMembersSearch}
                  onSearch={setMembersSearch}
                  placeholder="Search members..."
                  sx={compactInboxSearchBarSx}
                />
                <FavoritesFilter
                  favoriteType="users"
                  showFavoritesOnly={membersShowFavoritesOnly}
                  onToggle={setMembersShowFavoritesOnly}
                  showText={false}
                  size="small"
                  sx={{
                    minWidth: '32px',
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    '&:hover': {
                      backgroundColor: membersShowFavoritesOnly ? 'primary.dark' : 'action.hover',
                    },
                  }}
                />
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
                <Tooltip title="Add member">
                  <span>
                    <IconButton
                      onClick={() => setAddMemberOpen(true)}
                      disabled={loading || availableWorkers.length === 0}
                      sx={{
                        width: 32,
                        height: 32,
                        bgcolor: '#0057B8',
                        color: '#fff',
                        '&:hover': { bgcolor: '#004a9f' },
                        '&.Mui-disabled': {
                          bgcolor: 'rgba(0, 87, 184, 0.35)',
                          color: 'rgba(255, 255, 255, 0.75)',
                        },
                      }}
                    >
                      <AddIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </span>
                </Tooltip>
              </>
            )}
            <Tooltip title="Copy application link">
              <IconButton
                onClick={async () => {
                  const link = `${window.location.origin}/c1/apply/group/${groupId}`;
                  try {
                    await navigator.clipboard.writeText(link);
                    setShareSnackbarOpen(true);
                  } catch (e) {
                    try {
                      await navigator.clipboard.writeText(link);
                      setShareSnackbarOpen(true);
                    } catch {
                      setError('Unable to copy link to clipboard.');
                    }
                  }
                }}
                sx={{
                  width: 32,
                  height: 32,
                  border: '1px solid',
                  borderColor: 'rgba(0, 87, 184, 0.5)',
                  color: '#0057B8',
                  '&:hover': {
                    borderColor: '#0057B8',
                    bgcolor: 'rgba(0, 87, 184, 0.04)',
                  },
                }}
              >
                <ContentCopyIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Back">
              <IconButton
                onClick={() => (isFromTopLevel ? navigate('/users/user-groups') : navigate(`/tenants/${tenantId}?tab=6`))}
                sx={{
                  width: 32,
                  height: 32,
                  border: '1px solid',
                  borderColor: 'rgba(0, 87, 184, 0.5)',
                  color: '#0057B8',
                  '&:hover': {
                    borderColor: '#0057B8',
                    bgcolor: 'rgba(0, 87, 184, 0.04)',
                  },
                }}
              >
                <ArrowBackIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          </Box>
        }
        showDivider={false}
        sx={{ pt: 1, pb: 1 }}
      />

      <Box sx={{ px: { xs: 2, md: 3 }, py: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>

        {activeTab === 'members' && (
          <>
            <GroupMembersTable
              tenantId={tenantId}
              members={sortedMembers}
              paginatedMembers={paginatedMembers}
              loading={loading}
              selectedIds={selectedIds}
              selectAllResults={selectAllResults}
              onSelectRow={handleSelectRow}
              onSelectAllOnPage={handleSelectAllOnPage}
              onClearSelection={handleClearSelection}
              onSelectAllResults={handleSelectAllResults}
              onBulkEmail={() => {
                setBulkDrawerChannel('email');
                setBulkDrawerOpen(true);
              }}
              onBulkSms={() => {
                setBulkDrawerChannel('sms');
                setBulkDrawerOpen(true);
              }}
              sortBy={membersSortBy}
              sortDirection={membersSortDirection}
              onSortChange={handleMembersSort}
              page={membersPage}
              rowsPerPage={membersRowsPerPage}
              onPageChange={setMembersPage}
              onRowsPerPageChange={setMembersRowsPerPage}
              rowDataLookups={{
                entityEmploymentChipsByUser,
                employmentBreakdownByUserId,
                latestNoteByUserId,
                latestInterviewByUserId,
                latestBackgroundByUserId,
                categoryScoresByUserId,
                groupTitleLookup,
              }}
              isUserFavorite={isUserFavorite}
              toggleUserFavorite={toggleUserFavorite}
              getMemberPreferenceStatus={getMemberPreferenceStatus}
              onChangeGroupStatus={handleChangeGroupStatus}
              onRemoveMember={handleRemoveMember}
            />
          </>
        )}

        {activeTab === 'hiring' && (
          <Box sx={{ p: '16px', width: '100%', boxSizing: 'border-box' }}>
            <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>
              Hiring control
            </Typography>
            <UserGroupHiringControlPanel
              tenantId={tenantId}
              groupId={groupId}
              memberCount={memberIds.length}
              memberProfiles={membersData.map((m: { id: string; aiProfileScore?: number; aiJobFitScore?: number }) => ({
                userId: m.id,
                aiProfileScore: m.aiProfileScore,
                aiJobFitScore: m.aiJobFitScore,
              }))}
              onSaved={() => void fetchGroup()}
            />
          </Box>
        )}

        {activeTab === 'details' && (
          <Stack spacing={2}>
            <Card
              variant="outlined"
              sx={{
                p: 1, // reduce card padding by ~16px (theme default is 24px)
                '& .MuiCardHeader-root': { px: 1, pt: 1, pb: 0.5 },
                '& .MuiCardContent-root': { p: 1 },
              }}
            >
              <CardHeader title="Group details" titleTypographyProps={{ fontWeight: 800 }} />
              <CardContent>
                <Stack spacing={2}>
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <TextField
          label="Group Title"
          value={editForm.title}
          onChange={(e) => handleEditChange('title', e.target.value)}
          onBlur={saveGroupMetaIfChanged}
                      fullWidth
        />
        <TextField
          label="Description"
          value={editForm.description}
          onChange={(e) => handleEditChange('description', e.target.value)}
          onBlur={saveGroupMetaIfChanged}
                      fullWidth
          multiline
          minRows={2}
        />
                  </Stack>
                </Stack>
              </CardContent>
            </Card>

            <Card
              variant="outlined"
              sx={{
                p: 1, // reduce card padding by ~16px
                '& .MuiCardHeader-root': { px: 1, pt: 1, pb: 0.5 },
                '& .MuiCardContent-root': { p: 1 },
              }}
            >
              <CardHeader
                title="Onboarding Specialists"
                subheader="These users make welcome / onboarding calls for every member of this group."
                titleTypographyProps={{ fontWeight: 800 }}
                subheaderTypographyProps={{ variant: 'caption', color: 'text.secondary' }}
              />
              <CardContent>
        <Autocomplete
          multiple
          options={agencyUsers}
          getOptionLabel={(u) => `${u.firstName} ${u.lastName}`}
          value={agencyUsers.filter((u) => groupManagerIds.includes(u.id))}
          onChange={(_, newValue) => handleManagersChange(newValue)}
          renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Onboarding Specialists"
                      placeholder="Select Onboarding Specialists"
                      fullWidth
                    />
          )}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => (
                      <Chip
                        {...getTagProps({ index })}
                        key={option.id}
                        label={`${option.firstName} ${option.lastName}`}
                        size="small"
                        sx={{ fontWeight: 600 }}
                      />
            ))
          }
        />
              </CardContent>
            </Card>
          </Stack>
        )}
      </Box>

      {/* Delete Group Button - Bottom of page (match Contact layout) */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          mt: 9,
          pb: 3,
          px: { xs: 2, md: 3 },
        }}
      >
        <Tooltip title={members.length > 0 ? 'Remove all members before deleting this group' : 'Delete group'} arrow>
          <span>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteOutlineIcon />}
              onClick={() => setDeleteDialogOpen(true)}
              disabled={loading || deleting || members.length > 0}
              sx={{
                borderColor: 'error.main',
                textTransform: 'none',
                '&:hover': {
                  borderColor: 'error.dark',
                  backgroundColor: 'error.light',
                },
              }}
            >
              Delete Group
            </Button>
          </span>
        </Tooltip>
      </Box>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
      >
        <DialogTitle id="delete-dialog-title">Confirm Deletion</DialogTitle>
        <DialogContent>
          <Typography id="delete-dialog-description">
            Are you sure you want to delete this group? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} color="primary" disabled={deleting}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              await handleDeleteGroup();
              setDeleteDialogOpen(false);
            }}
            color="error"
            variant="contained"
            disabled={deleting}
          >
            {deleting ? <CircularProgress size={24} /> : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={addMemberOpen} onClose={() => setAddMemberOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add member</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1 }}>
        <Autocomplete
              options={availableWorkers}
          getOptionLabel={(w) => `${w.firstName} ${w.lastName}`}
          value={selectedWorker}
          onChange={(_, newValue) => setSelectedWorker(newValue)}
              renderInput={(params) => <TextField {...params} label="Worker" fullWidth />}
        />
      </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddMemberOpen(false)} disabled={loading} sx={{ textTransform: 'none' }}>
            Cancel
                    </Button>
                    <Button
            variant="contained"
            onClick={handleAddMember}
            disabled={!selectedWorker || loading}
            sx={{ borderRadius: '999px', textTransform: 'none' }}
          >
            Add
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Group updated!
        </Alert>
      </Snackbar>
      <Snackbar open={shareSnackbarOpen} autoHideDuration={2000} onClose={() => setShareSnackbarOpen(false)}>
        <Alert severity="success" sx={{ width: '100%' }} onClose={() => setShareSnackbarOpen(false)}>
          Link copied!
        </Alert>
      </Snackbar>
      <ImageCropDialog
        open={avatarCropOpen}
        title="Edit group photo"
        imageSrc={pendingAvatarSrc}
        cropShape="rect"
        aspect={1}
        confirmLabel={avatarBusy ? 'Saving…' : 'Save'}
        loading={avatarBusy}
        onCancel={() => {
          if (avatarBusy) return;
          setAvatarCropOpen(false);
          setPendingAvatarSrc(null);
          if (avatarFileInputRef.current) avatarFileInputRef.current.value = '';
        }}
        onConfirm={handleConfirmGroupAvatarCrop}
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
    </Box>
  );
};

export default UserGroupDetails;
