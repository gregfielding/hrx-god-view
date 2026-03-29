/**
 * Saved Smart Group detail: member list with status and "Update results".
 */

import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Alert,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Menu,
  MenuItem,
  Avatar,
  Tooltip,
  IconButton,
  FormControl,
  InputLabel,
  Select,
  Autocomplete,
  TextField,
  ToggleButtonGroup,
  ToggleButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Checkbox,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RefreshIcon from '@mui/icons-material/Refresh';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Cancel';
import EmailIcon from '@mui/icons-material/Email';
import PhoneIcon from '@mui/icons-material/Phone';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import WorkIcon from '@mui/icons-material/Work';
import InsightsIcon from '@mui/icons-material/Insights';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { toChipLabel } from '../utils/chipLabel';
import BlockIcon from '@mui/icons-material/Block';
import ClearIcon from '@mui/icons-material/Clear';
import SmsIcon from '@mui/icons-material/Sms';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { runSavedSmartGroupSearch, type SavedSmartGroupFilters } from '../services/runSavedSmartGroupSearch';
import { useSmartGroupSettings, type CustomMetrosMap } from '../hooks/useSmartGroupSettings';
import { formatPhoneNumber } from '../utils/formatPhone';
import { TABLE_AVATAR_SIZE } from '../utils/uiConstants';
import { formatOneDecimal } from '../utils/scoreSummary';
import { getWorkAuthorizedStatus } from '../utils/workAuthorizedDisplay';
import { getEVerifyComfortStatusFromUserData } from '../utils/eVerifyComfortDisplay';
import WorkAuthorizedChip from '../components/WorkAuthorizedChip';
import EVerifyComfortChip from '../components/EVerifyComfortChip';
import MessageDrawer, { type MessageRecipient } from '../components/MessageDrawer';
import FavoriteButton from '../components/FavoriteButton';
import InterviewCell from '../components/InterviewCell';
import { useFavorites } from '../hooks/useFavorites';
import {
  getMergedMetroOptions,
  getMergedSubareaOptionsForMetro,
  getMergedCityOptionsForSubarea,
  formatGeoLabel,
} from '../data/metroSubareaSchema';
import { getMetroDisplayLabel } from '../data/metroMaster';
import { Autocomplete as GooglePlacesAutocomplete } from '@react-google-maps/api';
import { geocodeAddress } from '../utils/geocodeAddress';

type MemberStatus = 'preferred' | 'member' | 'not_preferred';

export interface SavedSmartGroupDetailPageProps {
  hideHeader?: boolean;
}

