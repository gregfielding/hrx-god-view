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
} from '@mui/icons-material';
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
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
      {value === index && <Box sx={{ p: 2 }}>{children}</Box>}
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
  optionsLoading: boolean;
  saving: boolean;
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
  optionsLoading,
  saving,
}: AccountSidebarProps) {
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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <SectionCard title="Recent Activity">
        <Typography variant="body2" color="text.secondary">
          No recent activity. Activities will appear here as they occur.
        </Typography>
      </SectionCard>

      <SectionCard
        title="Company"
        titleHref="/companies"
        action={
          <Button
            variant="outlined"
            size="small"
            onClick={() => {}}
            sx={{ minWidth: 'auto', px: 1, py: 0.5, fontSize: '0.75rem', textTransform: 'none' }}
          >
            Edit
          </Button>
        }
      >
        <Autocomplete
          multiple
          size="small"
          options={companies}
          value={selectedCompanies}
          getOptionLabel={(o) => o.label}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          onChange={(_e, v) => updateAccountAssociations({ companyIds: v.map((c) => c.id) })}
          disabled={saving}
          filterOptions={(options, { inputValue }) => {
            const q = (inputValue || '').trim().toLowerCase();
            if (!q) return options;
            return options.filter((o) => (o.label || '').toLowerCase().includes(q));
          }}
          renderInput={(params) => <TextField {...params} placeholder="Search companies..." />}
          renderOption={(props, option) => (
            <li {...props} key={option.id}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <BusinessIcon fontSize="small" />
                {option.label}
              </Box>
            </li>
          )}
        />
        {selectedCompanies.length > 0 && (
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
        )}
      </SectionCard>

      <SectionCard
        title="Worksite / Location"
        titleHref="/companies"
        action={
          <Button
            variant="outlined"
            size="small"
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
            <Autocomplete
              multiple
              size="small"
              options={allLocationOptions}
              value={selectedLocations}
              getOptionLabel={(o) => o.label}
              isOptionEqualToValue={(a, b) => a.companyId === b.companyId && a.locationId === b.locationId}
              onChange={(_e, v) =>
                updateAccountAssociations({
                  locations: v.map((loc) => ({ companyId: loc.companyId, locationId: loc.locationId })),
                })
              }
              disabled={saving}
              filterOptions={(options, { inputValue }) => {
                const q = (inputValue || '').trim().toLowerCase();
                if (!q) return options;
                return options.filter((o) => (o.label || '').toLowerCase().includes(q));
              }}
              renderInput={(params) => <TextField {...params} placeholder="Search locations..." />}
              renderOption={(props, option) => (
                <li {...props} key={`${option.companyId}-${option.locationId}`}>
                  <LocationOnIcon fontSize="small" sx={{ mr: 0.5 }} />
                  {option.label}
                </li>
              )}
            />
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

      <SectionCard
        title="Company Contacts"
        titleHref="/contacts"
        action={
          <Button
            variant="outlined"
            size="small"
            onClick={() => {}}
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
        <Autocomplete
          multiple
          size="small"
          options={contactsInSelectedCompanies}
          value={selectedContactsInScope}
          getOptionLabel={(o) => o.label}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          onChange={(_e, v) => updateAccountAssociations({ contactIds: v.map((c) => c.id) })}
          disabled={saving || companyIds.length === 0}
          renderInput={(params) => <TextField {...params} placeholder="Search contacts..." />}
        />
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

      <SectionCard
        title="Job Order(s)"
        titleHref="/recruiter/job-orders"
        action={
          <Button
            variant="outlined"
            size="small"
            sx={{ minWidth: 'auto', px: 1, py: 0.5, fontSize: '0.75rem', textTransform: 'none' }}
          >
            Edit
          </Button>
        }
      >
        <Autocomplete
          multiple
          size="small"
          options={jobOrders}
          value={selectedJobOrders}
          getOptionLabel={(o) => o.label}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          onChange={(_e, v) => updateAccountAssociations({ jobOrderIds: v.map((j) => j.id) })}
          disabled={saving}
          filterOptions={(options, { inputValue }) => {
            const q = (inputValue || '').trim().toLowerCase();
            if (!q) return options;
            return options.filter((o) => (o.label || '').toLowerCase().includes(q));
          }}
          renderInput={(params) => <TextField {...params} placeholder="Search job orders..." />}
          renderOption={(props, option) => (
            <li {...props} key={option.id}>
              <WorkIcon fontSize="small" sx={{ mr: 0.5 }} />
              {option.label}
            </li>
          )}
        />
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
                onClick={() => navigate(`/recruiter/job-orders/${j.id}`)}
                role="button"
                tabIndex={0}
              >
                <WorkIcon fontSize="small" />
                <Typography variant="body2">{j.label}</Typography>
                <Button
                  component={Link}
                  to={`/recruiter/job-orders/${j.id}`}
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

      <SectionCard
        title="Deal"
        titleHref="/crm"
        action={
          <Button
            variant="outlined"
            size="small"
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
            <Autocomplete
              multiple
              size="small"
              options={dealsInSelectedCompanies}
              value={selectedDealsInScope}
              getOptionLabel={(o) => o.label}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              onChange={(_e, v) => updateAccountAssociations({ dealIds: v.map((d) => d.id) })}
              disabled={saving}
              filterOptions={(options, { inputValue }) => {
                const q = (inputValue || '').trim().toLowerCase();
                if (!q) return options;
                return options.filter((o) => (o.label || '').toLowerCase().includes(q));
              }}
              renderInput={(params) => <TextField {...params} placeholder="Search deals..." />}
              renderOption={(props, option) => (
                <li {...props} key={option.id}>
                  <AttachMoneyIcon fontSize="small" sx={{ mr: 0.5 }} />
                  {option.label}
                </li>
              )}
            />
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

      <SectionCard
        title="Assigned Salesperson(s)"
        titleHref="/users"
        action={
          <Button
            variant="outlined"
            size="small"
            sx={{ minWidth: 'auto', px: 1, py: 0.5, fontSize: '0.75rem', textTransform: 'none' }}
          >
            Edit
          </Button>
        }
      >
        <Autocomplete
          multiple
          size="small"
          options={salespeopleOptions}
          value={selectedSalespeople}
          getOptionLabel={(o) => o.label}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          onChange={(_e, v) => updateAccountAssociations({ salespersonIds: v.map((p) => p.id) })}
          disabled={saving}
          filterOptions={(options, { inputValue }) => {
            const q = (inputValue || '').trim().toLowerCase();
            if (!q) return options;
            return options.filter((o) => (o.label || '').toLowerCase().includes(q));
          }}
          renderInput={(params) => <TextField {...params} placeholder="Search salespeople..." />}
          renderOption={(props, option) => (
            <li {...props} key={option.id}>
              <SellIcon fontSize="small" sx={{ mr: 0.5 }} />
              {option.label}
            </li>
          )}
        />
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

      <SectionCard
        title="Assigned Recruiter(s)"
        titleHref="/recruiter/accounts"
        action={
          <Button
            variant="outlined"
            size="small"
            sx={{ minWidth: 'auto', px: 1, py: 0.5, fontSize: '0.75rem', textTransform: 'none' }}
          >
            Edit
          </Button>
        }
      >
        <Autocomplete
          multiple
          size="small"
          options={recruitersOptions}
          value={selectedRecruiters}
          getOptionLabel={(o) => o.label}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          onChange={(_e, v) => updateAccountAssociations({ recruiterIds: v.map((p) => p.id) })}
          disabled={saving}
          filterOptions={(options, { inputValue }) => {
            const q = (inputValue || '').trim().toLowerCase();
            if (!q) return options;
            return options.filter((o) => (o.label || '').toLowerCase().includes(q));
          }}
          renderInput={(params) => <TextField {...params} placeholder="Search recruiters..." />}
          renderOption={(props, option) => (
            <li {...props} key={option.id}>
              <BadgeIcon fontSize="small" sx={{ mr: 0.5 }} />
              {option.label}
            </li>
          )}
        />
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

      <SectionCard
        title="Labor Pool"
        titleHref="/users/user-groups"
        action={
          <Button
            variant="outlined"
            size="small"
            sx={{ minWidth: 'auto', px: 1, py: 0.5, fontSize: '0.75rem', textTransform: 'none' }}
          >
            Edit
          </Button>
        }
      >
        <Autocomplete
          multiple
          size="small"
          options={laborPoolOptions}
          value={selectedLaborPool}
          groupBy={(o) => (o.type === 'userGroup' ? 'User Groups' : 'Smart Groups')}
          getOptionLabel={(o) => `${o.label} (${o.type === 'userGroup' ? 'User Group' : 'Smart Group'})`}
          isOptionEqualToValue={(a, b) => a.id === b.id && a.type === b.type}
          onChange={(_e, v) => {
            updateAccountAssociations({
              userGroupIds: v.filter((o) => o.type === 'userGroup').map((o) => o.id),
              savedSmartGroupIds: v.filter((o) => o.type === 'savedSmartGroup').map((o) => o.id),
            });
          }}
          disabled={saving}
          filterOptions={(options, { inputValue }) => {
            const q = (inputValue || '').trim().toLowerCase();
            if (!q) return options;
            return options.filter((o) => (o.label || '').toLowerCase().includes(q));
          }}
          renderInput={(params) => <TextField {...params} placeholder="Search user groups & smart groups..." />}
          renderOption={(props, option) => (
            <li {...props} key={`${option.type}-${option.id}`}>
              <GroupWorkIcon fontSize="small" sx={{ mr: 0.5 }} />
              {option.label}
              <Chip size="small" label={option.type === 'userGroup' ? 'User Group' : 'Smart Group'} sx={{ ml: 0.5 }} />
            </li>
          )}
        />
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
        contactsSnap,
        jobOrdersSnap,
        dealsSnap,
        userGroupsSnap,
        savedSmartSnap,
        usersSnap,
      ] = await Promise.all([
        getDocs(query(collection(db, 'tenants', tenantId, 'crm_companies'), orderBy('companyName', 'asc'))),
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

  const hasHeaderAssociations =
    associatedCompanies.length > 0 ||
    associatedLocations.length > 0 ||
    associatedContacts.length > 0 ||
    associatedJobOrders.length > 0 ||
    associatedDeals.length > 0 ||
    associatedSalespeople.length > 0 ||
    associatedRecruiters.length > 0;

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
      to: `/recruiter/job-orders/${j.id}`,
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
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
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
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Button
              onClick={() => setTabValue(0)}
              variant="text"
              startIcon={<DashboardIcon fontSize="small" />}
              sx={{
                textTransform: 'none',
                borderRadius: '999px',
                fontSize: '14px',
                fontWeight: tabValue === 0 ? 500 : 400,
                color: tabValue === 0 ? 'white' : 'rgba(0, 0, 0, 0.7)',
                bgcolor: tabValue === 0 ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                px: 1.5,
                py: 0.75,
                minWidth: 'auto',
                whiteSpace: 'nowrap',
                '&:hover': {
                  bgcolor: tabValue === 0 ? '#004a9f' : 'rgba(0, 0, 0, 0.08)',
                },
              }}
            >
              Overview
            </Button>
          </Box>
        }
        rightActions={
          <Button
            variant="outlined"
            startIcon={<ArrowBackIcon />}
            onClick={() => navigate('/recruiter/accounts')}
            sx={{
              textTransform: 'none',
              borderRadius: '24px',
              height: '40px',
              px: 2,
              whiteSpace: 'nowrap',
            }}
          >
            Back
          </Button>
        }
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
                optionsLoading={optionsLoading}
                saving={saving}
              />
            </Grid>
          </Grid>
        </TabPanel>
      </Box>
    </Box>
  );
};

export default RecruiterAccountDetails;
