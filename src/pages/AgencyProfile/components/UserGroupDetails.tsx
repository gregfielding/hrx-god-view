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
  Menu,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
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
  TableSortLabel,
  CircularProgress,
} from '@mui/material';
import { doc, getDoc, updateDoc, collection, getDocs, deleteDoc, where, documentId, query, deleteField } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useNavigate, useLocation } from 'react-router-dom';
import GroupsIcon from '@mui/icons-material/Groups';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EmailIcon from '@mui/icons-material/Email';
import PhoneIcon from '@mui/icons-material/Phone';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import SmsIcon from '@mui/icons-material/Sms';
import MessageDrawer, { type MessageRecipient } from '../../../components/MessageDrawer';
import InterviewCell from '../../../components/InterviewCell';
import StarIcon from '@mui/icons-material/Star';
import InsightsIcon from '@mui/icons-material/Insights';
import IconButton from '@mui/material/IconButton';
import PersonIcon from '@mui/icons-material/Person';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import BlockIcon from '@mui/icons-material/Block';

import { db, storage } from '../../../firebase';
import ImageCropDialog from '../../../components/common/ImageCropDialog';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import PageHeader from '../../../components/PageHeader';
import StandardTablePagination from '../../../components/StandardTablePagination';
import { formatPhoneNumber } from '../../../utils/formatPhone';
import { toChipLabel } from '../../../utils/chipLabel';
import FavoriteButton from '../../../components/FavoriteButton';
import { useFavorites } from '../../../hooks/useFavorites';
import { TABLE_AVATAR_SIZE } from '../../../utils/uiConstants';
import { formatOneDecimal } from '../../../utils/scoreSummary';
import { normalizeScoreSummary } from '../../../utils/scoreSummary';
import { calculateProfileScore } from '../../../utils/applicantScoring';
import { getWorkAuthorizedStatus, compareWorkAuthorized } from '../../../utils/workAuthorizedDisplay';
import WorkAuthorizedChip from '../../../components/WorkAuthorizedChip';