const SavedSmartGroupDetailPage: React.FC<SavedSmartGroupDetailPageProps> = ({ hideHeader = false }) => {
  const navigate = useNavigate();
  const { groupId } = useParams<{ groupId: string }>();
  const { tenantId, user } = useAuth();
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
    scoreSummary?: { aiScore?: number; interviewLastAt?: any; interviewLastScore10?: number };
    securityLevel?: string;
    skills?: string[];
    comfortableEVerify?: string;
    workerAttestations?: { eVerifyWillingness?: string };
  }>>([]);
  const [statusMenuAnchor, setStatusMenuAnchor] = useState<{ [userId: string]: HTMLElement | null }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
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
  
  // Favorites
  const { favorites, isFavorite, toggleFavorite } = useFavorites('users');
  
  // Edit mode filter state
  const [editFilterMode, setEditFilterMode] = useState<'residence' | 'application'>('residence');
  const [editResidenceSubMode, setEditResidenceSubMode] = useState<'area' | 'radius'>('area');
  const [editMetroFilter, setEditMetroFilter] = useState<string | null>(null);
  const [editAreaFilter, setEditAreaFilter] = useState<string | null>(null);
  const [editCityFilter, setEditCityFilter] = useState<string | null>(null);
  const [editCategoryFilter, setEditCategoryFilter] = useState<string | null>(null);
  const [editRadiusAddress, setEditRadiusAddress] = useState('');
  const [editRadiusLat, setEditRadiusLat] = useState<number | null>(null);
  const [editRadiusLng, setEditRadiusLng] = useState<number | null>(null);
  const [editRadiusMiles, setEditRadiusMiles] = useState(10);
  const [editSelectedSkills, setEditSelectedSkills] = useState<string[]>([]);
  const [editSelectedCertifications, setEditSelectedCertifications] = useState<string[]>([]);
  const radiusAutocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  
  const { customMetros } = useSmartGroupSettings(tenantId);
  const metroOptions = getMergedMetroOptions(customMetros);
  const areaOptions = editMetroFilter && editMetroFilter !== '__other__' 
    ? getMergedSubareaOptionsForMetro(editMetroFilter, customMetros)
    : [];
  const cityOptions = editAreaFilter && editMetroFilter && editMetroFilter !== '__other__'
    ? getMergedCityOptionsForSubarea(editMetroFilter, editAreaFilter, customMetros)
    : [];
  
  const OTHER_METRO_VALUE = '__other__';
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
        // Initialize edit state from filters
        setEditFilterMode(filters.filterMode || 'residence');
        setEditResidenceSubMode(filters.residenceSubMode || 'area');
        setEditMetroFilter(filters.metroFilter ?? null);
        setEditAreaFilter(filters.areaFilter ?? null);
        setEditCityFilter(filters.cityFilter ?? null);
        setEditCategoryFilter(filters.categoryFilter ?? null);
        setEditRadiusAddress(filters.radiusAddress || '');
        setEditRadiusLat(filters.radiusLat ?? null);
        setEditRadiusLng(filters.radiusLng ?? null);
        setEditRadiusMiles(filters.radiusMiles ?? 10);
        setEditSelectedSkills(filters.selectedSkills || []);
        setEditSelectedCertifications(filters.selectedCertifications || []);
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
          scoreSummary?: any;
          securityLevel?: string;
          skills?: string[];
          comfortableEVerify?: string;
          workerAttestations?: { eVerifyWillingness?: string };
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
              scoreSummary: d?.scoreSummary,
              securityLevel: String(tenantData?.securityLevel ?? d?.securityLevel ?? '0'),
              skills: Array.isArray(d?.skills) ? d.skills : [],
              comfortableEVerify: d?.comfortableEVerify,
              workerAttestations: d?.workerAttestations,
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

  // Load skills and certifications options from members
  const skillsOptions = useMemo(() => {
    const skillsSet = new Set<string>();
    membersData.forEach(m => {
      if (Array.isArray(m.skills)) {
        m.skills.forEach(s => {
          const label = toChipLabel(s);
          if (label) skillsSet.add(label);
        });
      }
    });
    return Array.from(skillsSet).sort();
  }, [membersData]);

  const certOptions = useMemo(() => {
    // We'll need to load certifications from user data
    // For now, use empty array - can be enhanced later
    return [];
  }, []);

  const handleSaveFilters = async () => {
    if (!tenantId || !groupId || !group) return;
    setSaving(true);
    setSaveError(null);
    try {
      const filters: SavedSmartGroupFilters = {
        filterMode: editFilterMode,
        metroFilter: editMetroFilter ?? null,
        areaFilter: editAreaFilter ?? null,
        cityFilter: editCityFilter ?? null,
        categoryFilter: editCategoryFilter ?? null,
        selectedSkills: editSelectedSkills,
        selectedCertifications: editSelectedCertifications,
      };
      if (editFilterMode === 'residence') {
        filters.residenceSubMode = editResidenceSubMode;
        if (editResidenceSubMode === 'radius') {
          filters.radiusAddress = editRadiusAddress;
          filters.radiusMiles = editRadiusMiles;
          // Save geocoded coordinates if available
          if (editRadiusLat != null && editRadiusLng != null) {
            filters.radiusLat = editRadiusLat;
            filters.radiusLng = editRadiusLng;
          }
        }
      }
      
      // Re-run search with new filters
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
        filters,
        memberIds: newMemberIds,
        memberStatusById,
        updatedAt: serverTimestamp(),
      });
      
      setGroup({ ...group, filters, memberIds: newMemberIds, memberStatusById });
      
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
        scoreSummary?: any;
        securityLevel?: string;
        skills?: string[];
        comfortableEVerify?: string;
        workerAttestations?: { eVerifyWillingness?: string };
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
            scoreSummary: d?.scoreSummary,
            securityLevel: String(tenantData?.securityLevel ?? d?.securityLevel ?? '0'),
            skills: Array.isArray(d?.skills) ? d.skills : [],
            comfortableEVerify: d?.comfortableEVerify,
            workerAttestations: d?.workerAttestations,
          });
        } else {
          users.push({ id: uid });
        }
      }
      setMembersData(users);
      setIsEditing(false);
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

  const handleCancelEdit = () => {
    if (!group) return;
    // Reset edit state to original filters
    setEditFilterMode(group.filters.filterMode || 'residence');
    setEditResidenceSubMode(group.filters.residenceSubMode || 'area');
    setEditMetroFilter(group.filters.metroFilter ?? null);
    setEditAreaFilter(group.filters.areaFilter ?? null);
    setEditCityFilter(group.filters.cityFilter ?? null);
    setEditCategoryFilter(group.filters.categoryFilter ?? null);
    setEditRadiusAddress(group.filters.radiusAddress || '');
    setEditRadiusLat(group.filters.radiusLat ?? null);
    setEditRadiusLng(group.filters.radiusLng ?? null);
    setEditRadiusMiles(group.filters.radiusMiles ?? 10);
    setEditSelectedSkills(group.filters.selectedSkills || []);
    setEditSelectedCertifications(group.filters.selectedCertifications || []);
    setIsEditing(false);
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
      const users: Array<{
        id: string;
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string;
        avatar?: string;
        city?: string;
        state?: string;
        scoreSummary?: any;
        securityLevel?: string;
        skills?: string[];
        comfortableEVerify?: string;
        workerAttestations?: { eVerifyWillingness?: string };
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
            scoreSummary: d?.scoreSummary,
            securityLevel: String(tenantData?.securityLevel ?? d?.securityLevel ?? '0'),
            skills: Array.isArray(d?.skills) ? d.skills : [],
            comfortableEVerify: d?.comfortableEVerify,
            workerAttestations: d?.workerAttestations,
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

  // Selection handlers (must be before early return)
  const selectedCount = selectAllResults ? membersData.length : selectedIds.size;
  const allOnPageSelected = membersData.length > 0 && (selectAllResults || membersData.every((m) => selectedIds.has(m.id)));
  const someOnPageSelected = !selectAllResults && membersData.some((m) => selectedIds.has(m.id));

  const handleSelectAllOnPage = () => {
    if (allOnPageSelected) {
      const next = new Set(selectedIds);
      membersData.forEach((m) => next.delete(m.id));
      setSelectedIds(next);
      setSelectAllResults(false);
    } else {
      const next = new Set(selectedIds);
      membersData.forEach((m) => next.add(m.id));
      setSelectedIds(next);
    }
  };

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

  const getStatus = (id: string): MemberStatus =>
    group.memberStatusById[id] === 'preferred' || group.memberStatusById[id] === 'not_preferred'
      ? group.memberStatusById[id]
      : 'member';

  const getGroupStatusChipProps = (status: MemberStatus) => {
    if (status === 'preferred') return { label: 'Preferred' as const, sx: { bgcolor: '#0057B8', color: '#FFFFFF', fontWeight: 700 } };
    if (status === 'not_preferred') return { label: 'Not Preferred' as const, sx: { bgcolor: '#D14343', color: '#FFFFFF', fontWeight: 700 } };
    return { label: 'Member' as const, sx: { fontWeight: 700 } };
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return 'N/A';
    try {
      const date = timestamp?.toDate ? timestamp.toDate() : timestamp instanceof Date ? timestamp : new Date(timestamp);
      return isNaN(date.getTime()) ? 'N/A' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return 'N/A';
    }
  };

  const getWorkStatusDisplay = (m: (typeof membersData)[0]) => {
    const sl = String(m.securityLevel ?? '0');
    switch (sl) {
      case '4': return { label: 'Hired', color: 'success' as const };
      case '3': return { label: 'Candidate', color: 'primary' as const };
      case '2': return { label: 'Applicant', color: 'info' as const };
      case '1': return { label: 'Dismissed', color: 'default' as const };
      case '0': return { label: 'Suspended', color: 'error' as const };
      default: return { label: sl || '—', color: 'default' as const };
    }
  };

  const renderAiScore = (m: (typeof membersData)[0]) => {
    const score = m.scoreSummary?.aiScore;
    if (score === undefined || score === null || Number.isNaN(score)) {
      return <Typography variant="body2" color="text.secondary">N/A</Typography>;
    }
    const color: 'default' | 'success' | 'warning' | 'error' = score >= 80 ? 'success' : score >= 60 ? 'warning' : 'default';
    return (
      <Chip
        icon={<InsightsIcon sx={{ fontSize: 16 }} />}
        label={`${Math.round(score)}`}
        color={color}
        size="small"
        variant={color === 'default' ? 'outlined' : 'filled'}
        sx={{ minWidth: 96, justifyContent: 'flex-start' }}
      />
    );
  };

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

  const clearEditMetro = () => {
    setEditMetroFilter(null);
    setEditAreaFilter(null);
    setEditCityFilter(null);
  };
  const clearEditArea = () => {
    setEditAreaFilter(null);
    setEditCityFilter(null);
  };
  const clearEditCity = () => setEditCityFilter(null);

  return (
    <Box sx={{ pt: 2, px: 2, pb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/users/my-smart-groups')}
          sx={{ textTransform: 'none' }}
        >
          Back
        </Button>
        <Box sx={{ flex: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="h6">{group.name}</Typography>
            {!isEditing && (
              <>
                <IconButton
                  size="small"
                  onClick={() => setIsEditing(true)}
                  sx={{ ml: 0.5 }}
                  title="Edit filters"
                >
                  <EditIcon fontSize="small" />
                </IconButton>
                {copiedFromGroupId ? (
                  <Button
                    size="small"
                    variant="outlined"
                    color="secondary"
                    onClick={() => setUnsaveDialogOpen(true)}
                    sx={{ textTransform: 'none', ml: 0.5 }}
                  >
                    Unsave
                  </Button>
                ) : (
                  <IconButton
                    size="small"
                    onClick={() => setDeleteDialogOpen(true)}
                    color="error"
                    title="Delete group"
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                )}
              </>
            )}
          </Box>
          {!isEditing && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {formatFiltersSummary(group.filters)}
            </Typography>
          )}
          {!isEditing && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
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
          )}
        </Box>
        {isEditing ? (
          <Box sx={{ display: 'flex', gap: 1, ml: 'auto' }}>
            <Button
              variant="outlined"
              startIcon={<CancelIcon />}
              onClick={handleCancelEdit}
              disabled={saving}
              sx={{ textTransform: 'none' }}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              startIcon={<SaveIcon />}
              onClick={handleSaveFilters}
              disabled={saving}
              sx={{ textTransform: 'none' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </Box>
        ) : (
          <Button
            variant="contained"
            startIcon={<RefreshIcon />}
            onClick={handleUpdateResults}
            disabled={updating}
            sx={{ textTransform: 'none', ml: 'auto' }}
          >
            {updating ? 'Updating…' : 'Update results'}
          </Button>
        )}
      </Box>
      
      {saveError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setSaveError(null)}>
          {saveError}
        </Alert>
      )}
      
      {isEditing && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
            Edit Filters
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <ToggleButtonGroup
              value={editFilterMode}
              exclusive
              onChange={(_, v) => v && setEditFilterMode(v)}
              size="small"
            >
              <ToggleButton value="application">
                <WorkIcon sx={{ mr: 0.5 }} /> By application location
              </ToggleButton>
              <ToggleButton value="residence">
                <LocationOnIcon sx={{ mr: 0.5 }} /> By where users live
              </ToggleButton>
            </ToggleButtonGroup>
            
            {editFilterMode === 'residence' && (
              <ToggleButtonGroup
                value={editResidenceSubMode}
                exclusive
                onChange={(_, v) => v && setEditResidenceSubMode(v)}
                size="small"
              >
                <ToggleButton value="area">In an area</ToggleButton>
                <ToggleButton value="radius">Within radius of address</ToggleButton>
              </ToggleButtonGroup>
            )}
            
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
              {editFilterMode === 'application' && (
                <>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <FormControl size="small" sx={{ minWidth: 180 }}>
                      <InputLabel>Metro</InputLabel>
                      <Select
                        value={editMetroFilter ?? ''}
                        label="Metro"
                        onChange={(e) => {
                          const v = e.target.value as string;
                          setEditMetroFilter(v || null);
                          setEditAreaFilter(null);
                          setEditCityFilter(null);
                        }}
                      >
                        <MenuItem value="">All metros</MenuItem>
                        {metroOptions.map((m) => (
                          <MenuItem key={m} value={m}>
                            {getMetroDisplayLabel(m)}
                          </MenuItem>
                        ))}
                        <MenuItem value={OTHER_METRO_VALUE}>Other (non-metro)</MenuItem>
                      </Select>
                    </FormControl>
                    {editMetroFilter && (
                      <IconButton size="small" onClick={clearEditMetro} sx={{ p: 0.5 }}>
                        <ClearIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Box>
                  
                  {editMetroFilter && editMetroFilter !== OTHER_METRO_VALUE && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <FormControl size="small" sx={{ minWidth: 160 }}>
                        <InputLabel>Area</InputLabel>
                        <Select
                          value={editAreaFilter ?? ''}
                          label="Area"
                          displayEmpty
                          renderValue={(v) => (v === '' ? 'All Areas' : formatGeoLabel(v))}
                          onChange={(e) => {
                            const v = e.target.value as string;
                            setEditAreaFilter(v || null);
                            setEditCityFilter(null);
                          }}
                        >
                          <MenuItem value="">All Areas</MenuItem>
                          {areaOptions.map((a) => (
                            <MenuItem key={a} value={a}>
                              {formatGeoLabel(a)}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      {editAreaFilter && (
                        <IconButton size="small" onClick={clearEditArea} sx={{ p: 0.5 }}>
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Box>
                  )}
                  
                  {editAreaFilter && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <FormControl size="small" sx={{ minWidth: 160 }}>
                        <InputLabel>City</InputLabel>
                        <Select
                          value={editCityFilter ?? ''}
                          label="City"
                          displayEmpty
                          renderValue={(v) => (v === '' ? 'All Cities' : formatGeoLabel(v))}
                          onChange={(e) => setEditCityFilter((e.target.value as string) || null)}
                        >
                          <MenuItem value="">All Cities</MenuItem>
                          {cityOptions.map((c) => (
                            <MenuItem key={c} value={c}>
                              {formatGeoLabel(c)}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      {editCityFilter && (
                        <IconButton size="small" onClick={clearEditCity} sx={{ p: 0.5 }}>
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Box>
                  )}
                  
                  <FormControl size="small" sx={{ minWidth: 160 }}>
                    <InputLabel>Category</InputLabel>
                    <Select
                      value={editCategoryFilter ?? ''}
                      label="Category"
                      displayEmpty
                      renderValue={(v) => (v === '' ? 'All Categories' : formatKeyToDisplayName(v))}
                      onChange={(e) => setEditCategoryFilter((e.target.value as string) || null)}
                    >
                      <MenuItem value="">All Categories</MenuItem>
                      <MenuItem value="industrial">Industrial</MenuItem>
                      <MenuItem value="hospitality">Hospitality</MenuItem>
                      <MenuItem value="janitorial">Janitorial</MenuItem>
                      <MenuItem value="other">Other</MenuItem>
                    </Select>
                  </FormControl>
                </>
              )}
              
              {editFilterMode === 'residence' && editResidenceSubMode === 'area' && (
                <>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <FormControl size="small" sx={{ minWidth: 180 }}>
                      <InputLabel>Metro</InputLabel>
                      <Select
                        value={editMetroFilter ?? ''}
                        label="Metro"
                        onChange={(e) => {
                          const v = e.target.value as string;
                          setEditMetroFilter(v || null);
                          setEditAreaFilter(null);
                          setEditCityFilter(null);
                        }}
                      >
                        <MenuItem value="">All metros</MenuItem>
                        {metroOptions.map((m) => (
                          <MenuItem key={m} value={m}>
                            {getMetroDisplayLabel(m)}
                          </MenuItem>
                        ))}
                        <MenuItem value={OTHER_METRO_VALUE}>Other (non-metro)</MenuItem>
                      </Select>
                    </FormControl>
                    {editMetroFilter && (
                      <IconButton size="small" onClick={clearEditMetro} sx={{ p: 0.5 }}>
                        <ClearIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Box>
                  
                  {editMetroFilter && editMetroFilter !== OTHER_METRO_VALUE && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <FormControl size="small" sx={{ minWidth: 160 }}>
                        <InputLabel>Area</InputLabel>
                        <Select
                          value={editAreaFilter ?? ''}
                          label="Area"
                          displayEmpty
                          renderValue={(v) => (v === '' ? 'All Areas' : formatGeoLabel(v))}
                          onChange={(e) => {
                            const v = e.target.value as string;
                            setEditAreaFilter(v || null);
                            setEditCityFilter(null);
                          }}
                        >
                          <MenuItem value="">All Areas</MenuItem>
                          {areaOptions.map((a) => (
                            <MenuItem key={a} value={a}>
                              {formatGeoLabel(a)}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      {editAreaFilter && (
                        <IconButton size="small" onClick={clearEditArea} sx={{ p: 0.5 }}>
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Box>
                  )}
                  
                  {editAreaFilter && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <FormControl size="small" sx={{ minWidth: 160 }}>
                        <InputLabel>City</InputLabel>
                        <Select
                          value={editCityFilter ?? ''}
                          label="City"
                          displayEmpty
                          renderValue={(v) => (v === '' ? 'All Cities' : formatGeoLabel(v))}
                          onChange={(e) => setEditCityFilter((e.target.value as string) || null)}
                        >
                          <MenuItem value="">All Cities</MenuItem>
                          {cityOptions.map((c) => (
                            <MenuItem key={c} value={c}>
                              {formatGeoLabel(c)}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      {editCityFilter && (
                        <IconButton size="small" onClick={clearEditCity} sx={{ p: 0.5 }}>
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Box>
                  )}
                </>
              )}
              
              {editFilterMode === 'residence' && editResidenceSubMode === 'radius' && (
                <>
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
                      size="small"
                      label="Address"
                      placeholder="Search city, state or full address"
                      value={editRadiusAddress}
                      onChange={(e) => setEditRadiusAddress(e.target.value)}
                      sx={{ minWidth: 280 }}
                    />
                  </GooglePlacesAutocomplete>
                  <FormControl size="small" sx={{ minWidth: 100 }}>
                    <InputLabel>Radius</InputLabel>
                    <Select
                      value={editRadiusMiles}
                      label="Radius"
                      onChange={(e) => setEditRadiusMiles(Number(e.target.value))}
                    >
                      {RADIUS_OPTIONS.map((m) => (
                        <MenuItem key={m} value={m}>
                          {m} mi
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </>
              )}
              
              <Autocomplete
                multiple
                size="small"
                options={skillsOptions}
                value={editSelectedSkills}
                onChange={(_, v) => setEditSelectedSkills(v)}
                renderInput={(params) => (
                  <TextField {...params} label="Skills" placeholder={editSelectedSkills.length ? '' : 'Any'} />
                )}
                sx={{ minWidth: 180 }}
              />
              <Autocomplete
                multiple
                size="small"
                options={certOptions}
                value={editSelectedCertifications}
                onChange={(_, v) => setEditSelectedCertifications(v)}
                renderInput={(params) => (
                  <TextField {...params} label="Certifications" placeholder={editSelectedCertifications.length ? '' : 'Any'} />
                )}
                sx={{ minWidth: 180 }}
              />
            </Box>
          </Box>
        </Paper>
      )}
      {updateError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setUpdateError(null)}>
          {updateError}
        </Alert>
      )}
      <Paper
        variant="outlined"
        elevation={0}
        sx={{
          border: '1px solid #EAEEF4',
          borderRadius: 2,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {selectedCount > 0 && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              flexWrap: 'wrap',
              px: 2,
              py: 1.5,
              backgroundColor: 'action.selected',
              borderBottom: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {selectAllResults
                ? `All ${membersData.length} result${membersData.length === 1 ? '' : 's'} selected`
                : `${selectedCount} selected`}
            </Typography>
            <Button size="small" onClick={handleClearSelection} sx={{ textTransform: 'none' }}>
              Clear selection
            </Button>
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
        <TableContainer sx={{ overflowX: 'auto', '&::-webkit-scrollbar': { width: 8, height: 8 } }}>
          <Table size="small" stickyHeader sx={{ width: '100%' }}>
            <TableHead sx={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: 'background.paper' }}>
              <TableRow sx={{ backgroundColor: 'background.paper' }}>
                <TableCell padding="checkbox" sx={{ width: 48, bgcolor: '#FFFFFF' }}>
                  <Checkbox
                    size="small"
                    checked={allOnPageSelected}
                    indeterminate={someOnPageSelected}
                    onChange={handleSelectAllOnPage}
                    aria-label="Select all on page"
                  />
                </TableCell>
                <TableCell sx={{ width: 48, bgcolor: '#FFFFFF' }} />
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>Person</TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>Contact</TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>Auth</TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>Documented</TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>Work Status</TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>Score</TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>Interview</TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>Group Status</TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>Skills</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {membersData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                    No members. Click &quot;Update results&quot; to re-run the saved search.
                  </TableCell>
                </TableRow>
              ) : (
                membersData.map((m, idx) => {
                  const status = getStatus(m.id);
                  const chipProps = getGroupStatusChipProps(status);
                  const ws = getWorkStatusDisplay(m);
                  const skills = m.skills ?? [];
                  return (
                    <TableRow
                      key={m.id}
                      hover
                      sx={{
                        cursor: 'pointer',
                        backgroundColor: idx % 2 === 0 ? 'background.paper' : 'action.hover',
                        '&:hover': { backgroundColor: 'action.selected' },
                      }}
                      onClick={() => navigate(`/users/${m.id}`)}
                    >
                      <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()} sx={{ width: 48 }}>
                        <Checkbox
                          size="small"
                          checked={selectAllResults || selectedIds.has(m.id)}
                          onChange={(_, checked) => handleSelectRow(m.id, checked)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select ${[m.firstName, m.lastName].filter(Boolean).join(' ').trim() || m.id}`}
                        />
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <FavoriteButton
                          itemId={m.id}
                          favoriteType="users"
                          isFavorite={isFavorite}
                          toggleFavorite={toggleFavorite}
                          size="small"
                          tooltipText={{
                            favorited: 'Remove from favorites',
                            notFavorited: 'Add to favorites',
                          }}
                        />
                      </TableCell>
                      <TableCell sx={{ minWidth: 200 }} onClick={() => navigate(`/users/${m.id}`)}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <Avatar src={m.avatar} sx={{ width: TABLE_AVATAR_SIZE, height: TABLE_AVATAR_SIZE }}>
                            {String(m.firstName || '').charAt(0)}
                          </Avatar>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                              {[m.firstName, m.lastName].filter(Boolean).join(' ').trim() || m.id}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>#{String(m.id).slice(-6)}</Typography>
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                          {m.email && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <EmailIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                              <Typography variant="body2" sx={{ fontSize: '0.85rem' }}>{m.email}</Typography>
                            </Box>
                          )}
                          {m.phone && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <PhoneIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                              <Typography variant="body2" sx={{ fontSize: '0.85rem' }}>{formatPhoneNumber(m.phone)}</Typography>
                            </Box>
                          )}
                          {(m.city || m.state) && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <LocationOnIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.85rem' }}>{[m.city, m.state].filter(Boolean).join(', ')}</Typography>
                            </Box>
                          )}
                          {!m.email && !m.phone && !m.city && !m.state && '—'}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <WorkAuthorizedChip status={getWorkAuthorizedStatus(m)} />
                      </TableCell>
                      <TableCell>
                        <EVerifyComfortChip status={getEVerifyComfortStatusFromUserData(m)} />
                      </TableCell>
                      <TableCell><Chip size="small" label={ws.label} color={ws.color} /></TableCell>
                      <TableCell>{renderAiScore(m)}</TableCell>
                      <TableCell>
                        <InterviewCell
                          userId={m.id}
                          scoreSummary={m.scoreSummary}
                          formatDate={formatDate}
                        />
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Chip
                          size="small"
                          label={chipProps.label}
                          variant={status === 'member' ? 'outlined' : 'filled'}
                          onClick={(e) => { e.stopPropagation(); setStatusMenuAnchor((prev) => ({ ...prev, [m.id]: e.currentTarget })); }}
                          sx={{ cursor: 'pointer', ...(chipProps.sx || {}) }}
                        />
                        <Menu
                          anchorEl={statusMenuAnchor[m.id]}
                          open={Boolean(statusMenuAnchor[m.id])}
                          onClose={() => setStatusMenuAnchor((prev) => ({ ...prev, [m.id]: null }))}
                          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                        >
                          <MenuItem onClick={() => { handleStatusChange(m.id, 'member'); setStatusMenuAnchor((prev) => ({ ...prev, [m.id]: null })); }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <CheckCircleIcon fontSize="small" />
                              Member
                            </Box>
                          </MenuItem>
                          <MenuItem onClick={() => { handleStatusChange(m.id, 'preferred'); setStatusMenuAnchor((prev) => ({ ...prev, [m.id]: null })); }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <CheckCircleIcon fontSize="small" />
                              Preferred
                            </Box>
                          </MenuItem>
                          <MenuItem onClick={() => { handleStatusChange(m.id, 'not_preferred'); setStatusMenuAnchor((prev) => ({ ...prev, [m.id]: null })); }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <BlockIcon fontSize="small" />
                              Not Preferred
                            </Box>
                          </MenuItem>
                        </Menu>
                      </TableCell>
                      <TableCell>
                        {skills.length === 0 ? (
                          <Typography variant="body2" color="text.secondary">—</Typography>
                        ) : (
                          <Tooltip title={skills.length <= 1 ? toChipLabel(skills[0]) : <Box component="span" sx={{ display: 'block', maxHeight: 320, overflowY: 'auto', py: 0.5 }}>{skills.map((s, i) => <Typography key={`${toChipLabel(s)}-${i}`} component="span" variant="body2" sx={{ display: 'block' }}>{toChipLabel(s)}</Typography>)}</Box>} placement="top" enterDelay={300}>
                            <Typography variant="body2" noWrap component="span" sx={{ display: 'block' }}>{toChipLabel(skills[0])}{skills.length > 1 ? '…' : ''}</Typography>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
      
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
