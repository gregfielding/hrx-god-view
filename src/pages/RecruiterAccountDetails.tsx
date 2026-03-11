/**
 * Recruiter Account Details – Record layout for a single account.
 * Follows the same Record spec as Company/User/Deal: PageHeader, tabs, and 3rd column association widgets.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
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
  ListItemText,
  ListItemSecondaryAction,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
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
} from 'firebase/firestore';

import { db } from '../firebase';
import { getDealCompanyIds } from '../utils/associationsAdapter';
import { useAuth } from '../contexts/AuthContext';
import { p } from '../data/firestorePaths';
import type {
  RecruiterAccount,
  RecruiterAccountAssociations,
  AccountLocationRef,
} from '../types/recruiter/account';
import PageHeader from '../components/PageHeader';
import FavoriteButton from '../components/FavoriteButton';
import { useFavorites } from '../hooks/useFavorites';

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
}) => {
  const [selectedOption, setSelectedOption] = useState<ManageDialogOption | null>(null);

  useEffect(() => {
    if (!open) setSelectedOption(null);
  }, [open]);

  const availableToAdd = availableOptions.filter((option) => !currentItems.some((item) => item.id === option.id));

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
            {availableToAdd.length > 0 ? (
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}>
                <Autocomplete
                  fullWidth
                  options={availableToAdd}
                  groupBy={groupBy}
                  value={selectedOption}
                  onChange={(_, newValue) => setSelectedOption(newValue)}
                  getOptionLabel={(option) => [option.label, option.secondary].filter(Boolean).join(' · ') || 'Unknown'}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label={selectionLabel}
                      placeholder={selectionPlaceholder}
                    />
                  )}
                  renderOption={(props, option) => (
                    <li {...props}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {option.icon ? option.icon : <Avatar sx={{ width: 24, height: 24, fontSize: '0.75rem' }}>{option.label?.charAt(0) || '?'}</Avatar>}
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
                  )}
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
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`account-tabpanel-${index}`}
      aria-labelledby={`account-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ px: 2, pb: 2 }}>{children}</Box>}
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
  onParentAccountChange: (parentAccountId: string | null) => Promise<void>;
  onChildAccountsChange: (childAccountIds: string[]) => Promise<void>;
  optionsLoading: boolean;
  saving: boolean;
  visibleSections?: Array<'activity' | 'company' | 'parentAccount' | 'childAccounts' | 'location' | 'contacts' | 'jobOrders' | 'deals' | 'salespeople' | 'recruiters' | 'laborPool' | 'jobsBoard'>;
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
  onParentAccountChange,
  onChildAccountsChange,
  optionsLoading,
  saving,
  visibleSections = ['activity', 'company', 'parentAccount', 'childAccounts', 'location', 'contacts', 'jobOrders', 'deals', 'salespeople', 'recruiters', 'laborPool'],
}: AccountSidebarProps) {
  const [manageCompaniesOpen, setManageCompaniesOpen] = useState(false);
  const [manageLocationsOpen, setManageLocationsOpen] = useState(false);
  const [manageContactsOpen, setManageContactsOpen] = useState(false);
  const [manageJobOrdersOpen, setManageJobOrdersOpen] = useState(false);
  const [manageDealsOpen, setManageDealsOpen] = useState(false);
  const [manageSalespeopleOpen, setManageSalespeopleOpen] = useState(false);
  const [manageRecruitersOpen, setManageRecruitersOpen] = useState(false);
  const [manageLaborPoolOpen, setManageLaborPoolOpen] = useState(false);
  const [manageParentAccountOpen, setManageParentAccountOpen] = useState(false);
  const [manageChildAccountsOpen, setManageChildAccountsOpen] = useState(false);

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
  // Contacts from all selected companies (e.g. MSP + end-customer)
  const contactsInSelectedCompanies = companyIds.length === 0 ? [] : contacts.filter((c) => c.companyId && companyIds.includes(c.companyId));
  const selectedContacts = contacts.filter((c) => contactIds.includes(c.id));
  const selectedContactsInScope = selectedContacts.filter((c) => contactsInSelectedCompanies.some((o) => o.id === c.id));
  // Locations from all selected companies (e.g. MSP + end-customer)
  const allLocationOptions: LocationOption[] = companyIds.flatMap((cid) => locationsByCompany[cid] ?? []);
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
  const parentAccountItems: ManageDialogOption[] = parentAccount ? [{ id: parentAccount.id, label: parentAccount.label, icon: <BusinessIcon fontSize="small" /> }] : [];
  const parentAccountOptions: ManageDialogOption[] = accountOptions.map((a) => ({ id: a.id, label: a.label, icon: <BusinessIcon fontSize="small" /> }));
  const childAccountItems: ManageDialogOption[] = childAccounts.map((a) => ({ id: a.id, label: a.label, icon: <BusinessIcon fontSize="small" /> }));
  const childAccountOptions: ManageDialogOption[] = accountOptions.map((a) => ({ id: a.id, label: a.label, icon: <BusinessIcon fontSize="small" /> }));
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

      {showSection('parentAccount') && (
      <SectionCard
        title="Parent Account"
        titleHref="/accounts"
        action={
          <Button
            variant="outlined"
            size="small"
            onClick={() => setManageParentAccountOpen(true)}
            sx={{ minWidth: 'auto', px: 1, py: 0.5, fontSize: '0.75rem', textTransform: 'none' }}
          >
            Edit
          </Button>
        }
      >
        {parentAccount ? (
          <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'grey.50', cursor: 'pointer' }}
            onClick={() => navigate(`/accounts/${parentAccount.id}`)}
            role="button"
            tabIndex={0}
          >
            <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem' }}>{parentAccount.label.charAt(0)}</Avatar>
            <Typography variant="body2" fontWeight="medium">{parentAccount.label}</Typography>
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No parent account linked.
          </Typography>
        )}
      </SectionCard>
      )}

      {showSection('childAccounts') && (
      <SectionCard
        title="Child Accounts"
        titleHref="/accounts"
        action={
          <Button
            variant="outlined"
            size="small"
            onClick={() => setManageChildAccountsOpen(true)}
            sx={{ minWidth: 'auto', px: 1, py: 0.5, fontSize: '0.75rem', textTransform: 'none' }}
          >
            Edit
          </Button>
        }
      >
        {childAccounts.length > 0 ? (
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {childAccounts.map((a) => (
              <Box
                key={a.id}
                sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'grey.50', cursor: 'pointer' }}
                onClick={() => navigate(`/accounts/${a.id}`)}
                role="button"
                tabIndex={0}
              >
                <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem' }}>{a.label.charAt(0)}</Avatar>
                <Typography variant="body2" fontWeight="medium">{a.label}</Typography>
              </Box>
            ))}
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No child accounts linked.
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
        {companyIds.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Select at least one company to add locations.
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
                      onClick={() => navigate(`/companies/${loc.companyId}/locations/${loc.locationId}`)}
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
                        to={`/companies/${loc.companyId}/locations/${loc.locationId}`}
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
        title="Company Contacts"
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
        {companyIds.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Select at least one company to add contacts.
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

      <ManageAssociationDialog
        open={manageParentAccountOpen}
        onClose={() => setManageParentAccountOpen(false)}
        title="Parent Account"
        currentItems={parentAccountItems}
        availableOptions={parentAccountOptions}
        selectionLabel="Select Parent Account"
        selectionPlaceholder="Search accounts..."
        onAdd={(item) => { void onParentAccountChange(item.id); }}
        onRemove={() => { void onParentAccountChange(null); }}
      />
      <ManageAssociationDialog
        open={manageChildAccountsOpen}
        onClose={() => setManageChildAccountsOpen(false)}
        title="Child Accounts"
        currentItems={childAccountItems}
        availableOptions={childAccountOptions}
        selectionLabel="Select Child Account"
        selectionPlaceholder="Search accounts..."
        onAdd={(item) => { void onChildAccountsChange(Array.from(new Set([...childAccounts.map((a) => a.id), item.id]))); }}
        onRemove={(id) => { void onChildAccountsChange(childAccounts.map((a) => a.id).filter((childId) => childId !== id)); }}
      />
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
type LaborPoolOption = { id: string; label: string; type: 'userGroup' | 'savedSmartGroup' };
type PersonOption = { id: string; label: string };
type AccountOption = { id: string; label: string };

const RecruiterAccountDetails: React.FC = () => {
  const { accountId } = useParams<{ accountId: string }>();
  const { tenantId, user } = useAuth();
  const navigate = useNavigate();
  const { isFavorite, toggleFavorite } = useFavorites('accounts');

  const [account, setAccount] = useState<RecruiterAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tabValue, setTabValue] = useState(0);
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [saving, setSaving] = useState(false);

  // Option lists for autocompletes
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [locationsByCompany, setLocationsByCompany] = useState<Record<string, LocationOption[]>>({});
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [jobOrders, setJobOrders] = useState<JobOrderOption[]>([]);
  const [deals, setDeals] = useState<DealOption[]>([]);
  const [laborPoolOptions, setLaborPoolOptions] = useState<LaborPoolOption[]>([]);
  const [salespeopleOptions, setSalespeopleOptions] = useState<PersonOption[]>([]);
  const [recruitersOptions, setRecruitersOptions] = useState<PersonOption[]>([]);
  const [accountOptions, setAccountOptions] = useState<AccountOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (accountId && tenantId) {
      loadAccount();
    }
  }, [accountId, tenantId]);

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
        usersSnap,
      ] = await Promise.all([
        getDocs(query(collection(db, 'tenants', tenantId, 'crm_companies'), orderBy('companyName', 'asc'))),
        getDocs(query(collection(db, p.recruiterAccounts(tenantId)), orderBy('name', 'asc'))),
        getDocs(collection(db, 'tenants', tenantId, 'crm_contacts')),
        getDocs(query(collection(db, p.jobOrders(tenantId)), orderBy('createdAt', 'desc'))),
        getDocs(query(collection(db, 'tenants', tenantId, 'crm_deals'), orderBy('createdAt', 'desc'))),
        getDocs(collection(db, 'tenants', tenantId, 'userGroups')),
        getDocs(collection(db, 'tenants', tenantId, 'savedSmartGroups')),
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
        const key = `userGroup-${d.id}`;
        if (!ugMap.has(key)) ugMap.set(key, { id: d.id, label, type: 'userGroup' });
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
        sgMap.set(d.id, { id: d.id, label, type: 'savedSmartGroup' });
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
      setAccount({
        id: snap.id,
        name: data?.name ?? '',
        active: data?.active !== false,
        parentAccountId: data?.parentAccountId ?? null,
        childAccountIds: Array.isArray(data?.childAccountIds) ? data.childAccountIds : [],
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
      });
    } catch (err) {
      if (!isMountedRef.current) return;
      console.error('RecruiterAccountDetails: load error', err);
      setError('Failed to load account');
      setAccount(null);
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  };

  const updateAccountAssociations = async (partial: Partial<RecruiterAccountAssociations>) => {
    if (!accountId || !tenantId || !account) return;
    const next = { ...account.associations, ...partial };
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
    } catch (err) {
      console.error('RecruiterAccountDetails: update error', err);
    } finally {
      setSaving(false);
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
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/recruiter/accounts')} sx={{ mt: 2 }}>
          Back to Accounts
        </Button>
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

  const headerAssociationItems = [
    ...associatedCompanies.map((c) => ({
      key: `company-${c.id}`,
      label: c.label,
      icon: <BusinessIcon sx={{ fontSize: 16, color: 'rgba(0,0,0,0.45)' }} />,
      to: `/companies/${c.id}`,
    })),
    ...associatedLocations.map((loc) => ({
      key: `location-${loc.companyId}-${loc.locationId}`,
      label: loc.label,
      icon: <LocationOnIcon sx={{ fontSize: 16, color: 'rgba(0,0,0,0.45)' }} />,
      to: `/companies/${loc.companyId}/locations/${loc.locationId}`,
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
      icon: <BusinessIcon sx={{ fontSize: 16, color: 'rgba(0,0,0,0.45)' }} />,
      to: `/accounts/${a.id}`,
    })),
  ];

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <PageHeader
        title={
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2.5 }}>
            <Avatar
              sx={{
                width: 108,
                height: 108,
                bgcolor: 'primary.main',
                fontSize: '40px',
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {initial}
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 0, minHeight: 108, display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, width: '100%' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: 1 }}>
                  <Typography
                    variant="h6"
                    sx={{
                      fontSize: { xs: '20px', md: '24px' },
                      fontWeight: 600,
                      lineHeight: 1.2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      minWidth: 0,
                    }}
                  >
                    {displayName}
                  </Typography>
                  {account.id && (
                    <FavoriteButton
                      itemId={account.id}
                      favoriteType="accounts"
                      isFavorite={isFavorite}
                      toggleFavorite={toggleFavorite}
                      size="small"
                    />
                  )}
                </Box>
                <Button
                  variant="outlined"
                  startIcon={<ArrowBackIcon />}
                  onClick={() => navigate('/accounts')}
                  sx={{
                    textTransform: 'none',
                    borderRadius: '24px',
                    height: '40px',
                    px: 2,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  Back
                </Button>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 0.75, flexWrap: 'wrap' }}>
                <Chip
                  label={account.active ? 'Active' : 'Inactive'}
                  color={account.active ? 'success' : 'default'}
                  size="small"
                  variant={account.active ? 'filled' : 'outlined'}
                  sx={{ fontWeight: 500 }}
                />
              </Box>
              {hasHeaderAssociations && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mt: 1, flexWrap: 'wrap' }}>
                  {headerAssociationItems.map((item) => (
                    <Box
                      key={item.key}
                      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}
                    >
                      {item.icon}
                      <Typography
                        component="span"
                        sx={{
                          color: 'rgb(74, 144, 226)',
                          cursor: 'pointer',
                          fontWeight: 600,
                          fontSize: '0.875rem',
                          lineHeight: 1.2,
                          '&:hover': { textDecoration: 'underline' },
                        }}
                        onClick={() => navigate(item.to)}
                      >
                        {item.label}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          </Box>
        }
        filters={
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
                Company Details
              </Button>
              <Button
                variant={tabValue === 1 ? 'contained' : 'text'}
                onClick={() => setTabValue(1)}
                startIcon={<AttachMoneyIcon fontSize="small" />}
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
                Pricing
              </Button>
              <Button
                variant={tabValue === 2 ? 'contained' : 'text'}
                onClick={() => setTabValue(2)}
                startIcon={<WorkIcon fontSize="small" />}
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
                Job Orders
              </Button>
              <Button
                variant={tabValue === 3 ? 'contained' : 'text'}
                onClick={() => setTabValue(3)}
                startIcon={<BadgeIcon fontSize="small" />}
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
                Jobs Board
              </Button>
              <Button
                variant={tabValue === 4 ? 'contained' : 'text'}
                onClick={() => setTabValue(4)}
                startIcon={<GroupWorkIcon fontSize="small" />}
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
                Labor Pool
              </Button>
              <Button
                variant={tabValue === 5 ? 'contained' : 'text'}
                onClick={() => setTabValue(5)}
                startIcon={<DashboardIcon fontSize="small" />}
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
                Activity
              </Button>
            </Box>
          </Box>
        }
        showDivider={false}
      />

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', pb: 2 }}>
        <TabPanel value={tabValue} index={0}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={9}>
              <Card>
                <CardHeader
                  title="Account Details"
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
                      <TextField
                        label="Account Name"
                        defaultValue={account.name}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== account.name) updateAccountField('name', v);
                        }}
                        size="small"
                        fullWidth
                        autoFocus
                      />
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
                    </Box>
                  ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <BusinessIcon sx={{ color: 'text.secondary', fontSize: 20 }} />
                        <Typography variant="body1" fontWeight={500}>
                          {account.name || '—'}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" color="text.secondary">
                          Status:
                        </Typography>
                        <Chip
                          label={account.active ? 'Active' : 'Inactive'}
                          color={account.active ? 'success' : 'default'}
                          size="small"
                          variant={account.active ? 'filled' : 'outlined'}
                        />
                      </Box>
                      {account.createdAt && (
                        <Typography variant="caption" color="text.secondary">
                          Created {account.createdAt?.toDate?.()?.toLocaleString?.() ?? '—'}
                        </Typography>
                      )}
                    </Box>
                  )}
                </CardContent>
              </Card>
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
                onParentAccountChange={updateParentAccountRelationship}
                onChildAccountsChange={updateChildAccountRelationships}
                optionsLoading={optionsLoading}
                saving={saving}
                visibleSections={['company', 'parentAccount', 'childAccounts', 'location', 'contacts']}
              />
            </Grid>
          </Grid>
        </TabPanel>
        <TabPanel value={tabValue} index={1}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={9}>
              <Card>
                <CardHeader title="Pricing" titleTypographyProps={{ variant: 'h6', fontWeight: 600 }} />
                <CardContent sx={{ pt: 0 }}>
                  <Typography variant="body2" color="text.secondary">
                    Use linked CRM deals and assigned internal owners to track the pricing context for this account.
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
                onParentAccountChange={updateParentAccountRelationship}
                onChildAccountsChange={updateChildAccountRelationships}
                optionsLoading={optionsLoading}
                saving={saving}
                visibleSections={['deals', 'salespeople', 'recruiters']}
              />
            </Grid>
          </Grid>
        </TabPanel>
        <TabPanel value={tabValue} index={2}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={9}>
              <Card>
                <CardHeader title="Job Orders" titleTypographyProps={{ variant: 'h6', fontWeight: 600 }} />
                <CardContent sx={{ pt: 0 }}>
                  <Typography variant="body2" color="text.secondary">
                    Manage the job orders connected to this account.
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
                onParentAccountChange={updateParentAccountRelationship}
                onChildAccountsChange={updateChildAccountRelationships}
                optionsLoading={optionsLoading}
                saving={saving}
                visibleSections={['jobOrders']}
              />
            </Grid>
          </Grid>
        </TabPanel>
        <TabPanel value={tabValue} index={3}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={9}>
              <Card>
                <CardHeader title="Jobs Board" titleTypographyProps={{ variant: 'h6', fontWeight: 600 }} />
                <CardContent sx={{ pt: 0 }}>
                  <Typography variant="body2" color="text.secondary">
                    View and manage job post relationships for this account.
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
                onParentAccountChange={updateParentAccountRelationship}
                onChildAccountsChange={updateChildAccountRelationships}
                optionsLoading={optionsLoading}
                saving={saving}
                visibleSections={['jobsBoard']}
              />
            </Grid>
          </Grid>
        </TabPanel>
        <TabPanel value={tabValue} index={4}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={9}>
              <Card>
                <CardHeader title="Labor Pool" titleTypographyProps={{ variant: 'h6', fontWeight: 600 }} />
                <CardContent sx={{ pt: 0 }}>
                  <Typography variant="body2" color="text.secondary">
                    Attach user groups and smart groups that define the labor pool for this account.
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
                onParentAccountChange={updateParentAccountRelationship}
                onChildAccountsChange={updateChildAccountRelationships}
                optionsLoading={optionsLoading}
                saving={saving}
                visibleSections={['laborPool']}
              />
            </Grid>
          </Grid>
        </TabPanel>
        <TabPanel value={tabValue} index={5}>
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
                onParentAccountChange={updateParentAccountRelationship}
                onChildAccountsChange={updateChildAccountRelationships}
                optionsLoading={optionsLoading}
                saving={saving}
                visibleSections={['activity']}
              />
            </Grid>
          </Grid>
        </TabPanel>
      </Box>
    </Box>
  );
};

export default RecruiterAccountDetails;
