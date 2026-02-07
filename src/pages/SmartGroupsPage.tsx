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
  ToggleButtonGroup,
  ToggleButton,
  Autocomplete,
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
import PersonIcon from '@mui/icons-material/Person';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import WorkIcon from '@mui/icons-material/Work';
import EmailIcon from '@mui/icons-material/Email';
import PhoneIcon from '@mui/icons-material/Phone';
import SmsIcon from '@mui/icons-material/Sms';
import InsightsIcon from '@mui/icons-material/Insights';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import MessageDrawer, { type MessageRecipient } from '../components/MessageDrawer';
import FavoriteButton from '../components/FavoriteButton';
import { useFavorites } from '../hooks/useFavorites';
import { db } from '../firebase';
import { collection, getDocs, doc, getDoc, addDoc, serverTimestamp, query, where, documentId } from 'firebase/firestore';
import PageHeader from '../components/PageHeader';
import StandardTablePagination from '../components/StandardTablePagination';
import { formatPhoneNumber } from '../utils/formatPhone';
import { TABLE_AVATAR_SIZE } from '../utils/uiConstants';
import { formatOneDecimal, getRelativeAiScore } from '../utils/scoreSummary';
import { useScoringDistribution } from '../hooks/useScoringDistribution';
import type { SmartGroupData, SmartGroupEntry, JobCategory } from '../services/smartGroupService';
import {
  getMergedMetroOptions,
  getMergedSubareaOptionsForMetro,
  getMergedCityOptionsForSubarea,
  getCityKeysForMetro,
  formatGeoLabel,
  getGeoHierarchy,
} from '../data/metroSubareaSchema';
import { Autocomplete as GooglePlacesAutocomplete } from '@react-google-maps/api';
import { geocodeAddress, getGeocodingErrorMessage } from '../utils/geocodeAddress';
import { calculateDistance } from '../utils/locationUtils';
import { useSmartGroupSettings } from '../hooks/useSmartGroupSettings';
import { usePageCache } from '../hooks/usePageCache';

const SMART_GROUPS_CACHE_KEY = 'smartGroups';

/** Convert Firestore Timestamp to ISO string for cache serialization. */
function timestampToIso(ts: any): string | undefined {
  if (!ts) return undefined;
  try {
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  } catch {
    return undefined;
  }
}

/** Restore timestamp from cached ISO or { seconds, _seconds } so formatTimestamp/sort work. */
function isoToTimestampLike(isoOrObj: any): any {
  if (isoOrObj == null) return undefined;
  if (typeof isoOrObj === 'string') {
    const d = new Date(isoOrObj);
    return isNaN(d.getTime()) ? undefined : { toDate: () => d };
  }
  const s = isoOrObj?.seconds ?? isoOrObj?._seconds;
  if (typeof s === 'number') return { toDate: () => new Date(s * 1000) };
  return isoOrObj;
}

function serializeRowsForCache(rows: SmartGroupRow[]): any[] {
  return rows.map((r) => ({
    ...r,
    entry: {
      ...r.entry,
      timestamp: r.entry?.timestamp != null ? timestampToIso(r.entry.timestamp) : undefined,
    },
  }));
}

function deserializeRowsFromCache(cached: any[]): SmartGroupRow[] {
  if (!Array.isArray(cached)) return [];
  return cached.map((r) => ({
    ...r,
    entry: {
      ...r.entry,
      timestamp: r.entry?.timestamp != null ? isoToTimestampLike(r.entry.timestamp) : undefined,
    },
  }));
}

/** Metro filter value for applicants in cities not in any defined metro (fallback metros). */
const OTHER_METRO_VALUE = '__other__';

const RADIUS_OPTIONS = [5, 10, 25, 50];

interface SmartGroupRow {
  userId: string;
  userName: string;
  applicationId: string;
  entry: SmartGroupEntry;
  interviewScore?: number;
  aiScore?: number;
}

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
  securityLevel?: string;
}

export interface SmartGroupsPageProps {
  hideHeader?: boolean;
}

type FilterMode = 'residence' | 'application';
type ResidenceSubMode = 'area' | 'radius';

const defaultCacheState = {
  filterMode: 'application' as FilterMode,
  residenceSubMode: 'area' as ResidenceSubMode,
  radiusAddress: '',
  radiusLat: null as number | null,
  radiusLng: null as number | null,
  radiusMiles: 10,
  metroFilter: null as string | null,
  areaFilter: null as string | null,
  cityFilter: null as string | null,
  categoryFilter: null as string | null,
  selectedSkills: [] as string[],
  selectedCertifications: [] as string[],
  reportBuilt: false,
  appSortBy: 'userName',
  appSortOrder: 'asc' as 'asc' | 'desc',
  resSortBy: 'userName',
  resSortOrder: 'asc' as 'asc' | 'desc',
  tablePage: 0,
  tableRowsPerPage: 20,
  cachedRows: [] as any[],
  cachedResidenceRows: [] as any[],
};

