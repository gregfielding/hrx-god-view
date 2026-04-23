import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  CircularProgress,
  Alert,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Button,
  TextField,
  TableSortLabel,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Avatar,
  Checkbox,
} from '@mui/material';
import ClearIcon from '@mui/icons-material/Clear';
import BuildIcon from '@mui/icons-material/Build';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import EmailIcon from '@mui/icons-material/Email';
import PhoneIcon from '@mui/icons-material/Phone';
import SmsIcon from '@mui/icons-material/Sms';
import InsightsIcon from '@mui/icons-material/Insights';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import MessageDrawer, { type MessageRecipient } from '../components/MessageDrawer';
import FavoriteButton from '../components/FavoriteButton';
import InterviewCell from '../components/InterviewCell';
import { useFavorites } from '../hooks/useFavorites';
import { db, functions } from '../firebase';
import { callSearchRecruiterTableUsers } from '../services/searchRecruiterTableUsersCallable';
import { collection, getDocs, addDoc, serverTimestamp, query, where, documentId } from 'firebase/firestore';
import PageHeader from '../components/PageHeader';
import StandardTablePagination from '../components/StandardTablePagination';
import { formatPhoneNumber } from '../utils/formatPhone';
import { toChipLabel } from '../utils/chipLabel';
import { TABLE_AVATAR_SIZE } from '../utils/uiConstants';
import { getRecruiterMasterDisplayForAdminUi } from '../utils/scoring/recruiterMasterScoreDisplay';
import { getGeoHierarchy } from '../data/metroSubareaSchema';
import { getCityMetadata } from '../data/metroMaster';
import { Autocomplete as GooglePlacesAutocomplete } from '@react-google-maps/api';
import { calculateDistance } from '../utils/locationUtils';
import { usePageCache } from '../hooks/usePageCache';
import { useActiveAssignmentUserIds } from '../hooks/useActiveAssignmentUserIds';
import { getWorkStatusColumnDisplay } from '../utils/workStatusColumnDisplay';

const SMART_GROUPS_CACHE_KEY = 'smartGroups';

const RADIUS_OPTIONS = [5, 10, 25, 50, 100];

type SmartGroupsEntityFilterKey = 'all' | 'select' | 'workforce' | 'events';

interface ResidenceRow {
  userId: string;
  userName: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  avatar?: string;
  city: string;
  state: string;
  distance?: number;
  skills?: string[];
  certifications?: string[];
  scoreSummary?: { aiScore?: number; interviewAvg?: number; interviewCount?: number; interviewLastAt?: any; interviewLastScore10?: number };
  recruiterScoreSnapshot?: unknown;
  recruiterMasterScore?: unknown;
  riskProfile?: unknown;
  securityLevel?: string;
  employeeOnboardStatus?: string;
  contractorOnboardStatus?: string;
  onboardingType?: string;
}

function getUserResidenceData(userData: any) {
  const addressInfo = userData?.addressInfo || {};
  const address = userData?.address || {};
  const addressCoords = address?.coordinates || {};
  const addressInfoCoords = addressInfo?.coordinates || {};

  const city = addressInfo.city ?? address.city ?? userData?.city ?? '';
  const state = addressInfo.state ?? address.state ?? userData?.state ?? '';
  const lat =
    addressInfo.homeLat ??
    address.homeLat ??
    addressInfoCoords.lat ??
    addressInfoCoords.latitude ??
    addressCoords.lat ??
    addressCoords.latitude ??
    userData?.homeLat ??
    null;
  const lng =
    addressInfo.homeLng ??
    address.homeLng ??
    addressInfoCoords.lng ??
    addressInfoCoords.longitude ??
    addressCoords.lng ??
    addressCoords.longitude ??
    userData?.homeLng ??
    null;

  if (typeof lat === 'number' && typeof lng === 'number') {
    return { city, state, lat, lng };
  }

  if (city && state) {
    const cityKey = getGeoHierarchy({ city, state }).cityKey;
    const cityMeta = getCityMetadata(cityKey);
    const fallbackLat = cityMeta?.coordinates?.lat ?? null;
    const fallbackLng = cityMeta?.coordinates?.lng ?? null;
    if (typeof fallbackLat === 'number' && typeof fallbackLng === 'number') {
      return { city, state, lat: fallbackLat, lng: fallbackLng };
    }
  }

  return { city, state, lat, lng };
}

