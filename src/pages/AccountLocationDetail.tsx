/**
 * Account Location Detail – Account-style layout scoped to a single location.
 * URL: /accounts/:accountId/locations/:companyId/:locationId
 * Data flows down: Calendar (shifts at this location), Pricing (positions for this location),
 * Job Orders (at this location), Order Defaults (account defaults + location overrides).
 */

import React, { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardHeader,
  Button,
  CircularProgress,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  TextField,
  Checkbox,
  FormControl,
  FormControlLabel,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  IconButton,
  TableSortLabel,
  InputAdornment,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Avatar,
  Autocomplete,
  Switch,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  ListItemSecondaryAction,
  Divider,
  Stack,
  Alert,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Business as BusinessIcon,
  LocationOn as LocationOnIcon,
  CalendarMonth as CalendarIcon,
  AttachMoney as AttachMoneyIcon,
  Work as WorkIcon,
  Description as DescriptionIcon,
  Settings as SettingsIcon,
  Person as PersonIcon,
  Badge as BadgeIcon,
  GroupWork as GroupWorkIcon,
  Receipt as ReceiptIcon,
  Dashboard as DashboardIcon,
  Assessment as ReportsIcon,
  Add as AddIcon,
  Close as CloseIcon,
  Edit as EditIcon,
  Upload as UploadIcon,
  OpenInNew as OpenInNewIcon,
  Delete as DeleteIcon,
  Save as SaveIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, query, where, orderBy, limit, serverTimestamp, addDoc, deleteDoc, arrayUnion } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { p } from '../data/firestorePaths';
import type { RecruiterAccount, AccountPositionPricing } from '../types/recruiter/account';
import jobTitlesData from '../data/onetJobTitles.json';
import { getSutaRateByState, getFutaRateByState, normalizeStateCode, US_STATE_CODES } from '../utils/unemploymentRates';
import {
  buildWorkersCompRatesMapsFromSnapshot,
  pickWorkersCompJobTitleLookup,
  resolveWorkersCompModifierAccountId,
} from '../utils/workersCompRateMaps';
import PageHeader from '../components/PageHeader';
import AccountCalendarTab from '../components/recruiter/AccountCalendarTab';
import ActiveWorkersTable from '../components/recruiter/ActiveWorkersTable';
import AccountOrderDefaultsCard from '../components/recruiter/AccountOrderDefaultsCard';
import AccountOrderDetailsForm from '../components/recruiter/AccountOrderDetailsForm';
import MapWithMarkers from './UserProfile/components/AddressTab/MapWithMarkers';
import { geocodeAddress, getGeocodingErrorMessage } from '../utils/geocodeAddress';
import { canAccessAccountInvoicingTab } from '../utils/invoicingAccessControl';
import SafeAvatar from '../components/SafeAvatar';
import AddJobOrderModal from '../components/recruiter/AddJobOrderModal';
import StandardTablePagination from '../components/StandardTablePagination';
import FavoriteButton from '../components/FavoriteButton';
import { useFavorites } from '../hooks/useFavorites';
import { getJobOrderAge } from '../utils/dateUtils';
import { numberInputNoSpinnerSx } from '../utils/numberInputNoSpinner';

type LocationDoc = {
  name?: string;
  nickname?: string;
  code?: string;
  address?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  zipcode?: string;
  zipCode?: string;
  latitude?: number;
  longitude?: number;
  coordinates?: { lat?: number; lng?: number };
  type?: string;
  active?: boolean;
  [key: string]: unknown;
};

type EntityOption = { id: string; name: string };
type LaborPoolOption = { id: string; label: string; type: 'userGroup' | 'savedSmartGroup'; memberCount?: number };

type LocationJobOrder = {
  id: string;
  jobOrderName?: string;
  jobOrderNumber?: number;
  jobTitle?: string;
  status?: string;
  startDate?: string;
  workersNeeded?: number;
  headcountFilled?: number;
  recruiterName?: string;
  createdAt?: string;
};

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div role="tabpanel" hidden={value !== index}>
      {value === index && <Box sx={{ px: 2, pb: 2 }}>{children}</Box>}
    </div>
  );
}

