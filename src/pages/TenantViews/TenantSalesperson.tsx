import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Tabs,
  Tab,
  Avatar,
  Chip,
  IconButton,
  Grid,
  Divider,
  CircularProgress,
  Alert,
  TextField,
  Card,
  CardContent,
  CardHeader,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Edit as EditIcon,
  List as ListIcon,
  Info as InfoIcon,
  Group as GroupIcon,
  TrendingUp as TrendingUpIcon,
  Assignment as AssignmentIcon,
} from '@mui/icons-material';
import { doc, getDoc, updateDoc, collection, getDocs, query, orderBy, limit } from 'firebase/firestore';

import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import ActivityLogTab from '../../components/ActivityLogTab';
import TasksDashboard from '../../components/TasksDashboard';

interface SalespersonData {
  id: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  jobTitle?: string;
  title?: string;
  department?: string;
  status?: string;
  employeeId?: string;
  hireDate?: any;
  managerId?: string;
  managerName?: string;
  locationId?: string;
  locationName?: string;
  divisionId?: string;
  divisionName?: string;
  crm_sales?: boolean;
  salesTerritory?: string;
  salesQuota?: number;
  salesTarget?: number;
  commissionRate?: number;
  notes?: string;
  profilePicture?: string;
  linkedInUrl?: string;
  address?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  country?: string;
  createdAt?: any;
  updatedAt?: any;
  
  // Performance Metrics
  totalSales?: number;
  dealsWon?: number;
  dealsLost?: number;
  winRate?: number;
  averageDealSize?: number;
  pipelineValue?: number;
  lastActivityDate?: any;
  
