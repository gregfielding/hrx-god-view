import React, { useMemo, useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
} from '@mui/material';
import {
  Clear as ClearIcon,
  Add as AddIcon,
  Business as BusinessIcon,
} from '@mui/icons-material';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { collection, query, orderBy, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { Autocomplete } from '@mui/material';
import { useFavorites } from '../hooks/useFavorites';
import CompanyTable from '../components/CompanyTable';
import { CircularProgress, Snackbar, Alert } from '@mui/material';
import StandardTablePagination from '../components/StandardTablePagination';
import type { RecruiterOutletContext } from './RecruiterDashboard';

const RecruiterCompanies: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId, currentUser } = useAuth();
  const outletCtx = useOutletContext<RecruiterOutletContext | null>();
  const [searchParams, setSearchParams] = useSearchParams();
  const headerSearch = outletCtx?.search ?? '';
  const headerShowFavoritesOnly = outletCtx?.showFavoritesOnly ?? false;
  
  // State
  const [companies, setCompanies] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [locationStateFilter, setLocationStateFilter] = useState('all');
  const [sortField, setSortField] = useState<string>('companyName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [showCompanyDialog, setShowCompanyDialog] = useState(false);
  const [editingCompany, setEditingCompany] = useState<any>(null);
  const [companyForm, setCompanyForm] = useState({
    name: '',
    website: '',
    parentCompany: '',
  });
  const [allCompanies, setAllCompanies] = useState<any[]>([]);
  const [loadingAllCompanies, setLoadingAllCompanies] = useState(false);
  const [savingCompany, setSavingCompany] = useState(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  // Favorites
  const { favorites, isFavorite, toggleFavorite } = useFavorites('companies');

  // Load companies + supporting data
  useEffect(() => {
    if (tenantId) {
      loadCompanies();
      loadAllCompanies();
      loadContacts();
    }
  }, [tenantId]);

  // Open "Add Company" dialog when navigated with ?new=1 from the header button
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      handleAddNew();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Reset pagination when filters/search change
  useEffect(() => {
    setPage(0);
  }, [headerSearch, headerShowFavoritesOnly, locationStateFilter, sortField, sortDirection]);
  
  // Load contacts for contact counts
  const loadContacts = async () => {
    if (!tenantId) return;
    
    try {
      const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
      const q = query(contactsRef);
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

  // Load all companies for parent company autocomplete
  const loadAllCompanies = async () => {
    if (!tenantId) return;
    
    try {
      setLoadingAllCompanies(true);
      const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
      const q = query(companiesRef, orderBy('companyName', 'asc'));
      const snapshot = await getDocs(q);
      const companiesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setAllCompanies(companiesData);
    } catch (error) {
      console.error('Error loading all companies:', error);
    } finally {
      setLoadingAllCompanies(false);
    }
  };

  const loadCompanies = async () => {
    if (!tenantId) return;
    
    setLoading(true);
    
    try {
      const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
      const q = query(companiesRef, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);

      const companiesData = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));

      setCompanies(companiesData);
    } catch (error) {
      console.error('Error loading companies:', error);
      setCompanies([]);
    } finally {
      setLoading(false);
    }
  };

  // Handle sorting
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Get sortable value for a company and field
  const getSortableValue = (company: any, field: string) => {
    switch (field) {
      case 'companyName':
        return (company.companyName || company.name || '').toLowerCase();
      case 'contacts':
        return 0; // Simplified for now
      case 'deals':
        return 0; // Simplified for now
      case 'pipelineValue':
        return 0; // Simplified for now
      case 'closedValue':
        return 0; // Simplified for now
      case 'accountOwner':
        return (company.accountOwner || '').toLowerCase();
      default:
        return '';
    }
  };

  const filteredSortedCompanies = useMemo(() => {
    let filtered = [...companies];

    // Search (from Inbox-standard header)
    if (headerSearch.trim()) {
      const searchLower = headerSearch.toLowerCase().trim();
      filtered = filtered.filter((company) => {
        const companyName = (company.companyName || company.name || '').toLowerCase();
        const companyUrl = (company.companyUrl || company.url || '').toLowerCase();
        const city = (company.city || '').toLowerCase();
        const industry = (company.industry || '').toLowerCase();
        return (
          companyName.includes(searchLower) ||
          companyUrl.includes(searchLower) ||
          city.includes(searchLower) ||
          industry.includes(searchLower)
        );
      });
    }

    // State filter
    if (locationStateFilter !== 'all') {
      filtered = filtered.filter((company) => {
        const state = company.state || company.address?.state || '';
        return state === locationStateFilter;
      });
    }

    // Favorites filter (from header)
    if (headerShowFavoritesOnly) {
      filtered = filtered.filter((company) => isFavorite(company.id));
    }

    // Sort
    filtered.sort((a, b) => {
      const aValue = getSortableValue(a, sortField);
      const bValue = getSortableValue(b, sortField);
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [companies, headerSearch, headerShowFavoritesOnly, locationStateFilter, sortField, sortDirection, favorites, isFavorite]);

  const paginatedCompanies = useMemo(() => {
    const start = page * rowsPerPage;
    return filteredSortedCompanies.slice(start, start + rowsPerPage);
  }, [filteredSortedCompanies, page, rowsPerPage]);

  // Helper function to get avatar background color
  const getAvatarColor = (name: string) => {
    const colors = [
      '#F3F4F6', '#FEF3C7', '#DBEAFE', '#D1FAE5', '#FCE7F3', '#EDE9FE', '#FEE2E2', '#FEF5E7'
    ];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  // Helper function to get avatar text color
  const getAvatarTextColor = (name: string) => {
    const colors = [
      '#6B7280', '#92400E', '#1E40AF', '#065F46', '#BE185D', '#5B21B6', '#DC2626', '#EA580C'
    ];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  // Helper functions for CompanyTable
  const getCompanyContacts = (companyId: string) => {
    return contacts.filter((contact: any) => {
      // Check new associations format first
      const assocCompanies = (contact.associations?.companies || []).map((c: any) => (typeof c === 'string' ? c : c?.id)).filter(Boolean);
      if (assocCompanies.includes(companyId)) {
        return true;
      }
      // Fallback to legacy companyId field
      if (contact.companyId === companyId) {
        return true;
      }
      return false;
    });
  };
  const getCompanyDeals = (_companyId: string) => [];
  const getCompanyPipelineValue = (_company: any) => ({ totalLow: 0, totalHigh: 0, dealCount: 0 });
  const getCompanySalespeople = (company: any): string[] => {
    const salespeople: string[] = [];
    if (company.accountOwner) {
      salespeople.push(company.accountOwner);
    }
    return salespeople;
  };
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const handleViewCompany = (company: any) => {
    navigate(`/companies/${company.id}`);
  };

  const handleAddNew = () => {
    setEditingCompany(null);
    setCompanyForm({
      name: '',
      website: '',
      parentCompany: '',
    });
    setError('');
    setShowCompanyDialog(true);
  };

  const handleSaveCompany = async () => {
    if (!companyForm.name.trim()) {
      setError('Company name is required');
      return;
    }

    if (!tenantId || !currentUser?.uid) {
      setError('Missing tenant ID or user information');
      return;
    }

    setSavingCompany(true);
    setError('');

    try {
      const { parentCompany, ...rest } = companyForm;
      const companyData = {
        ...rest,
        companyName: companyForm.name, // Use companyName for consistency
        tenantId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        // Add the current user as an associated salesperson
        associations: {
          salespeople: [currentUser.uid]
        },
        parentCompany: parentCompany || null,
        // Legacy fields for backward compatibility
        salesOwnerId: currentUser.uid || null,
        accountOwnerId: currentUser.uid || null,
        salesOwnerName: currentUser.displayName || currentUser.email || 'Unknown',
        accountOwnerName: currentUser.displayName || currentUser.email || 'Unknown'
      };

      const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
      const newDocRef = await addDoc(companiesRef, companyData);
      const newCompanyId = newDocRef.id;

      // If parent company selected, call function to register child on parent
      if (parentCompany) {
        try {
          const fn = httpsCallable(functions, 'registerChildCompany');
          await fn({ tenantId, parentCompanyId: parentCompany, childCompanyId: newCompanyId });
        } catch (e) {
          console.warn('registerChildCompany failed', e);
        }
      }

      // Reset form and close dialog
      setCompanyForm({ name: '', website: '', parentCompany: '' });
      setShowCompanyDialog(false);
      if (searchParams.get('new') === '1') {
        setSearchParams({});
      }
      setSuccess(true);
      setSuccessMessage('Company added successfully!');
      
      // Reload companies
      await loadCompanies();
      await loadAllCompanies();
    } catch (err: any) {
      console.error('Error adding company:', err);
      setError(err.message || 'Failed to add company');
    } finally {
      setSavingCompany(false);
    }
  };

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        px: { xs: 2, md: 3 },
        pt: 2,
      }}
    >
      {/* Secondary filters (search + favorites live in the Inbox-standard header) */}
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
        {/* State Filter */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <FormControl size="small" sx={{ minWidth: 160, height: 36 }}>
            <InputLabel sx={{ fontSize: '0.875rem' }}>State Filter</InputLabel>
            <Select
              value={locationStateFilter}
              onChange={(e) => setLocationStateFilter(String(e.target.value))}
              label="State Filter"
              sx={{
                height: 36,
                borderRadius: '6px',
                backgroundColor: 'white',
                fontSize: '0.875rem',
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: '#E5E7EB',
                },
                '&:hover .MuiOutlinedInput-notchedOutline': {
                  borderColor: '#D1D5DB',
                },
              }}
            >
              <MenuItem value="all">All States</MenuItem>
              {[
                'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
              ].map((st) => (
                <MenuItem key={st} value={st}>
                  {st}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <IconButton
            size="small"
            aria-label="Clear state filter"
            onClick={() => setLocationStateFilter('all')}
            disabled={locationStateFilter === 'all'}
            sx={{ height: 36, width: 36, p: 0.75 }}
          >
            <ClearIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>

      {/* Companies Table */}
      <CompanyTable
        companies={paginatedCompanies}
        loading={loading}
        columns={{
          favorites: true,
          avatar: true,
          companyName: true,
          contacts: true,
          deals: true,
          pipelineValue: true,
          headquarters: true,
          salespeople: true,
        }}
        sortField={sortField}
        sortDirection={sortDirection}
        onSort={handleSort}
        onRowClick={handleViewCompany}
        isFavorite={isFavorite}
        toggleFavorite={toggleFavorite}
        getAvatarColor={getAvatarColor}
        getAvatarTextColor={getAvatarTextColor}
        getCompanyContacts={getCompanyContacts}
        getCompanyDeals={getCompanyDeals}
        getCompanyPipelineValue={getCompanyPipelineValue}
        getCompanySalespeople={getCompanySalespeople}
        formatCurrency={formatCurrency}
        emptyStateMessage="No companies found"
        emptyStateAction={
          filteredSortedCompanies.length === 0 && !loading ? (
            <Box sx={{ textAlign: 'center' }}>
              <Box
                sx={{
                  width: 120,
                  height: 120,
                  borderRadius: '50%',
                  backgroundColor: '#F3F4F6',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  mb: 3,
                  mx: 'auto',
                }}
              >
                <BusinessIcon sx={{ fontSize: 48, color: '#9CA3AF' }} />
              </Box>
              <Typography variant="h6" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>
                No companies yet
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Add your first company to start building your CRM
              </Typography>
              <Button
                variant="contained"
                color="primary"
                startIcon={<AddIcon />}
                onClick={handleAddNew}
                sx={{
                  borderRadius: 1,
                  textTransform: 'none',
                  fontWeight: 500,
                }}
              >
                Add Your First Company
              </Button>
            </Box>
          ) : undefined
        }
        pagination={{
          count: filteredSortedCompanies.length,
          page,
          rowsPerPage,
          onPageChange: (_e, newPage) => setPage(newPage),
          onRowsPerPageChange: (e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          },
        }}
      />

      {/* Company Dialog */}
      <Dialog 
        open={showCompanyDialog} 
        onClose={() => {
          if (!savingCompany) {
            setShowCompanyDialog(false);
            setError('');
            if (searchParams.get('new') === '1') {
              setSearchParams({});
            }
          }
        }} 
        maxWidth="md" 
        fullWidth
      >
        <DialogTitle>
          {editingCompany ? 'Edit Company' : 'Add New Company'}
        </DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
              {error}
            </Alert>
          )}
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Company Name"
                value={companyForm.name}
                onChange={(e) => setCompanyForm(prev => ({ ...prev, name: e.target.value }))}
                required
                disabled={savingCompany}
                error={!!error && !companyForm.name.trim()}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Website"
                value={companyForm.website}
                onChange={(e) => setCompanyForm(prev => ({ ...prev, website: e.target.value }))}
                placeholder="https://example.com"
                disabled={savingCompany}
              />
            </Grid>
            <Grid item xs={12}>
              <Autocomplete
                options={allCompanies}
                getOptionLabel={(option) => option.companyName || option.name || ''}
                value={allCompanies.find((c) => c.id === companyForm.parentCompany) || null}
                onChange={(event, newValue) => {
                  setCompanyForm(prev => ({ ...prev, parentCompany: newValue?.id || '' }));
                }}
                loading={loadingAllCompanies}
                disabled={savingCompany}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Parent Company"
                    placeholder="Select a parent company (optional)"
                  />
                )}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={() => {
              setShowCompanyDialog(false);
              setError('');
            }} 
            disabled={savingCompany}
          >
            Cancel
          </Button>
          <Button 
            onClick={handleSaveCompany} 
            variant="contained" 
            disabled={savingCompany || !companyForm.name.trim()}
          >
            {savingCompany ? <CircularProgress size={20} /> : 'Save Company'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbars */}
      <Snackbar open={!!error && !showCompanyDialog} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          {successMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default RecruiterCompanies;