export default function AccountLocationDetail() {
  const { accountId, locationId } = useParams<{ accountId: string; locationId: string }>();
  const [searchParams] = useSearchParams();
  const companyIdFromQuery = searchParams.get('companyId');
  const navigate = useNavigate();
  const { tenantId, user, currentClaimsSecurityLevel, securityLevel } = useAuth();
  const canAccessInvoicing = canAccessAccountInvoicingTab(currentClaimsSecurityLevel ?? securityLevel);
  const [account, setAccount] = useState<RecruiterAccount | null>(null);
  const [locationDoc, setLocationDoc] = useState<LocationDoc | null>(null);
  const [resolvedCompanyId, setResolvedCompanyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tabValue, setTabValue] = useState(0);
  const [jobOrdersAtLocation, setJobOrdersAtLocation] = useState<LocationJobOrder[]>([]);
  const [jobOrdersLoading, setJobOrdersLoading] = useState(false);
  const [jobOrdersStatusFilter, setJobOrdersStatusFilter] = useState<string>('');
  const [jobOrdersSortField, setJobOrdersSortField] = useState<string>('createdAt');
  const [jobOrdersSortDirection, setJobOrdersSortDirection] = useState<'asc' | 'desc'>('desc');
  const [jobOrdersSearch, setJobOrdersSearch] = useState('');
  const [jobOrdersPage, setJobOrdersPage] = useState(0);
  const [jobOrdersRowsPerPage, setJobOrdersRowsPerPage] = useState(25);
  const [showNewJobOrderModal, setShowNewJobOrderModal] = useState(false);
  const [locationDefaults, setLocationDefaults] = useState<Record<string, unknown> | null>(null);
  const [locationDefaultsLoading, setLocationDefaultsLoading] = useState(false);
  const [locationDefaultsSaving, setLocationDefaultsSaving] = useState(false);
  const [locationOverrideUniform, setLocationOverrideUniform] = useState('');
  const [locationPricingNotes, setLocationPricingNotes] = useState('');
  const [locationPricingPositions, setLocationPricingPositions] = useState<AccountPositionPricing[]>([]);
  const [locationPricingNotesSaving, setLocationPricingNotesSaving] = useState(false);
  const [locationPricingSaving, setLocationPricingSaving] = useState(false);
  const [locationPricingSutaFutaState, setLocationPricingSutaFutaState] = useState('');
  const [wcRatesByKey, setWcRatesByKey] = useState<Record<string, number>>({});
  const [wcJobTitleMaps, setWcJobTitleMaps] = useState<{
    byStateAndJobTitle: Record<string, { code: string; rate: number }>;
    byStateJobTitleAndModifierAccount: Record<string, { code: string; rate: number }>;
  }>({ byStateAndJobTitle: {}, byStateJobTitleAndModifierAccount: {} });
  const wcModifierAccountIdForLocationPricing = useMemo(
    () => resolveWorkersCompModifierAccountId(account),
    [account],
  );
  const [laborPoolOptions, setLaborPoolOptions] = useState<LaborPoolOption[]>([]);
  const [jobOrderApplicantCounts, setJobOrderApplicantCounts] = useState<Record<string, number>>({});
  const [invoicingSubView, setInvoicingSubView] = useState<'invoices' | 'ar' | 'payments' | 'mapping'>('invoices');
  const [orderDefaultsSubView, setOrderDefaultsSubView] = useState<'staffInstructions' | 'orderDetails'>('staffInstructions');
  const [entityOptions, setEntityOptions] = useState<EntityOption[]>([]);
  /** Child account docs may omit hiringEntityId; inherit from parent for pricing / payroll tax UI. */
  const [inheritedAccountHiringEntityId, setInheritedAccountHiringEntityId] = useState<string | null>(null);
  /** National parent doc for location Order Details (national → child account → location_defaults). */
  const [orderDefaultsInheritanceParent, setOrderDefaultsInheritanceParent] = useState<RecruiterAccount | null>(null);
  const [locationDefaultRules, setLocationDefaultRules] = useState({
    replacingExistingAgency: false,
    rolloverExistingStaff: false,
    timeclockSystem: '',
    attendancePolicy: '',
    noShowPolicy: '',
    overtimePolicy: '',
    callOffPolicy: '',
    injuryHandlingPolicy: '',
    disciplinePolicy: '',
  });
  const [locationDefaultBilling, setLocationDefaultBilling] = useState({
    poRequired: false,
    paymentTerms: '',
    invoiceDeliveryMethod: '',
    invoiceFrequency: '',
    sendInvoicesTo: [] as string[],
    billingNotes: '',
  });
  const [locationSettingsSaving, setLocationSettingsSaving] = useState(false);
  const [locationActiveSaving, setLocationActiveSaving] = useState(false);
  const [mapCoords, setMapCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [mapCoordsLoading, setMapCoordsLoading] = useState(false);
  const [mapGeocodeError, setMapGeocodeError] = useState<string | null>(null);
  const [mapGeocodeRetry, setMapGeocodeRetry] = useState(0);
  const [contactsAtLocation, setContactsAtLocation] = useState<Array<{ id: string; firstName?: string; lastName?: string; fullName?: string; email?: string; phone?: string; jobTitle?: string; locationId?: string; linkedinUrl?: string; [key: string]: unknown }>>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsSearch, setContactsSearch] = useState('');
  const [showAddContactDialog, setShowAddContactDialog] = useState(false);
  const [addContactForm, setAddContactForm] = useState({ firstName: '', lastName: '', email: '', phone: '', jobTitle: '', contactType: 'Unknown', linkedInUrl: '', tags: [] as string[], isActive: true, notes: '' });
  const [addContactSaving, setAddContactSaving] = useState(false);
  const [addContactError, setAddContactError] = useState<string | null>(null);
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [locationUploads, setLocationUploads] = useState<Array<{ id: string; name: string; fileName: string; url: string; storagePath: string; createdAt: unknown }>>([]);
  const [uploadLabel, setUploadLabel] = useState('');
  const [uploading, setUploading] = useState(false);
  const [deleteConfirmUploadId, setDeleteConfirmUploadId] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploadFileKey, setUploadFileKey] = useState(0);
  const [sidebarCompanyName, setSidebarCompanyName] = useState<string>('');
  const [manageLocationContactsOpen, setManageLocationContactsOpen] = useState(false);
  const [companyContactsList, setCompanyContactsList] = useState<Array<{ id: string; fullName?: string; firstName?: string; lastName?: string; companyId?: string; locationId?: string; associations?: { companies?: string[]; locations?: string[] } }>>([]);
  const [companyContactsLoading, setCompanyContactsLoading] = useState(false);
  const [locationContactsModalSaving, setLocationContactsModalSaving] = useState(false);
  const [selectedLocationContactOption, setSelectedLocationContactOption] = useState<{ id: string; label: string } | null>(null);
  const [accountCompaniesOptions, setAccountCompaniesOptions] = useState<Array<{ id: string; companyName?: string; name?: string; label?: string }>>([]);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Load company names for account's associated companies (for Job Order modal dropdown).
  useEffect(() => {
    const companyIds = account?.associations?.companyIds;
    if (!tenantId || !companyIds?.length) {
      setAccountCompaniesOptions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const options: Array<{ id: string; companyName?: string; name?: string; label?: string }> = [];
      for (const id of companyIds) {
        if (cancelled) return;
        try {
          const companyRef = doc(db, p.accounts(tenantId), id);
          const snap = await getDoc(companyRef);
          const name = snap.exists() ? (snap.get('companyName') ?? snap.get('name') ?? id) : id;
          options.push({ id, companyName: name, name, label: name });
        } catch {
          options.push({ id, companyName: id, name: id, label: id });
        }
      }
      if (!cancelled && isMounted.current) setAccountCompaniesOptions(options);
    })();
    return () => { cancelled = true; };
  }, [tenantId, account?.associations?.companyIds]);

  useEffect(() => {
    if (!tenantId || !accountId || !locationId) {
      setLoading(false);
      setError('Missing account or location parameters.');
      return;
    }
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const accountRef = doc(db, p.recruiterAccount(tenantId, accountId));
        const accountSnap = await getDoc(accountRef);
        if (!isMounted.current) return;
        if (!accountSnap.exists()) {
          setError('Account not found.');
          setAccount(null);
          setLocationDoc(null);
          setLoading(false);
          return;
        }
        const accountData = accountSnap.data();
        const acc: RecruiterAccount = {
          id: accountSnap.id,
          name: accountData?.name ?? '',
          active: accountData?.active !== false,
          ...accountData,
          associations: accountData?.associations ?? {},
        } as RecruiterAccount;
        setAccount(acc);

        const companyId = companyIdFromQuery || (acc.associations?.locations as Array<{ companyId: string; locationId: string }> | undefined)?.find(
          (ref) => ref.locationId === locationId
        )?.companyId;
        if (!companyId) {
          setResolvedCompanyId(null);
          setLocationDoc(null);
          setError('Location not linked to this account. Use the account Locations tab to open a location.');
          setLoading(false);
          return;
        }
        setResolvedCompanyId(companyId);
        const locRef = doc(collection(db, p.accountLocations(tenantId, companyId)), locationId);
        const locSnap = await getDoc(locRef);
        if (!isMounted.current) return;
        if (locSnap.exists()) {
          setLocationDoc(locSnap.data() as LocationDoc);
        } else {
          setLocationDoc(null);
          setError('Location not found.');
        }
      } catch (err) {
        if (isMounted.current) {
          setError('Failed to load account or location.');
          setAccount(null);
          setLocationDoc(null);
          setResolvedCompanyId(null);
        }
      } finally {
        if (isMounted.current) setLoading(false);
      }
    })();
  }, [tenantId, accountId, locationId, companyIdFromQuery]);

  useEffect(() => {
    if (!tenantId || !account) {
      setInheritedAccountHiringEntityId(null);
      return;
    }
    if (account.hiringEntityId) {
      setInheritedAccountHiringEntityId(null);
      return;
    }
    const pid = account.parentAccountId;
    if (!pid || typeof pid !== 'string' || !pid.trim()) {
      setInheritedAccountHiringEntityId(null);
      return;
    }
    let cancelled = false;
    getDoc(doc(db, p.recruiterAccount(tenantId, pid.trim())))
      .then((snap) => {
        if (cancelled || !isMounted.current) return;
        const hid = snap.exists() ? (snap.data() as { hiringEntityId?: string | null })?.hiringEntityId : null;
        setInheritedAccountHiringEntityId(typeof hid === 'string' && hid.trim() ? hid.trim() : null);
      })
      .catch(() => {
        if (!cancelled && isMounted.current) setInheritedAccountHiringEntityId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, account?.id, account?.hiringEntityId, account?.parentAccountId]);

  useEffect(() => {
    if (!tenantId || !account?.parentAccountId || !String(account.parentAccountId).trim()) {
      setOrderDefaultsInheritanceParent(null);
      return;
    }
    let cancelled = false;
    getDoc(doc(db, p.recruiterAccount(tenantId, String(account.parentAccountId).trim())))
      .then((snap) => {
        if (cancelled || !isMounted.current) return;
        setOrderDefaultsInheritanceParent(snap.exists() ? (snap.data() as RecruiterAccount) : null);
      })
      .catch(() => {
        if (!cancelled && isMounted.current) setOrderDefaultsInheritanceParent(null);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, account?.parentAccountId]);

  const locationKey = resolvedCompanyId && locationId ? `${resolvedCompanyId}_${locationId}`.replace(/\//g, '_') : '';

  const fetchLocationJobOrders = useCallback(async () => {
    if (!tenantId || !resolvedCompanyId || !locationId) return;
    setJobOrdersLoading(true);
    const ref = collection(db, p.jobOrders(tenantId));
    // Job orders store location as worksiteId (same id as this location); query by worksiteId so orders created from this location appear
    const q = query(
      ref,
      where('companyId', '==', resolvedCompanyId),
      where('worksiteId', '==', locationId)
    );
    try {
      const snap = await getDocs(q);
      if (!isMounted.current) return;
      const list: LocationJobOrder[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          jobOrderName: data.jobOrderName ?? data.jobTitle ?? data.title ?? d.id,
          jobOrderNumber: data.jobOrderNumber,
          jobTitle: data.jobTitle,
          status: data.status,
          startDate: data.startDate,
          workersNeeded: data.workersNeeded,
          headcountFilled: data.headcountFilled,
          recruiterName: data.recruiterName,
          createdAt: data.createdAt?.toMillis?.() ? new Date(data.createdAt.toMillis()).toISOString() : data.createdAt,
        };
      });
      list.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
      setJobOrdersAtLocation(list);
    } catch {
      if (isMounted.current) setJobOrdersAtLocation([]);
    } finally {
      if (isMounted.current) setJobOrdersLoading(false);
    }
  }, [tenantId, resolvedCompanyId, locationId]);

  useEffect(() => {
    if (!tenantId || !resolvedCompanyId || !locationId) {
      setJobOrdersAtLocation([]);
      return;
    }
    fetchLocationJobOrders();
  }, [tenantId, resolvedCompanyId, locationId, fetchLocationJobOrders]);

  const { isFavorite: isJobOrderFavorite, toggleFavorite: toggleJobOrderFavorite } = useFavorites('jobOrders');

  const getJobOrderStatusColor = (status: string) => {
    const s = status?.toLowerCase();
    if (s === 'open') return 'success';
    if (s === 'on-hold' || s === 'on hold' || s === 'onhold') return 'warning';
    if (s === 'cancelled' || s === 'canceled') return 'error';
    if (s === 'filled' || s === 'closed') return 'info';
    if (s === 'completed' || s === 'finished') return 'default';
    if (s === 'pending' || s === 'draft') return 'secondary';
    return 'default';
  };

  const formatJobOrderNumber = (num: number | undefined) => (num != null ? String(num).padStart(4, '0') : '—');

  const filteredLocationJobOrders = useMemo(() => {
    let list = [...jobOrdersAtLocation];
    if (jobOrdersStatusFilter) {
      list = list.filter((jo) => (jo.status ?? '').toLowerCase() === jobOrdersStatusFilter.toLowerCase());
    }
    if (jobOrdersSearch.trim()) {
      const q = jobOrdersSearch.trim().toLowerCase();
      list = list.filter(
        (jo) =>
          (jo.jobOrderName ?? '').toLowerCase().includes(q) ||
          (jo.jobOrderNumber != null && String(jo.jobOrderNumber).includes(q)) ||
          (jo.jobTitle ?? '').toLowerCase().includes(q)
      );
    }
    const dir = jobOrdersSortDirection === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let aVal: string | number = '';
      let bVal: string | number = '';
      if (jobOrdersSortField === 'jobOrderNumber') {
        aVal = a.jobOrderNumber ?? 0;
        bVal = b.jobOrderNumber ?? 0;
        return dir * (Number(aVal) - Number(bVal));
      }
      if (jobOrdersSortField === 'createdAt') {
        aVal = a.createdAt ?? '';
        bVal = b.createdAt ?? '';
        return dir * (String(aVal).localeCompare(String(bVal)));
      }
      if (jobOrdersSortField === 'recruiterName') {
        aVal = (a.recruiterName ?? '').toLowerCase();
        bVal = (b.recruiterName ?? '').toLowerCase();
        return dir * String(aVal).localeCompare(String(bVal));
      }
      return 0;
    });
    return list;
  }, [jobOrdersAtLocation, jobOrdersStatusFilter, jobOrdersSearch, jobOrdersSortField, jobOrdersSortDirection]);

  const paginatedLocationJobOrders = useMemo(() => {
    const start = jobOrdersPage * jobOrdersRowsPerPage;
    return filteredLocationJobOrders.slice(start, start + jobOrdersRowsPerPage);
  }, [filteredLocationJobOrders, jobOrdersPage, jobOrdersRowsPerPage]);

  useEffect(() => {
    if (!tenantId || !accountId || !locationKey) {
      setLocationDefaults(null);
      return;
    }
    setLocationDefaultsLoading(true);
    const ref = doc(db, p.recruiterAccountLocationDefaults(tenantId, accountId, locationKey));
    getDoc(ref)
      .then((snap) => {
        if (!isMounted.current) return;
        setLocationDefaults(snap.exists() ? snap.data() ?? null : null);
      })
      .catch(() => {
        if (isMounted.current) setLocationDefaults(null);
      })
      .finally(() => {
        if (isMounted.current) setLocationDefaultsLoading(false);
      });
  }, [tenantId, accountId, locationKey]);

  const refreshLocationDefaults = useCallback(async () => {
    if (!tenantId || !accountId || !locationKey) return;
    const ref = doc(db, p.recruiterAccountLocationDefaults(tenantId, accountId, locationKey));
    const snap = await getDoc(ref);
    if (isMounted.current) setLocationDefaults(snap.exists() ? snap.data() ?? null : null);
  }, [tenantId, accountId, locationKey]);

  const fullAddressString = [
    locationDoc?.address || locationDoc?.street,
    locationDoc?.city,
    locationDoc?.state,
    locationDoc?.zip || locationDoc?.zipcode || locationDoc?.zipCode,
  ]
    .filter(Boolean)
    .map((s) => (typeof s === 'string' ? s.trim() : s))
    .filter(Boolean)
    .join(', ')
    .trim();
  const storedCoords =
    locationDoc?.latitude != null && locationDoc?.longitude != null
      ? { lat: locationDoc.latitude, lng: locationDoc.longitude }
      : locationDoc?.coordinates?.lat != null && locationDoc?.coordinates?.lng != null
        ? { lat: locationDoc.coordinates!.lat!, lng: locationDoc.coordinates!.lng! }
        : null;
  useEffect(() => {
    if (storedCoords) {
      if (isMounted.current) {
        setMapCoords(storedCoords);
        setMapGeocodeError(null);
      }
      setMapCoordsLoading(false);
      return;
    }
    if (!fullAddressString.trim()) {
      setMapCoords(null);
      setMapGeocodeError(null);
      return;
    }
    setMapCoordsLoading(true);
    setMapGeocodeError(null);
    geocodeAddress(fullAddressString)
      .then((coords) => {
        if (isMounted.current) {
          setMapCoords(coords);
          setMapGeocodeError(null);
        }
      })
      .catch((err) => {
        if (isMounted.current) {
          setMapCoords(null);
          setMapGeocodeError(getGeocodingErrorMessage(err));
        }
      })
      .finally(() => {
        if (isMounted.current) setMapCoordsLoading(false);
      });
  }, [fullAddressString, storedCoords?.lat, storedCoords?.lng, mapGeocodeRetry]);

  useEffect(() => {
    if (!tenantId) return;
    getDocs(collection(db, p.entities(tenantId)))
      .then((snap) => {
        if (!isMounted.current) return;
        const list = snap.docs.map((d) => {
          const dta = d.data() as { name?: string };
          return { id: d.id, name: dta.name || d.id };
        }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setEntityOptions(list);
      })
      .catch(() => {});
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId || !resolvedCompanyId) {
      setSidebarCompanyName('');
      return;
    }
    getDoc(doc(db, p.account(tenantId, resolvedCompanyId)))
      .then((snap) => {
        if (!isMounted.current) return;
        const data = snap.exists() ? snap.data() : null;
        const name = (data?.companyName ?? data?.name ?? '').trim() || '—';
        setSidebarCompanyName(name);
      })
      .catch(() => { if (isMounted.current) setSidebarCompanyName(''); });
  }, [tenantId, resolvedCompanyId]);

  useEffect(() => {
    const orderDefaults = (locationDefaults as any)?.orderDefaults;
    const staffInstructions = orderDefaults?.staffInstructions;
    const uniform = staffInstructions?.uniform;
    setLocationOverrideUniform(uniform && typeof uniform.text === 'string' ? uniform.text : '');
  }, [locationDefaults]);

  // Effective location pricing: location override if present, else account (trickle down). Sync into local state when account or locationDefaults change.
  useEffect(() => {
    const notes = (locationDefaults as any)?.pricingNotes !== undefined && (locationDefaults as any).pricingNotes !== null
      ? (locationDefaults as any).pricingNotes
      : (account?.pricing?.pricingNotes ?? '');
    const positions = Array.isArray((locationDefaults as any)?.pricing?.positions)
      ? (locationDefaults as any).pricing.positions
      : (Array.isArray(account?.pricing?.positions) ? account!.pricing!.positions : []);
    setLocationPricingNotes(typeof notes === 'string' ? notes : '');
    setLocationPricingPositions(
      positions.map((p: any) => ({ ...p, id: p.id || `pos-${Math.random().toString(36).slice(2)}` }))
    );
  }, [account?.pricing?.pricingNotes, account?.pricing?.positions, locationDefaults]);

  useEffect(() => {
    if (locationDoc?.state && !locationPricingSutaFutaState) {
      setLocationPricingSutaFutaState(normalizeStateCode(locationDoc.state) || '');
    }
  }, [locationDoc?.state, locationPricingSutaFutaState]);

  useEffect(() => {
    if (!tenantId) return;
    getDocs(collection(db, p.workersCompRates(tenantId)))
      .then((snap) => {
        if (!isMounted.current) return;
        const built = buildWorkersCompRatesMapsFromSnapshot(snap);
        setWcRatesByKey(built.wcRatesByStateAndCode);
        setWcJobTitleMaps({
          byStateAndJobTitle: built.byStateAndJobTitle,
          byStateJobTitleAndModifierAccount: built.byStateJobTitleAndModifierAccount,
        });
      })
      .catch(() => {
        if (isMounted.current) {
          setWcRatesByKey({});
          setWcJobTitleMaps({ byStateAndJobTitle: {}, byStateJobTitleAndModifierAccount: {} });
        }
      });
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    Promise.all([
      getDocs(collection(db, 'tenants', tenantId, 'userGroups')),
      getDocs(collection(db, 'tenants', tenantId, 'savedSmartGroups')),
    ])
      .then(([userGroupsSnap, savedSmartSnap]) => {
        if (!isMounted.current) return;
        const ugMap = new Map<string, LaborPoolOption>();
        userGroupsSnap.docs.forEach((d) => {
          const dta = d.data();
          const label = (dta.name || dta.title || dta.groupName || d.id).trim() || d.id;
          const memberIds = dta.memberIds ?? [];
          ugMap.set(d.id, { id: d.id, label, type: 'userGroup', memberCount: Array.isArray(memberIds) ? memberIds.length : 0 });
        });
        const ugList = [...ugMap.values()].sort((a, b) => (a.label || '').localeCompare(b.label || ''));
        const sgMap = new Map<string, LaborPoolOption>();
        savedSmartSnap.docs.forEach((d) => {
          const dta = d.data();
          const label = (dta.name || dta.label || d.id).trim();
          const memberCount = typeof dta.memberCount === 'number' ? dta.memberCount : (Array.isArray(dta.memberIds) ? dta.memberIds.length : undefined);
          sgMap.set(d.id, { id: d.id, label, type: 'savedSmartGroup', memberCount });
        });
        setLaborPoolOptions([...ugList, ...sgMap.values()]);
      })
      .catch(() => { if (isMounted.current) setLaborPoolOptions([]); });
  }, [tenantId]);

  // Load unique applicant counts per job order at this location. Mirrors
  // `RecruiterJobOrderDetail.fetchApplicants()` — applications can link via
  // `jobOrderId`, `jobId` (a connected jobs-board post), or `postId` (legacy).
  // Counting only `jobOrderId` undercounts. Dedupes by `userId` per job order.
  useEffect(() => {
    if (!tenantId || jobOrdersAtLocation.length === 0) {
      setJobOrderApplicantCounts({});
      return;
    }
    const ids = jobOrdersAtLocation.map((jo) => jo.id).filter(Boolean);
    if (ids.length === 0) {
      setJobOrderApplicantCounts({});
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const applicationsRef = collection(db, p.applications(tenantId));
        const postsRef = collection(db, 'tenants', tenantId, 'job_postings');
        const IN_LIMIT = 30;

        // Build postId → jobOrderId reverse map from connected jobs-board posts
        const postToJobOrder = new Map<string, string>();
        const allPostIds: string[] = [];
        for (let i = 0; i < ids.length; i += 10) {
          const chunk = ids.slice(i, i + 10);
          const snap = await getDocs(query(postsRef, where('jobOrderId', 'in', chunk)));
          snap.docs.forEach((d) => {
            const data = d.data() as { jobOrderId?: string };
            if (data.jobOrderId) {
              postToJobOrder.set(d.id, data.jobOrderId);
              allPostIds.push(d.id);
            }
          });
        }

        const setsByJo = new Map<string, Set<string>>();
        const keyFor = (d: { userId?: string; candidateId?: string }, docId: string): string =>
          (typeof d.userId === 'string' && d.userId.trim()) ||
          (typeof d.candidateId === 'string' && d.candidateId.trim()) ||
          docId;
        const addFor = (joId: string, key: string) => {
          let set = setsByJo.get(joId);
          if (!set) {
            set = new Set<string>();
            setsByJo.set(joId, set);
          }
          set.add(key);
        };

        // 1) Apps with jobOrderId set directly
        for (let i = 0; i < ids.length; i += IN_LIMIT) {
          const chunk = ids.slice(i, i + IN_LIMIT);
          const snap = await getDocs(query(applicationsRef, where('jobOrderId', 'in', chunk)));
          snap.docs.forEach((d) => {
            const data = d.data() as { jobOrderId?: string; userId?: string; candidateId?: string };
            if (!data.jobOrderId) return;
            addFor(data.jobOrderId, keyFor(data, d.id));
          });
        }

        // 2) + 3) Apps linked via a connected jobs-board post (jobId or postId)
        if (allPostIds.length > 0) {
          for (let i = 0; i < allPostIds.length; i += IN_LIMIT) {
            const chunk = allPostIds.slice(i, i + IN_LIMIT);
            const [byJobId, byPostId] = await Promise.all([
              getDocs(query(applicationsRef, where('jobId', 'in', chunk))),
              getDocs(query(applicationsRef, where('postId', 'in', chunk))),
            ]);
            [byJobId, byPostId].forEach((snap) => {
              snap.docs.forEach((d) => {
                const data = d.data() as {
                  jobId?: string;
                  postId?: string;
                  userId?: string;
                  candidateId?: string;
                };
                const postRef = data.jobId || data.postId;
                if (!postRef) return;
                const joId = postToJobOrder.get(postRef);
                if (!joId) return;
                addFor(joId, keyFor(data, d.id));
              });
            });
          }
        }

        if (cancelled || !isMounted.current) return;
        const next: Record<string, number> = {};
        ids.forEach((id) => {
          next[id] = setsByJo.get(id)?.size ?? 0;
        });
        setJobOrderApplicantCounts(next);
      } catch (err) {
        console.warn('AccountLocationDetail: applicant count fetch failed', err);
        if (!cancelled && isMounted.current) setJobOrderApplicantCounts({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId, jobOrdersAtLocation]);

  const laborPoolTableRows = useMemo(() => {
    const assoc = account?.associations ?? {};
    const uids = assoc.userGroupIds ?? [];
    const sids = assoc.savedSmartGroupIds ?? [];
    const groupRows: Array<{ kind: 'userGroup' | 'savedSmartGroup'; id: string; label: string; href: string; count?: number }> = [
      ...uids.map((id) => {
        const o = laborPoolOptions.find((x) => x.type === 'userGroup' && x.id === id);
        return { kind: 'userGroup' as const, id, label: o?.label ?? id, href: `/usergroups/${id}`, count: o?.memberCount };
      }),
      ...sids.map((id) => {
        const o = laborPoolOptions.find((x) => x.type === 'savedSmartGroup' && x.id === id);
        return { kind: 'savedSmartGroup' as const, id, label: o?.label ?? id, href: `/users/my-smart-groups/${id}`, count: o?.memberCount };
      }),
    ];
    const applicantRows = jobOrdersAtLocation.map((jo) => ({
      kind: 'jobOrderApplicants' as const,
      id: jo.id,
      label: jo.jobOrderName ?? jo.id,
      href: `/jobs/job-orders/${jo.id}?tab=applications`,
    }));
    return [...groupRows, ...applicantRows];
  }, [account?.associations, laborPoolOptions, jobOrdersAtLocation]);

  useEffect(() => {
    const locRules = (locationDefaults as any)?.rules;
    const locBilling = (locationDefaults as any)?.billing;
    const accRules = account?.defaults?.rules;
    const accBilling = account?.defaults?.billing;
    const rulesSource = (locRules && typeof locRules === 'object') ? locRules : (accRules && typeof accRules === 'object') ? accRules : null;
    const billingSource = (locBilling && typeof locBilling === 'object') ? locBilling : (accBilling && typeof accBilling === 'object') ? accBilling : null;
    if (rulesSource) {
      setLocationDefaultRules({
        replacingExistingAgency: !!rulesSource.replacingExistingAgency,
        rolloverExistingStaff: !!rulesSource.rolloverExistingStaff,
        timeclockSystem: rulesSource.timeclockSystem ?? '',
        attendancePolicy: rulesSource.attendancePolicy ?? '',
        noShowPolicy: rulesSource.noShowPolicy ?? '',
        overtimePolicy: rulesSource.overtimePolicy ?? '',
        callOffPolicy: rulesSource.callOffPolicy ?? '',
        injuryHandlingPolicy: rulesSource.injuryHandlingPolicy ?? '',
        disciplinePolicy: rulesSource.disciplinePolicy ?? '',
      });
    }
    if (billingSource) {
      setLocationDefaultBilling({
        poRequired: !!billingSource.poRequired,
        paymentTerms: billingSource.paymentTerms ?? '',
        invoiceDeliveryMethod: billingSource.invoiceDeliveryMethod ?? '',
        invoiceFrequency: billingSource.invoiceFrequency ?? '',
        sendInvoicesTo: Array.isArray(billingSource.sendInvoicesTo) ? billingSource.sendInvoicesTo : [],
        billingNotes: billingSource.billingNotes ?? '',
      });
    }
  }, [account?.defaults?.rules, account?.defaults?.billing, locationDefaults]);

  useEffect(() => {
    if (!tenantId || !resolvedCompanyId) {
      setCompanyContactsList([]);
      return;
    }
    if (!manageLocationContactsOpen) return;
    setCompanyContactsLoading(true);
    const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
    const q = query(contactsRef, where('companyId', '==', resolvedCompanyId));
    getDocs(q)
      .then((snap) => {
        if (!isMounted.current) return;
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as { id: string; fullName?: string; firstName?: string; lastName?: string; companyId?: string; locationId?: string; associations?: { companies?: string[]; locations?: string[] } }));
        list.sort((a, b) => ((a.fullName || '') || ((a.firstName || '') + (a.lastName || ''))).localeCompare((b.fullName || '') || ((b.firstName || '') + (b.lastName || ''))));
        setCompanyContactsList(list);
      })
      .catch(() => { if (isMounted.current) setCompanyContactsList([]); })
      .finally(() => { if (isMounted.current) setCompanyContactsLoading(false); });
  }, [tenantId, resolvedCompanyId, manageLocationContactsOpen]);

  useEffect(() => {
    if (!tenantId || !resolvedCompanyId || !locationId) {
      setContactsAtLocation([]);
      return;
    }
    setContactsLoading(true);
    const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
    const q = query(
      contactsRef,
      where('companyId', '==', resolvedCompanyId),
      where('locationId', '==', locationId)
    );
    getDocs(q)
      .then((snap) => {
        if (!isMounted.current) return;
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
        list.sort((a, b) => ((a.firstName || '') + (a.lastName || '')).localeCompare((b.firstName || '') + (b.lastName || '')));
        setContactsAtLocation(list);
      })
      .catch(() => { if (isMounted.current) setContactsAtLocation([]); })
      .finally(() => { if (isMounted.current) setContactsLoading(false); });
  }, [tenantId, resolvedCompanyId, locationId]);

  const loadLocationUploads = React.useCallback(async () => {
    if (!tenantId || !accountId || !locationKey) return;
    const uploadsRef = collection(db, p.recruiterAccountLocationUploads(tenantId, accountId));
    const q = query(uploadsRef, where('locationKey', '==', locationKey), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: data.name || '—',
        fileName: data.fileName || '—',
        url: data.url || '',
        storagePath: data.storagePath || '',
        createdAt: data.createdAt,
      };
    });
    if (isMounted.current) setLocationUploads(list);
  }, [tenantId, accountId, locationKey]);

  useEffect(() => {
    if (accountId && tenantId && locationKey) loadLocationUploads();
  }, [accountId, tenantId, locationKey, loadLocationUploads]);

  const handleUploadLocationFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !tenantId || !accountId || !locationKey || !user?.uid) return;
    setUploading(true);
    try {
      const uploadsRef = collection(db, p.recruiterAccountLocationUploads(tenantId, accountId));
      const newRef = doc(uploadsRef);
      const uploadId = newRef.id;
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `tenants/${tenantId}/accounts/${accountId}/location_uploads/${locationKey}/${uploadId}/${safeName}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      await setDoc(newRef, {
        locationKey,
        name: (uploadLabel || 'Document').trim(),
        fileName: file.name,
        storagePath,
        url,
        createdAt: serverTimestamp(),
        createdBy: user.uid,
      });
      await loadLocationUploads();
      setUploadLabel('');
      setUploadFileKey((k) => k + 1);
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    } catch (err) {
      console.error('Location upload error:', err);
      if (isMounted.current) alert((err as Error)?.message || 'Upload failed');
    } finally {
      if (isMounted.current) setUploading(false);
    }
  };

  const handleDeleteLocationUpload = async (uploadId: string) => {
    const row = locationUploads.find((u) => u.id === uploadId);
    if (!row || !tenantId || !accountId) return;
    setDeleteConfirmUploadId(null);
    try {
      const storageRef = ref(storage, row.storagePath);
      await deleteObject(storageRef);
      await deleteDoc(doc(db, p.recruiterAccountLocationUpload(tenantId, accountId, uploadId)));
      await loadLocationUploads();
    } catch (err) {
      console.error('Delete location upload error:', err);
      if (isMounted.current) alert((err as Error)?.message || 'Delete failed');
    }
  };

  const loadContactsAtLocation = React.useCallback(async () => {
    if (!tenantId || !resolvedCompanyId || !locationId) return;
    const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
    const q = query(contactsRef, where('companyId', '==', resolvedCompanyId), where('locationId', '==', locationId));
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
    list.sort((a, b) => ((a.firstName || '') + (a.lastName || '')).localeCompare((b.firstName || '') + (b.lastName || '')));
    if (isMounted.current) setContactsAtLocation(list);
  }, [tenantId, resolvedCompanyId, locationId]);

  const handleAddContactToLocation = async (contactId: string) => {
    if (!tenantId || !resolvedCompanyId || !locationId || !account?.name) return;
    setLocationContactsModalSaving(true);
    try {
      const contactRef = doc(db, 'tenants', tenantId, 'crm_contacts', contactId);
      const snap = await getDoc(contactRef);
      const data = snap.exists() ? snap.data() : null;
      const existingCompanies: string[] = (data?.associations?.companies && Array.isArray(data.associations.companies)) ? data.associations.companies : [];
      const existingLocations: string[] = (data?.associations?.locations && Array.isArray(data.associations.locations)) ? data.associations.locations : [];
      const newCompanies = existingCompanies.includes(resolvedCompanyId) ? existingCompanies : [...existingCompanies, resolvedCompanyId];
      const newLocations = existingLocations.includes(locationId) ? existingLocations : [...existingLocations, locationId];
      const locationNameForContact = locationDoc?.nickname || locationDoc?.name || locationId || 'Location';
      await updateDoc(contactRef, {
        locationId,
        locationName: locationNameForContact,
        companyId: resolvedCompanyId,
        companyName: account.name,
        associations: { ...(data?.associations || {}), companies: newCompanies, locations: newLocations },
        updatedAt: serverTimestamp(),
      });
      await loadContactsAtLocation();
    } catch (err) {
      console.error('Add contact to location error:', err);
      if (isMounted.current) alert((err as Error)?.message || 'Failed to add contact to location');
    } finally {
      if (isMounted.current) setLocationContactsModalSaving(false);
    }
  };

  const handleRemoveContactFromLocation = async (contactId: string) => {
    if (!tenantId || !locationId) return;
    setLocationContactsModalSaving(true);
    try {
      const contactRef = doc(db, 'tenants', tenantId, 'crm_contacts', contactId);
      const snap = await getDoc(contactRef);
      const data = snap.exists() ? snap.data() : null;
      const currentLocations: string[] = (data?.associations?.locations && Array.isArray(data.associations.locations)) ? data.associations.locations : [];
      const newLocations = currentLocations.filter((id) => id !== locationId);
      const associations = { ...(data?.associations || {}), locations: newLocations };
      const updates: Record<string, unknown> = {
        associations,
        updatedAt: serverTimestamp(),
      };
      if (data?.locationId === locationId) {
        updates.locationId = null;
        updates.locationName = null;
      }
      await updateDoc(contactRef, updates);
      await loadContactsAtLocation();
    } catch (err) {
      console.error('Remove contact from location error:', err);
      if (isMounted.current) alert((err as Error)?.message || 'Failed to remove contact from location');
    } finally {
      if (isMounted.current) setLocationContactsModalSaving(false);
    }
  };

  const filteredLocationContacts = React.useMemo(() => {
    const q = (contactsSearch || '').trim().toLowerCase();
    if (!q) return contactsAtLocation;
    const tokens = q.split(/\s+/).filter(Boolean);
    return contactsAtLocation.filter((c) => {
      const fullName = (c.fullName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || '').toLowerCase();
      const email = (c.email || '').toLowerCase();
      return tokens.every((t) => fullName.includes(t) || email.includes(t));
    });
  }, [contactsAtLocation, contactsSearch]);

  const locationNameForContact = locationDoc?.nickname || locationDoc?.name || locationId || 'Location';
  const companyNameForContact =
    accountCompaniesOptions.find((c) => c.id === resolvedCompanyId)?.companyName ||
    accountCompaniesOptions.find((c) => c.id === resolvedCompanyId)?.name ||
    accountCompaniesOptions.find((c) => c.id === resolvedCompanyId)?.label ||
    resolvedCompanyId ||
    '';
  const handleSaveLocationContact = async () => {
    if (!tenantId || !resolvedCompanyId || !locationId || !addContactForm.firstName?.trim() || !addContactForm.lastName?.trim()) return;
    setAddContactSaving(true);
    setAddContactError(null);
    try {
      const { linkedInUrl: _u, ...restForm } = addContactForm;
      const contactData = {
        ...restForm,
        linkedinUrl: (addContactForm.linkedInUrl || '').trim(),
        fullName: `${addContactForm.firstName.trim()} ${addContactForm.lastName.trim()}`,
        tenantId,
        companyId: resolvedCompanyId,
        companyName: companyNameForContact,
        locationId,
        locationName: locationNameForContact,
        associations: {
          companies: [resolvedCompanyId],
          locations: [locationId],
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        salesOwnerId: user?.uid ?? null,
        accountOwnerId: user?.uid ?? null,
      };
      const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
      const docRef = await addDoc(contactsRef, contactData);
      if (accountId) {
        const accountRef = doc(db, p.recruiterAccount(tenantId, accountId));
        await updateDoc(accountRef, { 'associations.contactIds': arrayUnion(docRef.id) });
      }
      setAddContactForm({ firstName: '', lastName: '', email: '', phone: '', jobTitle: '', contactType: 'Unknown', linkedInUrl: '', tags: [], isActive: true, notes: '' });
      setShowAddContactDialog(false);
      const q2 = query(contactsRef, where('companyId', '==', resolvedCompanyId), where('locationId', '==', locationId));
      const snap = await getDocs(q2);
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
      list.sort((a, b) => ((a.firstName || '') + (a.lastName || '')).localeCompare((b.firstName || '') + (b.lastName || '')));
      if (isMounted.current) setContactsAtLocation(list);
    } catch (err: any) {
      setAddContactError(err?.message || 'Failed to add contact');
    } finally {
      setAddContactSaving(false);
    }
  };

  const saveLocationDefaults = async () => {
    if (!tenantId || !accountId || !locationKey) return;
    setLocationDefaultsSaving(true);
    try {
      const ref = doc(db, p.recruiterAccountLocationDefaults(tenantId, accountId, locationKey));
      const orderDefaults = {
        staffInstructions: {
          ...(locationOverrideUniform.trim() ? { uniform: { text: locationOverrideUniform.trim() } } : {}),
        },
      };
      await setDoc(ref, {
        orderDefaults,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid ?? null,
      }, { merge: true });
      setLocationDefaults((prev) => ({
        ...(prev ?? {}),
        orderDefaults,
      } as any));
    } catch (err) {
      console.error('Save location defaults error', err);
    } finally {
      setLocationDefaultsSaving(false);
    }
  };

  const saveLocationPricingNotes = async (value: string) => {
    if (!tenantId || !accountId || !locationKey) return;
    setLocationPricingNotesSaving(true);
    try {
      const ref = doc(db, p.recruiterAccountLocationDefaults(tenantId, accountId, locationKey));
      await setDoc(ref, {
        pricingNotes: value.trim() || null,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid ?? null,
      }, { merge: true });
      setLocationDefaults((prev) => ({ ...(prev ?? {}), pricingNotes: value.trim() || null } as any));
    } catch (err) {
      console.error('Save location pricing notes error', err);
    } finally {
      setLocationPricingNotesSaving(false);
    }
  };

  const saveLocationPricing = async () => {
    if (!tenantId || !accountId || !locationKey) return;
    setLocationPricingSaving(true);
    try {
      const ref = doc(db, p.recruiterAccountLocationDefaults(tenantId, accountId, locationKey));
      const positionsToSave = locationPricingPositions.map(({ id, ...p }) => p);
      await setDoc(ref, {
        pricing: { positions: positionsToSave },
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid ?? null,
      }, { merge: true });
      setLocationDefaults((prev) => ({
        ...(prev ?? {}),
        pricing: { positions: positionsToSave },
      } as any));
    } catch (err) {
      console.error('Save location pricing error', err);
    } finally {
      setLocationPricingSaving(false);
    }
  };

  const saveLocationSettings = async () => {
    if (!tenantId || !accountId || !locationKey) return;
    setLocationSettingsSaving(true);
    try {
      const ref = doc(db, p.recruiterAccountLocationDefaults(tenantId, accountId, locationKey));
      await setDoc(ref, {
        rules: { ...locationDefaultRules },
        billing: { ...locationDefaultBilling },
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid ?? null,
      }, { merge: true });
      setLocationDefaults((prev) => ({
        ...(prev ?? {}),
        rules: { ...locationDefaultRules },
        billing: { ...locationDefaultBilling },
      } as any));
    } catch (err) {
      console.error('Save location settings error', err);
    } finally {
      setLocationSettingsSaving(false);
    }
  };

  const accountDefaultEVerify = !!(
    account?.defaults?.eVerify &&
    typeof account.defaults.eVerify === 'object' &&
    (account.defaults.eVerify as { eVerifyRequired?: boolean }).eVerifyRequired
  );
  const accountDefaultHiringEntityId =
    account?.hiringEntityId ?? (account ? inheritedAccountHiringEntityId : null) ?? null;
  const displayEVerify = (locationDefaults as any)?.eVerifyRequired !== undefined
    ? !!(locationDefaults as any).eVerifyRequired
    : accountDefaultEVerify;
  const displayHiringEntityId = (locationDefaults as any)?.hiringEntityId !== undefined
    ? ((locationDefaults as any).hiringEntityId as string | null) ?? null
    : accountDefaultHiringEntityId;
  const displayHiringEntityNameForPricing = displayHiringEntityId
    ? entityOptions.find((e) => e.id === displayHiringEntityId)?.name ?? ''
    : '';
  const showSutaFutaOnLocationPricing = /C1 Workforce|C1 Select/i.test(displayHiringEntityNameForPricing);
  const locationActive = locationDoc?.active !== false;

  const saveLocationEVerify = async (eVerifyRequired: boolean) => {
    if (!tenantId || !accountId || !locationKey) return;
    try {
      const ref = doc(db, p.recruiterAccountLocationDefaults(tenantId, accountId, locationKey));
      await setDoc(ref, {
        eVerifyRequired,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid ?? null,
      }, { merge: true });
      setLocationDefaults((prev) => ({ ...(prev ?? {}), eVerifyRequired } as any));
    } catch (err) {
      console.error('Save location E-Verify error', err);
    }
  };

  const saveLocationHiringEntity = async (hiringEntityId: string | null) => {
    if (!tenantId || !accountId || !locationKey) return;
    try {
      const ref = doc(db, p.recruiterAccountLocationDefaults(tenantId, accountId, locationKey));
      await setDoc(ref, {
        hiringEntityId: hiringEntityId ?? null,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid ?? null,
      }, { merge: true });
      setLocationDefaults((prev) => ({ ...(prev ?? {}), hiringEntityId: hiringEntityId ?? null } as any));
    } catch (err) {
      console.error('Save location Hiring Entity error', err);
    }
  };

  const saveLocationActive = async (active: boolean) => {
    if (!tenantId || !resolvedCompanyId || !locationId) return;
    setLocationActiveSaving(true);
    try {
      const locRef = doc(collection(db, p.accountLocations(tenantId, resolvedCompanyId)), locationId);
      await updateDoc(locRef, { active });
      setLocationDoc((prev) => (prev ? { ...prev, active } : null));
    } catch (err) {
      console.error('Save location active error', err);
    } finally {
      setLocationActiveSaving(false);
    }
  };

  const locationLabel = locationDoc?.nickname || locationDoc?.name || locationId || 'Location';
  const accountName = account?.name ?? 'Account';

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 320 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !account) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="error">{error ?? 'Account not found.'}</Typography>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/accounts')} sx={{ mt: 2 }}>
          Back to Accounts
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <PageHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Button
              component={Link}
              to={`/accounts/${accountId}`}
              startIcon={<ArrowBackIcon />}
              sx={{ textTransform: 'none', color: 'text.secondary', minWidth: 'auto', mr: 0.5 }}
            >
              {accountName}
            </Button>
            <Typography variant="body2" color="text.secondary">/</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <LocationOnIcon fontSize="small" sx={{ color: 'text.secondary' }} />
              <Typography variant="h6" fontWeight={600}>
                {locationLabel}
              </Typography>
            </Box>
          </Box>
        }
        titleRightActions={
          tabValue === 5 ? (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setShowNewJobOrderModal(true)}
              sx={{ textTransform: 'none', borderRadius: '24px', height: '40px', px: 2.5 }}
            >
              New Order
            </Button>
          ) : undefined
        }
      />

      <Box
        sx={{
          px: 1.5,
          py: 1.25,
          backgroundColor: '#F9FAFB',
          borderRadius: 2,
          border: '1px solid #EAEEF4',
          overflowX: 'auto',
          overflowY: 'hidden',
          '&::-webkit-scrollbar': { height: '6px' },
          '&::-webkit-scrollbar-track': { background: 'rgba(0, 0, 0, 0.02)', borderRadius: '4px' },
          '&::-webkit-scrollbar-thumb': {
            background: 'rgba(0, 0, 0, 0.15)',
            borderRadius: '4px',
            '&:hover': { background: 'rgba(0, 0, 0, 0.25)' },
          },
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
        }}
      >
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'nowrap', minWidth: 'max-content' }}>
          <Button
            variant={tabValue === 0 ? 'contained' : 'text'}
            onClick={() => setTabValue(0)}
            startIcon={<BusinessIcon fontSize="small" />}
            sx={{
              borderRadius: '18px',
              textTransform: 'none',
              fontWeight: 500,
              px: 2.5,
              py: 0.75,
              height: 36,
              ...(tabValue === 0
                ? { backgroundColor: '#0B63C5', color: 'white', '&:hover': { backgroundColor: '#0B63C5' } }
                : { color: '#6B7280', backgroundColor: 'white', border: '1px solid #E5E7EB', '&:hover': { backgroundColor: '#F3F4F6' } }),
            }}
          >
            Overview
          </Button>
          <Button
            variant={tabValue === 1 ? 'contained' : 'text'}
            onClick={() => setTabValue(1)}
            startIcon={<CalendarIcon fontSize="small" />}
            sx={{
              borderRadius: '18px',
              textTransform: 'none',
              fontWeight: 500,
              px: 2.5,
              py: 0.75,
              height: 36,
              ...(tabValue === 1
                ? { backgroundColor: '#0B63C5', color: 'white', '&:hover': { backgroundColor: '#0B63C5' } }
                : { color: '#6B7280', backgroundColor: 'white', border: '1px solid #E5E7EB', '&:hover': { backgroundColor: '#F3F4F6' } }),
            }}
          >
            Calendar
          </Button>
          <Button
            variant={tabValue === 2 ? 'contained' : 'text'}
            onClick={() => setTabValue(2)}
            startIcon={<GroupWorkIcon fontSize="small" />}
            sx={{
              borderRadius: '18px',
              textTransform: 'none',
              fontWeight: 500,
              px: 2.5,
              py: 0.75,
              height: 36,
              ...(tabValue === 2
                ? { backgroundColor: '#0B63C5', color: 'white', '&:hover': { backgroundColor: '#0B63C5' } }
                : { color: '#6B7280', backgroundColor: 'white', border: '1px solid #E5E7EB', '&:hover': { backgroundColor: '#F3F4F6' } }),
            }}
          >
            Active Workers
          </Button>
          <Button
            variant={tabValue === 3 ? 'contained' : 'text'}
            onClick={() => setTabValue(3)}
            startIcon={<PersonIcon fontSize="small" />}
            sx={{
              borderRadius: '18px',
              textTransform: 'none',
              fontWeight: 500,
              px: 2.5,
              py: 0.75,
              height: 36,
              ...(tabValue === 3
                ? { backgroundColor: '#0B63C5', color: 'white', '&:hover': { backgroundColor: '#0B63C5' } }
                : { color: '#6B7280', backgroundColor: 'white', border: '1px solid #E5E7EB', '&:hover': { backgroundColor: '#F3F4F6' } }),
            }}
          >
            Contacts
          </Button>
          <Button
            variant={tabValue === 4 ? 'contained' : 'text'}
            onClick={() => setTabValue(4)}
            startIcon={<AttachMoneyIcon fontSize="small" />}
            sx={{
              borderRadius: '18px',
              textTransform: 'none',
              fontWeight: 500,
              px: 2.5,
              py: 0.75,
              height: 36,
              ...(tabValue === 4
                ? { backgroundColor: '#0B63C5', color: 'white', '&:hover': { backgroundColor: '#0B63C5' } }
                : { color: '#6B7280', backgroundColor: 'white', border: '1px solid #E5E7EB', '&:hover': { backgroundColor: '#F3F4F6' } }),
            }}
          >
            Pricing
          </Button>
          <Button
            variant={tabValue === 5 ? 'contained' : 'text'}
            onClick={() => setTabValue(5)}
            startIcon={<WorkIcon fontSize="small" />}
            sx={{
              borderRadius: '18px',
              textTransform: 'none',
              fontWeight: 500,
              px: 2.5,
              py: 0.75,
              height: 36,
              ...(tabValue === 5
                ? { backgroundColor: '#0B63C5', color: 'white', '&:hover': { backgroundColor: '#0B63C5' } }
                : { color: '#6B7280', backgroundColor: 'white', border: '1px solid #E5E7EB', '&:hover': { backgroundColor: '#F3F4F6' } }),
            }}
          >
            Job Orders
          </Button>
          <Button
            variant={tabValue === 6 ? 'contained' : 'text'}
            onClick={() => setTabValue(6)}
            startIcon={<BadgeIcon fontSize="small" />}
            sx={{
              borderRadius: '18px',
              textTransform: 'none',
              fontWeight: 500,
              px: 2.5,
              py: 0.75,
              height: 36,
              ...(tabValue === 6
                ? { backgroundColor: '#0B63C5', color: 'white', '&:hover': { backgroundColor: '#0B63C5' } }
                : { color: '#6B7280', backgroundColor: 'white', border: '1px solid #E5E7EB', '&:hover': { backgroundColor: '#F3F4F6' } }),
            }}
          >
            Jobs Board
          </Button>
          <Button
            variant={tabValue === 7 ? 'contained' : 'text'}
            onClick={() => setTabValue(7)}
            startIcon={<GroupWorkIcon fontSize="small" />}
            sx={{
              borderRadius: '18px',
              textTransform: 'none',
              fontWeight: 500,
              px: 2.5,
              py: 0.75,
              height: 36,
              ...(tabValue === 7
                ? { backgroundColor: '#0B63C5', color: 'white', '&:hover': { backgroundColor: '#0B63C5' } }
                : { color: '#6B7280', backgroundColor: 'white', border: '1px solid #E5E7EB', '&:hover': { backgroundColor: '#F3F4F6' } }),
            }}
          >
            Labor Pool
          </Button>
          <Button
            variant={tabValue === 8 ? 'contained' : 'text'}
            onClick={() => setTabValue(8)}
            startIcon={<SettingsIcon fontSize="small" />}
            sx={{
              borderRadius: '18px',
              textTransform: 'none',
              fontWeight: 500,
              px: 2.5,
              py: 0.75,
              height: 36,
              ...(tabValue === 8
                ? { backgroundColor: '#0B63C5', color: 'white', '&:hover': { backgroundColor: '#0B63C5' } }
                : { color: '#6B7280', backgroundColor: 'white', border: '1px solid #E5E7EB', '&:hover': { backgroundColor: '#F3F4F6' } }),
            }}
          >
            Settings
          </Button>
          {canAccessInvoicing && (
            <Button
              variant={tabValue === 9 ? 'contained' : 'text'}
              onClick={() => setTabValue(9)}
              startIcon={<ReceiptIcon fontSize="small" />}
              sx={{
                borderRadius: '18px',
                textTransform: 'none',
                fontWeight: 500,
                px: 2.5,
                py: 0.75,
                height: 36,
                  ...(tabValue === 9
                  ? { backgroundColor: '#0B63C5', color: 'white', '&:hover': { backgroundColor: '#0B63C5' } }
                  : { color: '#6B7280', backgroundColor: 'white', border: '1px solid #E5E7EB', '&:hover': { backgroundColor: '#F3F4F6' } }),
              }}
            >
              Invoicing
            </Button>
          )}
          <Button
            variant={tabValue === 10 ? 'contained' : 'text'}
            onClick={() => setTabValue(10)}
            startIcon={<DescriptionIcon fontSize="small" />}
            sx={{
              borderRadius: '18px',
              textTransform: 'none',
              fontWeight: 500,
              px: 2.5,
              py: 0.75,
              height: 36,
              ...(tabValue === 10
                ? { backgroundColor: '#0B63C5', color: 'white', '&:hover': { backgroundColor: '#0B63C5' } }
                : { color: '#6B7280', backgroundColor: 'white', border: '1px solid #E5E7EB', '&:hover': { backgroundColor: '#F3F4F6' } }),
            }}
          >
            Order Defaults
          </Button>
          <Button
            variant={tabValue === 11 ? 'contained' : 'text'}
            onClick={() => setTabValue(11)}
            startIcon={<ReportsIcon fontSize="small" />}
            sx={{
              borderRadius: '18px',
              textTransform: 'none',
              fontWeight: 500,
              px: 2.5,
              py: 0.75,
              height: 36,
              ...(tabValue === 11
                ? { backgroundColor: '#0B63C5', color: 'white', '&:hover': { backgroundColor: '#0B63C5' } }
                : { color: '#6B7280', backgroundColor: 'white', border: '1px solid #E5E7EB', '&:hover': { backgroundColor: '#F3F4F6' } }),
            }}
          >
            Reports
          </Button>
          <Button
            variant={tabValue === 12 ? 'contained' : 'text'}
            onClick={() => setTabValue(12)}
            startIcon={<DashboardIcon fontSize="small" />}
            sx={{
              borderRadius: '18px',
              textTransform: 'none',
              fontWeight: 500,
              px: 2.5,
              py: 0.75,
              height: 36,
              ...(tabValue === 12
                ? { backgroundColor: '#0B63C5', color: 'white', '&:hover': { backgroundColor: '#0B63C5' } }
                : { color: '#6B7280', backgroundColor: 'white', border: '1px solid #E5E7EB', '&:hover': { backgroundColor: '#F3F4F6' } }),
            }}
          >
            Activity
          </Button>
        </Box>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', pt: 2, pb: 2 }}>
        <TabPanel value={tabValue} index={0}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={9}>
              <Card>
                <CardHeader
                  title="Location Details"
                  titleTypographyProps={{ variant: 'h6', fontWeight: 600 }}
                  action={
                    <IconButton
                      size="small"
                      onClick={() => setIsEditingDetails(!isEditingDetails)}
                      sx={{ color: isEditingDetails ? 'primary.main' : 'text.secondary' }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  }
                />
                <CardContent sx={{ pt: 0 }}>
                  {isEditingDetails ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {(locationDoc?.address || locationDoc?.street || locationDoc?.city || locationDoc?.state || locationDoc?.zip || locationDoc?.zipcode || locationDoc?.zipCode) && (
                        <Box>
                          <Typography variant="caption" color="text.secondary">Address</Typography>
                          <Typography variant="body2" sx={{ mt: 0.25 }}>
                            {fullAddressString || '—'}
                          </Typography>
                          <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5 }}>
                            Edit address on the location record in the account Locations tab.
                          </Typography>
                        </Box>
                      )}
                      {locationDoc?.type != null && (
                        <Typography variant="body2"><strong>Type:</strong> {locationDoc.type || '—'}</Typography>
                      )}
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={displayEVerify}
                            onChange={(e) => saveLocationEVerify(e.target.checked)}
                            disabled={locationDefaultsLoading}
                          />
                        }
                        label="E-Verify Required"
                      />
                      <FormControl fullWidth size="small">
                        <InputLabel>Hiring Entity</InputLabel>
                        <Select
                          value={displayHiringEntityId ?? ''}
                          label="Hiring Entity"
                          onChange={(e) => saveLocationHiringEntity(e.target.value || null)}
                          disabled={locationDefaultsLoading}
                        >
                          <MenuItem value="">— Use account default —</MenuItem>
                          {entityOptions.map((ent) => (
                            <MenuItem key={ent.id} value={ent.id}>{ent.name}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={locationActive}
                            onChange={(e) => saveLocationActive(e.target.checked)}
                            disabled={locationActiveSaving}
                          />
                        }
                        label="Active"
                      />
                    </Box>
                  ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <LocationOnIcon sx={{ color: 'text.secondary', fontSize: 20 }} />
                        <Typography variant="body1" fontWeight={500}>
                          {locationDoc?.name || locationDoc?.nickname || '—'}
                        </Typography>
                      </Box>
                      {(locationDoc?.address || locationDoc?.street || locationDoc?.city || locationDoc?.state || locationDoc?.zip || locationDoc?.zipcode || locationDoc?.zipCode) && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body2" color="text.secondary">Address:</Typography>
                          <Typography variant="body2">
                            {fullAddressString || '—'}
                          </Typography>
                        </Box>
                      )}
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" color="text.secondary">Type:</Typography>
                        <Typography variant="body2">{locationDoc?.type || '—'}</Typography>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" color="text.secondary">E-Verify:</Typography>
                        <Typography variant="body2">{displayEVerify ? 'Yes' : 'No'}</Typography>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" color="text.secondary">Hiring Entity:</Typography>
                        <Typography variant="body2">
                          {displayHiringEntityId ? (entityOptions.find((e) => e.id === displayHiringEntityId)?.name ?? '—') : '— Use account default —'}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" color="text.secondary">Status:</Typography>
                        <Chip
                          label={locationActive ? 'Active' : 'Inactive'}
                          color={locationActive ? 'success' : 'default'}
                          size="small"
                          variant={locationActive ? 'filled' : 'outlined'}
                        />
                      </Box>
                    </Box>
                  )}
                </CardContent>
              </Card>

              <Card sx={{ mt: 3 }}>
                <CardHeader
                  title="File uploads"
                  titleTypographyProps={{ variant: 'h6', fontWeight: 600 }}
                />
                <CardContent sx={{ pt: 0 }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
                      <TextField
                        size="small"
                        label="Name"
                        placeholder="e.g. Contract"
                        value={uploadLabel}
                        onChange={(e) => setUploadLabel(e.target.value)}
                        sx={{ minWidth: 180 }}
                      />
                      <input
                        key={uploadFileKey}
                        ref={uploadInputRef}
                        type="file"
                        accept="*/*"
                        style={{ display: 'none' }}
                        onChange={handleUploadLocationFile}
                      />
                      <Button
                        variant="outlined"
                        component="span"
                        startIcon={uploading ? <CircularProgress size={16} /> : <UploadIcon />}
                        disabled={uploading}
                        onClick={() => uploadInputRef.current?.click()}
                        sx={{ textTransform: 'none' }}
                      >
                        {uploading ? 'Uploading…' : 'Choose file'}
                      </Button>
                    </Box>
                    {locationUploads.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        No uploads yet. Add a name (e.g. Contract) and choose a file to upload.
                      </Typography>
                    ) : (
                      <TableContainer component={Paper} variant="outlined" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                              <TableCell sx={{ fontWeight: 600 }}>File</TableCell>
                              <TableCell sx={{ fontWeight: 600, width: 140 }} align="right">Actions</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {locationUploads.map((row) => (
                              <TableRow key={row.id}>
                                <TableCell>{row.name}</TableCell>
                                <TableCell>{row.fileName}</TableCell>
                                <TableCell align="right">
                                  <IconButton
                                    size="small"
                                    title="Open in new tab"
                                    onClick={() => window.open(row.url, '_blank')}
                                    sx={{ color: 'text.secondary' }}
                                  >
                                    <OpenInNewIcon fontSize="small" />
                                  </IconButton>
                                  <IconButton
                                    size="small"
                                    title="Delete"
                                    onClick={() => setDeleteConfirmUploadId(row.id)}
                                    sx={{ color: 'error.main' }}
                                  >
                                    <DeleteIcon fontSize="small" />
                                  </IconButton>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    )}
                  </Box>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={3}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <Card>
                  <CardHeader
                    title="Company"
                    titleTypographyProps={{ variant: 'h6', fontWeight: 600 }}
                  />
                  <CardContent sx={{ p: 2, pt: 0 }}>
                    {sidebarCompanyName && resolvedCompanyId ? (
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                          p: 1,
                          borderRadius: 1,
                          bgcolor: 'grey.50',
                          cursor: 'pointer',
                        }}
                        component={Link}
                        to={`/companies/${resolvedCompanyId}`}
                        style={{ textDecoration: 'none', color: 'inherit' }}
                      >
                        <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem' }}>
                          {sidebarCompanyName.charAt(0).toUpperCase()}
                        </Avatar>
                        <Typography variant="body2" fontWeight="medium">
                          {sidebarCompanyName}
                        </Typography>
                      </Box>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        —
                      </Typography>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader
                    title="Account Contacts"
                    titleTypographyProps={{ variant: 'h6', fontWeight: 600 }}
                    action={
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => setManageLocationContactsOpen(true)}
                        sx={{ minWidth: 'auto', px: 1, py: 0.5, fontSize: '0.75rem', textTransform: 'none' }}
                      >
                        Edit
                      </Button>
                    }
                  />
                  <CardContent sx={{ p: 2, pt: 0 }}>
                    {filteredLocationContacts.length > 0 ? (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        {filteredLocationContacts.slice(0, 5).map((c) => (
                          <Box
                            key={c.id}
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 1,
                              p: 1,
                              borderRadius: 1,
                              bgcolor: 'grey.50',
                              cursor: 'pointer',
                            }}
                            component={Link}
                            to={`/contacts/${c.id}`}
                            style={{ textDecoration: 'none', color: 'inherit' }}
                          >
                            <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem' }}>
                              {(c.firstName?.[0] || c.lastName?.[0] || '?').toUpperCase()}
                            </Avatar>
                            <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                              {c.fullName || [c.firstName, c.lastName].filter(Boolean).join(' ') || '—'}
                            </Typography>
                            <Button
                              component={Link}
                              to={`/contacts/${c.id}`}
                              size="small"
                              sx={{ ml: 'auto', minWidth: 'auto', fontSize: '0.7rem' }}
                              onClick={(e: React.MouseEvent) => e.stopPropagation()}
                            >
                              View
                            </Button>
                          </Box>
                        ))}
                        {filteredLocationContacts.length > 5 && (
                          <Button size="small" sx={{ mt: 0.5, textTransform: 'none' }} onClick={() => setTabValue(5)}>
                            View all ({filteredLocationContacts.length})
                          </Button>
                        )}
                      </Box>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        No contacts at this location. Use Edit to activate company contacts.
                      </Typography>
                    )}
                  </CardContent>
                </Card>

                <Card variant="outlined">
                  <CardHeader
                    title={
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <LocationOnIcon sx={{ mr: 1 }} color="primary" />
                        <Typography variant="h6" sx={{ fontWeight: 600 }}>
                          Location Map
                        </Typography>
                      </Box>
                    }
                    titleTypographyProps={{ component: 'div' }}
                  />
                  <CardContent sx={{ pt: 0 }}>
                    {mapCoordsLoading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={32} />
                      </Box>
                    ) : mapCoords ? (
                      <MapWithMarkers
                        homeLat={mapCoords.lat}
                        homeLng={mapCoords.lng}
                        homeMarkerLabel="L"
                        homeMarkerTitle={locationDoc?.name || locationDoc?.nickname || fullAddressString || 'Location'}
                      />
                    ) : fullAddressString.trim() ? (
                      <Box>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                          {mapGeocodeError || 'Could not geocode this address. Check the address or try again later.'}
                        </Typography>
                        <Typography variant="caption" display="block" color="text.secondary" sx={{ mb: 1 }}>
                          Address used: {fullAddressString}
                        </Typography>
                        <Button size="small" variant="outlined" onClick={() => setMapGeocodeRetry((n) => n + 1)}>
                          Retry geocoding
                        </Button>
                      </Box>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        No location data available to display on the map. Add an address to the location to see it on the map.
                      </Typography>
                    )}
                  </CardContent>
                </Card>
              </Box>
            </Grid>
          </Grid>
        </TabPanel>

        <TabPanel value={tabValue} index={1}>
          {tenantId && resolvedCompanyId && locationId && (
          <AccountCalendarTab
            tenantId={tenantId}
            account={account}
            locationFilter={{ companyId: resolvedCompanyId, locationId }}
          />
        )}
        </TabPanel>

        <TabPanel value={tabValue} index={2}>
          <ActiveWorkersTable
            tenantId={tenantId}
            jobOrderIds={jobOrdersAtLocation.map((j) => j.id)}
          />
        </TabPanel>

        <TabPanel value={tabValue} index={3}>
          <Card>
            <CardHeader
              title="Contacts"
              titleTypographyProps={{ variant: 'h6', fontWeight: 600 }}
              action={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TextField
                    size="small"
                    placeholder="Search contacts…"
                    value={contactsSearch}
                    onChange={(e) => setContactsSearch(e.target.value)}
                    sx={{ minWidth: 200 }}
                  />
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={() => setShowAddContactDialog(true)}
                    sx={{ textTransform: 'none' }}
                  >
                    Add Contact
                  </Button>
                </Box>
              }
            />
            <CardContent sx={{ pt: 0 }}>
              {contactsLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                  <CircularProgress size={32} />
                </Box>
              ) : filteredLocationContacts.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {contactsSearch ? 'No contacts match your search.' : 'No contacts at this location. Use Add Contact to associate a contact with this location.'}
                </Typography>
              ) : (
                <TableContainer component={Paper} variant="outlined" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: 'grey.50' }}>
                        <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Title</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Email</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Phone</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>LinkedIn</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filteredLocationContacts.map((c) => (
                        <TableRow
                          key={c.id}
                          component={Link}
                          to={`/contacts/${c.id}`}
                          sx={{ cursor: 'pointer', textDecoration: 'none', '&:hover': { bgcolor: 'action.hover' } }}
                        >
                          <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                              <SafeAvatar src={null} sx={{ width: 32, height: 32 }}>
                                {(c.firstName?.[0] || c.lastName?.[0] || '?').toUpperCase()}
                              </SafeAvatar>
                              <Typography variant="body2" fontWeight={500}>
                                {c.fullName || [c.firstName, c.lastName].filter(Boolean).join(' ') || '—'}
                              </Typography>
                            </Box>
                          </TableCell>
                          <TableCell>{c.jobTitle || '—'}</TableCell>
                          <TableCell>{c.email || '—'}</TableCell>
                          <TableCell>{c.phone || '—'}</TableCell>
                          <TableCell onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                            {c.linkedinUrl ? (
                              <Typography component="a" href={c.linkedinUrl} target="_blank" rel="noopener noreferrer" variant="body2" color="primary" sx={{ textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                                Profile
                              </Typography>
                            ) : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </CardContent>
          </Card>
          <Dialog open={showAddContactDialog} onClose={() => !addContactSaving && setShowAddContactDialog(false)} maxWidth="sm" fullWidth>
            <DialogTitle>Add New Contact</DialogTitle>
            <DialogContent>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                This contact will be associated with the company and this worksite for this account.
              </Typography>
              <Box sx={{ mb: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                <Typography variant="caption" color="text.secondary" display="block">Company</Typography>
                <Typography variant="body2" fontWeight={500}>{companyNameForContact || '—'}</Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>Worksite</Typography>
                <Typography variant="body2" fontWeight={500}>{locationNameForContact}</Typography>
              </Box>
              <Grid container spacing={2} sx={{ mt: 0.5 }}>
                <Grid item xs={12} sm={6}>
                  <TextField fullWidth label="First name" required value={addContactForm.firstName} onChange={(e) => setAddContactForm((f) => ({ ...f, firstName: e.target.value }))} size="small" />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField fullWidth label="Last name" required value={addContactForm.lastName} onChange={(e) => setAddContactForm((f) => ({ ...f, lastName: e.target.value }))} size="small" />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField fullWidth label="Email" type="email" value={addContactForm.email} onChange={(e) => setAddContactForm((f) => ({ ...f, email: e.target.value }))} size="small" />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField fullWidth label="Phone" value={addContactForm.phone} onChange={(e) => setAddContactForm((f) => ({ ...f, phone: e.target.value }))} size="small" />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField fullWidth label="Job title" value={addContactForm.jobTitle} onChange={(e) => setAddContactForm((f) => ({ ...f, jobTitle: e.target.value }))} size="small" />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Contact type</InputLabel>
                    <Select value={addContactForm.contactType} label="Contact type" onChange={(e) => setAddContactForm((f) => ({ ...f, contactType: e.target.value }))}>
                      <MenuItem value="Unknown">Unknown</MenuItem>
                      <MenuItem value="Decision Maker">Decision Maker</MenuItem>
                      <MenuItem value="Influencer">Influencer</MenuItem>
                      <MenuItem value="Gatekeeper">Gatekeeper</MenuItem>
                      <MenuItem value="Referrer">Referrer</MenuItem>
                      <MenuItem value="Evaluator">Evaluator</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12}>
                  <TextField fullWidth label="LinkedIn URL" placeholder="https://www.linkedin.com/in/username" value={addContactForm.linkedInUrl} onChange={(e) => setAddContactForm((f) => ({ ...f, linkedInUrl: e.target.value }))} size="small" />
                </Grid>
                <Grid item xs={12}>
                  <FormControlLabel control={<Switch checked={addContactForm.isActive} onChange={(e) => setAddContactForm((f) => ({ ...f, isActive: e.target.checked }))} />} label="Active" />
                </Grid>
                <Grid item xs={12}>
                  <Autocomplete multiple freeSolo options={[]} value={addContactForm.tags} onInputChange={() => {}} onChange={(_e, v) => setAddContactForm((f) => ({ ...f, tags: v as string[] }))} renderInput={(params) => <TextField {...params} label="Tags" size="small" />} />
                </Grid>
                <Grid item xs={12}>
                  <TextField fullWidth label="Notes" multiline minRows={2} value={addContactForm.notes} onChange={(e) => setAddContactForm((f) => ({ ...f, notes: e.target.value }))} size="small" />
                </Grid>
              </Grid>
              {addContactError && <Typography color="error" variant="body2" sx={{ mt: 2 }}>{addContactError}</Typography>}
            </DialogContent>
            <DialogActions>
              <Button startIcon={<CloseIcon />} onClick={() => !addContactSaving && setShowAddContactDialog(false)} disabled={addContactSaving}>Cancel</Button>
              <Button variant="contained" onClick={handleSaveLocationContact} disabled={addContactSaving || !addContactForm.firstName?.trim() || !addContactForm.lastName?.trim()} startIcon={addContactSaving ? <CircularProgress size={18} /> : null}>
                {addContactSaving ? 'Saving…' : 'Save'}
              </Button>
            </DialogActions>
          </Dialog>
        </TabPanel>

        <TabPanel value={tabValue} index={4}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Pricing and positions trickle down from the account. You can override or add to them for this location only; changes here do not affect the master Account Pricing tab.
            </Typography>
            <Card>
              <CardHeader title="Pricing Notes" titleTypographyProps={{ variant: 'h6', fontWeight: 600 }} />
              <CardContent sx={{ pt: 0 }}>
                <TextField
                  fullWidth
                  multiline
                  minRows={3}
                  maxRows={8}
                  label="Notes"
                  placeholder="e.g. special billing instructions, rate notes..."
                  value={locationPricingNotes}
                  onChange={(e) => setLocationPricingNotes(e.target.value)}
                  onBlur={() => saveLocationPricingNotes(locationPricingNotes)}
                  disabled={locationPricingNotesSaving}
                  helperText={locationPricingNotesSaving ? 'Saving…' : 'Saved on blur. Location override; does not change account.'}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader
                title="Positions table"
                subheader="Job titles and rates for this location. WC code and rate auto-fill when job title + state match in Settings → Workers Comp; or enter them manually. Inherited from account until you edit; then saved as location override."
                titleTypographyProps={{ variant: 'h6', fontWeight: 600 }}
                action={
                  <Button
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={() =>
                      setLocationPricingPositions((prev) => [
                        ...prev,
                        {
                          id: `pos-${Date.now()}`,
                          jobTitle: '',
                          payRate: 0,
                          markupPercent: null,
                          billRate: 0,
                          workersCompCode: '',
                          workersCompRate: null,
                          sutaRate: null,
                          futaRate: null,
                          jobDescriptionFromClient: '',
                        },
                      ])
                    }
                  >
                    Add position
                  </Button>
                }
              />
              <CardContent sx={{ pt: 0 }}>
                {showSutaFutaOnLocationPricing && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 2 }}>
                    <FormControl size="small" sx={{ minWidth: 140 }}>
                      <InputLabel>Worksite state</InputLabel>
                      <Select
                        value={locationPricingSutaFutaState || ''}
                        onChange={(e) => setLocationPricingSutaFutaState(e.target.value)}
                        label="Worksite state"
                      >
                        <MenuItem value=""><em>Select state</em></MenuItem>
                        {US_STATE_CODES.map((code) => (
                          <MenuItem key={code} value={code}>{code}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => {
                        const stateCode = locationPricingSutaFutaState || normalizeStateCode(locationDoc?.state);
                        if (!stateCode) return;
                        const suta = getSutaRateByState(stateCode);
                        const futa = getFutaRateByState(stateCode);
                        setLocationPricingPositions((prev) =>
                          prev.map((row) => ({
                            ...row,
                            sutaRate: suta ?? row.sutaRate,
                            futaRate: futa,
                          }))
                        );
                      }}
                      disabled={!locationPricingSutaFutaState && !normalizeStateCode(locationDoc?.state)}
                      sx={{ textTransform: 'none' }}
                    >
                      Apply SUTA/FUTA from state
                    </Button>
                  </Box>
                )}
                <TableContainer component={Paper} variant="outlined" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: 'grey.50' }}>
                        <TableCell sx={{ fontWeight: 600 }}>Job title</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">Pay rate</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">Markup %</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">Bill rate</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>WC Code</TableCell>
                        <TableCell sx={{ fontWeight: 600 }} align="right">WC Rate %</TableCell>
                        {showSutaFutaOnLocationPricing && (
                            <>
                              <TableCell sx={{ fontWeight: 600 }} align="right">SUTA %</TableCell>
                              <TableCell sx={{ fontWeight: 600 }} align="right">FUTA %</TableCell>
                            </>
                          )}
                        <TableCell sx={{ fontWeight: 600 }} align="right">Net margin</TableCell>
                        <TableCell sx={{ width: 56 }} />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {locationPricingPositions.map((row, idx) => {
                        const markupVal = row.markupPercent;
                        const markup = markupVal == null ? null : Number(markupVal);
                        const markupNum = typeof markup === 'number' && !Number.isNaN(markup) ? markup : null;
                        const pay = Number(row.payRate) || 0;
                        const bill = markupNum != null ? pay * (1 + markupNum / 100) : (Number(row.billRate) || 0);
                        const pricingStateCode = (locationPricingSutaFutaState || normalizeStateCode(locationDoc?.state) || '').trim().toUpperCase();
                        const wcCode = (row.workersCompCode ?? '').trim();
                        const effectiveWcRate = (pricingStateCode && wcCode ? wcRatesByKey[`${pricingStateCode}_${wcCode}`] : undefined) ?? row.workersCompRate;
                        const wc = (Number(effectiveWcRate) || 0) / 100;
                        const suta = (Number(row.sutaRate) || 0) / 100;
                        const futa = (Number(row.futaRate) || 0) / 100;
                        const margin = bill - pay - pay * wc - pay * suta - pay * futa;
                        return (
                          <TableRow key={row.id || idx}>
                            <TableCell sx={{ minWidth: 260, maxWidth: 360, verticalAlign: 'top' }}>
                              <Stack spacing={1}>
                                <Autocomplete
                                  freeSolo
                                  size="small"
                                  options={jobTitlesData as string[]}
                                  value={row.jobTitle}
                                  onInputChange={(_, v) => {
                                    const stateCode = (locationPricingSutaFutaState || normalizeStateCode(locationDoc?.state) || '').trim().toUpperCase();
                                    const lookup =
                                      stateCode && v
                                        ? pickWorkersCompJobTitleLookup(
                                            wcJobTitleMaps,
                                            stateCode,
                                            String(v),
                                            wcModifierAccountIdForLocationPricing,
                                          )
                                        : undefined;
                                    setLocationPricingPositions((prev) => {
                                      const next = [...prev];
                                      next[idx] = { ...next[idx], jobTitle: v };
                                      if (lookup) {
                                        next[idx].workersCompCode = lookup.code;
                                        next[idx].workersCompRate = lookup.rate;
                                      }
                                      return next;
                                    });
                                  }}
                                  renderInput={(params) => <TextField {...params} placeholder="e.g. Chef" />}
                                  sx={{ minWidth: 200 }}
                                />
                                <TextField
                                  size="small"
                                  fullWidth
                                  multiline
                                  minRows={2}
                                  maxRows={6}
                                  label="Client job description"
                                  placeholder="Customer’s official JD or notes for AI job description / postings"
                                  value={row.jobDescriptionFromClient ?? ''}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setLocationPricingPositions((prev) => {
                                      const next = [...prev];
                                      next[idx] = { ...next[idx], jobDescriptionFromClient: v || '' };
                                      return next;
                                    });
                                  }}
                                />
                              </Stack>
                            </TableCell>
                            <TableCell align="right">
                              <TextField
                                size="small"
                                type="number"
                                value={row.payRate || ''}
                                onChange={(e) => {
                                  const v = e.target.value === '' ? 0 : Number(e.target.value);
                                  setLocationPricingPositions((prev) => {
                                    const next = [...prev];
                                    next[idx] = { ...next[idx], payRate: v };
                                    const m = next[idx].markupPercent;
                                    if (m != null) {
                                      const mNum = Number(m);
                                      if (!Number.isNaN(mNum)) next[idx].billRate = v * (1 + mNum / 100);
                                    }
                                    return next;
                                  });
                                }}
                                inputProps={{ min: 0, step: 0.01 }}
                                sx={{ width: 90, ...numberInputNoSpinnerSx }}
                              />
                            </TableCell>
                            <TableCell align="right">
                              <TextField
                                size="small"
                                type="number"
                                value={row.markupPercent ?? ''}
                                onChange={(e) => {
                                  const v = e.target.value === '' ? null : Number(e.target.value);
                                  setLocationPricingPositions((prev) => {
                                    const next = [...prev];
                                    next[idx] = {
                                      ...next[idx],
                                      markupPercent: v,
                                      billRate: v != null ? (Number(next[idx].payRate) || 0) * (1 + v / 100) : next[idx].billRate,
                                    };
                                    return next;
                                  });
                                }}
                                inputProps={{ min: 0, step: 0.5 }}
                                sx={{ width: 80, ...numberInputNoSpinnerSx }}
                                placeholder="—"
                              />
                            </TableCell>
                            <TableCell align="right">
                              <TextField
                                size="small"
                                type="number"
                                value={markupNum != null ? bill.toFixed(2) : (row.billRate ?? '')}
                                disabled={markupNum != null}
                                onChange={(e) => {
                                  if (markupNum != null) return;
                                  const v = e.target.value === '' ? 0 : Number(e.target.value);
                                  setLocationPricingPositions((prev) => {
                                    const next = [...prev];
                                    next[idx] = { ...next[idx], billRate: v };
                                    return next;
                                  });
                                }}
                                inputProps={{ min: 0, step: 0.01 }}
                                sx={{ width: 90, ...numberInputNoSpinnerSx }}
                              />
                            </TableCell>
                            <TableCell>
                              <TextField
                                size="small"
                                value={row.workersCompCode ?? ''}
                                onChange={(e) => {
                                  const v = e.target.value.trim();
                                  setLocationPricingPositions((prev) => {
                                    const next = [...prev];
                                    next[idx] = { ...next[idx], workersCompCode: v || undefined };
                                    return next;
                                  });
                                }}
                                sx={{ width: 100 }}
                                placeholder="e.g. 8810"
                                helperText="Auto from Workers Comp when job title + state match; or enter manually"
                              />
                            </TableCell>
                            <TableCell align="right">
                              <TextField
                                size="small"
                                type="number"
                                value={
                                  (() => {
                                    const sc = (locationPricingSutaFutaState || normalizeStateCode(locationDoc?.state) || '').trim().toUpperCase();
                                    const code = (row.workersCompCode ?? '').trim();
                                    return (sc && code ? wcRatesByKey[`${sc}_${code}`] : undefined) ?? (row.workersCompRate ?? '');
                                  })()
                                }
                                onChange={(e) => {
                                  const v = e.target.value === '' ? null : Number(e.target.value);
                                  setLocationPricingPositions((prev) => {
                                    const next = [...prev];
                                    next[idx] = { ...next[idx], workersCompRate: v != null && !Number.isNaN(v) ? v : undefined };
                                    return next;
                                  });
                                }}
                                inputProps={{ min: 0, step: 0.1 }}
                                sx={{ width: 70, ...numberInputNoSpinnerSx }}
                                placeholder="—"
                                helperText="Auto from Workers Comp or enter manually"
                              />
                            </TableCell>
                            {showSutaFutaOnLocationPricing && (
                                <>
                                  <TableCell align="right">
                                    <TextField
                                      size="small"
                                      type="number"
                                      value={row.sutaRate ?? ''}
                                    onChange={(e) => {
                                      const v = e.target.value === '' ? null : Number(e.target.value);
                                      setLocationPricingPositions((prev) => {
                                        const next = [...prev];
                                        next[idx] = { ...next[idx], sutaRate: v };
                                        return next;
                                      });
                                    }}
                                    inputProps={{ min: 0, step: 0.1 }}
                                    sx={{ width: 70, ...numberInputNoSpinnerSx }}
                                    placeholder="—"
                                  />
                                </TableCell>
                                <TableCell align="right">
                                  <TextField
                                    size="small"
                                    type="number"
                                    value={row.futaRate ?? ''}
                                    onChange={(e) => {
                                      const v = e.target.value === '' ? null : Number(e.target.value);
                                      setLocationPricingPositions((prev) => {
                                        const next = [...prev];
                                        next[idx] = { ...next[idx], futaRate: v };
                                        return next;
                                      });
                                    }}
                                    inputProps={{ min: 0, step: 0.1 }}
                                    sx={{ width: 70, ...numberInputNoSpinnerSx }}
                                    placeholder="—"
                                  />
                                </TableCell>
                              </>
                            )}
                            <TableCell align="right">
                              <Typography variant="body2">{Number.isNaN(margin) ? '—' : `$${margin.toFixed(2)}`}</Typography>
                            </TableCell>
                            <TableCell>
                              <IconButton
                                size="small"
                                onClick={() => setLocationPricingPositions((prev) => prev.filter((_, i) => i !== idx))}
                                sx={{ color: 'error.main' }}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
                {locationPricingPositions.length === 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                    No positions yet. Inherited from account until you add or edit here; then saved for this location only.
                  </Typography>
                )}
                <Button
                  variant="contained"
                  startIcon={locationPricingSaving ? <CircularProgress size={20} /> : <SaveIcon />}
                  onClick={saveLocationPricing}
                  disabled={locationPricingSaving}
                  sx={{ mt: 2 }}
                >
                  {locationPricingSaving ? 'Saving…' : 'Save pricing (this location)'}
                </Button>
              </CardContent>
            </Card>
          </Box>
        </TabPanel>

        <TabPanel value={tabValue} index={5}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minHeight: 0 }}>
            <Box
              sx={{
                p: 1.5,
                backgroundColor: '#F9FAFB',
                borderRadius: '8px',
                border: '1px solid #E5E7EB',
              }}
            >
              <Stack direction="row" gap={1.5} flexWrap="wrap" alignItems="center">
                <FormControl size="small" sx={{ minWidth: 150, height: 36 }}>
                  <InputLabel sx={{ fontSize: '0.875rem' }}>Status</InputLabel>
                  <Select
                    value={jobOrdersStatusFilter}
                    onChange={(e) => { setJobOrdersStatusFilter(e.target.value); setJobOrdersPage(0); }}
                    label="Status"
                    sx={{ height: 36, borderRadius: '6px', backgroundColor: 'white', fontSize: '0.875rem' }}
                  >
                    <MenuItem value="">All Statuses</MenuItem>
                    <MenuItem value="Open">Open</MenuItem>
                    <MenuItem value="On-Hold">On-Hold</MenuItem>
                    <MenuItem value="Cancelled">Cancelled</MenuItem>
                    <MenuItem value="Filled">Filled</MenuItem>
                    <MenuItem value="Completed">Completed</MenuItem>
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 150, height: 36 }}>
                  <InputLabel sx={{ fontSize: '0.875rem' }}>Sort By</InputLabel>
                  <Select
                    value={jobOrdersSortField}
                    onChange={(e) => { setJobOrdersSortField(e.target.value); setJobOrdersPage(0); }}
                    label="Sort By"
                    sx={{ height: 36, borderRadius: '6px', backgroundColor: 'white', fontSize: '0.875rem' }}
                  >
                    <MenuItem value="jobOrderNumber">Job Order #</MenuItem>
                    <MenuItem value="createdAt">Newest First</MenuItem>
                    <MenuItem value="recruiterName">Recruiter(s)</MenuItem>
                  </Select>
                </FormControl>
                <TextField
                  size="small"
                  placeholder="Search job orders…"
                  value={jobOrdersSearch}
                  onChange={(e) => { setJobOrdersSearch(e.target.value); setJobOrdersPage(0); }}
                  sx={{ minWidth: 220, height: 36, '& .MuiOutlinedInput-root': { height: 36, borderRadius: '6px', backgroundColor: 'white' } }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                      </InputAdornment>
                    ),
                  }}
                />
              </Stack>
            </Box>
            {jobOrdersLoading && jobOrdersAtLocation.length === 0 ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                <CircularProgress />
              </Box>
            ) : filteredLocationJobOrders.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 8 }}>
                <WorkIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                <Typography variant="h6" color="text.secondary" gutterBottom>
                  No job orders found
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {jobOrdersSearch || jobOrdersStatusFilter ? 'Try adjusting your filters.' : 'No job orders at this location yet.'}
                </Typography>
              </Box>
            ) : (
              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <TableContainer
                  component={Paper}
                  sx={{
                    flex: 1,
                    overflowY: 'auto',
                    overflowX: 'auto',
                    '&::-webkit-scrollbar': { width: 8, height: 8 },
                    '&::-webkit-scrollbar-track': { background: 'rgba(0,0,0,0.02)', borderRadius: 1 },
                    '&::-webkit-scrollbar-thumb': { background: 'rgba(0,0,0,0.15)', borderRadius: 1 },
                  }}
                >
                  <Table stickyHeader size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem', width: 60 }} />
                        <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                          <TableSortLabel
                            active={jobOrdersSortField === 'jobOrderNumber'}
                            direction={jobOrdersSortField === 'jobOrderNumber' ? jobOrdersSortDirection : 'desc'}
                            onClick={() => {
                              setJobOrdersSortField('jobOrderNumber');
                              setJobOrdersSortDirection((d) => (d === 'desc' ? 'asc' : 'desc'));
                              setJobOrdersPage(0);
                            }}
                          >
                            #
                          </TableSortLabel>
                        </TableCell>
                        <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>Title</TableCell>
                        <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>Job Title</TableCell>
                        <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>Status</TableCell>
                        <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>Requested/Filled</TableCell>
                        <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                          <TableSortLabel
                            active={jobOrdersSortField === 'recruiterName'}
                            direction={jobOrdersSortField === 'recruiterName' ? jobOrdersSortDirection : 'asc'}
                            onClick={() => {
                              setJobOrdersSortField('recruiterName');
                              setJobOrdersSortDirection((d) => (d === 'desc' ? 'asc' : 'desc'));
                              setJobOrdersPage(0);
                            }}
                          >
                            Recruiter(s)
                          </TableSortLabel>
                        </TableCell>
                        <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>Age</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {paginatedLocationJobOrders.map((jobOrder, index) => (
                        <TableRow
                          key={jobOrder.id}
                          hover
                          onClick={() => navigate(`/jobs/job-orders/${jobOrder.id}`)}
                          sx={{
                            cursor: 'pointer',
                            backgroundColor: index % 2 === 0 ? 'background.paper' : 'action.hover',
                            '&:hover': { backgroundColor: 'action.selected' },
                          }}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <FavoriteButton
                              itemId={jobOrder.id}
                              favoriteType="jobOrders"
                              isFavorite={isJobOrderFavorite}
                              toggleFavorite={toggleJobOrderFavorite}
                              size="small"
                              tooltipText={{ favorited: 'Remove from favorites', notFavorited: 'Add to favorites' }}
                            />
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" fontWeight={600}>
                              {formatJobOrderNumber(jobOrder.jobOrderNumber)}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" fontWeight={500}>
                              {jobOrder.jobOrderName ?? '—'}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">{jobOrder.jobTitle || 'No Job Title'}</Typography>
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={jobOrder.status ?? '—'}
                              color={getJobOrderStatusColor(jobOrder.status ?? '') as any}
                              size="small"
                            />
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">
                              {jobOrder.workersNeeded ?? 0} / {jobOrder.headcountFilled ?? 0}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {jobOrder.workersNeeded != null && jobOrder.headcountFilled != null
                                ? `${Math.round(((jobOrder.headcountFilled ?? 0) / (jobOrder.workersNeeded || 1)) * 100)}% filled`
                                : '0% filled'}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <PersonIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                              <Typography variant="body2">{jobOrder.recruiterName || 'Unassigned'}</Typography>
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">{getJobOrderAge(jobOrder.createdAt)} days</Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <StandardTablePagination
                  count={filteredLocationJobOrders.length}
                  page={jobOrdersPage}
                  onPageChange={(_, newPage) => setJobOrdersPage(newPage)}
                  rowsPerPage={jobOrdersRowsPerPage}
                  onRowsPerPageChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    setJobOrdersRowsPerPage(val);
                    setJobOrdersPage(0);
                  }}
                />
              </Box>
            )}
          </Box>
        </TabPanel>

        <TabPanel value={tabValue} index={6}>
          <Card>
            <CardHeader title="Jobs Board (this location)" titleTypographyProps={{ variant: 'h6', fontWeight: 600 }} />
            <CardContent>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Job posts for job orders at this location. Open a job order to manage its job board postings.
              </Typography>
              {jobOrdersAtLocation.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No job orders at this location. Create a job order to see job board posts here.</Typography>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {jobOrdersAtLocation.map((jo) => (
                    <Button key={jo.id} component={Link} to={`/jobs/job-orders/${jo.id}`} variant="outlined" size="small" sx={{ textTransform: 'none', justifyContent: 'flex-start' }}>
                      {jo.jobOrderName ?? jo.id}
                    </Button>
                  ))}
                </Box>
              )}
            </CardContent>
          </Card>
        </TabPanel>

        <TabPanel value={tabValue} index={7}>
          <Card>
            <CardHeader title="Labor Pool (this location)" titleTypographyProps={{ variant: 'h6', fontWeight: 600 }} />
            <CardContent sx={{ pt: 0 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                User groups and smart groups are attached at the account level. Job order applicant lists appear for each job order at this location. Click a row to open the group or job order applicants.
              </Typography>
              <TableContainer component={Paper} variant="outlined" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                      <TableCell sx={{ fontWeight: 600 }} align="right">Count</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {laborPoolTableRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} sx={{ py: 3, color: 'text.secondary', textAlign: 'center' }}>
                          No labor pool items yet. Add user groups or smart groups on the account Labor Pool tab; create job orders at this location to see applicant lists here.
                        </TableCell>
                      </TableRow>
                    ) : (
                      laborPoolTableRows.map((row) => (
                        <TableRow
                          key={row.kind === 'jobOrderApplicants' ? `applicants-${row.id}` : `${row.kind}-${row.id}`}
                          hover
                          sx={{ cursor: 'pointer' }}
                          onClick={() => navigate(row.href)}
                        >
                          <TableCell>{row.label}</TableCell>
                          <TableCell>
                            {row.kind === 'userGroup' ? 'User Group' : row.kind === 'savedSmartGroup' ? 'Smart Group' : 'Applicants'}
                          </TableCell>
                          <TableCell align="right">
                            {row.kind === 'jobOrderApplicants'
                              ? (jobOrderApplicantCounts[row.id] ?? '—')
                              : (row.count ?? '—')}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </TabPanel>

        <TabPanel value={tabValue} index={8}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Customer rules, billing defaults, and uniform trickle down from the account. Override any of them for this location without changing the master Account Settings.
          </Typography>
          <Grid container spacing={3}>
            <Grid item xs={12} md={7}>
              <Card>
                <CardHeader title="Customer Rules & Policies (Defaults)" />
                <CardContent>
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                      <FormControlLabel
                        control={<Checkbox checked={locationDefaultRules.replacingExistingAgency} onChange={(e) => setLocationDefaultRules((r) => ({ ...r, replacingExistingAgency: e.target.checked }))} />}
                        label="Replacing Existing Agency"
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <FormControlLabel
                        control={<Checkbox checked={locationDefaultRules.rolloverExistingStaff} onChange={(e) => setLocationDefaultRules((r) => ({ ...r, rolloverExistingStaff: e.target.checked }))} />}
                        label="Rollover Existing Staff"
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField fullWidth size="small" label="Timeclock System" value={locationDefaultRules.timeclockSystem} onChange={(e) => setLocationDefaultRules((r) => ({ ...r, timeclockSystem: e.target.value }))} multiline rows={3} />
                    </Grid>
                    <Grid item xs={12}><TextField fullWidth size="small" label="Attendance Policy" value={locationDefaultRules.attendancePolicy} onChange={(e) => setLocationDefaultRules((r) => ({ ...r, attendancePolicy: e.target.value }))} multiline rows={3} /></Grid>
                    <Grid item xs={12}><TextField fullWidth size="small" label="No-Show Policy" value={locationDefaultRules.noShowPolicy} onChange={(e) => setLocationDefaultRules((r) => ({ ...r, noShowPolicy: e.target.value }))} multiline rows={3} /></Grid>
                    <Grid item xs={12}><TextField fullWidth size="small" label="Overtime Policy" value={locationDefaultRules.overtimePolicy} onChange={(e) => setLocationDefaultRules((r) => ({ ...r, overtimePolicy: e.target.value }))} multiline rows={3} /></Grid>
                    <Grid item xs={12}><TextField fullWidth size="small" label="Call-Off Policy" value={locationDefaultRules.callOffPolicy} onChange={(e) => setLocationDefaultRules((r) => ({ ...r, callOffPolicy: e.target.value }))} multiline rows={3} /></Grid>
                    <Grid item xs={12}><TextField fullWidth size="small" label="Injury Handling Policy" value={locationDefaultRules.injuryHandlingPolicy} onChange={(e) => setLocationDefaultRules((r) => ({ ...r, injuryHandlingPolicy: e.target.value }))} multiline rows={3} /></Grid>
                    <Grid item xs={12}><TextField fullWidth size="small" label="Discipline Policy" value={locationDefaultRules.disciplinePolicy} onChange={(e) => setLocationDefaultRules((r) => ({ ...r, disciplinePolicy: e.target.value }))} multiline rows={3} /></Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={5}>
              <Card>
                <CardHeader title="Billing & Invoicing (Defaults)" />
                <CardContent>
                  <Grid container spacing={2}>
                    <Grid item xs={12}>
                      <FormControlLabel control={<Checkbox checked={locationDefaultBilling.poRequired} onChange={(e) => setLocationDefaultBilling((b) => ({ ...b, poRequired: e.target.checked }))} />} label="PO Required" />
                    </Grid>
                    <Grid item xs={12}><TextField fullWidth size="small" label="Payment Terms" value={locationDefaultBilling.paymentTerms} onChange={(e) => setLocationDefaultBilling((b) => ({ ...b, paymentTerms: e.target.value }))} placeholder="e.g., Net 30" /></Grid>
                    <Grid item xs={12}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Invoice Delivery Method</InputLabel>
                        <Select value={locationDefaultBilling.invoiceDeliveryMethod} label="Invoice Delivery Method" onChange={(e) => setLocationDefaultBilling((b) => ({ ...b, invoiceDeliveryMethod: e.target.value }))}>
                          <MenuItem value="">—</MenuItem><MenuItem value="email">Email</MenuItem><MenuItem value="portal">Portal</MenuItem><MenuItem value="mail">Mail</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Invoice Frequency</InputLabel>
                        <Select value={locationDefaultBilling.invoiceFrequency} label="Invoice Frequency" onChange={(e) => setLocationDefaultBilling((b) => ({ ...b, invoiceFrequency: e.target.value }))}>
                          <MenuItem value="">—</MenuItem><MenuItem value="weekly">Weekly</MenuItem><MenuItem value="biweekly">Bi-weekly</MenuItem><MenuItem value="monthly">Monthly</MenuItem><MenuItem value="daily_event">Daily/Event-Based</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12}>
                      <TextField fullWidth size="small" label="Billing Notes" value={locationDefaultBilling.billingNotes} onChange={(e) => setLocationDefaultBilling((b) => ({ ...b, billingNotes: e.target.value }))} placeholder="Optional notes for billing and invoicing" multiline rows={3} />
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12}>
              <Card sx={{ mt: 0 }}>
                <CardContent>
                  <Typography variant="subtitle2" gutterBottom>Uniform / attire (location override)</Typography>
                  <TextField fullWidth multiline minRows={2} label="Uniform" placeholder="e.g. White shirt and black pants" value={locationOverrideUniform} onChange={(e) => setLocationOverrideUniform(e.target.value)} size="small" sx={{ mb: 2 }} />
                  <Button variant="contained" onClick={async () => { await saveLocationDefaults(); await saveLocationSettings(); }} disabled={locationDefaultsSaving || locationSettingsSaving} startIcon={(locationDefaultsSaving || locationSettingsSaving) ? <CircularProgress size={18} /> : <SaveIcon />}>
                    {(locationDefaultsSaving || locationSettingsSaving) ? 'Saving…' : 'Save location settings'}
                  </Button>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </TabPanel>

        {canAccessInvoicing && (
          <TabPanel value={tabValue} index={9}>
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Invoicing is managed at the account level. Same QuickBooks connection and invoices apply to this location.
              </Typography>
              {(() => {
                const qb = account?.integrations?.quickbooks;
                const qboStatus = qb?.status ?? 'not_connected';
                const isMapped = qboStatus === 'mapped';
                const isConnected = qboStatus === 'connected_unmapped' || isMapped || qboStatus === 'sync_error';
                return (
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 2 }}>
                      <ToggleButtonGroup size="small" value={invoicingSubView} exclusive onChange={(_, v) => v != null && setInvoicingSubView(v)} aria-label="Invoicing view">
                        <ToggleButton value="invoices">Invoices</ToggleButton>
                        <ToggleButton value="ar">A/R Aging</ToggleButton>
                        <ToggleButton value="payments">Payments</ToggleButton>
                        <ToggleButton value="mapping">Mapping / Settings</ToggleButton>
                      </ToggleButtonGroup>
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        {qb?.lastSyncAt ? `Last synced: ${typeof qb.lastSyncAt?.toDate === 'function' ? qb.lastSyncAt.toDate().toLocaleString() : '—'}` : 'Not synced yet'}
                      </Typography>
                    </Box>
                    {invoicingSubView === 'invoices' && (
                      <Card variant="outlined"><CardContent>
                        {!isConnected && <Alert severity="info" sx={{ mb: 2 }}>No QuickBooks connection for this account yet.</Alert>}
                        <TableContainer component={Paper} variant="outlined" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                          <Table size="small">
                            <TableHead><TableRow sx={{ bgcolor: 'grey.50' }}>
                              <TableCell sx={{ fontWeight: 600 }}>Invoice #</TableCell>
                              <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                              <TableCell sx={{ fontWeight: 600 }}>Due Date</TableCell>
                              <TableCell sx={{ fontWeight: 600 }} align="right">Total</TableCell>
                              <TableCell sx={{ fontWeight: 600 }} align="right">Balance</TableCell>
                              <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                              <TableCell sx={{ fontWeight: 600, width: 120 }}>Actions</TableCell>
                            </TableRow></TableHead>
                            <TableBody>{[]}</TableBody>
                          </Table>
                        </TableContainer>
                      </CardContent></Card>
                    )}
                    {invoicingSubView === 'ar' && (
                      <Card variant="outlined"><CardContent>
                        {!isConnected && <Alert severity="info" sx={{ mb: 2 }}>Connect QuickBooks and map this account to view aging.</Alert>}
                        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
                          {['Total Open A/R', 'Current', '1–30', '31–60', '61–90', '90+'].map((label, i) => (
                            <Card key={label} variant="outlined" sx={{ minWidth: i === 0 ? 120 : 100 }}>
                              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                                <Typography variant="caption" color="text.secondary">{label}</Typography>
                                <Typography variant={i === 0 ? 'h6' : 'body1'}>—</Typography>
                              </CardContent>
                            </Card>
                          ))}
                        </Box>
                        <TableContainer component={Paper} variant="outlined" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                          <Table size="small">
                            <TableHead><TableRow sx={{ bgcolor: 'grey.50' }}>
                              <TableCell sx={{ fontWeight: 600 }}>Invoice #</TableCell>
                              <TableCell sx={{ fontWeight: 600 }}>Due Date</TableCell>
                              <TableCell sx={{ fontWeight: 600 }} align="right">Days overdue</TableCell>
                              <TableCell sx={{ fontWeight: 600 }} align="right">Balance</TableCell>
                              <TableCell sx={{ fontWeight: 600 }}>Bucket</TableCell>
                            </TableRow></TableHead>
                            <TableBody>{[]}</TableBody>
                          </Table>
                        </TableContainer>
                      </CardContent></Card>
                    )}
                    {invoicingSubView === 'payments' && (
                      <Card variant="outlined"><CardContent>
                        <Alert severity="info" sx={{ mb: 2 }}>Payments will appear here after sync.</Alert>
                        <TableContainer component={Paper} variant="outlined" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                          <Table size="small">
                            <TableHead><TableRow sx={{ bgcolor: 'grey.50' }}>
                              <TableCell sx={{ fontWeight: 600 }}>Payment Date</TableCell>
                              <TableCell sx={{ fontWeight: 600 }} align="right">Amount</TableCell>
                              <TableCell sx={{ fontWeight: 600 }}>Reference #</TableCell>
                              <TableCell sx={{ fontWeight: 600 }}>Applied Invoices</TableCell>
                            </TableRow></TableHead>
                            <TableBody>{[]}</TableBody>
                          </Table>
                        </TableContainer>
                      </CardContent></Card>
                    )}
                    {invoicingSubView === 'mapping' && (
                      <Card variant="outlined"><CardContent>
                        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>QuickBooks mapping</Typography>
                        {!isConnected && (
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            Connect QuickBooks to view invoices, balances, and payment activity for this account.
                          </Typography>
                        )}
                        {isConnected && !isMapped && (
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            This account is not yet linked to a QuickBooks customer. Use the account Invoicing tab to link.
                          </Typography>
                        )}
                        {isMapped && (
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            Linked to: {qb?.customerDisplayName ?? qb?.customerId ?? '—'}
                          </Typography>
                        )}
                      </CardContent></Card>
                    )}
                  </Box>
                );
              })()}
            </Box>
          </TabPanel>
        )}

        <TabPanel value={tabValue} index={10}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Set default staff instructions and order details for this location. They trickle down from the account; edit here to override for this location only. Job orders at this location can override again.
          </Typography>
          <Box sx={{ mb: 2 }}>
            <ToggleButtonGroup size="small" value={orderDefaultsSubView} exclusive onChange={(_, v) => v != null && setOrderDefaultsSubView(v)} aria-label="Order defaults view">
              <ToggleButton value="staffInstructions">Staff Instructions</ToggleButton>
              <ToggleButton value="orderDetails">Order Details</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          {orderDefaultsSubView === 'staffInstructions' && tenantId && accountId && locationKey && (
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <AccountOrderDefaultsCard title="First Day Instructions" fieldKey="firstDay" placeholder="Enter first day instructions (e.g., arrival time, what to bring, who to meet...)" uploadPlaceholder="Upload first day schedules or orientation materials" account={account} accountId={accountId} tenantId={tenantId} userId={user?.uid || ''} onRefresh={() => {}} locationKey={locationKey} locationDefaults={locationDefaults as any} onRefreshLocation={refreshLocationDefaults} />
              </Grid>
              <Grid item xs={12}><AccountOrderDefaultsCard title="Parking Instructions" fieldKey="parking" placeholder="Enter parking instructions for staff" uploadPlaceholder="Upload parking maps or diagrams" account={account} accountId={accountId} tenantId={tenantId} userId={user?.uid || ''} onRefresh={() => {}} locationKey={locationKey} locationDefaults={locationDefaults as any} onRefreshLocation={refreshLocationDefaults} /></Grid>
              <Grid item xs={12}><AccountOrderDefaultsCard title="Check-In Instructions" fieldKey="checkIn" placeholder="Enter check-in instructions" uploadPlaceholder="Upload check-in forms or maps" account={account} accountId={accountId} tenantId={tenantId} userId={user?.uid || ''} onRefresh={() => {}} locationKey={locationKey} locationDefaults={locationDefaults as any} onRefreshLocation={refreshLocationDefaults} /></Grid>
              <Grid item xs={12}><AccountOrderDefaultsCard title="Uniform Instructions" fieldKey="uniform" placeholder="Enter uniform and dress code requirements" uploadPlaceholder="Upload uniform photos or dress code guides" account={account} accountId={accountId} tenantId={tenantId} userId={user?.uid || ''} onRefresh={() => {}} locationKey={locationKey} locationDefaults={locationDefaults as any} onRefreshLocation={refreshLocationDefaults} /></Grid>
              <Grid item xs={12}><AccountOrderDefaultsCard title="Credential Instructions" fieldKey="credentials" placeholder="Enter credential requirements" uploadPlaceholder="Upload credential forms or badge photos" account={account} accountId={accountId} tenantId={tenantId} userId={user?.uid || ''} onRefresh={() => {}} locationKey={locationKey} locationDefaults={locationDefaults as any} onRefreshLocation={refreshLocationDefaults} /></Grid>
              <Grid item xs={12}><AccountOrderDefaultsCard title="Other Instructions" fieldKey="other" placeholder="Enter any additional instructions for staff" uploadPlaceholder="Upload any other relevant documents" account={account} accountId={accountId} tenantId={tenantId} userId={user?.uid || ''} onRefresh={() => {}} locationKey={locationKey} locationDefaults={locationDefaults as any} onRefreshLocation={refreshLocationDefaults} /></Grid>
              <Grid item xs={12}><AccountOrderDefaultsCard title="Other Attachments" fieldKey="attachments" placeholder="" uploadPlaceholder="Upload any other relevant documents for job orders at this location" account={account} accountId={accountId} tenantId={tenantId} userId={user?.uid || ''} onRefresh={() => {}} locationKey={locationKey} locationDefaults={locationDefaults as any} onRefreshLocation={refreshLocationDefaults} /></Grid>
            </Grid>
          )}
          {orderDefaultsSubView === 'orderDetails' && tenantId && accountId && (
            <AccountOrderDetailsForm
              account={account}
              accountId={accountId}
              tenantId={tenantId}
              userId={user?.uid || ''}
              locationKey={locationKey ?? undefined}
              locationDefaults={locationDefaults as any}
              onRefreshLocation={refreshLocationDefaults}
              contacts={contactsAtLocation}
              inheritanceParentAccount={orderDefaultsInheritanceParent}
            />
          )}
        </TabPanel>

        <TabPanel value={tabValue} index={11}>
          <Card>
            <CardHeader title="Reports" titleTypographyProps={{ variant: 'h6', fontWeight: 600 }} />
            <CardContent>
              <Typography variant="body2" color="text.secondary">
                Reports are scoped for this account location. The same reusable report components used here will appear in the main Reports layout.
              </Typography>
            </CardContent>
          </Card>
        </TabPanel>

        <TabPanel value={tabValue} index={12}>
          <Card>
            <CardHeader title="Activity" titleTypographyProps={{ variant: 'h6', fontWeight: 600 }} />
            <CardContent>
              <Typography variant="body2" color="text.secondary">
                Activity for this location. Recent changes and events at this location will appear here.
              </Typography>
            </CardContent>
          </Card>
        </TabPanel>
      </Box>

      <Dialog open={manageLocationContactsOpen} onClose={() => { setManageLocationContactsOpen(false); setSelectedLocationContactOption(null); }} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Typography variant="h6">Contacts</Typography>
            <IconButton onClick={() => { setManageLocationContactsOpen(false); setSelectedLocationContactOption(null); }}>
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
                Current Contacts ({contactsAtLocation.length})
              </Typography>
              {contactsAtLocation.length > 0 ? (
                <List sx={{ bgcolor: 'grey.50', borderRadius: 1 }}>
                  {contactsAtLocation.map((c) => (
                    <ListItem key={c.id} sx={{ py: 1 }}>
                      <ListItemAvatar>
                        <Avatar sx={{ width: 40, height: 40, bgcolor: 'grey.100', color: 'text.primary', fontSize: '1rem' }}>
                          {(c.firstName?.[0] || c.lastName?.[0] || '?').toUpperCase()}
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={c.fullName || [c.firstName, c.lastName].filter(Boolean).join(' ') || '—'}
                      />
                      <ListItemSecondaryAction>
                        <IconButton
                          edge="end"
                          onClick={() => handleRemoveContactFromLocation(c.id)}
                          color="error"
                          disabled={locationContactsModalSaving}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </ListItemSecondaryAction>
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Box sx={{ textAlign: 'center', py: 3, bgcolor: 'grey.50', borderRadius: 1 }}>
                  <Typography variant="body2" color="text.secondary">
                    No contacts at this location yet
                  </Typography>
                </Box>
              )}
            </Box>
            <Divider sx={{ my: 2 }} />
            <Box>
              <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
                Add Contacts
              </Typography>
              {companyContactsLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : (() => {
                const availableToAdd = companyContactsList.filter((c) => !contactsAtLocation.some((x) => x.id === c.id));
                const serializableOptions = availableToAdd.map((c) => ({
                  id: c.id,
                  label: c.fullName || [c.firstName, c.lastName].filter(Boolean).join(' ') || '—',
                }));
                return serializableOptions.length > 0 ? (
                  <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}>
                    <Autocomplete
                      fullWidth
                      options={serializableOptions}
                      value={selectedLocationContactOption}
                      onChange={(_, newValue) => setSelectedLocationContactOption(newValue)}
                      getOptionLabel={(option) => option.label || 'Unknown'}
                      isOptionEqualToValue={(opt, val) => opt.id === val?.id}
                      renderInput={(params) => (
                        <TextField {...params} label="Select Contact" placeholder="Search contacts..." />
                      )}
                      getOptionKey={(option) => option.id}
                    />
                    <Button
                      variant="contained"
                      startIcon={locationContactsModalSaving ? <CircularProgress size={16} /> : <AddIcon />}
                      onClick={() => {
                        if (selectedLocationContactOption) {
                          handleAddContactToLocation(selectedLocationContactOption.id);
                          setSelectedLocationContactOption(null);
                        }
                      }}
                      disabled={!selectedLocationContactOption || locationContactsModalSaving}
                      sx={{ textTransform: 'none', borderRadius: 999, minWidth: 110 }}
                    >
                      Add
                    </Button>
                  </Box>
                ) : (
                  <Box sx={{ textAlign: 'center', py: 3, bgcolor: 'grey.50', borderRadius: 1 }}>
                    <Typography variant="body2" color="text.secondary">
                      No additional company contacts available to add
                    </Typography>
                  </Box>
                );
              })()}
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setManageLocationContactsOpen(false); setSelectedLocationContactOption(null); }} variant="outlined" sx={{ textTransform: 'none', borderRadius: 999 }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={deleteConfirmUploadId != null}
        onClose={() => setDeleteConfirmUploadId(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete file?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            This will permanently remove the file from storage. This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmUploadId(null)} color="inherit">
            Cancel
          </Button>
          <Button
            onClick={() => deleteConfirmUploadId != null && handleDeleteLocationUpload(deleteConfirmUploadId)}
            color="error"
            variant="contained"
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <AddJobOrderModal
        open={showNewJobOrderModal}
        onClose={() => setShowNewJobOrderModal(false)}
        onSaved={fetchLocationJobOrders}
        tenantId={tenantId ?? ''}
        userId={user?.uid ?? ''}
        recruiterAccountId={accountId ?? null}
        requireAccountSelection
        defaultHiringEntityId={account?.hiringEntityId ?? null}
        accountCompanies={
          accountCompaniesOptions.length
            ? accountCompaniesOptions.map((c) => ({
                id: c.id,
                label: c.companyName ?? c.label ?? c.id,
                companyName: c.companyName ?? c.label ?? c.id,
                name: c.companyName ?? c.label ?? c.id,
              }))
            : undefined
        }
        defaultCompanyId={
          resolvedCompanyId ??
          (account?.associations?.companyIds?.length === 1 ? account.associations.companyIds[0] : null)
        }
        defaultWorksiteId={locationId ?? null}
        jobTitleOptions={
          locationPricingPositions.length > 0
            ? [...new Set(locationPricingPositions.map((p) => p.jobTitle).filter(Boolean))]
            : undefined
        }
      />
    </Box>
  );
}