export interface SmartGroupsPageProps {
  hideHeader?: boolean;
}

const defaultCacheState = {
  radiusAddress: '',
  radiusLat: null as number | null,
  radiusLng: null as number | null,
  radiusMiles: 10,
  entityFilter: 'all' as SmartGroupsEntityFilterKey,
  reportBuilt: false,
  resSortBy: 'userName',
  resSortOrder: 'asc' as 'asc' | 'desc',
  tablePage: 0,
  tableRowsPerPage: 20,
  cachedResidenceRows: [] as any[],
};

const SmartGroupsPage: React.FC<SmartGroupsPageProps> = ({ hideHeader = false }) => {
  const navigate = useNavigate();
  const { tenantId, user: authUser, activeTenant } = useAuth();
  const { isFavorite, toggleFavorite } = useFavorites('users');
  const { cacheState, updateCache, clearCache } = usePageCache({
    pageKey: SMART_GROUPS_CACHE_KEY,
    defaultState: defaultCacheState,
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAllResults, setSelectAllResults] = useState(false);
  const [bulkDrawerOpen, setBulkDrawerOpen] = useState(false);
  const [bulkDrawerChannel, setBulkDrawerChannel] = useState<'email' | 'sms'>('email');
  const [radiusAddress, setRadiusAddress] = useState(cacheState.radiusAddress ?? '');
  const [radiusLat, setRadiusLat] = useState<number | null>(cacheState.radiusLat ?? null);
  const [radiusLng, setRadiusLng] = useState<number | null>(cacheState.radiusLng ?? null);
  const [radiusMiles, setRadiusMiles] = useState<number>(cacheState.radiusMiles ?? 10);
  const radiusAutocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entityFilter, setEntityFilter] = useState<SmartGroupsEntityFilterKey>(() => {
    const raw = (cacheState as { entityFilter?: string }).entityFilter;
    if (raw === 'select' || raw === 'workforce' || raw === 'events') return raw;
    return 'all';
  });
  const [reportBuilt, setReportBuilt] = useState(!!cacheState.reportBuilt);
  const [resSortBy, setResSortBy] = useState<string>(cacheState.resSortBy ?? 'userName');
  const [resSortOrder, setResSortOrder] = useState<'asc' | 'desc'>(cacheState.resSortOrder ?? 'asc');
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveGroupName, setSaveGroupName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tablePage, setTablePage] = useState(typeof cacheState.tablePage === 'number' ? cacheState.tablePage : 0);
  const [tableRowsPerPage, setTableRowsPerPage] = useState(typeof cacheState.tableRowsPerPage === 'number' ? cacheState.tableRowsPerPage : 20);

  const [residenceRows, setResidenceRowsState] = useState<ResidenceRow[]>(() => {
    if (!cacheState.reportBuilt || !Array.isArray(cacheState.cachedResidenceRows) || cacheState.cachedResidenceRows.length === 0) return [];
    return cacheState.cachedResidenceRows;
  });

  const setResidenceRows = useCallback((next: ResidenceRow[] | ((prev: ResidenceRow[]) => ResidenceRow[])) => {
    setResidenceRowsState(next);
  }, []);

  useEffect(() => {
    if (reportBuilt) {
      updateCache({
        reportBuilt: true,
        radiusAddress,
        radiusLat,
        radiusLng,
        radiusMiles,
        entityFilter,
        resSortBy,
        resSortOrder,
        tablePage,
        tableRowsPerPage,
        cachedResidenceRows: residenceRows,
      });
    } else {
      updateCache({
        reportBuilt: false,
        cachedResidenceRows: [],
        radiusAddress,
        radiusLat,
        radiusLng,
        radiusMiles,
        entityFilter,
      });
    }
  }, [
    reportBuilt,
    residenceRows,
    radiusAddress,
    radiusLat,
    radiusLng,
    radiusMiles,
    entityFilter,
    resSortBy,
    resSortOrder,
    tablePage,
    tableRowsPerPage,
    updateCache,
  ]);

  const handleClearResults = useCallback(() => {
    setReportBuilt(false);
    setResidenceRows([]);
    setTablePage(0);
    setSelectedIds(new Set());
    setSelectAllResults(false);
    clearCache();
  }, [clearCache]);

  const loadResidenceData = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const applicationsRef = collection(db, 'tenants', tenantId, 'applications');
      const applicationsSnap = await getDocs(applicationsRef);
      const userIds = new Set<string>();
      applicationsSnap.docs.forEach((d) => {
        const data = d.data();
        const status = (data.status || '').toLowerCase();
        if (status !== 'withdrawn' && status !== 'deleted' && (data.userId || data.uid)) {
          userIds.add(data.userId || data.uid);
        }
      });

      const ids = Array.from(userIds);
      if (ids.length === 0) {
        setResidenceRows([]);
        setLoading(false);
        return;
      }

      // Batch-fetch user docs (Firestore 'in' limit is 10)
      const BATCH_SIZE = 10;
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        chunks.push(ids.slice(i, i + BATCH_SIZE));
      }
      const userSnaps = await Promise.all(
        chunks.map((chunk) => getDocs(query(collection(db, 'users'), where(documentId(), 'in', chunk))))
      );
      const userDocs = userSnaps.flatMap((snap) => snap.docs);

      const result: ResidenceRow[] = [];

      let centerLat: number;
      let centerLng: number;
      if (radiusLat != null && radiusLng != null) {
        centerLat = radiusLat;
        centerLng = radiusLng;
      } else if (radiusAddress.trim()) {
        setError('Select an address from the Google suggestions list before building a radius search.');
        setLoading(false);
        return;
      } else {
        setError('Enter or select an address for radius search');
        setLoading(false);
        return;
      }

      let entityUserIdSet: Set<string> | null = null;
      if (entityFilter !== 'all') {
        try {
          const { data } = await callSearchRecruiterTableUsers(functions, {
            tenantId,
            searchQuery: '',
            entityKey: entityFilter,
          });
          entityUserIdSet = new Set(data.userIds);
        } catch (e) {
          console.warn('[Smart Groups] entity filter callable failed', e);
          setError('Failed to resolve entity filter. Try again.');
          setLoading(false);
          return;
        }
        if (entityUserIdSet.size === 0) {
          setResidenceRows([]);
          setLoading(false);
          return;
        }
      }

      for (const docSnap of userDocs) {
        const uid = docSnap.id;
        if (entityUserIdSet && !entityUserIdSet.has(uid)) continue;
        const userData = docSnap.data();
        const residence = getUserResidenceData(userData);
        const lat = residence.lat;
        const lng = residence.lng;
        if (typeof lat !== 'number' || typeof lng !== 'number') continue;
        const distance = calculateDistance(centerLat, centerLng, lat, lng);
        if (distance > radiusMiles) continue;
        const userName = [userData?.firstName, userData?.lastName].filter(Boolean).join(' ') || uid;
        const city = residence.city;
        const state = residence.state;
        const skills = Array.isArray(userData?.skills) ? userData.skills : [];
        const certifications = Array.isArray(userData?.certifications)
          ? (userData.certifications as any[]).map((c: any) => (typeof c === 'string' ? c : c?.name || '')).filter(Boolean)
          : [];
        result.push({
          userId: uid,
          userName,
          firstName: userData?.firstName,
          lastName: userData?.lastName,
          email: userData?.email,
          phone: userData?.phone,
          avatar: userData?.avatar,
          city,
          state,
          distance,
          skills,
          certifications,
          scoreSummary: userData?.scoreSummary,
          recruiterScoreSnapshot: userData?.recruiterScoreSnapshot,
          recruiterMasterScore: userData?.recruiterMasterScore,
          riskProfile: userData?.riskProfile,
          securityLevel: userData?.tenantIds?.[tenantId]?.securityLevel ?? userData?.securityLevel,
          employeeOnboardStatus: userData?.employeeOnboardStatus,
          contractorOnboardStatus: userData?.contractorOnboardStatus,
          onboardingType: userData?.onboardingType,
        });
      }
      result.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));

      setResidenceRows(result);
    } catch (err: any) {
      setError(err?.message || 'Failed to load residence data');
      setResidenceRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    tenantId,
    radiusAddress,
    radiusLat,
    radiusLng,
    radiusMiles,
    entityFilter,
    setResidenceRows,
  ]);

  const handleBuildReport = () => {
    setReportBuilt(true);
    setTablePage(0);
    loadResidenceData();
  };

  // Auto-rebuild report when filters change (debounced)
  useEffect(() => {
    if (!reportBuilt) return;

    const timeoutId = setTimeout(() => {
      setTablePage(0);
      setSelectedIds(new Set());
      setSelectAllResults(false);
      if (radiusAddress.trim() && (radiusLat == null || radiusLng == null)) {
        return;
      }
      loadResidenceData();
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [
    reportBuilt,
    entityFilter,
    radiusAddress,
    radiusLat,
    radiusLng,
    radiusMiles,
    loadResidenceData,
  ]);

  const sortedResidenceRows = useMemo(() => {
    return [...residenceRows].sort((a, b) => {
      const mult = resSortOrder === 'asc' ? 1 : -1;
      switch (resSortBy) {
        case 'userName':
          return mult * a.userName.localeCompare(b.userName);
        case 'city':
          return mult * (a.city || '').localeCompare(b.city || '');
        case 'state':
          return mult * (a.state || '').localeCompare(b.state || '');
        case 'distance':
          return mult * ((a.distance ?? 0) - (b.distance ?? 0));
        default:
          return 0;
      }
    });
  }, [residenceRows, resSortBy, resSortOrder]);

  const handleResSort = (key: string) => {
    if (resSortBy === key) setResSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    else {
      setResSortBy(key);
      setResSortOrder('asc');
    }
  };

  const paginatedResidenceRows = sortedResidenceRows.slice(
    tablePage * tableRowsPerPage,
    tablePage * tableRowsPerPage + tableRowsPerPage
  );
  const residenceTotalCount = sortedResidenceRows.length;
  const selectedCount = selectAllResults ? residenceTotalCount : selectedIds.size;
  const allOnPageSelected =
    paginatedResidenceRows.length > 0 &&
    (selectAllResults || paginatedResidenceRows.every((r) => selectedIds.has(r.userId)));
  const someOnPageSelected =
    !selectAllResults && paginatedResidenceRows.some((r) => selectedIds.has(r.userId));

  const handleSelectAllOnPage = () => {
    if (allOnPageSelected) {
      const next = new Set(selectedIds);
      paginatedResidenceRows.forEach((r) => next.delete(r.userId));
      setSelectedIds(next);
      setSelectAllResults(false);
    } else {
      const next = new Set(selectedIds);
      paginatedResidenceRows.forEach((r) => next.add(r.userId));
      setSelectedIds(next);
    }
  };

  const handleSelectRow = (userId: string, checked: boolean) => {
    if (selectAllResults) {
      if (checked) return;
      setSelectAllResults(false);
      setSelectedIds(new Set(sortedResidenceRows.filter((r) => r.userId !== userId).map((r) => r.userId)));
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
      ? sortedResidenceRows
      : sortedResidenceRows.filter((r) => selectedIds.has(r.userId));
    const recipients: MessageRecipient[] = rowsToUse.map((r) => ({
      userId: r.userId,
      name: [r.firstName, r.lastName].filter(Boolean).join(' ').trim() || r.userName || r.userId,
      email: r.email,
      phone: r.phone ? formatPhoneNumber(r.phone) : undefined,
    }));
    const recipientUserIds = rowsToUse.map((r) => r.userId);
    return { recipients, recipientUserIds };
  }, [selectAllResults, selectedIds, sortedResidenceRows]);

  const currentResultMemberIds = residenceRows.map((r) => r.userId);
  const hasResults = reportBuilt && currentResultMemberIds.length > 0;

  const handleSaveSmartSearch = async () => {
    const name = saveGroupName.trim();
    if (!name || !tenantId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const filters: Record<string, unknown> = {
        radiusAddress,
        radiusMiles,
        entityFilter,
      };
      if (radiusLat != null && radiusLng != null) {
        filters.radiusLat = radiusLat;
        filters.radiusLng = radiusLng;
      }
      const memberStatusById: Record<string, 'preferred' | 'member' | 'not_preferred'> = {};
      currentResultMemberIds.forEach((id) => {
        memberStatusById[id] = 'member';
      });
      const ref = collection(db, 'tenants', tenantId, 'savedSmartGroups');
      const createdByName = authUser?.displayName || authUser?.email || (authUser?.uid ? 'Unknown' : null);
      await addDoc(ref, {
        name,
        filters,
        memberIds: currentResultMemberIds,
        memberStatusById,
        createdAt: serverTimestamp(),
        createdBy: authUser?.uid ?? null,
        createdByName: createdByName ?? null,
        updatedAt: serverTimestamp(),
      });
      setSaveDialogOpen(false);
      setSaveGroupName('');
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
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

  const residenceUserIdsForAssignments = useMemo(() => residenceRows.map((r) => r.userId), [residenceRows]);
  const activeAssignmentUserIds = useActiveAssignmentUserIds(tenantId ?? undefined, residenceUserIdsForAssignments);

  const getWorkStatusDisplay = (row: ResidenceRow) =>
    getWorkStatusColumnDisplay(row, { hasActiveAssignment: activeAssignmentUserIds.has(row.userId) });

  const renderResidenceAiScore = (row: ResidenceRow) => {
    const m = getRecruiterMasterDisplayForAdminUi({
      recruiterMasterScoreRaw: row.recruiterMasterScore,
      recruiterScoreSnapshotRaw: row.recruiterScoreSnapshot,
      userData: {
        scoreSummary: row.scoreSummary,
        riskProfile: row.riskProfile,
      },
      latestPrescreenInterviewAi: null,
    });
    const rawScore = m.score100 != null && !Number.isNaN(m.score100) ? m.score100 : null;
    if (rawScore === null) {
      return <Typography variant="body2" color="text.secondary">—</Typography>;
    }
    const displayScore = Math.round(rawScore);
    const color: 'default' | 'success' | 'warning' | 'error' = displayScore >= 80 ? 'success' : displayScore >= 60 ? 'warning' : 'default';
    return (
      <Tooltip title={`Master Recruiter Score: ${displayScore}`}>
        <Chip
          icon={<InsightsIcon sx={{ fontSize: 16 }} />}
          label={`${displayScore}`}
          color={color}
          size="small"
          variant={color === 'default' ? 'outlined' : 'filled'}
          sx={{ minWidth: 96, justifyContent: 'flex-start' }}
        />
      </Tooltip>
    );
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, pt: 2, px: 2, pb: 2 }}>
      {!hideHeader && (
        <PageHeader
          title="Smart Groups"
          subtitle="Workers by proximity to an address (home location) and C1 entity"
        />
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2, flexShrink: 0 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          mb: 2,
          flexWrap: 'wrap',
        }}
      >
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
                    console.log('[Smart Groups] Place selected, coordinates:', { lat, lng, formatted_address: place.formatted_address ?? '' });
                    setRadiusLat(lat);
                    setRadiusLng(lng);
                    setRadiusAddress(place.formatted_address ?? '');
                    setError(null);
                  } else {
                    console.log('[Smart Groups] Place selected but invalid coordinates:', { lat, lng });
                    setRadiusLat(null);
                    setRadiusLng(null);
                  }
                } else {
                  console.log('[Smart Groups] Place selected but no geometry');
                  setRadiusLat(null);
                  setRadiusLng(null);
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
                value={radiusAddress}
                onChange={(e) => {
                  setRadiusAddress(e.target.value);
                  setRadiusLat(null);
                  setRadiusLng(null);
                }}
                InputProps={{
                  endAdornment: radiusAddress ? (
                    <IconButton
                      size="small"
                      aria-label="Clear address"
                      onClick={() => {
                        setRadiusAddress('');
                        setRadiusLat(null);
                        setRadiusLng(null);
                      }}
                      edge="end"
                    >
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  ) : undefined,
                }}
                sx={{ minWidth: 280 }}
              />
            </GooglePlacesAutocomplete>
            <FormControl size="small" sx={{ minWidth: 100 }}>
              <InputLabel id="smart-radius-label">Radius</InputLabel>
              <Select
                labelId="smart-radius-label"
                value={radiusMiles}
                label="Radius"
                onChange={(e) => setRadiusMiles(Number(e.target.value))}
              >
                {RADIUS_OPTIONS.map((m) => (
                  <MenuItem key={m} value={m}>
                    {m} mi
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 180, height: 36 }}>
              <InputLabel sx={{ fontSize: '0.875rem' }}>Entity</InputLabel>
              <Select
                label="Entity"
                value={entityFilter}
                onChange={(e) => {
                  const v = e.target.value as SmartGroupsEntityFilterKey;
                  setEntityFilter(v);
                  updateCache({ entityFilter: v });
                }}
                sx={{ height: 36, borderRadius: '6px', backgroundColor: 'white', fontSize: '0.875rem' }}
              >
                <MenuItem value="all">All entities</MenuItem>
                <MenuItem value="select">C1 Select</MenuItem>
                <MenuItem value="workforce">C1 Workforce</MenuItem>
                <MenuItem value="events">C1 Events</MenuItem>
              </Select>
            </FormControl>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 'auto' }}>
          {hasResults && (
            <Button
              variant="outlined"
              onClick={() => {
                setSaveGroupName('');
                setSaveError(null);
                setSaveDialogOpen(true);
              }}
            >
              Save Smart Search
            </Button>
          )}
          {reportBuilt && (
            <Button
              variant="outlined"
              startIcon={<ClearIcon />}
              onClick={handleClearResults}
              disabled={loading}
              sx={{
                textTransform: 'none',
                borderRadius: '24px',
                px: 2.5,
                py: 1,
                height: '40px',
                fontWeight: 500,
                fontSize: '14px',
                whiteSpace: 'nowrap',
              }}
            >
              Clear results
            </Button>
          )}
          <Button
            variant="contained"
            startIcon={<BuildIcon />}
            onClick={handleBuildReport}
            disabled={loading}
            sx={{
              textTransform: 'none',
              borderRadius: '24px',
              px: 2.5,
              py: 1,
              height: '40px',
              fontWeight: 500,
              fontSize: '14px',
              bgcolor: '#0057B8',
              boxShadow: '0 2px 8px rgba(0, 87, 184, 0.25)',
              '&:hover': {
                bgcolor: '#004a9f',
                boxShadow: '0 4px 12px rgba(0, 87, 184, 0.35)',
              },
              whiteSpace: 'nowrap',
            }}
          >
            Build Report
          </Button>
        </Box>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : !reportBuilt ? (
        <Box
          sx={{
            py: 6,
            textAlign: 'center',
            color: 'text.secondary',
          }}
        >
          <Typography variant="body1">
            Select filters and click <strong>Build Report</strong> to generate the report.
          </Typography>
        </Box>
      ) : (
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            overflow: 'hidden',
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
                border: '1px solid',
                borderColor: 'divider',
                borderBottom: 'none',
                borderRadius: '8px 8px 0 0',
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {selectAllResults
                  ? `All ${residenceTotalCount} result${residenceTotalCount === 1 ? '' : 's'} selected`
                  : `${selectedCount} selected`}
              </Typography>
              <Button size="small" onClick={handleClearSelection} sx={{ textTransform: 'none' }}>
                Clear selection
              </Button>
              {allOnPageSelected &&
                !selectAllResults &&
                residenceTotalCount > paginatedResidenceRows.length && (
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={handleSelectAllResults}
                    sx={{ textTransform: 'none' }}
                  >
                    Select all {residenceTotalCount} results
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
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              overflowX: 'auto',
              width: '100%',
              px: 0,
              border: '1px solid #EAEEF4',
              borderRadius: selectedCount > 0 ? 0 : 2,
              ...(selectedCount > 0 && { borderRadius: '0 0 8px 8px' }),
              '&::-webkit-scrollbar': { width: '8px', height: '8px' },
              '&::-webkit-scrollbar-track': { background: 'rgba(0, 0, 0, 0.02)', borderRadius: '4px' },
              '&::-webkit-scrollbar-thumb': { background: 'rgba(0, 0, 0, 0.15)', borderRadius: '4px', '&:hover': { background: 'rgba(0, 0, 0, 0.25)' } },
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
            }}
          >
            <Table size="small" stickyHeader sx={{ width: '100%' }}>
              <TableHead sx={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: 'background.paper', '& .MuiTableCell-root': { borderRadius: 0 } }}>
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
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0, minWidth: 200 }}>
                    <TableSortLabel active={resSortBy === 'userName'} direction={resSortBy === 'userName' ? resSortOrder : 'asc'} onClick={() => handleResSort('userName')}>
                      Person
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>Contact</TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>Work Status</TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>Score</TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>Interview</TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>Group Status</TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>Skills</TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                    <TableSortLabel active={resSortBy === 'distance'} direction={resSortBy === 'distance' ? resSortOrder : 'asc'} onClick={() => handleResSort('distance')}>
                      Distance
                    </TableSortLabel>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedResidenceRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} align="center" sx={{ py: 4 }}>
                      <Typography color="text.secondary">No users match the current filters.</Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedResidenceRows.map((row, idx) => {
                      const ws = getWorkStatusDisplay(row);
                      const skills = row.skills ?? [];
                      return (
                        <TableRow
                          key={row.userId}
                          hover
                          sx={{
                            cursor: 'pointer',
                            backgroundColor: idx % 2 === 0 ? 'background.paper' : 'action.hover',
                            '&:hover': { backgroundColor: 'action.selected' },
                          }}
                          onClick={() => navigate(`/users/${row.userId}`)}
                        >
                          <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()} sx={{ width: 48 }}>
                            <Checkbox
                              size="small"
                              checked={selectAllResults || selectedIds.has(row.userId)}
                              onChange={(_, checked) => handleSelectRow(row.userId, checked)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Select ${row.userName || row.userId}`}
                            />
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <FavoriteButton
                              itemId={row.userId}
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
                          <TableCell sx={{ minWidth: 200 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                              <Avatar src={row.avatar} sx={{ width: TABLE_AVATAR_SIZE, height: TABLE_AVATAR_SIZE }}>{String(row.firstName || '').charAt(0)}</Avatar>
                              <Box sx={{ minWidth: 0 }}>
                                <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                                  {[row.firstName, row.lastName].filter(Boolean).join(' ').trim() || row.userName}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>#{String(row.userId).slice(-6)}</Typography>
                              </Box>
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                              {row.email && (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  <EmailIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                                  <Typography variant="body2" sx={{ fontSize: '0.85rem' }}>{row.email}</Typography>
                                </Box>
                              )}
                              {row.phone && (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  <PhoneIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                                  <Typography variant="body2" sx={{ fontSize: '0.85rem' }}>{formatPhoneNumber(row.phone)}</Typography>
                                </Box>
                              )}
                              {(row.city || row.state) && (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  <LocationOnIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                                  <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.85rem' }}>{[row.city, row.state].filter(Boolean).join(', ')}</Typography>
                                </Box>
                              )}
                              {!row.email && !row.phone && !row.city && !row.state && '—'}
                            </Box>
                          </TableCell>
                          <TableCell><Chip size="small" label={ws.label} color={ws.color} sx={ws.sx} /></TableCell>
                          <TableCell>{renderResidenceAiScore(row)}</TableCell>
                          <TableCell>
                            <InterviewCell
                              userId={row.userId}
                              scoreSummary={row.scoreSummary}
                              formatDate={formatDate}
                            />
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" color="text.secondary">—</Typography>
                          </TableCell>
                          <TableCell>
                            {skills.length === 0 ? (
                              <Typography variant="body2" color="text.secondary">—</Typography>
                            ) : (
                              <Tooltip title={skills.length <= 1 ? toChipLabel(skills[0]) : <Box component="span" sx={{ display: 'block', maxHeight: 320, overflowY: 'auto', py: 0.5 }}>{skills.map((s, i) => <Typography key={`${toChipLabel(s)}-${i}`} component="span" variant="body2" sx={{ display: 'block' }}>{toChipLabel(s)}</Typography>)}</Box>} placement="top" enterDelay={300} disableInteractive={false}>
                                <Typography variant="body2" noWrap component="span" sx={{ display: 'block' }}>{toChipLabel(skills[0])}{skills.length > 1 ? '…' : ''}</Typography>
                              </Tooltip>
                            )}
                          </TableCell>
                          <TableCell>{row.distance != null ? `${row.distance.toFixed(1)} mi` : '—'}</TableCell>
                        </TableRow>
                      );
                    })
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <StandardTablePagination
            count={sortedResidenceRows.length}
            page={tablePage}
            onPageChange={(_, newPage) => setTablePage(newPage)}
            rowsPerPage={tableRowsPerPage}
            onRowsPerPageChange={(e) => {
              setTableRowsPerPage(parseInt(e.target.value, 10));
              setTablePage(0);
            }}
          />
        </Box>
      )}
      </Box>

      <Dialog open={saveDialogOpen} onClose={() => !saving && setSaveDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Save Smart Search</DialogTitle>
        <DialogContent>
          {saveError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setSaveError(null)}>
              {saveError}
            </Alert>
          )}
          <TextField
            autoFocus
            margin="dense"
            label="Group name"
            fullWidth
            value={saveGroupName}
            onChange={(e) => setSaveGroupName(e.target.value)}
            placeholder="e.g. Dallas warehouse applicants"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveDialogOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleSaveSmartSearch}
            disabled={saving || !saveGroupName.trim()}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <MessageDrawer
        open={bulkDrawerOpen}
        onClose={() => setBulkDrawerOpen(false)}
        recipients={bulkRecipientsAndIds.recipients}
        tenantId={activeTenant?.id}
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

export default SmartGroupsPage;
