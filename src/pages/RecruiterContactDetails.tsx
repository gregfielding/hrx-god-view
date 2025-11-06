import React, { useEffect, useState } from 'react';
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
  Avatar,
  Snackbar,
  Alert,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Link,
  Skeleton,
} from '@mui/material';
import {
  Phone as PhoneIcon,
  Email as EmailIcon,
  LocationOn as LocationOnIcon,
  Business as BusinessIcon,
  Dashboard as DashboardIcon,
  Person as PersonIcon,
  AttachMoney as OpportunitiesIcon,
  Notes as NotesIcon,
  Work as WorkIcon,
  Edit as EditIcon,
  ArrowBack as ArrowBackIcon,
} from '@mui/icons-material';
import {
  collection,
  doc,
  getDoc,
  query,
  where,
  orderBy,
  getDocs,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import CRMNotesTab from '../components/CRMNotesTab';
import { formatDateForDisplay } from '../utils/dateUtils';
import { formatPhoneNumber } from '../utils/formatPhone';

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
      id={`contact-tabpanel-${index}`}
      aria-labelledby={`contact-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 0 }}>{children}</Box>}
    </div>
  );
}

const RecruiterContactDetails: React.FC = () => {
  const { contactId } = useParams<{ contactId: string }>();
  const navigate = useNavigate();
  const { tenantId } = useAuth();
  
  // Favorites - contacts aren't users, so we'll skip favorites for now or use a different type
  // const { isFavorite, toggleFavorite } = useFavorites('users');

  const [contact, setContact] = useState<any>(null);
  const [company, setCompany] = useState<any>(null);
  const [location, setLocation] = useState<any>(null);
  const [deals, setDeals] = useState<any[]>([]);
  const [jobPostings, setJobPostings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tabValue, setTabValue] = useState(0);

  useEffect(() => {
    if (!contactId || !tenantId) return;
    loadContactData();
  }, [contactId, tenantId]);

  const loadContactData = async () => {
    if (!contactId || !tenantId) return;

    try {
      setLoading(true);
      
      // Load contact
      const contactRef = doc(db, 'tenants', tenantId, 'crm_contacts', contactId);
      const contactSnap = await getDoc(contactRef);
      
      if (!contactSnap.exists()) {
        setError('Contact not found');
        setLoading(false);
        return;
      }

      const contactData = {
        id: contactSnap.id,
        ...contactSnap.data()
      } as any;
      setContact(contactData);

      // Load related data in parallel
      await Promise.all([
        loadCompany(contactData.companyId),
        loadDeals(contactId),
        loadJobPostings(contactId, contactData.companyId)
      ]);

      // Load location after we have the company ID
      if (contactData.locationId && contactData.companyId) {
        await loadLocation(contactData.locationId, contactData.companyId);
      }

    } catch (error) {
      console.error('Error loading contact data:', error);
      setError('Failed to load contact data');
    } finally {
      setLoading(false);
    }
  };

  const loadCompany = async (companyId?: string) => {
    if (!companyId || !tenantId) return;

    try {
      const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId);
      const companySnap = await getDoc(companyRef);
      if (companySnap.exists()) {
        setCompany({
          id: companySnap.id,
          ...companySnap.data()
        });
      }
    } catch (error) {
      console.error('Error loading company:', error);
    }
  };

  const loadLocation = async (locationId?: string, companyId?: string) => {
    if (!locationId || !tenantId || !companyId) return;

    try {
      const locationRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations', locationId);
      const locationSnap = await getDoc(locationRef);
      if (locationSnap.exists()) {
        setLocation({
          id: locationSnap.id,
          ...locationSnap.data()
        });
      }
    } catch (error) {
      console.error('Error loading location:', error);
    }
  };

  const loadDeals = async (contactId: string) => {
    if (!contactId || !tenantId) return;

    try {
      const dealsRef = collection(db, 'tenants', tenantId, 'deals');
      const q = query(
        dealsRef,
        where('associations.contacts', 'array-contains', contactId),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDocs(q);
      const dealsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setDeals(dealsData);
    } catch (error) {
      console.warn('Could not load deals (insufficient permissions or no matches):', error);
      // Continue without deals data
    }
  };

  const loadJobPostings = async (contactId: string, companyId?: string) => {
    if (!tenantId) return;

    try {
      const jobPostingsRef = collection(db, 'tenants', tenantId, 'job_postings');
      
      // Try to filter by companyId if available
      let q;
      if (companyId) {
        q = query(
          jobPostingsRef,
          where('companyId', '==', companyId),
          orderBy('createdAt', 'desc')
        );
      } else {
        q = query(jobPostingsRef, orderBy('createdAt', 'desc'));
      }
      
      const snapshot = await getDocs(q);
      const jobPostingsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...(doc.data() as any)
      }));
      setJobPostings(jobPostingsData);
    } catch (error) {
      console.error('Error loading job postings:', error);
    }
  };

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Skeleton variant="rectangular" width="100%" height={200} sx={{ mb: 3 }} />
        <Skeleton variant="rectangular" width="100%" height={400} />
      </Box>
    );
  }

  if (error || !contact) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error || 'Contact not found'}
        </Alert>
        <Button onClick={() => navigate('/recruiter/contacts')} sx={{ mt: 2 }} startIcon={<ArrowBackIcon />}>
          Back to Contacts
        </Button>
      </Box>
    );
  }

  const getInitials = (name?: string) => {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return name[0].toUpperCase();
  };

  const getRoleColor = (role?: string) => {
    switch (role) {
      case 'decision_maker': return 'primary';
      case 'influencer': return 'success';
      case 'finance': return 'warning';
      case 'operations': return 'info';
      case 'hr': return 'secondary';
      default: return 'default';
    }
  };

  return (
    <Box sx={{ p: 0 }}>
      {/* Enhanced Header - Persistent Contact Information */}
      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
            {/* Contact Avatar */}
            <Box sx={{ position: 'relative' }}>
              <Avatar
                src={contact.avatar || contact.profilePhoto}
                alt={contact.fullName || `${contact.firstName} ${contact.lastName}`}
                sx={{ 
                  width: 128, 
                  height: 128,
                  bgcolor: 'primary.main',
                  fontSize: '2rem',
                  fontWeight: 'bold'
                }}
              >
                {getInitials(contact.fullName || `${contact.firstName} ${contact.lastName}`)}
              </Avatar>
            </Box>
            
            {/* Contact Info */}
            <Box sx={{ flex: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                <Typography variant="h4" sx={{ fontWeight: 600 }}>
                  {contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unnamed Contact'}
                </Typography>
                {/* Favorites feature for contacts can be added later if needed */}
              </Box>
              
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 1 }}>
                {contact.title && (
                  <Typography variant="body1" color="text.secondary">
                    {contact.title}
                  </Typography>
                )}
                {contact.role && (
                  <Chip
                    label={contact.role.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    color={getRoleColor(contact.role)}
                    size="small"
                  />
                )}
                {contact.status && (
                  <Chip
                    label={contact.status.charAt(0).toUpperCase() + contact.status.slice(1)}
                    color={contact.status === 'active' ? 'success' : 'default'}
                    size="small"
                    variant="outlined"
                  />
                )}
              </Box>

              {/* Contact Methods */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mt: 1 }}>
                {contact.email && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <EmailIcon fontSize="small" color="action" />
                    <Link href={`mailto:${contact.email}`} color="primary" underline="hover">
                      {contact.email}
                    </Link>
                  </Box>
                )}
                {contact.phone && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <PhoneIcon fontSize="small" color="action" />
                    <Typography variant="body2" color="text.secondary">
                      {formatPhoneNumber(contact.phone)}
                    </Typography>
                  </Box>
                )}
                {company && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <BusinessIcon fontSize="small" color="action" />
                    <Link
                      href={`/recruiter/companies/${company.id}`}
                      color="primary"
                      underline="hover"
                      onClick={(e) => {
                        e.preventDefault();
                        navigate(`/recruiter/companies/${company.id}`);
                      }}
                    >
                      {company.companyName || company.name}
                    </Link>
                  </Box>
                )}
                {location && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <LocationOnIcon fontSize="small" color="action" />
                    <Typography variant="body2" color="text.secondary">
                      {location.name || location.nickname || 'Location'}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>
          </Box>
          
          {/* Action Button */}
          <Button
            variant="outlined"
            startIcon={<EditIcon />}
            onClick={() => navigate(`/crm/contacts/${contactId}`)}
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
          {company && (
            <Tab
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <BusinessIcon fontSize="small" />
                  Company
                </Box>
              }
            />
          )}
          <Tab
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <OpportunitiesIcon fontSize="small" />
                Opportunities
                {deals.length > 0 && <Badge badgeContent={deals.length} color="primary" />}
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
                {jobPostings.length > 0 && <Badge badgeContent={jobPostings.length} color="primary" />}
              </Box>
            }
          />
        </Tabs>
      </Paper>

      {/* Tab Panels */}
      <TabPanel value={tabValue} index={0}>
        <ContactDashboardTab 
          contact={contact} 
          company={company}
          location={location}
          deals={deals}
          jobPostings={jobPostings}
        />
      </TabPanel>
      
      {company && (
        <TabPanel value={tabValue} index={1}>
          <CompanyTab 
            company={company} 
            onNavigateToCompany={() => navigate(`/recruiter/companies/${company.id}`)}
          />
        </TabPanel>
      )}
      
      <TabPanel value={tabValue} index={company ? 2 : 1}>
        <OpportunitiesTab deals={deals} contact={contact} />
      </TabPanel>
      
      <TabPanel value={tabValue} index={company ? 3 : 2}>
        <NotesTab contact={contact} tenantId={tenantId} />
      </TabPanel>

      <TabPanel value={tabValue} index={company ? 4 : 3}>
        <JobPostingsTab 
          jobPostings={jobPostings} 
          contact={contact}
          onNavigateToJobPosting={(posting: any) => {
            // Navigate to admin job order if jobOrderId exists, otherwise stay on page
            if (posting.jobOrderId) {
              navigate(`/recruiter/job-orders/${posting.jobOrderId}`);
            }
          }}
        />
      </TabPanel>
    </Box>
  );
};

// Tab Components
const ContactDashboardTab: React.FC<{
  contact: any;
  company: any;
  location: any;
  deals: any[];
  jobPostings: any[];
}> = ({ contact, company, location, deals, jobPostings }) => {
  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={8}>
        <Card sx={{ mb: 3 }}>
          <CardHeader title="Contact Overview" />
          <CardContent>
            <Grid container spacing={2}>
              {contact.email && (
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" color="text.secondary">Email</Typography>
                  <Typography variant="body1">
                    <Link href={`mailto:${contact.email}`} color="primary">
                      {contact.email}
                    </Link>
                  </Typography>
                </Grid>
              )}
              {contact.phone && (
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" color="text.secondary">Phone</Typography>
                  <Typography variant="body1">{formatPhoneNumber(contact.phone)}</Typography>
                </Grid>
              )}
              {contact.title && (
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" color="text.secondary">Job Title</Typography>
                  <Typography variant="body1">{contact.title}</Typography>
                </Grid>
              )}
              {contact.role && (
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" color="text.secondary">Role</Typography>
                  <Typography variant="body1">
                    {contact.role.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </Typography>
                </Grid>
              )}
              {company && (
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" color="text.secondary">Company</Typography>
                  <Typography variant="body1">
                    {company.companyName || company.name}
                  </Typography>
                </Grid>
              )}
              {location && (
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" color="text.secondary">Location</Typography>
                  <Typography variant="body1">
                    {location.name || location.nickname}
                  </Typography>
                </Grid>
              )}
              {contact.createdAt && (
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" color="text.secondary">Created</Typography>
                  <Typography variant="body1">
                    {formatDateForDisplay(contact.createdAt)}
                  </Typography>
                </Grid>
              )}
              {contact.updatedAt && (
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" color="text.secondary">Last Updated</Typography>
                  <Typography variant="body1">
                    {formatDateForDisplay(contact.updatedAt)}
                  </Typography>
                </Grid>
              )}
            </Grid>
            {contact.notes && (
              <Box sx={{ mt: 3 }}>
                <Typography variant="caption" color="text.secondary">Notes</Typography>
                <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>
                  {contact.notes}
                </Typography>
              </Box>
            )}
          </CardContent>
        </Card>
      </Grid>
      
      <Grid item xs={12} md={4}>
        <Card sx={{ mb: 3 }}>
          <CardHeader title="Quick Stats" />
          <CardContent>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">Opportunities</Typography>
                <Typography variant="h4">{deals.length}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Job Postings</Typography>
                <Typography variant="h4">{jobPostings.length}</Typography>
              </Box>
            </Box>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
};

const CompanyTab: React.FC<{
  company: any;
  onNavigateToCompany: () => void;
}> = ({ company, onNavigateToCompany }) => {
  return (
    <Card>
      <CardHeader 
        title="Company Information"
        action={
          <Button variant="outlined" size="small" onClick={onNavigateToCompany}>
            View Company Details
          </Button>
        }
      />
      <CardContent>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <Typography variant="caption" color="text.secondary">Company Name</Typography>
            <Typography variant="body1" fontWeight={500}>
              {company.companyName || company.name}
            </Typography>
          </Grid>
          {company.industry && (
            <Grid item xs={12} sm={6}>
              <Typography variant="caption" color="text.secondary">Industry</Typography>
              <Typography variant="body1">{company.industry}</Typography>
            </Grid>
          )}
          {(company.city || company.state) && (
            <Grid item xs={12} sm={6}>
              <Typography variant="caption" color="text.secondary">Location</Typography>
              <Typography variant="body1">
                {[company.city, company.state].filter(Boolean).join(', ')}
              </Typography>
            </Grid>
          )}
          {company.website && (
            <Grid item xs={12} sm={6}>
              <Typography variant="caption" color="text.secondary">Website</Typography>
              <Typography variant="body1">
                <Link href={company.website} target="_blank" rel="noopener">
                  {company.website}
                </Link>
              </Typography>
            </Grid>
          )}
        </Grid>
      </CardContent>
    </Card>
  );
};

const OpportunitiesTab: React.FC<{
  deals: any[];
  contact: any;
}> = ({ deals, contact }) => {
  if (deals.length === 0) {
    return (
      <Card>
        <CardHeader title="Opportunities" />
        <CardContent>
          <Typography variant="body1" color="text.secondary">
            No opportunities found for this contact.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title={`Opportunities (${deals.length})`} />
      <CardContent>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell><strong>Deal Name</strong></TableCell>
                <TableCell><strong>Stage</strong></TableCell>
                <TableCell><strong>Value</strong></TableCell>
                <TableCell><strong>Created</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {deals.map((deal) => (
                <TableRow key={deal.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>
                      {deal.dealName || deal.name || 'Unnamed Deal'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip 
                      label={deal.stage || 'Unknown'} 
                      size="small" 
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {deal.dealValue ? `$${deal.dealValue.toLocaleString()}` : '-'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {deal.createdAt ? formatDateForDisplay(deal.createdAt) : '-'}
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

const NotesTab: React.FC<{
  contact: any;
  tenantId: string | null;
}> = ({ contact, tenantId }) => {
  if (!tenantId || !contact) return null;

  return (
    <CRMNotesTab
      entityId={contact.id}
      entityType="contact"
      entityName={contact.fullName || `${contact.firstName} ${contact.lastName}` || 'Contact'}
      tenantId={tenantId}
    />
  );
};

const JobPostingsTab: React.FC<{
  jobPostings: any[];
  contact: any;
  onNavigateToJobPosting: (posting: any) => void;
}> = ({ jobPostings, contact, onNavigateToJobPosting }) => {
  if (jobPostings.length === 0) {
    return (
      <Card>
        <CardHeader title="Job Postings" />
        <CardContent>
          <Typography variant="body1" color="text.secondary">
            No job postings found for this contact's company.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title={`Job Postings (${jobPostings.length})`} />
      <CardContent>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell><strong>Job Title</strong></TableCell>
                <TableCell><strong>Company</strong></TableCell>
                <TableCell><strong>Location</strong></TableCell>
                <TableCell><strong>Pay Rate</strong></TableCell>
                <TableCell><strong>Status</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {jobPostings.map((posting) => (
                <TableRow 
                  key={posting.id} 
                  hover
                  onClick={() => onNavigateToJobPosting(posting)}
                  sx={{ cursor: posting.jobOrderId ? 'pointer' : 'default' }}
                >
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>
                      {posting.jobTitle || posting.postTitle || 'Untitled'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {posting.companyName || '-'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {posting.worksiteName || posting.city || '-'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {posting.payRate ? `$${posting.payRate}` : '-'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={posting.status || 'Unknown'}
                      size="small"
                      color={posting.status === 'active' ? 'success' : 'default'}
                    />
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

export default RecruiterContactDetails;