import AgencyProfileHeader from './AgencyProfileHeader';

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
  const [activeTab, setActiveTab] = useState<'members' | 'details'>('members');
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [membersPage, setMembersPage] = useState(0);
  const [membersRowsPerPage, setMembersRowsPerPage] = useState(20);
  const [membersSortBy, setMembersSortBy] = useState<'name' | 'workStatus' | 'score' | 'interview' | 'groupStatus' | 'skills' | 'lastLogin' | 'auth'>('name');
  const [membersSortDirection, setMembersSortDirection] = useState<'asc' | 'desc'>('asc');
  const [groupStatusMenuAnchor, setGroupStatusMenuAnchor] = useState<{ [key: string]: HTMLElement | null }>({});
  const { isFavorite: isUserFavorite, toggleFavorite: toggleUserFavorite } = useFavorites('users');
  const { isFavorite: isGroupFavorite, toggleFavorite: toggleGroupFavorite } = useFavorites('userGroups');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [shareSnackbarOpen, setShareSnackbarOpen] = useState(false);
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
        setGroupManagerIds(data.groupManagerIds || []);
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

        return {
          ...u,
          securityLevel,
          avatar: u.avatar || tenantData.avatar,
          phone: u.phone || '',
          scoreSummary: normalizeScoreSummary(u.scoreSummary),
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
      const q = collection(db, 'users');
      const snapshot = await getDocs(q);
      setAgencyUsers(
        snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((user: any) => user.tenantId === tenantId && user.role === 'Agency'),
      );
    } catch {}
  };

  const handleEditChange = (field: string, value: string) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleManagersChange = async (newValue: any[]) => {
    setGroupManagerIds(newValue.map((u: any) => u.id));
    try {
      const groupRef = doc(db, 'tenants', tenantId, 'userGroups', groupId);
      await updateDoc(groupRef, { groupManagerIds: newValue.map((u: any) => u.id) });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to update group managers');
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
    const score = u?.scoreSummary?.aiScore ?? u?.aiJobFitScore ?? u?.aiProfileScore;
    return typeof score === 'number' && !Number.isNaN(score) ? score : -1;
  };

  const getNameKey = (u: any): string => {
    const first = String(u?.firstName || '').trim().toLowerCase();
    const last = String(u?.lastName || '').trim().toLowerCase();
    return `${last}|${first}|${String(u?.id || '')}`;
  };

  type MemberPreferenceStatus = 'preferred' | 'member' | 'not_preferred';
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

  const sortedMembers = [...members].sort((a: any, b: any) => {
    let cmp = 0;
    switch (membersSortBy) {
      case 'name': {
        cmp = getNameKey(a).localeCompare(getNameKey(b));
        break;
      }
      case 'workStatus': {
        const aWs = getWorkStatusDisplay(a).label.toLowerCase();
        const bWs = getWorkStatusDisplay(b).label.toLowerCase();
        cmp = aWs.localeCompare(bWs);
        break;
      }
      case 'score': {
        cmp = getScoreNumber(a) - getScoreNumber(b);
        break;
      }
      case 'interview': {
        const aM = toMillis(a?.scoreSummary?.interviewLastAt);
        const bM = toMillis(b?.scoreSummary?.interviewLastAt);
        cmp = aM - bM;
        break;
      }
      case 'groupStatus': {
        cmp = getGroupStatusKey(a) - getGroupStatusKey(b);
        break;
      }
      case 'skills': {
        const aCount = getDisplaySkills(a).length;
        const bCount = getDisplaySkills(b).length;
        cmp = aCount - bCount;
        break;
      }
      case 'lastLogin': {
        cmp = toMillis(a?.lastLoginAt) - toMillis(b?.lastLoginAt);
        break;
      }
      case 'auth': {
        const aStatus = getWorkAuthorizedStatus(a);
        const bStatus = getWorkAuthorizedStatus(b);
        cmp = compareWorkAuthorized(aStatus, bStatus);
        break;
      }
      default:
        cmp = 0;
    }
    return membersSortDirection === 'asc' ? cmp : -cmp;
  });

  const paginatedMembers = sortedMembers.slice(
    membersPage * membersRowsPerPage,
    membersPage * membersRowsPerPage + membersRowsPerPage,
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
    // Match inbox/users behavior: name asc, everything else desc by default
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

  const getWorkStatusDisplay = (u: any): { label: string; color: 'default' | 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info'; sx?: any } => {
    const employeeInProgress = String(u.employeeOnboardStatus || '').toLowerCase() === 'in progress';
    const contractorInProgress = String(u.contractorOnboardStatus || '').toLowerCase() === 'in progress';
    if (employeeInProgress || contractorInProgress) {
      const typeLabel =
        String(u.onboardingType || '').toLowerCase() === 'contractor' || contractorInProgress
          ? 'Contractor'
          : 'Employee';
      return {
        label: `Onboarding (${typeLabel})`,
        color: 'warning',
        sx: { bgcolor: '#E4572E', color: '#FFFFFF' },
      };
    }

    const sec = String(u.securityLevel ?? '0');

    switch (sec) {
      case '4':
        return { label: 'Hired', color: 'success' };
      case '3':
        return { label: 'Candidate', color: 'primary' };
      case '2':
        return { label: 'Applicant', color: 'info' };
      case '1':
        return { label: 'Dismissed', color: 'default' };
      case '0':
        return { label: 'Suspended', color: 'error' };
      default:
        return { label: sec, color: 'default' };
    }
  };

  const renderAiScore = (u: any) => {
    const score =
      u?.scoreSummary?.aiScore ??
      u?.aiJobFitScore ??
      u?.aiProfileScore;
    if (score === undefined || score === null || Number.isNaN(score)) {
      return <Typography variant="body2" color="text.secondary">N/A</Typography>;
    }

    let color: 'default' | 'success' | 'warning' | 'error' = 'default';
    if (score >= 80) color = 'success';
    else if (score >= 60) color = 'warning';
    else color = 'default';

    return (
      <Tooltip
        arrow
        title={
          <Box sx={{ p: 0.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
              Score Summary
            </Typography>
            <Stack spacing={0.25}>
              <Typography variant="body2">
                AI: <strong>{Math.round(score)}</strong>
              </Typography>
              <Typography variant="body2">
                Interview: <strong>{formatOneDecimal(u?.scoreSummary?.interviewAvg)}</strong>/10
                {u?.scoreSummary?.interviewCount ? ` (${u.scoreSummary.interviewCount})` : ''}
              </Typography>
              <Typography variant="body2">
                Reviews: <strong>{formatOneDecimal(u?.scoreSummary?.reviewAvg)}</strong>/5
                {u?.scoreSummary?.reviewCount ? ` (${u.scoreSummary.reviewCount})` : ''}
              </Typography>
            </Stack>
          </Box>
        }
      >
        <Chip
          icon={<InsightsIcon sx={{ fontSize: 16 }} />}
          label={`${Math.round(score)}`}
          color={color}
          size="small"
          variant={color === 'default' ? 'outlined' : 'filled'}
          sx={{ minWidth: 96, justifyContent: 'flex-start' }}
        />
      </Tooltip>
    );
  };

  const getDisplaySkills = (u: any): string[] => {
    const raw = u?.skills;
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const item of raw) {
      if (typeof item === 'string') {
        const t = item.trim();
        if (t) out.push(t);
      } else if (item && typeof item === 'object') {
        const t = String((item as any).name || (item as any).canonicalId || '').trim();
        if (t) out.push(t);
      }
      if (out.length >= 8) break; // cap to avoid huge arrays
    }
    return out;
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
        title={
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
            <Box
              position="relative"
              onMouseEnter={() => setAvatarHover(true)}
              onMouseLeave={() => setAvatarHover(false)}
              sx={{ flexShrink: 0 }}
            >
              <Avatar
                src={group?.avatar ?? undefined}
                sx={{
                  width: 72,
                  height: 72,
                  bgcolor: group?.avatar ? 'transparent' : 'primary.main',
                  color: '#fff',
                  fontWeight: 700,
                }}
              >
                {!group?.avatar && <GroupsIcon />}
              </Avatar>
              <input
                type="file"
                accept="image/*"
                ref={avatarFileInputRef}
                style={{ display: 'none' }}
                onChange={handleGroupAvatarFileChange}
              />
              {avatarHover && (
                <Tooltip title="Replace photo">
                  <IconButton
                    size="small"
                    onClick={handleGroupAvatarClick}
                    disabled={avatarBusy}
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
                    {avatarBusy ? (
                      <CircularProgress size={16} color="inherit" />
                    ) : (
                      <CameraAltIcon sx={{ fontSize: 16 }} />
                    )}
                  </IconButton>
                </Tooltip>
              )}
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                variant="h6"
                sx={{
                  fontSize: { xs: '20px', md: '24px' },
                  fontWeight: 700,
                  lineHeight: 1.2,
                  maxWidth: '100%',
                }}
              >
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, maxWidth: '100%' }}>
                  <Box
                    sx={{
                      display: 'block',
                      maxWidth: 'calc(100% - 32px)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {editForm.title || group?.title || 'User Group'}
                  </Box>
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
                    sx={{ ml: 0.25, flexShrink: 0 }}
                  />
                </Box>
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  fontSize: '14px',
                  color: 'rgba(0, 0, 0, 0.55)',
                  mt: 0.75,
                }}
              >
                {editForm.description || group?.description || '—'}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
                <Chip label={`Members: ${memberIds.length}`} size="small" variant="outlined" />
                <Chip label={`Managers: ${groupManagerIds.length}`} size="small" variant="outlined" />
              </Stack>
            </Box>
          </Box>
        }
        titleRightActions={
          <Stack direction="row" spacing={1.25} alignItems="center" sx={{ justifyContent: { xs: 'flex-start', md: 'flex-end' } }}>
            <Button
              variant="outlined"
              startIcon={<ContentCopyIcon />}
              onClick={async () => {
                const link = `${window.location.origin}/c1/apply/group/${groupId}`;
                try {
                  await navigator.clipboard.writeText(link);
                  setShareSnackbarOpen(true);
                } catch (e) {
                  // Fallback best-effort
                  try {
                    await navigator.clipboard.writeText(link);
                    setShareSnackbarOpen(true);
                  } catch {
                    setError('Unable to copy link to clipboard.');
                  }
                }
              }}
              sx={{ borderRadius: '999px', textTransform: 'none' }}
            >
              Copy Application Link
            </Button>
            <Button
              variant="outlined"
              startIcon={<ArrowBackIcon />}
              onClick={() => (isFromTopLevel ? navigate('/users/user-groups') : navigate(`/tenants/${tenantId}?tab=6`))}
              sx={{ borderRadius: '999px', textTransform: 'none' }}
            >
              Back
            </Button>
          </Stack>
        }
        showDivider={false}
      />

      <Box sx={{ px: { xs: 2, md: 3 }, py: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {/* Inbox-style section header row: tab buttons (left) + primary action (right) */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          <Box sx={{ display: 'flex', gap: 0.75 }}>
            {([
              { id: 'members' as const, label: 'Members' },
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
                    fontSize: '14px',
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? 'white' : 'rgba(0, 0, 0, 0.7)',
                    bgcolor: isActive ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                    px: 2,
                    py: 0.75,
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

          {activeTab === 'members' && (
            <Button
              variant="contained"
              onClick={() => setAddMemberOpen(true)}
              disabled={loading || availableWorkers.length === 0}
              sx={{ borderRadius: '999px', textTransform: 'none' }}
            >
              Add Member
            </Button>
          )}
        </Box>

        {activeTab === 'members' && (
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
                    <TableCell padding="checkbox" sx={{ width: 48, bgcolor: '#FFFFFF', borderRadius: 0 }}>
                      <Checkbox
                        size="small"
                        checked={allOnPageSelected}
                        indeterminate={someOnPageSelected}
                        onChange={handleSelectAllOnPage}
                        aria-label="Select all on page"
                      />
                    </TableCell>
                    <TableCell sx={{ width: 60, bgcolor: '#FFFFFF', borderRadius: 0 }} />
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                      <TableSortLabel
                        active={membersSortBy === 'name'}
                        direction={membersSortBy === 'name' ? membersSortDirection : 'asc'}
                        onClick={() => handleMembersSort('name')}
                      >
                        Person
                      </TableSortLabel>
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                      Contact
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                      <TableSortLabel
                        active={membersSortBy === 'auth'}
                        direction={membersSortBy === 'auth' ? membersSortDirection : 'desc'}
                        onClick={() => handleMembersSort('auth')}
                      >
                        Auth
                      </TableSortLabel>
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                      <TableSortLabel
                        active={membersSortBy === 'workStatus'}
                        direction={membersSortBy === 'workStatus' ? membersSortDirection : 'desc'}
                        onClick={() => handleMembersSort('workStatus')}
                      >
                        Work Status
                      </TableSortLabel>
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                      <TableSortLabel
                        active={membersSortBy === 'score'}
                        direction={membersSortBy === 'score' ? membersSortDirection : 'desc'}
                        onClick={() => handleMembersSort('score')}
                      >
                        Score
                      </TableSortLabel>
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                      <TableSortLabel
                        active={membersSortBy === 'interview'}
                        direction={membersSortBy === 'interview' ? membersSortDirection : 'desc'}
                        onClick={() => handleMembersSort('interview')}
                      >
                        Interview
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
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                      <TableSortLabel
                        active={membersSortBy === 'skills'}
                        direction={membersSortBy === 'skills' ? membersSortDirection : 'desc'}
                        onClick={() => handleMembersSort('skills')}
                      >
                        Skills
                      </TableSortLabel>
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', minWidth: 200, borderRadius: 0 }}>
                      <TableSortLabel
                        active={membersSortBy === 'lastLogin'}
                        direction={membersSortBy === 'lastLogin' ? membersSortDirection : 'desc'}
                        onClick={() => handleMembersSort('lastLogin')}
                      >
                        Last Login
                      </TableSortLabel>
                    </TableCell>
                    <TableCell sx={{ width: 60, bgcolor: '#FFFFFF', borderRadius: 0 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {members.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={12} sx={{ color: 'text.secondary', fontStyle: 'italic', py: 2 }}>
                        No members in this group.
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedMembers.map((u, idx) => {
                      const skills = getDisplaySkills(u);
                      const ws = getWorkStatusDisplay(u);
                      const memberPrefStatus = getMemberPreferenceStatus(u);
                      const groupStatusChip = getGroupStatusChipProps(memberPrefStatus);
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
                          <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              size="small"
                              checked={selectAllResults || selectedIds.has(u.id)}
                              onChange={() => handleSelectRow(u.id)}
                              aria-label={`Select ${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || 'Select member'}
                            />
                          </TableCell>
                          <TableCell onClick={(event) => event.stopPropagation()}>
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
                            />
                          </TableCell>

                          <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                              <Avatar
                                src={u.avatar}
                                alt={`${u.firstName || ''} ${u.lastName || ''}`.trim()}
                                sx={{ width: TABLE_AVATAR_SIZE, height: TABLE_AVATAR_SIZE }}
                              >
                                {String(u.firstName || '').charAt(0)}
                              </Avatar>
                              <Box sx={{ minWidth: 0 }}>
                                <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                                  {String(u.firstName || '').trim()} {String(u.lastName || '').trim()}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                  {u.createdAt ? formatDate(u.createdAt) : '—'}
                                </Typography>
                              </Box>
                            </Box>
                          </TableCell>

                          <TableCell sx={{ py: 0.5 }}>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minHeight: 0 }}>
                                <EmailIcon sx={{ fontSize: 14, color: 'text.secondary', flexShrink: 0 }} />
                                <Typography variant="body2" sx={{ fontSize: '0.85rem', lineHeight: 1.35 }}>
                                  {u.email || '—'}
                                </Typography>
                              </Box>
                              {(u.phone || u.phoneE164) && (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minHeight: 0 }}>
                                  <PhoneIcon sx={{ fontSize: 14, color: 'text.secondary', flexShrink: 0 }} />
                                  <Typography variant="body2" sx={{ fontSize: '0.85rem', lineHeight: 1.35 }}>
                                    {formatPhoneNumber(String(u.phone || u.phoneE164))}
                                  </Typography>
                                </Box>
                              )}
                              {(u.city || u.state || (u.address && (u.address as any).city) || (u.address && (u.address as any).state)) && (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minHeight: 0 }}>
                                  <LocationOnIcon sx={{ fontSize: 14, color: 'text.secondary', flexShrink: 0 }} />
                                  <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.85rem', lineHeight: 1.35 }}>
                                    {[u.city ?? (u.address as any)?.city, u.state ?? (u.address as any)?.state].filter(Boolean).join(', ')}
                                  </Typography>
                                </Box>
                              )}
                            </Box>
                          </TableCell>

                          <TableCell>
                            <WorkAuthorizedChip status={getWorkAuthorizedStatus(u)} />
                          </TableCell>

                          <TableCell>
                            <Chip size="small" label={ws.label} color={ws.color} sx={ws.sx} />
                          </TableCell>

                          <TableCell>{renderAiScore(u)}</TableCell>

                          <TableCell>
                            <InterviewCell
                              userId={u.id}
                              scoreSummary={u.scoreSummary}
                              formatDate={formatDate}
                            />
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
                                  handleChangeGroupStatus(u.id, 'member');
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
                                  handleChangeGroupStatus(u.id, 'preferred');
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
                                  handleChangeGroupStatus(u.id, 'not_preferred');
                                }}
                              >
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
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
                              <Tooltip
                                title={
                                  skills.length <= 1
                                    ? toChipLabel(skills[0])
                                    : (
                                      <Box component="span" sx={{ display: 'block', maxHeight: 320, overflowY: 'auto', py: 0.5 }}>
                                        {skills.map((skill, i) => (
                                          <Typography key={`${toChipLabel(skill)}-${i}`} component="span" variant="body2" sx={{ display: 'block' }}>
                                            {toChipLabel(skill)}
                                          </Typography>
                                        ))}
                                      </Box>
                                    )
                                }
                                placement="top"
                                enterDelay={300}
                                disableInteractive={false}
                              >
                                <Typography variant="body2" noWrap component="span" sx={{ display: 'block' }}>
                                  {toChipLabel(skills[0])}
                                  {skills.length > 1 ? '…' : ''}
                                </Typography>
                              </Tooltip>
                            )}
                          </TableCell>

                          <TableCell sx={{ minWidth: 200 }}>
                            <Typography variant="body2">{formatDate(u.lastLoginAt)}</Typography>
                          </TableCell>

                          <TableCell onClick={(event) => event.stopPropagation()} sx={{ width: 60 }}>
                            <Tooltip title="Remove from group" arrow>
                              <span>
                                <IconButton
                                  size="small"
                                  onClick={() => handleRemoveMember(u.id)}
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
              count={members.length}
              page={membersPage}
              rowsPerPage={membersRowsPerPage}
              onPageChange={(_e, newPage) => setMembersPage(newPage)}
              onRowsPerPageChange={(e) => {
                setMembersRowsPerPage(parseInt(e.target.value, 10));
                setMembersPage(0);
              }}
            />
          </>
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
              <CardHeader title="Group managers" titleTypographyProps={{ fontWeight: 800 }} />
              <CardContent>
        <Autocomplete
          multiple
          options={agencyUsers}
          getOptionLabel={(u) => `${u.firstName} ${u.lastName}`}
          value={agencyUsers.filter((u) => groupManagerIds.includes(u.id))}
          onChange={(_, newValue) => handleManagersChange(newValue)}
          renderInput={(params) => (
                    <TextField {...params} label="Managers" placeholder="Select managers" fullWidth />
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