const SmartGroupsPage: React.FC<SmartGroupsPageProps> = ({ hideHeader = false }) => {
  const navigate = useNavigate();
  const { tenantId, user: authUser, activeTenant } = useAuth();
  const { customMetros } = useSmartGroupSettings(tenantId);
  const { distribution: scoringDistribution } = useScoringDistribution(tenantId);
  const { isFavorite, toggleFavorite } = useFavorites('users');
  const { cacheState, updateCache, clearCache } = usePageCache({
    pageKey: SMART_GROUPS_CACHE_KEY,
    defaultState: defaultCacheState,
  });

  const [filterMode, setFilterMode] = useState<FilterMode>(cacheState.filterMode ?? 'application');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAllResults, setSelectAllResults] = useState(false);
  const [bulkDrawerOpen, setBulkDrawerOpen] = useState(false);
  const [bulkDrawerChannel, setBulkDrawerChannel] = useState<'email' | 'sms'>('email');
  const [residenceSubMode, setResidenceSubMode] = useState<ResidenceSubMode>(cacheState.residenceSubMode ?? 'area');
  const [radiusAddress, setRadiusAddress] = useState(cacheState.radiusAddress ?? '');
  const [radiusLat, setRadiusLat] = useState<number | null>(cacheState.radiusLat ?? null);
  const [radiusLng, setRadiusLng] = useState<number | null>(cacheState.radiusLng ?? null);
  const [radiusMiles, setRadiusMiles] = useState<number>(cacheState.radiusMiles ?? 10);
  const radiusAutocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metroFilter, setMetroFilter] = useState<string | null>(cacheState.metroFilter ?? null);
  const [areaFilter, setAreaFilter] = useState<string | null>(cacheState.areaFilter ?? null);
  const [cityFilter, setCityFilter] = useState<string | null>(cacheState.cityFilter ?? null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(cacheState.categoryFilter ?? null);
  const [selectedSkills, setSelectedSkills] = useState<string[]>(Array.isArray(cacheState.selectedSkills) ? cacheState.selectedSkills : []);
  const [selectedCertifications, setSelectedCertifications] = useState<string[]>(Array.isArray(cacheState.selectedCertifications) ? cacheState.selectedCertifications : []);
  const [reportBuilt, setReportBuilt] = useState(!!cacheState.reportBuilt);
  const [appSortBy, setAppSortBy] = useState<string>(cacheState.appSortBy ?? 'userName');
  const [appSortOrder, setAppSortOrder] = useState<'asc' | 'desc'>(cacheState.appSortOrder ?? 'asc');
  const [resSortBy, setResSortBy] = useState<string>(cacheState.resSortBy ?? 'userName');
  const [resSortOrder, setResSortOrder] = useState<'asc' | 'desc'>(cacheState.resSortOrder ?? 'asc');
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveGroupName, setSaveGroupName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tablePage, setTablePage] = useState(typeof cacheState.tablePage === 'number' ? cacheState.tablePage : 0);
  const [tableRowsPerPage, setTableRowsPerPage] = useState(typeof cacheState.tableRowsPerPage === 'number' ? cacheState.tableRowsPerPage : 20);

  const [rows, setRowsState] = useState<SmartGroupRow[]>(() => {
    if (!cacheState.reportBuilt || !Array.isArray(cacheState.cachedRows) || cacheState.cachedRows.length === 0) return [];
    return deserializeRowsFromCache(cacheState.cachedRows);
  });
  const [residenceRows, setResidenceRowsState] = useState<ResidenceRow[]>(() => {
    if (!cacheState.reportBuilt || !Array.isArray(cacheState.cachedResidenceRows) || cacheState.cachedResidenceRows.length === 0) return [];
    return cacheState.cachedResidenceRows;
  });

  const setRows = useCallback((next: SmartGroupRow[] | ((prev: SmartGroupRow[]) => SmartGroupRow[])) => {
    setRowsState(next);
  }, []);
  const setResidenceRows = useCallback((next: ResidenceRow[] | ((prev: ResidenceRow[]) => ResidenceRow[])) => {
    setResidenceRowsState(next);
  }, []);

  useEffect(() => {
    if (reportBuilt && (rows.length > 0 || residenceRows.length > 0)) {
      updateCache({
        reportBuilt: true,
        filterMode,
        residenceSubMode,
        radiusAddress,
        radiusLat,
        radiusLng,
        radiusMiles,
        metroFilter,
        areaFilter,
        cityFilter,
        categoryFilter,
        selectedSkills,
        selectedCertifications,
        appSortBy,
        appSortOrder,
        resSortBy,
        resSortOrder,
        tablePage,
        tableRowsPerPage,
        cachedRows: serializeRowsForCache(rows),
        cachedResidenceRows: residenceRows,
      });
    } else if (!reportBuilt) {
      updateCache({
        reportBuilt: false,
        cachedRows: [],
        cachedResidenceRows: [],
      });
    }
  }, [
    reportBuilt,
    rows,
    residenceRows,
    filterMode,
    residenceSubMode,
    radiusAddress,
    radiusLat,
    radiusLng,
    radiusMiles,
    metroFilter,
    areaFilter,
    cityFilter,
    categoryFilter,
    selectedSkills,
    selectedCertifications,
    appSortBy,
    appSortOrder,
    resSortBy,
    resSortOrder,
    tablePage,
    tableRowsPerPage,
    updateCache,
  ]);

  const handleFilterModeChange = (_: React.MouseEvent<HTMLElement>, value: FilterMode | null) => {
    if (value) {
      setFilterMode(value);
      setReportBuilt(false);
      setRows([]);
      setResidenceRows([]);
      setSelectedIds(new Set());
      setSelectAllResults(false);
      updateCache({ reportBuilt: false, cachedRows: [], cachedResidenceRows: [] });
    }
  };

  const handleClearResults = useCallback(() => {
    setReportBuilt(false);
    setRows([]);
    setResidenceRows([]);
    setTablePage(0);
    setSelectedIds(new Set());
    setSelectAllResults(false);
    clearCache();
  }, [clearCache]);

  const loadData = async () => {
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

      const flatRows: SmartGroupRow[] = [];
      for (const uid of userIds) {
        const userRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) continue;
        const userData = userSnap.data();
        const smartGroupData = userData?.smartGroupData as SmartGroupData | undefined;
        if (!smartGroupData?.byApplication || Object.keys(smartGroupData.byApplication).length === 0) continue;

        const userName = [userData?.firstName, userData?.lastName].filter(Boolean).join(' ') || uid;
        const scoreSummary = userData?.scoreSummary;
        const interviewScore = scoreSummary?.interviewAvg != null ? Number(scoreSummary.interviewAvg) : undefined;
        const aiScore = scoreSummary?.aiScore != null ? Number(scoreSummary.aiScore) : undefined;

        for (const [applicationId, entry] of Object.entries(smartGroupData.byApplication)) {
          flatRows.push({
            userId: uid,
            userName,
            applicationId,
            entry: entry as SmartGroupEntry,
            interviewScore,
            aiScore,
          });
        }
      }

      setRows(flatRows);
    } catch (err: any) {
      setError(err?.message || 'Failed to load Smart Groups data');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const loadResidenceData = async () => {
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

      if (residenceSubMode === 'radius') {
        let centerLat: number;
        let centerLng: number;
        if (radiusLat != null && radiusLng != null) {
          centerLat = radiusLat;
          centerLng = radiusLng;
          console.log('[Smart Groups] Using stored coordinates from place selection:', { centerLat, centerLng });
        } else if (radiusAddress.trim()) {
          console.log('[Smart Groups] Geocoding address (no place selected):', radiusAddress.trim());
          try {
            const geo = await geocodeAddress(radiusAddress.trim());
            centerLat = geo.lat;
            centerLng = geo.lng;
            console.log('[Smart Groups] Geocoded successfully:', { lat: centerLat, lng: centerLng });
          } catch (geocodeErr: any) {
            console.warn('[Smart Groups] Geocoding error:', geocodeErr?.message ?? geocodeErr);
            setError(getGeocodingErrorMessage(geocodeErr, { hasAutocomplete: true }));
            setLoading(false);
            return;
          }
        } else {
          setError('Enter or select an address for radius search');
          setLoading(false);
          return;
        }

        for (const docSnap of userDocs) {
          const uid = docSnap.id;
          const userData = docSnap.data();
          const addr = userData?.addressInfo || userData?.address || {};
          const lat = addr.homeLat ?? addr.coordinates?.lat ?? userData?.homeLat;
          const lng = addr.homeLng ?? addr.coordinates?.lng ?? userData?.homeLng;
          if (typeof lat !== 'number' || typeof lng !== 'number') continue;
          const distance = calculateDistance(centerLat, centerLng, lat, lng);
          if (distance > radiusMiles) continue;
          const userName = [userData?.firstName, userData?.lastName].filter(Boolean).join(' ') || uid;
          const city = addr.city ?? userData?.city ?? '';
          const state = addr.state ?? userData?.state ?? '';
          const skills = Array.isArray(userData?.skills) ? userData.skills : [];
          const certifications = Array.isArray(userData?.certifications)
            ? (userData.certifications as any[]).map((c: any) => (typeof c === 'string' ? c : c?.name || '')).filter(Boolean)
            : [];
          const matchSkills = selectedSkills.length === 0 || selectedSkills.some((s) => skills.includes(s));
          const matchCerts = selectedCertifications.length === 0 || selectedCertifications.some((c) => certifications.includes(c));
          if (!matchSkills || !matchCerts) continue;
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
            securityLevel: userData?.tenantIds?.[tenantId]?.securityLevel ?? userData?.securityLevel,
          });
        }
        result.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
      } else {
        const cityKeysForMetro =
          metroFilter && metroFilter !== OTHER_METRO_VALUE
            ? getCityKeysForMetro(metroFilter, customMetros)
            : [];
        for (const docSnap of userDocs) {
          const uid = docSnap.id;
          const userData = docSnap.data();
          const addr = userData?.addressInfo || userData?.address || {};
          const city = (addr.city ?? userData?.city ?? '').trim();
          const state = (addr.state ?? userData?.state ?? '').trim();
          if (!city && !state) continue;
          const hierarchy = getGeoHierarchy({ city, state });
          const matchMetro = !metroFilter
            ? true
            : metroFilter === OTHER_METRO_VALUE
              ? !getMergedMetroOptions(customMetros).includes(hierarchy.metroKey)
              : hierarchy.metroKey === metroFilter || cityKeysForMetro.includes(hierarchy.cityKey);
          const matchArea =
            !areaFilter ||
            (Array.isArray(hierarchy.subareaKeys) && hierarchy.subareaKeys.includes(areaFilter));
          const matchCity = !cityFilter || hierarchy.cityKey === cityFilter;
          if (!matchMetro || !matchArea || !matchCity) continue;
          const skills = Array.isArray(userData?.skills) ? userData.skills : [];
          const certifications = Array.isArray(userData?.certifications)
            ? (userData.certifications as any[]).map((c: any) => (typeof c === 'string' ? c : c?.name || '')).filter(Boolean)
            : [];
          const matchSkills = selectedSkills.length === 0 || selectedSkills.some((s) => skills.includes(s));
          const matchCerts = selectedCertifications.length === 0 || selectedCertifications.some((c) => certifications.includes(c));
          if (!matchSkills || !matchCerts) continue;
          const userName = [userData?.firstName, userData?.lastName].filter(Boolean).join(' ') || uid;
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
            skills,
            certifications,
            scoreSummary: userData?.scoreSummary,
            securityLevel: userData?.tenantIds?.[tenantId]?.securityLevel ?? userData?.securityLevel,
          });
        }
        result.sort((a, b) => (a.city + a.state).localeCompare(b.city + b.state));
      }

      setResidenceRows(result);
    } catch (err: any) {
      setError(err?.message || 'Failed to load residence data');
      setResidenceRows([]);
    } finally {
      setLoading(false);
    }
  };

  const handleBuildReport = () => {
    setReportBuilt(true);
    setTablePage(0);
    if (filterMode === 'residence') {
      loadResidenceData();
    } else {
      loadData();
    }
  };

  const clearMetro = () => {
    setMetroFilter(null);
    setAreaFilter(null);
    setCityFilter(null);
  };
  const clearArea = () => {
    setAreaFilter(null);
    setCityFilter(null);
  };
  const clearCity = () => setCityFilter(null);
  const clearCategory = () => setCategoryFilter(null);

  const metroOptions = getMergedMetroOptions(customMetros);
  const areaOptions = metroFilter ? getMergedSubareaOptionsForMetro(metroFilter, customMetros) : [];
  const cityOptions =
    metroFilter && areaFilter
      ? getMergedCityOptionsForSubarea(metroFilter, areaFilter, customMetros)
      : [];

  const categoryOptionsFromData = Array.from(
    new Set(rows.map((r) => r.entry.jobCategory).filter(Boolean))
  ).sort();
  const schemaCategories: JobCategory[] = ['industrial', 'hospitality', 'janitorial', 'other'];
  const categoryOptions = schemaCategories.filter(
    (c) => categoryOptionsFromData.includes(c) || categoryOptionsFromData.length === 0
  );
  if (categoryOptionsFromData.length > 0) {
    categoryOptionsFromData.forEach((c) => {
      if (!categoryOptions.includes(c)) categoryOptions.push(c);
    });
    categoryOptions.sort();
  }

  const skillsOptionsFromApplication = Array.from(
    new Set(rows.flatMap((r) => r.entry.skills ?? []).filter(Boolean))
  ).sort();
  const certOptionsFromApplication = Array.from(
    new Set(rows.flatMap((r) => r.entry.certifications ?? []).filter(Boolean))
  ).sort();
  const skillsOptionsFromResidence = Array.from(
    new Set(residenceRows.flatMap((r) => r.skills ?? []).filter(Boolean))
  ).sort();
  const certOptionsFromResidence = Array.from(
    new Set(residenceRows.flatMap((r) => r.certifications ?? []).filter(Boolean))
  ).sort();
  const skillsOptions = filterMode === 'application' ? skillsOptionsFromApplication : skillsOptionsFromResidence;
  const certOptions = filterMode === 'application' ? certOptionsFromApplication : certOptionsFromResidence;

  const cityKeysForSelectedMetro =
    metroFilter && metroFilter !== OTHER_METRO_VALUE
      ? getCityKeysForMetro(metroFilter, customMetros)
      : [];
  const filteredRows = rows.filter((row) => {
    const matchMetro = !metroFilter
      ? true
      : metroFilter === OTHER_METRO_VALUE
        ? (row.entry.metroKey && !metroOptions.includes(row.entry.metroKey))
        : (row.entry.metroKey && row.entry.metroKey === metroFilter) ||
          (row.entry.cityKey && cityKeysForSelectedMetro.includes(row.entry.cityKey));
    const matchArea =
      !areaFilter ||
      (Array.isArray(row.entry.subareaKeys) && row.entry.subareaKeys.includes(areaFilter));
    const matchCity =
      !cityFilter || (row.entry.cityKey && row.entry.cityKey === cityFilter);
    const matchCategory =
      !categoryFilter || row.entry.jobCategory === categoryFilter;
    const entrySkills = row.entry.skills ?? [];
    const entryCerts = row.entry.certifications ?? [];
    const matchSkills = selectedSkills.length === 0 || selectedSkills.some((s) => entrySkills.includes(s));
    const matchCerts = selectedCertifications.length === 0 || selectedCertifications.some((c) => entryCerts.includes(c));
    return matchMetro && matchArea && matchCity && matchCategory && matchSkills && matchCerts;
  });

  const sortedApplicationRows = [...filteredRows].sort((a, b) => {
    const mult = appSortOrder === 'asc' ? 1 : -1;
    switch (appSortBy) {
      case 'userName':
        return mult * (a.userName.localeCompare(b.userName));
      case 'jobTitle':
        return mult * ((a.entry.jobTitle || '').localeCompare(b.entry.jobTitle || ''));
      case 'worksiteCity':
        return mult * ((a.entry.worksiteCity || '').localeCompare(b.entry.worksiteCity || ''));
      case 'company':
        return mult * ((a.entry.companyName || '').localeCompare(b.entry.companyName || ''));
      case 'worksiteName':
        return mult * ((a.entry.worksiteName || '').localeCompare(b.entry.worksiteName || ''));
      case 'userCity':
        return mult * ((a.entry.userAddressCity || '').localeCompare(b.entry.userAddressCity || ''));
      case 'category':
        return mult * ((a.entry.jobCategory || '').localeCompare(b.entry.jobCategory || ''));
      case 'applied': {
        const ta = a.entry.timestamp?.toDate?.() ?? a.entry.timestamp ?? 0;
        const tb = b.entry.timestamp?.toDate?.() ?? b.entry.timestamp ?? 0;
        return mult * (Number(ta) - Number(tb));
      }
      case 'interview':
        return mult * ((a.interviewScore ?? -1) - (b.interviewScore ?? -1));
      case 'aiScore':
        return mult * ((a.aiScore ?? -1) - (b.aiScore ?? -1));
      default:
        return 0;
    }
  });

  const sortedResidenceRows = [...residenceRows].sort((a, b) => {
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

  const handleAppSort = (key: string) => {
    if (appSortBy === key) setAppSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    else {
      setAppSortBy(key);
      setAppSortOrder('asc');
    }
  };
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
  const paginatedApplicationRows = sortedApplicationRows.slice(
    tablePage * tableRowsPerPage,
    tablePage * tableRowsPerPage + tableRowsPerPage
  );
  const residenceTotalCount = sortedResidenceRows.length;
  const applicationUniqueUserCount = reportBuilt
    ? new Set(sortedApplicationRows.map((r) => r.userId)).size
    : 0;
  const selectedCount = selectAllResults
    ? filterMode === 'residence'
      ? residenceTotalCount
      : applicationUniqueUserCount
    : selectedIds.size;
  const allOnPageSelected =
    filterMode === 'residence'
      ? paginatedResidenceRows.length > 0 &&
        (selectAllResults || paginatedResidenceRows.every((r) => selectedIds.has(r.userId)))
      : paginatedApplicationRows.length > 0 &&
        (selectAllResults || paginatedApplicationRows.every((r) => selectedIds.has(r.userId)));
  const someOnPageSelected =
    filterMode === 'residence'
      ? !selectAllResults && paginatedResidenceRows.some((r) => selectedIds.has(r.userId))
      : !selectAllResults && paginatedApplicationRows.some((r) => selectedIds.has(r.userId));

  const handleSelectAllOnPage = () => {
    if (filterMode === 'residence') {
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
    } else {
      if (allOnPageSelected) {
        const next = new Set(selectedIds);
        paginatedApplicationRows.forEach((r) => next.delete(r.userId));
        setSelectedIds(next);
        setSelectAllResults(false);
      } else {
        const next = new Set(selectedIds);
        paginatedApplicationRows.forEach((r) => next.add(r.userId));
        setSelectedIds(next);
      }
    }
  };

  const handleSelectRow = (userId: string, checked: boolean) => {
    if (selectAllResults) {
      if (checked) return;
      if (filterMode === 'residence') {
        setSelectAllResults(false);
        setSelectedIds(new Set(sortedResidenceRows.filter((r) => r.userId !== userId).map((r) => r.userId)));
      } else {
        setSelectAllResults(false);
        setSelectedIds(new Set(sortedApplicationRows.filter((r) => r.userId !== userId).map((r) => r.userId)));
      }
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
    if (filterMode === 'residence') {
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
    }
    const rowsToUse = selectAllResults
      ? sortedApplicationRows
      : sortedApplicationRows.filter((r) => selectedIds.has(r.userId));
    const seen = new Set<string>();
    const recipients: MessageRecipient[] = [];
    const recipientUserIds: string[] = [];
    rowsToUse.forEach((r) => {
      if (seen.has(r.userId)) return;
      seen.add(r.userId);
      recipients.push({
        userId: r.userId,
        name: r.userName || r.userId,
      });
      recipientUserIds.push(r.userId);
    });
    return { recipients, recipientUserIds };
  }, [
    filterMode,
    selectAllResults,
    selectedIds,
    sortedResidenceRows,
    sortedApplicationRows,
  ]);

  const currentResultMemberIds =
    filterMode === 'application'
      ? Array.from(new Set(filteredRows.map((r) => r.userId)))
      : residenceRows.map((r) => r.userId);
  const hasResults = reportBuilt && currentResultMemberIds.length > 0;

  const handleSaveSmartSearch = async () => {
    const name = saveGroupName.trim();
    if (!name || !tenantId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const filters: Record<string, unknown> = {
        filterMode,
        metroFilter: metroFilter ?? null,
        areaFilter: areaFilter ?? null,
        cityFilter: cityFilter ?? null,
        categoryFilter: categoryFilter ?? null,
        selectedSkills,
        selectedCertifications,
      };
      if (filterMode === 'residence') {
        filters.residenceSubMode = residenceSubMode;
        if (residenceSubMode === 'radius') {
          filters.radiusAddress = radiusAddress;
          filters.radiusMiles = radiusMiles;
        }
      }
      const memberStatusById: Record<string, 'preferred' | 'member' | 'not_preferred'> = {};
      currentResultMemberIds.forEach((id) => {
        memberStatusById[id] = 'member';
      });
      const ref = collection(db, 'tenants', tenantId, 'savedSmartGroups');
      await addDoc(ref, {
        name,
        filterMode,
        filters,
        memberIds: currentResultMemberIds,
        memberStatusById,
        createdAt: serverTimestamp(),
        createdBy: authUser?.uid ?? null,
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

  const formatTimestamp = (ts: any) => {
    if (!ts) return '—';
    try {
      const date = ts?.toDate ? ts.toDate() : new Date(ts);
      return isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { dateStyle: 'short' });
    } catch {
      return '—';
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

  const getWorkStatusDisplay = (row: ResidenceRow): { label: string; color: 'default' | 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info'; sx?: any } => {
    const sl = String(row.securityLevel ?? '');
    switch (sl) {
      case '4': return { label: 'Hired', color: 'success' };
      case '3': return { label: 'Candidate', color: 'primary' };
      case '2': return { label: 'Applicant', color: 'info' };
      case '1': return { label: 'Dismissed', color: 'default' };
      case '0': return { label: 'Suspended', color: 'error' };
      default: return { label: sl || '—', color: 'default' };
    }
  };

  const renderResidenceAiScore = (row: ResidenceRow) => {
    const rawScore = row.scoreSummary?.aiScore;
    if (rawScore === undefined || rawScore === null || Number.isNaN(rawScore)) {
      return <Typography variant="body2" color="text.secondary">N/A</Typography>;
    }
    const relativeScore = getRelativeAiScore(rawScore, scoringDistribution);
    const displayScore = relativeScore != null ? relativeScore : Math.round(rawScore);
    const color: 'default' | 'success' | 'warning' | 'error' = displayScore >= 80 ? 'success' : displayScore >= 60 ? 'warning' : 'default';
    return (
      <Tooltip title={relativeScore != null ? `Raw: ${Math.round(rawScore)} (relative: ${displayScore})` : `AI: ${Math.round(rawScore)}`}>
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
          subtitle="Applicant pool by geography and industry (derived from applications)"
        />
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2, flexShrink: 0 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ mb: 2, flexShrink: 0 }}>
        <ToggleButtonGroup
          value={filterMode}
          exclusive
          onChange={handleFilterModeChange}
          size="small"
          sx={{ mb: 1 }}
        >
          <ToggleButton value="application" aria-label="By application location">
            <WorkIcon sx={{ mr: 0.5 }} /> By application location
          </ToggleButton>
          <ToggleButton value="residence" aria-label="By where users live">
            <LocationOnIcon sx={{ mr: 0.5 }} /> By where users live
          </ToggleButton>
        </ToggleButtonGroup>
        {filterMode === 'residence' && (
          <ToggleButtonGroup
            value={residenceSubMode}
            exclusive
            onChange={(_, v: ResidenceSubMode | null) => v && setResidenceSubMode(v)}
            size="small"
            sx={{ ml: 0 }}
          >
            <ToggleButton value="area">In an area</ToggleButton>
            <ToggleButton value="radius">Within radius of address</ToggleButton>
          </ToggleButtonGroup>
        )}
      </Box>

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          mb: 2,
          flexWrap: 'wrap',
        }}
      >
        {filterMode === 'application' && (
          <>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel id="smart-metro-label">Metro</InputLabel>
            <Select
              labelId="smart-metro-label"
              label="Metro"
              value={metroFilter ?? ''}
              onChange={(e) => {
                const v = e.target.value as string;
                setMetroFilter(v || null);
                setAreaFilter(null);
                setCityFilter(null);
              }}
            >
              <MenuItem value="">All metros</MenuItem>
              {metroOptions.map((m) => (
                <MenuItem key={m} value={m}>
                  {formatGeoLabel(m)}
                </MenuItem>
              ))}
              <MenuItem value={OTHER_METRO_VALUE}>Other (non-metro)</MenuItem>
            </Select>
          </FormControl>
          {metroFilter && (
            <IconButton size="small" onClick={clearMetro} aria-label="Clear metro" sx={{ p: 0.5 }}>
              <ClearIcon fontSize="small" />
            </IconButton>
          )}
        </Box>

        {metroFilter && metroFilter !== OTHER_METRO_VALUE && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel id="smart-area-label">Area</InputLabel>
              <Select
                labelId="smart-area-label"
                label="Area"
                value={areaFilter ?? ''}
                displayEmpty
                renderValue={(v) => (v === '' ? 'All Areas' : formatGeoLabel(v))}
                onChange={(e) => {
                  const v = e.target.value as string;
                  setAreaFilter(v || null);
                  setCityFilter(null);
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
            {areaFilter && (
              <IconButton size="small" onClick={clearArea} aria-label="Clear area" sx={{ p: 0.5 }}>
                <ClearIcon fontSize="small" />
              </IconButton>
            )}
          </Box>
        )}

        {metroFilter && metroFilter !== OTHER_METRO_VALUE && areaFilter && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel id="smart-city-label">City</InputLabel>
              <Select
                labelId="smart-city-label"
                label="City"
                value={cityFilter ?? ''}
                displayEmpty
                renderValue={(v) => (v === '' ? 'All Cities' : formatGeoLabel(v))}
                onChange={(e) => {
                  const v = e.target.value as string;
                  setCityFilter(v || null);
                }}
              >
                <MenuItem value="">All Cities</MenuItem>
                {cityOptions.map((c) => (
                  <MenuItem key={c} value={c}>
                    {formatGeoLabel(c)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {cityFilter && (
              <IconButton size="small" onClick={clearCity} aria-label="Clear city" sx={{ p: 0.5 }}>
                <ClearIcon fontSize="small" />
              </IconButton>
            )}
          </Box>
        )}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel id="smart-category-label" shrink>Category</InputLabel>
            <Select
              labelId="smart-category-label"
              label="Category"
              value={categoryFilter ?? ''}
              displayEmpty
              renderValue={(v) => (v === '' ? 'All Categories' : v)}
              onChange={(e) => {
                const v = e.target.value as string;
                setCategoryFilter(v || null);
              }}
            >
              <MenuItem value="">All Categories</MenuItem>
              {categoryOptions.map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {categoryFilter && (
            <IconButton size="small" onClick={clearCategory} aria-label="Clear category" sx={{ p: 0.5 }}>
              <ClearIcon fontSize="small" />
            </IconButton>
          )}
        </Box>
          </>
        )}

        {filterMode === 'residence' && residenceSubMode === 'area' && (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <FormControl size="small" sx={{ minWidth: 180 }}>
                <InputLabel id="res-metro-label">Metro</InputLabel>
                <Select
                  labelId="res-metro-label"
                  label="Metro"
                  value={metroFilter ?? ''}
                  onChange={(e) => {
                    const v = e.target.value as string;
                    setMetroFilter(v || null);
                    setAreaFilter(null);
                    setCityFilter(null);
                  }}
                >
                  <MenuItem value="">All metros</MenuItem>
                  {metroOptions.map((m) => (
                    <MenuItem key={m} value={m}>
                      {formatGeoLabel(m)}
                    </MenuItem>
                  ))}
                  <MenuItem value={OTHER_METRO_VALUE}>Other (non-metro)</MenuItem>
                </Select>
              </FormControl>
              {metroFilter && (
                <IconButton size="small" onClick={clearMetro} aria-label="Clear metro" sx={{ p: 0.5 }}>
                  <ClearIcon fontSize="small" />
                </IconButton>
              )}
            </Box>
            {metroFilter && metroFilter !== OTHER_METRO_VALUE && (
              <>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <FormControl size="small" sx={{ minWidth: 160 }}>
                    <InputLabel id="res-area-label">Area</InputLabel>
                    <Select
                      labelId="res-area-label"
                      label="Area"
                      value={areaFilter ?? ''}
                      displayEmpty
                      renderValue={(v) => (v === '' ? 'All Areas' : formatGeoLabel(v))}
                      onChange={(e) => {
                        const v = e.target.value as string;
                        setAreaFilter(v || null);
                        setCityFilter(null);
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
                  {areaFilter && (
                    <IconButton size="small" onClick={clearArea} aria-label="Clear area" sx={{ p: 0.5 }}>
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  )}
                </Box>
                {areaFilter && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <FormControl size="small" sx={{ minWidth: 160 }}>
                      <InputLabel id="res-city-label">City</InputLabel>
                      <Select
                        labelId="res-city-label"
                        label="City"
                        value={cityFilter ?? ''}
                        displayEmpty
                        renderValue={(v) => (v === '' ? 'All Cities' : formatGeoLabel(v))}
                        onChange={(e) => setCityFilter((e.target.value as string) || null)}
                      >
                        <MenuItem value="">All Cities</MenuItem>
                        {cityOptions.map((c) => (
                          <MenuItem key={c} value={c}>
                            {formatGeoLabel(c)}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    {cityFilter && (
                      <IconButton size="small" onClick={clearCity} aria-label="Clear city" sx={{ p: 0.5 }}>
                        <ClearIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Box>
                )}
              </>
            )}
          </>
        )}

        {filterMode === 'residence' && residenceSubMode === 'radius' && (
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
          </>
        )}

        <Autocomplete
          multiple
          size="small"
          options={skillsOptions}
          value={selectedSkills}
          onChange={(_, v) => setSelectedSkills(v)}
          renderInput={(params) => (
            <TextField {...params} label="Skills" placeholder={selectedSkills.length ? '' : 'Any'} />
          )}
          sx={{ minWidth: 180 }}
        />
        <Autocomplete
          multiple
          size="small"
          options={certOptions}
          value={selectedCertifications}
          onChange={(_, v) => setSelectedCertifications(v)}
          renderInput={(params) => (
            <TextField {...params} label="Certifications" placeholder={selectedCertifications.length ? '' : 'Any'} />
          )}
          sx={{ minWidth: 180 }}
        />

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
            Build
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
            Select filters and click <strong>Build</strong> to generate the report.
          </Typography>
        </Box>
      ) : (
        <>
      {filterMode === 'residence' ? (
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
                      <Typography color="text.secondary">No users match the selected residence filters.</Typography>
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
                            {row.scoreSummary?.interviewLastAt != null && typeof row.scoreSummary?.interviewLastScore10 === 'number' ? (
                              <Typography variant="body2">{formatDate(row.scoreSummary.interviewLastAt)} — {formatOneDecimal(row.scoreSummary.interviewLastScore10)}/10</Typography>
                            ) : (
                              <Typography variant="body2" color="text.secondary">—</Typography>
                            )}
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" color="text.secondary">—</Typography>
                          </TableCell>
                          <TableCell>
                            {skills.length === 0 ? (
                              <Typography variant="body2" color="text.secondary">—</Typography>
                            ) : (
                              <Tooltip title={skills.length <= 1 ? skills[0] : <Box component="span" sx={{ display: 'block', maxHeight: 320, overflowY: 'auto', py: 0.5 }}>{skills.map((s) => <Typography key={s} component="span" variant="body2" sx={{ display: 'block' }}>{s}</Typography>)}</Box>} placement="top" enterDelay={300} disableInteractive={false}>
                                <Typography variant="body2" noWrap component="span" sx={{ display: 'block' }}>{skills[0]}{skills.length > 1 ? '…' : ''}</Typography>
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
                  ? `All ${applicationUniqueUserCount} result${applicationUniqueUserCount === 1 ? '' : 's'} selected`
                  : `${selectedCount} selected`}
              </Typography>
              <Button size="small" onClick={handleClearSelection} sx={{ textTransform: 'none' }}>
                Clear selection
              </Button>
              {allOnPageSelected &&
                !selectAllResults &&
                applicationUniqueUserCount > paginatedApplicationRows.length && (
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={handleSelectAllResults}
                    sx={{ textTransform: 'none' }}
                  >
                    Select all {applicationUniqueUserCount} results
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
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }} sortDirection={appSortBy === 'userName' ? appSortOrder : false}>
                    <TableSortLabel active={appSortBy === 'userName'} direction={appSortBy === 'userName' ? appSortOrder : 'asc'} onClick={() => handleAppSort('userName')}>
                      Person
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }} sortDirection={appSortBy === 'jobTitle' ? appSortOrder : false}>
                    <TableSortLabel active={appSortBy === 'jobTitle'} direction={appSortBy === 'jobTitle' ? appSortOrder : 'asc'} onClick={() => handleAppSort('jobTitle')}>
                      Job Title
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }} sortDirection={appSortBy === 'worksiteCity' ? appSortOrder : false}>
                    <TableSortLabel active={appSortBy === 'worksiteCity'} direction={appSortBy === 'worksiteCity' ? appSortOrder : 'asc'} onClick={() => handleAppSort('worksiteCity')}>
                      Worksite City
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }} sortDirection={appSortBy === 'company' ? appSortOrder : false}>
                    <TableSortLabel active={appSortBy === 'company'} direction={appSortBy === 'company' ? appSortOrder : 'asc'} onClick={() => handleAppSort('company')}>
                      Company
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }} sortDirection={appSortBy === 'worksiteName' ? appSortOrder : false}>
                    <TableSortLabel active={appSortBy === 'worksiteName'} direction={appSortBy === 'worksiteName' ? appSortOrder : 'asc'} onClick={() => handleAppSort('worksiteName')}>
                      Worksite Name
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }} sortDirection={appSortBy === 'userCity' ? appSortOrder : false}>
                    <TableSortLabel active={appSortBy === 'userCity'} direction={appSortBy === 'userCity' ? appSortOrder : 'asc'} onClick={() => handleAppSort('userCity')}>
                      User City
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>Skills</TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }} sortDirection={appSortBy === 'category' ? appSortOrder : false}>
                    <TableSortLabel active={appSortBy === 'category'} direction={appSortBy === 'category' ? appSortOrder : 'asc'} onClick={() => handleAppSort('category')}>
                      Category
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }} sortDirection={appSortBy === 'applied' ? appSortOrder : false}>
                    <TableSortLabel active={appSortBy === 'applied'} direction={appSortBy === 'applied' ? appSortOrder : 'asc'} onClick={() => handleAppSort('applied')}>
                      Applied
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }} sortDirection={appSortBy === 'interview' ? appSortOrder : false}>
                    <TableSortLabel active={appSortBy === 'interview'} direction={appSortBy === 'interview' ? appSortOrder : 'asc'} onClick={() => handleAppSort('interview')}>
                      Interview
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>Group Status</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }} sortDirection={appSortBy === 'aiScore' ? appSortOrder : false}>
                    <TableSortLabel active={appSortBy === 'aiScore'} direction={appSortBy === 'aiScore' ? appSortOrder : 'asc'} onClick={() => handleAppSort('aiScore')}>
                      AI Score
                    </TableSortLabel>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedApplicationRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={14} align="center" sx={{ py: 4 }}>
                      <Typography color="text.secondary">
                        No Smart Groups data match the selected filters. Run the seed script or adjust filters.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedApplicationRows.map((row) => (
                      <TableRow
                        key={`${row.userId}-${row.applicationId}`}
                        hover
                        sx={{ cursor: 'pointer' }}
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
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <PersonIcon fontSize="small" color="action" />
                            {row.userName}
                          </Box>
                        </TableCell>
                        <TableCell>{row.entry.jobTitle || '—'}</TableCell>
                        <TableCell>{row.entry.worksiteCity || '—'}</TableCell>
                        <TableCell>{row.entry.companyName || '—'}</TableCell>
                        <TableCell>{row.entry.worksiteName || '—'}</TableCell>
                        <TableCell>{row.entry.userAddressCity || '—'}</TableCell>
                        <TableCell>
                          {Array.isArray(row.entry.skills) && row.entry.skills.length > 0 ? (
                            <Tooltip
                              title={
                                row.entry.skills.length <= 1
                                  ? row.entry.skills[0]
                                  : (
                                    <Box component="span" sx={{ display: 'block', maxHeight: 320, overflowY: 'auto', py: 0.5 }}>
                                      {row.entry.skills.map((skill) => (
                                        <Typography key={skill} component="span" variant="body2" sx={{ display: 'block' }}>
                                          {skill}
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
                                {row.entry.skills[0]}
                                {row.entry.skills.length > 1 ? '…' : ''}
                              </Typography>
                            </Tooltip>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip label={row.entry.jobCategory} size="small" variant="outlined" />
                        </TableCell>
                        <TableCell>{formatTimestamp(row.entry.timestamp)}</TableCell>
                        <TableCell align="right">
                          {row.interviewScore != null ? row.interviewScore.toFixed(1) : '—'}
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">—</Typography>
                        </TableCell>
                        <TableCell align="right">
                          {row.aiScore != null ? (
                            (() => {
                              const rel = getRelativeAiScore(row.aiScore!, scoringDistribution);
                              const display = rel != null ? rel : Math.round(row.aiScore!);
                              return (
                                <Tooltip title={rel != null ? `Raw: ${Math.round(row.aiScore!)} (relative: ${display})` : `AI: ${Math.round(row.aiScore!)}`}>
                                  <span>{display}</span>
                                </Tooltip>
                              );
                            })()
                          ) : '—'}
                        </TableCell>
                      </TableRow>
                    ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <StandardTablePagination
            count={sortedApplicationRows.length}
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
        </>
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
