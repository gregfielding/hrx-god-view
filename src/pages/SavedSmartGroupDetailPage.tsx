/**
 * Saved Smart Group detail: member list with status and "Update results".
 */

import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Alert,
  MenuItem,
  IconButton,
  FormControl,
  InputLabel,
  Select,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Tooltip,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import type { UsersLayoutOutletContext } from './UsersLayout';
import { doc, getDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { runSavedSmartGroupSearch, type SavedSmartGroupFilters } from '../services/runSavedSmartGroupSearch';
// Only the type from `useSmartGroupSettings` is needed now — the radius-mode
// modal doesn't expose metro/area/city pickers, so we no longer subscribe to
// the per-tenant custom-metros doc on this page.
import type { CustomMetrosMap } from '../hooks/useSmartGroupSettings';
import { formatPhoneNumber } from '../utils/formatPhone';
import { getRecruiterMasterDisplayForAdminUi } from '../utils/scoring/recruiterMasterScoreDisplay';
import MessageDrawer, { type MessageRecipient } from '../components/MessageDrawer';
import { useFavorites } from '../hooks/useFavorites';
import { Autocomplete as GooglePlacesAutocomplete } from '@react-google-maps/api';
import GroupMembersTable, {
  type GroupMembersSortKey,
  type GroupMemberPreferenceStatus,
} from '../componentBlocks/GroupMembersTable';
import UniversalBackButton from '../components/common/UniversalBackButton';
import UniversalSearchBar from '../components/UniversalSearchBar';
import { userMatchesSearchTerm } from '../utils/recruiterUserSearchMatch';
import { useCategoryScoresCurrentMap } from '../hooks/useCategoryScoresCurrentMap';
import { useRecruiterUsersRowExtras } from '../hooks/useRecruiterUsersRowExtras';
import { useRecruiterUsersLatestBackgroundChecks } from '../hooks/useRecruiterUsersLatestBackgroundChecks';
import { useRecruiterUsersEntityEmploymentChips } from '../hooks/useRecruiterUsersEntityEmploymentChips';
import { compareWorkReadinessForEntity } from '../utils/recruiterUsersEntityWorkReadiness';
import { buildWorkHistoryJobTitles } from '../utils/workHistoryJobTitles';

type MemberStatus = 'preferred' | 'member' | 'not_preferred';

export interface SavedSmartGroupDetailPageProps {
  hideHeader?: boolean;
}

const SavedSmartGroupDetailPage: React.FC<SavedSmartGroupDetailPageProps> = ({ hideHeader = false }) => {
  const navigate = useNavigate();
  const { groupId } = useParams<{ groupId: string }>();
  const { tenantId, user } = useAuth();
  // Mounted as a child of `UsersLayout` (`/users/my-smart-groups/:groupId`),
  // so we can pipe our action buttons up into the tabs row's right slot. If
  // this page is ever rendered outside that layout, `useOutletContext` returns
  // null and we fall back to rendering the actions inline (handled below).
  const outletContext = useOutletContext<UsersLayoutOutletContext | null>();
  const setOutletRightActions = outletContext?.setOutletRightActions;
  const [group, setGroup] = useState<{
    name: string;
    memberIds: string[];
    memberStatusById: Record<string, MemberStatus>;
    filters: SavedSmartGroupFilters;
  } | null>(null);
  const [membersData, setMembersData] = useState<Array<{
    id: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    avatar?: string;
    city?: string;
    state?: string;
    createdAt?: any;
    resume?: Record<string, unknown> | null;
    scoreSummary?: { aiScore?: number; interviewLastAt?: any; interviewLastScore10?: number };
    recruiterScoreSnapshot?: unknown;
    recruiterMasterScore?: unknown;
    riskProfile?: unknown;
    securityLevel?: string;
    skills?: string[];
    comfortableEVerify?: string;
    workerAttestations?: { eVerifyWillingness?: string };
    employeeOnboardStatus?: string;
    contractorOnboardStatus?: string;
    onboardingType?: string;
    // Interview-completion signals — drive both the per-row "Order Interview"
    // CTA and the new bulk button. Pulled directly from the user doc when we
    // hydrate members below; absent for users that never interviewed.
    hasWorkerAiPrescreenInterview?: boolean;
    interviewStatus?: string;
    lastInterviewCompletedAt?: any;
    recruiterOrderInterviewSmsLastSentAt?: any;
    /** Pre-computed job titles surfaced in the Work History column. */
    workHistoryJobTitles?: string[];
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [unsaveDialogOpen, setUnsaveDialogOpen] = useState(false);
  const [unsaving, setUnsaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [createdByUid, setCreatedByUid] = useState<string | null>(null);
  const [creatorDisplayName, setCreatorDisplayName] = useState<string | null>(null);
  const [copiedFromGroupId, setCopiedFromGroupId] = useState<string | null>(null);
  const [originalCreatorName, setOriginalCreatorName] = useState<string | null>(null);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAllResults, setSelectAllResults] = useState(false);
  const [bulkDrawerOpen, setBulkDrawerOpen] = useState(false);
  const [bulkDrawerChannel, setBulkDrawerChannel] = useState<'email' | 'sms'>('email');

  // Search / favorites / sort / pagination state for the shared
  // GroupMembersTable. The search + favorites toggle live in the universal
  // search bar piped into `UsersLayout`'s tab-row right slot (see the actions
  // useEffect below); the sort dropdown sits next to it. Filtering happens
  // here in `filteredMembers`, then sort, then pagination — same flow as
  // `UserGroupDetails` so behavior matches between the two detail pages.
  const [membersSearch, setMembersSearch] = useState('');
  const [membersShowFavoritesOnly, setMembersShowFavoritesOnly] = useState(false);
  const [membersSortBy, setMembersSortBy] = useState<GroupMembersSortKey>('hrxSignup');
  const [membersSortDirection, setMembersSortDirection] = useState<'asc' | 'desc'>('desc');
  const [membersPage, setMembersPage] = useState(0);
  const [membersRowsPerPage, setMembersRowsPerPage] = useState(20);

  // Reset to page 0 whenever the visible row set could shrink, otherwise
  // `membersPage` can land past the end of `paginatedMembers`.
  useEffect(() => {
    setMembersPage(0);
  }, [membersSearch, membersShowFavoritesOnly]);
  
  // Favorites — `favorites` array isn't read directly here; the table cell
  // checks membership via `isFavorite` and mutates via `toggleFavorite`.
  const { isFavorite, toggleFavorite } = useFavorites('users');
  
  // Edit dialog state. The pencil in the page header opens a small modal
  // with just the name + address + radius — the only fields a recruiter
  // typically edits after the group is saved. Saving here re-writes the
  // filters as a clean radius-mode config (regardless of how the group was
  // originally built) and re-runs the search. Other filter shapes
  // (residence-area, application-metro, etc.) are still settable from the
  // Add Smart Group builder.
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editRadiusAddress, setEditRadiusAddress] = useState('');
  const [editRadiusLat, setEditRadiusLat] = useState<number | null>(null);
  const [editRadiusLng, setEditRadiusLng] = useState<number | null>(null);
  const [editRadiusMiles, setEditRadiusMiles] = useState(10);
  const radiusAutocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  const RADIUS_OPTIONS = [5, 10, 25, 50];

  useEffect(() => {
    if (!tenantId || !groupId) return;
    let mounted = true;
    (async () => {
      try {
        const ref = doc(db, 'tenants', tenantId, 'savedSmartGroups', groupId);
        const snap = await getDoc(ref);
        if (!mounted) return;
        if (!snap.exists()) {
          setError('Group not found');
          setGroup(null);
          return;
        }
        const data = snap.data();
        const memberIds = Array.isArray(data?.memberIds) ? data.memberIds : [];
        const memberStatusById = (data?.memberStatusById ?? {}) as Record<string, MemberStatus>;
        const filters = (data?.filters ?? {}) as SavedSmartGroupFilters;
        setGroup({
          name: data?.name ?? 'Untitled',
          memberIds,
          memberStatusById,
          filters,
        });
        // Seed the edit modal's local state from the saved filters so a
        // re-open of the pencil pre-populates with the current values.
        setEditRadiusAddress(filters.radiusAddress || '');
        setEditRadiusLat(filters.radiusLat ?? null);
        setEditRadiusLng(filters.radiusLng ?? null);
        setEditRadiusMiles(filters.radiusMiles ?? 10);
        const createdBy = data?.createdBy ?? null;
        const copiedFrom = data?.copiedFromGroupId ?? null;
        setCreatedByUid(createdBy);
        setCopiedFromGroupId(copiedFrom);
        setCreatorDisplayName(null);
        setOriginalCreatorName(null);
        const resolveCreatorName = async (uid: string): Promise<string> => {
          const userSnap = await getDoc(doc(db, 'users', uid));
          if (!userSnap.exists()) return 'Unknown';
          const d = userSnap.data() as any;
          return [d?.firstName, d?.lastName].filter(Boolean).join(' ').trim() || d?.email || 'Unknown';
        };
        if (copiedFrom) {
          const sourceSnap = await getDoc(doc(db, 'tenants', tenantId, 'savedSmartGroups', copiedFrom));
          if (mounted && sourceSnap.exists()) {
            const originalUid = sourceSnap.data()?.createdBy ?? null;
            if (originalUid) {
              const name = await resolveCreatorName(originalUid);
              if (mounted) setOriginalCreatorName(name);
            }
          }
        } else if (createdBy) {
          const name = await resolveCreatorName(createdBy);
          if (mounted) setCreatorDisplayName(name);
        }
        if (memberIds.length === 0) {
          setMembersData([]);
          return;
        }
        const users: Array<{
          id: string;
          firstName?: string;
          lastName?: string;
          email?: string;
          phone?: string;
          avatar?: string;
          city?: string;
          state?: string;
          createdAt?: any;
          resume?: Record<string, unknown> | null;
          scoreSummary?: any;
          recruiterScoreSnapshot?: unknown;
          recruiterMasterScore?: unknown;
          riskProfile?: unknown;
          securityLevel?: string;
          skills?: string[];
          comfortableEVerify?: string;
          workerAttestations?: { eVerifyWillingness?: string };
          employeeOnboardStatus?: string;
          contractorOnboardStatus?: string;
          onboardingType?: string;
          hasWorkerAiPrescreenInterview?: boolean;
          interviewStatus?: string;
          lastInterviewCompletedAt?: any;
          recruiterOrderInterviewSmsLastSentAt?: any;
          workHistoryJobTitles?: string[];
        }> = [];
        for (const uid of memberIds) {
          const userSnap = await getDoc(doc(db, 'users', uid));
          if (!mounted) return;
          if (userSnap.exists()) {
            const d = userSnap.data() as any;
            const tenantData = d?.tenantIds?.[tenantId] || {};
            const addr = d?.addressInfo || d?.address || {};
            users.push({
              id: uid,
              firstName: d?.firstName,
              lastName: d?.lastName,
              email: d?.email,
              phone: d?.phone,
              avatar: d?.avatar || tenantData?.avatar,
              city: addr?.city ?? d?.city,
              state: addr?.state ?? d?.state,
              createdAt: d?.createdAt,
              resume: d?.resume ?? null,
              scoreSummary: d?.scoreSummary,
              recruiterScoreSnapshot: d?.recruiterScoreSnapshot,
              recruiterMasterScore: d?.recruiterMasterScore,
              riskProfile: d?.riskProfile,
              securityLevel: String(tenantData?.securityLevel ?? d?.securityLevel ?? '0'),
              skills: Array.isArray(d?.skills) ? d.skills : [],
              comfortableEVerify: d?.comfortableEVerify,
              workerAttestations: d?.workerAttestations,
              employeeOnboardStatus: d?.employeeOnboardStatus,
              contractorOnboardStatus: d?.contractorOnboardStatus,
              onboardingType: d?.onboardingType,
              hasWorkerAiPrescreenInterview: d?.hasWorkerAiPrescreenInterview === true,
              interviewStatus: d?.interviewStatus,
              lastInterviewCompletedAt: d?.lastInterviewCompletedAt,
              recruiterOrderInterviewSmsLastSentAt: d?.recruiterOrderInterviewSmsLastSentAt,
              // Precompute the table's job-titles column so we don't have
              // to ship the entire `workExperience` array down per row.
              workHistoryJobTitles: buildWorkHistoryJobTitles(d),
            });
          } else {
            users.push({ id: uid });
          }
        }
        setMembersData(users);
      } catch (err: any) {
        if (mounted) setError(err?.message ?? 'Failed to load group');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [tenantId, groupId]);

  const handleStatusChange = async (userId: string, status: MemberStatus) => {
    if (!tenantId || !groupId || !group) return;
    const next = { ...group.memberStatusById, [userId]: status };
    setGroup({ ...group, memberStatusById: next });
    try {
      const ref = doc(db, 'tenants', tenantId, 'savedSmartGroups', groupId);
      await updateDoc(ref, { memberStatusById: next, updatedAt: serverTimestamp() });
    } catch (err: any) {
      setUpdateError(err?.message ?? 'Failed to update status');
    }
  };

  const handleSaveFilters = async () => {
    if (!tenantId || !groupId || !group) return;
    // Modal-based edit: a name + radius-mode address/miles are the only
    // things the modal can change. Bail with a friendly error rather than
    // wiping the group's address out from under the user.
    const trimmedName = editName.trim();
    if (!trimmedName) {
      setSaveError('Name is required.');
      return;
    }
    if (!editRadiusAddress.trim() || editRadiusLat == null || editRadiusLng == null) {
      setSaveError('Pick an address from the suggestions to save.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      // Always normalise to a clean radius-mode filter — the modal doesn't
      // expose the metro/area/city/skills shape, so saving here intentionally
      // collapses any prior shape into a "within N miles of address" group.
      const filters: SavedSmartGroupFilters = {
        filterMode: 'residence',
        residenceSubMode: 'radius',
        metroFilter: null,
        areaFilter: null,
        cityFilter: null,
        categoryFilter: null,
        selectedSkills: [],
        selectedCertifications: [],
        radiusAddress: editRadiusAddress.trim(),
        radiusMiles: editRadiusMiles,
        radiusLat: editRadiusLat,
        radiusLng: editRadiusLng,
      };

      let customMetrosMap: CustomMetrosMap = {};
      try {
        const settingsSnap = await getDoc(doc(db, 'tenants', tenantId, 'settings', 'smartGroups'));
        const settings = settingsSnap.data();
        customMetrosMap = (settings?.customMetros ?? {}) as CustomMetrosMap;
      } catch (_) {}

      const newMemberIds = await runSavedSmartGroupSearch(tenantId, filters, customMetrosMap);
      const existing = group.memberStatusById;
      const memberStatusById: Record<string, MemberStatus> = {};
      newMemberIds.forEach((id) => {
        memberStatusById[id] = (existing[id] as MemberStatus) ?? 'member';
      });

      const ref = doc(db, 'tenants', tenantId, 'savedSmartGroups', groupId);
      await updateDoc(ref, {
        name: trimmedName,
        filters,
        memberIds: newMemberIds,
        memberStatusById,
        updatedAt: serverTimestamp(),
      });

      setGroup({ ...group, name: trimmedName, filters, memberIds: newMemberIds, memberStatusById });
      
      // Reload members data
      const users: Array<{
        id: string;
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string;
        avatar?: string;
        city?: string;
        state?: string;
        createdAt?: any;
        resume?: Record<string, unknown> | null;
        scoreSummary?: any;
        recruiterScoreSnapshot?: unknown;
        recruiterMasterScore?: unknown;
        riskProfile?: unknown;
        securityLevel?: string;
        skills?: string[];
        comfortableEVerify?: string;
        workerAttestations?: { eVerifyWillingness?: string };
        employeeOnboardStatus?: string;
        contractorOnboardStatus?: string;
        onboardingType?: string;
        hasWorkerAiPrescreenInterview?: boolean;
        interviewStatus?: string;
        lastInterviewCompletedAt?: any;
        recruiterOrderInterviewSmsLastSentAt?: any;
        workHistoryJobTitles?: string[];
      }> = [];
      for (const uid of newMemberIds) {
        const userSnap = await getDoc(doc(db, 'users', uid));
        if (userSnap.exists()) {
          const d = userSnap.data() as any;
          const tenantData = d?.tenantIds?.[tenantId] || {};
          const addr = d?.addressInfo || d?.address || {};
          users.push({
            id: uid,
            firstName: d?.firstName,
            lastName: d?.lastName,
            email: d?.email,
            phone: d?.phone,
            avatar: d?.avatar || tenantData?.avatar,
            city: addr?.city ?? d?.city,
            state: addr?.state ?? d?.state,
            createdAt: d?.createdAt,
            resume: d?.resume ?? null,
            scoreSummary: d?.scoreSummary,
            recruiterScoreSnapshot: d?.recruiterScoreSnapshot,
            recruiterMasterScore: d?.recruiterMasterScore,
            riskProfile: d?.riskProfile,
            securityLevel: String(tenantData?.securityLevel ?? d?.securityLevel ?? '0'),
            skills: Array.isArray(d?.skills) ? d.skills : [],
            comfortableEVerify: d?.comfortableEVerify,
            workerAttestations: d?.workerAttestations,
            employeeOnboardStatus: d?.employeeOnboardStatus,
            contractorOnboardStatus: d?.contractorOnboardStatus,
            onboardingType: d?.onboardingType,
            hasWorkerAiPrescreenInterview: d?.hasWorkerAiPrescreenInterview === true,
            interviewStatus: d?.interviewStatus,
            lastInterviewCompletedAt: d?.lastInterviewCompletedAt,
            recruiterOrderInterviewSmsLastSentAt: d?.recruiterOrderInterviewSmsLastSentAt,
            workHistoryJobTitles: buildWorkHistoryJobTitles(d),
          });
        } else {
          users.push({ id: uid });
        }
      }
      setMembersData(users);
      setEditDialogOpen(false);
    } catch (err: any) {
      setSaveError(err?.message ?? 'Failed to save filters');
    } finally {
      setSaving(false);
    }
  };

  const handleUnsaveGroup = async () => {
    if (!tenantId || !groupId) return;
    setUnsaving(true);
    try {
      const ref = doc(db, 'tenants', tenantId, 'savedSmartGroups', groupId);
      await deleteDoc(ref);
      setUnsaveDialogOpen(false);
      navigate('/users/my-smart-groups');
    } catch (err: any) {
      setUpdateError(err?.message ?? 'Failed to unsave group');
    } finally {
      setUnsaving(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!tenantId || !groupId) return;
    setDeleting(true);
    try {
      const ref = doc(db, 'tenants', tenantId, 'savedSmartGroups', groupId);
      await deleteDoc(ref);
      navigate('/users/my-smart-groups');
    } catch (err: any) {
      setError(err?.message ?? 'Failed to delete group');
      setDeleting(false);
    }
  };

  // Open the edit modal pre-populated from the saved group. We always seed
  // the modal in radius mode — that's the only shape the modal can save —
  // even if the group was originally built with a metro/area/skills filter.
  const openEditDialog = () => {
    if (!group) return;
    setEditName(group.name || '');
    setEditRadiusAddress(group.filters.radiusAddress || '');
    setEditRadiusLat(group.filters.radiusLat ?? null);
    setEditRadiusLng(group.filters.radiusLng ?? null);
    setEditRadiusMiles(group.filters.radiusMiles ?? 10);
    setSaveError(null);
    setEditDialogOpen(true);
  };

  const handleCancelEdit = () => {
    setEditDialogOpen(false);
    setSaveError(null);
  };

  const handleUpdateResults = async () => {
    if (!tenantId || !groupId || !group) return;
    setUpdating(true);
    setUpdateError(null);
    try {
      let customMetros: CustomMetrosMap = {};
      try {
        const settingsSnap = await getDoc(doc(db, 'tenants', tenantId, 'settings', 'smartGroups'));
        const settings = settingsSnap.data();
        customMetros = (settings?.customMetros ?? {}) as CustomMetrosMap;
      } catch (_) {}
      const newMemberIds = await runSavedSmartGroupSearch(tenantId, group.filters, customMetros);
      const existing = group.memberStatusById;
      const memberStatusById: Record<string, MemberStatus> = {};
      newMemberIds.forEach((id) => {
        memberStatusById[id] = (existing[id] as MemberStatus) ?? 'member';
      });
      const ref = doc(db, 'tenants', tenantId, 'savedSmartGroups', groupId);
      await updateDoc(ref, {
        memberIds: newMemberIds,
        memberStatusById,
        updatedAt: serverTimestamp(),
      });
      setGroup((g) => (g ? { ...g, memberIds: newMemberIds, memberStatusById } : null));

      // Fast path: when the matched set hasn't changed AND we already have
      // those rows hydrated from the initial load, skip the slow per-user
      // re-fetch below. The list on screen is already correct, so spinning
      // for another 10–30s of sequential `getDoc`s just to overwrite the
      // same data is wasted work — and visually misleading. The auto-refresh
      // on mount hits this path almost every time, which is exactly when
      // users are most likely to notice the lingering spinner.
      const previousMemberIdsSet = new Set(group.memberIds || []);
      const memberIdsUnchanged =
        newMemberIds.length === previousMemberIdsSet.size &&
        newMemberIds.every((id) => previousMemberIdsSet.has(id));
      const allRowsHydrated =
        memberIdsUnchanged &&
        membersData.length === newMemberIds.length &&
        newMemberIds.every((id) => membersData.some((m) => m.id === id));
      if (allRowsHydrated) return;

      const users: Array<{
        id: string;
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string;
        avatar?: string;
        city?: string;
        state?: string;
        createdAt?: any;
        resume?: Record<string, unknown> | null;
        scoreSummary?: any;
        recruiterScoreSnapshot?: unknown;
        recruiterMasterScore?: unknown;
        riskProfile?: unknown;
        securityLevel?: string;
        skills?: string[];
        comfortableEVerify?: string;
        workerAttestations?: { eVerifyWillingness?: string };
        employeeOnboardStatus?: string;
        contractorOnboardStatus?: string;
        onboardingType?: string;
        hasWorkerAiPrescreenInterview?: boolean;
        interviewStatus?: string;
        lastInterviewCompletedAt?: any;
        recruiterOrderInterviewSmsLastSentAt?: any;
        workHistoryJobTitles?: string[];
      }> = [];
      for (const uid of newMemberIds) {
        const userSnap = await getDoc(doc(db, 'users', uid));
        if (userSnap.exists()) {
          const d = userSnap.data() as any;
          const tenantData = d?.tenantIds?.[tenantId] || {};
          const addr = d?.addressInfo || d?.address || {};
          users.push({
            id: uid,
            firstName: d?.firstName,
            lastName: d?.lastName,
            email: d?.email,
            phone: d?.phone,
            avatar: d?.avatar || tenantData?.avatar,
            city: addr?.city ?? d?.city,
            state: addr?.state ?? d?.state,
            createdAt: d?.createdAt,
            resume: d?.resume ?? null,
            scoreSummary: d?.scoreSummary,
            recruiterScoreSnapshot: d?.recruiterScoreSnapshot,
            recruiterMasterScore: d?.recruiterMasterScore,
            riskProfile: d?.riskProfile,
            securityLevel: String(tenantData?.securityLevel ?? d?.securityLevel ?? '0'),
            skills: Array.isArray(d?.skills) ? d.skills : [],
            comfortableEVerify: d?.comfortableEVerify,
            workerAttestations: d?.workerAttestations,
            employeeOnboardStatus: d?.employeeOnboardStatus,
            contractorOnboardStatus: d?.contractorOnboardStatus,
            onboardingType: d?.onboardingType,
            hasWorkerAiPrescreenInterview: d?.hasWorkerAiPrescreenInterview === true,
            interviewStatus: d?.interviewStatus,
            lastInterviewCompletedAt: d?.lastInterviewCompletedAt,
            recruiterOrderInterviewSmsLastSentAt: d?.recruiterOrderInterviewSmsLastSentAt,
            workHistoryJobTitles: buildWorkHistoryJobTitles(d),
          });
        } else {
          users.push({ id: uid });
        }
      }
      setMembersData(users);
    } catch (err: any) {
      const errorMessage = err?.message ?? 'Failed to update results';
      // If it's a geocoding error, show a more helpful message
      if (errorMessage.includes('geocode') || errorMessage.includes('Geocoding')) {
        setUpdateError(errorMessage);
      } else {
        setUpdateError(`Failed to update results: ${errorMessage}`);
      }
    } finally {
      setUpdating(false);
    }
  };

  // Pipe the page's primary actions (search, sort, refresh, back) up into
  // the `UsersLayout` tabs row so they sit on the same line as the tab
  // pills, right-justified. Cancel/Save live inside the edit modal instead
  // of in this row. We use a ref for the handler so the registered node
  // only changes when a visible state primitive flips — otherwise this
  // would loop back through `setOutletRightActions` every render.
  const actionHandlersRef = useRef({
    handleUpdateResults,
  });
  actionHandlersRef.current = {
    handleUpdateResults,
  };
  useEffect(() => {
    if (!setOutletRightActions) return;
    const memberOrderValue =
      membersSortBy === 'hrxSignup' || membersSortBy === 'name'
        ? `${membersSortBy}:${membersSortDirection}`
        : '';
    const node = (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          flexShrink: 0,
          flexWrap: 'nowrap',
          justifyContent: 'flex-end',
        }}
      >
        <UniversalSearchBar
          value={membersSearch}
          onChange={setMembersSearch}
          onSearch={setMembersSearch}
          placeholder="Search members..."
          favoriteType="users"
          showFavoritesOnly={membersShowFavoritesOnly}
          onToggleFavorites={setMembersShowFavoritesOnly}
        />
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel id="smart-group-member-order-label">Order members</InputLabel>
          <Select
            labelId="smart-group-member-order-label"
            label="Order members"
            value={memberOrderValue}
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
        <Tooltip title={updating ? 'Updating…' : 'Update results'}>
          <span>
            <IconButton
              onClick={() => actionHandlersRef.current.handleUpdateResults()}
              disabled={updating}
              aria-label="Update results"
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
                '&.Mui-disabled': {
                  borderColor: 'rgba(0, 87, 184, 0.2)',
                  color: 'rgba(0, 87, 184, 0.3)',
                },
              }}
            >
              {/* Spin the icon in place while updating instead of swapping
                  to a CircularProgress — keeps the button glyph consistent
                  and signals "the same action is running". */}
              <RefreshIcon
                sx={{
                  fontSize: 18,
                  animation: updating ? 'smartGroupRefreshSpin 0.9s linear infinite' : 'none',
                  '@keyframes smartGroupRefreshSpin': {
                    from: { transform: 'rotate(0deg)' },
                    to: { transform: 'rotate(360deg)' },
                  },
                }}
              />
            </IconButton>
          </span>
        </Tooltip>
        <UniversalBackButton to="/users/my-smart-groups" />
      </Box>
    );
    setOutletRightActions(node);
    return () => setOutletRightActions(null);
  }, [
    setOutletRightActions,
    updating,
    membersSearch,
    membersShowFavoritesOnly,
    membersSortBy,
    membersSortDirection,
  ]);

  // Auto-refresh the member list once the saved group has loaded. Keyed on
  // `groupId` (not `group`) so re-fetching after `handleUpdateResults` finishes
  // — which calls `setGroup(...)` — doesn't retrigger the auto-refresh and
  // loop. We intentionally read `handleUpdateResults` through the ref so this
  // effect's dep array stays minimal and the auto-refresh only fires on first
  // mount per group.
  const autoRefreshedGroupIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!groupId || !group) return;
    if (autoRefreshedGroupIdRef.current === groupId) return;
    autoRefreshedGroupIdRef.current = groupId;
    // Fire-and-forget — `handleUpdateResults` flips the `updating` flag, which
    // drives the spinning RefreshIcon up in the tab row.
    void actionHandlersRef.current.handleUpdateResults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, group]);

  // Selection handlers (must be before early return). Page-aware checkbox
  // logic now lives in `handleSelectAllOnPagePaginated` below — this lower-
  // level row toggle is wrapped by `handleSelectRowSingle` for the table.
  const handleSelectRow = (userId: string, checked: boolean) => {
    if (selectAllResults) {
      if (checked) return;
      setSelectAllResults(false);
      setSelectedIds(new Set(membersData.filter((m) => m.id !== userId).map((m) => m.id)));
      return;
    }
    const next = new Set(selectedIds);
    if (checked) next.add(userId);
    else next.delete(userId);
    setSelectedIds(next);
  };

  const handleSelectAllResults = () => {
    setSelectAllResults(true);
    setSelectedIds(new Set());
  };

  const handleClearSelection = () => {
    setSelectAllResults(false);
    setSelectedIds(new Set());
  };

  const bulkRecipientsAndIds = useMemo(() => {
    const rowsToUse = selectAllResults
      ? membersData
      : membersData.filter((m) => selectedIds.has(m.id));
    const recipients: MessageRecipient[] = rowsToUse.map((m) => ({
      userId: m.id,
      name: [m.firstName, m.lastName].filter(Boolean).join(' ').trim() || m.id,
      email: m.email,
      phone: m.phone ? formatPhoneNumber(m.phone) : undefined,
    }));
    const recipientUserIds = rowsToUse.map((m) => m.id);
    return { recipients, recipientUserIds };
  }, [selectAllResults, selectedIds, membersData]);

  // Helpers for sorting (mirror UserGroupDetails so sort behavior matches).
  const memberIdsForLookup = useMemo(() => membersData.map((m) => m.id), [membersData]);
  const { scoresByUserId: categoryScoresByUserId } = useCategoryScoresCurrentMap(memberIdsForLookup);
  const {
    itemsByUserId: entityEmploymentChipsByUser,
    employmentBreakdownByUserId,
  } = useRecruiterUsersEntityEmploymentChips(tenantId ?? '', memberIdsForLookup);

  // Apply favorites + search filter before sort. Mirrors `UserGroupDetails`
  // (`filteredMembers` there) so the two detail pages stay in sync.
  const filteredMembers = useMemo(() => {
    let list = membersData;
    if (membersShowFavoritesOnly) {
      list = list.filter((u) => isFavorite(u.id));
    }
    const q = membersSearch.trim();
    if (q) {
      list = list.filter((u) => userMatchesSearchTerm(u as any, q));
    }
    return list;
  }, [membersData, membersShowFavoritesOnly, membersSearch, isFavorite]);

  const sortedMembers = useMemo(() => {
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
    const getNameKey = (u: any): string => {
      const first = String(u?.firstName || '').trim().toLowerCase();
      const last = String(u?.lastName || '').trim().toLowerCase();
      return `${last}|${first}|${String(u?.id || '')}`;
    };
    const getScoreNumber = (u: any): number => {
      // Reuse the master display logic so the Score column sort matches what
      // the cell renders. We don't need the full display; just the numeric.
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
      return masterDisp.score100 != null && !Number.isNaN(masterDisp.score100)
        ? masterDisp.score100
        : -1;
    };
    const getGroupStatusKey = (u: any): number => {
      const raw = group?.memberStatusById?.[u.id];
      if (raw === 'preferred') return 0;
      if (raw === 'not_preferred') return 2;
      return 1;
    };
    const copy = [...filteredMembers];
    copy.sort((a: any, b: any) => {
      if (membersSortBy === 'workReadiness') {
        return compareWorkReadinessForEntity(
          entityEmploymentChipsByUser?.get(a.id) as any,
          entityEmploymentChipsByUser?.get(b.id) as any,
          'select',
          membersSortDirection,
        );
      }
      let cmp = 0;
      switch (membersSortBy) {
        case 'hrxSignup':
          cmp = toMillis(a?.createdAt) - toMillis(b?.createdAt);
          break;
        case 'name':
          cmp = getNameKey(a).localeCompare(getNameKey(b));
          break;
        case 'score':
          cmp = getScoreNumber(a) - getScoreNumber(b);
          break;
        case 'groupStatus':
          cmp = getGroupStatusKey(a) - getGroupStatusKey(b);
          break;
        case 'lastLogin':
          cmp = toMillis((a as any)?.lastLoginAt) - toMillis((b as any)?.lastLoginAt);
          break;
        default:
          cmp = 0;
      }
      return membersSortDirection === 'asc' ? cmp : -cmp;
    });
    return copy;
    // The `group` reference is intentionally elided — sort only needs to react
    // to membership/score changes; status updates are flushed through the chip
    // optimistic update path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredMembers, membersSortBy, membersSortDirection, entityEmploymentChipsByUser, categoryScoresByUserId]);

  const paginatedMembers = useMemo(
    () => sortedMembers.slice(membersPage * membersRowsPerPage, membersPage * membersRowsPerPage + membersRowsPerPage),
    [sortedMembers, membersPage, membersRowsPerPage],
  );
  const paginatedMemberIds = useMemo(() => paginatedMembers.map((m) => m.id), [paginatedMembers]);

  const { latestNoteByUserId, latestInterviewByUserId } = useRecruiterUsersRowExtras(paginatedMemberIds);
  const { latestByUserId: latestBackgroundByUserId } = useRecruiterUsersLatestBackgroundChecks(
    tenantId ?? '',
    paginatedMemberIds,
  );

  // Smart groups don't surface "in user groups" lines on this view, so we
  // pass an empty Map. Wiring the tenant userGroups subscription here is a
  // future enhancement if/when product wants the parity column.
  const groupTitleLookup = useMemo(() => new Map<string, string>(), []);

  // Reset pagination whenever the underlying member list changes so the user
  // doesn't end up on an empty page after an "Update results" run.
  useEffect(() => {
    setMembersPage(0);
  }, [membersData.length]);

  const getMemberPreferenceStatus = useCallback(
    (u: any): GroupMemberPreferenceStatus => {
      const raw = group?.memberStatusById?.[u.id];
      if (raw === 'preferred' || raw === 'not_preferred') return raw;
      return 'member';
    },
    [group?.memberStatusById],
  );

  const handleMembersSort = useCallback(
    (key: GroupMembersSortKey) => {
      if (membersSortBy === key) {
        setMembersSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
        setMembersPage(0);
        return;
      }
      setMembersSortBy(key);
      setMembersSortDirection(key === 'name' ? 'asc' : 'desc');
      setMembersPage(0);
    },
    [membersSortBy],
  );

  const handleSelectRowSingle = useCallback(
    (id: string) => {
      handleSelectRow(id, !(selectAllResults || selectedIds.has(id)));
    },
    // handleSelectRow is defined above and stable enough for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedIds, selectAllResults],
  );

  const handleSelectAllOnPagePaginated = useCallback(() => {
    const allOnPage = paginatedMembers.length > 0 && paginatedMembers.every((m) => selectAllResults || selectedIds.has(m.id));
    if (allOnPage) {
      const next = new Set(selectedIds);
      paginatedMembers.forEach((m) => next.delete(m.id));
      setSelectedIds(next);
      setSelectAllResults(false);
    } else {
      const next = new Set(selectedIds);
      paginatedMembers.forEach((m) => next.add(m.id));
      setSelectedIds(next);
    }
  }, [paginatedMembers, selectedIds, selectAllResults]);

  if (loading || !group) {
    return (
      <Box sx={{ pt: 2, px: 2, pb: 2 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        )}
      </Box>
    );
  }

  // Per-row Group Status / Score / WorkStatus / formatDate rendering used to
  // live here. They've migrated into <GroupMembersTable /> and the bespoke
  // sort logic above (`renderAiScore`/`getWorkStatusDisplay` are no longer
  // referenced from this file). `activeAssignmentUserIds` is still consumed
  // by the table via its own hooks.

  const formatKeyToDisplayName = (key: string): string => {
    if (!key) return '';
    // Convert keys like "dallas_fort_worth" to "Dallas Fort Worth"
    return key
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const formatFiltersSummary = (filters: SavedSmartGroupFilters): string => {
    const parts: string[] = [];
    
    if (filters.filterMode === 'residence') {
      if (filters.residenceSubMode === 'radius' && filters.radiusAddress) {
        const radius = filters.radiusMiles ?? 10;
        parts.push(`Location: ${radius} miles from ${filters.radiusAddress}`);
      } else {
        const locationParts: string[] = [];
        if (filters.metroFilter && filters.metroFilter !== '__other__') {
          locationParts.push(formatKeyToDisplayName(filters.metroFilter));
        }
        if (filters.areaFilter) {
          locationParts.push(formatKeyToDisplayName(filters.areaFilter));
        }
        if (filters.cityFilter) {
          locationParts.push(formatKeyToDisplayName(filters.cityFilter));
        }
        if (locationParts.length > 0) {
          parts.push(`Location: ${locationParts.join(', ')}`);
        } else {
          parts.push('Location: Any');
        }
      }
    } else if (filters.filterMode === 'application') {
      const locationParts: string[] = [];
      if (filters.metroFilter && filters.metroFilter !== '__other__') {
        locationParts.push(formatKeyToDisplayName(filters.metroFilter));
      }
      if (filters.areaFilter) {
        locationParts.push(formatKeyToDisplayName(filters.areaFilter));
      }
      if (filters.cityFilter) {
        locationParts.push(formatKeyToDisplayName(filters.cityFilter));
      }
      if (locationParts.length > 0) {
        parts.push(`Application Location: ${locationParts.join(', ')}`);
      }
      if (filters.categoryFilter) {
        parts.push(`Category: ${formatKeyToDisplayName(filters.categoryFilter)}`);
      }
    }
    
    if (filters.selectedSkills && filters.selectedSkills.length > 0) {
      parts.push(`Skills: ${filters.selectedSkills.join(', ')}`);
    }
    
    if (filters.selectedCertifications && filters.selectedCertifications.length > 0) {
      parts.push(`Certifications: ${filters.selectedCertifications.join(', ')}`);
    }
    
    return parts.length > 0 ? parts.join(' • ') : 'No filters applied';
  };

  return (
    <Box sx={{ pt: '4px', px: 2, pb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="h6">{group.name}</Typography>
            <IconButton
              size="small"
              onClick={openEditDialog}
              sx={{ ml: 0.5, p: 0.25 }}
              title="Edit smart group"
            >
              <EditIcon sx={{ fontSize: 14 }} />
            </IconButton>
            {/* The standalone delete trash icon was removed — destructive
                delete now lives inside the edit modal (with confirmation),
                so the header stays free of duplicate actions. The "Unsave"
                button is still surfaced here for groups copied from another
                user's smart group, since unsave is a distinct action. */}
            {copiedFromGroupId && (
              <Button
                size="small"
                variant="outlined"
                color="secondary"
                onClick={() => setUnsaveDialogOpen(true)}
                sx={{ textTransform: 'none', ml: 0.5 }}
              >
                Unsave
              </Button>
            )}
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            {formatFiltersSummary(group.filters)}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
            {copiedFromGroupId
              ? (originalCreatorName != null ? `Original creator: ${originalCreatorName}` : 'Original creator: …')
              : createdByUid === user?.uid
                ? 'Created by: me'
                : creatorDisplayName != null
                  ? `Created by: ${creatorDisplayName}`
                  : createdByUid
                    ? 'Created by: …'
                    : null}
          </Typography>
        </Box>
      </Box>
      
      {saveError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setSaveError(null)}>
          {saveError}
        </Alert>
      )}
      
      {updateError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setUpdateError(null)}>
          {updateError}
        </Alert>
      )}
      <GroupMembersTable
        tenantId={tenantId ?? ''}
        members={sortedMembers}
        paginatedMembers={paginatedMembers}
        loading={false}
        selectedIds={selectedIds}
        selectAllResults={selectAllResults}
        onSelectRow={handleSelectRowSingle}
        onSelectAllOnPage={handleSelectAllOnPagePaginated}
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
        onRowsPerPageChange={(rows) => {
          setMembersRowsPerPage(rows);
          setMembersPage(0);
        }}
        rowDataLookups={{
          entityEmploymentChipsByUser,
          employmentBreakdownByUserId,
          latestNoteByUserId,
          latestInterviewByUserId,
          latestBackgroundByUserId,
          categoryScoresByUserId,
          groupTitleLookup,
        }}
        isUserFavorite={isFavorite}
        toggleUserFavorite={toggleFavorite}
        getMemberPreferenceStatus={getMemberPreferenceStatus}
        onChangeGroupStatus={handleStatusChange}
        emptyStateText={'No members. Click "Update results" to re-run the saved search.'}
      />

      {/*
        Edit modal — replaces the prior in-page edit panel. Intentionally
        narrow: name + radius address + radius miles only. Saving collapses
        whatever filter shape the group originally had into a clean
        radius-mode search (see `handleSaveFilters`).
      */}
      <Dialog
        open={editDialogOpen}
        onClose={() => {
          if (!saving) handleCancelEdit();
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Edit Smart Group</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label="Name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              fullWidth
              size="small"
              autoFocus
              disabled={saving}
            />
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <GooglePlacesAutocomplete
                onLoad={(autocomplete) => {
                  radiusAutocompleteRef.current = autocomplete;
                }}
                onPlaceChanged={() => {
                  const place = radiusAutocompleteRef.current?.getPlace();
                  if (!place) return;
                  const loc = place.geometry?.location;
                  if (loc) {
                    const lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
                    const lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
                    if (typeof lat === 'number' && typeof lng === 'number') {
                      setEditRadiusAddress(place.formatted_address ?? '');
                      setEditRadiusLat(lat);
                      setEditRadiusLng(lng);
                    }
                  }
                }}
                options={{
                  types: ['geocode'],
                  fields: ['geometry', 'formatted_address'],
                }}
              >
                <TextField
                  label="Address"
                  placeholder="Search city, state or full address"
                  value={editRadiusAddress}
                  onChange={(e) => {
                    // Typing invalidates the previously-geocoded coords; the
                    // user must pick a place from the dropdown for save to
                    // be allowed (see `handleSaveFilters`).
                    setEditRadiusAddress(e.target.value);
                    setEditRadiusLat(null);
                    setEditRadiusLng(null);
                  }}
                  size="small"
                  disabled={saving}
                  sx={{ flex: 1, minWidth: 240 }}
                />
              </GooglePlacesAutocomplete>
              <FormControl size="small" sx={{ minWidth: 120 }} disabled={saving}>
                <InputLabel id="edit-smart-group-radius-label">Radius</InputLabel>
                <Select
                  labelId="edit-smart-group-radius-label"
                  label="Radius"
                  value={editRadiusMiles}
                  onChange={(e) => setEditRadiusMiles(Number(e.target.value))}
                >
                  {RADIUS_OPTIONS.map((m) => (
                    <MenuItem key={m} value={m}>{m} mi</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
            {saveError && (
              <Alert severity="error" onClose={() => setSaveError(null)}>
                {saveError}
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
          <Button
            onClick={() => setDeleteDialogOpen(true)}
            color="error"
            disabled={saving || deleting}
            startIcon={<DeleteIcon />}
            sx={{ textTransform: 'none' }}
          >
            Delete
          </Button>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              onClick={handleCancelEdit}
              disabled={saving}
              sx={{ textTransform: 'none' }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveFilters}
              variant="contained"
              disabled={saving}
              startIcon={<SaveIcon />}
              sx={{ textTransform: 'none' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </Box>
        </DialogActions>
      </Dialog>

      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
      >
        <DialogTitle>Delete Smart Group</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete &quot;{group.name}&quot;? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button onClick={handleDeleteGroup} color="error" disabled={deleting} variant="contained">
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={unsaveDialogOpen} onClose={() => setUnsaveDialogOpen(false)}>
        <DialogTitle>Unsave Smart Group</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Remove &quot;{group.name}&quot; from My Smart Groups? The group will no longer appear in your list, but the original (if any) is unchanged.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUnsaveDialogOpen(false)} disabled={unsaving}>
            Cancel
          </Button>
          <Button onClick={handleUnsaveGroup} color="primary" disabled={unsaving} variant="contained">
            {unsaving ? 'Removing…' : 'Unsave'}
          </Button>
        </DialogActions>
      </Dialog>

        <MessageDrawer
          open={bulkDrawerOpen}
          onClose={() => setBulkDrawerOpen(false)}
          recipients={bulkRecipientsAndIds.recipients}
          initialChannel={bulkDrawerChannel}
          recipientUserIds={bulkRecipientsAndIds.recipientUserIds}
        />
      </Box>
    );
  };

  export default SavedSmartGroupDetailPage;
