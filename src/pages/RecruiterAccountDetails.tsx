/**
 * Recruiter Account Details – Record layout for a single account.
 * Follows the same Record spec as Company/User/Deal: PageHeader, tabs, and 3rd column association widgets.
 */

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardActions,
  CardContent,
  CardHeader,
  Button,
  IconButton,
  CircularProgress,
  TextField,
  FormControlLabel,
  Switch,
  Chip,
  Avatar,
  Grid,
  Autocomplete,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  ListItemSecondaryAction,
  ListSubheader,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Paper,
  Alert,
  Stack,
  InputAdornment,
  ToggleButton,
  ToggleButtonGroup,
  Skeleton,
  Badge,
  Tooltip,
} from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import {
  AccountBalance as AccountBalanceIcon,
  Business as BusinessIcon,
  Edit as EditIcon,
  Dashboard as DashboardIcon,
  LocationOn as LocationOnIcon,
  Person as PersonIcon,
  Work as WorkIcon,
  AttachMoney as AttachMoneyIcon,
  GroupWork as GroupWorkIcon,
  Sell as SellIcon,
  Badge as BadgeIcon,
  Close as CloseIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  Upload as UploadIcon,
  OpenInNew as OpenInNewIcon,
  Search as SearchIcon,
  Clear as ClearIcon,
  AccountTree as AccountTreeIcon,
  Settings as SettingsIcon,
  Save as SaveIcon,
  Refresh as RefreshIcon,
  Receipt as ReceiptIcon,
  LinkedIn as LinkedInIcon,
  Assessment as ReportsIcon,
  Note as NoteIcon,
  Notes as NotesIcon,
  Sync as SyncIcon,
  ViewList as ViewListIcon,
  Layers as LayersIcon,
  FactCheckOutlined as FactCheckOutlinedIcon,
} from '@mui/icons-material';
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  deleteDoc,
  setDoc,
  addDoc,
  onSnapshot,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';

import { db, storage, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { LOCATION_FACILITY_TYPE_OPTIONS } from '../constants/locationFacilityTypeOptions';
import { getDealCompanyIds } from '../utils/associationsAdapter';
import { useAuth } from '../contexts/AuthContext';
import { p } from '../data/firestorePaths';
import type {
  RecruiterAccount,
  RecruiterAccountAssociations,
  RecruiterAccountFormData,
  AccountLocationRef,
} from '../types/recruiter/account';
import type { AccountPositionPricing } from '../types/recruiter/account';
import PageHeader from '../components/PageHeader';
import UniversalBackButton from '../components/common/UniversalBackButton';
import FavoriteButton from '../components/FavoriteButton';
import InboxSearchBar from '../components/InboxSearchBar';
import FavoritesFilter from '../components/FavoritesFilter';
import StandardTablePagination from '../components/StandardTablePagination';
import { useFavorites } from '../hooks/useFavorites';
import { useSetTopBarTitle } from '../contexts/TopBarTitleContext';
import { useEntity } from '../hooks/useEntity';
import { getJobOrderAge } from '../utils/dateUtils';
import { getJobOrderChecklistProgress } from '../components/recruiter/JobOrderChecklist';
import AccountOrderDefaultsCard from '../components/recruiter/AccountOrderDefaultsCard';
import AccountOrderDetailsForm, {
  type AccountOrderDetailsFormHandle,
} from '../components/recruiter/AccountOrderDetailsForm';
import PushToActiveBanner, {
  type PushToActiveBannerPayload,
} from '../components/recruiter/PushToActiveBanner';
// **R.16.3 (interim — Path 1)** — Per-field manual "Sync to active"
// button. Mirrors the banner's `canPushToActive` gate; lets admins
// re-push the current value without editing the field first.
import SyncToActiveButton from '../components/recruiter/SyncToActiveButton';
import type { PushFieldKey } from '../components/recruiter/PushToActiveDialog';
import AccountShiftsTab from '../components/recruiter/AccountShiftsTab';
import AccountCalendarTab from '../components/recruiter/AccountCalendarTab';
import ActiveWorkersTable, {
  type ActiveWorkersSubAccountGrouping,
} from '../components/recruiter/ActiveWorkersTable';
import AccountWorkforceTab, {
  type WorkforceSubAccountGrouping,
} from '../components/recruiter/AccountWorkforceTab';
import RecruiterMultiSelect, {
  type RecruiterOption,
} from '../components/recruiter/RecruiterMultiSelect';
import AddJobOrderModal from '../components/recruiter/AddJobOrderModal';
import AddAccountModal from '../components/recruiter/AddAccountModal';
import DefaultGigSettings from '../components/recruiter/DefaultGigSettings';
import { PositionComplianceOverridesDialog } from '../components/recruiter/PositionComplianceOverridesDialog';
import type { JobOrder } from '../types/Phase1Types';
import jobTitlesData from '../data/onetJobTitles.json';
import { JobsBoardService, type JobsBoardPost } from '../services/recruiter/jobsBoardService';
import { getSutaRateByState, getFutaRateByState, normalizeStateCode, US_STATE_CODES } from '../utils/unemploymentRates';
import {
  buildWorkersCompRatesMapsFromSnapshot,
  pickWorkersCompJobTitleLookup,
  resolveWorkersCompModifierAccountId,
} from '../utils/workersCompRateMaps';
import { canAccessAccountInvoicingTab } from '../utils/invoicingAccessControl';
import { numberInputNoSpinnerSx } from '../utils/numberInputNoSpinner';
import { Autocomplete as GoogleAutocomplete } from '@react-google-maps/api';
import { ensureCityInSmartGroups } from '../services/smartGroupMetroSync';
import {
  extractAccountPricingPositions,
  mergeNationalTemplateWithChildVenueRow,
} from '../utils/accountPricingForJobOrder';
import AddNoteDialog from '../components/AddNoteDialog';
import CRMNotesTab from '../components/CRMNotesTab';
import {
  recordHeaderActionIconButtonSx,
  recordHeaderBodyTextSx,
  recordHeaderTooltipComponentsProps,
} from './UserProfile/components/recordHeaderStyles';
import RecordHeaderActionIcon from './UserProfile/components/RecordHeaderActionIcon';
import {
  DEFAULT_ACCOUNT_SETTINGS_SECTION,
  LEGACY_ACCOUNT_TAB_REDIRECTS,
  isAccountSettingsSection,
  type AccountSettingsSection,
} from '../config/accountSettingsNavigation';

interface JobOrderWithDetails extends JobOrder {
  companyName?: string;
  locationName?: string;
  worksiteCity?: string;
  recruiterName?: string;
  workersNeeded?: number;
  headcountFilled?: number;
  jobTitle?: string;
}

/**
 * Helpers for computing the "next upcoming shift" for a Gig job order on the
 * Account Job Orders tab. We keep this simple on purpose — full occurrence
 * generation with per-day overrides lives in `useGigJobOrdersCalendar`. This
 * version handles:
 *   - single-day shifts (shiftDate + defaultStartTime)
 *   - multi-day shifts with a weeklySchedule (per-DOW start times / disable)
 *   - multi-day shifts with a per-date dateSchedule map
 *
 * Returns the earliest Date >= `now` across all provided shifts, or null.
 */
function parseYyyyMmDdLocal(s: string | undefined | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}
function formatYyyyMmDdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function makeShiftDateTime(day: Date, hhmm: string): Date | null {
  if (!/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const out = new Date(day);
  out.setHours(h, m, 0, 0);
  return out;
}
function nextShiftStartForJobOrder(shifts: Array<Record<string, any>>, now: Date): Date | null {
  let best: Date | null = null;
  for (const shift of shifts) {
    const shiftDate = typeof shift.shiftDate === 'string' ? shift.shiftDate : '';
    const endDate = typeof shift.endDate === 'string' ? shift.endDate : '';
    const defStart = typeof shift.defaultStartTime === 'string' ? shift.defaultStartTime : '00:00';
    const startD = parseYyyyMmDdLocal(shiftDate);
    if (!startD) continue;
    // Cancelled / closed shifts shouldn't drive "next shift".
    const status = typeof shift.status === 'string' ? shift.status.toLowerCase() : '';
    if (status === 'cancelled' || status === 'canceled' || status === 'closed') continue;

    const isMulti = shift.shiftMode === 'multi' && !!endDate && endDate !== shiftDate;
    const endD = isMulti ? parseYyyyMmDdLocal(endDate) : startD;
    if (!endD) continue;
    const dateSched =
      shift.dateSchedule && typeof shift.dateSchedule === 'object'
        ? (shift.dateSchedule as Record<string, { enabled?: boolean; startTime?: string }>)
        : null;
    const weekly =
      shift.weeklySchedule && typeof shift.weeklySchedule === 'object'
        ? (shift.weeklySchedule as Record<string, { enabled?: boolean; startTime?: string }>)
        : null;
    const cursor = new Date(startD);
    while (cursor.getTime() <= endD.getTime()) {
      const dateStr = formatYyyyMmDdLocal(cursor);
      let enabled = true;
      let startTime = defStart;
      if (dateSched && dateSched[dateStr]) {
        const entry = dateSched[dateStr];
        if (entry.enabled === false) enabled = false;
        else if (entry.startTime) startTime = entry.startTime;
      } else if (weekly) {
        const dow = String(cursor.getDay());
        const sched = weekly[dow];
        if (sched?.enabled === false) enabled = false;
        else if (sched?.startTime) startTime = sched.startTime;
      }
      if (enabled) {
        const dt = makeShiftDateTime(cursor, startTime);
        if (dt && dt.getTime() >= now.getTime()) {
          if (!best || dt.getTime() < best.getTime()) best = dt;
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return best;
}
/** "Apr 30 · 7:00 AM" — compact label used in the row caption. */
function formatNextShiftLabel(d: Date): string {
  const dateLabel = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const timeLabel = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${dateLabel} · ${timeLabel}`;
}

// SectionCard – same pattern as DealDetails 3rd column; optional titleHref for header link to list page
const SectionCard: React.FC<{
  title: string;
  titleHref?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, titleHref, action, children }) => (
  <Card>
    <CardHeader
      title={
        titleHref ? (
          <Link to={titleHref} style={{ color: 'inherit', textDecoration: 'none' }} className="section-card-title-link">
            <Typography component="span" variant="h6" fontWeight={600}>
              {title}
            </Typography>
          </Link>
        ) : (
          title
        )
      }
      action={action}
      sx={{ p: 2, pb: 1 }}
      titleTypographyProps={{ variant: 'h6', fontWeight: 600 }}
    />
    <CardContent sx={{ p: 2, pt: 0 }}>{children}</CardContent>
  </Card>
);

type ManageDialogOption = {
  id: string;
  label: string;
  secondary?: string;
  icon?: React.ReactNode;
  group?: string;
};

const ManageAssociationDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  currentItems: ManageDialogOption[];
  availableOptions: ManageDialogOption[];
  selectionLabel: string;
  selectionPlaceholder?: string;
  onAdd: (item: ManageDialogOption) => void;
  onRemove: (id: string) => void;
  groupBy?: (option: ManageDialogOption) => string;
  /** Rendered below the add row (e.g. create-new shortcut for Locations) */
  addSectionFooter?: React.ReactNode;
}> = ({
  open,
  onClose,
  title,
  currentItems,
  availableOptions,
  selectionLabel,
  selectionPlaceholder,
  onAdd,
  onRemove,
  groupBy,
  addSectionFooter,
}) => {
  const [selectedOption, setSelectedOption] = useState<{ id: string; label: string; secondary?: string } | null>(null);

  useEffect(() => {
    if (!open) setSelectedOption(null);
  }, [open]);

  const availableToAdd = availableOptions.filter((option) => !currentItems.some((item) => item.id === option.id));
  // Autocomplete must receive serializable options only (no React elements) to avoid "Converting circular structure to JSON"
  const serializableOptions = availableToAdd.map(({ id, label, secondary }) => ({ id, label, secondary }));

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6">{title}</Typography>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 1 }}>
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
              Current {title} ({currentItems.length})
            </Typography>
            {currentItems.length > 0 ? (
              <List sx={{ bgcolor: 'grey.50', borderRadius: 1 }}>
                {currentItems.map((item) => (
                  <ListItem key={item.id} sx={{ py: 1 }}>
                    <ListItemAvatar>
                      {item.icon ? (
                        <Avatar sx={{ width: 40, height: 40, bgcolor: 'grey.100', color: 'text.primary' }}>
                          {item.icon}
                        </Avatar>
                      ) : (
                        <Avatar sx={{ width: 40, height: 40, fontSize: '1rem' }}>
                          {item.label?.charAt(0) || '?'}
                        </Avatar>
                      )}
                    </ListItemAvatar>
                    <ListItemText primary={item.label} secondary={item.secondary} />
                    <ListItemSecondaryAction>
                      <IconButton edge="end" onClick={() => onRemove(item.id)} color="error">
                        <DeleteIcon />
                      </IconButton>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
            ) : (
              <Box sx={{ textAlign: 'center', py: 3, bgcolor: 'grey.50', borderRadius: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  No items added yet
                </Typography>
              </Box>
            )}
          </Box>

          <Divider sx={{ my: 2 }} />

          <Box>
            <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
              Add {title}
            </Typography>
            {serializableOptions.length > 0 ? (
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}>
                <Autocomplete
                  fullWidth
                  options={serializableOptions}
                  groupBy={groupBy}
                  value={selectedOption}
                  onChange={(_, newValue) => setSelectedOption(newValue)}
                  getOptionLabel={(option) => [option.label, option.secondary].filter(Boolean).join(' · ') || 'Unknown'}
                  isOptionEqualToValue={(opt, val) => opt.id === val?.id}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label={selectionLabel}
                      placeholder={selectionPlaceholder}
                    />
                  )}
                  getOptionKey={(option) => option.id}
                  renderOption={(props, option) => {
                    // key comes from MUI Autocomplete; omit from spread per React guidance
                    const { key: _listKey, ...otherProps } = props; // eslint-disable-line react/prop-types
                    return (
                      <li key={option.id} {...otherProps}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Avatar sx={{ width: 24, height: 24, fontSize: '0.75rem' }}>{option.label?.charAt(0) || '?'}</Avatar>
                          <Box>
                            <Typography variant="body2">{option.label}</Typography>
                            {option.secondary && (
                              <Typography variant="caption" color="text.secondary">
                                {option.secondary}
                              </Typography>
                            )}
                          </Box>
                        </Box>
                      </li>
                    );
                  }}
                />
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={() => {
                    if (selectedOption) {
                      onAdd(selectedOption);
                      setSelectedOption(null);
                    }
                  }}
                  disabled={!selectedOption}
                  sx={{ textTransform: 'none', borderRadius: 999, minWidth: 110 }}
                >
                  Add
                </Button>
              </Box>
            ) : (
              <Box sx={{ textAlign: 'center', py: 3, bgcolor: 'grey.50', borderRadius: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  No additional options available to add
                </Typography>
              </Box>
            )}
            {addSectionFooter}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="outlined" sx={{ textTransform: 'none', borderRadius: 999 }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
  /**
   * Merged onto the default tab-panel wrapper (`px: 2`, `pb: 2`).
   * Use `{ px: 0 }` on Shifts so `ShiftsTable` / `ShiftsCalendarView` supply the
   * same horizontal inset as `/shifts` (single `px: 2`), not double padding.
   */
  contentSx?: SxProps<Theme>;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, contentSx, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`account-tabpanel-${index}`}
      aria-labelledby={`account-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box
          sx={
            [
              { px: 2, pb: 2 },
              ...(contentSx != null ? [contentSx] : []),
            ] as SxProps<Theme>
          }
        >
          {children}
        </Box>
      )}
    </div>
  );
}

interface AccountSidebarProps {
  account: RecruiterAccount;
  tenantId: string;
  navigate: (path: string) => void;
  updateAccountAssociations: (partial: Partial<RecruiterAccountAssociations>) => Promise<void>;
  companies: CompanyOption[];
  locationsByCompany: Record<string, LocationOption[]>;
  contacts: ContactOption[];
  jobOrders: JobOrderOption[];
  deals: DealOption[];
  laborPoolOptions: LaborPoolOption[];
  salespeopleOptions: PersonOption[];
  recruitersOptions: PersonOption[];
  accountOptions: AccountOption[];
  parentAccount: AccountOption | null;
  childAccounts: AccountOption[];
  mspAccounts?: AccountOption[];
  onParentAccountChange: (parentAccountId: string | null) => Promise<void>;
  onChildAccountsChange: (childAccountIds: string[]) => Promise<void>;
  onMspAccountsChange?: (mspAccountIds: string[]) => Promise<void>;
  optionsLoading: boolean;
  saving: boolean;
  visibleSections?: Array<'activity' | 'company' | 'relatedAccounts' | 'location' | 'contacts' | 'jobOrders' | 'deals' | 'salespeople' | 'recruiters' | 'laborPool' | 'jobsBoard'>;
  /** When set (e.g. for child accounts), location options come from parent's companies instead of account's companyIds. */
  parentCompanyIds?: string[];
  /** Open the same Add New Location dialog as the account / company flow; location is created on the linked company (parent's company for child accounts). */
  onAddNewLocation?: () => void;
  addNewLocationEnabled?: boolean;
}

function AccountSidebar({
  account,
  tenantId,
  navigate,
  updateAccountAssociations,
  companies,
  locationsByCompany,
  contacts,
  jobOrders,
  deals,
  laborPoolOptions,
  salespeopleOptions,
  recruitersOptions,
  accountOptions,
  parentAccount,
  childAccounts,
  mspAccounts = [],
  onParentAccountChange,
  onChildAccountsChange,
  onMspAccountsChange = async () => {},
  optionsLoading,
  saving,
  visibleSections = ['activity', 'company', 'relatedAccounts', 'location', 'contacts', 'jobOrders', 'deals', 'salespeople', 'recruiters', 'laborPool'],
  parentCompanyIds,
  onAddNewLocation,
  addNewLocationEnabled = false,
}: AccountSidebarProps) {
  const [manageCompaniesOpen, setManageCompaniesOpen] = useState(false);
  const [manageLocationsOpen, setManageLocationsOpen] = useState(false);
  const [manageContactsOpen, setManageContactsOpen] = useState(false);
  const [manageJobOrdersOpen, setManageJobOrdersOpen] = useState(false);
  const [manageDealsOpen, setManageDealsOpen] = useState(false);
  const [manageSalespeopleOpen, setManageSalespeopleOpen] = useState(false);
  const [manageRecruitersOpen, setManageRecruitersOpen] = useState(false);
  const [manageLaborPoolOpen, setManageLaborPoolOpen] = useState(false);
  const [manageRelatedAccountsOpen, setManageRelatedAccountsOpen] = useState(false);
  const [relatedAccountRelationType, setRelatedAccountRelationType] = useState<'parent' | 'child' | 'msp' | ''>('');
  const [relatedAccountSelected, setRelatedAccountSelected] = useState<AccountOption | null>(null);

  const assoc = account.associations ?? {};
  const companyIds = assoc.companyIds ?? [];
  const locations = assoc.locations ?? [];
  const contactIds = assoc.contactIds ?? [];
  const jobOrderIds = assoc.jobOrderIds ?? [];
  const dealIds = assoc.dealIds ?? [];
  const userGroupIds = assoc.userGroupIds ?? [];
  const savedSmartGroupIds = assoc.savedSmartGroupIds ?? [];
  const salespersonIds = assoc.salespersonIds ?? [];
  const recruiterIds = assoc.recruiterIds ?? [];

  const selectedCompanies = companies.filter((c) => companyIds.includes(c.id));
  // Contacts: for child accounts use parent's companies (same as Location widget); otherwise account's linked companies
  const contactSourceCompanyIds = (parentCompanyIds?.length ? parentCompanyIds : companyIds) as string[];
  const contactsInSelectedCompanies = contactSourceCompanyIds.length === 0 ? [] : contacts.filter((c) => c.companyId && contactSourceCompanyIds.includes(c.companyId));
  const selectedContacts = contacts.filter((c) => contactIds.includes(c.id));
  const selectedContactsInScope = selectedContacts.filter((c) => contactsInSelectedCompanies.some((o) => o.id === c.id));
  // Locations: for child accounts use parent's companies; otherwise account's linked companies
  const locationSourceCompanyIds = (parentCompanyIds?.length ? parentCompanyIds : companyIds) as string[];
  const allLocationOptions: LocationOption[] = locationSourceCompanyIds.flatMap((cid) => locationsByCompany[cid] ?? []);
  const selectedLocations = allLocationOptions.filter(
    (loc) => locations.some((l) => l.companyId === loc.companyId && l.locationId === loc.locationId)
  );
  const selectedJobOrders = jobOrders.filter((j) => jobOrderIds.includes(j.id));
  // Deals scoped to selected companies; dropdown disabled until at least one company is selected
  const dealsInSelectedCompanies =
    companyIds.length === 0 ? [] : deals.filter((d) => d.companyIds?.some((cid) => companyIds.includes(cid)) ?? false);
  const selectedDeals = deals.filter((d) => dealIds.includes(d.id));
  const selectedDealsInScope = selectedDeals.filter((d) => dealsInSelectedCompanies.some((o) => o.id === d.id));
  const selectedLaborPool = laborPoolOptions.filter(
    (o) => (o.type === 'userGroup' && userGroupIds.includes(o.id)) || (o.type === 'savedSmartGroup' && savedSmartGroupIds.includes(o.id))
  );
  const selectedSalespeople = salespeopleOptions.filter((p) => salespersonIds.includes(p.id));
  const selectedRecruiters = recruitersOptions.filter((p) => recruiterIds.includes(p.id));
  const showSection = (section: AccountSidebarProps['visibleSections'][number]) => visibleSections.includes(section);

  const companyItems: ManageDialogOption[] = selectedCompanies.map((c) => ({ id: c.id, label: c.label, icon: <BusinessIcon fontSize="small" /> }));
  const companyOptions: ManageDialogOption[] = companies.map((c) => ({ id: c.id, label: c.label, icon: <BusinessIcon fontSize="small" /> }));
  const locationItems: ManageDialogOption[] = selectedLocations.map((loc) => {
    const company = companies.find((c) => c.id === loc.companyId);
    return {
      id: `${loc.companyId}:${loc.locationId}`,
      label: loc.label,
      secondary: company?.label,
      icon: <LocationOnIcon fontSize="small" />,
    };
  });
  const locationOptions: ManageDialogOption[] = allLocationOptions.map((loc) => {
    const company = companies.find((c) => c.id === loc.companyId);
    return {
      id: `${loc.companyId}:${loc.locationId}`,
      label: loc.label,
      secondary: company?.label,
      icon: <LocationOnIcon fontSize="small" />,
    };
  });
  const contactItems: ManageDialogOption[] = selectedContactsInScope.map((c) => ({ id: c.id, label: c.label, icon: <PersonIcon fontSize="small" /> }));
  const contactOptions: ManageDialogOption[] = contactsInSelectedCompanies.map((c) => ({ id: c.id, label: c.label, icon: <PersonIcon fontSize="small" /> }));
  const jobOrderItems: ManageDialogOption[] = selectedJobOrders.map((j) => ({ id: j.id, label: j.label, icon: <WorkIcon fontSize="small" /> }));
  const jobOrderOptions: ManageDialogOption[] = jobOrders.map((j) => ({ id: j.id, label: j.label, icon: <WorkIcon fontSize="small" /> }));
  const dealItems: ManageDialogOption[] = selectedDealsInScope.map((d) => ({ id: d.id, label: d.label, icon: <AttachMoneyIcon fontSize="small" /> }));
  const dealOptions: ManageDialogOption[] = dealsInSelectedCompanies.map((d) => ({ id: d.id, label: d.label, icon: <AttachMoneyIcon fontSize="small" /> }));
  const salespersonItems: ManageDialogOption[] = selectedSalespeople.map((p) => ({ id: p.id, label: p.label, icon: <SellIcon fontSize="small" /> }));
  const salespersonOptionsMapped: ManageDialogOption[] = salespeopleOptions.map((p) => ({ id: p.id, label: p.label, icon: <SellIcon fontSize="small" /> }));
  const recruiterItems: ManageDialogOption[] = selectedRecruiters.map((p) => ({ id: p.id, label: p.label, icon: <BadgeIcon fontSize="small" /> }));
  const recruiterOptionsMapped: ManageDialogOption[] = recruitersOptions.map((p) => ({ id: p.id, label: p.label, icon: <BadgeIcon fontSize="small" /> }));
  const laborPoolItems: ManageDialogOption[] = selectedLaborPool.map((o) => ({
    id: `${o.type}:${o.id}`,
    label: o.label,
    secondary: o.type === 'userGroup' ? 'User Group' : 'Smart Group',
    icon: <GroupWorkIcon fontSize="small" />,
    group: o.type === 'userGroup' ? 'User Groups' : 'Smart Groups',
  }));
  const laborPoolOptionsMapped: ManageDialogOption[] = laborPoolOptions.map((o) => ({
    id: `${o.type}:${o.id}`,
    label: o.label,
    secondary: o.type === 'userGroup' ? 'User Group' : 'Smart Group',
    icon: <GroupWorkIcon fontSize="small" />,
    group: o.type === 'userGroup' ? 'User Groups' : 'Smart Groups',
  }));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {showSection('activity') && (
      <SectionCard title="Recent Activity">
        <Typography variant="body2" color="text.secondary">
          No recent activity. Activities will appear here as they occur.
        </Typography>
      </SectionCard>
      )}

      {showSection('company') && (
      <SectionCard
        title="Company"
        titleHref="/companies"
        action={
          <Button
            variant="outlined"
            size="small"
            onClick={() => setManageCompaniesOpen(true)}
            sx={{ minWidth: 'auto', px: 1, py: 0.5, fontSize: '0.75rem', textTransform: 'none' }}
          >
            Edit
          </Button>
        }
      >
        {selectedCompanies.length > 0 ? (
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {selectedCompanies.map((c) => (
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
                onClick={() => navigate(`/companies/${c.id}`)}
                role="button"
                tabIndex={0}
              >
                <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem' }}>{c.label.charAt(0)}</Avatar>
                <Typography variant="body2" fontWeight="medium">
                  {c.label}
                </Typography>
              </Box>
            ))}
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No companies linked yet.
          </Typography>
        )}
      </SectionCard>
      )}

      {showSection('relatedAccounts') && (
      <SectionCard
        title="Related Accounts"
        titleHref="/accounts"
        action={
          <Button
            variant="outlined"
            size="small"
            onClick={() => setManageRelatedAccountsOpen(true)}
            sx={{ minWidth: 'auto', px: 1, py: 0.5, fontSize: '0.75rem', textTransform: 'none' }}
          >
            Edit
          </Button>
        }
      >
        {parentAccount || childAccounts.length > 0 || mspAccounts.length > 0 ? (
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {parentAccount && (
              <Box
                sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'grey.50', cursor: 'pointer' }}
                onClick={() => navigate(`/accounts/${parentAccount.id}`)}
                role="button"
                tabIndex={0}
              >
                <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem' }}>{parentAccount.label.charAt(0)}</Avatar>
                <Box>
                  <Typography variant="body2" fontWeight="medium">{parentAccount.label}</Typography>
                  <Typography variant="caption" color="text.secondary">Parent Account</Typography>
                </Box>
              </Box>
            )}
            {childAccounts.map((a) => (
              <Box
                key={a.id}
                sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'grey.50', cursor: 'pointer' }}
                onClick={() => navigate(`/accounts/${a.id}`)}
                role="button"
                tabIndex={0}
              >
                <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem' }}>{a.label.charAt(0)}</Avatar>
                <Box>
                  <Typography variant="body2" fontWeight="medium">{a.label}</Typography>
                  <Typography variant="caption" color="text.secondary">Child Account</Typography>
                </Box>
              </Box>
            ))}
            {mspAccounts.map((a) => (
              <Box
                key={a.id}
                sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'grey.50', cursor: 'pointer' }}
                onClick={() => navigate(`/accounts/${a.id}`)}
                role="button"
                tabIndex={0}
              >
                <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem' }}>{a.label.charAt(0)}</Avatar>
                <Box>
                  <Typography variant="body2" fontWeight="medium">{a.label}</Typography>
                  <Typography variant="caption" color="text.secondary">MSP</Typography>
                </Box>
              </Box>
            ))}
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No related accounts linked.
          </Typography>
        )}
      </SectionCard>
      )}

      {showSection('location') && (
      <SectionCard
        title="Worksite / Location"
        titleHref="/companies"
        action={
          <Button
            variant="outlined"
            size="small"
            onClick={() => setManageLocationsOpen(true)}
            sx={{ minWidth: 'auto', px: 1, py: 0.5, fontSize: '0.75rem', textTransform: 'none' }}
          >
            Edit
          </Button>
        }
      >
        {locationSourceCompanyIds.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {parentCompanyIds ? 'No locations on parent account yet.' : 'Select at least one company to add locations.'}
          </Typography>
        ) : (
          <>
            {selectedLocations.length > 0 && (
              <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {selectedLocations.map((loc) => {
                  const company = companies.find((c) => c.id === loc.companyId);
                  return (
                    <Box
                      key={`${loc.companyId}-${loc.locationId}`}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        p: 1,
                        borderRadius: 1,
                        bgcolor: 'grey.50',
                        cursor: 'pointer',
                      }}
                      onClick={() => navigate(`/accounts/${account.id}/locations/${loc.locationId}?companyId=${loc.companyId}`)}
                      role="button"
                      tabIndex={0}
                    >
                      <LocationOnIcon fontSize="small" />
                      <Typography variant="body2">{loc.label}</Typography>
                      {company && (
                        <Typography variant="caption" color="text.secondary">
                          {company.label}
                        </Typography>
                      )}
                      <Button
                        component={Link}
                        to={`/accounts/${account.id}/locations/${loc.locationId}?companyId=${loc.companyId}`}
                        size="small"
                        sx={{ ml: 'auto', minWidth: 'auto', fontSize: '0.7rem' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        View
                      </Button>
                    </Box>
                  );
                })}
              </Box>
            )}
          </>
        )}
      </SectionCard>
      )}

      {showSection('contacts') && (
      <SectionCard
        title="Account Contacts"
        titleHref="/contacts"
        action={
          <Button
            variant="outlined"
            size="small"
            onClick={() => setManageContactsOpen(true)}
            sx={{ minWidth: 'auto', px: 1, py: 0.5, fontSize: '0.75rem', textTransform: 'none' }}
          >
            Edit
          </Button>
        }
      >
        {contactSourceCompanyIds.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {parentCompanyIds ? 'No contacts from parent account companies yet.' : 'Select at least one company to add contacts.'}
          </Typography>
        )}
        {selectedContactsInScope.length > 0 && (
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {selectedContactsInScope.map((c) => (
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
                onClick={() => navigate(`/contacts/${c.id}`)}
                role="button"
                tabIndex={0}
              >
                <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem' }}>{c.label.charAt(0)}</Avatar>
                <Typography variant="body2">{c.label}</Typography>
                <Button
                  component={Link}
                  to={`/contacts/${c.id}`}
                  size="small"
                  sx={{ ml: 'auto', minWidth: 'auto', fontSize: '0.7rem' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  View
                </Button>
              </Box>
            ))}
          </Box>
        )}
      </SectionCard>
      )}

      {showSection('jobOrders') && (
      <SectionCard
        title="Job Order(s)"
        titleHref="/jobs/job-orders"
        action={
          <Button
            variant="outlined"
            size="small"
            onClick={() => setManageJobOrdersOpen(true)}
            sx={{ minWidth: 'auto', px: 1, py: 0.5, fontSize: '0.75rem', textTransform: 'none' }}
          >
            Edit
          </Button>
        }
      >
        {selectedJobOrders.length > 0 && (
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {selectedJobOrders.map((j) => (
              <Box
                key={j.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  p: 1,
                  borderRadius: 1,
                  bgcolor: 'grey.50',
                  cursor: 'pointer',
                }}
                onClick={() => navigate(`/jobs/job-orders/${j.id}`)}
                role="button"
                tabIndex={0}
              >
                <WorkIcon fontSize="small" />
                <Typography variant="body2">{j.label}</Typography>
                <Button
                  component={Link}
                  to={`/jobs/job-orders/${j.id}`}
                  size="small"
                  sx={{ ml: 'auto', minWidth: 'auto', fontSize: '0.7rem' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  View
                </Button>
              </Box>
            ))}
          </Box>
        )}
      </SectionCard>
      )}

      {showSection('deals') && (
      <SectionCard
        title="Deal"
        titleHref="/crm"
        action={
          <Button
            variant="outlined"
            size="small"
            onClick={() => setManageDealsOpen(true)}
            sx={{ minWidth: 'auto', px: 1, py: 0.5, fontSize: '0.75rem', textTransform: 'none' }}
          >
            Edit
          </Button>
        }
      >
        {companyIds.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Select at least one company to add deals.
          </Typography>
        ) : (
          <>
            {selectedDealsInScope.length > 0 && (
              <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {selectedDealsInScope.map((d) => (
              <Box
                key={d.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  p: 1,
                  borderRadius: 1,
                  bgcolor: 'grey.50',
                  cursor: 'pointer',
                }}
                onClick={() => navigate(`/crm/deals/${d.id}`)}
                role="button"
                tabIndex={0}
              >
                <AttachMoneyIcon fontSize="small" />
                <Typography variant="body2">{d.label}</Typography>
                <Button
                  component={Link}
                  to={`/crm/deals/${d.id}`}
                  size="small"
                  sx={{ ml: 'auto', minWidth: 'auto', fontSize: '0.7rem' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  View
                </Button>
              </Box>
            ))}
              </Box>
            )}
          </>
        )}
      </SectionCard>
      )}

      {showSection('salespeople') && (
      <SectionCard
        title="Assigned Salesperson(s)"
        titleHref="/users"
        action={
          <Button
            variant="outlined"
            size="small"
            onClick={() => setManageSalespeopleOpen(true)}
            sx={{ minWidth: 'auto', px: 1, py: 0.5, fontSize: '0.75rem', textTransform: 'none' }}
          >
            Edit
          </Button>
        }
      >
        {selectedSalespeople.length > 0 && (
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {selectedSalespeople.map((p) => (
              <Box
                key={p.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  p: 1,
                  borderRadius: 1,
                  bgcolor: 'grey.50',
                  cursor: 'pointer',
                }}
                onClick={() => navigate(`/users/${p.id}`)}
                role="button"
                tabIndex={0}
              >
                <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem' }}>{p.label.charAt(0)}</Avatar>
                <Typography variant="body2">{p.label}</Typography>
                <Button
                  component={Link}
                  to={`/users/${p.id}`}
                  size="small"
                  sx={{ ml: 'auto', minWidth: 'auto', fontSize: '0.7rem' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  View
                </Button>
              </Box>
            ))}
          </Box>
        )}
      </SectionCard>
      )}

      {showSection('recruiters') && (
      <SectionCard
        title="Assigned Recruiter(s)"
        titleHref="/jobs/job-orders"
        action={
          <Button
            variant="outlined"
            size="small"
            onClick={() => setManageRecruitersOpen(true)}
            sx={{ minWidth: 'auto', px: 1, py: 0.5, fontSize: '0.75rem', textTransform: 'none' }}
          >
            Edit
          </Button>
        }
      >
        {selectedRecruiters.length > 0 && (
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {selectedRecruiters.map((p) => (
              <Box
                key={p.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  p: 1,
                  borderRadius: 1,
                  bgcolor: 'grey.50',
                  cursor: 'pointer',
                }}
                onClick={() => navigate(`/users/${p.id}`)}
                role="button"
                tabIndex={0}
              >
                <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem' }}>{p.label.charAt(0)}</Avatar>
                <Typography variant="body2">{p.label}</Typography>
                <Button
                  component={Link}
                  to={`/users/${p.id}`}
                  size="small"
                  sx={{ ml: 'auto', minWidth: 'auto', fontSize: '0.7rem' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  View
                </Button>
              </Box>
            ))}
          </Box>
        )}
      </SectionCard>
      )}

      {showSection('laborPool') && (
      <SectionCard
        title="Labor Pool"
        titleHref="/users/user-groups"
        action={
          <Button
            variant="outlined"
            size="small"
            onClick={() => setManageLaborPoolOpen(true)}
            sx={{ minWidth: 'auto', px: 1, py: 0.5, fontSize: '0.75rem', textTransform: 'none' }}
          >
            Edit
          </Button>
        }
      >
        {selectedLaborPool.length > 0 && (
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {selectedLaborPool.map((o) => (
              <Box
                key={`${o.type}-${o.id}`}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  p: 1,
                  borderRadius: 1,
                  bgcolor: 'grey.50',
                }}
              >
                <GroupWorkIcon fontSize="small" />
                <Typography variant="body2">{o.label}</Typography>
                <Chip size="small" label={o.type === 'userGroup' ? 'User Group' : 'Smart Group'} sx={{ ml: 'auto' }} />
              </Box>
            ))}
          </Box>
        )}
      </SectionCard>
      )}

      {showSection('jobsBoard') && (
        <SectionCard title="Jobs Board" titleHref="/jobs/jobs-board">
          <Typography variant="body2" color="text.secondary">
            Jobs Board associations will surface here. Use the selected companies and locations on this account to manage related job posts.
          </Typography>
        </SectionCard>
      )}

      <Dialog open={manageRelatedAccountsOpen} onClose={() => setManageRelatedAccountsOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Manage Related Accounts</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="subtitle2" color="text.secondary">Current relations</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {[
                ...(parentAccount ? [{ id: parentAccount.id, label: parentAccount.label, relation: 'parent' as const }] : []),
                ...childAccounts.map((a) => ({ id: a.id, label: a.label, relation: 'child' as const })),
                ...mspAccounts.map((a) => ({ id: a.id, label: a.label, relation: 'msp' as const })),
              ].length === 0 ? (
                <Typography variant="body2" color="text.secondary">No related accounts</Typography>
              ) : (
                [
                  ...(parentAccount ? [{ id: parentAccount.id, label: parentAccount.label, relation: 'parent' as const }] : []),
                  ...childAccounts.map((a) => ({ id: a.id, label: a.label, relation: 'child' as const })),
                  ...mspAccounts.map((a) => ({ id: a.id, label: a.label, relation: 'msp' as const })),
                ].map((r) => (
                  <Box key={`${r.relation}-${r.id}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'grey.50' }}>
                    <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem' }}>{r.label.charAt(0)}</Avatar>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2" fontWeight="medium">{r.label}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {r.relation === 'parent' ? 'Parent Account' : r.relation === 'child' ? 'Child Account' : 'MSP'}
                      </Typography>
                    </Box>
                    <IconButton
                      size="small"
                      color="error"
                      disabled={saving}
                      onClick={async () => {
                        if (r.relation === 'parent') await onParentAccountChange(null);
                        else if (r.relation === 'child') await onChildAccountsChange(childAccounts.map((a) => a.id).filter((id) => id !== r.id));
                        else await onMspAccountsChange(mspAccounts.map((a) => a.id).filter((id) => id !== r.id));
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                ))
              )}
            </Box>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 1 }}>Add related account</Typography>
            <FormControl fullWidth size="small">
              <InputLabel>Relation type</InputLabel>
              <Select
                value={relatedAccountRelationType}
                label="Relation type"
                onChange={(e) => { setRelatedAccountRelationType(e.target.value as 'parent' | 'child' | 'msp' | ''); setRelatedAccountSelected(null); }}
              >
                <MenuItem value=""><em>Select type</em></MenuItem>
                <MenuItem value="parent">Parent Account</MenuItem>
                <MenuItem value="child">Child Account</MenuItem>
                <MenuItem value="msp">MSP</MenuItem>
              </Select>
            </FormControl>
            <Autocomplete
              options={accountOptions}
              getOptionLabel={(opt) => opt?.label ?? ''}
              value={relatedAccountSelected}
              onChange={(_, v) => setRelatedAccountSelected(v)}
              renderInput={(params) => <TextField {...params} label="Account" placeholder="Search accounts…" size="small" />}
              isOptionEqualToValue={(a, b) => a?.id === b?.id}
            />
            <Button
              variant="contained"
              disabled={!relatedAccountRelationType || !relatedAccountSelected || saving}
              onClick={async () => {
                if (!relatedAccountSelected) return;
                if (relatedAccountRelationType === 'parent') await onParentAccountChange(relatedAccountSelected.id);
                else if (relatedAccountRelationType === 'child') await onChildAccountsChange(Array.from(new Set([...childAccounts.map((a) => a.id), relatedAccountSelected.id])));
                else await onMspAccountsChange(Array.from(new Set([...mspAccounts.map((a) => a.id), relatedAccountSelected.id])));
                setRelatedAccountRelationType('');
                setRelatedAccountSelected(null);
              }}
            >
              {saving ? 'Saving…' : 'Add'}
            </Button>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManageRelatedAccountsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
      <ManageAssociationDialog
        open={manageCompaniesOpen}
        onClose={() => setManageCompaniesOpen(false)}
        title="Companies"
        currentItems={companyItems}
        availableOptions={companyOptions}
        selectionLabel="Select Company"
        selectionPlaceholder="Search companies..."
        onAdd={(item) => updateAccountAssociations({ companyIds: [...companyIds, item.id] })}
        onRemove={(id) => updateAccountAssociations({ companyIds: companyIds.filter((companyId) => companyId !== id) })}
      />
      <ManageAssociationDialog
        open={manageLocationsOpen}
        onClose={() => setManageLocationsOpen(false)}
        title="Locations"
        currentItems={locationItems}
        availableOptions={locationOptions}
        selectionLabel="Select Location"
        selectionPlaceholder="Search locations..."
        onAdd={(item) => {
          const [companyId, locationId] = item.id.split(':');
          updateAccountAssociations({ locations: [...locations, { companyId, locationId }] });
        }}
        onRemove={(id) => updateAccountAssociations({ locations: locations.filter((loc) => `${loc.companyId}:${loc.locationId}` !== id) })}
        addSectionFooter={
          addNewLocationEnabled && onAddNewLocation ? (
            <Box sx={{ mt: 2 }}>
              <Button
                variant="outlined"
                size="small"
                startIcon={<AddIcon />}
                onClick={() => {
                  setManageLocationsOpen(false);
                  onAddNewLocation();
                }}
                sx={{ textTransform: 'none' }}
              >
                Add new location
              </Button>
            </Box>
          ) : undefined
        }
      />
      <ManageAssociationDialog
        open={manageContactsOpen}
        onClose={() => setManageContactsOpen(false)}
        title="Contacts"
        currentItems={contactItems}
        availableOptions={contactOptions}
        selectionLabel="Select Contact"
        selectionPlaceholder="Search contacts..."
        onAdd={(item) => updateAccountAssociations({ contactIds: [...contactIds, item.id] })}
        onRemove={(id) => updateAccountAssociations({ contactIds: contactIds.filter((contactId) => contactId !== id) })}
      />
      <ManageAssociationDialog
        open={manageJobOrdersOpen}
        onClose={() => setManageJobOrdersOpen(false)}
        title="Job Orders"
        currentItems={jobOrderItems}
        availableOptions={jobOrderOptions}
        selectionLabel="Select Job Order"
        selectionPlaceholder="Search job orders..."
        onAdd={(item) => updateAccountAssociations({ jobOrderIds: [...jobOrderIds, item.id] })}
        onRemove={(id) => updateAccountAssociations({ jobOrderIds: jobOrderIds.filter((jobOrderId) => jobOrderId !== id) })}
      />
      <ManageAssociationDialog
        open={manageDealsOpen}
        onClose={() => setManageDealsOpen(false)}
        title="Deals"
        currentItems={dealItems}
        availableOptions={dealOptions}
        selectionLabel="Select Deal"
        selectionPlaceholder="Search deals..."
        onAdd={(item) => updateAccountAssociations({ dealIds: [...dealIds, item.id] })}
        onRemove={(id) => updateAccountAssociations({ dealIds: dealIds.filter((dealId) => dealId !== id) })}
      />
      <ManageAssociationDialog
        open={manageSalespeopleOpen}
        onClose={() => setManageSalespeopleOpen(false)}
        title="Salespeople"
        currentItems={salespersonItems}
        availableOptions={salespersonOptionsMapped}
        selectionLabel="Select Salesperson"
        selectionPlaceholder="Search salespeople..."
        onAdd={(item) => updateAccountAssociations({ salespersonIds: [...salespersonIds, item.id] })}
        onRemove={(id) => updateAccountAssociations({ salespersonIds: salespersonIds.filter((salespersonId) => salespersonId !== id) })}
      />
      <ManageAssociationDialog
        open={manageRecruitersOpen}
        onClose={() => setManageRecruitersOpen(false)}
        title="Recruiters"
        currentItems={recruiterItems}
        availableOptions={recruiterOptionsMapped}
        selectionLabel="Select Recruiter"
        selectionPlaceholder="Search recruiters..."
        onAdd={(item) => updateAccountAssociations({ recruiterIds: [...recruiterIds, item.id] })}
        onRemove={(id) => updateAccountAssociations({ recruiterIds: recruiterIds.filter((recruiterId) => recruiterId !== id) })}
      />
      <ManageAssociationDialog
        open={manageLaborPoolOpen}
        onClose={() => setManageLaborPoolOpen(false)}
        title="Labor Pool"
        currentItems={laborPoolItems}
        availableOptions={laborPoolOptionsMapped}
        selectionLabel="Select Labor Pool"
        selectionPlaceholder="Search user groups or smart groups..."
        groupBy={(option) => option.group || 'Other'}
        onAdd={(item) => {
          const [type, id] = item.id.split(':');
          updateAccountAssociations({
            userGroupIds: type === 'userGroup' ? [...userGroupIds, id] : userGroupIds,
            savedSmartGroupIds: type === 'savedSmartGroup' ? [...savedSmartGroupIds, id] : savedSmartGroupIds,
          });
        }}
        onRemove={(id) => {
          const [type, itemId] = id.split(':');
          updateAccountAssociations({
            userGroupIds: type === 'userGroup' ? userGroupIds.filter((groupId) => groupId !== itemId) : userGroupIds,
            savedSmartGroupIds: type === 'savedSmartGroup' ? savedSmartGroupIds.filter((groupId) => groupId !== itemId) : savedSmartGroupIds,
          });
        }}
      />
    </Box>
  );
}

type CompanyOption = { id: string; label: string; companyName?: string };
type LocationOption = { companyId: string; locationId: string; label: string };
type ContactOption = { id: string; label: string; companyId?: string };
type JobOrderOption = { id: string; label: string };
type DealOption = { id: string; label: string; companyIds?: string[] };
type LaborPoolOption = { id: string; label: string; type: 'userGroup' | 'savedSmartGroup'; memberCount?: number };
type PersonOption = { id: string; label: string };
type AccountOption = { id: string; label: string };
type EntityOption = { id: string; name: string; entityCode: string; workerType: string; everifyRequired?: boolean };

const ACCOUNT_TAB_SLUGS = [
  'shifts',
  'overview',
  'calendar',
  'cascading-data',
  'active-workers',
  'locations',
  'contacts',
  'children',
  'pricing',
  'job-orders',
  'jobs-board',
  'labor-pool',
  'settings',
  'invoicing',
  'order-defaults',
  'reports',
  'activity',
  'notes',
] as const;

const RecruiterAccountDetails: React.FC = () => {
  const { accountId } = useParams<{ accountId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { tenantId, user, currentClaimsSecurityLevel, securityLevel } = useAuth();
  const canAccessInvoicing = canAccessAccountInvoicingTab(currentClaimsSecurityLevel ?? securityLevel);
  const navigate = useNavigate();
  const { isFavorite, toggleFavorite } = useFavorites('accounts');

  const tabFromUrl = useMemo(() => {
    const tab = searchParams.get('tab');
    // Legacy redirect: ?tab=pricing / ?tab=order-defaults now live on the
    // Cascading Data tab (the Settings tab was reduced to File Uploads only
    // on 2026-05-03). Resolve here so the initial render shows the right
    // panel; the URL itself gets normalized in the redirect effect below.
    if (tab && LEGACY_ACCOUNT_TAB_REDIRECTS[tab]) {
      return ACCOUNT_TAB_SLUGS.indexOf('cascading-data');
    }
    // Legacy `?tab=overview`, bare URLs with no `?tab=`, and unknown slugs
    // land on Shifts (account-scoped shift list). URL gets normalized below.
    if (tab === 'overview' || !tab) {
      return ACCOUNT_TAB_SLUGS.indexOf('shifts');
    }
    const idx = ACCOUNT_TAB_SLUGS.indexOf(tab as any);
    return idx >= 0 ? idx : ACCOUNT_TAB_SLUGS.indexOf('shifts');
  }, [searchParams]);

  const sectionFromUrl = useMemo<AccountSettingsSection>(() => {
    const tab = searchParams.get('tab');
    // Legacy redirect path supplies the section directly.
    if (tab && LEGACY_ACCOUNT_TAB_REDIRECTS[tab]) {
      return LEGACY_ACCOUNT_TAB_REDIRECTS[tab];
    }
    const raw = searchParams.get('section');
    return isAccountSettingsSection(raw) ? raw : DEFAULT_ACCOUNT_SETTINGS_SECTION;
  }, [searchParams]);

  const [account, setAccount] = useState<RecruiterAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tabValue, setTabValue] = useState(tabFromUrl);
  const [selectedSection, setSelectedSection] = useState<AccountSettingsSection>(sectionFromUrl);
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [saving, setSaving] = useState(false);

  const isChildAccount = account?.accountType === 'child' || (account?.parentAccountId != null && account?.parentAccountId !== '');
  const isNationalAccount = account?.accountType === 'national';

  // Option lists for autocompletes
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [locationsByCompany, setLocationsByCompany] = useState<Record<string, LocationOption[]>>({});
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [jobOrders, setJobOrders] = useState<JobOrderOption[]>([]);
  const [deals, setDeals] = useState<DealOption[]>([]);
  const [laborPoolOptions, setLaborPoolOptions] = useState<LaborPoolOption[]>([]);
  const [jobOrderApplicantCounts, setJobOrderApplicantCounts] = useState<Record<string, number>>({});
  const [salespeopleOptions, setSalespeopleOptions] = useState<PersonOption[]>([]);
  const [recruitersOptions, setRecruitersOptions] = useState<PersonOption[]>([]);
  const [accountOptions, setAccountOptions] = useState<AccountOption[]>([]);
  const [entityOptions, setEntityOptions] = useState<EntityOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);

  // Primary linked company logo for account avatar (first company in associations)
  const [accountCompanyLogoUrl, setAccountCompanyLogoUrl] = useState<string | null>(null);

  // Account file uploads (Overview tab)
  type AccountUpload = { id: string; name: string; fileName: string; url: string; storagePath: string; createdAt: any };
  const [accountUploads, setAccountUploads] = useState<AccountUpload[]>([]);
  const [uploadLabel, setUploadLabel] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadFileKey, setUploadFileKey] = useState(0);
  const [deleteConfirmUploadId, setDeleteConfirmUploadId] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  // Job Orders tab (filtered by account companies)
  const [accountJobOrders, setAccountJobOrders] = useState<JobOrderWithDetails[]>([]);
  const [accountJobOrdersLoading, setAccountJobOrdersLoading] = useState(false);
  const [accountJobOrdersError, setAccountJobOrdersError] = useState<string | null>(null);
  const [jobOrdersSearch, setJobOrdersSearch] = useState('');
  const [jobOrdersShowFavoritesOnly, setJobOrdersShowFavoritesOnly] = useState(false);
  const [jobOrdersStatusFilter, setJobOrdersStatusFilter] = useState('');
  const [jobOrdersCompanyFilter, setJobOrdersCompanyFilter] = useState('all');
  const [jobOrdersSortField, setJobOrdersSortField] = useState('jobOrderNumber');
  const [jobOrdersSortDirection, setJobOrdersSortDirection] = useState<'asc' | 'desc'>('desc');
  const [jobOrdersPage, setJobOrdersPage] = useState(0);
  const [jobOrdersRowsPerPage, setJobOrdersRowsPerPage] = useState(20);
  /**
   * Job Orders tab view mode — only exposed on National accounts.
   *  - `flat`: the original paginated table (one row per job order).
   *  - `sub-account`: rows grouped by sub account. Each sub account gets a
   *    summary header row (click to open the sub account) followed by its
   *    job orders. Empty sub accounts still show a header + "No job orders"
   *    placeholder row. Orders on the parent itself (or with no linked
   *    sub account) group under a top-level "<name> (National)" header.
   *
   * Persisted per-account in localStorage so each National account
   * remembers its last-used view. Default is `flat` on first visit.
   */
  const [jobOrdersView, setJobOrdersView] = useState<'flat' | 'sub-account'>('flat');
  /**
   * Secondary filter — only visible/meaningful when `jobOrdersView === 'sub-account'`.
   *  - `all`: show every child account header (even if it has zero orders).
   *  - `with-orders`: hide sub-accounts (and the parent group) that have no
   *    orders in the current filter set. Useful for recruiters who just want
   *    to see what's actually happening.
   * Persisted per-account in localStorage alongside the main view toggle.
   */
  const [subAccountsFilter, setSubAccountsFilter] = useState<'all' | 'with-orders'>('all');
  useEffect(() => {
    if (!accountId) return;
    try {
      const stored = localStorage.getItem(`accountJobOrdersView_${accountId}`);
      setJobOrdersView(stored === 'sub-account' ? 'sub-account' : 'flat');
      const storedSub = localStorage.getItem(`accountJobOrdersSubFilter_${accountId}`);
      setSubAccountsFilter(storedSub === 'with-orders' ? 'with-orders' : 'all');
    } catch {
      // localStorage can throw in private/incognito — fall back to default.
      setJobOrdersView('flat');
      setSubAccountsFilter('all');
    }
  }, [accountId]);
  const handleJobOrdersViewChange = useCallback(
    (next: 'flat' | 'sub-account') => {
      setJobOrdersView(next);
      if (!accountId) return;
      try {
        localStorage.setItem(`accountJobOrdersView_${accountId}`, next);
      } catch {
        /* ignore — not critical */
      }
    },
    [accountId],
  );
  const handleSubAccountsFilterChange = useCallback(
    (next: 'all' | 'with-orders') => {
      setSubAccountsFilter(next);
      if (!accountId) return;
      try {
        localStorage.setItem(`accountJobOrdersSubFilter_${accountId}`, next);
      } catch {
        /* ignore */
      }
    },
    [accountId],
  );

  const { isFavorite: isJobOrderFavorite, toggleFavorite: toggleJobOrderFavorite } = useFavorites('jobOrders');

  /**
   * Next upcoming shift per Gig job order on the Job Orders tab. Populated by
   * a fan-out query over `tenants/{tid}/job_orders/{id}/shifts` for each Gig
   * JO currently in `accountJobOrders`. Career orders are skipped (they don't
   * have shifts in this sense). Values are `Date` objects (shift start);
   * `nextShiftStartForJobOrder` handles single + multi-day with weekly /
   * per-date schedule overrides.
   *
   * Populated lazily once the JOs are loaded so the table paints instantly
   * and the "Next shift" caption hydrates as results come back.
   */
  const [nextShiftByJobOrderId, setNextShiftByJobOrderId] = useState<Record<string, Date>>({});

  // Jobs Board tab: posts for account's companies
  const [accountJobPosts, setAccountJobPosts] = useState<JobsBoardPost[]>([]);
  const [accountJobPostsLoading, setAccountJobPostsLoading] = useState(false);
  const [jobPostsPage, setJobPostsPage] = useState(0);
  const [jobPostsRowsPerPage, setJobPostsRowsPerPage] = useState(20);
  const { isFavorite: isJobPostFavorite, toggleFavorite: toggleJobPostFavorite } = useFavorites('jobPosts');

  // Locations tab: all locations for account's companies
  type AccountLocationRow = {
    id: string;
    name?: string;
    nickname?: string;
    code?: string;
    address?: string;
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    type?: string;
    division?: string;
    contactCount?: number;
    dealCount?: number;
    companyId: string;
    companyName: string;
    active?: boolean;
  };
  const [accountLocationsList, setAccountLocationsList] = useState<AccountLocationRow[]>([]);
  const [accountLocationsLoading, setAccountLocationsLoading] = useState(false);
  const [locationsSearchQuery, setLocationsSearchQuery] = useState('');
  const [showAddLocationDialog, setShowAddLocationDialog] = useState(false);
  const [showNewJobOrderModal, setShowNewJobOrderModal] = useState(false);
  const [showAddSubAccountModal, setShowAddSubAccountModal] = useState(false);
  const [nationalBackfillOpen, setNationalBackfillOpen] = useState(false);
  const [nationalBackfillStep, setNationalBackfillStep] = useState<'confirm' | 'result'>('confirm');
  const [nationalBackfillLoading, setNationalBackfillLoading] = useState(false);
  const [nationalBackfillError, setNationalBackfillError] = useState<string | null>(null);
  const [nationalBackfillSummary, setNationalBackfillSummary] = useState<{
    locationsProcessed: number;
    created: number;
    skipped_duplicate: number;
    skipped_idempotent: number;
  } | null>(null);
  // §14b — backfill gig job orders for existing child accounts.
  // Mirror the locations-backfill state shape so the dialog UX matches
  // the existing pattern (confirm step → loading → result step). The
  // callable returns `summary + audit`; we only render the summary
  // numbers in the dialog and surface the full audit in console for
  // forensic debugging.
  const [gigBackfillOpen, setGigBackfillOpen] = useState(false);
  const [gigBackfillStep, setGigBackfillStep] =
    useState<'confirm' | 'result'>('confirm');
  const [gigBackfillLoading, setGigBackfillLoading] = useState(false);
  const [gigBackfillError, setGigBackfillError] = useState<string | null>(null);
  const [gigBackfillSummary, setGigBackfillSummary] = useState<{
    created: number;
    alreadyHad: number;
    skipped: number;
    totalChildAccounts: number;
  } | null>(null);

  const [parentCompanyIds, setParentCompanyIds] = useState<string[]>([]);
  const addLocationTargetCompanyIds = useMemo(
    () => (isChildAccount ? parentCompanyIds : (account?.associations?.companyIds ?? [])),
    [isChildAccount, parentCompanyIds, account?.associations?.companyIds]
  );
  const showAddLocationCompanySelect = useMemo(
    () =>
      addLocationTargetCompanyIds.length > 1 ||
      (!isChildAccount && (account?.mspAccountIds?.length ?? 0) > 0),
    [addLocationTargetCompanyIds, isChildAccount, account?.mspAccountIds]
  );
  const [parentAccountLogoUrl, setParentAccountLogoUrl] = useState<string | null>(null);
  const [orderDefaultsSubView, setOrderDefaultsSubView] = useState<'staffInstructions' | 'orderDetails'>('staffInstructions');
  const [addLocationCompanyId, setAddLocationCompanyId] = useState<string>('');
  const [addLocationForm, setAddLocationForm] = useState({
    name: '',
    code: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    country: 'USA',
    type: 'Office',
    division: '',
    phone: '',
    coordinates: null as { lat: number; lng: number } | null,
  });
  const [addLocationError, setAddLocationError] = useState<string | null>(null);
  const [addLocationSubmitting, setAddLocationSubmitting] = useState(false);
  const addLocationAutocompleteRef = useRef<any>(null);

  // Contacts tab: contacts from all account-linked companies
  type AccountContactRow = {
    id: string;
    firstName?: string;
    lastName?: string;
    fullName?: string;
    email?: string;
    phone?: string;
    jobTitle?: string;
    title?: string;
    companyId?: string;
    companyName?: string;
    locationId?: string;
    linkedinUrl?: string;
    linkedin?: string;
    linkedInUrl?: string;
    linkedIn?: string;
    [key: string]: unknown;
  };
  const [accountContactsList, setAccountContactsList] = useState<AccountContactRow[]>([]);
  const [accountContactsLoading, setAccountContactsLoading] = useState(false);
  const [contactsSearchQuery, setContactsSearchQuery] = useState('');
  const [showAddContactDialog, setShowAddContactDialog] = useState(false);
  const [addContactCompanyId, setAddContactCompanyId] = useState('');
  const [addContactLocationId, setAddContactLocationId] = useState<{ companyId: string; locationId: string } | null>(null);
  const [addContactForm, setAddContactForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    jobTitle: '',
    contactType: 'Unknown',
    linkedInUrl: '',
    tags: [] as string[],
    isActive: true,
    notes: '',
  });
  const [addContactSaving, setAddContactSaving] = useState(false);
  const [addContactError, setAddContactError] = useState<string | null>(null);

  const [showAddNoteDialog, setShowAddNoteDialog] = useState(false);
  const [notesCount, setNotesCount] = useState(0);

  // Children tab: visible if child accounts in widget or any account has this as parent
  const [hasAnyAccountWithThisAsParent, setHasAnyAccountWithThisAsParent] = useState(false);
  type ChildAccountRow = {
    id: string;
    name: string;
    active: boolean;
    accountType?: string | null;
    eVerifyRequired?: boolean;
    hiringEntityId?: string | null;
  };
  const [childAccountsList, setChildAccountsList] = useState<ChildAccountRow[]>([]);
  const [childAccountsLoading, setChildAccountsLoading] = useState(false);
  const [childrenSearchQuery, setChildrenSearchQuery] = useState('');

  // First worksite's full details for Overview card (when account has a worksite linked)
  type WorksiteDetails = { name?: string; nickname?: string; address?: string; street?: string; city?: string; state?: string; zipCode?: string; type?: string };
  const [worksiteDetails, setWorksiteDetails] = useState<WorksiteDetails | null>(null);
  const [worksiteDetailsLoading, setWorksiteDetailsLoading] = useState(false);

  // Account defaults (Settings tab) – same shape as company defaults; can override company and trickle to job orders
  const defaultRulesInitial = {
    replacingExistingAgency: false,
    rolloverExistingStaff: false,
    timeclockSystem: '',
    attendancePolicy: '',
    noShowPolicy: '',
    overtimePolicy: '',
    callOffPolicy: '',
    injuryHandlingPolicy: '',
    disciplinePolicy: '',
  };
  const defaultBillingInitial = { poRequired: false, paymentTerms: '', invoiceDeliveryMethod: '', invoiceFrequency: '', sendInvoicesTo: [] as string[], billingNotes: '' };
  const defaultEVerifyInitial = { eVerifyRequired: false };
  const [defaultRules, setDefaultRules] = useState(defaultRulesInitial);
  const [defaultBilling, setDefaultBilling] = useState(defaultBillingInitial);
  const [defaultEVerify, setDefaultEVerify] = useState(defaultEVerifyInitial);
  const [defaultsSaving, setDefaultsSaving] = useState(false);
  // Mirror of `defaultsSaving` for use inside long-lived listeners (effect closures cannot read
  // the latest state). Used by the account-doc onSnapshot listener to skip applying snapshot
  // payloads while the user is mid-save (which would briefly clobber pending state with the
  // pre-save Firestore value).
  const defaultsSavingRef = useRef(false);
  /** When this account is a child, parent's E-Verify and Hiring Entity for display on Account Details card */
  const [parentDefaults, setParentDefaults] = useState<{ eVerifyRequired: boolean; hiringEntityId: string | null } | null>(null);
  /** Full parent account doc for Order Defaults → Order Details inheritance (national → child). */
  const [orderDefaultsInheritanceParent, setOrderDefaultsInheritanceParent] = useState<RecruiterAccount | null>(null);

  /** Entity (Employer of Record) is the source of truth for E-Verify; we look it up and show read-only. */
  const displayEntityId = account ? (isChildAccount && parentDefaults != null ? parentDefaults.hiringEntityId : (account.hiringEntityId ?? null)) : null;
  const { entity: displayEntity, loading: displayEntityLoading } = useEntity(tenantId, displayEntityId);

  // R.16.2a Phase 3 — Push-to-Active banners. Stack of payloads (Q1
  // lock: one banner per dirty (positionId, fieldKey) pair, no cap).
  // Updated by `appendPushBanner` after a successful save; cleared on
  // banner dismiss or dialog close.
  //
  // Top-level wraps land here for `hiringEntityId` (the only top-level
  // snapshot-policy field with an actual edit surface on this page).
  // `eVerifyRequired` is downstream of `hiringEntityId` (the UI shows
  // it as read-only "Set by Hiring Entity"); top-level `workersCompCode`
  // has no edit surface here either. Both are intentionally deferred —
  // see the R.16.2a brief Phase 3 / Deferred-items table.
  //
  // Per-position wraps land here from `savePricing` covering each
  // position's `payRate`, `billRate`, `markupPercent`, `workersCompRate`,
  // `workersCompCode`. The diff fires per-field per-position, so editing
  // 3 positions × 2 fields surfaces 6 banners stacked above the Pricing
  // tab table.
  //
  // Banner gate (Q4 lock) — only render for `securityLevel === '7'`.
  // Server-side callable still enforces independently.
  const [pushBanners, setPushBanners] = useState<PushToActiveBannerPayload[]>([]);
  const lastSavedHiringEntityIdRef = useRef<string | null>(null);
  const lastSavedPricingPositionsRef = useRef<
    Map<string, {
      payRate?: number | null;
      billRate?: number | null;
      markupPercent?: number | null;
      workersCompRate?: number | null;
      workersCompCode?: string | null;
    }>
  >(new Map());
  const canPushToActive = securityLevel === '7';
  /** National → child cascade sync callable (fill-empty); allowed for tenant managers (5+), not only HRX level 7. */
  const canSyncCascadeDefaultsToChildren = Number(securityLevel) >= 5;

  // Pricing tab: national options + positions table
  const [pricingSubAccountsManageOwn, setPricingSubAccountsManageOwn] = useState(false);
  const [pricingFlatMarkupPercent, setPricingFlatMarkupPercent] = useState<number | ''>('');
  const [pricingPositions, setPricingPositions] = useState<AccountPositionPricing[]>([]);
  const [pricingNotes, setPricingNotes] = useState('');
  const [pricingNotesSaving, setPricingNotesSaving] = useState(false);
  const [pricingSaving, setPricingSaving] = useState(false);
  /** Parent national `pricing.flatMarkupPercent` — read-only context on child accounts (Cascading Data). */
  const [parentNationalFlatMarkupPercent, setParentNationalFlatMarkupPercent] = useState<number | null>(null);
  const [parentNationalMarkupLoading, setParentNationalMarkupLoading] = useState(false);
  /** Live parent `roles.schedulerIds` — merged into header + scheduling UX on child accounts. */
  const [parentNationalSchedulerIds, setParentNationalSchedulerIds] = useState<string[]>([]);
  /** Live parent `pricing.positions` — templates for Cascading Data Default Positions on children. */
  const [parentNationalPositions, setParentNationalPositions] = useState<AccountPositionPricing[]>([]);
  const [cascadeMarkupSaving, setCascadeMarkupSaving] = useState(false);
  /** Cascading Data → Default Positions: per-row compliance / screening overrides editor. */
  const [positionComplianceDialog, setPositionComplianceDialog] = useState<{
    titleKey: string;
    pricingPositionsIndex: number | null;
  } | null>(null);
  const [pricingSutaFutaState, setPricingSutaFutaState] = useState('');
  /** WC rate by "STATE_CODE" from tenants/workers_comp_rates (single source of truth; used for display and so master updates apply everywhere). */
  const [wcRatesByKey, setWcRatesByKey] = useState<Record<string, number>>({});
  /** Job-title WC lookups (generic + account-scoped modifiers). */
  const [wcJobTitleMaps, setWcJobTitleMaps] = useState<{
    byStateAndJobTitle: Record<string, { code: string; rate: number }>;
    byStateJobTitleAndModifierAccount: Record<string, { code: string; rate: number }>;
  }>({ byStateAndJobTitle: {}, byStateJobTitleAndModifierAccount: {} });
  const wcModifierAccountIdForPricing = useMemo(
    () => resolveWorkersCompModifierAccountId(account),
    [account],
  );

  /** Re-run WC auto-fill when titles or stored WC codes change — not on every pay-rate keystroke. */
  const pricingPositionsWcHydrationKey = useMemo(
    () =>
      pricingPositions
        .map(
          (r) =>
            `${String(r.jobTitle || '').trim().toLowerCase()}|${String(r.workersCompCode ?? '').trim()}`,
        )
        .join('\u001f'),
    [pricingPositions],
  );

  /** When worksite state + Workers Comp maps are available, fill missing WC code/rate from job-title rules (Settings → Workers Comp). Keeps child venue rows populated after national JD/template updates. */
  useEffect(() => {
    if (!tenantId || !account?.id) return;
    const stateCode = (pricingSutaFutaState || normalizeStateCode(worksiteDetails?.state) || '')
      .trim()
      .toUpperCase();
    if (!stateCode) return;

    setPricingPositions((prev) => {
      let changed = false;
      const next = prev.map((row) => {
        const title = String(row.jobTitle || '').trim();
        if (!title) return row;
        if (String(row.workersCompCode || '').trim() !== '') return row;
        const lookup = pickWorkersCompJobTitleLookup(
          wcJobTitleMaps,
          stateCode,
          title,
          wcModifierAccountIdForPricing,
        );
        if (!lookup) return row;
        changed = true;
        return {
          ...row,
          workersCompCode: lookup.code,
          workersCompRate: lookup.rate,
        };
      });
      return changed ? next : prev;
    });
  }, [
    tenantId,
    account?.id,
    pricingSutaFutaState,
    worksiteDetails?.state,
    wcJobTitleMaps,
    wcModifierAccountIdForPricing,
    pricingPositionsWcHydrationKey,
  ]);

  /**
   * Accounts with a parent: single live snapshot for downhill cascade —
   * markup, hiring/E-Verify defaults, schedulers, default positions (national templates on children).
   */
  useEffect(() => {
    const parentId = account?.parentAccountId?.trim();
    if (!tenantId || !parentId) {
      setParentNationalFlatMarkupPercent(null);
      setParentNationalMarkupLoading(false);
      setParentDefaults(null);
      setOrderDefaultsInheritanceParent(null);
      setParentNationalSchedulerIds([]);
      setParentNationalPositions([]);
      return;
    }

    setParentNationalMarkupLoading(true);
    const parentRef = doc(db, p.recruiterAccount(tenantId, parentId));
    const unsub = onSnapshot(
      parentRef,
      (snap) => {
        if (!snap.exists()) {
          setParentNationalFlatMarkupPercent(null);
          setParentDefaults(null);
          setOrderDefaultsInheritanceParent(null);
          setParentNationalSchedulerIds([]);
          setParentNationalPositions([]);
          setParentNationalMarkupLoading(false);
          return;
        }
        const d = snap.data() as RecruiterAccount;
        const pr = d.pricing;
        const v = pr?.flatMarkupPercent as unknown;
        const n = v == null ? NaN : Number(v);
        setParentNationalFlatMarkupPercent(Number.isFinite(n) ? n : null);

        const eVerify = d?.defaults?.eVerify;
        const eVerifyRequired = eVerify && typeof eVerify === 'object' ? !!eVerify.eVerifyRequired : false;
        const hiringEntityId = d?.hiringEntityId ?? null;
        setParentDefaults({ eVerifyRequired, hiringEntityId });
        setOrderDefaultsInheritanceParent(d);

        const sched = d.roles?.schedulerIds;
        setParentNationalSchedulerIds(
          Array.isArray(sched)
            ? sched.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
            : [],
        );

        setParentNationalPositions(extractAccountPricingPositions(d));

        setParentNationalMarkupLoading(false);
      },
      (err) => {
        console.error('RecruiterAccountDetails: parent account cascade snapshot', err);
        setParentNationalFlatMarkupPercent(null);
        setParentDefaults(null);
        setOrderDefaultsInheritanceParent(null);
        setParentNationalSchedulerIds([]);
        setParentNationalPositions([]);
        setParentNationalMarkupLoading(false);
      },
    );

    return () => unsub();
  }, [tenantId, account?.parentAccountId]);

  // Invoicing tab: sub-view (scaffolding for QuickBooks integration)
  const [invoicingSubView, setInvoicingSubView] = useState<'invoices' | 'ar' | 'payments' | 'mapping'>('invoices');

  const isMountedRef = useRef(true);
  const cascadingOrderDetailsRef = useRef<AccountOrderDetailsFormHandle | null>(null);
  const [cascadeChildSyncBusy, setCascadeChildSyncBusy] = useState(false);
  const [cascadeChildSyncNotice, setCascadeChildSyncNotice] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Keep `defaultsSavingRef` in sync with `defaultsSaving` so the account-doc onSnapshot listener
  // (which runs once per accountId) sees the latest save flag without re-subscribing.
  useEffect(() => {
    defaultsSavingRef.current = defaultsSaving;
  }, [defaultsSaving]);

  // Keep tab in sync with URL (e.g. when user hits back)
  useEffect(() => {
    setTabValue(tabFromUrl);
  }, [tabFromUrl]);

  /** Billing & Invoicing defaults moved to Cascading Data — keep old links working. */
  useEffect(() => {
    const tab = searchParams.get('tab');
    const section = searchParams.get('section');
    if (tab === 'settings' && (section === 'billing' || section === 'customer-rules')) {
      setSearchParams({ tab: 'cascading-data' }, { replace: true });
      return;
    }
    // The Settings tab was reduced to File Uploads only on 2026-05-03 (sidebar + other
    // sections moved to Cascading Data). On child accounts the tab is hidden entirely; if
    // someone deep-links to `?tab=settings` on a child, send them to Cascading Data so they
    // don't land on a hidden tab. Only run once `account` has loaded so we don't redirect
    // before knowing the account type.
    if (tab === 'settings' && account?.accountType === 'child') {
      setSearchParams({ tab: 'cascading-data' }, { replace: true });
      return;
    }
    // For sections that no longer exist on the slimmed-down Settings tab (anything except
    // `files`), normalize the URL to `?tab=settings&section=files` so the back button and
    // bookmarks stay coherent.
    if (tab === 'settings' && section && section !== 'files' && account?.accountType !== 'child') {
      setSearchParams({ tab: 'settings', section: 'files' }, { replace: true });
    }
  }, [searchParams, setSearchParams, account?.accountType]);

  const setAccountTab = useCallback((index: number) => {
    setTabValue(index);
    const slug = ACCOUNT_TAB_SLUGS[index];
    // Settings tab is the only one that surfaces a `?section=` qualifier.
    // Other tabs strip it so the URL stays clean when you tab away.
    if (slug === 'settings') {
      setSearchParams(
        { tab: slug, section: selectedSection },
        { replace: true },
      );
    } else {
      setSearchParams({ tab: slug }, { replace: true });
    }
  }, [setSearchParams, selectedSection]);

  const setSettingsSection = useCallback(
    (section: AccountSettingsSection) => {
      setSelectedSection(section);
      setSearchParams(
        { tab: 'settings', section },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // One-time normalization on mount: rewrite legacy URLs to their new
  // canonical form so subsequent back-button / share-link behavior matches
  // the current IA. `replace` keeps legacy URLs out of history.
  // - ?tab=pricing / ?tab=order-defaults → ?tab=cascading-data
  //   (Both originally lived under Docs & Settings; on 2026-05-03 the
  //   Settings tab was reduced to File Uploads only and these surfaces
  //   moved to Cascading Data.)
  // - ?tab=overview or bare URL (no ?tab=) → ?tab=shifts
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && LEGACY_ACCOUNT_TAB_REDIRECTS[tab]) {
      setSearchParams({ tab: 'cascading-data' }, { replace: true });
      return;
    }
    if (tab === 'overview' || !tab) {
      setSearchParams({ tab: 'shifts' }, { replace: true });
    }
    // We only care about the very first arrival of a legacy / empty slug;
    // once rewritten the branches above never fire again on a fresh mount.
    // Intentionally limited deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Same pill treatment as `UserProfile` recruiter tabs (`variant="text"` +
  // bg via `sx`) — keep in sync when adjusting record-header navigation.
  const tabPillSx = useCallback(
    (isActive: boolean) =>
      ({
        textTransform: 'none' as const,
        borderRadius: '999px',
        fontSize: '13px',
        fontWeight: isActive ? 600 : 400,
        color: isActive ? 'white' : 'rgba(0, 0, 0, 0.7)',
        bgcolor: isActive ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
        px: 1.25,
        py: 0.5,
        minHeight: 30,
        minWidth: 'auto',
        whiteSpace: 'nowrap' as const,
        '& .MuiButton-startIcon': {
          mr: 0.5,
          '& svg': { fontSize: 16 },
        },
        '&:hover': {
          bgcolor: isActive ? '#004a9f' : 'rgba(0, 0, 0, 0.08)',
        },
      }),
    [],
  );

  useEffect(() => {
    if (accountId && tenantId) {
      loadAccount();
    }
  }, [accountId, tenantId]);

  // Live listener: when the parent's "Save & sync to child accounts" runs while a child page is
  // open, the child's `defaults.*` and `orderDefaults` are updated in Firestore but the cached
  // React state stays stale. Subscribe so the visible page reflects cascade writes immediately.
  // Skip the first emission (initial load is handled by `loadAccount` and would re-apply state we
  // just set) and bail out when a local save is in flight to avoid clobbering in-flight typing.
  useEffect(() => {
    if (!accountId || !tenantId) return;
    const ref = doc(db, p.recruiterAccount(tenantId, accountId));
    let isFirst = true;
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!isMountedRef.current) return;
        if (isFirst) {
          isFirst = false;
          return;
        }
        if (defaultsSavingRef.current) return;
        if (!snap.exists()) return;
        const data = snap.data();
        const d = data?.defaults;
        if (d && typeof d === 'object') {
          const r = d.rules;
          if (r && typeof r === 'object') {
            setDefaultRules({
              replacingExistingAgency: !!r.replacingExistingAgency,
              rolloverExistingStaff: !!r.rolloverExistingStaff,
              timeclockSystem: r.timeclockSystem ?? '',
              attendancePolicy: r.attendancePolicy ?? '',
              noShowPolicy: r.noShowPolicy ?? '',
              overtimePolicy: r.overtimePolicy ?? '',
              callOffPolicy: r.callOffPolicy ?? '',
              injuryHandlingPolicy: r.injuryHandlingPolicy ?? '',
              disciplinePolicy: r.disciplinePolicy ?? '',
            });
          }
          const b = d.billing;
          if (b && typeof b === 'object') {
            setDefaultBilling({
              poRequired: !!b.poRequired,
              paymentTerms: b.paymentTerms ?? '',
              invoiceDeliveryMethod: b.invoiceDeliveryMethod ?? '',
              invoiceFrequency: b.invoiceFrequency ?? '',
              sendInvoicesTo: Array.isArray(b.sendInvoicesTo) ? b.sendInvoicesTo : [],
              billingNotes: b.billingNotes ?? '',
            });
          }
          const e = d.eVerify;
          if (e && typeof e === 'object') {
            setDefaultEVerify({ eVerifyRequired: !!e.eVerifyRequired });
          }
        }
        // `orderDefaults` (staff instructions, screening defaults, etc.) is also fill-empty
        // copied by the national cascade. Mirror it onto local `account` state so the
        // Cascading Data → Order Defaults card refreshes too.
        setAccount((prev) =>
          prev
            ? { ...prev, orderDefaults: data?.orderDefaults ?? undefined }
            : prev,
        );
      },
      (err) => {
        console.error('RecruiterAccountDetails: account snapshot listener error', err);
      },
    );
    return () => unsub();
  }, [accountId, tenantId]);

  // Check if any account has this account as parent (for Children tab visibility)
  useEffect(() => {
    if (!tenantId || !account?.id) {
      setHasAnyAccountWithThisAsParent(false);
      return;
    }
    let cancelled = false;
    const ref = collection(db, p.recruiterAccounts(tenantId));
    const q = query(ref, where('parentAccountId', '==', account.id), limit(1));
    getDocs(q).then((snap) => {
      if (!cancelled && isMountedRef.current) setHasAnyAccountWithThisAsParent(!snap.empty);
    });
    return () => {
      cancelled = true;
    };
  }, [tenantId, account?.id]);

  // Default pricing SUTA/FUTA state from first worksite when available
  useEffect(() => {
    if (worksiteDetails?.state && !pricingSutaFutaState) {
      setPricingSutaFutaState(normalizeStateCode(worksiteDetails.state) || '');
    }
  }, [worksiteDetails?.state, pricingSutaFutaState]);

  // Load first worksite details for Overview "Worksite Location" card
  useEffect(() => {
    const locs = account?.associations?.locations;
    if (!tenantId || !locs?.length) {
      setWorksiteDetails(null);
      return;
    }
    const first = locs[0] as { companyId: string; locationId: string };
    let cancelled = false;
    setWorksiteDetailsLoading(true);
    const locRef = doc(collection(db, p.accountLocations(tenantId, first.companyId)), first.locationId);
    getDoc(locRef)
      .then((snap) => {
        if (cancelled || !isMountedRef.current) return;
        if (snap.exists()) {
          const d = snap.data();
          setWorksiteDetails({
            name: d?.name,
            nickname: d?.nickname,
            address: d?.address,
            street: d?.street,
            city: d?.city,
            state: d?.state,
            zipCode: d?.zipCode,
            type: d?.type,
          });
        } else {
          setWorksiteDetails(null);
        }
      })
      .catch(() => {
        if (!cancelled && isMountedRef.current) setWorksiteDetails(null);
      })
      .finally(() => {
        if (isMountedRef.current) setWorksiteDetailsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, account?.associations?.locations]);

  // Load tenant WC rates (state+code -> rate; job title maps with optional account modifier).
  useEffect(() => {
    if (!tenantId) return;
    getDocs(collection(db, p.workersCompRates(tenantId)))
      .then((snap) => {
        const built = buildWorkersCompRatesMapsFromSnapshot(snap);
        setWcRatesByKey(built.wcRatesByStateAndCode);
        setWcJobTitleMaps({
          byStateAndJobTitle: built.byStateAndJobTitle,
          byStateJobTitleAndModifierAccount: built.byStateJobTitleAndModifierAccount,
        });
      })
      .catch(() => {
        setWcRatesByKey({});
        setWcJobTitleMaps({ byStateAndJobTitle: {}, byStateJobTitleAndModifierAccount: {} });
      });
  }, [tenantId]);

  const loadOptions = useCallback(async () => {
    if (!tenantId) return;
    if (!isMountedRef.current) return;
    setOptionsLoading(true);
    try {
      const [
        companiesSnap,
        accountsSnap,
        contactsSnap,
        jobOrdersSnap,
        dealsSnap,
        userGroupsSnap,
        savedSmartSnap,
        entitiesSnap,
        usersSnap,
      ] = await Promise.all([
        getDocs(query(collection(db, 'tenants', tenantId, 'crm_companies'), orderBy('companyName', 'asc'))),
        getDocs(query(collection(db, p.recruiterAccounts(tenantId)), orderBy('name', 'asc'))),
        getDocs(collection(db, 'tenants', tenantId, 'crm_contacts')),
        getDocs(query(collection(db, p.jobOrders(tenantId)), orderBy('createdAt', 'desc'))),
        getDocs(query(collection(db, 'tenants', tenantId, 'crm_deals'), orderBy('createdAt', 'desc'))),
        getDocs(collection(db, 'tenants', tenantId, 'userGroups')),
        getDocs(collection(db, 'tenants', tenantId, 'savedSmartGroups')),
        getDocs(collection(db, p.entities(tenantId))),
        // Tenant-scoped: users with this tenant as active, or with this tenant at security 5–7 (so salespeople aren’t missed by a global limit)
        Promise.all([
          getDocs(query(collection(db, 'users'), where('activeTenantId', '==', tenantId))),
          getDocs(
            query(
              collection(db, 'users'),
              where(`tenantIds.${tenantId}.securityLevel`, 'in', ['5', '6', '7'])
            )
          ),
        ]).then(([activeSnap, tenantSnap]) => {
          const byId = new Map(activeSnap.docs.map((d) => [d.id, d]));
          tenantSnap.docs.forEach((d) => byId.set(d.id, d));
          return { docs: [...byId.values()] };
        }),
      ]);
      if (!isMountedRef.current) return;
      setCompanies(
        companiesSnap.docs.map((d) => {
          const dta = d.data();
          const name = dta.companyName || dta.name || d.id;
          return { id: d.id, label: name, companyName: name };
        })
      );
      setAccountOptions(
        accountsSnap.docs.map((d) => {
          const dta = d.data();
          const name = dta.name || d.id;
          return { id: d.id, label: name };
        })
      );
      setEntityOptions(
        entitiesSnap.docs
          .map((d) => {
            const dta = d.data() as any;
            return {
              id: d.id,
              name: dta.name || d.id,
              entityCode: dta.entityCode || '',
              workerType: dta.workerType || '',
              everifyRequired: !!dta.everifyRequired,
            };
          })
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      );
      setContacts(
        contactsSnap.docs.map((d) => {
          const dta = d.data();
          const name = [dta.firstName, dta.lastName].filter(Boolean).join(' ') || dta.fullName || d.id;
          return { id: d.id, label: name, companyId: dta.companyId };
        })
      );
      setJobOrders(
        jobOrdersSnap.docs.map((d) => {
          const dta = d.data();
          return { id: d.id, label: dta.jobOrderName || dta.title || dta.jobTitle || d.id };
        })
      );
      setDeals(
        dealsSnap.docs.map((d) => {
          const dta = d.data();
          const deal = { id: d.id, ...dta };
          const companyIds = getDealCompanyIds(deal);
          return { id: d.id, label: dta.name || d.id, companyIds };
        })
      );
      const ugMap = new Map<string, LaborPoolOption>();
      userGroupsSnap.docs.forEach((d) => {
        const dta = d.data();
        const label = (dta.name || dta.title || dta.groupName || d.id).trim() || d.id;
        const memberIds = dta.memberIds ?? [];
        const memberCount = Array.isArray(memberIds) ? memberIds.length : 0;
        const key = `userGroup-${d.id}`;
        if (!ugMap.has(key)) ugMap.set(key, { id: d.id, label, type: 'userGroup', memberCount });
      });
      // Sort user groups by label for stable order (collection query has no orderBy)
      const ugList = [...ugMap.values()].sort((a, b) => (a.label || '').localeCompare(b.label || ''));
      const sgMap = new Map<string, LaborPoolOption>();
      const sgLabelsSeen = new Set<string>();
      savedSmartSnap.docs.forEach((d) => {
        const dta = d.data();
        const label = (dta.name || dta.label || d.id).trim();
        const labelKey = label.toLowerCase();
        if (sgLabelsSeen.has(labelKey)) return;
        sgLabelsSeen.add(labelKey);
        const memberCount = typeof dta.memberCount === 'number' ? dta.memberCount : (Array.isArray(dta.memberIds) ? dta.memberIds.length : undefined);
        sgMap.set(d.id, { id: d.id, label, type: 'savedSmartGroup', memberCount });
      });
      setLaborPoolOptions([...ugList, ...sgMap.values()]);

      // Build salespeople and recruiters from users (tenant-scoped, client-side filter)
      const toLabel = (d: { firstName?: string; lastName?: string; email?: string }) =>
        [d.firstName, d.lastName].filter(Boolean).join(' ') || d.email?.split('@')[0] || 'Unknown';
      const salespeople: PersonOption[] = [];
      const recruiters: PersonOption[] = [];
      usersSnap.docs.forEach((d) => {
        const data = d.data();
        const uid = d.id;
        const hasTenant =
          data.tenantId === tenantId ||
          data.activeTenantId === tenantId ||
          (data.tenantIds && typeof data.tenantIds === 'object' && tenantId in data.tenantIds);
        if (!hasTenant) return;
        const tenantData = data.tenantIds?.[tenantId];
        const sl = tenantData?.securityLevel ?? data.securityLevel ?? '0';
        const securityLevel = parseInt(String(sl), 10) || 0;
        const crmSales = data.crm_sales === true || tenantData?.crm_sales === true;
        const recruiterTrue =
          data.recruiter === true || data.recruiter === 'true' || tenantData?.recruiter === true;
        const isSales =
          (securityLevel === 5 || securityLevel === 6 || securityLevel === 7) && crmSales;
        const isRecruiter =
          (securityLevel === 5 || securityLevel === 6 || securityLevel === 7) && recruiterTrue;
        const label = toLabel(data);
        if (isSales) salespeople.push({ id: uid, label });
        if (isRecruiter) recruiters.push({ id: uid, label });
      });
      setSalespeopleOptions(salespeople.sort((a, b) => (a.label || '').localeCompare(b.label || '')));
      setRecruitersOptions(recruiters.sort((a, b) => (a.label || '').localeCompare(b.label || '')));
    } catch (e) {
      if (isMountedRef.current) console.error('loadOptions', e);
    } finally {
      if (isMountedRef.current) setOptionsLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  const loadedLocationCompanyIdsRef = useRef<Set<string>>(new Set());
  const loadLocationsForCompanies = useCallback(
    async (companyIds: string[]) => {
      if (!tenantId || companyIds.length === 0) return;
      const toFetch = companyIds.filter((id) => !loadedLocationCompanyIdsRef.current.has(id));
      if (toFetch.length === 0) return;
      toFetch.forEach((id) => loadedLocationCompanyIdsRef.current.add(id));
      const results: Record<string, LocationOption[]> = {};
      await Promise.all(
        toFetch.map(async (companyId) => {
          const snap = await getDocs(
            query(collection(db, p.accountLocations(tenantId, companyId)), orderBy('name', 'asc'))
          );
          results[companyId] = snap.docs.map((d) => {
            const dta = d.data();
            return {
              companyId,
              locationId: d.id,
              label: dta.name || dta.nickname || d.id,
            };
          });
        })
      );
      if (!isMountedRef.current) return;
      setLocationsByCompany((prev) => ({ ...prev, ...results }));
    },
    [tenantId]
  );

  useEffect(() => {
    const ids = account?.associations?.companyIds ?? [];
    if (ids.length > 0) loadLocationsForCompanies(ids);
  }, [account?.associations?.companyIds, loadLocationsForCompanies]);

  // Child accounts: load parent's companies so Worksite/Location widget can show parent's locations
  useEffect(() => {
    const parentId = account?.parentAccountId;
    if (!tenantId || !parentId) {
      setParentCompanyIds([]);
      return;
    }
    let cancelled = false;
    const parentRef = doc(db, p.recruiterAccount(tenantId, parentId));
    getDoc(parentRef).then((snap) => {
      if (cancelled || !isMountedRef.current) return;
      const assoc = snap.exists() ? (snap.data() as any)?.associations : null;
      const ids = Array.isArray(assoc?.companyIds) ? assoc.companyIds : [];
      setParentCompanyIds(ids);
      if (ids.length > 0) loadLocationsForCompanies(ids);
    }).catch(() => {
      if (!cancelled && isMountedRef.current) setParentCompanyIds([]);
    });
    return () => { cancelled = true; };
  }, [tenantId, account?.parentAccountId, loadLocationsForCompanies]);

  // Child account: load parent's first company logo for header avatar
  useEffect(() => {
    const parentId = account?.parentAccountId;
    if (!tenantId || !parentId) {
      setParentAccountLogoUrl(null);
      return;
    }
    let cancelled = false;
    const parentRef = doc(db, p.recruiterAccount(tenantId, parentId));
    getDoc(parentRef).then((snap) => {
      if (cancelled || !isMountedRef.current) return;
      const assoc = snap.exists() ? (snap.data() as any)?.associations : null;
      const firstCompanyId = Array.isArray(assoc?.companyIds) ? assoc.companyIds[0] : null;
      if (!firstCompanyId) {
        setParentAccountLogoUrl(null);
        return;
      }
      const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', firstCompanyId);
      return getDoc(companyRef).then((companySnap) => {
        if (cancelled || !isMountedRef.current) return;
        const logo = companySnap.exists() ? (companySnap.data() as any)?.logo ?? null : null;
        setParentAccountLogoUrl(logo || null);
      });
    }).catch(() => {
      if (!cancelled && isMountedRef.current) setParentAccountLogoUrl(null);
    });
    return () => { cancelled = true; };
  }, [tenantId, account?.parentAccountId]);

  // Load first linked company's logo for account avatar
  useEffect(() => {
    const firstCompanyId = account?.associations?.companyIds?.[0];
    if (!tenantId || !firstCompanyId) {
      setAccountCompanyLogoUrl(null);
      return;
    }
    let cancelled = false;
    const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', firstCompanyId);
    getDoc(companyRef).then((snap) => {
      if (cancelled || !isMountedRef.current) return;
      const logo = snap.exists() ? (snap.data() as any)?.logo ?? null : null;
      setAccountCompanyLogoUrl(logo || null);
    }).catch(() => {
      if (!cancelled && isMountedRef.current) setAccountCompanyLogoUrl(null);
    });
    return () => { cancelled = true; };
  }, [tenantId, account?.associations?.companyIds]);

  /** Child accounts: flatten parent-linked company locations for Worksites picker (Cascading Data tab). */
  const childWorksiteSelectOptions = useMemo(() => {
    if (!isChildAccount) return [] as { companyId: string; locationId: string; label: string }[];
    const ids =
      parentCompanyIds.length > 0 ? parentCompanyIds : (account?.associations?.companyIds ?? []);
    const rows: { companyId: string; locationId: string; label: string }[] = [];
    for (const cid of ids) {
      for (const o of locationsByCompany[cid] ?? []) {
        rows.push({
          companyId: cid,
          locationId: o.locationId,
          label: o.label || o.locationId,
        });
      }
    }
    rows.sort((a, b) => a.label.localeCompare(b.label));
    return rows;
  }, [isChildAccount, parentCompanyIds, locationsByCompany, account?.associations?.companyIds]);

  // Load account file uploads
  const loadAccountUploads = useCallback(async () => {
    if (!tenantId || !accountId) return;
    const uploadsRef = collection(db, p.recruiterAccountUploads(tenantId, accountId));
    const q = query(uploadsRef, orderBy('createdAt', 'desc'));
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
    if (isMountedRef.current) setAccountUploads(list);
  }, [tenantId, accountId]);

  useEffect(() => {
    if (accountId && tenantId) loadAccountUploads();
  }, [accountId, tenantId, loadAccountUploads]);

  useEffect(() => {
    if (!tenantId || !accountId) return;
    const notesRef = collection(db, 'tenants', tenantId, 'account_notes');
    const q = query(notesRef, where('entityId', '==', accountId));
    const unsub = onSnapshot(q, (snap) => setNotesCount(snap.size), (err) => console.error('account_notes count', err));
    return () => unsub();
  }, [tenantId, accountId]);

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !tenantId || !accountId || !user?.uid) return;
    const name = (uploadLabel || 'Document').trim();
    setUploading(true);
    try {
      const uploadsRef = collection(db, p.recruiterAccountUploads(tenantId, accountId));
      const newRef = doc(uploadsRef);
      const uploadId = newRef.id;
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `tenants/${tenantId}/accounts/${accountId}/uploads/${uploadId}/${safeName}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      await setDoc(newRef, {
        name,
        fileName: file.name,
        storagePath,
        url,
        createdAt: serverTimestamp(),
        createdBy: user.uid,
      });
      await loadAccountUploads();
      setUploadLabel('');
      setUploadFileKey((k) => k + 1);
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    } catch (err) {
      console.error('Account upload error:', err);
      if (isMountedRef.current) {
        const msg = (err as Error)?.message || 'Upload failed';
        alert(msg);
      }
    } finally {
      if (isMountedRef.current) setUploading(false);
    }
  };

  const handleDeleteUpload = async (uploadId: string) => {
    const row = accountUploads.find((u) => u.id === uploadId);
    if (!row || !tenantId || !accountId) return;
    setDeleteConfirmUploadId(null);
    try {
      const storageRef = ref(storage, row.storagePath);
      await deleteObject(storageRef);
      await deleteDoc(doc(db, p.recruiterAccountUpload(tenantId, accountId, uploadId)));
      await loadAccountUploads();
    } catch (err) {
      console.error('Delete upload error:', err);
      if (isMountedRef.current) alert((err as Error)?.message || 'Delete failed');
    }
  };

  const loadAccount = async () => {
    if (!accountId || !tenantId) return;
    if (!isMountedRef.current) return;
    setLoading(true);
    setError(null);
    try {
      const ref = doc(db, p.recruiterAccount(tenantId, accountId));
      const snap = await getDoc(ref);
      if (!isMountedRef.current) return;
      if (!snap.exists()) {
        setError('Account not found');
        setAccount(null);
        return;
      }
      const data = snap.data();
      const assoc = data?.associations;
      let parentAccountId = data?.parentAccountId ?? null;

      // Keep parent-child bidirectional: if another account lists this one as a child, we should show them as parent
      try {
        const accountsRef = collection(db, p.recruiterAccounts(tenantId));
        const parentQuery = query(
          accountsRef,
          where('childAccountIds', 'array-contains', accountId)
        );
        const parentSnap = await getDocs(parentQuery);
        if (!parentSnap.empty && parentSnap.docs.length === 1) {
          const parentId = parentSnap.docs[0].id;
          if (parentAccountId !== parentId) {
            await updateDoc(ref, {
              parentAccountId: parentId,
              updatedAt: serverTimestamp(),
              updatedBy: user?.uid ?? null,
            });
            parentAccountId = parentId;
          }
        }
      } catch (syncErr) {
        console.warn('RecruiterAccountDetails: parent sync on load', syncErr);
      }

      if (!isMountedRef.current) return;
      const rawAccountType = data?.accountType ?? null;
      const childAccountIdsArr = Array.isArray(data?.childAccountIds) ? data.childAccountIds : [];
      const derivedAccountType =
        rawAccountType != null && rawAccountType !== ''
          ? rawAccountType
          : parentAccountId
            ? ('child' as const)
            : childAccountIdsArr.length > 0
              ? ('national' as const)
              : ('standalone' as const);

      const qb = data?.integrations?.quickbooks;
      setAccount({
        id: snap.id,
        name: data?.name ?? '',
        active: data?.active !== false,
        accountType: derivedAccountType,
        hiringEntityId: data?.hiringEntityId ?? null,
        parentAccountId,
        childAccountIds: childAccountIdsArr,
        mspAccountIds: Array.isArray(data?.mspAccountIds) ? data.mspAccountIds : [],
        createdAt: data?.createdAt,
        updatedAt: data?.updatedAt,
        createdBy: data?.createdBy,
        updatedBy: data?.updatedBy,
        associations: assoc
          ? {
              companyIds: assoc.companyIds ?? [],
              locations: assoc.locations ?? [],
              contactIds: assoc.contactIds ?? [],
              jobOrderIds: assoc.jobOrderIds ?? [],
              dealIds: assoc.dealIds ?? [],
              userGroupIds: assoc.userGroupIds ?? [],
              savedSmartGroupIds: assoc.savedSmartGroupIds ?? [],
              salespersonIds: assoc.salespersonIds ?? [],
              recruiterIds: assoc.recruiterIds ?? [],
            }
          : undefined,
        integrations: qb != null ? { quickbooks: qb } : undefined,
        autoCreateChildAccountsForLocations: data?.autoCreateChildAccountsForLocations === true,
        autoCreateGigJobOrders: data?.autoCreateGigJobOrders === true,
        /**
         * AG.0 — auto-create one user group per (childAccount × defaultGigJobTitle).
         * Tri-state on disk: `true` / `false` / `undefined`. Read-time default at the
         * trigger is `true` when `autoCreateGigJobOrders === true` (see
         * `shouldAutoCreateUserGroups` in `nationalChildCascadeMerge.ts`); the UI
         * mirrors that default for the rendered checkbox state.
         */
        autoCreateUserGroups:
          typeof data?.autoCreateUserGroups === 'boolean' ? data.autoCreateUserGroups : undefined,
        /** F.4 national gig seed — must match Firestore top-level fields or Cascading Data reload drops them. */
        defaultGigJobTitle: data?.defaultGigJobTitle ?? null,
        defaultGigJobDescription: data?.defaultGigJobDescription ?? null,
        autoCreatedFromCompanyLocation: data?.autoCreatedFromCompanyLocation === true,
        companyId: data?.companyId ?? undefined,
        companyLocationId: data?.companyLocationId ?? undefined,
        /** Required for Order Defaults tab (staff instructions + attachments); must mirror Firestore document. */
        orderDefaults: data?.orderDefaults ?? undefined,
        /**
         * Phase 3 of `docs/RECRUITING_ROLE_MODEL.md` — `roles.schedulerIds`
         * is the per-account list of Schedulers stamped onto new orders.
         * Without this projection the `AccountRecruitingRolesCard` would
         * silently re-render with `[]` after every navigation away/back
         * (the `updateDoc` call at save time correctly persists the
         * dotted path to Firestore — Web SDK semantics — but the explicit
         * shape rebuilt here was dropping the field on read).
         */
        roles: data?.roles && typeof data.roles === 'object'
          ? {
              schedulerIds: Array.isArray(data.roles.schedulerIds)
                ? (data.roles.schedulerIds as string[])
                : [],
            }
          : undefined,
      });

      // Reset so accounts without `defaults.rules` / `defaults.billing` do not keep prior account's state.
      setDefaultRules({ ...defaultRulesInitial });
      setDefaultBilling({ ...defaultBillingInitial });
      setDefaultEVerify({ ...defaultEVerifyInitial });

      const d = data?.defaults;
      if (d && typeof d === 'object') {
        const r = d.rules;
        if (r && typeof r === 'object') {
          setDefaultRules({
            replacingExistingAgency: !!r.replacingExistingAgency,
            rolloverExistingStaff: !!r.rolloverExistingStaff,
            timeclockSystem: r.timeclockSystem ?? '',
            attendancePolicy: r.attendancePolicy ?? '',
            noShowPolicy: r.noShowPolicy ?? '',
            overtimePolicy: r.overtimePolicy ?? '',
            callOffPolicy: r.callOffPolicy ?? '',
            injuryHandlingPolicy: r.injuryHandlingPolicy ?? '',
            disciplinePolicy: r.disciplinePolicy ?? '',
          });
        }
        const b = d.billing;
        if (b && typeof b === 'object') {
          setDefaultBilling({
            poRequired: !!b.poRequired,
            paymentTerms: b.paymentTerms ?? '',
            invoiceDeliveryMethod: b.invoiceDeliveryMethod ?? '',
            invoiceFrequency: b.invoiceFrequency ?? '',
            sendInvoicesTo: Array.isArray(b.sendInvoicesTo) ? b.sendInvoicesTo : [],
            billingNotes: b.billingNotes ?? '',
          });
        }
        const e = d.eVerify;
        if (e && typeof e === 'object') {
          setDefaultEVerify({ eVerifyRequired: !!e.eVerifyRequired });
        }
      }
      const pr = data?.pricing;
      if (pr && typeof pr === 'object') {
        setPricingSubAccountsManageOwn(!!pr.subAccountsManageOwnPricing);
        setPricingFlatMarkupPercent(pr.flatMarkupPercent != null && pr.flatMarkupPercent !== '' ? Number(pr.flatMarkupPercent) : '');
        const positionsForState: AccountPositionPricing[] = Array.isArray(pr.positions)
          ? pr.positions.map((p: any) => ({ ...p, id: p.id || `pos-${Math.random().toString(36).slice(2)}` }))
          : [];
        setPricingPositions(positionsForState);
        setPricingNotes(pr.pricingNotes ?? '');
        // R.16.2a Phase 3 — seed the per-position diff baseline. Keyed
        // by the position's stable `positionId` (when present), then by
        // the synthesised local `id` as fallback for legacy rows that
        // never had one. The diff inside `savePricing` will use the
        // same key resolution.
        lastSavedPricingPositionsRef.current = new Map(
          positionsForState.map((row) => [
            String((row as any).positionId ?? row.id),
            {
              payRate: (row as any).payRate ?? null,
              billRate: (row as any).billRate ?? null,
              markupPercent: (row as any).markupPercent ?? null,
              workersCompRate: (row as any).workersCompRate ?? null,
              workersCompCode: (row as any).workersCompCode ?? null,
            },
          ]),
        );
      } else {
        setPricingSubAccountsManageOwn(false);
        setPricingFlatMarkupPercent('');
        setPricingPositions([]);
        setPricingNotes('');
        lastSavedPricingPositionsRef.current = new Map();
      }
      // R.16.2a Phase 3 — seed the top-level `hiringEntityId` baseline
      // from the freshly loaded account doc. Subsequent edits via
      // `updateAccountField('hiringEntityId', ...)` diff against this
      // ref before queuing a banner.
      lastSavedHiringEntityIdRef.current = (data?.hiringEntityId as string | null | undefined) ?? null;
    } catch (err) {
      if (!isMountedRef.current) return;
      console.error('RecruiterAccountDetails: load error', err);
      setError('Failed to load account');
      setAccount(null);
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  };

  const fetchAccountJobOrders = useCallback(async () => {
    const companyIdsToUse = isChildAccount ? parentCompanyIds : (account?.associations?.companyIds ?? []);
    if (!tenantId || companyIdsToUse.length === 0) {
      setAccountJobOrders([]);
      return;
    }
    const companyIds = new Set(companyIdsToUse);
    setAccountJobOrdersLoading(true);
    setAccountJobOrdersError(null);
    try {
      const baseRef = collection(db, p.jobOrders(tenantId));
      const q = query(baseRef, orderBy('createdAt', 'desc'), limit(500));
      const snap = await getDocs(q);
      const docsToMap = snap.docs.filter((d) => {
        const data = d.data();
        const companyId = (data as any).companyId || (data as any).deal?.companyId;
        return companyId && companyIds.has(companyId);
      });
      let newJobOrders: JobOrderWithDetails[] = await Promise.all(
        docsToMap.map(async (jobOrderDoc) => {
          const data = jobOrderDoc.data() as JobOrder;
          const flatCompanyId = (data as any).companyId || (data as any).deal?.companyId;
          const derivedJobTitle =
            (data as any).jobTitle ||
            (Array.isArray((data as any).gigPositions) && (data as any).gigPositions[0]?.jobTitle) ||
            undefined;
          let companyName = 'Unknown Company';
          if (flatCompanyId) {
            try {
              const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', flatCompanyId);
              const companySnap = await getDoc(companyRef);
              if (companySnap.exists()) {
                const companyData = companySnap.data() as any;
                companyName = companyData.companyName || companyData.name || 'Unknown Company';
              }
            } catch (_) {}
          }
          let locationName = 'No Location';
          // Pull the full address too so the Sub accounts grouped view can
          // render worksite name + street / city,state zip underneath without
          // needing a second round-trip per row. Prefer inline `worksiteAddress`
          // on the JO; fall back to the linked location doc if it's empty.
          let worksiteAddressForDetails:
            | { street?: string; city?: string; state?: string; zipCode?: string }
            | undefined = (data as any).worksiteAddress;
          const flatWorksiteId = (data as any).worksiteId || (data as any).deal?.locationId;
          const flatWorksiteName = (data as any).worksiteName || (data as any).deal?.locationName;
          if (flatWorksiteName) {
            locationName = flatWorksiteName;
          }
          const needsLocationFetch =
            !flatWorksiteName ||
            !worksiteAddressForDetails ||
            !(worksiteAddressForDetails.street || worksiteAddressForDetails.city);
          if (needsLocationFetch && flatWorksiteId && flatCompanyId) {
            try {
              const locationRef = doc(db, 'tenants', tenantId, 'crm_companies', flatCompanyId, 'locations', flatWorksiteId);
              const locationSnap = await getDoc(locationRef);
              if (locationSnap.exists()) {
                const locationData = locationSnap.data() as any;
                if (!flatWorksiteName) {
                  locationName = locationData.nickname || locationData.name || 'Unknown Location';
                }
                if (!worksiteAddressForDetails || !(worksiteAddressForDetails.street || worksiteAddressForDetails.city)) {
                  const addrFromLoc = locationData.address;
                  if (addrFromLoc && typeof addrFromLoc === 'object') {
                    worksiteAddressForDetails = {
                      street: addrFromLoc.street,
                      city: addrFromLoc.city,
                      state: addrFromLoc.state,
                      zipCode: addrFromLoc.zipCode || addrFromLoc.zip,
                    };
                  } else if (typeof addrFromLoc === 'string') {
                    worksiteAddressForDetails = {
                      street: addrFromLoc,
                      city: locationData.city,
                      state: locationData.state,
                      zipCode: locationData.zipCode || locationData.zip,
                    };
                  }
                }
              }
            } catch (_) {}
          }
          let recruiterName = 'Unassigned';
          const assignedRecruiters = (data as any).assignedRecruiters || [];
          if (Array.isArray(assignedRecruiters) && assignedRecruiters.length > 0) {
            try {
              const recruiterRef = doc(db, 'users', assignedRecruiters[0]);
              const recruiterSnap = await getDoc(recruiterRef);
              if (recruiterSnap.exists()) {
                const recruiterData = recruiterSnap.data();
                recruiterName = `${recruiterData.firstName || ''} ${recruiterData.lastName || ''}`.trim() || recruiterData.displayName || assignedRecruiters[0];
                if (assignedRecruiters.length > 1) recruiterName += ` (+${assignedRecruiters.length - 1})`;
              }
            } catch (_) {
              recruiterName = assignedRecruiters.length > 1 ? `${assignedRecruiters.length} recruiters` : 'Unassigned';
            }
          }
          return {
            ...data,
            id: jobOrderDoc.id,
            companyName,
            locationName,
            jobTitle: derivedJobTitle,
            recruiterName,
            workersNeeded: (data as any).workersNeeded ?? (data as any).openings ?? 0,
            headcountFilled: (data as any).headcountFilled ?? (data as any).remainingOpenings ?? 0,
            // Carry the resolved address forward so Sub accounts view can render
            // it on two lines under the worksite name. Overwrites any partial
            // inline `worksiteAddress` with the hydrated version from the
            // location doc when one was needed.
            ...(worksiteAddressForDetails
              ? { worksiteAddress: worksiteAddressForDetails as any }
              : {}),
          };
        })
      );
      if (isChildAccount && accountId) {
        const locationKeys = new Set(
          (account?.associations?.locations ?? []).map((loc: { companyId: string; locationId: string }) => `${loc.companyId}:${loc.locationId}`)
        );
        newJobOrders = newJobOrders.filter((jo) => {
          const rid = (jo as any).recruiterAccountId;
          if (rid === accountId) return true;
          const cid = (jo as any).companyId || (jo as any).deal?.companyId;
          const wid = (jo as any).worksiteId || (jo as any).deal?.locationId;
          return cid && wid && locationKeys.has(`${cid}:${wid}`);
        });
      }
      if (!isMountedRef.current) return;
      setAccountJobOrders(newJobOrders);
    } catch (err) {
      if (!isMountedRef.current) return;
      const errMsg = (err as Error)?.message || 'Failed to load job orders';
      setAccountJobOrdersError(errMsg);
      setAccountJobOrders([]);
    } finally {
      if (isMountedRef.current) setAccountJobOrdersLoading(false);
    }
  }, [tenantId, accountId, isChildAccount, parentCompanyIds, account?.associations?.companyIds, account?.associations?.locations]);

  const jobOrdersTabCompanyIds = isChildAccount ? parentCompanyIds : (account?.associations?.companyIds ?? []);
  useEffect(() => {
    const needsJobOrders = tabValue === 2 || tabValue === 4 || tabValue === 9 || tabValue === 11;
    if (needsJobOrders && jobOrdersTabCompanyIds.length) {
      fetchAccountJobOrders();
    } else if ((tabValue === 4 || tabValue === 9) && !jobOrdersTabCompanyIds.length) {
      setAccountJobOrders([]);
      setAccountJobOrdersError(null);
    }
  }, [tabValue, jobOrdersTabCompanyIds.length, fetchAccountJobOrders]);

  const fetchAccountJobPosts = useCallback(async () => {
    const companyIdsToUse = isChildAccount ? parentCompanyIds : (account?.associations?.companyIds ?? []);
    if (!tenantId || companyIdsToUse.length === 0) {
      setAccountJobPosts([]);
      return;
    }
    const companyIds = new Set(companyIdsToUse);
    setAccountJobPostsLoading(true);
    try {
      const jobsBoardService = JobsBoardService.getInstance();
      const allPosts = await jobsBoardService.getAllPosts(tenantId);
      const filtered = allPosts.filter((post) => post.companyId && companyIds.has(post.companyId));
      if (!isMountedRef.current) return;
      setAccountJobPosts(filtered);
    } catch (err) {
      if (isMountedRef.current) {
        console.error('Account job posts load error:', err);
        setAccountJobPosts([]);
      }
    } finally {
      if (isMountedRef.current) setAccountJobPostsLoading(false);
    }
  }, [tenantId, isChildAccount, parentCompanyIds, account?.associations?.companyIds]);

  useEffect(() => {
    const companyIdsToUse = isChildAccount ? parentCompanyIds : (account?.associations?.companyIds ?? []);
    if (tabValue === 9 && companyIdsToUse.length) {
      fetchAccountJobPosts();
    } else if (tabValue === 9 && !companyIdsToUse.length) {
      setAccountJobPosts([]);
    }
  }, [tabValue, isChildAccount, parentCompanyIds, account?.associations?.companyIds, fetchAccountJobPosts]);

  /** For child account, Jobs Board shows only posts linked to job orders in scope (this account or its worksites). */
  const scopedAccountJobPosts = useMemo(() => {
    if (!isChildAccount) return accountJobPosts;
    const inScopeJobOrderIds = new Set(accountJobOrders.map((jo) => jo.id));
    return accountJobPosts.filter((p) => p.jobOrderId && inScopeJobOrderIds.has(p.jobOrderId));
  }, [isChildAccount, accountJobPosts, accountJobOrders]);

  const fetchAccountLocations = useCallback(async () => {
    if (!tenantId || !account?.associations?.companyIds?.length) {
      setAccountLocationsList([]);
      return;
    }
    setAccountLocationsLoading(true);
    try {
      const companyIds = account.associations.companyIds;
      const companyNames = new Map(companies.map((c) => [c.id, c.label ?? c.id]));
      const all: AccountLocationRow[] = [];
      for (const companyId of companyIds) {
        const locRef = collection(db, p.accountLocations(tenantId, companyId));
        const q = query(locRef, orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        const companyName = companyNames.get(companyId) ?? '—';
        snapshot.docs.forEach((d) => {
          const data = d.data();
          all.push({
            id: d.id,
            name: data.name,
            nickname: data.nickname,
            code: data.code,
            address: data.address,
            street: data.street,
            city: data.city,
            state: data.state,
            zipCode: data.zipCode,
            type: data.type,
            division: data.division,
            contactCount: data.contactCount ?? 0,
            dealCount: data.dealCount ?? 0,
            companyId,
            companyName,
            active: data.active !== false,
          });
        });
      }
      if (isMountedRef.current) setAccountLocationsList(all);
    } catch (err) {
      if (isMountedRef.current) {
        console.error('Account locations load error:', err);
        setAccountLocationsList([]);
      }
    } finally {
      if (isMountedRef.current) setAccountLocationsLoading(false);
    }
  }, [tenantId, account?.associations?.companyIds, companies]);

  const openAddLocationDialogForAccount = useCallback(() => {
    const ids = isChildAccount ? parentCompanyIds : (account?.associations?.companyIds ?? []);
    if (!ids.length) return;
    setAddLocationCompanyId(ids[0]);
    setAddLocationForm({
      name: '',
      code: '',
      address: '',
      city: '',
      state: '',
      zipCode: '',
      country: 'USA',
      type: 'Office',
      division: '',
      phone: '',
      coordinates: null,
    });
    setAddLocationError(null);
    setShowAddLocationDialog(true);
  }, [isChildAccount, parentCompanyIds, account?.associations?.companyIds]);

  const handleAddLocationAccount = useCallback(async () => {
    const companyId =
      addLocationCompanyId ||
      (isChildAccount ? parentCompanyIds[0] : undefined) ||
      account?.associations?.companyIds?.[0];
    if (!tenantId || !companyId || !addLocationForm.name || !addLocationForm.address) return;
    setAddLocationSubmitting(true);
    setAddLocationError(null);
    try {
      const locationData = {
        ...addLocationForm,
        createdAt: new Date().toISOString(),
        discoveredBy: 'Manual',
        contactCount: 0,
        dealCount: 0,
        salespersonCount: 0,
      };
      const locationsRef = collection(db, p.accountLocations(tenantId, companyId));
      await addDoc(locationsRef, locationData);
      ensureCityInSmartGroups(tenantId, addLocationForm.city || '', addLocationForm.state || '').catch(() => {});
      setAddLocationForm({
        name: '',
        code: '',
        address: '',
        city: '',
        state: '',
        zipCode: '',
        country: 'USA',
        type: 'Office',
        division: '',
        phone: '',
        coordinates: null,
      });
      setShowAddLocationDialog(false);
      fetchAccountLocations();
      loadLocationsForCompanies([companyId]).catch(() => {});
    } catch (err) {
      console.error('Error adding location:', err);
      setAddLocationError('Failed to add location');
    } finally {
      setAddLocationSubmitting(false);
    }
  }, [
    tenantId,
    isChildAccount,
    parentCompanyIds,
    account?.associations?.companyIds,
    addLocationCompanyId,
    addLocationForm,
    fetchAccountLocations,
    loadLocationsForCompanies,
  ]);

  // Only fetch full company locations for national/standalone accounts; child accounts show only their worksites
  useEffect(() => {
    if (tabValue === 5 && !isNationalAccount && account?.associations?.companyIds?.length) {
      fetchAccountLocations();
    } else if (tabValue === 6 && !isChildAccount && account?.associations?.companyIds?.length) {
      fetchAccountLocations();
    } else if (tabValue === 5 && (isNationalAccount || !account?.associations?.companyIds?.length)) {
      setAccountLocationsList([]);
    }
  }, [tabValue, isNationalAccount, isChildAccount, account?.associations?.companyIds, fetchAccountLocations]);

  // Labor Pool: load unique applicant counts per job order. Mirrors
  // `RecruiterJobOrderDetail.fetchApplicants()` — applications can link via
  // `jobOrderId` (direct), `jobId` (a connected jobs-board post), or `postId`
  // (legacy field). Counting only `jobOrderId` undercounts. We dedupe by
  // `userId` so a worker applying to multiple shifts inside one job order
  // still counts once.
  useEffect(() => {
    const fromAssoc = account?.associations?.jobOrderIds ?? [];
    const fromAccountTab = accountJobOrders.map((jo) => jo.id);
    const ids = Array.from(new Set([...fromAssoc, ...fromAccountTab]));
    if (!tenantId || ids.length === 0) {
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

        if (cancelled || !isMountedRef.current) return;
        const next: Record<string, number> = {};
        ids.forEach((id) => {
          next[id] = setsByJo.get(id)?.size ?? 0;
        });
        setJobOrderApplicantCounts(next);
      } catch (err) {
        console.warn('RecruiterAccountDetails: applicant count fetch failed', err);
        if (!cancelled && isMountedRef.current) setJobOrderApplicantCounts({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId, account?.associations?.jobOrderIds, accountJobOrders]);

  // Invoicing tab is available to security levels 5, 6, 7; redirect others to Overview
  useEffect(() => {
    if (tabValue === 13 && !canAccessInvoicing) {
      setAccountTab(1);
    }
  }, [tabValue, canAccessInvoicing, setAccountTab]);

  // Child accounts don't have a Locations tab; switch to Overview if that tab is selected
  useEffect(() => {
    if (isChildAccount && tabValue === 5) {
      setAccountTab(1);
    }
  }, [isChildAccount, tabValue, setAccountTab]);

  const fetchChildAccounts = useCallback(async () => {
    if (!tenantId || !account?.id) {
      setChildAccountsList([]);
      return;
    }
    setChildAccountsLoading(true);
    try {
      const ref = collection(db, p.recruiterAccounts(tenantId));
      const q = query(ref, where('parentAccountId', '==', account.id), orderBy('name', 'asc'));
      const snap = await getDocs(q);
      const list: ChildAccountRow[] = snap.docs.map((d) => {
        const data = d.data();
        const defaults = data.defaults;
        const eVerify = defaults?.eVerify && typeof defaults.eVerify === 'object' ? defaults.eVerify : null;
        return {
          id: d.id,
          name: data.name ?? '',
          active: data.active !== false,
          accountType: data.accountType ?? 'child',
          hiringEntityId: data.hiringEntityId ?? null,
          eVerifyRequired: eVerify ? !!eVerify.eVerifyRequired : false,
        };
      });
      if (isMountedRef.current) setChildAccountsList(list);
    } catch (err) {
      if (isMountedRef.current) {
        console.error('Child accounts load error:', err);
        setChildAccountsList([]);
      }
    } finally {
      if (isMountedRef.current) setChildAccountsLoading(false);
    }
  }, [tenantId, account?.id]);

  const runNationalBackfillChildAccounts = useCallback(async () => {
    if (!tenantId || !account?.id) return;
    setNationalBackfillLoading(true);
    setNationalBackfillError(null);
    try {
      const fn = httpsCallable(functions, 'backfillNationalAccountChildAccountsFromLocations');
      const res = await fn({ tenantId, nationalAccountId: account.id });
      const d = res.data as Record<string, unknown>;
      setNationalBackfillSummary({
        locationsProcessed: Number(d.locationsProcessed) || 0,
        created: Number(d.created) || 0,
        skipped_duplicate: Number(d.skipped_duplicate) || 0,
        skipped_idempotent: Number(d.skipped_idempotent) || 0,
      });
      setNationalBackfillStep('result');
      void loadAccount();
      await fetchChildAccounts();
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message?: string }).message)
          : 'Request failed';
      setNationalBackfillError(msg);
    } finally {
      setNationalBackfillLoading(false);
    }
  }, [tenantId, account?.id, fetchChildAccounts]);

  // §14b — one-shot retroactive scan: spawn a draft gig JO for any
  // existing child account that doesn't already have one. Idempotent —
  // re-running counts already-spawned JOs as `alreadyHad`.
  const runGigJobOrdersBackfill = useCallback(async () => {
    if (!tenantId || !account?.id) return;
    setGigBackfillLoading(true);
    setGigBackfillError(null);
    try {
      const fn = httpsCallable(functions, 'backfillGigJobOrdersForNationalAccount');
      const res = await fn({ tenantId, nationalAccountId: account.id });
      const d = res.data as {
        summary?: {
          created?: number;
          alreadyHad?: number;
          skipped?: number;
          totalChildAccounts?: number;
        };
        audit?: unknown[];
      };
      const summary = d?.summary || {};
      setGigBackfillSummary({
        created: Number(summary.created) || 0,
        alreadyHad: Number(summary.alreadyHad) || 0,
        skipped: Number(summary.skipped) || 0,
        totalChildAccounts: Number(summary.totalChildAccounts) || 0,
      });
      setGigBackfillStep('result');
      // Audit list is too large for the dialog — log it to console so
      // a recruiter or staff can copy/paste into a ticket if a row
      // unexpectedly fails. We deliberately skip surfacing per-row
      // failures inline because the summary already exposes the count.
      if (Array.isArray(d?.audit) && d.audit.length > 0) {
        // eslint-disable-next-line no-console
        console.info('[gig backfill audit]', d.audit);
      }
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message?: string }).message)
          : 'Request failed';
      setGigBackfillError(msg);
    } finally {
      setGigBackfillLoading(false);
    }
  }, [tenantId, account?.id]);

  useEffect(() => {
    if (((tabValue === 5 && isNationalAccount) || tabValue === 7) && account?.id) {
      fetchChildAccounts();
    } else if (tabValue === 5 && !account?.id) {
      setChildAccountsList([]);
    }
  }, [tabValue, account?.id, isNationalAccount, fetchChildAccounts]);

  const filteredChildAccounts = useMemo(() => {
    const q = (childrenSearchQuery || '').trim().toLowerCase();
    if (!q) return childAccountsList;
    return childAccountsList.filter((a) => (a.name || '').toLowerCase().includes(q));
  }, [childAccountsList, childrenSearchQuery]);

  const filteredAccountLocations = useMemo(() => {
    const q = (locationsSearchQuery || '').trim().toLowerCase();
    if (!q) return accountLocationsList;
    return accountLocationsList.filter(
      (loc) =>
        (loc.name ?? '').toLowerCase().includes(q) ||
        (loc.nickname ?? '').toLowerCase().includes(q) ||
        (loc.code ?? '').toLowerCase().includes(q) ||
        (loc.city ?? '').toLowerCase().includes(q) ||
        (loc.state ?? '').toLowerCase().includes(q)
    );
  }, [accountLocationsList, locationsSearchQuery]);

  const contactTabCompanyIds = useMemo(
    () => (isChildAccount ? parentCompanyIds : (account?.associations?.companyIds ?? [])),
    [isChildAccount, parentCompanyIds, account?.associations?.companyIds]
  );

  const fetchAccountContacts = useCallback(async (companyIdsOverride?: string[]) => {
    const companyIds = companyIdsOverride ?? account?.associations?.companyIds ?? [];
    if (!tenantId || !companyIds.length) {
      setAccountContactsList([]);
      return;
    }
    setAccountContactsLoading(true);
    try {
      const ids = companyIds.slice(0, 30);
      const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
      const q = query(contactsRef, where('companyId', 'in', ids));
      const snapshot = await getDocs(q);
      const list: AccountContactRow[] = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as AccountContactRow));
      list.sort((a, b) => ((a.firstName || '') + (a.lastName || '')).localeCompare((b.firstName || '') + (b.lastName || '')));
      if (isMountedRef.current) setAccountContactsList(list);
    } catch (err) {
      if (isMountedRef.current) {
        console.error('Account contacts load error:', err);
        setAccountContactsList([]);
      }
    } finally {
      if (isMountedRef.current) setAccountContactsLoading(false);
    }
  }, [tenantId, account?.associations?.companyIds]);

  useEffect(() => {
    if (tabValue === 6 && contactTabCompanyIds.length) {
      fetchAccountContacts(contactTabCompanyIds);
    } else if (tabValue === 6) {
      setAccountContactsList([]);
    }
  }, [tabValue, contactTabCompanyIds, fetchAccountContacts]);

  const [contactsWorksiteFilter, setContactsWorksiteFilter] = useState('');
  const [contactsStateFilter, setContactsStateFilter] = useState('');

  const availableContactWorksites = useMemo(() => {
    const names = new Set<string>();
    accountLocationsList.forEach((loc) => {
      const n = loc.name || loc.nickname || loc.id;
      if (n) names.add(n);
    });
    return Array.from(names).sort();
  }, [accountLocationsList]);

  const availableContactStates = useMemo(() => {
    const states = new Set<string>();
    accountLocationsList.forEach((loc) => {
      if (loc.state) states.add(loc.state);
    });
    return Array.from(states).sort();
  }, [accountLocationsList]);

  /** Child / sub-accounts: only show contacts tied to this account's linked worksites (not all parent-company contacts). */
  const linkedWorksitesForContacts = useMemo(
    () =>
      (Array.isArray(account?.associations?.locations)
        ? (account!.associations!.locations as { companyId: string; locationId: string }[])
        : []) as { companyId: string; locationId: string }[],
    [account?.associations?.locations]
  );

  const filteredAccountContacts = useMemo(() => {
    let list = accountContactsList;
    if (isChildAccount) {
      if (linkedWorksitesForContacts.length === 0) {
        list = [];
      } else {
        list = list.filter((c) =>
          linkedWorksitesForContacts.some((loc: { companyId: string; locationId: string }) => {
            if (c.companyId !== loc.companyId) return false;
            if (c.locationId === loc.locationId) return true;
            const assocLocs = (c as AccountContactRow & { associations?: { locations?: string[] } }).associations?.locations;
            if (Array.isArray(assocLocs) && assocLocs.includes(loc.locationId)) return true;
            return false;
          })
        );
      }
    }
    const q = (contactsSearchQuery || '').trim().toLowerCase();
    if (q) {
      const tokens = q.split(/\s+/).filter(Boolean);
      list = list.filter((c) => {
        const fullName = (c.fullName || `${c.firstName || ''} ${c.lastName || ''}`.trim() || '').toLowerCase();
        const first = (c.firstName || '').toLowerCase();
        const last = (c.lastName || '').toLowerCase();
        const email = (c.email || '').toLowerCase();
        return tokens.every((t) => fullName.includes(t) || first.includes(t) || last.includes(t) || email.includes(t));
      });
    }
    if (contactsWorksiteFilter) {
      list = list.filter((c) => {
        const loc = accountLocationsList.find((l) => l.companyId === c.companyId && l.id === c.locationId);
        const name = loc?.name || loc?.nickname || '';
        return name === contactsWorksiteFilter;
      });
    }
    if (contactsStateFilter) {
      list = list.filter((c) => {
        const loc = accountLocationsList.find((l) => l.companyId === c.companyId && l.id === c.locationId);
        return loc?.state === contactsStateFilter;
      });
    }
    return list;
  }, [
    accountContactsList,
    contactsSearchQuery,
    contactsWorksiteFilter,
    contactsStateFilter,
    accountLocationsList,
    isChildAccount,
    linkedWorksitesForContacts,
  ]);

  const handleSaveAccountContact = useCallback(async () => {
    const companyId =
      isChildAccount && addContactLocationId
        ? addContactLocationId.companyId
        : addContactCompanyId || account?.associations?.companyIds?.[0] || parentCompanyIds[0];
    if (!tenantId || !companyId || !addContactForm.firstName?.trim() || !addContactForm.lastName?.trim()) return;
    const accountLocations = account?.associations?.locations ?? [];
    if (isChildAccount && accountId && accountLocations.length > 0 && !addContactLocationId) {
      setAddContactError('Select a worksite to associate this contact with.');
      return;
    }
    setAddContactSaving(true);
    setAddContactError(null);
    try {
      const emailTrimmed = (addContactForm.email || '').trim();
      if (emailTrimmed) {
        const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
        const q = query(contactsRef, where('email', '==', emailTrimmed));
        const existingSnap = await getDocs(q);
        if (!existingSnap.empty) {
          const existing = existingSnap.docs[0].data();
          const name = existing.fullName || [existing.firstName, existing.lastName].filter(Boolean).join(' ') || 'Another contact';
          setAddContactError(`A contact with this email already exists: ${name}. Use a different email or find them in the list.`);
          setAddContactSaving(false);
          return;
        }
      }
      const companyName = companies.find((c) => c.id === companyId)?.label ?? '';
      const contactData: Record<string, any> = {
        ...addContactForm,
        fullName: `${addContactForm.firstName.trim()} ${addContactForm.lastName.trim()}`,
        tenantId,
        companyId,
        companyName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        salesOwnerId: user?.uid ?? null,
        accountOwnerId: user?.uid ?? null,
      };
      if (addContactLocationId) {
        contactData.locationId = addContactLocationId.locationId;
      }
      const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
      const docRef = await addDoc(contactsRef, contactData);
      if (accountId) {
        await updateAccountAssociations({
          contactIds: [...(account?.associations?.contactIds ?? []), docRef.id],
        });
      }
      setAddContactForm({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        jobTitle: '',
        contactType: 'Unknown',
        linkedInUrl: '',
        tags: [],
        isActive: true,
        notes: '',
      });
      setAddContactLocationId(null);
      setShowAddContactDialog(false);
      fetchAccountContacts(contactTabCompanyIds);
    } catch (err: any) {
      console.error('Add contact error:', err);
      setAddContactError(err?.message || 'Failed to add contact');
    } finally {
      setAddContactSaving(false);
    }
  }, [tenantId, accountId, account?.associations?.companyIds, account?.associations?.contactIds, isChildAccount, addContactCompanyId, addContactLocationId, addContactForm, companies, user?.uid, contactTabCompanyIds, fetchAccountContacts]);

  const paginatedAccountJobPosts = useMemo(() => {
    const start = jobPostsPage * jobPostsRowsPerPage;
    return scopedAccountJobPosts.slice(start, start + jobPostsRowsPerPage);
  }, [scopedAccountJobPosts, jobPostsPage, jobPostsRowsPerPage]);

  const uniqueAccountJobOrderCompanies = useMemo(
    () =>
      Array.from(
        new Set(
          accountJobOrders.map((jo) => jo.companyName).filter((name): name is string => !!name)
        )
      ).sort(),
    [accountJobOrders]
  );

  const filteredAccountJobOrders = useMemo(() => {
    let list = accountJobOrders;
    if (jobOrdersSearch) {
      const q = jobOrdersSearch.toLowerCase();
      list = list.filter(
        (jo) =>
          (jo.jobOrderName && jo.jobOrderName.toLowerCase().includes(q)) ||
          (jo.companyName && jo.companyName.toLowerCase().includes(q)) ||
          (jo.locationName && jo.locationName.toLowerCase().includes(q)) ||
          (jo.jobTitle && jo.jobTitle.toLowerCase().includes(q))
      );
    }
    if (jobOrdersShowFavoritesOnly) {
      list = list.filter((jo) => isJobOrderFavorite(jo.id));
    }
    if (jobOrdersStatusFilter) {
      list = list.filter((jo) => jo.status?.toLowerCase() === jobOrdersStatusFilter.toLowerCase());
    }
    if (jobOrdersCompanyFilter !== 'all') {
      list = list.filter((jo) => jo.companyName === jobOrdersCompanyFilter);
    }
    const dir = jobOrdersSortDirection === 'asc' ? 1 : -1;
    list = [...list].sort((a, b) => {
      if (jobOrdersSortField === 'jobOrderNumber') {
        const aNum = Number((a as any).jobOrderNumber) || 0;
        const bNum = Number((b as any).jobOrderNumber) || 0;
        return dir * (aNum - bNum);
      }
      if (jobOrdersSortField === 'recruiterName') {
        const na = (a.recruiterName || 'Unassigned').toLowerCase();
        const nb = (b.recruiterName || 'Unassigned').toLowerCase();
        return dir * na.localeCompare(nb);
      }
      if (jobOrdersSortField === 'createdAt') {
        const aTime = (a as any).createdAt?.toDate?.()?.getTime?.() ?? (typeof (a as any).createdAt === 'number' ? (a as any).createdAt : 0);
        const bTime = (b as any).createdAt?.toDate?.()?.getTime?.() ?? (typeof (b as any).createdAt === 'number' ? (b as any).createdAt : 0);
        return dir * (aTime - bTime);
      }
      return 0;
    });
    return list;
  }, [
    accountJobOrders,
    jobOrdersSearch,
    jobOrdersShowFavoritesOnly,
    jobOrdersStatusFilter,
    jobOrdersCompanyFilter,
    jobOrdersSortField,
    jobOrdersSortDirection,
    isJobOrderFavorite,
  ]);

  const paginatedAccountJobOrders = useMemo(() => {
    const start = jobOrdersPage * jobOrdersRowsPerPage;
    return filteredAccountJobOrders.slice(start, start + jobOrdersRowsPerPage);
  }, [filteredAccountJobOrders, jobOrdersPage, jobOrdersRowsPerPage]);

  /**
   * Sub-account-grouped view of filtered job orders. Always shows every
   * direct child account (even when it has no orders) so the recruiter can
   * see the full national footprint at a glance. The parent "(National)"
   * group sits at the top and collects:
   *   - Orders whose `recruiterAccountId` equals the parent account's own id
   *   - Orders with a missing or unrecognized `recruiterAccountId`
   *
   * Not paginated — pagination doesn't play well with group headers and
   * National accounts rarely exceed a few hundred orders. If that becomes
   * untrue, revisit here.
   */
  type SubAccountJobOrderGroup = {
    key: string;
    subAccountId: string | null;
    /** Null for the parent "(National)" group; click-through only on real sub accounts. */
    href: string | null;
    label: string;
    /** True when this is the parent account's own group — renders with a slightly different header tone. */
    isParentGroup: boolean;
    orders: JobOrderWithDetails[];
  };
  const groupedAccountJobOrders = useMemo<SubAccountJobOrderGroup[]>(() => {
    if (!account?.id) return [];
    const parentLabel = `${account.name || 'Parent account'} (National)`;
    // Build the index of child accounts we care about, preserving childAccountIds order.
    const childIds = (account.childAccountIds || []).filter(
      (id): id is string => typeof id === 'string' && id.trim() !== '',
    );
    const childLabelById = new Map<string, string>();
    for (const opt of accountOptions) {
      if (opt?.id && opt?.label) childLabelById.set(opt.id, opt.label);
    }
    // Bucket orders into parent vs each child.
    const parentOrders: JobOrderWithDetails[] = [];
    const ordersByChildId = new Map<string, JobOrderWithDetails[]>();
    for (const id of childIds) ordersByChildId.set(id, []);
    for (const jo of filteredAccountJobOrders) {
      const raid = (jo as any).recruiterAccountId;
      const rid = typeof raid === 'string' && raid.trim() !== '' ? raid.trim() : null;
      if (rid && ordersByChildId.has(rid)) {
        ordersByChildId.get(rid)!.push(jo);
      } else {
        parentOrders.push(jo);
      }
    }
    const groups: SubAccountJobOrderGroup[] = [];
    groups.push({
      key: `group-parent-${account.id}`,
      subAccountId: account.id,
      href: `/accounts/${account.id}`,
      label: parentLabel,
      isParentGroup: true,
      orders: parentOrders,
    });
    for (const id of childIds) {
      groups.push({
        key: `group-child-${id}`,
        subAccountId: id,
        href: `/accounts/${id}`,
        label: childLabelById.get(id) || 'Sub account',
        isParentGroup: false,
        orders: ordersByChildId.get(id) || [],
      });
    }
    return groups;
  }, [account?.id, account?.name, account?.childAccountIds, accountOptions, filteredAccountJobOrders]);

  /**
   * Sub-account grouping config for the Active Workers tab. Same shape the
   * Job Orders tab builds inline, but only a thin mapping — the table itself
   * bucket-sorts worker rows by group. Returned undefined for non-National
   * accounts so the component falls back to its original flat layout.
   */
  const activeWorkersSubAccountGrouping = useMemo<ActiveWorkersSubAccountGrouping | undefined>(() => {
    if (!isNationalAccount || !account?.id) return undefined;
    const childIds = (account.childAccountIds || []).filter(
      (id): id is string => typeof id === 'string' && id.trim() !== '',
    );
    const childLabelById = new Map<string, string>();
    for (const opt of accountOptions) {
      if (opt?.id && opt?.label) childLabelById.set(opt.id, opt.label);
    }
    const groups = [
      {
        id: account.id,
        label: `${account.name || 'Parent account'} (National)`,
        isParent: true,
        href: `/accounts/${account.id}`,
      },
      ...childIds.map((id) => ({
        id,
        label: childLabelById.get(id) || 'Sub account',
        isParent: false,
        href: `/accounts/${id}`,
      })),
    ];
    const childIdSet = new Set(childIds);
    const groupIdByJobOrderId: Record<string, string> = {};
    for (const jo of accountJobOrders) {
      const raid = (jo as any).recruiterAccountId;
      const rid = typeof raid === 'string' && raid.trim() !== '' ? raid.trim() : null;
      groupIdByJobOrderId[jo.id] = rid && childIdSet.has(rid) ? rid : account.id;
    }
    return { groups, groupIdByJobOrderId, persistKey: account.id };
  }, [
    isNationalAccount,
    account?.id,
    account?.name,
    account?.childAccountIds,
    accountOptions,
    accountJobOrders,
  ]);

  /**
   * Fan-out fetch of shifts for each Gig JO in the current `accountJobOrders`.
   * Career orders are skipped. Processed in chunks of 10 so we don't slam
   * Firestore for accounts with 50+ orders. Aborts cleanly on unmount /
   * re-run so stale results don't overwrite a newer fetch.
   */
  useEffect(() => {
    if (!tenantId || accountJobOrders.length === 0) {
      setNextShiftByJobOrderId({});
      return;
    }
    const gigJobOrderIds = accountJobOrders
      .filter((jo) => (jo as any).jobType === 'gig')
      .map((jo) => jo.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (gigJobOrderIds.length === 0) {
      setNextShiftByJobOrderId({});
      return;
    }
    let cancelled = false;
    (async () => {
      const result: Record<string, Date> = {};
      const now = new Date();
      const CHUNK = 10;
      for (let i = 0; i < gigJobOrderIds.length; i += CHUNK) {
        if (cancelled) return;
        const chunk = gigJobOrderIds.slice(i, i + CHUNK);
        await Promise.all(
          chunk.map(async (joId) => {
            try {
              const shiftsRef = collection(
                db,
                'tenants',
                tenantId,
                'job_orders',
                joId,
                'shifts',
              );
              const snap = await getDocs(shiftsRef);
              const shifts = snap.docs.map((d) => d.data() as Record<string, any>);
              const next = nextShiftStartForJobOrder(shifts, now);
              if (next) result[joId] = next;
            } catch {
              // Ignore per-JO failures — missing `next shift` just means the
              // row falls back to no caption instead of a stale or wrong value.
            }
          }),
        );
      }
      if (!cancelled) setNextShiftByJobOrderId(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, accountJobOrders]);

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

  const formatJobOrderNumber = (num: number) => String(num).padStart(4, '0');

  const updateAccountAssociations = async (partial: Partial<RecruiterAccountAssociations>) => {
    if (!accountId || !tenantId || !account) return;
    const next = { ...account.associations, ...partial } as RecruiterAccountAssociations;

    // When removing companies: reassign any worksite refs from removed companies to the same-named location under a remaining company (e.g. Legends after acquisition).
    if (partial.companyIds && Array.isArray(partial.companyIds)) {
      const prevCompanyIds = account.associations?.companyIds ?? [];
      const removedCompanyIds = new Set(prevCompanyIds.filter((id) => !partial.companyIds!.includes(id)));
      const remainingCompanyIds = partial.companyIds;
      const currentLocations = (next.locations ?? account.associations?.locations ?? []) as AccountLocationRef[];

      if (removedCompanyIds.size > 0 && currentLocations.length > 0) {
        const reassigned: AccountLocationRef[] = [];
        const seen = new Set<string>();
        for (const loc of currentLocations) {
          if (!removedCompanyIds.has(loc.companyId)) {
            const key = `${loc.companyId}:${loc.locationId}`;
            if (!seen.has(key)) {
              seen.add(key);
              reassigned.push(loc);
            }
            continue;
          }
          const opts = locationsByCompany[loc.companyId] ?? [];
          const opt = opts.find((o) => o.locationId === loc.locationId);
          const name = (opt?.label ?? '').trim().toLowerCase();
          if (!name) continue;
          for (const cid of remainingCompanyIds) {
            const candidateOpts = locationsByCompany[cid] ?? [];
            const match = candidateOpts.find((o) => (o.label ?? '').trim().toLowerCase() === name);
            if (match) {
              const key = `${cid}:${match.locationId}`;
              if (!seen.has(key)) {
                seen.add(key);
                reassigned.push({ companyId: cid, locationId: match.locationId });
              }
              break;
            }
          }
        }
        next.locations = reassigned;
      }
    }

    setSaving(true);
    try {
      const ref = doc(db, p.recruiterAccount(tenantId, accountId));
      await updateDoc(ref, {
        associations: next,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid ?? null,
      });
      setAccount((prev) => (prev ? { ...prev, associations: next } : null));
    } catch (err) {
      console.error('RecruiterAccountDetails: update associations error', err);
    } finally {
      setSaving(false);
    }
  };

  const updateAccountField = async (field: string, value: unknown) => {
    if (!accountId || !tenantId || !account) return;
    setSaving(true);
    try {
      const ref = doc(db, p.recruiterAccount(tenantId, accountId));
      await updateDoc(ref, {
        [field]: value,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid ?? null,
      });
      setAccount((prev) => (prev ? { ...prev, [field]: value, updatedAt: new Date() as any } : null));
      // R.16.2a Phase 3 — top-level snapshot-policy edits surface a
      // Push-to-Active banner. Only `hiringEntityId` is a top-level
      // snapshot-policy field with an edit surface on this page (see
      // `pushBanners` state docstring). Banner appears only for users
      // with `securityLevel === '7'` per Q4 lock; lower-permission
      // users still get the cascade-to-draft semantics from the save
      // itself, they just don't see the push affordance.
      if (canPushToActive && field === 'hiringEntityId') {
        const prevValue = lastSavedHiringEntityIdRef.current;
        const nextValue = (value as string | null | undefined) ?? null;
        if (prevValue !== nextValue) {
          appendPushBanner({
            fieldKey: 'hiringEntityId',
            positionId: null,
            previousValue: prevValue,
            newValue: nextValue,
            fieldLabel: 'Hiring Entity',
          });
          lastSavedHiringEntityIdRef.current = nextValue;
        }
      }
    } catch (err) {
      console.error('RecruiterAccountDetails: update error', err);
    } finally {
      setSaving(false);
    }
  };

  /**
   * R.16.2a Phase 3 — append a banner to the stack, replacing any
   * existing entry with the same `(positionId, fieldKey)` so a
   * second edit on the same field doesn't pile up duplicates.
   * Stacking semantics per Q1 lock (no cap; one banner per dirty
   * pair). Same banners power both top-level `hiringEntityId` and
   * per-position pricing edits.
   */
  const appendPushBanner = useCallback((next: PushToActiveBannerPayload) => {
    setPushBanners((prev) => {
      const filtered = prev.filter(
        (b) =>
          b.fieldKey !== next.fieldKey ||
          (b.positionId ?? null) !== (next.positionId ?? null),
      );
      return [...filtered, next];
    });
  }, []);

  const dismissPushBanner = useCallback((target: PushToActiveBannerPayload) => {
    setPushBanners((prev) =>
      prev.filter(
        (b) =>
          b.fieldKey !== target.fieldKey ||
          (b.positionId ?? null) !== (target.positionId ?? null),
      ),
    );
  }, []);

  /**
   * Silent national→child cascade sync was retired on 2026-05-03.
   *
   * Previously `saveCustomerRules` and `saveBillingDefaults` would auto-fire
   * `syncNationalCascadingDefaultsToChildrenCallable` after each save, which:
   *   1) Wrote to dozens of child docs on every blur/save (expensive, noisy).
   *   2) Made the explicit "Save & sync to child accounts" button look broken
   *      — by the time the user clicked it, the silent sync had already filled
   *      every child, so it always reported "0 of N updated, N unchanged".
   *
   * Now the explicit button (`handleSaveAndSyncToChildAccounts` below) is the
   * single propagation path. Per-section saves only persist to the parent doc.
   */

  /**
   * Section-scoped saves used by the new Docs & Settings layout. Each one
   * touches only its slice of `defaults.*` and merges, so saving Customer
   * Rules can't clobber Billing edits the user hasn't saved yet (and vice
   * versa). The pre-split `saveAccountDefaults` (which wrote rules/eVerify/
   * billing in one shot) was retired with the IA migration — `git log` for
   * the original if a single-shot save is ever needed again.
   */
  const saveCustomerRules = async () => {
    if (!accountId || !tenantId) return;
    setDefaultsSaving(true);
    try {
      const ref = doc(db, p.recruiterAccount(tenantId, accountId));
      // Use dotted paths — not setDoc(merge) on nested `defaults`, which can drop sibling maps
      // when saving billing vs rules in sequence (parent then had incomplete rules for child sync).
      await updateDoc(ref, {
        'defaults.rules': { ...defaultRules },
        'defaults.eVerify': { ...defaultEVerify },
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid ?? null,
      });
      // Cascade to children is no longer auto-fired here. National admins must click
      // "Save & sync to child accounts" at the bottom of the Cascading Data tab to push
      // these values down (see `handleSaveAndSyncToChildAccounts`). See the docblock on
      // the retired `runNationalCascadeSyncQuiet` for the rationale.
    } catch (err) {
      console.error('RecruiterAccountDetails: save customer rules error', err);
    } finally {
      setDefaultsSaving(false);
    }
  };

  const saveBillingDefaults = async () => {
    if (!accountId || !tenantId) return;
    setDefaultsSaving(true);
    try {
      const ref = doc(db, p.recruiterAccount(tenantId, accountId));
      await updateDoc(ref, {
        'defaults.billing': { ...defaultBilling },
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid ?? null,
      });
      // No silent national→child cascade — same rationale as `saveCustomerRules`.
    } catch (err) {
      console.error('RecruiterAccountDetails: save billing defaults error', err);
    } finally {
      setDefaultsSaving(false);
    }
  };

  const savePricingNotes = async (value: string) => {
    if (!accountId || !tenantId || !account) return;
    setPricingNotesSaving(true);
    try {
      const ref = doc(db, p.recruiterAccount(tenantId, accountId));
      const nextPricing = {
        ...account.pricing,
        pricingNotes: value.trim() || null,
      };
      await updateDoc(ref, {
        pricing: nextPricing,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid ?? null,
      });
      setAccount((prev) =>
        prev ? { ...prev, pricing: { ...prev.pricing, pricingNotes: value.trim() || null } } : null
      );
    } catch (err) {
      console.error('RecruiterAccountDetails: save pricing notes error', err);
    } finally {
      setPricingNotesSaving(false);
    }
  };

  /** Pass `blurInputValue` from `onBlur` so the save uses the input DOM value (avoids stale state vs last keystroke). */
  const persistCascadingFlatMarkup = useCallback(
    async (blurInputValue: string) => {
      if (!tenantId || !account?.id) return;
      const trimmed = blurInputValue.trim();
      let nextNum: number | null;
      if (trimmed === '') {
        nextNum = null;
      } else {
        const n = Number(trimmed);
        if (Number.isNaN(n)) return;
        nextNum = n;
      }
      setPricingFlatMarkupPercent(trimmed === '' ? '' : nextNum);

      const prevRaw = account.pricing?.flatMarkupPercent;
      const prevNum = prevRaw != null ? Number(prevRaw) : null;
      if ((prevNum ?? null) === (nextNum ?? null)) return;

      setCascadeMarkupSaving(true);
      try {
        await updateDoc(doc(db, p.recruiterAccount(tenantId, account.id)), {
          'pricing.flatMarkupPercent': nextNum,
          updatedAt: serverTimestamp(),
          updatedBy: user?.uid ?? null,
        });
        setAccount((prev) =>
          prev
            ? {
                ...prev,
                pricing: { ...(prev.pricing ?? {}), flatMarkupPercent: nextNum },
              }
            : null,
        );
      } catch (err) {
        console.error('RecruiterAccountDetails: cascade flat markup save', err);
      } finally {
        setCascadeMarkupSaving(false);
      }
    },
    [tenantId, account?.id, account?.pricing?.flatMarkupPercent, user?.uid],
  );

  const savePricing = async () => {
    if (!accountId || !tenantId) return;
    setPricingSaving(true);
    try {
      const stateCode = (pricingSutaFutaState || normalizeStateCode(worksiteDetails?.state) || '').trim().toUpperCase();
      // Persist workersCompCode and workersCompRate (manual overrides; rate also comes from workers_comp_rates when code matches).
      const positionsToSave = pricingPositions.map(({ id, ...p }) => p);
      const ref = doc(db, p.recruiterAccount(tenantId, accountId));
      await updateDoc(ref, {
        pricing: {
          subAccountsManageOwnPricing: pricingSubAccountsManageOwn,
          flatMarkupPercent: pricingFlatMarkupPercent === '' ? null : Number(pricingFlatMarkupPercent),
          positions: positionsToSave,
          pricingNotes: pricingNotes.trim() || null,
        },
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid ?? null,
      });
      setAccount((prev) =>
        prev
          ? {
              ...prev,
              pricing: {
                subAccountsManageOwnPricing: pricingSubAccountsManageOwn,
                flatMarkupPercent: pricingFlatMarkupPercent === '' ? null : Number(pricingFlatMarkupPercent),
                positions: pricingPositions,
                pricingNotes: pricingNotes.trim() || null,
              },
            }
          : null
      );

      // R.16.2a Phase 3 — per-position diff. For each row, compare the
      // five wrapped snapshot-policy fields against the last-saved
      // baseline; emit one banner per (positionId, fieldKey) pair that
      // changed. Identifier resolution mirrors the load path: prefer
      // the persisted `positionId`, fall back to the synthesised local
      // `id` for legacy rows. After all diffs, replace the baseline
      // wholesale so a re-save doesn't double-fire the same banners.
      if (canPushToActive) {
        type PerPositionField = 'payRate' | 'billRate' | 'markupPercent' | 'workersCompRate' | 'workersCompCode';
        const PER_POSITION_FIELDS: ReadonlyArray<{
          key: PerPositionField;
          fieldKey: PushFieldKey;
          label: string;
        }> = [
          { key: 'payRate', fieldKey: 'payRate', label: 'Pay Rate' },
          { key: 'billRate', fieldKey: 'billRate', label: 'Bill Rate' },
          { key: 'markupPercent', fieldKey: 'markupPercentage', label: 'Markup %' },
          { key: 'workersCompRate', fieldKey: 'workersCompRate', label: "Workers' Comp Rate" },
          { key: 'workersCompCode', fieldKey: 'workersCompCode', label: "Workers' Comp Code" },
        ];
        const baseline = lastSavedPricingPositionsRef.current;
        const nextBaseline = new Map<string, {
          payRate?: number | null;
          billRate?: number | null;
          markupPercent?: number | null;
          workersCompRate?: number | null;
          workersCompCode?: string | null;
        }>();
        for (const row of pricingPositions) {
          const positionId = String((row as any).positionId ?? row.id);
          const prev = baseline.get(positionId) ?? {};
          const next = {
            payRate: (row as any).payRate ?? null,
            billRate: (row as any).billRate ?? null,
            markupPercent: (row as any).markupPercent ?? null,
            workersCompRate: (row as any).workersCompRate ?? null,
            workersCompCode: (row as any).workersCompCode ?? null,
          };
          nextBaseline.set(positionId, next);
          for (const spec of PER_POSITION_FIELDS) {
            const oldValue = (prev as any)[spec.key];
            const newValue = (next as any)[spec.key];
            const changed =
              (oldValue ?? null) !== (newValue ?? null) &&
              !(oldValue == null && newValue == null);
            if (changed) {
              appendPushBanner({
                fieldKey: spec.fieldKey,
                positionId,
                previousValue: oldValue ?? null,
                newValue: newValue ?? null,
                fieldLabel: `${spec.label} — ${(row as any).jobTitle || (row as any).title || positionId}`,
              });
            }
          }
        }
        lastSavedPricingPositionsRef.current = nextBaseline;
      }

      // WC codes and rates are managed only in Workers Comp (sidebar). No writes from here.
    } catch (err) {
      console.error('RecruiterAccountDetails: save pricing error', err);
    } finally {
      setPricingSaving(false);
    }
  };

  const updateParentAccountRelationship = async (nextParentAccountId: string | null) => {
    if (!accountId || !tenantId || !account) return;
    const oldParentAccountId = account.parentAccountId || null;
    if (oldParentAccountId === nextParentAccountId) return;
    if (nextParentAccountId === accountId) return;

    setSaving(true);
    try {
      const accountRef = doc(db, p.recruiterAccount(tenantId, accountId));
      await updateDoc(accountRef, {
        parentAccountId: nextParentAccountId,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid ?? null,
      });

      if (oldParentAccountId) {
        await updateDoc(doc(db, p.recruiterAccount(tenantId, oldParentAccountId)), {
          childAccountIds: arrayRemove(accountId),
          updatedAt: serverTimestamp(),
          updatedBy: user?.uid ?? null,
        });
      }

      if (nextParentAccountId) {
        await updateDoc(doc(db, p.recruiterAccount(tenantId, nextParentAccountId)), {
          childAccountIds: arrayUnion(accountId),
          updatedAt: serverTimestamp(),
          updatedBy: user?.uid ?? null,
        });
      }

      setAccount((prev) => (prev ? { ...prev, parentAccountId: nextParentAccountId } : prev));
      await loadOptions();
    } catch (err) {
      console.error('RecruiterAccountDetails: update parent account error', err);
    } finally {
      setSaving(false);
    }
  };

  const handleAddSubAccount = async (data: RecruiterAccountFormData) => {
    if (!tenantId || !user?.uid || !account?.id) return;
    const ref = collection(db, p.recruiterAccounts(tenantId));
    const docRef = await addDoc(ref, {
      name: data.name.trim(),
      active: data.active,
      parentAccountId: data.parentAccountId || null,
      childAccountIds: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: user.uid,
      updatedBy: user.uid,
    });
    if (data.parentAccountId) {
      await updateDoc(doc(db, p.recruiterAccount(tenantId, data.parentAccountId)), {
        childAccountIds: arrayUnion(docRef.id),
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
    }
    setShowAddSubAccountModal(false);
    await fetchChildAccounts();
  };

  const updateChildAccountRelationships = async (nextChildAccountIds: string[]) => {
    if (!accountId || !tenantId || !account) return;
    const sanitizedNext = Array.from(new Set(nextChildAccountIds.filter((id) => id && id !== accountId)));
    const prevChildAccountIds = Array.isArray(account.childAccountIds) ? account.childAccountIds : [];
    const removed = prevChildAccountIds.filter((id) => !sanitizedNext.includes(id));
    const added = sanitizedNext.filter((id) => !prevChildAccountIds.includes(id));

    setSaving(true);
    try {
      for (const childId of removed) {
        await updateDoc(doc(db, p.recruiterAccount(tenantId, childId)), {
          parentAccountId: null,
          updatedAt: serverTimestamp(),
          updatedBy: user?.uid ?? null,
        });
      }

      for (const childId of added) {
        const childRef = doc(db, p.recruiterAccount(tenantId, childId));
        const childSnap = await getDoc(childRef);
        const existingParentId = childSnap.exists() ? ((childSnap.data() as any)?.parentAccountId || null) : null;

        if (existingParentId && existingParentId !== accountId) {
          await updateDoc(doc(db, p.recruiterAccount(tenantId, existingParentId)), {
            childAccountIds: arrayRemove(childId),
            updatedAt: serverTimestamp(),
            updatedBy: user?.uid ?? null,
          });
        }

        await updateDoc(childRef, {
          parentAccountId: accountId,
          updatedAt: serverTimestamp(),
          updatedBy: user?.uid ?? null,
        });
      }

      await updateDoc(doc(db, p.recruiterAccount(tenantId, accountId)), {
        childAccountIds: sanitizedNext,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid ?? null,
      });

      setAccount((prev) => (prev ? { ...prev, childAccountIds: sanitizedNext } : prev));
      await loadOptions();
    } catch (err) {
      console.error('RecruiterAccountDetails: update child accounts error', err);
    } finally {
      setSaving(false);
    }
  };

  const updateMspAccountIds = async (nextMspAccountIds: string[]) => {
    if (!accountId || !tenantId || !account) return;
    const sanitized = Array.from(new Set(nextMspAccountIds.filter((id) => id && id !== accountId)));
    setSaving(true);
    try {
      await updateDoc(doc(db, p.recruiterAccount(tenantId, accountId)), {
        mspAccountIds: sanitized,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid ?? null,
      });
      setAccount((prev) => (prev ? { ...prev, mspAccountIds: sanitized } : prev));
      await loadOptions();
    } catch (err) {
      console.error('RecruiterAccountDetails: update msp accounts error', err);
    } finally {
      setSaving(false);
    }
  };

  // Labor Pool tab: combined rows (must be before early returns to satisfy rules of hooks)
  // Applicant rows come from both (1) job orders explicitly linked in sidebar jobOrderIds and (2) job orders for this account's companies (same as Job Orders tab)
  const laborPoolTableRows = useMemo(() => {
    const assoc = account?.associations ?? {};
    const uids = assoc.userGroupIds ?? [];
    const sids = assoc.savedSmartGroupIds ?? [];
    const jobOrderIds = assoc.jobOrderIds ?? [];
    const fromExplicit = jobOrderIds
      .map((id) => jobOrders.find((j) => j.id === id))
      .filter(Boolean) as JobOrderOption[];
    const seenIds = new Set<string>();
    const applicantJobOrders: Array<{ id: string; label: string }> = [];
    accountJobOrders.forEach((jo) => {
      if (seenIds.has(jo.id)) return;
      seenIds.add(jo.id);
      const label = (jo as any).jobOrderName || (jo as any).title || (jo as any).jobTitle || jo.id;
      applicantJobOrders.push({ id: jo.id, label });
    });
    fromExplicit.forEach((j) => {
      if (seenIds.has(j.id)) return;
      seenIds.add(j.id);
      applicantJobOrders.push({ id: j.id, label: j.label });
    });
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
    const applicantRows: Array<{ kind: 'jobOrderApplicants'; id: string; label: string; href: string }> = applicantJobOrders.map((j) => ({
      kind: 'jobOrderApplicants' as const,
      id: j.id,
      label: j.label,
      href: `/jobs/job-orders/${j.id}?tab=applications`,
    }));
    return [...groupRows, ...applicantRows];
  }, [account?.associations, laborPoolOptions, jobOrders, accountJobOrders]);

  const schedulerNamesDisplay = useMemo(() => {
    const localIds = Array.isArray(account?.roles?.schedulerIds) ? account.roles.schedulerIds : [];
    const merged =
      isChildAccount && parentNationalSchedulerIds.length > 0
        ? [...new Set([...parentNationalSchedulerIds, ...localIds])]
        : localIds;
    if (merged.length === 0) return '—';
    const labels = merged
      .map((id) => recruitersOptions.find((p) => p.id === id)?.label?.trim())
      .filter((x): x is string => Boolean(x));
    return labels.length > 0 ? labels.join(', ') : '—';
  }, [account?.roles?.schedulerIds, recruitersOptions, isChildAccount, parentNationalSchedulerIds]);

  /** Child + national templates: merged rows for Cascading Data Default Positions (national text fields lock). */
  const cascadeDefaultPositionRows = useMemo(() => {
    const norm = (t: string) => String(t || '').trim().toLowerCase();
    if (!isChildAccount || parentNationalPositions.length === 0) {
      return pricingPositions.map((row, idx) => ({
        row,
        pricingPositionsIndex: idx,
        lockNationalFields: false,
      }));
    }
    const childByTitle = new Map<string, number>();
    pricingPositions.forEach((r, i) => {
      const k = norm(r.jobTitle);
      if (k) childByTitle.set(k, i);
    });
    const nationalKeys = new Set(
      parentNationalPositions.map((p) => norm(p.jobTitle)).filter(Boolean),
    );
    const out: Array<{
      row: AccountPositionPricing;
      pricingPositionsIndex: number | null;
      lockNationalFields: boolean;
    }> = [];

    for (const nat of parentNationalPositions) {
      const k = norm(nat.jobTitle);
      if (!k) continue;
      const ci = childByTitle.get(k);
      const childRow = ci !== undefined ? pricingPositions[ci] : undefined;
      const merged = mergeNationalTemplateWithChildVenueRow(nat, childRow);
      out.push({
        row: {
          ...merged,
          id: merged.id ?? `tpl-${k}`,
        },
        pricingPositionsIndex: ci ?? null,
        lockNationalFields: true,
      });
    }

    pricingPositions.forEach((r, idx) => {
      const k = norm(r.jobTitle);
      if (k && !nationalKeys.has(k)) {
        out.push({ row: r, pricingPositionsIndex: idx, lockNationalFields: false });
      }
    });
    return out;
  }, [isChildAccount, parentNationalPositions, pricingPositions]);

  /** Same merge as Default Positions rows — seeds Compliance overrides with national template + child overrides. */
  const complianceDialogMergedPricingRow = useMemo(() => {
    if (!positionComplianceDialog) return null;
    const norm = (t: string) => String(t || '').trim().toLowerCase();
    const k = norm(positionComplianceDialog.titleKey);
    if (!k) return null;
    if (!isChildAccount || parentNationalPositions.length === 0) return null;
    const nat = parentNationalPositions.find((p) => norm(p.jobTitle) === k);
    if (!nat) return null;
    const ci = positionComplianceDialog.pricingPositionsIndex;
    const childRow =
      ci !== null && ci >= 0 && ci < pricingPositions.length ? pricingPositions[ci] : undefined;
    return mergeNationalTemplateWithChildVenueRow(nat, childRow);
  }, [positionComplianceDialog, isChildAccount, parentNationalPositions, pricingPositions]);

  /** National default gig title picker — options match Positions & Pricing on this account. */
  const defaultGigJobTitleOptionsFromPositions = useMemo(
    () =>
      [...new Set(pricingPositions.map((p) => String(p.jobTitle || '').trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [pricingPositions],
  );

  /** Lowercase title → client JD from Positions & Pricing (fills Default Gig description when a title is chosen). */
  const defaultGigPositionJobDescriptionByTitle = useMemo(() => {
    const out: Record<string, string> = {};
    for (const p of pricingPositions) {
      const t = String(p.jobTitle || '').trim();
      if (!t) continue;
      const jd = p.jobDescriptionFromClient;
      if (jd != null && String(jd).trim() !== '') {
        out[t.toLowerCase()] = String(jd).trim();
      }
    }
    return out;
  }, [pricingPositions]);

  // Top bar shows the static section label "Account Details". The
  // per-account name + favorite star live next to the avatar in the page
  // body (see the title slot of <PageHeader/> below) — same layout the
  // recruiter screens used before the brief experiment with piping the
  // name into the global top bar.
  const topBarTitleNode = useMemo(
    () => (
      <Typography
        sx={{
          fontSize: '20px',
          fontWeight: 600,
          color: 'inherit',
          lineHeight: 1.2,
        }}
      >
        Account Details
      </Typography>
    ),
    [],
  );
  useSetTopBarTitle(topBarTitleNode);

  if (loading && !account) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 320, p: 3 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !account) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="error">{error || 'Account not found'}</Typography>
        <Box sx={{ mt: 2 }}>
          <UniversalBackButton to="/recruiter/accounts" tooltip="Back to Accounts" />
        </Box>
      </Box>
    );
  }

  const displayName = account.name || 'Unnamed Account';
  const initial = displayName.charAt(0).toUpperCase() || 'A';
  const assoc = account.associations ?? {};
  const companyIds = assoc.companyIds ?? [];
  const locationRefs = assoc.locations ?? [];
  const contactIds = assoc.contactIds ?? [];
  const jobOrderIds = assoc.jobOrderIds ?? [];
  const dealIds = assoc.dealIds ?? [];
  const salespersonIds = assoc.salespersonIds ?? [];
  const recruiterIds = assoc.recruiterIds ?? [];

  const associatedCompanies = companyIds
    .map((id) => companies.find((c) => c.id === id))
    .filter(Boolean) as CompanyOption[];
  const associatedLocations = locationRefs.map((loc) => {
    const option = (locationsByCompany[loc.companyId] || []).find((o) => o.locationId === loc.locationId);
    return {
      companyId: loc.companyId,
      locationId: loc.locationId,
      label: option?.label || loc.locationId,
    };
  });
  const associatedContacts = contactIds
    .map((id) => contacts.find((c) => c.id === id))
    .filter(Boolean) as ContactOption[];
  const associatedJobOrders = jobOrderIds
    .map((id) => jobOrders.find((j) => j.id === id))
    .filter(Boolean) as JobOrderOption[];
  const associatedDeals = dealIds
    .map((id) => deals.find((d) => d.id === id))
    .filter(Boolean) as DealOption[];
  const associatedSalespeople = salespersonIds
    .map((id) => salespeopleOptions.find((p) => p.id === id))
    .filter(Boolean) as PersonOption[];
  const associatedRecruiters = recruiterIds
    .map((id) => recruitersOptions.find((p) => p.id === id))
    .filter(Boolean) as PersonOption[];
  const parentAccount =
    account.parentAccountId ? accountOptions.find((a) => a.id === account.parentAccountId) || null : null;
  const childAccounts = (account.childAccountIds || [])
    .map((id) => accountOptions.find((a) => a.id === id))
    .filter(Boolean) as AccountOption[];
  const mspAccounts = (account.mspAccountIds || [])
    .map((id) => accountOptions.find((a) => a.id === id))
    .filter(Boolean) as AccountOption[];
  const showChildrenTab =
    (account?.childAccountIds?.length ?? 0) > 0 || hasAnyAccountWithThisAsParent;
  const billingEntityName = account.hiringEntityId
    ? entityOptions.find((e) => e.id === account.hiringEntityId)?.name
    : null;
  // On Account Details card: E-Verify comes from Entity (source of truth); fallback to parent/account defaults only when no entity
  const displayEVerify = displayEntity ? displayEntity.everifyRequired : (isChildAccount && parentDefaults ? parentDefaults.eVerifyRequired : defaultEVerify.eVerifyRequired);
  const displayHiringEntityId = isChildAccount && parentDefaults != null ? parentDefaults.hiringEntityId : (account.hiringEntityId ?? null);
  const displayHiringEntityName = displayHiringEntityId ? (entityOptions.find((e) => e.id === displayHiringEntityId)?.name ?? '—') : '—';
  /** Child accounts often have no hiringEntityId on the doc; payroll tax columns use the same entity as the header. */
  const showSutaFutaOnPricingPositions = /C1 Workforce|C1 Select/i.test(displayHiringEntityName || '');

  const hasHeaderAssociations =
    associatedCompanies.length > 0 ||
    associatedLocations.length > 0 ||
    associatedContacts.length > 0 ||
    associatedJobOrders.length > 0 ||
    associatedDeals.length > 0 ||
    associatedSalespeople.length > 0 ||
    associatedRecruiters.length > 0 ||
    !!parentAccount ||
    childAccounts.length > 0;

  // Companies: Business icon row in the page header (below Status); other associations below.
  const headerAssociationItems = [
    ...associatedLocations.map((loc) => ({
      key: `location-${loc.companyId}-${loc.locationId}`,
      label: loc.label,
      icon: <LocationOnIcon sx={{ fontSize: 16, color: 'rgba(0,0,0,0.45)' }} />,
      to: `/accounts/${account.id}/locations/${loc.locationId}?companyId=${loc.companyId}`,
    })),
    ...associatedContacts.map((c) => ({
      key: `contact-${c.id}`,
      label: c.label,
      icon: <PersonIcon sx={{ fontSize: 16, color: 'rgba(0,0,0,0.45)' }} />,
      to: `/contacts/${c.id}`,
    })),
    ...associatedJobOrders.map((j) => ({
      key: `joborder-${j.id}`,
      label: j.label,
      icon: <WorkIcon sx={{ fontSize: 16, color: 'rgba(0,0,0,0.45)' }} />,
      to: `/jobs/job-orders/${j.id}`,
    })),
    ...associatedDeals.map((d) => ({
      key: `deal-${d.id}`,
      label: d.label,
      icon: <AttachMoneyIcon sx={{ fontSize: 16, color: 'rgba(0,0,0,0.45)' }} />,
      to: `/crm/deals/${d.id}`,
    })),
    ...associatedSalespeople.map((p) => ({
      key: `salesperson-${p.id}`,
      label: p.label,
      icon: <SellIcon sx={{ fontSize: 16, color: 'rgba(0,0,0,0.45)' }} />,
      to: `/users/${p.id}`,
    })),
    ...associatedRecruiters.map((p) => ({
      key: `recruiter-${p.id}`,
      label: p.label,
      icon: <BadgeIcon sx={{ fontSize: 16, color: 'rgba(0,0,0,0.45)' }} />,
      to: `/users/${p.id}`,
    })),
    ...(parentAccount ? [{
      key: `parent-account-${parentAccount.id}`,
      label: parentAccount.label,
      icon: <BusinessIcon sx={{ fontSize: 16, color: 'rgba(0,0,0,0.45)' }} />,
      to: `/accounts/${parentAccount.id}`,
    }] : []),
    ...childAccounts.map((a) => ({
      key: `child-account-${a.id}`,
      label: a.label,
      icon: <AccountTreeIcon sx={{ fontSize: 16, color: 'rgba(0,0,0,0.45)' }} />,
      to: `/accounts/${a.id}`,
    })),
  ];

  /** Cascading Data → Positions & Pricing — card layout aligned with Job Order gig positions (JobOrderForm). */
  const renderCascadingDefaultPositionsSection = () => {
    /** National accounts: no worksite-state strip or per-row SUTA/FUTA (sub-accounts carry venue-level payroll taxes). */
    const showSutaFutaInCascadingPositions = showSutaFutaOnPricingPositions && !isNationalAccount;

    const worksiteStateCodeForCaption = (
      pricingSutaFutaState ||
      normalizeStateCode(worksiteDetails?.state) ||
      ''
    )
      .trim()
      .toUpperCase();

    const normTitleForPositions = (t: string) => String(t || '').trim().toLowerCase();

    const mergePositionPatch = (
      base: AccountPositionPricing,
      patch: Partial<AccountPositionPricing>,
    ): AccountPositionPricing => {
      const merged = { ...base, ...patch };
      if (patch.payRate !== undefined || patch.markupPercent !== undefined) {
        const pay = Number(merged.payRate) || 0;
        const m = merged.markupPercent;
        if (m != null && !Number.isNaN(Number(m))) {
          merged.billRate = pay * (1 + Number(m) / 100);
        }
      }
      return merged;
    };

    const applyPricingPositionPatch = (
      titleKey: string,
      childIdx: number | null,
      patch: Partial<AccountPositionPricing>,
    ) => {
      const k = normTitleForPositions(titleKey);
      setPricingPositions((prev) => {
        let i = childIdx !== null && childIdx >= 0 && childIdx < prev.length ? childIdx : -1;
        if (i < 0) i = prev.findIndex((r) => normTitleForPositions(r.jobTitle) === k);
        if (i >= 0) {
          const next = [...prev];
          next[i] = mergePositionPatch(next[i], patch);
          return next;
        }
        if (isChildAccount) {
          const nat = parentNationalPositions.find((p) => normTitleForPositions(p.jobTitle) === k);
          if (nat) {
            return [...prev, mergePositionPatch({ ...nat, jobTitle: nat.jobTitle }, patch)];
          }
        }
        const stub: AccountPositionPricing = {
          id: `pos-${Date.now()}`,
          jobTitle: titleKey,
          payRate: 0,
          markupPercent: null,
          billRate: 0,
          workersCompCode: '',
          workersCompRate: null,
          sutaRate: null,
          futaRate: null,
          jobDescriptionFromClient: '',
          uniformRequirements: '',
        };
        return [...prev, mergePositionPatch(stub, patch)];
      });
    };

    const storedPositionRowHasComplianceOverrides = (idx: number | null) => {
      if (idx === null || idx < 0 || idx >= pricingPositions.length) return false;
      const stored = pricingPositions[idx];
      const od = stored.orderDetails;
      if (od && typeof od === 'object') {
        for (const v of Object.values(od)) {
          if (v == null) continue;
          if (Array.isArray(v) && v.length === 0) continue;
          if (typeof v === 'string' && !String(v).trim()) continue;
          return true;
        }
      }
      return !!(stored.screeningPackageId != null && String(stored.screeningPackageId).trim() !== '');
    };

    return (
      <Box sx={{ mt: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            Default Positions
          </Typography>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() =>
              setPricingPositions((prev) => [
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
                  uniformRequirements: '',
                },
              ])
            }
            sx={{ textTransform: 'none' }}
          >
            Add Position
          </Button>
        </Box>
        {isNationalAccount && pricingSubAccountsManageOwn ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            Sub-accounts manage their own pricing on national accounts — defaults here still seed titles and rates where
            used.
          </Typography>
        ) : null}

        {isChildAccount && parentNationalPositions.length > 0 ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            Job titles and descriptions from the national parent update live. Enter venue pay, markup, bill, workers comp,
            and payroll taxes below; save to store overrides on this sub-account.
          </Typography>
        ) : null}

        {showSutaFutaInCascadingPositions ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 2 }}>
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>Worksite state</InputLabel>
              <Select
                value={pricingSutaFutaState || ''}
                onChange={(e) => setPricingSutaFutaState(e.target.value)}
                label="Worksite state"
              >
                <MenuItem value="">
                  <em>Select state</em>
                </MenuItem>
                {US_STATE_CODES.map((code) => (
                  <MenuItem key={code} value={code}>
                    {code}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              size="small"
              variant="outlined"
              onClick={() => {
                const stateCode = pricingSutaFutaState || normalizeStateCode(worksiteDetails?.state);
                if (!stateCode) return;
                const suta = getSutaRateByState(stateCode);
                const futa = getFutaRateByState(stateCode);
                setPricingPositions((prev) => {
                  const applyRates = (row: AccountPositionPricing) => ({
                    ...row,
                    sutaRate: suta ?? row.sutaRate,
                    futaRate: futa,
                  });
                  if (
                    prev.length === 0 &&
                    isChildAccount &&
                    parentNationalPositions.length > 0
                  ) {
                    return parentNationalPositions.map((r) => applyRates({ ...r }));
                  }
                  return prev.map(applyRates);
                });
              }}
              disabled={!pricingSutaFutaState && !normalizeStateCode(worksiteDetails?.state)}
              sx={{
                textTransform: 'none',
                fontSize: '0.75rem',
                py: 0.25,
                px: 1,
                minHeight: 30,
                lineHeight: 1.25,
              }}
            >
              Apply SUTA/FUTA from worksite state
            </Button>
            <Typography variant="caption" color="text.secondary">
              {worksiteStateCodeForCaption
                ? `Estimated new-employer SUTA and FUTA for ${worksiteStateCodeForCaption} (same as Account → Pricing).`
                : 'Select a worksite with a state, or choose Worksite state above, to apply rates.'}
            </Typography>
          </Box>
        ) : null}

        <Stack spacing={2}>
          {cascadeDefaultPositionRows.map(({ row, pricingPositionsIndex, lockNationalFields }, idx) => {
            const markupVal = row.markupPercent;
            const markup = markupVal == null ? null : Number(markupVal);
            const markupNum = typeof markup === 'number' && !Number.isNaN(markup) ? markup : null;
            const pay = Number(row.payRate) || 0;
            const bill = markupNum != null ? pay * (1 + markupNum / 100) : Number(row.billRate) || 0;
            const pricingStateCode = (
              pricingSutaFutaState ||
              normalizeStateCode(worksiteDetails?.state) ||
              ''
            )
              .trim()
              .toUpperCase();

            const nationalFieldsCaption =
              'Defined at national — updates live when the parent account saves.';

            return (
              <Box
                key={row.id ?? `pos-${idx}`}
                sx={{
                  display: 'flex',
                  gap: 2,
                  alignItems: 'flex-start',
                  p: 2,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                }}
              >
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {lockNationalFields ? (
                    <TextField
                      size="small"
                      label="Job Title"
                      value={row.jobTitle}
                      disabled
                      fullWidth
                      helperText={nationalFieldsCaption}
                    />
                  ) : (
                    <Autocomplete
                      freeSolo
                      size="small"
                      options={jobTitlesData as string[]}
                      value={row.jobTitle}
                      onInputChange={(_, v) => {
                        const stateCode = (
                          pricingSutaFutaState ||
                          normalizeStateCode(worksiteDetails?.state) ||
                          ''
                        )
                          .trim()
                          .toUpperCase();
                        const lookup =
                          stateCode && v
                            ? pickWorkersCompJobTitleLookup(
                                wcJobTitleMaps,
                                stateCode,
                                String(v),
                                wcModifierAccountIdForPricing,
                              )
                            : undefined;
                        applyPricingPositionPatch(row.jobTitle, pricingPositionsIndex, {
                          jobTitle: v,
                          ...(lookup
                            ? { workersCompCode: lookup.code, workersCompRate: lookup.rate }
                            : {}),
                        });
                      }}
                      renderInput={(params) => (
                        <TextField {...params} label="Job Title" required placeholder="e.g. Event Worker" />
                      )}
                      fullWidth
                    />
                  )}

                  <TextField
                    label="Job Description"
                    size="small"
                    fullWidth
                    multiline
                    minRows={2}
                    maxRows={8}
                    value={row.jobDescriptionFromClient ?? ''}
                    disabled={lockNationalFields}
                    helperText={lockNationalFields ? nationalFieldsCaption : undefined}
                    onChange={
                      lockNationalFields
                        ? undefined
                        : (e) => {
                            const v = e.target.value;
                            applyPricingPositionPatch(row.jobTitle, pricingPositionsIndex, {
                              jobDescriptionFromClient: v ? v : null,
                            });
                          }
                    }
                    placeholder="Customer job description or notes for postings and AI"
                  />
                  <TextField
                    label="Uniform Requirements"
                    size="small"
                    fullWidth
                    multiline
                    minRows={2}
                    maxRows={8}
                    value={row.uniformRequirements ?? ''}
                    disabled={lockNationalFields}
                    helperText={lockNationalFields ? nationalFieldsCaption : undefined}
                    onChange={
                      lockNationalFields
                        ? undefined
                        : (e) => {
                            const v = e.target.value;
                            applyPricingPositionPatch(row.jobTitle, pricingPositionsIndex, {
                              uniformRequirements: v ? v : null,
                            });
                          }
                    }
                    placeholder="e.g. dress code, PPE, grooming standards"
                  />

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<FactCheckOutlinedIcon />}
                      onClick={() =>
                        setPositionComplianceDialog({
                          titleKey: row.jobTitle,
                          pricingPositionsIndex,
                        })
                      }
                      sx={{ textTransform: 'none' }}
                    >
                      Compliance overrides
                    </Button>
                    {storedPositionRowHasComplianceOverrides(pricingPositionsIndex) ? (
                      <Chip size="small" label="Overrides set" color="primary" variant="outlined" />
                    ) : null}
                  </Box>

                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    <TextField
                      fullWidth
                      size="small"
                      sx={{ flex: '1 1 140px', minWidth: 120, ...numberInputNoSpinnerSx }}
                      label="Pay Rate"
                      type="number"
                      required={!isNationalAccount}
                      value={row.payRate || ''}
                      onChange={(e) => {
                        const v = e.target.value === '' ? 0 : Number(e.target.value);
                        applyPricingPositionPatch(row.jobTitle, pricingPositionsIndex, { payRate: v });
                      }}
                      inputProps={{ min: 0, step: 0.01 }}
                      placeholder="e.g. 15"
                    />
                    <TextField
                      fullWidth
                      size="small"
                      sx={{ flex: '1 1 120px', minWidth: 100, ...numberInputNoSpinnerSx }}
                      label="Markup (%)"
                      type="number"
                      value={row.markupPercent ?? ''}
                      onChange={(e) => {
                        const v = e.target.value === '' ? null : Number(e.target.value);
                        applyPricingPositionPatch(row.jobTitle, pricingPositionsIndex, {
                          markupPercent: v,
                        });
                      }}
                      inputProps={{ min: 0, step: 0.5 }}
                      placeholder="e.g. 25"
                    />
                    <TextField
                      fullWidth
                      size="small"
                      sx={{ flex: '1 1 120px', minWidth: 100, ...numberInputNoSpinnerSx }}
                      label="Bill Rate"
                      type="number"
                      value={markupNum != null ? bill.toFixed(2) : row.billRate ?? ''}
                      disabled={markupNum != null}
                      onChange={(e) => {
                        if (markupNum != null) return;
                        const v = e.target.value === '' ? 0 : Number(e.target.value);
                        applyPricingPositionPatch(row.jobTitle, pricingPositionsIndex, { billRate: v });
                      }}
                      inputProps={{ min: 0, step: 0.01 }}
                      placeholder="e.g. 26.25"
                    />
                  </Box>

                  {!isNationalAccount ? (
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                      <TextField
                        fullWidth
                        size="small"
                        sx={{ flex: '1 1 200px', minWidth: 160 }}
                        label="Workers Comp Class Code"
                        value={row.workersCompCode ?? ''}
                        onChange={(e) => {
                          const v = e.target.value.trim();
                          applyPricingPositionPatch(row.jobTitle, pricingPositionsIndex, {
                            workersCompCode: v || undefined,
                          });
                        }}
                        placeholder="e.g. 9015"
                        helperText="From Settings > Onboarding Library > WC Class Codes"
                      />
                      <TextField
                        fullWidth
                        size="small"
                        sx={{ flex: '1 1 140px', minWidth: 120, ...numberInputNoSpinnerSx }}
                        label="Workers Comp Rate"
                        type="number"
                        value={(() => {
                          const code = (row.workersCompCode ?? '').trim();
                          const fromMaster =
                            pricingStateCode && code ? wcRatesByKey[`${pricingStateCode}_${code}`] : undefined;
                          return fromMaster != null ? fromMaster : (row.workersCompRate ?? '');
                        })()}
                        onChange={(e) => {
                          const v = e.target.value === '' ? null : Number(e.target.value);
                          applyPricingPositionPatch(row.jobTitle, pricingPositionsIndex, {
                            workersCompRate: v != null && !Number.isNaN(v) ? v : undefined,
                          });
                        }}
                        inputProps={{ min: 0, step: 0.01 }}
                        placeholder="e.g. 2.34"
                      />
                    </Box>
                  ) : null}

                  {showSutaFutaInCascadingPositions ? (
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                      <TextField
                        fullWidth
                        size="small"
                        sx={{ flex: '1 1 140px', minWidth: 120, ...numberInputNoSpinnerSx }}
                        label="SUTA %"
                        type="number"
                        value={row.sutaRate ?? ''}
                        onChange={(e) => {
                          const v = e.target.value === '' ? null : Number(e.target.value);
                          applyPricingPositionPatch(row.jobTitle, pricingPositionsIndex, { sutaRate: v });
                        }}
                        inputProps={{ min: 0, step: 0.01 }}
                        placeholder="e.g. 2.7"
                        helperText="State unemployment on pay (C1 Workforce / C1 Select)"
                      />
                      <TextField
                        fullWidth
                        size="small"
                        sx={{ flex: '1 1 140px', minWidth: 120, ...numberInputNoSpinnerSx }}
                        label="FUTA %"
                        type="number"
                        value={row.futaRate ?? ''}
                        onChange={(e) => {
                          const v = e.target.value === '' ? null : Number(e.target.value);
                          applyPricingPositionPatch(row.jobTitle, pricingPositionsIndex, { futaRate: v });
                        }}
                        inputProps={{ min: 0, step: 0.01 }}
                        placeholder="e.g. 0.6"
                        helperText="Federal unemployment on pay"
                      />
                    </Box>
                  ) : null}
                </Box>
                {pricingPositionsIndex !== null || !lockNationalFields ? (
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => {
                      if (pricingPositionsIndex === null) return;
                      setPricingPositions((prev) => prev.filter((_, i) => i !== pricingPositionsIndex));
                    }}
                    aria-label="Remove position"
                    sx={{ mt: 0.5 }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                ) : null}
              </Box>
            );
          })}
        </Stack>

        {cascadeDefaultPositionRows.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            No default positions yet. Add titles and rates — these become the job titles available when creating orders
            for this account.
          </Typography>
        ) : null}

        {positionComplianceDialog ? (
          <PositionComplianceOverridesDialog
            open
            jobTitle={positionComplianceDialog.titleKey}
            account={account}
            inheritanceParentAccount={orderDefaultsInheritanceParent}
            mergedPricingRow={complianceDialogMergedPricingRow}
            sourceRow={
              positionComplianceDialog.pricingPositionsIndex !== null &&
              positionComplianceDialog.pricingPositionsIndex >= 0 &&
              positionComplianceDialog.pricingPositionsIndex < pricingPositions.length
                ? pricingPositions[positionComplianceDialog.pricingPositionsIndex]
                : {
                    jobTitle: positionComplianceDialog.titleKey,
                    payRate: 0,
                    markupPercent: null,
                    billRate: 0,
                    workersCompCode: '',
                    workersCompRate: null,
                    sutaRate: null,
                    futaRate: null,
                    jobDescriptionFromClient: '',
                    uniformRequirements: '',
                  }
            }
            onClose={() => setPositionComplianceDialog(null)}
            onApply={(patch) => {
              applyPricingPositionPatch(
                positionComplianceDialog.titleKey,
                positionComplianceDialog.pricingPositionsIndex,
                patch,
              );
            }}
          />
        ) : null}

        <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center" sx={{ mt: 2 }}>
          <Button
            variant="contained"
            size="small"
            startIcon={pricingSaving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
            onClick={() => void savePricing()}
            disabled={pricingSaving}
            sx={{ textTransform: 'none' }}
          >
            {pricingSaving ? 'Saving…' : 'Save default positions'}
          </Button>
          {/* "Edit in Docs & Settings" button removed 2026-05-03: the Pricing section was retired
              from the Settings tab when it was reduced to File Uploads only. The full pricing
              editor now lives inline on this Cascading Data card. */}
        </Stack>
      </Box>
    );
  };

  /** Shared with Edit Account Details modal and Cascading Data → Account Details card. */
  const renderAccountDetailsCoreFields = (opts?: { autoFocusName?: boolean; hideInlinePushSync?: boolean }) => (
    <>
      <TextField
        label="Account Name"
        defaultValue={account.name}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v !== account.name) updateAccountField('name', v);
        }}
        size="small"
        fullWidth
        autoFocus={opts?.autoFocusName ?? false}
      />
      <FormControl fullWidth size="small">
        <InputLabel>Account type</InputLabel>
        <Select
          label="Account type"
          value={account.accountType ?? 'standalone'}
          onChange={(e) => updateAccountField('accountType', e.target.value || null)}
          disabled={saving}
        >
          <MenuItem value="standalone">Standalone</MenuItem>
          <MenuItem value="national">National account</MenuItem>
          <MenuItem value="child">Child account (of a national)</MenuItem>
        </Select>
      </FormControl>
      {/* E-Verify is set by the Hiring Entity (Settings > Entities) and is read-only here. */}
      {displayEntityLoading ? (
        <Typography variant="body2" color="text.secondary">
          Loading entity…
        </Typography>
      ) : displayEntity ? (
        <FormControlLabel
          control={<Checkbox checked={displayEntity.everifyRequired} disabled />}
          label={
            <Box>
              <Typography variant="body2">E-Verify Required</Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                Set by Hiring Entity (Settings → Entities). Cannot be changed on the account.
                {isChildAccount && account.parentAccountId?.trim()
                  ? ' On child accounts this reflects the national parent’s hiring entity (updates live when the parent saves).'
                  : ''}
              </Typography>
            </Box>
          }
        />
      ) : (
        <Typography variant="body2" color="text.secondary">
          Select a Hiring Entity to see E-Verify setting.
        </Typography>
      )}
      {canPushToActive &&
      tenantId &&
      account &&
      !(isChildAccount && account.parentAccountId?.trim())
        ? pushBanners
            .filter((b) => b.fieldKey === 'hiringEntityId' && (b.positionId ?? null) === null)
            .map((payload) => (
              <PushToActiveBanner
                key={`top-${payload.fieldKey}`}
                tenantId={tenantId}
                accountId={account.id}
                payload={payload}
                onDismiss={() => dismissPushBanner(payload)}
              />
            ))
        : null}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ flex: 1 }}>
          <FormControl fullWidth size="small">
            <InputLabel>Hiring Entity</InputLabel>
            <Select
              label="Hiring Entity"
              value={displayHiringEntityId ?? ''}
              onChange={(e) => updateAccountField('hiringEntityId', e.target.value || null)}
              disabled={saving || (isChildAccount && !!account.parentAccountId?.trim())}
            >
              <MenuItem value="">
                <em>None</em>
              </MenuItem>
              {entityOptions.map((ent) => (
                <MenuItem key={ent.id} value={ent.id}>
                  {ent.name} {ent.entityCode ? `(${ent.entityCode} · ${ent.workerType})` : ''}
                </MenuItem>
              ))}
            </Select>
            {isChildAccount && account.parentAccountId?.trim() ? (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block' }}>
                {parentNationalMarkupLoading
                  ? 'Loading national parent…'
                  : 'Inherited from the national parent account (updates live when the parent saves).'}
              </Typography>
            ) : null}
          </FormControl>
        </Box>
        {!opts?.hideInlinePushSync &&
        canPushToActive &&
        tenantId &&
        account &&
        !(isChildAccount && account.parentAccountId?.trim()) ? (
          <Box sx={{ pt: 0.5 }}>
            <SyncToActiveButton
              tenantId={tenantId}
              accountId={account.id}
              fieldKey="hiringEntityId"
              getCurrentValue={() => account?.hiringEntityId ?? null}
              fieldLabel="Hiring Entity"
            />
          </Box>
        ) : null}
      </Box>
      <FormControlLabel
        control={
          <Switch
            checked={account.active}
            onChange={(e) => updateAccountField('active', e.target.checked)}
            disabled={saving}
          />
        }
        label="Active"
      />
    </>
  );

  const cascadingDataCardSx = {
    boxShadow: 'none',
    transition: 'none',
    '&:hover': { boxShadow: 'none', bgcolor: 'background.paper' },
  };

  /** National-account automation toggles + gig backfill — Cascading Data tab (same fields as edit modal). */
  const renderNationalAutomationsSection = () =>
    account.accountType === 'national' ? (
      <Stack spacing={2.5}>
        <Tooltip title="When enabled, each new location added to this account's connected company will automatically create a child account linked to that location. Future locations only.">
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
              flexWrap: 'wrap',
            }}
          >
            <Box component="span" sx={{ ...recordHeaderBodyTextSx }}>
              Auto-Create Child Accounts:
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
              <Switch
                size="small"
                checked={account.autoCreateChildAccountsForLocations === true}
                disabled={saving}
                onChange={(e) =>
                  updateAccountField('autoCreateChildAccountsForLocations', e.target.checked)
                }
                inputProps={{
                  'aria-label': 'Toggle auto-create child accounts for new company locations',
                }}
              />
              <Box component="span" sx={{ color: 'text.primary', fontWeight: 500, fontSize: '0.875rem' }}>
                {account.autoCreateChildAccountsForLocations === true ? 'On' : 'Off'}
              </Box>
            </Box>
          </Box>
        </Tooltip>
        <Tooltip
          title={
            account.autoCreateChildAccountsForLocations === true
              ? 'When a child account is auto-created under this national, a draft Gig job order is also auto-created. Pay, hiring entity, E-Verify, and screening flow down via cascade — recruiter reviews and activates manually.'
              : 'Enable Auto-Create Child Accounts first — gig job orders only auto-spawn alongside an auto-created child account.'
          }
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
              flexWrap: 'wrap',
            }}
          >
            <Box component="span" sx={{ ...recordHeaderBodyTextSx }}>
              Auto-Create Gig Job Orders:
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
              <Switch
                size="small"
                checked={account.autoCreateGigJobOrders === true}
                disabled={saving || account.autoCreateChildAccountsForLocations !== true}
                onChange={(e) => updateAccountField('autoCreateGigJobOrders', e.target.checked)}
                inputProps={{
                  'aria-label': 'Toggle auto-create gig job orders for new child accounts',
                }}
              />
              <Box component="span" sx={{ color: 'text.primary', fontWeight: 500, fontSize: '0.875rem' }}>
                {account.autoCreateGigJobOrders === true ? 'On' : 'Off'}
              </Box>
            </Box>
          </Box>
        </Tooltip>
        <Tooltip
          title={
            account.autoCreateGigJobOrders === true
              ? 'When a gig job order is auto-created for a child account, also create one user group keyed to (child × default job title). The group is auto-attached to the JO\u2019s auto-message recipients and to the linked posting\u2019s applicant feeder, so applicants drop in and get pinged on new shifts without recruiter setup. Default: on whenever gig job order auto-create is on.'
              : 'Enable Auto-Create Gig Job Orders first \u2014 user groups only auto-spawn alongside an auto-created gig job order.'
          }
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
              flexWrap: 'wrap',
            }}
          >
            <Box component="span" sx={{ ...recordHeaderBodyTextSx }}>
              Auto-Create User Groups:
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
              <Switch
                size="small"
                checked={
                  account.autoCreateGigJobOrders === true &&
                  (account.autoCreateUserGroups === true ||
                    account.autoCreateUserGroups === undefined)
                }
                disabled={saving || account.autoCreateGigJobOrders !== true}
                onChange={(e) => updateAccountField('autoCreateUserGroups', e.target.checked)}
                inputProps={{
                  'aria-label': 'Toggle auto-create user groups for new gig job orders',
                }}
              />
              <Box component="span" sx={{ color: 'text.primary', fontWeight: 500, fontSize: '0.875rem' }}>
                {account.autoCreateGigJobOrders === true &&
                (account.autoCreateUserGroups === true ||
                  account.autoCreateUserGroups === undefined)
                  ? 'On'
                  : 'Off'}
              </Box>
            </Box>
          </Box>
        </Tooltip>
        <Tooltip
          title={
            account.autoCreateGigJobOrders === true
              ? "Scan all existing child accounts and create a draft gig JO for any that don't have one. Idempotent — safe to re-run."
              : 'Enable Auto-Create Gig Job Orders first.'
          }
        >
          <Box>
            <Button
              variant="outlined"
              disabled={
                saving || account.autoCreateGigJobOrders !== true || gigBackfillLoading
              }
              onClick={() => {
                setGigBackfillStep('confirm');
                setGigBackfillSummary(null);
                setGigBackfillError(null);
                setGigBackfillOpen(true);
              }}
              startIcon={gigBackfillLoading ? <CircularProgress size={14} /> : undefined}
              sx={{
                textTransform: 'none',
                borderRadius: 999,
                px: 2,
                py: 0.75,
              }}
            >
              {gigBackfillLoading ? 'Running…' : 'Backfill missing'}
            </Button>
          </Box>
        </Tooltip>
        {account.autoCreateGigJobOrders === true ? (
          <DefaultGigSettings
            title={account.defaultGigJobTitle ?? ''}
            description={account.defaultGigJobDescription ?? ''}
            saving={saving}
            gigJobTitleOptions={defaultGigJobTitleOptionsFromPositions}
            positionJobDescriptionByTitle={defaultGigPositionJobDescriptionByTitle}
            onSaveTitle={(v) => void updateAccountField('defaultGigJobTitle', v || null)}
            onSaveDescription={(v) => void updateAccountField('defaultGigJobDescription', v || null)}
          />
        ) : null}
      </Stack>
    ) : (
      <Typography variant="body2" color="text.secondary">
        Auto-create child accounts and gig job orders are available for national accounts. Set account type to National to
        configure them here.
      </Typography>
    );

  const renderCascadingCustomerRulesSection = () => (
    <Card variant="outlined" elevation={0} sx={cascadingDataCardSx}>
      <CardHeader
        title="Customer Rules & Policies"
        titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
        subheader="Formerly under Docs & Settings. National accounts: use Save & sync to child accounts at the bottom to fill empty rule/policy fields on child venues."
        subheaderTypographyProps={{ variant: 'caption', color: 'text.secondary' }}
      />
      <CardContent sx={{ pt: 0 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={defaultRules.replacingExistingAgency}
                  onChange={(e) =>
                    setDefaultRules({ ...defaultRules, replacingExistingAgency: e.target.checked })
                  }
                />
              }
              label="Replacing Existing Agency"
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={defaultRules.rolloverExistingStaff}
                  onChange={(e) =>
                    setDefaultRules({ ...defaultRules, rolloverExistingStaff: e.target.checked })
                  }
                />
              }
              label="Rollover Existing Staff"
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              size="small"
              label="Timeclock System"
              value={defaultRules.timeclockSystem}
              onChange={(e) => setDefaultRules({ ...defaultRules, timeclockSystem: e.target.value })}
              multiline
              rows={3}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              size="small"
              label="Attendance Policy"
              value={defaultRules.attendancePolicy}
              onChange={(e) => setDefaultRules({ ...defaultRules, attendancePolicy: e.target.value })}
              multiline
              rows={3}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              size="small"
              label="No-Show Policy"
              value={defaultRules.noShowPolicy}
              onChange={(e) => setDefaultRules({ ...defaultRules, noShowPolicy: e.target.value })}
              multiline
              rows={3}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              size="small"
              label="Overtime Policy"
              value={defaultRules.overtimePolicy}
              onChange={(e) => setDefaultRules({ ...defaultRules, overtimePolicy: e.target.value })}
              multiline
              rows={3}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              size="small"
              label="Call-Off Policy"
              value={defaultRules.callOffPolicy}
              onChange={(e) => setDefaultRules({ ...defaultRules, callOffPolicy: e.target.value })}
              multiline
              rows={3}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              size="small"
              label="Injury Handling Policy"
              value={defaultRules.injuryHandlingPolicy}
              onChange={(e) =>
                setDefaultRules({ ...defaultRules, injuryHandlingPolicy: e.target.value })
              }
              multiline
              rows={3}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              size="small"
              label="Discipline Policy"
              value={defaultRules.disciplinePolicy}
              onChange={(e) => setDefaultRules({ ...defaultRules, disciplinePolicy: e.target.value })}
              multiline
              rows={3}
            />
          </Grid>
        </Grid>
        <Box sx={{ mt: 2 }}>
          <Button
            variant="contained"
            startIcon={defaultsSaving ? <CircularProgress size={20} /> : <SaveIcon />}
            onClick={() => void saveCustomerRules()}
            disabled={defaultsSaving}
          >
            {defaultsSaving ? 'Saving…' : 'Save Customer Rules'}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );

  const renderCascadingBillingDefaultsSection = () => (
    <Card variant="outlined" elevation={0} sx={cascadingDataCardSx}>
      <CardHeader
        title="Billing & Invoicing"
        titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
        subheader="Formerly under Docs & Settings. National accounts: use Save & sync to child accounts at the bottom to fill empty billing fields on child venues."
        subheaderTypographyProps={{ variant: 'caption', color: 'text.secondary' }}
      />
      <CardContent sx={{ pt: 0 }}>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={defaultBilling.poRequired}
                  onChange={(e) => setDefaultBilling({ ...defaultBilling, poRequired: e.target.checked })}
                />
              }
              label="PO Required"
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              size="small"
              label="Payment Terms"
              value={defaultBilling.paymentTerms}
              onChange={(e) => setDefaultBilling({ ...defaultBilling, paymentTerms: e.target.value })}
              placeholder="e.g., Net 30"
            />
          </Grid>
          <Grid item xs={12}>
            <FormControl fullWidth size="small">
              <InputLabel>Invoice Delivery Method</InputLabel>
              <Select
                value={defaultBilling.invoiceDeliveryMethod}
                label="Invoice Delivery Method"
                onChange={(e) =>
                  setDefaultBilling({ ...defaultBilling, invoiceDeliveryMethod: e.target.value as string })
                }
              >
                <MenuItem value="">—</MenuItem>
                <MenuItem value="email">Email</MenuItem>
                <MenuItem value="portal">Portal</MenuItem>
                <MenuItem value="mail">Mail</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12}>
            <FormControl fullWidth size="small">
              <InputLabel>Invoice Frequency</InputLabel>
              <Select
                value={defaultBilling.invoiceFrequency}
                label="Invoice Frequency"
                onChange={(e) =>
                  setDefaultBilling({ ...defaultBilling, invoiceFrequency: e.target.value as string })
                }
              >
                <MenuItem value="">—</MenuItem>
                <MenuItem value="weekly">Weekly</MenuItem>
                <MenuItem value="biweekly">Bi-weekly</MenuItem>
                <MenuItem value="monthly">Monthly</MenuItem>
                <MenuItem value="daily_event">Daily/Event-Based</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12}>
            <Autocomplete
              multiple
              size="small"
              options={(() => {
                const companyIds = account?.associations?.companyIds ?? [];
                return companyIds.length === 0 ? [] : contacts.filter((c) => c.companyId && companyIds.includes(c.companyId));
              })()}
              getOptionLabel={(opt) => (typeof opt === 'object' && opt && 'label' in opt ? opt.label : String(opt))}
              value={(defaultBilling.sendInvoicesTo ?? []).map((id) => contacts.find((c) => c.id === id)).filter(Boolean) as ContactOption[]}
              onChange={(_, next) => setDefaultBilling({ ...defaultBilling, sendInvoicesTo: next.map((c) => c.id) })}
              renderInput={(params) => <TextField {...params} label="Send Invoices To:" placeholder="Search contacts…" />}
              isOptionEqualToValue={(opt, val) => opt.id === val.id}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              size="small"
              label="Billing Notes"
              value={defaultBilling.billingNotes}
              onChange={(e) => setDefaultBilling({ ...defaultBilling, billingNotes: e.target.value })}
              placeholder="Optional notes for billing and invoicing"
              multiline
              rows={3}
            />
          </Grid>
        </Grid>
        <Box sx={{ mt: 2 }}>
          <Button
            variant="contained"
            startIcon={defaultsSaving ? <CircularProgress size={20} /> : <SaveIcon />}
            onClick={() => void saveBillingDefaults()}
            disabled={defaultsSaving}
          >
            {defaultsSaving ? 'Saving…' : 'Save Billing & Invoicing'}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );

  const handleSaveAndSyncToChildAccounts = async () => {
    if (!tenantId || !account?.id || account.accountType !== 'national') return;
    setCascadeChildSyncNotice(null);
    setCascadeChildSyncBusy(true);
    try {
      // One updateDoc so rules + billing + eVerify are all on the parent doc before the callable reads it.
      setDefaultsSaving(true);
      try {
        const ref = doc(db, p.recruiterAccount(tenantId, account.id));
        await updateDoc(ref, {
          'defaults.rules': { ...defaultRules },
          'defaults.eVerify': { ...defaultEVerify },
          'defaults.billing': { ...defaultBilling },
          updatedAt: serverTimestamp(),
          updatedBy: user?.uid ?? null,
        });
      } catch (err) {
        console.error('RecruiterAccountDetails: save defaults before cascade sync error', err);
        throw err;
      } finally {
        setDefaultsSaving(false);
      }
      await cascadingOrderDetailsRef.current?.flushSave();
      const fn = httpsCallable(functions, 'syncNationalCascadingDefaultsToChildrenCallable');
      const resp = await fn({ tenantId, nationalAccountId: account.id });
      const data = resp.data as {
        summary?: {
          childAccountsUpdated?: number;
          childAccountsScanned?: number;
          childAccountsSkippedUnchanged?: number;
        };
      };
      const u = data?.summary?.childAccountsUpdated ?? 0;
      const s = data?.summary?.childAccountsScanned ?? 0;
      const sk = data?.summary?.childAccountsSkippedUnchanged ?? 0;
      setCascadeChildSyncNotice({
        kind: 'success',
        text: `Updated ${u} of ${s} child account(s). ${sk} unchanged (already had values).`,
      });
      await loadAccount();
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'message' in e && typeof (e as Error).message === 'string'
          ? (e as Error).message
          : 'Sync failed.';
      setCascadeChildSyncNotice({ kind: 'error', text: msg });
    } finally {
      setCascadeChildSyncBusy(false);
    }
  };

  /** Cascading Data tab — mirrors Docs & Settings → Order Defaults → Staff Instructions (child sync uses one button at tab bottom). */
  const renderCascadingStaffInstructionsSection = () => (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Default staff instructions for this account. They flow to child accounts and locations, then to job orders.
      </Typography>
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <AccountOrderDefaultsCard
            variant="flat"
            title="First Day Instructions"
            fieldKey="firstDay"
            placeholder="Enter first day instructions (e.g., arrival time, what to bring, who to meet, orientation details...)"
            uploadPlaceholder="Upload first day schedules, orientation materials, or related documents"
            account={account}
            accountId={accountId!}
            tenantId={tenantId!}
            userId={user?.uid || ''}
            onRefresh={loadAccount}
          />
        </Grid>
        <Grid item xs={12}>
          <AccountOrderDefaultsCard
            variant="flat"
            title="Parking Instructions"
            fieldKey="parking"
            placeholder="Enter parking instructions for staff (e.g., where to park, parking pass requirements, visitor parking location...)"
            uploadPlaceholder="Upload parking maps, diagrams, or related documents"
            account={account}
            accountId={accountId!}
            tenantId={tenantId!}
            userId={user?.uid || ''}
            onRefresh={loadAccount}
          />
        </Grid>
        <Grid item xs={12}>
          <AccountOrderDefaultsCard
            variant="flat"
            title="Check-In Instructions"
            fieldKey="checkIn"
            placeholder="Enter check-in instructions (e.g., where to report, who to ask for, required documents...)"
            uploadPlaceholder="Upload check-in forms, maps, or related documents"
            account={account}
            accountId={accountId!}
            tenantId={tenantId!}
            userId={user?.uid || ''}
            onRefresh={loadAccount}
          />
        </Grid>
        <Grid item xs={12}>
          <AccountOrderDefaultsCard
            variant="flat"
            title="Uniform Instructions"
            fieldKey="uniform"
            placeholder="Enter uniform and dress code requirements (e.g., specific colors, safety gear, PPE requirements...)"
            uploadPlaceholder="Upload uniform photos, dress code guides, or related documents"
            account={account}
            accountId={accountId!}
            tenantId={tenantId!}
            userId={user?.uid || ''}
            onRefresh={loadAccount}
          />
        </Grid>
        <Grid item xs={12}>
          <AccountOrderDefaultsCard
            variant="flat"
            title="Credential Instructions"
            fieldKey="credentials"
            placeholder="Enter credential requirements (e.g., badge pickup, wristband issuance, ID requirements...)"
            uploadPlaceholder="Upload credential forms, badge photos, or related documents"
            account={account}
            accountId={accountId!}
            tenantId={tenantId!}
            userId={user?.uid || ''}
            onRefresh={loadAccount}
          />
        </Grid>
        <Grid item xs={12}>
          <AccountOrderDefaultsCard
            variant="flat"
            title="Other Instructions"
            fieldKey="other"
            placeholder="Enter any additional instructions or important information for staff..."
            uploadPlaceholder="Upload any other relevant documents"
            account={account}
            accountId={accountId!}
            tenantId={tenantId!}
            userId={user?.uid || ''}
            onRefresh={loadAccount}
          />
        </Grid>
        <Grid item xs={12}>
          <AccountOrderDefaultsCard
            variant="flat"
            title="Other Attachments"
            fieldKey="attachments"
            placeholder=""
            uploadPlaceholder="Upload any other relevant documents for job orders under this account"
            account={account}
            accountId={accountId!}
            tenantId={tenantId!}
            userId={user?.uid || ''}
            onRefresh={loadAccount}
          />
        </Grid>
      </Grid>
    </>
  );

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <PageHeader
        toolbarDividerSpacing={0}
        title={
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2.5 }}>
            <Avatar
              src={isChildAccount && parentAccount ? (parentAccountLogoUrl || undefined) : (accountCompanyLogoUrl || undefined)}
              sx={{
                width: 108,
                height: 108,
                bgcolor: (isChildAccount && parentAccount ? !parentAccountLogoUrl : !accountCompanyLogoUrl) ? 'primary.main' : 'transparent',
                fontSize: '40px',
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {isChildAccount && parentAccount ? (parentAccount.label?.charAt(0)?.toUpperCase() || 'P') : initial}
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              {/* Account Details summary — vertical stack lives flush against
                  the top of the column (next to the avatar). The first
                  line is the account name + favorite star (large heading
                  treatment); the rest is the meta strip (Status, Company,
                  Type, etc.). Contextual action buttons ride in
                  PageHeader's `titleRightActions` slot so they don't
                  introduce whitespace above this line. */}
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.5,
                  minWidth: 0,
                }}
              >
                {/* Account name + favorite star — the visual title of the
                    page now that the global top bar holds the static
                    "Account Details" label. Falls back to a placeholder
                    while the doc is still loading so the layout doesn't
                    jump when the name resolves. */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, mb: 0.25 }}>
                  <Typography
                    component="h1"
                    sx={{
                      fontSize: '24px',
                      fontWeight: 700,
                      lineHeight: 1.2,
                      color: 'text.primary',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: { xs: 220, sm: 360, md: 520 },
                    }}
                  >
                    {account?.name?.trim() || 'Account Details'}
                  </Typography>
                  {account?.id && (
                    <FavoriteButton
                      itemId={account.id}
                      favoriteType="accounts"
                      isFavorite={isFavorite}
                      toggleFavorite={toggleFavorite}
                      size="small"
                      tooltipText={{
                        favorited: 'Remove account from favorites',
                        notFavorited: 'Add account to favorites',
                      }}
                      sx={{
                        p: 0.25,
                        '& .MuiSvgIcon-root': { fontSize: 20 },
                      }}
                    />
                  )}
                </Box>
                {/* Icon row under title — compact shells matching User record header (`recordHeaderActionIconButtonSx`). */}
                {account?.id ? (
                  <Stack
                    direction="row"
                    spacing={0.25}
                    alignItems="center"
                    flexWrap="wrap"
                    sx={{ gap: 0.25, mt: 0.5, mb: 0 }}
                  >
                    {account.accountType === 'child' && parentAccount ? (
                      <RecordHeaderActionIcon
                        tooltip={
                          parentAccount.label ? `View account: ${parentAccount.label}` : 'View parent account'
                        }
                        onClick={() => navigate(`/accounts/${parentAccount.id}`)}
                      >
                        <AccountBalanceIcon />
                      </RecordHeaderActionIcon>
                    ) : null}
                    {associatedCompanies.map((c) => (
                      <RecordHeaderActionIcon
                        key={`hdr-company-${c.id}`}
                        tooltip={c.label ? `View company: ${c.label}` : 'View company'}
                        onClick={() => navigate(`/companies/${c.id}`)}
                      >
                        <BusinessIcon />
                      </RecordHeaderActionIcon>
                    ))}
                    <Tooltip title="Add note" componentsProps={recordHeaderTooltipComponentsProps}>
                      <IconButton
                        size="small"
                        onClick={() => setShowAddNoteDialog(true)}
                        aria-label="Add note"
                        sx={recordHeaderActionIconButtonSx}
                      >
                        <NoteIcon />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                ) : null}
                {/* Status, type, and hiring entity on one wrap row (`recordHeaderBodyTextSx` scale). */}
                <Box
                  sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    columnGap: 2.5,
                    rowGap: 0.75,
                    mt: 0.5,
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Typography component="span" sx={recordHeaderBodyTextSx}>
                      Status:
                    </Typography>
                    <Chip
                      label={account.active ? 'Active' : 'Inactive'}
                      color={account.active ? 'success' : 'default'}
                      size="small"
                      variant={account.active ? 'filled' : 'outlined'}
                      sx={{ fontWeight: 500, height: 18, fontSize: '0.7rem', '& .MuiChip-label': { px: 0.85 } }}
                    />
                  </Box>
                  <Typography component="span" sx={{ ...recordHeaderBodyTextSx, display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
                    Type:{' '}
                    <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>
                      {account.accountType === 'national'
                        ? 'National Account'
                        : account.accountType === 'child'
                          ? 'Child Account'
                          : 'Standalone'}
                    </Box>
                  </Typography>
                  <Typography
                    component="span"
                    sx={{
                      ...recordHeaderBodyTextSx,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 0.25,
                      minWidth: 0,
                      maxWidth: '100%',
                    }}
                  >
                    Hiring Entity:{' '}
                    <Box
                      component="span"
                      sx={{
                        color: 'text.primary',
                        fontWeight: 500,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: { xs: 180, sm: 260, md: 360 },
                      }}
                    >
                      {displayHiringEntityName}
                    </Box>
                  </Typography>
                </Box>
                <Box sx={{ mt: 0.35, width: '100%' }}>
                  <Typography
                    component="span"
                    sx={{
                      ...recordHeaderBodyTextSx,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 0.25,
                      flexWrap: 'wrap',
                    }}
                  >
                    Scheduler:{' '}
                    <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>
                      {schedulerNamesDisplay}
                    </Box>
                  </Typography>
                </Box>
                {isChildAccount ? (
                  <Box sx={{ mt: 0.75, display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0, maxWidth: '100%' }}>
                    {worksiteDetailsLoading ? (
                      <CircularProgress size={14} sx={{ alignSelf: 'flex-start' }} />
                    ) : worksiteDetails &&
                      (worksiteDetails.name ||
                        worksiteDetails.nickname ||
                        worksiteDetails.street ||
                        worksiteDetails.city ||
                        worksiteDetails.address) ? (
                      <>
                        <Typography
                          component="div"
                          sx={{
                            fontSize: '0.74rem',
                            fontWeight: 600,
                            color: 'text.primary',
                            lineHeight: 1.35,
                          }}
                        >
                          {worksiteDetails.name || worksiteDetails.nickname || 'Worksite'}
                        </Typography>
                        {(worksiteDetails.address ||
                          worksiteDetails.street ||
                          worksiteDetails.city ||
                          worksiteDetails.state ||
                          worksiteDetails.zipCode) && (
                          <Typography
                            component="div"
                            sx={{ ...recordHeaderBodyTextSx, lineHeight: 1.35 }}
                          >
                            {[worksiteDetails.address || worksiteDetails.street, worksiteDetails.city, worksiteDetails.state, worksiteDetails.zipCode]
                              .filter(Boolean)
                              .join(', ')}
                          </Typography>
                        )}
                      </>
                    ) : (
                      <Typography sx={recordHeaderBodyTextSx}>No worksite linked</Typography>
                    )}
                  </Box>
                ) : null}
              </Box>
            </Box>
          </Box>
        }
        titleRightActions={
          <>
            {tabValue === 9 && (
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setShowNewJobOrderModal(true)}
                sx={{
                  textTransform: 'none',
                  borderRadius: '24px',
                  height: '40px',
                  px: 2.5,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  fontWeight: 500,
                  fontSize: '14px',
                  bgcolor: '#0057B8',
                  '&:hover': { bgcolor: '#004a9f' },
                }}
              >
                New Order
              </Button>
            )}
            {account.accountType === 'national' && companyIds.length > 0 && (
              <Tooltip title="Sync locations to children — create a child account for each company location under your linked companies. Skips locations that already have a child account.">
                <IconButton
                  onClick={() => {
                    setNationalBackfillStep('confirm');
                    setNationalBackfillError(null);
                    setNationalBackfillSummary(null);
                    setNationalBackfillOpen(true);
                  }}
                  aria-label="Sync locations to children"
                  sx={{
                    width: 32,
                    height: 32,
                    border: '1px solid',
                    borderColor: 'rgba(0, 87, 184, 0.5)',
                    color: '#0057B8',
                    flexShrink: 0,
                    '&:hover': {
                      borderColor: '#0057B8',
                      bgcolor: 'rgba(0, 87, 184, 0.04)',
                    },
                  }}
                >
                  <SyncIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Edit account details">
              <IconButton
                onClick={() => setIsEditingDetails(true)}
                aria-label="Edit account details"
                sx={{
                  width: 32,
                  height: 32,
                  border: '1px solid',
                  borderColor: 'rgba(0, 87, 184, 0.5)',
                  color: '#0057B8',
                  flexShrink: 0,
                  '&:hover': {
                    borderColor: '#0057B8',
                    bgcolor: 'rgba(0, 87, 184, 0.04)',
                  },
                }}
              >
                <EditIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <UniversalBackButton to="/accounts" />
          </>
        }
        filters={
          <Box
            sx={{
              width: '100%',
              minWidth: 0,
              overflowX: 'auto',
              overflowY: 'hidden',
              WebkitOverflowScrolling: 'touch',
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
            <Box sx={{ display: 'flex', gap: 0.35, alignItems: 'center', flexWrap: 'nowrap', minWidth: 'max-content' }}>
              <Button
                variant="text"
                onClick={() => setAccountTab(0)}
                startIcon={<ViewListIcon fontSize="small" />}
                sx={tabPillSx(tabValue === 0)}
              >
                Shifts
              </Button>
              {/* Overview tab retired — legacy `?tab=overview` (and bare
                  account URLs with no `?tab=`) normalize to `?tab=shifts`. */}
              {/* Calendar tab hidden — account calendar lives under Shifts → Calendar view.
              <Button
                variant="text"
                onClick={() => setAccountTab(2)}
                startIcon={<CalendarIcon fontSize="small" />}
                sx={tabPillSx(tabValue === 2)}
              >
                Calendar
              </Button>
              */}
              <Button
                variant="text"
                onClick={() => setAccountTab(9)}
                startIcon={<WorkIcon fontSize="small" />}
                sx={tabPillSx(tabValue === 9)}
              >
                Job Orders
              </Button>
              {!isChildAccount && (
                <Button
                  variant="text"
                  onClick={() => setAccountTab(5)}
                  startIcon={isNationalAccount ? <AccountTreeIcon fontSize="small" /> : <LocationOnIcon fontSize="small" />}
                  sx={tabPillSx(tabValue === 5)}
                >
                  {isNationalAccount ? 'Child Accounts' : 'Locations'}
                </Button>
              )}
              <Button
                variant="text"
                onClick={() => setAccountTab(3)}
                startIcon={<LayersIcon fontSize="small" />}
                sx={tabPillSx(tabValue === 3)}
              >
                Cascading Data
              </Button>
              <Button
                variant="text"
                onClick={() => setAccountTab(4)}
                startIcon={<GroupWorkIcon fontSize="small" />}
                sx={tabPillSx(tabValue === 4)}
              >
                Workforce
              </Button>
              <Button
                variant="text"
                onClick={() => setAccountTab(6)}
                startIcon={<PersonIcon fontSize="small" />}
                sx={tabPillSx(tabValue === 6)}
              >
                Contacts
              </Button>
              {showChildrenTab && !isNationalAccount && (
                <Button
                  variant="text"
                  onClick={() => setAccountTab(7)}
                  startIcon={<AccountTreeIcon fontSize="small" />}
                  sx={tabPillSx(tabValue === 7)}
                >
                  Children
                </Button>
              )}
              {/* Pricing is now a section inside the Docs & Settings tab
                  (Settings → Billing → Pricing). The TabPanel index={8}
                  body is left dormant for safety; legacy `?tab=pricing`
                  URLs are redirected to `?tab=settings&section=pricing`
                  in the URL-normalization effect above. */}
              {/* Jobs Board + Labor Pool tabs hidden per UI cleanup pass —
                  surfaces deemed not yet ready for production. Re-enable by
                  uncommenting both Buttons below.
              <Button
                variant="text"
                onClick={() => setAccountTab(10)}
                startIcon={<BadgeIcon fontSize="small" />}
                sx={tabPillSx(tabValue === 10)}
              >
                Jobs Board
              </Button>
              <Button
                variant="text"
                onClick={() => setAccountTab(11)}
                startIcon={<GroupWorkIcon fontSize="small" />}
                sx={tabPillSx(tabValue === 11)}
              >
                Labor Pool
              </Button>
              */}
              {/* Tab 12 used to be "Docs & Settings" with a left nav (Roles, Pricing, Order
                  Details, Staff Instructions, File Uploads). Those sections were folded into
                  Cascading Data on 2026-05-03; this tab now only hosts the File Uploads card and
                  is hidden on child accounts (uploads on a child are managed at the national,
                  per current product direction). */}
              {!isChildAccount && (
                <Button
                  variant="text"
                  onClick={() => setAccountTab(12)}
                  startIcon={<UploadIcon fontSize="small" />}
                  sx={tabPillSx(tabValue === 12)}
                >
                  File Uploads
                </Button>
              )}
              {canAccessInvoicing && (
                <Button
                  variant="text"
                  onClick={() => setAccountTab(13)}
                  startIcon={<ReceiptIcon fontSize="small" />}
                  sx={tabPillSx(tabValue === 13)}
                >
                  Invoicing
                </Button>
              )}
              {/* Order Defaults is now two sections inside the Docs &
                  Settings tab (Settings → Order Defaults → Order Details
                  / Staff Instructions). TabPanel index={14} is left
                  dormant for safety; legacy `?tab=order-defaults` URLs
                  are redirected to `?tab=settings&section=order-details`. */}
              <Button
                variant="text"
                onClick={() => setAccountTab(15)}
                startIcon={<ReportsIcon fontSize="small" />}
                sx={tabPillSx(tabValue === 15)}
              >
                Reports
              </Button>
              {/* Activity tab hidden per UI cleanup pass — re-enable by
                  uncommenting the Button below.
              <Button
                variant="text"
                onClick={() => setAccountTab(16)}
                startIcon={<DashboardIcon fontSize="small" />}
                sx={tabPillSx(tabValue === 16)}
              >
                Activity
              </Button>
              */}
              <Button
                variant="text"
                onClick={() => setAccountTab(17)}
                startIcon={<NotesIcon fontSize="small" />}
                sx={tabPillSx(tabValue === 17)}
              >
                Notes {notesCount > 0 ? `(${notesCount})` : ''}
              </Button>
            </Box>
          </Box>
        }
        rightActions={
          tabValue === 5 ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'nowrap', minWidth: 0 }}>
              <Box sx={{ minWidth: 0, flex: '1 1 200px', maxWidth: 420 }}>
                <InboxSearchBar
                  value={isNationalAccount ? childrenSearchQuery : locationsSearchQuery}
                  onChange={isNationalAccount ? setChildrenSearchQuery : setLocationsSearchQuery}
                  onSearch={isNationalAccount ? setChildrenSearchQuery : setLocationsSearchQuery}
                  placeholder={isNationalAccount ? 'Search child accounts…' : 'Search by name, code, city, or state...'}
                />
              </Box>
              {isNationalAccount ? (
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={() => setShowAddSubAccountModal(true)}
                  sx={{ flexShrink: 0, textTransform: 'none' }}
                >
                  Add Sub Account
                </Button>
              ) : null}
              {!isNationalAccount &&
              (isChildAccount ? parentCompanyIds.length : (account?.associations?.companyIds?.length ?? 0)) ? (
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={openAddLocationDialogForAccount}
                  sx={{ flexShrink: 0 }}
                >
                  Add Location
                </Button>
              ) : null}
            </Box>
          ) : tabValue === 9 ? (
            <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="nowrap" sx={{ minWidth: 0 }}>
              <FavoritesFilter
                favoriteType="jobOrders"
                showFavoritesOnly={jobOrdersShowFavoritesOnly}
                onToggle={setJobOrdersShowFavoritesOnly}
                showText={false}
                size="small"
                sx={{ flexShrink: 0, minWidth: 36, width: 36, height: 36, borderRadius: '50%' }}
              />
              <Box sx={{ minWidth: 0, flex: '1 1 200px', maxWidth: 420 }}>
                <InboxSearchBar
                  value={jobOrdersSearch}
                  onChange={setJobOrdersSearch}
                  onSearch={setJobOrdersSearch}
                  placeholder="Search job orders..."
                />
              </Box>
            </Stack>
          ) : undefined
        }
      />

      {/* Add Location Dialog (same as Company – Locations tab; adds to selected company) */}
      <Dialog
        open={showAddLocationDialog}
        onClose={() => {
          setShowAddLocationDialog(false);
          setAddLocationForm({
            name: '',
            code: '',
            address: '',
            city: '',
            state: '',
            zipCode: '',
            country: 'USA',
            type: 'Office',
            division: '',
            phone: '',
            coordinates: null,
          });
          setAddLocationError(null);
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Typography variant="h6">Add New Location</Typography>
            <IconButton
              onClick={() => {
                setShowAddLocationDialog(false);
                setAddLocationForm({
                  name: '',
                  code: '',
                  address: '',
                  city: '',
                  state: '',
                  zipCode: '',
                  country: 'USA',
                  type: 'Office',
                  division: '',
                  phone: '',
                  coordinates: null,
                });
                setAddLocationError(null);
              }}
            >
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              {isChildAccount
                ? 'Add a new location for a company linked to the parent account. The location is stored on that company (same as Company → Locations). Use the address field to automatically populate city, state, and ZIP.'
                : 'Add a new location for a company linked to this account. The location is created on the company (same as adding from the Company – Locations tab). Use the address field to automatically populate city, state, and ZIP.'}
            </Typography>
            {showAddLocationCompanySelect && addLocationTargetCompanyIds.length > 0 && (
              <FormControl fullWidth sx={{ mb: 2 }}>
                <InputLabel>Company</InputLabel>
                <Select
                  value={addLocationCompanyId}
                  label="Company"
                  onChange={(e) => setAddLocationCompanyId(e.target.value)}
                >
                  {addLocationTargetCompanyIds.map((cid: string) => (
                    <MenuItem key={cid} value={cid}>
                      {companies.find((c) => c.id === cid)?.label ?? cid}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            {addLocationError && (
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setAddLocationError(null)}>
                {addLocationError}
              </Alert>
            )}
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Location Name"
                  value={addLocationForm.name}
                  onChange={(e) => setAddLocationForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Headquarters, Manufacturing Plant"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Location Code"
                  value={addLocationForm.code}
                  onChange={(e) => setAddLocationForm((prev) => ({ ...prev, code: e.target.value }))}
                  placeholder="Internal code (e.g., HQ-01)"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <Autocomplete
                  fullWidth
                  freeSolo
                  options={LOCATION_FACILITY_TYPE_OPTIONS}
                  value={addLocationForm.type || ''}
                  onChange={(_, newValue) => setAddLocationForm((prev) => ({ ...prev, type: newValue || '' }))}
                  renderInput={(params) => <TextField {...params} label="Type" />}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Division (Optional)"
                  value={addLocationForm.division}
                  onChange={(e) => setAddLocationForm((prev) => ({ ...prev, division: e.target.value }))}
                  placeholder="Division name"
                />
              </Grid>
              <Grid item xs={12}>
                <GoogleAutocomplete
                  onLoad={(ref: any) => {
                    addLocationAutocompleteRef.current = ref;
                  }}
                  onPlaceChanged={() => {
                    const place = addLocationAutocompleteRef.current?.getPlace();
                    if (place?.geometry?.location) {
                      const lat = place.geometry.location.lat();
                      const lng = place.geometry.location.lng();
                      const addressComponents = place.address_components || [];
                      let streetNumber = '';
                      let route = '';
                      let city = '';
                      let state = '';
                      let zipCode = '';
                      let country = 'USA';
                      addressComponents.forEach((component: any) => {
                        const types = component.types;
                        if (types.includes('street_number')) streetNumber = component.long_name;
                        else if (types.includes('route')) route = component.long_name;
                        else if (types.includes('locality')) city = component.long_name;
                        else if (types.includes('administrative_area_level_1')) state = component.short_name;
                        else if (types.includes('postal_code')) zipCode = component.long_name;
                        else if (types.includes('country')) country = component.short_name;
                      });
                      const fullAddress = streetNumber && route ? `${streetNumber} ${route}` : place.formatted_address || '';
                      setAddLocationForm((prev) => ({
                        ...prev,
                        address: fullAddress,
                        city,
                        state,
                        zipCode,
                        country,
                        coordinates: { lat, lng },
                      }));
                    }
                  }}
                >
                  <TextField
                    fullWidth
                    label="Address"
                    value={addLocationForm.address}
                    onChange={(e) => setAddLocationForm((prev) => ({ ...prev, address: e.target.value }))}
                    placeholder="Start typing an address..."
                    InputProps={{
                      endAdornment: addLocationForm.coordinates && (
                        <Box sx={{ display: 'flex', alignItems: 'center', mr: 1 }}>
                          <Chip size="small" label="📍 GPS" color="success" variant="outlined" />
                        </Box>
                      ),
                    }}
                  />
                </GoogleAutocomplete>
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="City"
                  value={addLocationForm.city}
                  onChange={(e) => setAddLocationForm((prev) => ({ ...prev, city: e.target.value }))}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="State"
                  value={addLocationForm.state}
                  onChange={(e) => setAddLocationForm((prev) => ({ ...prev, state: e.target.value }))}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  label="ZIP Code"
                  value={addLocationForm.zipCode}
                  onChange={(e) => setAddLocationForm((prev) => ({ ...prev, zipCode: e.target.value }))}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Phone"
                  value={addLocationForm.phone}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^\d]/g, '').slice(0, 10);
                    const pretty =
                      raw.length >= 10 ? `(${raw.slice(0, 3)}) ${raw.slice(3, 6)}-${raw.slice(6, 10)}` : raw;
                    setAddLocationForm((prev) => ({ ...prev, phone: pretty }));
                  }}
                  placeholder="(555) 123-4567"
                />
              </Grid>
              {addLocationForm.coordinates && (
                <Grid item xs={12}>
                  <Box
                    sx={{
                      p: 2,
                      bgcolor: 'success.light',
                      borderRadius: 1,
                      border: '1px solid',
                      borderColor: 'success.main',
                    }}
                  >
                    <Typography variant="subtitle2" color="success.dark" gutterBottom>
                      📍 GPS Coordinates Captured
                    </Typography>
                    <Typography variant="body2" color="success.dark">
                      Latitude: {addLocationForm.coordinates.lat.toFixed(6)} | Longitude:{' '}
                      {addLocationForm.coordinates.lng.toFixed(6)}
                    </Typography>
                  </Box>
                </Grid>
              )}
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 0 }}>
          <Button
            onClick={() => {
              setShowAddLocationDialog(false);
              setAddLocationForm({
                name: '',
                code: '',
                address: '',
                city: '',
                state: '',
                zipCode: '',
                country: 'USA',
                type: 'Office',
                division: '',
                phone: '',
                coordinates: null,
              });
              setAddLocationError(null);
            }}
            variant="outlined"
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            color="primary"
            startIcon={addLocationSubmitting ? <CircularProgress size={16} /> : <AddIcon />}
            onClick={handleAddLocationAccount}
            disabled={!addLocationForm.name || !addLocationForm.address || addLocationSubmitting}
            size="large"
          >
            {addLocationSubmitting ? 'Adding…' : 'Add Location'}
          </Button>
        </DialogActions>
      </Dialog>

      <AddAccountModal
        open={showAddSubAccountModal}
        onClose={() => setShowAddSubAccountModal(false)}
        onSubmit={handleAddSubAccount}
        accountOptions={[
          ...(account ? [{ id: account.id, label: account.name || 'Unnamed Account' }] : []),
          ...accountOptions.filter((a) => a.id !== account?.id && a.id !== account?.parentAccountId && !(account?.childAccountIds || []).includes(a.id)),
        ]}
        defaultParentAccountId={account?.id ?? null}
      />

      {/* Edit Account Details modal — opened by the Edit pencil in the
          page header. Mirrors the form that used to live in the inline
          Account Details card on the Overview tab. Field changes still
          autosave via `updateAccountField`, matching the rest of the app;
          "Done" just closes the modal. */}
      <Dialog
        open={isEditingDetails}
        onClose={() => setIsEditingDetails(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Edit Account Details</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {renderAccountDetailsCoreFields({ autoFocusName: true })}
            {account.accountType === 'national' ? (
              <Box>
                <FormControlLabel
                  control={
                    <Switch
                      checked={account.autoCreateChildAccountsForLocations === true}
                      onChange={(e) =>
                        updateAccountField('autoCreateChildAccountsForLocations', e.target.checked)
                      }
                      disabled={saving}
                    />
                  }
                  label="Auto-create child accounts for new company locations"
                />
                <Typography variant="caption" color="text.secondary" display="block" sx={{ pl: 4.5, maxWidth: 520 }}>
                  When enabled, each new location added to this account's connected company will automatically create a
                  child account linked to that location. Future locations only.
                </Typography>
              </Box>
            ) : null}
            {account.accountType === 'national' ? (
              <Box>
                <FormControlLabel
                  control={
                    <Switch
                      checked={account.autoCreateGigJobOrders === true}
                      onChange={(e) =>
                        updateAccountField('autoCreateGigJobOrders', e.target.checked)
                      }
                      disabled={
                        saving || account.autoCreateChildAccountsForLocations !== true
                      }
                    />
                  }
                  label="Auto-create gig job orders for new child accounts"
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  display="block"
                  sx={{ pl: 4.5, maxWidth: 520 }}
                >
                  When a child account is auto-created under this national, also create a
                  draft Gig job order for it. Hiring entity, E-Verify, screening package,
                  and pay defaults flow down via cascade — recruiters review and activate
                  the draft manually. Requires the toggle above to be enabled.
                </Typography>
              </Box>
            ) : null}
            {account.accountType === 'national' ? (
              <Box>
                <FormControlLabel
                  control={
                    <Switch
                      // AG.0 — tri-state field, render as `on` when explicitly true OR
                      // when undefined while gig JO auto-create is on (read-time default).
                      checked={
                        account.autoCreateGigJobOrders === true &&
                        (account.autoCreateUserGroups === true ||
                          account.autoCreateUserGroups === undefined)
                      }
                      onChange={(e) =>
                        updateAccountField('autoCreateUserGroups', e.target.checked)
                      }
                      disabled={saving || account.autoCreateGigJobOrders !== true}
                    />
                  }
                  label="Auto-create user groups for new gig job orders"
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  display="block"
                  sx={{ pl: 4.5, maxWidth: 520 }}
                >
                  Creates one user group per (child account × default job title) when a gig
                  job order is auto-created. Auto-attached to the JO&apos;s auto-message
                  recipients and to the linked posting&apos;s applicant feeder so applicants
                  drop in and members get pinged on new shifts without recruiter setup.
                  Default: on whenever the toggle above is enabled.
                </Typography>
              </Box>
            ) : null}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsEditingDetails(false)} disabled={saving}>
            Done
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={nationalBackfillOpen}
        onClose={() => {
          if (nationalBackfillLoading) return;
          setNationalBackfillOpen(false);
          setNationalBackfillStep('confirm');
          setNationalBackfillError(null);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Locations → child accounts</DialogTitle>
        <DialogContent>
          {nationalBackfillStep === 'confirm' ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Typography variant="body2" color="text.secondary">
                This creates one child account per company location for all CRM companies linked to this national account.
                Locations that already have a matching child account are skipped (same rules as automatic creation).
              </Typography>
              {nationalBackfillError ? (
                <Alert severity="error" onClose={() => setNationalBackfillError(null)}>
                  {nationalBackfillError}
                </Alert>
              ) : null}
            </Box>
          ) : nationalBackfillSummary ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="body2">
                Processed {nationalBackfillSummary.locationsProcessed} location(s).
              </Typography>
              <Typography variant="body2">
                Created {nationalBackfillSummary.created} new child account(s).
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Skipped {nationalBackfillSummary.skipped_duplicate + nationalBackfillSummary.skipped_idempotent} (already
                present or idempotent).
              </Typography>
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          {nationalBackfillStep === 'confirm' ? (
            <>
              <Button
                onClick={() => {
                  setNationalBackfillOpen(false);
                  setNationalBackfillError(null);
                }}
                disabled={nationalBackfillLoading}
              >
                Cancel
              </Button>
              <Button
                variant="contained"
                onClick={() => void runNationalBackfillChildAccounts()}
                disabled={nationalBackfillLoading}
                startIcon={nationalBackfillLoading ? <CircularProgress size={16} /> : undefined}
              >
                {nationalBackfillLoading ? 'Running…' : 'Run'}
              </Button>
            </>
          ) : (
            <Button
              variant="contained"
              onClick={() => {
                setNationalBackfillOpen(false);
                setNationalBackfillStep('confirm');
                setNationalBackfillSummary(null);
              }}
            >
              Done
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/**
       * §14b — Backfill missing gig job orders dialog.
       *
       * Confirm step describes the impact + idempotency. Result step
       * shows the per-bucket counts (created / already had / skipped
       * with errors). Audit detail is logged to console — too noisy
       * to inline.
       */}
      <Dialog
        open={gigBackfillOpen}
        onClose={() => {
          if (gigBackfillLoading) return;
          setGigBackfillOpen(false);
          setGigBackfillStep('confirm');
          setGigBackfillError(null);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Backfill missing gig job orders</DialogTitle>
        <DialogContent>
          {gigBackfillStep === 'confirm' ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Typography variant="body2" color="text.secondary">
                Scan all child accounts under{' '}
                <Box component="span" sx={{ fontWeight: 500 }}>
                  {account?.name || 'this national account'}
                </Box>{' '}
                and create a draft gig job order for any that don&apos;t
                have one.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                This is one-time — future child accounts will get gig
                job orders automatically. Each new JO is created as{' '}
                <Box component="span" sx={{ fontWeight: 500 }}>
                  on hold
                </Box>{' '}
                and managed daily by the auto-status job.
              </Typography>
              {gigBackfillError ? (
                <Alert
                  severity="error"
                  onClose={() => setGigBackfillError(null)}
                >
                  {gigBackfillError}
                </Alert>
              ) : null}
            </Box>
          ) : gigBackfillSummary ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="body2">
                Scanned {gigBackfillSummary.totalChildAccounts} child
                account(s).
              </Typography>
              <Typography variant="body2">
                Created {gigBackfillSummary.created} new gig job order(s).
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {gigBackfillSummary.alreadyHad} already had a gig job order.
              </Typography>
              {gigBackfillSummary.skipped > 0 ? (
                <Typography variant="body2" color="warning.main">
                  {gigBackfillSummary.skipped} skipped due to errors —
                  see browser console for the per-row audit log.
                </Typography>
              ) : null}
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          {gigBackfillStep === 'confirm' ? (
            <>
              <Button
                onClick={() => {
                  setGigBackfillOpen(false);
                  setGigBackfillError(null);
                }}
                disabled={gigBackfillLoading}
              >
                Cancel
              </Button>
              <Button
                variant="contained"
                onClick={() => void runGigJobOrdersBackfill()}
                disabled={gigBackfillLoading}
                startIcon={
                  gigBackfillLoading ? (
                    <CircularProgress size={16} />
                  ) : undefined
                }
              >
                {gigBackfillLoading ? 'Running…' : 'Run'}
              </Button>
            </>
          ) : (
            <Button
              variant="contained"
              onClick={() => {
                setGigBackfillOpen(false);
                setGigBackfillStep('confirm');
                setGigBackfillSummary(null);
              }}
            >
              Done
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <AddJobOrderModal
        open={showNewJobOrderModal}
        onClose={() => setShowNewJobOrderModal(false)}
        onSaved={fetchAccountJobOrders}
        tenantId={tenantId ?? ''}
        userId={user?.uid ?? ''}
        defaultHiringEntityId={account?.hiringEntityId ?? null}
        accountCompanies={
          (isChildAccount ? parentCompanyIds : account?.associations?.companyIds ?? []).length
            ? (isChildAccount ? companies.filter((c) => parentCompanyIds.includes(c.id)) : associatedCompanies).map((c) => ({
                id: c.id,
                label: c.label ?? c.companyName ?? c.id,
                companyName: c.companyName ?? c.label ?? c.id,
                name: c.label ?? c.id,
              }))
            : undefined
        }
        defaultCompanyId={
          (isChildAccount ? parentCompanyIds : account?.associations?.companyIds ?? [])?.length === 1
            ? (isChildAccount ? parentCompanyIds[0] : account!.associations!.companyIds![0])
            : null
        }
        recruiterAccountId={accountId ?? null}
        requireAccountSelection
      />

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          pt: tabValue === 0 ? 0 : 2,
          pb: 2,
        }}
      >
        <TabPanel value={tabValue} index={0} contentSx={{ px: 0 }}>
          <Box sx={{ flex: 1, minHeight: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <AccountShiftsTab tenantId={tenantId} account={account} accountLoading={loading} />
          </Box>
        </TabPanel>
        <TabPanel value={tabValue} index={1}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={9}>
              {/* Account Details card removed — the read-only summary lives
                  in the page header (next to the avatar) and editing now
                  happens in the modal opened by the Edit pencil up there.
                  See the `<Dialog open={isEditingDetails}>` block near the
                  bottom of this component. */}

              {/* Worksite Location card - when account has a worksite linked */}
              {worksiteDetailsLoading ? (
                <Card sx={{ mt: 3 }}>
                  <CardContent sx={{ py: 3 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                      <CircularProgress size={24} />
                    </Box>
                  </CardContent>
                </Card>
              ) : worksiteDetails ? (
                <Card sx={{ mt: 3 }}>
                  <CardHeader
                    title="Worksite Location"
                    titleTypographyProps={{ variant: 'h6', fontWeight: 600 }}
                  />
                  <CardContent sx={{ pt: 0, p: 2 }}>
                    <Typography variant="subtitle2" fontWeight={600} color="text.primary" sx={{ mb: 2, fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Location Information
                    </Typography>
                    <Grid container spacing={2}>
                      {(worksiteDetails.name || worksiteDetails.nickname) && (
                        <Grid item xs={12}>
                          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                            <LocationOnIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                Location Name
                              </Typography>
                              <Typography variant="body1" sx={{ mt: 0.25, fontWeight: 500 }}>
                                {worksiteDetails.name || worksiteDetails.nickname}
                              </Typography>
                            </Box>
                          </Box>
                        </Grid>
                      )}
                      {(worksiteDetails.address || worksiteDetails.street || worksiteDetails.city || worksiteDetails.state || worksiteDetails.zipCode) && (
                        <Grid item xs={12}>
                          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                            <LocationOnIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                Address
                              </Typography>
                              <Typography variant="body2" sx={{ mt: 0.25 }}>
                                {[worksiteDetails.address || worksiteDetails.street, worksiteDetails.city, worksiteDetails.state, worksiteDetails.zipCode]
                                  .filter(Boolean)
                                  .join(', ') || '—'}
                              </Typography>
                            </Box>
                          </Box>
                        </Grid>
                      )}
                      {worksiteDetails.type && (
                        <Grid item xs={12} sm={6}>
                          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                            <WorkIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                                Type
                              </Typography>
                              <Typography variant="body1" sx={{ mt: 0.25 }}>
                                {worksiteDetails.type}
                              </Typography>
                            </Box>
                          </Box>
                        </Grid>
                      )}
                    </Grid>
                  </CardContent>
                </Card>
              ) : null}

              {/* File uploads moved to Docs & Settings → Documents → File
                  Uploads. Same component, same Firestore path; just relocated
                  for IA cleanup. */}
            </Grid>
            {/* Sidebar: adding back widgets 1–2 at a time to find nav bug. Currently: Recent Activity + Company. */}
            <Grid item xs={12} md={3}>
              <AccountSidebar
                account={account}
                tenantId={tenantId!}
                navigate={navigate}
                updateAccountAssociations={updateAccountAssociations}
                companies={companies}
                locationsByCompany={locationsByCompany}
                contacts={contacts}
                jobOrders={jobOrders}
                deals={deals}
                laborPoolOptions={laborPoolOptions}
                salespeopleOptions={salespeopleOptions}
                recruitersOptions={recruitersOptions}
                accountOptions={accountOptions.filter((a) => a.id !== account.id && a.id !== account.parentAccountId && !(account.childAccountIds || []).includes(a.id))}
                parentAccount={parentAccount}
                childAccounts={childAccounts}
                mspAccounts={mspAccounts}
                onParentAccountChange={updateParentAccountRelationship}
                onChildAccountsChange={updateChildAccountRelationships}
                onMspAccountsChange={updateMspAccountIds}
                optionsLoading={optionsLoading}
                saving={saving}
                visibleSections={
                  (isChildAccount
                    ? ['activity', 'relatedAccounts', 'location', 'contacts']
                    : ['activity', 'company', 'relatedAccounts', 'location', 'contacts']
                ) as AccountSidebarProps['visibleSections']}
                parentCompanyIds={isChildAccount ? parentCompanyIds : undefined}
                addNewLocationEnabled={
                  (isChildAccount ? parentCompanyIds.length : (account?.associations?.companyIds?.length ?? 0)) > 0
                }
                onAddNewLocation={openAddLocationDialogForAccount}
              />
            </Grid>
          </Grid>
        </TabPanel>
        <TabPanel value={tabValue} index={2}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={9}>
              <AccountCalendarTab tenantId={tenantId!} account={account} scopedJobOrderIds={isChildAccount ? accountJobOrders.map((j) => j.id) : undefined} />
            </Grid>
            <Grid item xs={12} md={3}>
              <AccountSidebar
                account={account}
                tenantId={tenantId!}
                navigate={navigate}
                updateAccountAssociations={updateAccountAssociations}
                companies={companies}
                locationsByCompany={locationsByCompany}
                contacts={contacts}
                jobOrders={jobOrders}
                deals={deals}
                laborPoolOptions={laborPoolOptions}
                salespeopleOptions={salespeopleOptions}
                recruitersOptions={recruitersOptions}
                accountOptions={accountOptions.filter((a) => a.id !== account.id && a.id !== account.parentAccountId && !(account.childAccountIds || []).includes(a.id))}
                parentAccount={parentAccount}
                childAccounts={childAccounts}
                mspAccounts={mspAccounts}
                onParentAccountChange={updateParentAccountRelationship}
                onChildAccountsChange={updateChildAccountRelationships}
                onMspAccountsChange={updateMspAccountIds}
                optionsLoading={optionsLoading}
                saving={saving}
                visibleSections={[]}
              />
            </Grid>
          </Grid>
        </TabPanel>
        <TabPanel value={tabValue} index={3}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
              <Box sx={{ flexGrow: 1 }}>
                <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
                  Cascading Data
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Fields and values that cascade from this account to child accounts and job orders can be managed here.
                </Typography>
              </Box>
              {/* Manual refresh: re-reads this account doc. Useful on a child account after the
                  parent national runs Save & sync to child accounts in another tab — the page
                  now also auto-refreshes via an onSnapshot listener, but the button gives an
                  explicit affordance and surfaces a busy state. */}
              <Tooltip title="Refresh cascaded values from Firestore">
                <span>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={loading ? <CircularProgress size={16} /> : <RefreshIcon />}
                    onClick={() => void loadAccount()}
                    disabled={loading}
                  >
                    {loading ? 'Refreshing…' : 'Refresh'}
                  </Button>
                </span>
              </Tooltip>
            </Box>
            <Card variant="outlined" elevation={0} sx={cascadingDataCardSx}>
              <CardHeader
                title="Account Details"
                titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
              />
              <CardContent sx={{ pt: 0 }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {renderAccountDetailsCoreFields({ hideInlinePushSync: true })}
                </Box>
              </CardContent>
            </Card>
            {isChildAccount ? (
              <Card variant="outlined" elevation={0} sx={cascadingDataCardSx}>
                <CardHeader
                  title="Worksite"
                  titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
                />
                <CardContent sx={{ pt: 0 }}>
                  <Autocomplete
                    options={childWorksiteSelectOptions}
                    getOptionLabel={(o) => o.label}
                    value={(() => {
                      const loc = account.associations?.locations?.[0];
                      if (!loc) return null;
                      return (
                        childWorksiteSelectOptions.find(
                          (o) => o.companyId === loc.companyId && o.locationId === loc.locationId,
                        ) ?? null
                      );
                    })()}
                    onChange={(_, v) => {
                      void updateAccountAssociations({
                        locations: v ? [{ companyId: v.companyId, locationId: v.locationId }] : [],
                      });
                    }}
                    isOptionEqualToValue={(a, b) =>
                      a.companyId === b.companyId && a.locationId === b.locationId
                    }
                    disabled={optionsLoading || saving}
                    fullWidth
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Connected worksite"
                        placeholder="Search locations…"
                        size="small"
                      />
                    )}
                  />
                  {childWorksiteSelectOptions.length === 0 && !optionsLoading ? (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                      Locations come from companies linked on the parent national account. Ensure the parent has CRM
                      companies with locations.
                    </Typography>
                  ) : null}
                </CardContent>
              </Card>
            ) : (
              <Card variant="outlined" elevation={0} sx={cascadingDataCardSx}>
                <CardHeader
                  title="Automations"
                  titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
                />
                <CardContent sx={{ pt: 0 }}>{renderNationalAutomationsSection()}</CardContent>
              </Card>
            )}
            <Card variant="outlined" elevation={0} sx={cascadingDataCardSx}>
              <CardHeader
                title="Compliance Defaults"
                titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
                subheader="Same fields as Docs & Settings → Order Details. Use Save & sync to child accounts at the bottom of this tab to copy saved defaults into child venues (empty fields only)."
                subheaderTypographyProps={{ variant: 'caption', color: 'text.secondary' }}
              />
              <CardContent sx={{ pt: 0 }}>
                <AccountOrderDetailsForm
                  ref={cascadingOrderDetailsRef}
                  account={account}
                  accountId={accountId!}
                  tenantId={tenantId!}
                  userId={user?.uid || ''}
                  contacts={contacts}
                  inheritanceParentAccount={orderDefaultsInheritanceParent}
                  embedded
                  sections="compliance"
                  hideComplianceHeading
                  introMode="none"
                  omitComplianceRows={['backgroundCheckPackages']}
                  syncLayout="footer"
                />
              </CardContent>
            </Card>
            <Card variant="outlined" elevation={0} sx={cascadingDataCardSx}>
              <CardHeader
                title="Positions & Pricing"
                titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
              />
              <CardContent sx={{ pt: 0 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Set default markup (above) and default positions (below). Values cascade to job orders. Pricing notes
                  and advanced options remain under Docs & Settings → Pricing.
                </Typography>
                {!isChildAccount ? (
                  <TextField
                    label="National Default Markup"
                    type="number"
                    size="small"
                    value={pricingFlatMarkupPercent === '' ? '' : pricingFlatMarkupPercent}
                    onChange={(e) =>
                      setPricingFlatMarkupPercent(e.target.value === '' ? '' : Number(e.target.value))
                    }
                    onBlur={(e) => void persistCascadingFlatMarkup(e.currentTarget.value)}
                    disabled={cascadeMarkupSaving}
                    inputProps={{ min: 0, step: 0.5 }}
                    sx={{ maxWidth: 280, mb: 2, ...numberInputNoSpinnerSx }}
                    InputProps={{
                      endAdornment: <InputAdornment position="end">%</InputAdornment>,
                    }}
                    helperText="Applies as the account-wide default; flows to children and orders per your pricing rules."
                  />
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 2, maxWidth: 360 }}>
                    <TextField
                      label="National Default Markup"
                      type="number"
                      size="small"
                      value={
                        parentNationalMarkupLoading
                          ? ''
                          : parentNationalFlatMarkupPercent === null
                            ? ''
                            : parentNationalFlatMarkupPercent
                      }
                      disabled
                      InputProps={{
                        endAdornment: <InputAdornment position="end">%</InputAdornment>,
                      }}
                      sx={numberInputNoSpinnerSx}
                      helperText={
                        parentNationalMarkupLoading
                          ? 'Loading parent account…'
                          : 'From the parent national account (read-only here).'
                      }
                    />
                    <TextField
                      label="Local Default Markup"
                      type="number"
                      size="small"
                      value={pricingFlatMarkupPercent === '' ? '' : pricingFlatMarkupPercent}
                      onChange={(e) =>
                        setPricingFlatMarkupPercent(e.target.value === '' ? '' : Number(e.target.value))
                      }
                      onBlur={(e) => void persistCascadingFlatMarkup(e.currentTarget.value)}
                      disabled={cascadeMarkupSaving}
                      inputProps={{ min: 0, step: 0.5 }}
                      sx={numberInputNoSpinnerSx}
                      InputProps={{
                        endAdornment: <InputAdornment position="end">%</InputAdornment>,
                      }}
                      helperText="Stored on this sub-account; used when resolving pricing for this venue."
                    />
                  </Box>
                )}
                {renderCascadingDefaultPositionsSection()}
              </CardContent>
            </Card>
            {isChildAccount && account.parentAccountId?.trim() ? (
              <Card variant="outlined" elevation={0} sx={cascadingDataCardSx}>
                <CardHeader
                  title="Default Gig job seed"
                  titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
                  subheader="National defaults for auto-spawned gig job orders (updates live when the parent saves)."
                  subheaderTypographyProps={{ variant: 'caption', color: 'text.secondary' }}
                />
                <CardContent sx={{ pt: 0 }}>
                  {parentNationalMarkupLoading ? (
                    <Box sx={{ py: 1 }}>
                      <CircularProgress size={22} />
                    </Box>
                  ) : (
                    <Stack spacing={1.5}>
                      <TextField
                        label="Default Gig Job Title"
                        size="small"
                        fullWidth
                        value={orderDefaultsInheritanceParent?.defaultGigJobTitle ?? ''}
                        disabled
                      />
                      <TextField
                        label="Default Gig Job Description"
                        size="small"
                        fullWidth
                        multiline
                        minRows={2}
                        maxRows={8}
                        value={orderDefaultsInheritanceParent?.defaultGigJobDescription ?? ''}
                        disabled
                      />
                      {!orderDefaultsInheritanceParent ? (
                        <Typography variant="caption" color="warning.main">
                          Parent national account could not be loaded.
                        </Typography>
                      ) : null}
                    </Stack>
                  )}
                </CardContent>
              </Card>
            ) : null}
            <AccountRecruitingRolesCard
              tenantId={tenantId ?? null}
              accountId={account.id}
              initialSchedulerIds={account?.roles?.schedulerIds ?? []}
              parentSchedulerIds={isChildAccount ? parentNationalSchedulerIds : undefined}
              recruiterOptions={recruitersOptions}
              autoSave
              title="Scheduler"
              cardSx={cascadingDataCardSx}
              onSaved={(nextSchedulerIds) => {
                setAccount((prev) =>
                  prev
                    ? {
                        ...prev,
                        roles: { ...(prev.roles ?? {}), schedulerIds: nextSchedulerIds },
                      }
                    : prev,
                );
              }}
            />
            <Card variant="outlined" elevation={0} sx={cascadingDataCardSx}>
              <CardHeader
                title="Staff Instructions"
                titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
                subheader="Same content as Docs & Settings → Order Defaults → Staff Instructions. Saved values cascade to children, locations, and job orders."
                subheaderTypographyProps={{ variant: 'caption', color: 'text.secondary' }}
              />
              <CardContent sx={{ pt: 0 }}>{renderCascadingStaffInstructionsSection()}</CardContent>
            </Card>
            {renderCascadingBillingDefaultsSection()}
            {renderCascadingCustomerRulesSection()}
            {isNationalAccount && canSyncCascadeDefaultsToChildren && tenantId && account?.id ? (
              <Card variant="outlined" elevation={0} sx={cascadingDataCardSx}>
                <CardHeader
                  title="Save & sync to child accounts"
                  titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
                  subheader="Copies saved values from this national account into each child venue. Only empty fields on a child are filled — existing child data is never overwritten."
                  subheaderTypographyProps={{ variant: 'caption', color: 'text.secondary' }}
                />
                <CardContent sx={{ pt: 0 }}>
                  {cascadeChildSyncNotice ? (
                    <Alert
                      severity={cascadeChildSyncNotice.kind === 'success' ? 'success' : 'error'}
                      sx={{ mb: 2 }}
                      onClose={() => setCascadeChildSyncNotice(null)}
                    >
                      {cascadeChildSyncNotice.text}
                    </Alert>
                  ) : null}
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Saves Customer Rules & Policies, Billing & Invoicing, and Compliance Defaults (above), then fills
                    empty fields on child accounts from Firestore — hiring entity, rules/policies, billing defaults,
                    screening and compliance defaults, staff instructions (including attachments), and default gig
                    title/description. Click out of fields so edits auto-save, or save each section first.
                  </Typography>
                  <Button
                    variant="contained"
                    color="primary"
                    startIcon={
                      cascadeChildSyncBusy ? <CircularProgress size={18} color="inherit" /> : <SyncIcon />
                    }
                    disabled={cascadeChildSyncBusy}
                    onClick={() => void handleSaveAndSyncToChildAccounts()}
                  >
                    {cascadeChildSyncBusy ? 'Saving & syncing…' : 'Save & sync to child accounts'}
                  </Button>
                </CardContent>
              </Card>
            ) : null}
          </Box>
        </TabPanel>
        <TabPanel value={tabValue} index={4}>
          {/* Workforce tab — rebuilt as three sub-tabs (Scheduled / Active /
              Inactive) per docs/WORKFORCE_DOMAIN_MODEL.md Phase 3. The
              legacy ActiveWorkersTable is still used on location-scoped
              pages; this account-scoped page gets the new component. */}
          <AccountWorkforceTab
            tenantId={tenantId}
            account={
              account
                ? {
                    id: account.id,
                    name: account.name,
                    accountType: account.accountType,
                    childAccountIds: account.childAccountIds,
                  }
                : null
            }
            jobOrderIds={accountJobOrders.map((j) => j.id)}
            subAccountGrouping={
              activeWorkersSubAccountGrouping as WorkforceSubAccountGrouping | undefined
            }
          />
        </TabPanel>
        <TabPanel value={tabValue} index={5}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minHeight: 0 }}>
            {isNationalAccount ? (
              <>
                {childAccountsLoading && childAccountsList.length === 0 ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                    <CircularProgress size={32} />
                  </Box>
                ) : filteredChildAccounts.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No sub accounts to show.
                  </Typography>
                ) : (
                  <TableContainer
                    component={Paper}
                    sx={{
                      flex: 1,
                      minHeight: 0,
                      border: '1px solid #EAEEF4',
                      borderRadius: 0,
                      boxShadow: 'none',
                      '&::-webkit-scrollbar': { width: '8px', height: '8px' },
                      '&::-webkit-scrollbar-track': { background: 'rgba(0,0,0,0.02)', borderRadius: '4px' },
                      '&::-webkit-scrollbar-thumb': { background: 'rgba(0,0,0,0.15)', borderRadius: '4px' },
                      scrollbarWidth: 'thin',
                      scrollbarColor: 'rgba(0,0,0,0.15) rgba(0,0,0,0.02)',
                    }}
                  >
                    <Table size="small" stickyHeader sx={{ width: '100%' }}>
                      <TableHead sx={{ backgroundColor: '#FFFFFF' }}>
                        <TableRow sx={{ backgroundColor: '#FFFFFF' }}>
                          <TableCell align="center" sx={{ width: 60, minWidth: 60, maxWidth: 60, position: 'sticky', top: 0, zIndex: 12, bgcolor: '#FFFFFF', fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', py: 1.75, px: 1, borderBottom: '1px solid', borderColor: 'divider' }} />
                          <TableCell sx={{ position: 'sticky', top: 0, zIndex: 12, bgcolor: '#FFFFFF', fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', py: 1.75, pl: 2, borderBottom: '1px solid', borderColor: 'divider' }}>ACCOUNT NAME</TableCell>
                          <TableCell sx={{ position: 'sticky', top: 0, zIndex: 12, bgcolor: '#FFFFFF', fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', py: 1.75, borderBottom: '1px solid', borderColor: 'divider' }}>STATUS</TableCell>
                          <TableCell sx={{ position: 'sticky', top: 0, zIndex: 12, bgcolor: '#FFFFFF', fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', py: 1.75, borderBottom: '1px solid', borderColor: 'divider' }}>ACCOUNT TYPE</TableCell>
                          <TableCell sx={{ position: 'sticky', top: 0, zIndex: 12, bgcolor: '#FFFFFF', fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', py: 1.75, borderBottom: '1px solid', borderColor: 'divider' }}>E-VERIFY</TableCell>
                          <TableCell sx={{ position: 'sticky', top: 0, zIndex: 12, bgcolor: '#FFFFFF', fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', py: 1.75, borderBottom: '1px solid', borderColor: 'divider' }}>HIRING ENTITY</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {filteredChildAccounts.map((child, index) => (
                          <TableRow
                            key={child.id}
                            hover
                            onClick={() => child.id && navigate(`/accounts/${child.id}`)}
                            sx={{ cursor: child.id ? 'pointer' : 'default', backgroundColor: index % 2 === 0 ? 'background.paper' : '#FAFAFA', '&:hover': { backgroundColor: 'action.hover' } }}
                          >
                            <TableCell align="center" sx={{ width: 60, minWidth: 60, maxWidth: 60, py: 1.5, px: 1, borderBottom: '1px solid', borderColor: 'divider' }} onClick={(e) => e.stopPropagation()}>
                              <FavoriteButton itemId={child.id} favoriteType="accounts" isFavorite={isFavorite} toggleFavorite={toggleFavorite} size="small" sx={{ p: 0.25, color: isFavorite(child.id) ? '#0B63C5' : '#6B7280', '&:hover': { color: '#0B63C5', backgroundColor: 'rgba(11, 99, 197, 0.08)' } }} />
                            </TableCell>
                            <TableCell sx={{ py: 1.5, pl: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <AccountTreeIcon sx={{ fontSize: 20, color: 'text.secondary' }} />
                                <Typography variant="body2" sx={{ fontWeight: 500 }}>{child.name || '—'}</Typography>
                              </Box>
                            </TableCell>
                            <TableCell sx={{ py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                              <Chip label={child.active ? 'Active' : 'Inactive'} size="small" color={child.active ? 'success' : 'default'} variant="outlined" sx={{ fontWeight: 500 }} />
                            </TableCell>
                            <TableCell sx={{ py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                              <Typography variant="body2" color="text.secondary">
                                {child.accountType === 'national' ? 'National account' : child.accountType === 'child' ? 'Child account' : child.accountType ?? '—'}
                              </Typography>
                            </TableCell>
                            <TableCell sx={{ py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                              <Typography variant="body2" color="text.secondary">
                                {(entityOptions.find((e) => e.id === (child.hiringEntityId ?? account?.hiringEntityId))?.everifyRequired ?? child.eVerifyRequired) ? 'Yes' : 'No'}
                              </Typography>
                            </TableCell>
                            <TableCell sx={{ py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                              <Typography variant="body2" color="text.secondary">{entityOptions.find((e) => e.id === (child.hiringEntityId ?? account?.hiringEntityId))?.name ?? '—'}</Typography>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </>
            ) : isChildAccount ? (
              <>
                <Typography variant="body2" color="text.secondary">
                  Child accounts show only worksites linked to this account. Company locations are managed on the national account.
                </Typography>
                {associatedLocations.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No worksites linked. Use the Worksite / Location widget in the sidebar to link locations for this venue.
                  </Typography>
                ) : (
                  <TableContainer component={Paper} sx={{ border: '1px solid #E5E7EB', borderRadius: 1, maxWidth: 720 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ backgroundColor: '#F9FAFB' }}>
                          <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', py: 1.5 }}>Worksite</TableCell>
                          <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', py: 1.5 }}>Company</TableCell>
                          <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', py: 1.5 }} align="right">Action</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {associatedLocations.map((loc) => (
                          <TableRow
                            key={`${loc.companyId}-${loc.locationId}`}
                            sx={{ '&:hover': { backgroundColor: '#F9FAFB' } }}
                          >
                            <TableCell sx={{ py: 1.25 }}>
                              <Typography sx={{ fontWeight: 500, fontSize: '0.9375rem' }}>{loc.label}</Typography>
                            </TableCell>
                            <TableCell sx={{ py: 1.25 }}>
                              <Typography sx={{ fontSize: '0.875rem', color: '#6B7280' }}>
                                {companies.find((c) => c.id === loc.companyId)?.label ?? '—'}
                              </Typography>
                            </TableCell>
                            <TableCell sx={{ py: 1.25 }} align="right">
                              <Button
                                size="small"
                                component={Link}
to={`/accounts/${account.id}/locations/${loc.locationId}?companyId=${loc.companyId}`}
                                sx={{ textTransform: 'none', fontSize: '0.875rem' }}
                              >
                                View
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </>
            ) : (
              <>
            {accountLocationsLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress size={32} />
              </Box>
            ) : !account?.associations?.companyIds?.length ? (
              <Typography variant="body2" color="text.secondary">
                Link at least one company to this account to see locations.
              </Typography>
            ) : filteredAccountLocations.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No locations found.
              </Typography>
            ) : (
              <TableContainer component={Paper} sx={{ border: '1px solid #E5E7EB', borderRadius: 1 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow sx={{ backgroundColor: '#F9FAFB' }}>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E5E7EB', py: 1.5 }}>
                        Company
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E5E7EB', py: 1.5 }}>
                        Location Name
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E5E7EB', py: 1.5 }}>
                        Code
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E5E7EB', py: 1.5 }}>
                        Address
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E5E7EB', py: 1.5 }}>
                        Type
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E5E7EB', py: 1.5 }}>
                        Division
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E5E7EB', py: 1.5 }}>
                        Contacts
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E5E7EB', py: 1.5 }}>
                        Deals
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E5E7EB', py: 1.5 }}>
                        Status
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredAccountLocations.map((location) => (
                      <TableRow
                        key={`${location.companyId}-${location.id}`}
                        onClick={() => navigate(`/accounts/${account.id}/locations/${location.id}?companyId=${location.companyId}`)}
                        sx={{
                          cursor: 'pointer',
                          '&:hover': { backgroundColor: '#F9FAFB' },
                        }}
                      >
                        <TableCell sx={{ py: 1, px: 2 }}>
                          <Typography sx={{ fontSize: '0.875rem', color: '#374151', fontWeight: 500 }}>
                            {location.companyName}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ py: 1, px: 2 }}>
                          <Typography sx={{ fontWeight: 600, color: '#111827', fontSize: '0.9375rem' }}>
                            {location.name || location.nickname || 'Unnamed Location'}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ py: 1 }}>
                          {location.code ? (
                            <Typography sx={{ fontSize: '0.875rem', color: '#374151', fontWeight: 500, fontFamily: 'monospace' }}>
                              {location.code}
                            </Typography>
                          ) : (
                            <Typography sx={{ fontSize: '0.875rem', color: '#9CA3AF' }}>-</Typography>
                          )}
                        </TableCell>
                        <TableCell sx={{ py: 1 }}>
                          <Typography sx={{ fontSize: '0.875rem', color: '#111827' }}>
                            {location.address || location.street || '-'}
                          </Typography>
                          {(location.city || location.state || location.zipCode) && (
                            <Typography sx={{ fontSize: '0.875rem', color: '#6B7280' }}>
                              {[location.city, location.state, location.zipCode].filter(Boolean).join(', ')}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell sx={{ py: 1 }}>
                          <Chip label={location.type || 'Unknown'} size="small" color="primary" sx={{ fontSize: '0.75rem', fontWeight: 500 }} />
                        </TableCell>
                        <TableCell sx={{ py: 1 }}>
                          {location.division ? (
                            <Chip label={location.division} size="small" color="secondary" variant="outlined" sx={{ fontSize: '0.75rem', fontWeight: 500 }} />
                          ) : (
                            <Typography sx={{ fontSize: '0.875rem', color: '#9CA3AF' }}>-</Typography>
                          )}
                        </TableCell>
                        <TableCell sx={{ py: 1 }}>
                          <Typography sx={{ fontSize: '0.875rem', color: '#374151', fontWeight: 500 }}>
                            {location.contactCount ?? 0}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ py: 1 }}>
                          <Typography sx={{ fontSize: '0.875rem', color: '#374151', fontWeight: 500 }}>
                            {location.dealCount ?? 0}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ py: 1 }}>
                          <Chip
                            label={location.active !== false ? 'Active' : 'Inactive'}
                            size="small"
                            color={location.active !== false ? 'success' : 'default'}
                            variant="filled"
                            sx={{
                              fontWeight: 500,
                              ...(location.active === false ? { bgcolor: '#DC2626', color: 'white', '& .MuiChip-label': { color: 'white' } } : {}),
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
              </>
            )}
          </Box>
        </TabPanel>
        <TabPanel value={tabValue} index={6}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minHeight: 0 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
              <Typography variant="h6" fontWeight={700}>
                Contacts
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                {!isChildAccount && (
                  <>
                    <FormControl size="small" sx={{ minWidth: 150, height: 36 }}>
                      <Select
                        value={contactsWorksiteFilter}
                        onChange={(e) => setContactsWorksiteFilter(e.target.value)}
                        displayEmpty
                        sx={{ height: 36, fontSize: '0.875rem', backgroundColor: 'white', borderRadius: '6px', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#E5E7EB' }, '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#D1D5DB' } }}
                      >
                        <MenuItem value=""><em>All Worksites</em></MenuItem>
                        {availableContactWorksites.map((ws) => (
                          <MenuItem key={ws} value={ws}>{ws}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: 120, height: 36 }}>
                      <Select
                        value={contactsStateFilter}
                        onChange={(e) => setContactsStateFilter(e.target.value)}
                        displayEmpty
                        sx={{ height: 36, fontSize: '0.875rem', backgroundColor: 'white', borderRadius: '6px', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#E5E7EB' }, '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#D1D5DB' } }}
                      >
                        <MenuItem value=""><em>All States</em></MenuItem>
                        {availableContactStates.map((st) => (
                          <MenuItem key={st} value={st}>{st}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <TextField
                      size="small"
                      placeholder="Search by name or email..."
                      value={contactsSearchQuery}
                      onChange={(e) => setContactsSearchQuery(e.target.value)}
                      sx={{ minWidth: 260 }}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                          </InputAdornment>
                        ),
                        endAdornment: contactsSearchQuery ? (
                          <InputAdornment position="end">
                            <IconButton size="small" onClick={() => setContactsSearchQuery('')} aria-label="Clear">
                              <ClearIcon fontSize="small" />
                            </IconButton>
                          </InputAdornment>
                        ) : null,
                      }}
                    />
                  </>
                )}
                {contactTabCompanyIds.length > 0 && (
                  <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={() => {
                      const companyIds = account?.associations?.companyIds ?? parentCompanyIds;
                      setAddContactCompanyId(companyIds[0] ?? '');
                      setAddContactLocationId(null);
                      setAddContactForm({
                        firstName: '',
                        lastName: '',
                        email: '',
                        phone: '',
                        jobTitle: '',
                        contactType: 'Unknown',
                        linkedInUrl: '',
                        tags: [],
                        isActive: true,
                        notes: '',
                      });
                      setAddContactError(null);
                      setShowAddContactDialog(true);
                    }}
                  >
                    Add Contact
                  </Button>
                )}
              </Box>
            </Box>
            {!contactTabCompanyIds.length ? (
              <Typography variant="body2" color="text.secondary">
                {isChildAccount ? 'No parent company locations linked. Link worksites in the sidebar to see contacts.' : 'Link at least one company to this account to see and add contacts.'}
              </Typography>
            ) : accountContactsLoading && accountContactsList.length === 0 ? (
              <TableContainer component={Paper} variant="outlined" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ backgroundColor: '#F9FAFB' }}>
                      <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Title</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Email</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Phone</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Location</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>LinkedIn</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {[1, 2, 3].map((i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton height={24} /></TableCell>
                        <TableCell><Skeleton height={24} /></TableCell>
                        <TableCell><Skeleton height={24} /></TableCell>
                        <TableCell><Skeleton height={24} /></TableCell>
                        <TableCell><Skeleton height={24} /></TableCell>
                        <TableCell><Skeleton height={24} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : filteredAccountContacts.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {contactsSearchQuery
                  ? 'No contacts match your search.'
                  : isChildAccount && linkedWorksitesForContacts.length > 0
                    ? 'No contacts are linked to this account\'s worksites yet. Add a contact and pick a worksite, or link existing contacts to this location in CRM.'
                    : isChildAccount
                      ? 'Link worksites in the sidebar, then add contacts for those locations.'
                      : 'No contacts yet. Add a contact to get started.'}
              </Typography>
            ) : (
              <TableContainer component={Paper} variant="outlined" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow sx={{ backgroundColor: '#F9FAFB' }}>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', py: 1.5 }}>Name</TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', py: 1.5 }}>Title</TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', py: 1.5 }}>Email</TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', py: 1.5 }}>Phone</TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', py: 1.5 }}>Location</TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', py: 1.5 }}>LinkedIn</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredAccountContacts.map((contact) => {
                      const fullName = contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unnamed';
                      const locationName =
                        contact.locationId && contact.companyId
                          ? (() => {
                              const row = accountLocationsList.find(
                                (l) => l.companyId === contact.companyId && l.id === contact.locationId
                              );
                              if (row?.name || row?.nickname) return row.name || row.nickname || '—';
                              const opt = locationsByCompany[contact.companyId]?.find(
                                (l) => l.locationId === contact.locationId
                              );
                              return opt?.label || '—';
                            })()
                          : '—';
                      const linkedinUrl = contact.linkedinUrl || contact.linkedin || contact.linkedInUrl || contact.linkedIn;
                      const formatPhone = (p: string) => {
                        const cleaned = (p || '').replace(/\D/g, '');
                        if (cleaned.length === 10) return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
                        return p || '—';
                      };
                      return (
                        <TableRow
                          key={contact.id}
                          onClick={() => navigate(`/contacts/${contact.id}`)}
                          sx={{ cursor: 'pointer', '&:hover': { backgroundColor: '#F9FAFB' } }}
                        >
                          <TableCell sx={{ py: 1.25 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                              <Avatar sx={{ width: 36, height: 36, bgcolor: 'grey.200', color: 'text.primary', fontSize: '0.875rem' }}>
                                {fullName.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2)}
                              </Avatar>
                              <Typography fontWeight={600} sx={{ fontSize: '0.9375rem' }}>{fullName}</Typography>
                            </Box>
                          </TableCell>
                          <TableCell sx={{ py: 1.25 }}>{contact.jobTitle || contact.title || '—'}</TableCell>
                          <TableCell sx={{ py: 1.25 }}>{contact.email || '—'}</TableCell>
                          <TableCell sx={{ py: 1.25 }}>{contact.phone ? formatPhone(contact.phone) : '—'}</TableCell>
                          <TableCell sx={{ py: 1.25 }}>{locationName}</TableCell>
                          <TableCell sx={{ py: 1.25 }}>
                            {linkedinUrl ? (
                              <IconButton size="small" onClick={(e) => { e.stopPropagation(); window.open(linkedinUrl, '_blank'); }} sx={{ color: '#0077B5' }} title="LinkedIn">
                                <LinkedInIcon fontSize="small" />
                              </IconButton>
                            ) : (
                              <Typography variant="body2" color="text.secondary">—</Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>
          {/* Add Contact Dialog */}
          <Dialog open={showAddContactDialog} onClose={() => setShowAddContactDialog(false)} maxWidth="md" fullWidth>
            <DialogTitle>
              <Box display="flex" alignItems="center" justifyContent="space-between">
                <Typography variant="h6">Add New Contact</Typography>
                <IconButton onClick={() => setShowAddContactDialog(false)} disabled={addContactSaving}>
                  <CloseIcon />
                </IconButton>
              </Box>
            </DialogTitle>
            <DialogContent>
              <Box sx={{ pt: 1 }}>
                {addContactError && (
                  <Alert severity="error" sx={{ mb: 2 }} onClose={() => setAddContactError(null)}>
                    {addContactError}
                  </Alert>
                )}
                {!isChildAccount && account?.associations?.companyIds?.length && (account.associations.companyIds.length > 1 || (account.mspAccountIds?.length ?? 0) > 0) && (
                  <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel>Company</InputLabel>
                    <Select
                      value={addContactCompanyId}
                      label="Company"
                      onChange={(e) => setAddContactCompanyId(e.target.value)}
                    >
                      {account.associations.companyIds.map((cid: string) => (
                        <MenuItem key={cid} value={cid}>
                          {companies.find((c) => c.id === cid)?.label ?? cid}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
                {isChildAccount && (account?.associations?.locations?.length ?? 0) > 0 && (
                  <FormControl fullWidth required sx={{ mb: 2 }}>
                    <InputLabel>Worksite / Location</InputLabel>
                    <Select
                      value={addContactLocationId ? `${addContactLocationId.companyId}:${addContactLocationId.locationId}` : ''}
                      label="Worksite / Location"
                      onChange={(e) => {
                        const v = e.target.value as string;
                        if (!v) {
                          setAddContactLocationId(null);
                          return;
                        }
                        const [companyId, locationId] = v.split(':');
                        if (companyId && locationId) setAddContactLocationId({ companyId, locationId });
                      }}
                    >
                      <MenuItem value=""><em>Select worksite</em></MenuItem>
                      {(account?.associations?.locations ?? []).map((loc: { companyId: string; locationId: string }) => {
                        const option = (locationsByCompany[loc.companyId] || []).find((l) => l.locationId === loc.locationId);
                        const label = option?.label || loc.locationId;
                        const companyLabel = companies.find((c) => c.id === loc.companyId)?.label ?? loc.companyId;
                        return (
                          <MenuItem key={`${loc.companyId}:${loc.locationId}`} value={`${loc.companyId}:${loc.locationId}`}>
                            {label} ({companyLabel})
                          </MenuItem>
                        );
                      })}
                    </Select>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                      This contact will be associated with the company and this worksite for this account.
                    </Typography>
                  </FormControl>
                )}
                <Grid container spacing={2} sx={{ mt: 1 }}>
                  <Grid item xs={12} sm={6}>
                    <TextField fullWidth label="First Name *" value={addContactForm.firstName} onChange={(e) => setAddContactForm((p) => ({ ...p, firstName: e.target.value }))} required disabled={addContactSaving} />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField fullWidth label="Last Name *" value={addContactForm.lastName} onChange={(e) => setAddContactForm((p) => ({ ...p, lastName: e.target.value }))} required disabled={addContactSaving} />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField fullWidth label="Email" type="email" value={addContactForm.email} onChange={(e) => setAddContactForm((p) => ({ ...p, email: e.target.value }))} disabled={addContactSaving} />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField fullWidth label="Phone" value={addContactForm.phone} onChange={(e) => setAddContactForm((p) => ({ ...p, phone: e.target.value }))} disabled={addContactSaving} />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField fullWidth label="Job Title" value={addContactForm.jobTitle} onChange={(e) => setAddContactForm((p) => ({ ...p, jobTitle: e.target.value }))} disabled={addContactSaving} />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControl fullWidth>
                      <InputLabel>Contact Type</InputLabel>
                      <Select value={addContactForm.contactType} label="Contact Type" onChange={(e) => setAddContactForm((p) => ({ ...p, contactType: e.target.value }))} disabled={addContactSaving}>
                        <MenuItem value="Decision Maker">Decision Maker</MenuItem>
                        <MenuItem value="Influencer">Influencer</MenuItem>
                        <MenuItem value="Gatekeeper">Gatekeeper</MenuItem>
                        <MenuItem value="Referrer">Referrer</MenuItem>
                        <MenuItem value="Evaluator">Evaluator</MenuItem>
                        <MenuItem value="Unknown">Unknown</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField fullWidth label="LinkedIn URL" value={addContactForm.linkedInUrl} onChange={(e) => setAddContactForm((p) => ({ ...p, linkedInUrl: e.target.value }))} disabled={addContactSaving} />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <FormControlLabel
                      control={<Switch checked={addContactForm.isActive} onChange={(e) => setAddContactForm((p) => ({ ...p, isActive: e.target.checked }))} color="primary" disabled={addContactSaving} />}
                      label="Active Contact"
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <Autocomplete
                      multiple
                      freeSolo
                      options={[]}
                      value={addContactForm.tags}
                      onChange={(_, v) => setAddContactForm((p) => ({ ...p, tags: v }))}
                      disabled={addContactSaving}
                      renderTags={(value, getTagProps) => value.map((option, index) => <Chip variant="outlined" label={option} {...getTagProps({ index })} color="primary" key={index} />)}
                      renderInput={(params) => <TextField {...params} label="Tags" placeholder="Add tags..." />}
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <TextField fullWidth label="Notes" multiline rows={3} value={addContactForm.notes} onChange={(e) => setAddContactForm((p) => ({ ...p, notes: e.target.value }))} disabled={addContactSaving} />
                  </Grid>
                  <Grid item xs={12}>
                    <Alert severity="info">
                      <Typography variant="body2">
                        This contact will be automatically associated with <strong>{companies.find((c) => c.id === (addContactCompanyId || account?.associations?.companyIds?.[0]))?.label ?? 'the selected company'}</strong>.
                      </Typography>
                    </Alert>
                  </Grid>
                </Grid>
              </Box>
            </DialogContent>
            <DialogActions sx={{ p: 3, pt: 0 }}>
              <Button onClick={() => { setShowAddContactDialog(false); setAddContactError(null); }} disabled={addContactSaving} variant="outlined">Cancel</Button>
              <Button onClick={handleSaveAccountContact} variant="contained" disabled={addContactSaving || !addContactForm.firstName?.trim() || !addContactForm.lastName?.trim()} startIcon={addContactSaving ? <CircularProgress size={16} /> : <AddIcon />} size="large">
                {addContactSaving ? 'Saving...' : 'Save Contact'}
              </Button>
            </DialogActions>
          </Dialog>
        </TabPanel>
        <TabPanel value={tabValue} index={7}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minHeight: 0 }}>
            <TextField
              size="small"
              placeholder="Search child accounts…"
              value={childrenSearchQuery}
              onChange={(e) => setChildrenSearchQuery(e.target.value)}
              sx={{ maxWidth: 400 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                  </InputAdornment>
                ),
                endAdornment: childrenSearchQuery ? (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setChildrenSearchQuery('')} aria-label="Clear">
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ) : null,
              }}
            />
            {childAccountsLoading && childAccountsList.length === 0 ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress size={32} />
              </Box>
            ) : filteredChildAccounts.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No child accounts to show.
              </Typography>
            ) : (
              <TableContainer
                component={Paper}
                sx={{
                  flex: 1,
                  minHeight: 0,
                  border: '1px solid #EAEEF4',
                  borderRadius: 0,
                  boxShadow: 'none',
                  '&::-webkit-scrollbar': { width: '8px', height: '8px' },
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
                <Table size="small" stickyHeader sx={{ width: '100%' }}>
                  <TableHead sx={{ backgroundColor: '#FFFFFF' }}>
                    <TableRow sx={{ backgroundColor: '#FFFFFF' }}>
                      <TableCell
                        align="center"
                        sx={{
                          width: 60,
                          minWidth: 60,
                          maxWidth: 60,
                          position: 'sticky',
                          top: 0,
                          zIndex: 12,
                          bgcolor: '#FFFFFF',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          color: '#374151',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          py: 1.75,
                          px: 1,
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                        }}
                      />
                      <TableCell
                        sx={{
                          position: 'sticky',
                          top: 0,
                          zIndex: 12,
                          bgcolor: '#FFFFFF',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          color: '#374151',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          py: 1.75,
                          pl: 2,
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                        }}
                      >
                        ACCOUNT NAME
                      </TableCell>
                      <TableCell
                        sx={{
                          position: 'sticky',
                          top: 0,
                          zIndex: 12,
                          bgcolor: '#FFFFFF',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          color: '#374151',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          py: 1.75,
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                        }}
                      >
                        STATUS
                      </TableCell>
                      <TableCell
                        sx={{
                          position: 'sticky',
                          top: 0,
                          zIndex: 12,
                          bgcolor: '#FFFFFF',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          color: '#374151',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          py: 1.75,
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                        }}
                      >
                        ACCOUNT TYPE
                      </TableCell>
                      <TableCell
                        sx={{
                          position: 'sticky',
                          top: 0,
                          zIndex: 12,
                          bgcolor: '#FFFFFF',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          color: '#374151',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          py: 1.75,
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                        }}
                      >
                        E-VERIFY
                      </TableCell>
                      <TableCell
                        sx={{
                          position: 'sticky',
                          top: 0,
                          zIndex: 12,
                          bgcolor: '#FFFFFF',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          color: '#374151',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          py: 1.75,
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                        }}
                      >
                        HIRING ENTITY
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredChildAccounts.map((child, index) => (
                      <TableRow
                        key={child.id}
                        hover
                        onClick={() => child.id && navigate(`/accounts/${child.id}`)}
                        sx={{
                          cursor: child.id ? 'pointer' : 'default',
                          backgroundColor: index % 2 === 0 ? 'background.paper' : '#FAFAFA',
                          '&:hover': { backgroundColor: 'action.hover' },
                        }}
                      >
                        <TableCell
                          align="center"
                          sx={{
                            width: 60,
                            minWidth: 60,
                            maxWidth: 60,
                            py: 1.5,
                            px: 1,
                            borderBottom: '1px solid',
                            borderColor: 'divider',
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <FavoriteButton
                            itemId={child.id}
                            favoriteType="accounts"
                            isFavorite={isFavorite}
                            toggleFavorite={toggleFavorite}
                            size="small"
                            sx={{
                              p: 0.25,
                              color: isFavorite(child.id) ? '#0B63C5' : '#6B7280',
                              '&:hover': { color: '#0B63C5', backgroundColor: 'rgba(11, 99, 197, 0.08)' },
                            }}
                          />
                        </TableCell>
                        <TableCell
                          sx={{
                            py: 1.5,
                            pl: 2,
                            borderBottom: '1px solid',
                            borderColor: 'divider',
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <AccountTreeIcon sx={{ fontSize: 20, color: 'text.secondary' }} />
                            <Typography variant="body2" sx={{ fontWeight: 500 }}>
                              {child.name || '—'}
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell
                          sx={{
                            py: 1.5,
                            borderBottom: '1px solid',
                            borderColor: 'divider',
                          }}
                        >
                          <Chip
                            label={child.active ? 'Active' : 'Inactive'}
                            color={child.active ? 'success' : 'default'}
                            size="small"
                            variant={child.active ? 'filled' : 'outlined'}
                            sx={{ fontWeight: 500 }}
                          />
                        </TableCell>
                        <TableCell
                          sx={{
                            py: 1.5,
                            borderBottom: '1px solid',
                            borderColor: 'divider',
                            fontSize: '0.875rem',
                          }}
                        >
                          {child.accountType === 'national'
                            ? 'National'
                            : child.accountType === 'child'
                              ? 'Child'
                              : 'Standalone'}
                        </TableCell>
                        <TableCell
                          sx={{
                            py: 1.5,
                            borderBottom: '1px solid',
                            borderColor: 'divider',
                            fontSize: '0.875rem',
                          }}
                        >
                          {(entityOptions.find((e) => e.id === (child.hiringEntityId ?? account?.hiringEntityId))?.everifyRequired ?? child.eVerifyRequired) ? 'Yes' : 'No'}
                        </TableCell>
                        <TableCell
                          sx={{
                            py: 1.5,
                            borderBottom: '1px solid',
                            borderColor: 'divider',
                            fontSize: '0.875rem',
                          }}
                        >
                          {entityOptions.find((e) => e.id === (child.hiringEntityId ?? account?.hiringEntityId))?.name ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>
        </TabPanel>
        <TabPanel value={tabValue} index={8}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={9}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Define how this account is billed: flat markup for all positions (e.g. Sodexo, Black Caviar) or job-title-specific pay and bill rates. Positions here are the only job titles available when creating job orders for this account.
              </Typography>
              {account.accountType === 'national' && (
                <Card sx={{ mb: 3 }}>
                  <CardHeader title="National account pricing" titleTypographyProps={{ variant: 'h6', fontWeight: 600 }} />
                  <CardContent sx={{ pt: 0 }}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={pricingSubAccountsManageOwn}
                          onChange={(e) => setPricingSubAccountsManageOwn(e.target.checked)}
                        />
                      }
                      label="Sub-accounts manage their own pricing (e.g. Oakland Arena has specific bill rates per title; uncheck for a single flat markup across all sub-accounts)"
                    />
                    {!pricingSubAccountsManageOwn && (
                      <Box sx={{ mt: 2, display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                        <TextField
                          size="small"
                          type="number"
                          label="Flat markup %"
                          value={pricingFlatMarkupPercent}
                          onChange={(e) => setPricingFlatMarkupPercent(e.target.value === '' ? '' : Number(e.target.value))}
                          inputProps={{ min: 0, step: 0.5 }}
                          sx={{ width: 160, ...numberInputNoSpinnerSx }}
                          helperText="Applied to all job positions across all sub-accounts (e.g. 45 = 45% over pay rate)"
                        />
                        {/* R.16.2c — manual sync next to the flat markup
                            field. Captured per L4 even when
                            `subAccountsManageOwnPricing` is on (the flag
                            controls the form's UI mode, not snapshot
                            semantics). The button is rendered only when
                            the flat-markup field is visible (i.e.
                            `subAccountsManageOwnPricing` is off) — when
                            the National turns on per-sub-account pricing,
                            no flat markup exists to push. */}
                        {canPushToActive && tenantId && account && (
                          <Box sx={{ pt: 0.5 }}>
                            <SyncToActiveButton
                              tenantId={tenantId}
                              accountId={account.id}
                              fieldKey="pricingFlatMarkupPercent"
                              getCurrentValue={() =>
                                pricingFlatMarkupPercent === ''
                                  ? null
                                  : Number(pricingFlatMarkupPercent)
                              }
                              fieldLabel="Flat Markup %"
                            />
                          </Box>
                        )}
                      </Box>
                    )}
                  </CardContent>
                </Card>
              )}
              <Card sx={{ mb: 3 }}>
                <CardHeader title="Pricing Notes" titleTypographyProps={{ variant: 'h6', fontWeight: 600 }} />
                <CardContent sx={{ pt: 0 }}>
                  <TextField
                    fullWidth
                    multiline
                    minRows={3}
                    maxRows={8}
                    label="Notes"
                    placeholder="e.g. special billing instructions, rate notes..."
                    value={pricingNotes}
                    onChange={(e) => setPricingNotes(e.target.value)}
                    onBlur={() => savePricingNotes(pricingNotes)}
                    disabled={pricingNotesSaving}
                    helperText={pricingNotesSaving ? 'Saving…' : 'Saved on blur. Flows downstream (e.g. National → Child → Job Order).'}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader
                  title="Positions table"
                  subheader="Job titles and rates for this account. WC code and rate auto-fill when job title + state match in Settings → Workers Comp; or enter them manually. At sub-account or standalone level, workers comp and (for C1 Workforce / C1 Select) SUTA/FUTA apply."
                  titleTypographyProps={{ variant: 'h6', fontWeight: 600 }}
                  action={
                    <Button
                      size="small"
                      startIcon={<AddIcon />}
                      onClick={() =>
                        setPricingPositions((prev) => [
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
                            uniformRequirements: '',
                          },
                        ])
                      }
                    >
                      Add position
                    </Button>
                  }
                />
                <CardContent sx={{ pt: 0 }}>
                  {/* R.16.2a Phase 3 — per-position Push-to-Active
                      banner stack. Only rendered for `securityLevel ===
                      '7'`; one banner per dirty (positionId, fieldKey)
                      pair (Q1 lock). Stacked above the pricing table so
                      the operator can review affected JOs without
                      scrolling past the table they just edited. */}
                  {canPushToActive && tenantId && account
                    ? pushBanners
                        .filter((b) => (b.positionId ?? null) !== null)
                        .map((payload) => (
                          <PushToActiveBanner
                            key={`pos-${payload.positionId}-${payload.fieldKey}`}
                            tenantId={tenantId}
                            accountId={account.id}
                            payload={payload}
                            onDismiss={() => dismissPushBanner(payload)}
                          />
                        ))
                    : null}
                  {showSutaFutaOnPricingPositions && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 2 }}>
                      <FormControl size="small" sx={{ minWidth: 140 }}>
                        <InputLabel>Worksite state</InputLabel>
                        <Select
                          value={pricingSutaFutaState || ''}
                          onChange={(e) => setPricingSutaFutaState(e.target.value)}
                          label="Worksite state"
                        >
                          <MenuItem value="">
                            <em>Select state</em>
                          </MenuItem>
                          {US_STATE_CODES.map((code) => (
                            <MenuItem key={code} value={code}>
                              {code}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => {
                          const stateCode = pricingSutaFutaState || normalizeStateCode(worksiteDetails?.state);
                          if (!stateCode) return;
                          const suta = getSutaRateByState(stateCode);
                          const futa = getFutaRateByState(stateCode);
                          setPricingPositions((prev) =>
                            prev.map((row) => ({
                              ...row,
                              sutaRate: suta ?? row.sutaRate,
                              futaRate: futa,
                            }))
                          );
                        }}
                        disabled={!pricingSutaFutaState && !normalizeStateCode(worksiteDetails?.state)}
                        sx={{ textTransform: 'none' }}
                      >
                        Apply SUTA/FUTA from state
                      </Button>
                      <Typography variant="caption" color="text.secondary">
                        Uses estimated new-employer SUTA and FUTA rates for the selected state.
                      </Typography>
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
                          {showSutaFutaOnPricingPositions && (
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
                        {pricingPositions.map((row, idx) => {
                          const markupVal = row.markupPercent;
                          const markup = markupVal == null ? null : Number(markupVal);
                          const markupNum = typeof markup === 'number' && !Number.isNaN(markup) ? markup : null;
                          const pay = Number(row.payRate) || 0;
                          const bill = markupNum != null ? pay * (1 + markupNum / 100) : (Number(row.billRate) || 0);
                          const pricingStateCode = (pricingSutaFutaState || normalizeStateCode(worksiteDetails?.state) || '').trim().toUpperCase();
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
                                      const stateCode = (pricingSutaFutaState || normalizeStateCode(worksiteDetails?.state) || '').trim().toUpperCase();
                                      const lookup =
                                        stateCode && v
                                          ? pickWorkersCompJobTitleLookup(
                                              wcJobTitleMaps,
                                              stateCode,
                                              String(v),
                                              wcModifierAccountIdForPricing,
                                            )
                                          : undefined;
                                      setPricingPositions((prev) => {
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
                                      setPricingPositions((prev) => {
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
                                    setPricingPositions((prev) => {
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
                                    setPricingPositions((prev) => {
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
                                    setPricingPositions((prev) => {
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
                                    setPricingPositions((prev) => {
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
                                      const sc = (pricingSutaFutaState || normalizeStateCode(worksiteDetails?.state) || '').trim().toUpperCase();
                                      const code = (row.workersCompCode ?? '').trim();
                                      const fromMaster = sc && code ? wcRatesByKey[`${sc}_${code}`] : undefined;
                                      return fromMaster != null ? fromMaster : (row.workersCompRate ?? '');
                                    })()
                                  }
                                  onChange={(e) => {
                                    const v = e.target.value === '' ? null : Number(e.target.value);
                                    setPricingPositions((prev) => {
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
                              {showSutaFutaOnPricingPositions && (
                                <>
                                  <TableCell align="right">
                                    <TextField
                                      size="small"
                                      type="number"
                                      value={row.sutaRate ?? ''}
                                      onChange={(e) => {
                                        const v = e.target.value === '' ? null : Number(e.target.value);
                                        setPricingPositions((prev) => {
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
                                        setPricingPositions((prev) => {
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
                                <Typography variant="body2">{isNaN(margin) ? '—' : `$${margin.toFixed(2)}`}</Typography>
                              </TableCell>
                              <TableCell>
                                <IconButton
                                  size="small"
                                  onClick={() => setPricingPositions((prev) => prev.filter((_, i) => i !== idx))}
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
                  {pricingPositions.length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                      No positions yet. Add job titles and pay/bill rates (or markup %) to define pricing. These titles will be the only ones available when creating job orders for this account.
                    </Typography>
                  )}
                  <Button
                    variant="contained"
                    startIcon={pricingSaving ? <CircularProgress size={20} /> : <SaveIcon />}
                    onClick={savePricing}
                    disabled={pricingSaving}
                    sx={{ mt: 2 }}
                  >
                    {pricingSaving ? 'Saving…' : 'Save pricing'}
                  </Button>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={3}>
              <AccountSidebar
                account={account}
                tenantId={tenantId!}
                navigate={navigate}
                updateAccountAssociations={updateAccountAssociations}
                companies={companies}
                locationsByCompany={locationsByCompany}
                contacts={contacts}
                jobOrders={jobOrders}
                deals={deals}
                laborPoolOptions={laborPoolOptions}
                salespeopleOptions={salespeopleOptions}
                recruitersOptions={recruitersOptions}
                accountOptions={accountOptions.filter((a) => a.id !== account.id && a.id !== account.parentAccountId && !(account.childAccountIds || []).includes(a.id))}
                parentAccount={parentAccount}
                childAccounts={childAccounts}
                mspAccounts={mspAccounts}
                onParentAccountChange={updateParentAccountRelationship}
                onChildAccountsChange={updateChildAccountRelationships}
                onMspAccountsChange={updateMspAccountIds}
                optionsLoading={optionsLoading}
                saving={saving}
                visibleSections={['deals', 'salespeople', 'recruiters']}
              />
            </Grid>
          </Grid>
        </TabPanel>
        <TabPanel value={tabValue} index={9}>
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minHeight: 0 }}>
                {/* Filters: Status, Company, Sort By */}
                <Box
                  sx={{
                    p: 1.5,
                    backgroundColor: '#F9FAFB',
                    borderRadius: '8px',
                    border: '1px solid #E5E7EB',
                  }}
                >
                  <Stack direction="row" gap={1.5} flexWrap="wrap">
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
                    {/* Company filter – commented out
                    <FormControl size="small" sx={{ minWidth: 180, height: 36 }}>
                      <InputLabel sx={{ fontSize: '0.875rem' }}>Company</InputLabel>
                      <Select
                        value={jobOrdersCompanyFilter}
                        onChange={(e) => { setJobOrdersCompanyFilter(e.target.value); setJobOrdersPage(0); }}
                        label="Company"
                        sx={{ height: 36, borderRadius: '6px', backgroundColor: 'white', fontSize: '0.875rem' }}
                      >
                        <MenuItem value="all">All Companies</MenuItem>
                        {uniqueAccountJobOrderCompanies.map((company) => (
                          <MenuItem key={company} value={company}>{company}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    */}
                    {/* Sort By — hidden for now per UX feedback. Header #/Recruiter
                        sort controls still work via the column headers, so we
                        keep `jobOrdersSortField`/`jobOrdersSortDirection` state
                        around. Uncomment this block to bring the dropdown back. */}
                    {/*
                    <FormControl size="small" sx={{ minWidth: 150, height: 36 }}>
                      <InputLabel sx={{ fontSize: '0.875rem' }}>Sort By</InputLabel>
                      <Select
                        value={jobOrdersSortField}
                        onChange={(e) => {
                          setJobOrdersSortField(e.target.value);
                          setJobOrdersPage(0);
                        }}
                        label="Sort By"
                        sx={{ height: 36, borderRadius: '6px', backgroundColor: 'white', fontSize: '0.875rem' }}
                      >
                        <MenuItem value="jobOrderNumber">Job Order #</MenuItem>
                        <MenuItem value="createdAt">Newest First</MenuItem>
                        <MenuItem value="recruiterName">Recruiter(s)</MenuItem>
                      </Select>
                    </FormControl>
                    */}
                    {/* National accounts only: flat list vs. grouped-by-sub-account view.
                        Sort is preserved inside each group when grouped. */}
                    {isNationalAccount && (
                      <ToggleButtonGroup
                        size="small"
                        exclusive
                        value={jobOrdersView}
                        onChange={(_, next) => {
                          if (next === 'flat' || next === 'sub-account') {
                            handleJobOrdersViewChange(next);
                          }
                        }}
                        sx={{
                          height: 36,
                          '& .MuiToggleButton-root': {
                            textTransform: 'none',
                            fontSize: '0.875rem',
                            px: 1.75,
                            borderRadius: '6px',
                            backgroundColor: 'white',
                          },
                          '& .MuiToggleButton-root.Mui-selected': {
                            backgroundColor: '#0B63C5',
                            color: 'white',
                            '&:hover': { backgroundColor: '#0B63C5' },
                          },
                        }}
                        aria-label="Job orders view"
                      >
                        <ToggleButton value="flat">Flat list</ToggleButton>
                        <ToggleButton value="sub-account">Sub accounts</ToggleButton>
                      </ToggleButtonGroup>
                    )}
                    {/* Secondary filter for Sub Accounts view — hide sub-accounts
                        with no orders. Only rendered when the main toggle is on
                        "Sub accounts" so the filter bar doesn't get cluttered. */}
                    {isNationalAccount && jobOrdersView === 'sub-account' && (
                      <ToggleButtonGroup
                        size="small"
                        exclusive
                        value={subAccountsFilter}
                        onChange={(_, next) => {
                          if (next === 'all' || next === 'with-orders') {
                            handleSubAccountsFilterChange(next);
                          }
                        }}
                        sx={{
                          height: 36,
                          '& .MuiToggleButton-root': {
                            textTransform: 'none',
                            fontSize: '0.875rem',
                            px: 1.75,
                            borderRadius: '6px',
                            backgroundColor: 'white',
                          },
                          '& .MuiToggleButton-root.Mui-selected': {
                            backgroundColor: '#0B63C5',
                            color: 'white',
                            '&:hover': { backgroundColor: '#0B63C5' },
                          },
                        }}
                        aria-label="Sub accounts filter"
                      >
                        <ToggleButton value="all">All sub accounts</ToggleButton>
                        <ToggleButton value="with-orders">With job orders</ToggleButton>
                      </ToggleButtonGroup>
                    )}
                  </Stack>
                </Box>
                {accountJobOrdersError && (
                  <Alert severity="error">{accountJobOrdersError}</Alert>
                )}
                {accountJobOrdersLoading && accountJobOrders.length === 0 ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                    <CircularProgress />
                  </Box>
                ) : !jobOrdersTabCompanyIds.length ? (
                  <Box sx={{ textAlign: 'center', py: 8 }}>
                    <WorkIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                    <Typography variant="h6" color="text.secondary" gutterBottom>
                      No companies linked
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Link companies to this account to see job orders here.
                    </Typography>
                  </Box>
                ) : filteredAccountJobOrders.length === 0 &&
                    !(
                      isNationalAccount &&
                      jobOrdersView === 'sub-account' &&
                      subAccountsFilter === 'all' &&
                      (account?.childAccountIds?.length ?? 0) > 0
                    ) ? (
                  // Sub Account view (with "All sub accounts" filter) intentionally
                  // falls through so empty child headers still render with "No job
                  // orders yet" rows. With "With job orders" filter on, no orders
                  // means nothing would render, so we fall back to the empty state.
                  <Box sx={{ textAlign: 'center', py: 8 }}>
                    <WorkIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                    <Typography variant="h6" color="text.secondary" gutterBottom>
                      No job orders found
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {jobOrdersSearch || jobOrdersStatusFilter ? 'Try adjusting your filters.' : 'No job orders for this account\'s companies yet.'}
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
                            <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>Type</TableCell>
                            <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>Job Title</TableCell>
                            {/* Account column — redundant in Sub Accounts view since the
                                group header row already identifies the sub-account. */}
                            {!(isNationalAccount && jobOrdersView === 'sub-account') && (
                              <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>Account</TableCell>
                            )}
                            <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>Location</TableCell>
                            <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>Status</TableCell>
                            {/* Requested/Filled column — hidden per UX feedback; uncomment to restore. */}
                            {/* <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>Requested/Filled</TableCell> */}
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
                            {/* Age column — hidden per UX feedback; uncomment to restore. */}
                            {/* <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>Age</TableCell> */}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {(() => {
                            /**
                             * Row renderer shared between flat + grouped views.
                             *  - `zebraIndex`: striping; in grouped mode this resets per group.
                             *  - `variant`:
                             *      - `flat`  — renders every column.
                             *      - `grouped` — drops the Account column (the parent
                             *        sub-account header already identifies the account)
                             *        and replaces the Location cell's single line with
                             *        worksite name on top + full address beneath.
                             */
                            const renderJobOrderRow = (
                              jobOrder: JobOrderWithDetails,
                              zebraIndex: number,
                              variant: 'flat' | 'grouped' = 'flat',
                            ) => (
                              <TableRow
                                key={jobOrder.id}
                                hover
                                onClick={() => navigate(`/jobs/job-orders/${jobOrder.id}`)}
                                sx={{
                                  cursor: 'pointer',
                                  backgroundColor:
                                    zebraIndex % 2 === 0 ? 'background.paper' : 'action.hover',
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
                                    tooltipText={{
                                      favorited: 'Remove from favorites',
                                      notFavorited: 'Add to favorites',
                                    }}
                                  />
                                </TableCell>
                                <TableCell>
                                  <Typography variant="body2" fontWeight={600}>
                                    {formatJobOrderNumber((jobOrder as any).jobOrderNumber ?? 0)}
                                  </Typography>
                                </TableCell>
                                <TableCell>
                                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0 }}>
                                    <Typography variant="body2" fontWeight={500}>
                                      {jobOrder.jobOrderName}
                                    </Typography>
                                    {/* Replaces the old "Order Setup: —" caption (which
                                        wasn't loading). For Gig JOs with an upcoming shift
                                        today or later, surface the next-shift datetime.
                                        Career orders / Gig JOs with no future shifts render
                                        nothing so the title sits alone. */}
                                    {(() => {
                                      const joType = (jobOrder as any).jobType;
                                      if (joType !== 'gig') return null;
                                      const nextShift = nextShiftByJobOrderId[jobOrder.id];
                                      if (!nextShift) return null;
                                      return (
                                        <Typography
                                          variant="caption"
                                          color="text.secondary"
                                          sx={{ lineHeight: 1.2 }}
                                        >
                                          Next shift: {formatNextShiftLabel(nextShift)}
                                        </Typography>
                                      );
                                    })()}
                                  </Box>
                                </TableCell>
                                <TableCell>
                                  {/* Type — Career/Gig chip from `jobType`. Stays blank
                                      for legacy rows where the field was never set so we
                                      don't mislabel them. Matches the chip style used in
                                      the Job Order header (RecruiterJobOrderDetail). */}
                                  {(() => {
                                    const raw = (jobOrder as any).jobType;
                                    const label =
                                      raw === 'gig'
                                        ? 'Gig'
                                        : raw === 'career'
                                          ? 'Career'
                                          : raw
                                            ? String(raw)
                                            : null;
                                    return label ? (
                                      <Chip
                                        label={label}
                                        size="small"
                                        sx={{
                                          height: 22,
                                          fontSize: '0.7rem',
                                          fontWeight: 600,
                                          bgcolor: 'rgba(0,0,0,0.06)',
                                          '& .MuiChip-label': { px: 0.75 },
                                        }}
                                      />
                                    ) : (
                                      <Typography variant="body2" color="text.disabled">
                                        —
                                      </Typography>
                                    );
                                  })()}
                                </TableCell>
                                <TableCell>
                                  <Typography variant="body2">{jobOrder.jobTitle || 'No Job Title'}</Typography>
                                </TableCell>
                                {variant === 'flat' && (
                                  <TableCell>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                      <BusinessIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                                      <Typography variant="body2">{jobOrder.companyName || 'Unknown Company'}</Typography>
                                    </Box>
                                  </TableCell>
                                )}
                                <TableCell>
                                  {(() => {
                                    const locName = jobOrder.locationName || 'No Location';
                                    // Sub accounts view: worksite name on top, then two
                                    // lines of smaller secondary text — street on line 2,
                                    // "city, state zip" on line 3. Each line only renders
                                    // when its parts are populated so partial addresses
                                    // don't leave empty gaps.
                                    if (variant === 'grouped') {
                                      const addr = (jobOrder as any).worksiteAddress as
                                        | {
                                            street?: string;
                                            city?: string;
                                            state?: string;
                                            zipCode?: string;
                                          }
                                        | undefined;
                                      const street = addr?.street?.trim() || '';
                                      const cityStateZip = [
                                        [addr?.city?.trim(), addr?.state?.trim()]
                                          .filter(Boolean)
                                          .join(', '),
                                        addr?.zipCode?.trim(),
                                      ]
                                        .filter(Boolean)
                                        .join(' ');
                                      return (
                                        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, minWidth: 0 }}>
                                          <LocationOnIcon sx={{ fontSize: 16, color: 'text.secondary', mt: '2px', flexShrink: 0 }} />
                                          <Box sx={{ minWidth: 0 }}>
                                            <Typography variant="body2" sx={{ lineHeight: 1.3 }}>
                                              {locName}
                                            </Typography>
                                            {street && (
                                              <Typography
                                                variant="caption"
                                                color="text.secondary"
                                                sx={{ display: 'block', lineHeight: 1.3 }}
                                              >
                                                {street}
                                              </Typography>
                                            )}
                                            {cityStateZip && (
                                              <Typography
                                                variant="caption"
                                                color="text.secondary"
                                                sx={{ display: 'block', lineHeight: 1.3 }}
                                              >
                                                {cityStateZip}
                                              </Typography>
                                            )}
                                          </Box>
                                        </Box>
                                      );
                                    }
                                    return (
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <LocationOnIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                                        <Typography variant="body2">{locName}</Typography>
                                      </Box>
                                    );
                                  })()}
                                </TableCell>
                                <TableCell>
                                  <Chip
                                    label={jobOrder.status}
                                    color={getJobOrderStatusColor(jobOrder.status) as any}
                                    size="small"
                                  />
                                </TableCell>
                                {/* Requested/Filled cell — hidden per UX feedback; uncomment to restore. */}
                                {/*
                                <TableCell>
                                  <Typography variant="body2">
                                    {jobOrder.workersNeeded ?? 0} / {jobOrder.headcountFilled ?? 0}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    {jobOrder.workersNeeded && jobOrder.headcountFilled
                                      ? `${Math.round(((jobOrder.headcountFilled ?? 0) / (jobOrder.workersNeeded || 1)) * 100)}% filled`
                                      : '0% filled'}
                                  </Typography>
                                </TableCell>
                                */}
                                <TableCell>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <PersonIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                                    <Typography variant="body2">{jobOrder.recruiterName || 'Unassigned'}</Typography>
                                  </Box>
                                </TableCell>
                                {/* Age cell — hidden per UX feedback; uncomment to restore. */}
                                {/*
                                <TableCell>
                                  <Typography variant="body2">{getJobOrderAge(jobOrder.createdAt)} days</Typography>
                                </TableCell>
                                */}
                              </TableRow>
                            );

                            const isGrouped = isNationalAccount && jobOrdersView === 'sub-account';
                            if (!isGrouped) {
                              return paginatedAccountJobOrders.map((jo, i) => renderJobOrderRow(jo, i));
                            }

                            // Apply secondary sub-accounts filter. `with-orders`
                            // hides empty groups entirely (both the child empties
                            // and the parent "(National)" group when it's empty).
                            const visibleGroups =
                              subAccountsFilter === 'with-orders'
                                ? groupedAccountJobOrders.filter((g) => g.orders.length > 0)
                                : groupedAccountJobOrders;

                            // Grouped view: emit a header row per sub-account, then its orders
                            // (or a "No job orders" placeholder when the group is empty).
                            return visibleGroups.flatMap((group) => {
                              // Parent "(National)" group keeps the BusinessIcon — it's the
                              // parent account itself, not a sub-account. Children use the
                              // AccountTree icon so the sidebar icon for "Sub Accounts"
                              // matches what recruiters see in the header rows.
                              const HeaderIcon = group.isParentGroup
                                ? BusinessIcon
                                : AccountTreeIcon;
                              const headerRow = (
                                <TableRow
                                  key={group.key}
                                  onClick={
                                    group.href
                                      ? () => navigate(group.href as string)
                                      : undefined
                                  }
                                  sx={{
                                    cursor: group.href ? 'pointer' : 'default',
                                    backgroundColor: group.isParentGroup ? '#EEF2F7' : '#F3F4F6',
                                    '&:hover': group.href
                                      ? { backgroundColor: group.isParentGroup ? '#E3E9F1' : '#E5E7EB' }
                                      : undefined,
                                    borderTop: '2px solid',
                                    borderTopColor: 'divider',
                                  }}
                                >
                                  <TableCell
                                    colSpan={8}
                                    sx={{
                                      py: 1,
                                      fontWeight: 700,
                                      color: 'text.primary',
                                    }}
                                  >
                                    <Box
                                      sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 1,
                                        minWidth: 0,
                                      }}
                                    >
                                      <HeaderIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                                      <Typography variant="body2" fontWeight={700} component="span">
                                        {group.label}
                                      </Typography>
                                    </Box>
                                  </TableCell>
                                </TableRow>
                              );
                              const orderRows = group.orders.length
                                ? group.orders.map((jo, i) => renderJobOrderRow(jo, i, 'grouped'))
                                : [
                                    <TableRow key={`${group.key}-empty`}>
                                      <TableCell
                                        colSpan={8}
                                        sx={{
                                          py: 1.5,
                                          pl: 5,
                                          color: 'text.secondary',
                                          fontStyle: 'italic',
                                          fontSize: '0.875rem',
                                        }}
                                      >
                                        No job orders yet
                                      </TableCell>
                                    </TableRow>,
                                  ];
                              return [headerRow, ...orderRows];
                            });
                          })()}
                        </TableBody>
                      </Table>
                    </TableContainer>
                    {/* Pagination only applies to the flat view — the grouped view
                        always shows every sub-account so paging through headers
                        would be confusing. National accounts rarely exceed a few
                        hundred orders; if that changes, revisit. */}
                    {!(isNationalAccount && jobOrdersView === 'sub-account') && (
                      <StandardTablePagination
                        count={filteredAccountJobOrders.length}
                        page={jobOrdersPage}
                        onPageChange={(_, newPage) => setJobOrdersPage(newPage)}
                        rowsPerPage={jobOrdersRowsPerPage}
                        onRowsPerPageChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          setJobOrdersRowsPerPage(val);
                          setJobOrdersPage(0);
                        }}
                      />
                    )}
                  </Box>
                )}
              </Box>
            </Grid>
          </Grid>
        </TabPanel>
        <TabPanel value={tabValue} index={10}>
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minHeight: 0 }}>
                {accountJobPostsLoading && scopedAccountJobPosts.length === 0 ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                    <CircularProgress />
                  </Box>
                ) : !jobOrdersTabCompanyIds.length ? (
                  <Box sx={{ textAlign: 'center', py: 8 }}>
                    <BadgeIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                    <Typography variant="h6" color="text.secondary" gutterBottom>
                      No companies linked
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Link companies to this account to see job board postings here.
                    </Typography>
                  </Box>
                ) : scopedAccountJobPosts.length === 0 ? (
                  <Box sx={{ textAlign: 'center', py: 8 }}>
                    <BadgeIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                    <Typography variant="h6" color="text.secondary" gutterBottom>
                      No job board postings
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      No job posts found for this account&apos;s companies. Create posts from the Jobs Board or link a job order.
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
                            <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>Post #</TableCell>
                            <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>Post Title</TableCell>
                            <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>Type</TableCell>
                            <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>Company</TableCell>
                            <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>Location</TableCell>
                            <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>Status</TableCell>
                            <TableCell sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.75rem' }}>Applications</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {paginatedAccountJobPosts.map((post, index) => (
                            <TableRow
                              key={post.id}
                              hover
                              onClick={() => navigate(`/jobs/jobs-board/edit/${post.id}`)}
                              sx={{
                                cursor: 'pointer',
                                backgroundColor: index % 2 === 0 ? 'background.paper' : 'action.hover',
                                '&:hover': { backgroundColor: 'action.selected' },
                              }}
                            >
                              <TableCell onClick={(e) => e.stopPropagation()}>
                                <FavoriteButton
                                  itemId={post.id}
                                  favoriteType="jobPosts"
                                  isFavorite={isJobPostFavorite}
                                  toggleFavorite={toggleJobPostFavorite}
                                  size="small"
                                  tooltipText={{ favorited: 'Remove from favorites', notFavorited: 'Add to favorites' }}
                                />
                              </TableCell>
                              <TableCell>
                                <Typography variant="body2" fontWeight={600}>
                                  {post.jobPostId ?? post.id}
                                </Typography>
                              </TableCell>
                              <TableCell>
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                                  <Typography variant="body2" fontWeight={500}>
                                    {post.postTitle}
                                  </Typography>
                                  {post.jobTitle && (
                                    <Typography variant="caption" color="text.secondary">
                                      {post.jobTitle}
                                    </Typography>
                                  )}
                                </Box>
                              </TableCell>
                              <TableCell>
                                <Chip
                                  label={post.jobType === 'career' ? 'Career' : 'Gig'}
                                  size="small"
                                  color={post.jobType === 'career' ? 'primary' : 'secondary'}
                                  variant="outlined"
                                />
                              </TableCell>
                              <TableCell>
                                <Typography variant="body2">{post.companyName || '—'}</Typography>
                              </TableCell>
                              <TableCell>
                                <Typography variant="body2">{post.worksiteName || '—'}</Typography>
                              </TableCell>
                              <TableCell>
                                <Chip
                                  label={post.status}
                                  size="small"
                                  color={
                                    post.status === 'active' ? 'success' :
                                    post.status === 'draft' ? 'default' :
                                    post.status === 'paused' ? 'warning' :
                                    post.status === 'cancelled' || post.status === 'expired' ? 'error' : 'default'
                                  }
                                  variant="outlined"
                                />
                              </TableCell>
                              <TableCell>
                                <Typography variant="body2">{post.applicationCount ?? 0}</Typography>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                    <StandardTablePagination
                      count={scopedAccountJobPosts.length}
                      page={jobPostsPage}
                      onPageChange={(_, newPage) => setJobPostsPage(newPage)}
                      rowsPerPage={jobPostsRowsPerPage}
                      onRowsPerPageChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setJobPostsRowsPerPage(val);
                        setJobPostsPage(0);
                      }}
                    />
                  </Box>
                )}
              </Box>
            </Grid>
          </Grid>
        </TabPanel>
        <TabPanel value={tabValue} index={11}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={9}>
              <Card>
                <CardHeader title="Labor Pool" titleTypographyProps={{ variant: 'h6', fontWeight: 600 }} />
                <CardContent sx={{ pt: 0 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    User groups and smart groups are attached in the sidebar. Job order applicant lists appear automatically for each job order linked to this account. Click a row to open the group or job order applicants.
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
                              No labor pool items yet. Add user groups or smart groups in the sidebar; link job orders to this account to see applicant lists here.
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
                                {row.kind === 'userGroup'
                                  ? 'User Group'
                                  : row.kind === 'savedSmartGroup'
                                    ? 'Smart Group'
                                    : 'Applicants'}
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
            </Grid>
            <Grid item xs={12} md={3}>
              <AccountSidebar
                account={account}
                tenantId={tenantId!}
                navigate={navigate}
                updateAccountAssociations={updateAccountAssociations}
                companies={companies}
                locationsByCompany={locationsByCompany}
                contacts={contacts}
                jobOrders={jobOrders}
                deals={deals}
                laborPoolOptions={laborPoolOptions}
                salespeopleOptions={salespeopleOptions}
                recruitersOptions={recruitersOptions}
                accountOptions={accountOptions.filter((a) => a.id !== account.id && a.id !== account.parentAccountId && !(account.childAccountIds || []).includes(a.id))}
                parentAccount={parentAccount}
                childAccounts={childAccounts}
                mspAccounts={mspAccounts}
                onParentAccountChange={updateParentAccountRelationship}
                onChildAccountsChange={updateChildAccountRelationships}
                onMspAccountsChange={updateMspAccountIds}
                optionsLoading={optionsLoading}
                saving={saving}
                visibleSections={['laborPool']}
              />
            </Grid>
          </Grid>
        </TabPanel>
        <TabPanel value={tabValue} index={12}>
          {/* This tab was previously "Docs & Settings" with a left sidebar covering Roles &
              Schedulers, Pricing, Order Details, Staff Instructions, and File Uploads. The
              first four moved to the Cascading Data tab on 2026-05-03; this tab is now scoped
              to the file-uploads card only and is hidden on child accounts (the tab-bar Button
              is wrapped in `!isChildAccount` — uploads on a child are managed at the parent). */}
          <Card>
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
                    onChange={handleUploadFile}
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
                {accountUploads.length === 0 ? (
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
                        {accountUploads.map((row) => (
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
        </TabPanel>
        <TabPanel value={tabValue} index={13}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={9}>
              {!canAccessInvoicing ? (
                <Alert severity="info" sx={{ mt: 2 }}>
                  Invoicing is available to users with security level 5, 6, or 7. You do not have access to this tab.
                </Alert>
              ) : (
              (() => {
                const qb = account.integrations?.quickbooks;
                const qboStatus = qb?.status ?? 'not_connected';
                const isMapped = qboStatus === 'mapped';
                const isConnected = qboStatus === 'connected_unmapped' || isMapped || qboStatus === 'sync_error';
                const canManageQuickBooks = canAccessInvoicing;
                return (
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 2 }}>
                      <ToggleButtonGroup
                        size="small"
                        value={invoicingSubView}
                        exclusive
                        onChange={(_, v) => v != null && setInvoicingSubView(v)}
                        aria-label="Invoicing view"
                      >
                        <ToggleButton value="invoices">Invoices</ToggleButton>
                        <ToggleButton value="ar">A/R Aging</ToggleButton>
                        <ToggleButton value="payments">Payments</ToggleButton>
                        <ToggleButton value="mapping">Mapping / Settings</ToggleButton>
                      </ToggleButtonGroup>
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                        {qb?.lastSyncAt ? `Last synced: ${typeof qb.lastSyncAt?.toDate === 'function' ? qb.lastSyncAt.toDate().toLocaleString() : '—'}` : 'Not synced yet'}
                      </Typography>
                      <Button size="small" variant="outlined" disabled sx={{ textTransform: 'none' }}>Refresh</Button>
                      <Button size="small" variant="outlined" disabled sx={{ textTransform: 'none' }} startIcon={<OpenInNewIcon />}>Open in QuickBooks</Button>
                    </Box>

                    {invoicingSubView === 'invoices' && (
                      <Card variant="outlined">
                        <CardContent>
                          {!isConnected && (
                            <Alert severity="info" sx={{ mb: 2 }}>
                              No QuickBooks connection for this account yet.
                            </Alert>
                          )}
                          <TableContainer component={Paper} variant="outlined" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                            <Table size="small">
                              <TableHead>
                                <TableRow sx={{ bgcolor: 'grey.50' }}>
                                  <TableCell sx={{ fontWeight: 600 }}>Invoice #</TableCell>
                                  <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                                  <TableCell sx={{ fontWeight: 600 }}>Due Date</TableCell>
                                  <TableCell sx={{ fontWeight: 600 }} align="right">Total</TableCell>
                                  <TableCell sx={{ fontWeight: 600 }} align="right">Balance</TableCell>
                                  <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                                  <TableCell sx={{ fontWeight: 600, width: 120 }}>Actions</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {[]}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        </CardContent>
                      </Card>
                    )}

                    {invoicingSubView === 'ar' && (
                      <Card variant="outlined">
                        <CardContent>
                          {!isConnected && (
                            <Alert severity="info" sx={{ mb: 2 }}>
                              Connect QuickBooks and map this account to view aging.
                            </Alert>
                          )}
                          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
                            <Card variant="outlined" sx={{ minWidth: 120 }}>
                              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                                <Typography variant="caption" color="text.secondary">Total Open A/R</Typography>
                                <Typography variant="h6">—</Typography>
                              </CardContent>
                            </Card>
                            <Card variant="outlined" sx={{ minWidth: 100 }}>
                              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                                <Typography variant="caption" color="text.secondary">Current</Typography>
                                <Typography variant="body1">—</Typography>
                              </CardContent>
                            </Card>
                            <Card variant="outlined" sx={{ minWidth: 100 }}>
                              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                                <Typography variant="caption" color="text.secondary">1–30</Typography>
                                <Typography variant="body1">—</Typography>
                              </CardContent>
                            </Card>
                            <Card variant="outlined" sx={{ minWidth: 100 }}>
                              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                                <Typography variant="caption" color="text.secondary">31–60</Typography>
                                <Typography variant="body1">—</Typography>
                              </CardContent>
                            </Card>
                            <Card variant="outlined" sx={{ minWidth: 100 }}>
                              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                                <Typography variant="caption" color="text.secondary">61–90</Typography>
                                <Typography variant="body1">—</Typography>
                              </CardContent>
                            </Card>
                            <Card variant="outlined" sx={{ minWidth: 100 }}>
                              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                                <Typography variant="caption" color="text.secondary">90+</Typography>
                                <Typography variant="body1">—</Typography>
                              </CardContent>
                            </Card>
                          </Box>
                          <TableContainer component={Paper} variant="outlined" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                            <Table size="small">
                              <TableHead>
                                <TableRow sx={{ bgcolor: 'grey.50' }}>
                                  <TableCell sx={{ fontWeight: 600 }}>Invoice #</TableCell>
                                  <TableCell sx={{ fontWeight: 600 }}>Due Date</TableCell>
                                  <TableCell sx={{ fontWeight: 600 }} align="right">Days overdue</TableCell>
                                  <TableCell sx={{ fontWeight: 600 }} align="right">Balance</TableCell>
                                  <TableCell sx={{ fontWeight: 600 }}>Bucket</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {[]}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        </CardContent>
                      </Card>
                    )}

                    {invoicingSubView === 'payments' && (
                      <Card variant="outlined">
                        <CardContent>
                          <Alert severity="info" sx={{ mb: 2 }}>
                            Payments will appear here after sync.
                          </Alert>
                          <TableContainer component={Paper} variant="outlined" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                            <Table size="small">
                              <TableHead>
                                <TableRow sx={{ bgcolor: 'grey.50' }}>
                                  <TableCell sx={{ fontWeight: 600 }}>Payment Date</TableCell>
                                  <TableCell sx={{ fontWeight: 600 }} align="right">Amount</TableCell>
                                  <TableCell sx={{ fontWeight: 600 }}>Reference #</TableCell>
                                  <TableCell sx={{ fontWeight: 600 }}>Applied Invoices</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {[]}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        </CardContent>
                      </Card>
                    )}

                    {invoicingSubView === 'mapping' && (
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>QuickBooks mapping</Typography>
                          {!isConnected && (
                            <>
                              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                Connect QuickBooks to view invoices, balances, and payment activity for this account.
                              </Typography>
                              {canManageQuickBooks && (
                                <Stack direction="row" spacing={2}>
                                  <Button variant="contained" disabled sx={{ textTransform: 'none' }}>Connect QuickBooks</Button>
                                  <Button variant="outlined" disabled sx={{ textTransform: 'none' }}>Map Customer</Button>
                                </Stack>
                              )}
                            </>
                          )}
                          {isConnected && !isMapped && (
                            <>
                              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                This account is not yet linked to a QuickBooks customer. Link an existing customer or create one.
                              </Typography>
                              {canManageQuickBooks && (
                                <Button variant="contained" disabled sx={{ textTransform: 'none' }}>Map Customer</Button>
                              )}
                            </>
                          )}
                          {isMapped && (
                            <>
                              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                Linked to: {qb?.customerDisplayName ?? qb?.customerId ?? '—'}
                              </Typography>
                              {canManageQuickBooks && (
                                <Button variant="outlined" color="error" size="small" disabled sx={{ textTransform: 'none' }}>Disconnect</Button>
                              )}
                            </>
                          )}
                        </CardContent>
                      </Card>
                    )}
                  </Box>
                );
              })()
              )
            }
            </Grid>
            <Grid item xs={12} md={3}>
              <AccountSidebar
                account={account}
                tenantId={tenantId!}
                navigate={navigate}
                updateAccountAssociations={updateAccountAssociations}
                companies={companies}
                locationsByCompany={locationsByCompany}
                contacts={contacts}
                jobOrders={jobOrders}
                deals={deals}
                laborPoolOptions={laborPoolOptions}
                salespeopleOptions={salespeopleOptions}
                recruitersOptions={recruitersOptions}
                accountOptions={accountOptions.filter((a) => a.id !== account.id && a.id !== account.parentAccountId && !(account.childAccountIds || []).includes(a.id))}
                parentAccount={parentAccount}
                childAccounts={childAccounts}
                mspAccounts={mspAccounts}
                onParentAccountChange={updateParentAccountRelationship}
                onChildAccountsChange={updateChildAccountRelationships}
                onMspAccountsChange={updateMspAccountIds}
                optionsLoading={optionsLoading}
                saving={saving}
                visibleSections={[]}
              />
            </Grid>
          </Grid>
        </TabPanel>
        <TabPanel value={tabValue} index={14}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={9}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Set default staff instructions and order details for this account. They flow to child accounts and locations, then to job orders.
              </Typography>
              <Box sx={{ mb: 2 }}>
                <ToggleButtonGroup size="small" value={orderDefaultsSubView} exclusive onChange={(_, v) => v != null && setOrderDefaultsSubView(v)} aria-label="Order defaults view">
                  <ToggleButton value="staffInstructions">Staff Instructions</ToggleButton>
                  <ToggleButton value="orderDetails">Order Details</ToggleButton>
                </ToggleButtonGroup>
              </Box>
              {orderDefaultsSubView === 'staffInstructions' && (
              <Grid container spacing={3}>
                <Grid item xs={12}>
                  <AccountOrderDefaultsCard
                    title="First Day Instructions"
                    fieldKey="firstDay"
                    placeholder="Enter first day instructions (e.g., arrival time, what to bring, who to meet, orientation details...)"
                    uploadPlaceholder="Upload first day schedules, orientation materials, or related documents"
                    account={account}
                    accountId={accountId!}
                    tenantId={tenantId!}
                    userId={user?.uid || ''}
                    onRefresh={loadAccount}
                  />
                </Grid>
                <Grid item xs={12}>
                  <AccountOrderDefaultsCard
                    title="Parking Instructions"
                    fieldKey="parking"
                    placeholder="Enter parking instructions for staff (e.g., where to park, parking pass requirements, visitor parking location...)"
                    uploadPlaceholder="Upload parking maps, diagrams, or related documents"
                    account={account}
                    accountId={accountId!}
                    tenantId={tenantId!}
                    userId={user?.uid || ''}
                    onRefresh={loadAccount}
                  />
                </Grid>
                <Grid item xs={12}>
                  <AccountOrderDefaultsCard
                    title="Check-In Instructions"
                    fieldKey="checkIn"
                    placeholder="Enter check-in instructions (e.g., where to report, who to ask for, required documents...)"
                    uploadPlaceholder="Upload check-in forms, maps, or related documents"
                    account={account}
                    accountId={accountId!}
                    tenantId={tenantId!}
                    userId={user?.uid || ''}
                    onRefresh={loadAccount}
                  />
                </Grid>
                <Grid item xs={12}>
                  <AccountOrderDefaultsCard
                    title="Uniform Instructions"
                    fieldKey="uniform"
                    placeholder="Enter uniform and dress code requirements (e.g., specific colors, safety gear, PPE requirements...)"
                    uploadPlaceholder="Upload uniform photos, dress code guides, or related documents"
                    account={account}
                    accountId={accountId!}
                    tenantId={tenantId!}
                    userId={user?.uid || ''}
                    onRefresh={loadAccount}
                  />
                </Grid>
                <Grid item xs={12}>
                  <AccountOrderDefaultsCard
                    title="Credential Instructions"
                    fieldKey="credentials"
                    placeholder="Enter credential requirements (e.g., badge pickup, wristband issuance, ID requirements...)"
                    uploadPlaceholder="Upload credential forms, badge photos, or related documents"
                    account={account}
                    accountId={accountId!}
                    tenantId={tenantId!}
                    userId={user?.uid || ''}
                    onRefresh={loadAccount}
                  />
                </Grid>
                <Grid item xs={12}>
                  <AccountOrderDefaultsCard
                    title="Other Instructions"
                    fieldKey="other"
                    placeholder="Enter any additional instructions or important information for staff..."
                    uploadPlaceholder="Upload any other relevant documents"
                    account={account}
                    accountId={accountId!}
                    tenantId={tenantId!}
                    userId={user?.uid || ''}
                    onRefresh={loadAccount}
                  />
                </Grid>
                <Grid item xs={12}>
                  <AccountOrderDefaultsCard
                    title="Other Attachments"
                    fieldKey="attachments"
                    placeholder=""
                    uploadPlaceholder="Upload any other relevant documents for job orders under this account"
                    account={account}
                    accountId={accountId!}
                    tenantId={tenantId!}
                    userId={user?.uid || ''}
                    onRefresh={loadAccount}
                  />
                </Grid>
              </Grid>
              )}
              {orderDefaultsSubView === 'orderDetails' && (
                <AccountOrderDetailsForm
                  account={account}
                  accountId={accountId!}
                  tenantId={tenantId!}
                  userId={user?.uid || ''}
                  contacts={contacts}
                  inheritanceParentAccount={orderDefaultsInheritanceParent}
                />
              )}
            </Grid>
            <Grid item xs={12} md={3}>
              <AccountSidebar
                account={account}
                tenantId={tenantId!}
                navigate={navigate}
                updateAccountAssociations={updateAccountAssociations}
                companies={companies}
                locationsByCompany={locationsByCompany}
                contacts={contacts}
                jobOrders={jobOrders}
                deals={deals}
                laborPoolOptions={laborPoolOptions}
                salespeopleOptions={salespeopleOptions}
                recruitersOptions={recruitersOptions}
                accountOptions={accountOptions.filter((a) => a.id !== account.id && a.id !== account.parentAccountId && !(account.childAccountIds || []).includes(a.id))}
                parentAccount={parentAccount}
                childAccounts={childAccounts}
                mspAccounts={mspAccounts}
                onParentAccountChange={updateParentAccountRelationship}
                onChildAccountsChange={updateChildAccountRelationships}
                onMspAccountsChange={updateMspAccountIds}
                optionsLoading={optionsLoading}
                saving={saving}
                visibleSections={[]}
              />
            </Grid>
          </Grid>
        </TabPanel>
        <TabPanel value={tabValue} index={15}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={9}>
              <Card>
                <CardHeader title="Reports" titleTypographyProps={{ variant: 'h6', fontWeight: 600 }} />
                <CardContent sx={{ pt: 0 }}>
                  <Typography variant="body2" color="text.secondary">
                    Reports are scoped for this account (standalone, national, or sub-account). Reusable report components will be added here and in the main Reports layout.
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={3}>
              <AccountSidebar
                account={account}
                tenantId={tenantId!}
                navigate={navigate}
                updateAccountAssociations={updateAccountAssociations}
                companies={companies}
                locationsByCompany={locationsByCompany}
                contacts={contacts}
                jobOrders={jobOrders}
                deals={deals}
                laborPoolOptions={laborPoolOptions}
                salespeopleOptions={salespeopleOptions}
                recruitersOptions={recruitersOptions}
                accountOptions={accountOptions.filter((a) => a.id !== account.id && a.id !== account.parentAccountId && !(account.childAccountIds || []).includes(a.id))}
                parentAccount={parentAccount}
                childAccounts={childAccounts}
                mspAccounts={mspAccounts}
                onParentAccountChange={updateParentAccountRelationship}
                onChildAccountsChange={updateChildAccountRelationships}
                onMspAccountsChange={updateMspAccountIds}
                optionsLoading={optionsLoading}
                saving={saving}
                visibleSections={[]}
              />
            </Grid>
          </Grid>
        </TabPanel>
        <TabPanel value={tabValue} index={16}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={9}>
              <Card>
                <CardHeader title="Activity" titleTypographyProps={{ variant: 'h6', fontWeight: 600 }} />
                <CardContent sx={{ pt: 0 }}>
                  <Typography variant="body2" color="text.secondary">
                    Review recent activity related to this account.
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={3}>
              <AccountSidebar
                account={account}
                tenantId={tenantId!}
                navigate={navigate}
                updateAccountAssociations={updateAccountAssociations}
                companies={companies}
                locationsByCompany={locationsByCompany}
                contacts={contacts}
                jobOrders={jobOrders}
                deals={deals}
                laborPoolOptions={laborPoolOptions}
                salespeopleOptions={salespeopleOptions}
                recruitersOptions={recruitersOptions}
                accountOptions={accountOptions.filter((a) => a.id !== account.id && a.id !== account.parentAccountId && !(account.childAccountIds || []).includes(a.id))}
                parentAccount={parentAccount}
                childAccounts={childAccounts}
                mspAccounts={mspAccounts}
                onParentAccountChange={updateParentAccountRelationship}
                onChildAccountsChange={updateChildAccountRelationships}
                onMspAccountsChange={updateMspAccountIds}
                optionsLoading={optionsLoading}
                saving={saving}
                visibleSections={['activity']}
              />
            </Grid>
          </Grid>
        </TabPanel>
        <TabPanel value={tabValue} index={17}>
          <Box sx={{ py: 1 }}>
            <CRMNotesTab
              entityId={account.id}
              entityType="account"
              entityName={account.name || 'Account'}
              tenantId={tenantId!}
            />
          </Box>
        </TabPanel>
      </Box>

      <AddNoteDialog
        open={showAddNoteDialog}
        onClose={() => setShowAddNoteDialog(false)}
        entityId={account.id}
        entityType="account"
        entityName={account.name || 'Account'}
        tenantId={tenantId!}
        contacts={accountContactsList.map((c) => ({
          id: c.id,
          fullName: c.fullName || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown',
          email: c.email || '',
          title: c.jobTitle || c.title || '',
        }))}
        onNoteAdded={() => setNotesCount((n) => n + 1)}
      />

      {/* Delete upload confirmation */}
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
            onClick={() => deleteConfirmUploadId != null && handleDeleteUpload(deleteConfirmUploadId)}
            color="error"
            variant="contained"
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default RecruiterAccountDetails;

// ---------------------------------------------------------------------------
// AccountRecruitingRolesCard — Phase 3 of docs/RECRUITING_ROLE_MODEL.md.
// Inline editor for account.roles.schedulerIds. Kept colocated with the
// Account page so it sees the already-loaded `recruitersOptions` and
// `account` without prop drilling. Future per-role fields (e.g. payroll
// override at the account level) drop in here too.
// ---------------------------------------------------------------------------

interface AccountRecruitingRolesCardProps {
  tenantId: string | null;
  accountId: string;
  initialSchedulerIds: string[];
  recruiterOptions: RecruiterOption[];
  onSaved: (nextSchedulerIds: string[]) => void;
  /**
   * National parent `roles.schedulerIds` (live snapshot on child accounts).
   * Merged into the control; Firestore persists venue-only additions (IDs not on the parent).
   */
  parentSchedulerIds?: string[];
  /** Persist on each add/remove (no Save button — e.g. Cascading Data tab). */
  autoSave?: boolean;
  /** Card title (default: Recruiting Roles). */
  title?: string;
  /** When set, outlined card + subtitle header styling (Cascading Data panels). */
  cardSx?: SxProps<Theme>;
}

const AccountRecruitingRolesCard: React.FC<AccountRecruitingRolesCardProps> = ({
  tenantId,
  accountId,
  initialSchedulerIds,
  recruiterOptions,
  onSaved,
  parentSchedulerIds,
  autoSave = false,
  title,
  cardSx,
}) => {
  const mergeParentSchedulers = parentSchedulerIds != null;
  const [schedulerIds, setSchedulerIds] = useState<string[]>(initialSchedulerIds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const mergedForUi = useMemo(() => {
    if (!mergeParentSchedulers) return schedulerIds;
    const parentList = parentSchedulerIds ?? [];
    return [...new Set([...parentList, ...schedulerIds])];
  }, [mergeParentSchedulers, parentSchedulerIds, schedulerIds]);

  // Stay in sync when the parent re-renders with a fresh account doc.
  useEffect(() => {
    setSchedulerIds(initialSchedulerIds);
  }, [initialSchedulerIds.join(',')]);

  const dirty = useMemo(() => {
    if (schedulerIds.length !== initialSchedulerIds.length) return true;
    const set = new Set(initialSchedulerIds);
    return schedulerIds.some((id) => !set.has(id));
  }, [schedulerIds, initialSchedulerIds]);

  const persistToFirestore = async (nextIds: string[]) => {
    if (!tenantId || !accountId || saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateDoc(doc(db, p.recruiterAccount(tenantId, accountId)), {
        'roles.schedulerIds': nextIds,
      });
      onSaved(nextIds);
      setSavedAt(Date.now());
    } catch (err: any) {
      setError(err?.message || 'Failed to save recruiting roles');
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const handleSchedulerChange = async (nextFromUi: string[]) => {
    const nextPersisted = mergeParentSchedulers
      ? (() => {
          const parentList = parentSchedulerIds ?? [];
          const merged = [...new Set([...parentList, ...nextFromUi])];
          const parentSet = new Set(parentList);
          return merged.filter((id) => !parentSet.has(id));
        })()
      : nextFromUi;

    if (!autoSave) {
      setSchedulerIds(nextPersisted);
      return;
    }
    const revert = schedulerIds;
    setSchedulerIds(nextPersisted);
    try {
      await persistToFirestore(nextPersisted);
    } catch {
      setSchedulerIds(revert);
    }
  };

  const handleSave = async () => {
    try {
      await persistToFirestore(schedulerIds);
    } catch {
      /* error surfaced in state */
    }
  };

  const heading = title ?? 'Recruiting Roles';

  return (
    <Card variant={cardSx ? 'outlined' : 'elevation'} elevation={cardSx ? 0 : undefined} sx={cardSx}>
      <CardHeader
        title={heading}
        titleTypographyProps={cardSx ? { variant: 'subtitle1', fontWeight: 600 } : undefined}
      />
      <CardContent sx={cardSx ? { pt: 0 } : undefined}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Schedulers picked here own this account's order flow and are stamped
          onto new orders as the Scheduler of record.
          {mergeParentSchedulers
            ? ' National schedulers from the parent account are included automatically and update live; only venue-specific additions are stored on this account.'
            : ''}
        </Typography>
        <RecruiterMultiSelect
          tenantId={tenantId}
          label="Schedulers"
          value={mergeParentSchedulers ? mergedForUi : schedulerIds}
          onChange={(next) => {
            void handleSchedulerChange(next);
          }}
          helperText="Shown on Job Order headers; drives the AccountWorkforce deactivation gate."
          options={recruiterOptions}
          disabled={saving || !tenantId}
        />
        {error ? (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {error}
          </Alert>
        ) : null}
        {!autoSave ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2 }}>
            <Button
              variant="contained"
              onClick={() => void handleSave()}
              disabled={!dirty || saving || !tenantId}
            >
              {saving ? <CircularProgress size={18} /> : 'Save'}
            </Button>
            {savedAt && !dirty ? (
              <Typography variant="caption" color="text.secondary">
                Saved · {new Date(savedAt).toLocaleTimeString()}
              </Typography>
            ) : null}
          </Box>
        ) : null}
      </CardContent>
    </Card>
  );
};
