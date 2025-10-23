import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardHeader,
  Grid,
  Chip,
  Button,
  IconButton,
  CircularProgress,
  Paper,
  Tabs,
  Tab,
  Badge,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Autocomplete,
  Avatar,
  Snackbar,
  Alert,
  FormHelperText,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  FormControlLabel,
  Switch,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Collapse,
  Skeleton,
  Checkbox,
  List,
  ListItem,
  ListItemText,
  InputAdornment,
} from '@mui/material';
import {
  Phone as PhoneIcon,
  Add as AddIcon,
  LocationOn as LocationIcon,
  Language as LanguageIcon,
  Work as WorkIcon,
  AttachMoney as DealIcon,
  Person as PersonIcon,
  Dashboard as DashboardIcon,
  Place as PlaceIcon,
  AttachMoney as OpportunitiesIcon,
  Notes as NotesIcon,
  LinkedIn as LinkedInIcon,
  SmartToy as AIIcon,
  CloudUpload as UploadIcon,
  Delete as DeleteIcon,
  Facebook as FacebookIcon,
  Twitter as TwitterIcon,
  Refresh as RefreshIcon,
  OpenInNew as OpenInNewIcon,
  LocationOn as LocationOnIcon,
  Visibility,
  Security as SecurityIcon,
  AccessTime as TimeClockIcon,
  Receipt as BillingIcon,
  AttachFile as ContractsIcon,
  Edit as EditIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  Business as BusinessIcon,
  Event as EventIcon,
  Email as EmailIcon,
  Close as CloseIcon,
  RocketLaunch as RocketLaunchIcon,
  AccountTree as AccountTreeIcon,
  CheckCircle as CheckCircleIcon,
  Search as SearchIcon,
  Clear as ClearIcon,
  ArrowUpward as ArrowUpwardIcon,
  ArrowDownward as ArrowDownwardIcon,
} from '@mui/icons-material';
import { Autocomplete as GoogleAutocomplete } from '@react-google-maps/api';
import {
  collection,
  doc,
  getDoc,
  query,
  where,
  orderBy,
  getDocs,
  updateDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  limit,
  startAfter,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';

import { db, storage, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import IndustrySelector from '../components/IndustrySelector';
import { geocodeAddress } from '../utils/geocodeAddress';
import { INDUSTRIES, getIndustriesByCategory, getIndustryByCode } from '../data/industries';
import AIEnrichmentWidget from '../components/AIEnrichmentWidget';
import DecisionMakersPanel from '../components/DecisionMakersPanel';
import CRMNotesTab from '../components/CRMNotesTab';
import { getStageHexColor, getTextContrastColor } from '../utils/crmStageColors';
import AIAssistantChat from '../components/AIAssistantChat';
import AddNoteDialog from '../components/AddNoteDialog';
import DealAgeChip from '../components/DealAgeChip';
import HealthBadge from '../components/HealthBadge';
import { calculateDealHealth, calculateDealAge } from '../utils/dealHealthCalculator';
import FavoriteButton from '../components/FavoriteButton';
import { useFavorites } from '../hooks/useFavorites';


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
      id={`company-tabpanel-${index}`}
      aria-labelledby={`company-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ p: 0 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

const RecruiterCompanyDetails: React.FC = () => {
  const { companyId } = useParams<{ companyId: string }>();
  const { tenantId, currentUser } = useAuth();
  const navigate = useNavigate();

  // Favorites
  const { isFavorite, toggleFavorite } = useFavorites('companies');

  const [company, setCompany] = useState<any>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [jobPostings, setJobPostings] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tabValue, setTabValue] = useState(0);
  
  // Get active tab from URL parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const activeTab = urlParams.get('tab');
    if (activeTab !== null) {
      const tabIndex = parseInt(activeTab);
      if (tabIndex >= 0 && tabIndex <= 8) {
        setTabValue(tabIndex);
      }
    }
  }, []);

  const [salespeople, setSalespeople] = useState<any[]>([]);
  const [salespeopleLoading, setSalespeopleLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [logoLoading, setLogoLoading] = useState(false);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string>('');
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [companyContextOpen, setCompanyContextOpen] = useState(false);
  const [aiComponentsLoaded, setAiComponentsLoaded] = useState(false);

  // Load company data
  useEffect(() => {
    if (companyId && tenantId) {
      loadCompanyData();
    }
  }, [companyId, tenantId]);

  const loadCompanyData = async () => {
    if (!companyId || !tenantId) return;

    try {
      setLoading(true);
      setError(null);

      // Load company
      const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId);
      const companySnap = await getDoc(companyRef);
      
      if (!companySnap.exists()) {
        setError('Company not found');
        return;
      }

      const companyData = {
        id: companySnap.id,
        ...companySnap.data()
      };
      setCompany(companyData);

      // Load related data in parallel (deals loading is optional for recruiters)
      await Promise.all([
        loadContacts(),
        loadJobPostings(),
        loadLocations(),
        loadSalespeople(),
        loadTenantName()
      ]);
      
      // Try to load deals, but don't fail if permissions are insufficient
      try {
        await loadDeals();
      } catch (error) {
        console.warn('Could not load deals (insufficient permissions):', error);
        // Continue without deals data
      }

    } catch (error) {
      console.error('Error loading company data:', error);
      setError('Failed to load company data');
    } finally {
      setLoading(false);
    }
  };

  const loadContacts = async () => {
    if (!companyId || !tenantId) return;

    try {
      const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
      const q = query(
        contactsRef,
        where('companyId', '==', companyId),
        orderBy('firstName', 'asc')
      );
      const snapshot = await getDocs(q);
      const contactsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setContacts(contactsData);
    } catch (error) {
      console.error('Error loading contacts:', error);
    }
  };

  const loadLocations = async () => {
    if (!companyId || !tenantId) return;

    try {
      const locationsRef = collection(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations');
      const q = query(locationsRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      const locationsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setLocations(locationsData);
    } catch (error) {
      console.error('Error loading locations:', error);
    }
  };

  const loadDeals = async () => {
    if (!companyId || !tenantId) return;

    try {
      const dealsRef = collection(db, 'tenants', tenantId, 'deals');
      const q = query(
        dealsRef,
        where('companyId', '==', companyId),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDocs(q);
      const dealsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setDeals(dealsData);
    } catch (error) {
      console.error('Error loading deals:', error);
    }
  };

  const loadJobPostings = async () => {
    if (!companyId || !tenantId) return;

    try {
      setJobsLoading(true);
      const jobPostingsRef = collection(db, 'tenants', tenantId, 'job_postings');
      const q = query(
        jobPostingsRef,
        where('companyId', '==', companyId),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDocs(q);
      const jobPostingsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setJobPostings(jobPostingsData);
    } catch (error) {
      console.error('Error loading job postings:', error);
    } finally {
      setJobsLoading(false);
    }
  };

  const loadSalespeople = async () => {
    if (!tenantId) return;

    try {
      setSalespeopleLoading(true);
      const usersRef = collection(db, 'users');
      const q = query(
        usersRef,
        where(`tenantIds.${tenantId}.role`, 'in', ['Salesperson', 'Manager', 'Admin'])
      );
      const snapshot = await getDocs(q);
      const salespeopleData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setSalespeople(salespeopleData);
    } catch (error) {
      console.error('Error loading salespeople:', error);
    } finally {
      setSalespeopleLoading(false);
    }
  };

  const loadTenantName = async () => {
    if (!tenantId) return;

    try {
      const tenantRef = doc(db, 'tenants', tenantId);
      const tenantSnap = await getDoc(tenantRef);
      if (tenantSnap.exists()) {
        const tenantData = tenantSnap.data();
        setTenantName(tenantData?.tenantName || '');
      }
    } catch (error) {
      console.error('Error loading tenant name:', error);
    }
  };

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
    // Update URL with tab parameter
    const url = new URL(window.location.href);
    url.searchParams.set('tab', newValue.toString());
    window.history.replaceState({}, '', url.toString());
  };

  if (loading) {
    return (
      <Box sx={{ p: 0 }}>
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
            <Skeleton variant="circular" width={128} height={128} />
            <Box sx={{ flex: 1 }}>
              <Skeleton variant="text" width={300} height={40} />
              <Skeleton variant="text" width={200} height={24} />
            </Box>
          </Box>
        </Box>
        <Skeleton variant="rectangular" width="100%" height={400} />
      </Box>
    );
  }

  if (error || !company) {
    return (
      <Box sx={{ p: 0 }}>
        <Alert severity="error">
          {error || 'Company not found'}
        </Alert>
        <Button onClick={() => navigate('/recruiter/companies')} sx={{ mt: 2 }}>
          Back to Companies
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0 }}>
      {/* Enhanced Header - Persistent Company Information */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
            {/* Company Logo/Avatar */}
            <Box sx={{ position: 'relative' }}>
              <Avatar
                src={company.logo || company.logoUrl || company.logo_url || company.avatar}
                alt={company.companyName || company.name}
                sx={{ 
                  width: 128, 
                  height: 128,
                  bgcolor: 'primary.main',
                  fontSize: '2rem',
                  fontWeight: 'bold'
                }}
              >
                {(company.companyName || company.name || 'C').charAt(0).toUpperCase()}
              </Avatar>
            </Box>
            
            {/* Company Info */}
            <Box sx={{ flex: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                <Typography variant="h4" sx={{ fontWeight: 600 }}>
                  {company.companyName || company.name || 'Unnamed Company'}
                </Typography>
                <FavoriteButton
                  itemId={company.id}
                  favoriteType="companies"
                  isFavorite={isFavorite}
                  toggleFavorite={toggleFavorite}
                  size="small"
                  tooltipText={{
                    favorited: 'Remove from favorites',
                    notFavorited: 'Add to favorites'
                  }}
                />
              </Box>
              <Typography variant="body1" color="text.secondary">
                {company.industry && getIndustryByCode(company.industry)?.name}
                {company.industry && company.city && ' • '}
                {company.city && company.state && `${company.city}, ${company.state}`}
              </Typography>
            </Box>
          </Box>
          
          {/* Action Button */}
          <Button
            variant="outlined"
            startIcon={<EditIcon />}
            onClick={() => navigate(`/crm/companies/${companyId}`)}
          >
            Edit in CRM
          </Button>
        </Box>
      </Box>

      {/* Tabs */}
      <Paper sx={{ mb: 3 }}>
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            borderBottom: 1,
            borderColor: 'divider',
            '& .MuiTab-root': {
              textTransform: 'none',
              fontWeight: 500,
              minHeight: 48,
            },
          }}
        >
          <Tab
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <DashboardIcon fontSize="small" />
                Dashboard
              </Box>
            }
          />
          <Tab
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <PlaceIcon fontSize="small" />
                Locations
              </Box>
            }
          />
          <Tab
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <PersonIcon fontSize="small" />
                Contacts
                <Badge badgeContent={contacts.length} color="primary" />
              </Box>
            }
          />
          <Tab
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <OpportunitiesIcon fontSize="small" />
                Opportunities
                <Badge badgeContent={deals.length} color="primary" />
              </Box>
            }
          />
          <Tab
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <NotesIcon fontSize="small" />
                Notes
              </Box>
            }
          />
          <Tab
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <WorkIcon fontSize="small" />
                Job Postings
                <Badge badgeContent={jobPostings.length} color="primary" />
              </Box>
            }
          />
        </Tabs>
      </Paper>

      {/* Tab Panels */}
      <TabPanel value={tabValue} index={0}>
        <CompanyDashboardTab 
          company={company} 
          tenantId={tenantId} 
          contacts={contacts} 
          deals={deals}
        />
      </TabPanel>
      
      <TabPanel value={tabValue} index={1}>
        <LocationsTab company={company} currentTab={tabValue} locations={locations} />
      </TabPanel>
      
      <TabPanel value={tabValue} index={2}>
        <ContactsTab contacts={contacts} company={company} locations={locations} />
      </TabPanel>
      
      <TabPanel value={tabValue} index={3}>
        <OpportunitiesTab deals={deals} company={company} locations={locations} />
      </TabPanel>
      
      <TabPanel value={tabValue} index={4}>
        <NotesTab company={company} tenantId={tenantId} />
      </TabPanel>

      <TabPanel value={tabValue} index={5}>
        <IndeedJobsTab 
          company={company} 
          jobPostings={jobPostings} 
          setJobPostings={setJobPostings} 
          jobsLoading={jobsLoading} 
          setJobsLoading={setJobsLoading} 
        />
      </TabPanel>

      {/* Success Snackbar */}
      <Snackbar
        open={!!success}
        autoHideDuration={6000}
        onClose={() => setSuccess(null)}
      >
        <Alert onClose={() => setSuccess(null)} severity="success">
          {success}
        </Alert>
      </Snackbar>
    </Box>
  );
};

// Tab Components (simplified versions for recruiter context)
const CompanyDashboardTab: React.FC<{ 
  company: any; 
  tenantId: string; 
  contacts: any[]; 
  deals: any[];
}> = ({ company, tenantId, contacts, deals }) => {
  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={8}>
        <Card>
          <CardHeader title="Company Overview" />
          <CardContent>
            <Typography variant="body1" sx={{ mb: 2 }}>
              {company.description || 'No description available.'}
            </Typography>
            
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
              {company.industry && (
                <Chip 
                  label={getIndustryByCode(company.industry)?.name || company.industry}
                  variant="outlined"
                />
              )}
              {company.companySize && (
                <Chip 
                  label={`${company.companySize} employees`}
                  variant="outlined"
                />
              )}
            </Box>

            <Grid container spacing={2}>
              <Grid item xs={6}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <PersonIcon fontSize="small" color="action" />
                  <Typography variant="body2" color="text.secondary">
                    Contacts: {contacts.length}
                  </Typography>
                </Box>
              </Grid>
              <Grid item xs={6}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <OpportunitiesIcon fontSize="small" color="action" />
                  <Typography variant="body2" color="text.secondary">
                    Opportunities: {deals.length}
                  </Typography>
                </Box>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      </Grid>
      
      <Grid item xs={12} md={4}>
        <Card>
          <CardHeader title="Quick Actions" />
          <CardContent>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Button variant="outlined" startIcon={<PersonIcon />}>
                Add Contact
              </Button>
              <Button variant="outlined" startIcon={<OpportunitiesIcon />}>
                Create Opportunity
              </Button>
              <Button variant="outlined" startIcon={<WorkIcon />}>
                Post Job
              </Button>
            </Box>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
};

const LocationsTab: React.FC<{ company: any; currentTab: number; locations: any[] }> = ({ company, currentTab, locations }) => {
  if (locations.length === 0) {
    return (
      <Card>
        <CardHeader title="Locations" />
        <CardContent>
          <Typography variant="body1" color="text.secondary">
            No locations found for this company.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title={`Locations (${locations.length})`} />
      <CardContent>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell><strong>Name</strong></TableCell>
                <TableCell><strong>Type</strong></TableCell>
                <TableCell><strong>Address</strong></TableCell>
                <TableCell><strong>City</strong></TableCell>
                <TableCell><strong>State</strong></TableCell>
                <TableCell><strong>Zip Code</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {locations.map((location) => (
                <TableRow key={location.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>
                      {location.name || location.nickname || 'Unnamed Location'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip 
                      label={location.type || 'Unknown'} 
                      size="small" 
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {location.address || location.street || '-'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {location.city || '-'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {location.state || '-'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {location.zipCode || '-'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
  );
};

const ContactsTab: React.FC<{ contacts: any[]; company: any; locations: any[] }> = ({ contacts, company, locations }) => {
  return (
    <Card>
      <CardHeader title="Contacts" />
      <CardContent>
        {contacts.length === 0 ? (
          <Typography variant="body1" color="text.secondary">
            No contacts found for this company.
          </Typography>
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Title</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Phone</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {contacts.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell>
                      {contact.firstName} {contact.lastName}
                    </TableCell>
                    <TableCell>{contact.title || '-'}</TableCell>
                    <TableCell>{contact.email || '-'}</TableCell>
                    <TableCell>{contact.phone || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
};

const OpportunitiesTab: React.FC<{ deals: any[]; company: any; locations: any[] }> = ({ deals, company, locations }) => {
  return (
    <Card>
      <CardHeader title="Opportunities" />
      <CardContent>
        {deals.length === 0 ? (
          <Typography variant="body1" color="text.secondary">
            No opportunities found for this company.
          </Typography>
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Deal Name</TableCell>
                  <TableCell>Stage</TableCell>
                  <TableCell>Value</TableCell>
                  <TableCell>Created</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {deals.map((deal) => (
                  <TableRow key={deal.id}>
                    <TableCell>{deal.dealName || '-'}</TableCell>
                    <TableCell>
                      <Chip 
                        label={deal.stage || 'Unknown'} 
                        size="small"
                        sx={{
                          backgroundColor: getStageHexColor(deal.stage || ''),
                          color: getTextContrastColor(getStageHexColor(deal.stage || ''))
                        }}
                      />
                    </TableCell>
                    <TableCell>${deal.dealValue || 0}</TableCell>
                    <TableCell>
                      {deal.createdAt?.toDate?.()?.toLocaleDateString() || '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
};

const NotesTab: React.FC<{ company: any; tenantId: string }> = ({ company, tenantId }) => {
  return (
    <CRMNotesTab
      entityId={company.id}
      entityType="company"
      entityName={company.companyName || company.name || 'Unnamed Company'}
      tenantId={tenantId}
    />
  );
};

const IndeedJobsTab: React.FC<{ 
  company: any; 
  jobPostings: any[]; 
  setJobPostings: (postings: any[]) => void;
  jobsLoading: boolean;
  setJobsLoading: (loading: boolean) => void;
}> = ({ company, jobPostings, setJobPostings, jobsLoading, setJobsLoading }) => {
  return (
    <Card>
      <CardHeader title="Job Postings" />
      <CardContent>
        {jobsLoading ? (
          <CircularProgress />
        ) : jobPostings.length === 0 ? (
          <Typography variant="body1" color="text.secondary">
            No job postings found for this company.
          </Typography>
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Job Title</TableCell>
                  <TableCell>Location</TableCell>
                  <TableCell>Pay Rate</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Posted</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {jobPostings.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>{job.jobTitle || job.postTitle || '-'}</TableCell>
                    <TableCell>
                      {job.city && job.state ? `${job.city}, ${job.state}` : job.worksiteName || '-'}
                    </TableCell>
                    <TableCell>${job.payRate || 0}/hr</TableCell>
                    <TableCell>
                      <Chip 
                        label={job.status || 'Unknown'} 
                        size="small"
                        color={job.status === 'active' ? 'success' : 'default'}
                      />
                    </TableCell>
                    <TableCell>
                      {job.createdAt?.toDate?.()?.toLocaleDateString() || '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
};

export default RecruiterCompanyDetails;