  // AI Enhanced Fields
  enriched?: boolean;
  enrichedAt?: any;
  professionalSummary?: string;
  keySkills?: string[];
  salesStrengths?: string[];
  areasForImprovement?: string[];
  recommendedTraining?: string[];
  salesStyle?: string;
  customerRelationshipScore?: number;
  negotiationSkills?: number;
  productKnowledge?: number;
}

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
      id={`salesperson-tabpanel-${index}`}
      aria-labelledby={`salesperson-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

const TenantSalesperson: React.FC = () => {
  const { salespersonId } = useParams<{ salespersonId: string }>();
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const [salesperson, setSalesperson] = useState<SalespersonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [tabValue, setTabValue] = useState(0);
  const [editing, setEditing] = useState(false);
  const [companies, setCompanies] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);

  useEffect(() => {
    if (!salespersonId || !tenantId) return;

    const loadSalesperson = async () => {
      try {
        setLoading(true);
        // Salespeople are stored in the top-level users collection
        const salespersonRef = doc(db, 'users', salespersonId);
        const salespersonDoc = await getDoc(salespersonRef);
        
        if (salespersonDoc.exists()) {
          const data = salespersonDoc.data() as SalespersonData;
          setSalesperson({ id: salespersonDoc.id, ...data });
        } else {
          setError('Salesperson not found');
        }
      } catch (err: any) {
        console.error('Error loading salesperson:', err);
        setError(err.message || 'Failed to load salesperson');
      } finally {
        setLoading(false);
      }
    };

    const loadContacts = async () => {
      try {
        console.log('🔍 Loading contacts for TenantSalesperson...');
        const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
        const contactsQuery = query(contactsRef, orderBy('createdAt', 'desc'), limit(100));
        const contactsSnapshot = await getDocs(contactsQuery);
        
        const contactsData = contactsSnapshot.docs.map(doc => ({ 
          id: doc.id, 
          ...doc.data() 
        }));
        
        console.log('✅ Loaded contacts for TenantSalesperson:', contactsData.length);
        setContacts(contactsData);
      } catch (error) {
        console.error('Error loading contacts:', error);
        setContacts([]);
      }
    };

    loadSalesperson();
    loadContacts();
  }, [salespersonId, tenantId]);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleSalespersonUpdate = async (field: string, value: any) => {
    if (!salesperson) return;

    try {
      const salespersonRef = doc(db, 'users', salesperson.id);
      await updateDoc(salespersonRef, {
        [field]: value,
        updatedAt: new Date()
      });

      setSalesperson(prev => prev ? { ...prev, [field]: value } : null);
    } catch (err: any) {
      console.error('Error updating salesperson:', err);
      setError(err.message || 'Failed to update salesperson');
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  if (!salesperson) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <Typography variant="h6" color="error">
          Salesperson not found
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Avatar 
            sx={{ 
              width: 56, 
              height: 56, 
              bgcolor: 'primary.main',
              fontSize: '1.5rem'
            }}
          >
            {salesperson.profilePicture ? (
              <img src={salesperson.profilePicture} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              getInitials(salesperson.fullName || `${salesperson.firstName} ${salesperson.lastName}`)
            )}
          </Avatar>
          <Box>
            <Typography variant="h4" gutterBottom>
              {salesperson.fullName || `${salesperson.firstName} ${salesperson.lastName}`}
            </Typography>
            <Typography variant="body1" color="text.secondary">
              {salesperson.jobTitle || salesperson.title} • {salesperson.department}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ ml: 'auto', display: 'flex', gap: 1, alignItems: 'center' }}>
          <Chip 
            label={salesperson.status || 'Active'} 
            color={salesperson.status === 'active' ? 'success' : 'default'}
          />
          {salesperson.crm_sales && (
            <Chip 
              label="Sales Team" 
              color="primary" 
              icon={<GroupIcon />}
            />
          )}
          <IconButton onClick={() => navigate('/tenant/crm')}>
            <ArrowBackIcon />
          </IconButton>
        </Box>
      </Box>

      {/* Tabs Navigation */}
      <Paper elevation={1} sx={{ mb: 3, borderRadius: 0 }}>
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          indicatorColor="primary"
          textColor="primary"
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <InfoIcon fontSize="small" />
                Overview
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <ListIcon fontSize="small" />
                Activity Log
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <TrendingUpIcon fontSize="small" />
                Pipeline
              </Box>
            } 
          />
          <Tab 
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <AssignmentIcon fontSize="small" />
                Tasks
              </Box>
            } 
          />
        </Tabs>
      </Paper>

      {/* Tab Panels */}
      <TabPanel value={tabValue} index={0}>
        <Grid container spacing={3}>
          {/* Contact Details Panel - Left Side */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardHeader 
                title="Contact Details"
                action={
                  <IconButton onClick={() => setEditing(!editing)}>
                    <EditIcon />
                  </IconButton>
                }
              />
              <CardContent>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="First Name"
                      value={salesperson.firstName || ''}
                      disabled={!editing}
                      onChange={(e) => handleSalespersonUpdate('firstName', e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Last Name"
                      value={salesperson.lastName || ''}
                      disabled={!editing}
                      onChange={(e) => handleSalespersonUpdate('lastName', e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <TextField
                      fullWidth
                      label="Email"
                      value={salesperson.email || ''}
                      disabled={!editing}
                      onChange={(e) => handleSalespersonUpdate('email', e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Phone"
                      value={salesperson.phone || ''}
                      disabled={!editing}
                      onChange={(e) => handleSalespersonUpdate('phone', e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Mobile"
                      value={salesperson.mobilePhone || ''}
                      disabled={!editing}
                      onChange={(e) => handleSalespersonUpdate('mobilePhone', e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <TextField
                      fullWidth
                      label="Job Title"
                      value={salesperson.jobTitle || salesperson.title || ''}
                      disabled={!editing}
                      onChange={(e) => handleSalespersonUpdate('jobTitle', e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Department"
                      value={salesperson.department || ''}
                      disabled={!editing}
                      onChange={(e) => handleSalespersonUpdate('department', e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Employee ID"
                      value={salesperson.employeeId || ''}
                      disabled={!editing}
                      onChange={(e) => handleSalespersonUpdate('employeeId', e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={12}>
                    <TextField
                      fullWidth
                      label="LinkedIn URL"
                      value={salesperson.linkedInUrl || ''}
                      disabled={!editing}
                      onChange={(e) => handleSalespersonUpdate('linkedInUrl', e.target.value)}
                    />
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          </Grid>

          {/* Performance Metrics Panel - Right Side */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardHeader title="Performance Metrics" />
              <CardContent>
                <Grid container spacing={2}>
                  <Grid item xs={6}>
                    <Box textAlign="center">
                      <Typography variant="h4" color="primary">
                        ${salesperson.totalSales?.toLocaleString() || '0'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Total Sales
                      </Typography>
                    </Box>
                  </Grid>
                  <Grid item xs={6}>
                    <Box textAlign="center">
                      <Typography variant="h4" color="success.main">
                        {salesperson.winRate || 0}%
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Win Rate
                      </Typography>
                    </Box>
                  </Grid>
                  <Grid item xs={6}>
                    <Box textAlign="center">
                      <Typography variant="h4" color="info.main">
                        {salesperson.dealsWon || 0}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Deals Won
                      </Typography>
                    </Box>
                  </Grid>
                  <Grid item xs={6}>
                    <Box textAlign="center">
                      <Typography variant="h4" color="warning.main">
                        ${salesperson.averageDealSize?.toLocaleString() || '0'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Avg Deal Size
                      </Typography>
                    </Box>
                  </Grid>
                </Grid>
                
                <Divider sx={{ my: 2 }} />
                
                <Typography variant="h6" gutterBottom>
                  Sales Targets
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">
                      Sales Quota
                    </Typography>
                    <Typography variant="h6">
                      ${salesperson.salesQuota?.toLocaleString() || '0'}
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">
                      Commission Rate
                    </Typography>
                    <Typography variant="h6">
                      {salesperson.commissionRate || 0}%
                    </Typography>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          </Grid>

          {/* Professional Summary */}
          <Grid item xs={12}>
            <Card>
              <CardHeader title="Professional Summary" />
              <CardContent>
                <Typography variant="body1">
                  {salesperson.professionalSummary || 'No professional summary available.'}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </TabPanel>

      <TabPanel value={tabValue} index={1}>
        <ActivityLogTab
          entityId={salespersonId!}
          entityType="salesperson"
          entityName={salesperson.fullName || `${salesperson.firstName} ${salesperson.lastName}`}
          tenantId={tenantId}
        />
      </TabPanel>

      <TabPanel value={tabValue} index={2}>
        <Box>
          <Typography variant="h5" gutterBottom>
            Sales Pipeline
          </Typography>
          <Alert severity="info">
            Pipeline view for {salesperson.fullName || `${salesperson.firstName} ${salesperson.lastName}`} will be implemented here.
          </Alert>
        </Box>
      </TabPanel>

      <TabPanel value={tabValue} index={3}>
        <TasksDashboard 
          entityId={salespersonId!} 
          entityType="salesperson"
          tenantId={tenantId} 
          entity={salesperson}
          preloadedContacts={contacts}
          preloadedSalespeople={[]}
          preloadedCompany={null}
          preloadedDeals={[]}
          preloadedCompanies={[]}
        />
      </TabPanel>
    </Box>
  );
};

export default TenantSalesperson;