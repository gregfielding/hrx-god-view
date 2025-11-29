import React, { useState, useEffect } from 'react';
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
  Search as SearchIcon,
  Clear as ClearIcon,
  Add as AddIcon,
  Business as BusinessIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { collection, query, orderBy, getDocs, addDoc, serverTimestamp, limit, startAfter, DocumentSnapshot } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { Autocomplete } from '@mui/material';
import FavoritesFilter from '../components/FavoritesFilter';
import { useFavorites } from '../hooks/useFavorites';
import CompanyTable from '../components/CompanyTable';
import { CircularProgress, Snackbar, Alert } from '@mui/material';

const RecruiterCompanies: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId, currentUser } = useAuth();
  
  // State
  const [companies, setCompanies] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [lastDoc, setLastDoc] = useState<DocumentSnapshot | null>(null);
  const companiesPageSize = 50; // Same as CRM
  const [search, setSearch] = useState('');
  const [locationStateFilter, setLocationStateFilter] = useState('all');
  const [sortField, setSortField] = useState<string>('companyName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
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

  // Favorites
  const { favorites, isFavorite, toggleFavorite } = useFavorites('companies');

  // Load companies when filters/search change
  useEffect(() => {
    if (tenantId) {
      loadCompanies('', null, false);
      loadAllCompanies();
      loadContacts();
    }
  }, [tenantId, search, locationStateFilter, showFavoritesOnly]);
  
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

  const loadCompanies = async (searchQuery = '', startDoc: DocumentSnapshot | null = null, append = false) => {
    if (!tenantId) return;
    
    setLoading(true);
    
    try {
      const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
      const hasActiveFilters = searchQuery.trim() || locationStateFilter !== 'all' || showFavoritesOnly;
      
      if (hasActiveFilters) {
        // When filtering/searching, query ALL companies and filter client-side
        const q = query(companiesRef, orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        
        let filtered = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as any[];
        
        // Apply search filter
        if (searchQuery.trim()) {
          const searchLower = searchQuery.toLowerCase().trim();
          filtered = filtered.filter(company => {
            const companyName = (company.companyName || company.name || '').toLowerCase();
            const companyUrl = (company.companyUrl || company.url || '').toLowerCase();
            const city = (company.city || '').toLowerCase();
            const industry = (company.industry || '').toLowerCase();
            
            return companyName.includes(searchLower) ||
                   companyUrl.includes(searchLower) ||
                   city.includes(searchLower) ||
                   industry.includes(searchLower);
          });
        }
        
        // Apply state filter
        if (locationStateFilter !== 'all') {
          filtered = filtered.filter(company => {
            const state = company.state || company.address?.state || '';
            return state === locationStateFilter;
          });
        }
        
        // Apply favorites filter
        if (showFavoritesOnly) {
          filtered = filtered.filter(company => isFavorite(company.id));
        }
        
        // Sort the filtered results
        filtered.sort((a, b) => {
          const aValue = getSortableValue(a, sortField);
          const bValue = getSortableValue(b, sortField);
          
          if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
          if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
          return 0;
        });
        
        // Apply pagination to filtered results
        if (!append) {
          const limitedData = filtered.slice(0, companiesPageSize);
          setCompanies(limitedData);
          setHasMore(filtered.length > companiesPageSize);
          setLastDoc(null); // Can't use lastDoc with filtered results
        } else {
          // For "Load More", we need to track how many we've already shown
          const currentCount = companies.length;
          const limitedData = filtered.slice(currentCount, currentCount + companiesPageSize);
          setCompanies(prev => [...prev, ...limitedData]);
          setHasMore(filtered.length > currentCount + limitedData.length);
        }
      } else {
        // No filters - use Firestore pagination
        const constraints: any[] = [orderBy('createdAt', 'desc'), limit(companiesPageSize)];
        
        if (startDoc) {
          constraints.push(startAfter(startDoc));
        }
        
        const q = query(companiesRef, ...constraints);
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
          const companiesData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          
          setCompanies(prev => append ? [...prev, ...companiesData] : companiesData);
          setLastDoc(snapshot.docs[snapshot.docs.length - 1]);
          setHasMore(snapshot.size === companiesPageSize);
        } else {
          if (!append) {
            setCompanies([]);
          }
          setHasMore(false);
        }
      }
    } catch (error) {
      console.error('Error loading companies:', error);
      setCompanies([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };
  
  const loadMoreCompanies = () => {
    if (hasMore && !loading) {
      const hasActiveFilters = search.trim() || locationStateFilter !== 'all' || showFavoritesOnly;
      if (hasActiveFilters) {
        // For filtered results, load more from the same filtered set
        loadCompanies(search, null, true);
      } else {
        // For normal pagination, use lastDoc
        loadCompanies('', lastDoc, true);
      }
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

  // Sort companies (filtering is now done in loadCompanies)
  const filteredCompanies = React.useMemo(() => {
    // Apply client-side sorting only (filtering is handled in loadCompanies)
    const sorted = [...companies];
    
    sorted.sort((a, b) => {
      const aValue = getSortableValue(a, sortField);
      const bValue = getSortableValue(b, sortField);
      
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    
    return sorted;
  }, [companies, sortField, sortDirection]);

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
    navigate(`/recruiter/companies/${company.id}`);
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
      setSuccess(true);
      setSuccessMessage('Company added successfully!');
      
      // Reload companies with current filters
      await loadCompanies(search, null, false);
      await loadAllCompanies();
    } catch (err: any) {
      console.error('Error adding company:', err);
      setError(err.message || 'Failed to add company');
    } finally {
      setSavingCompany(false);
    }
  };

  return (
    <Box>
      {/* Filter & Toolbar Area */}
      <Box sx={{ 
        mb: 2,
        p: 1.5,
        backgroundColor: '#F9FAFB',
        borderRadius: '8px',
        border: '1px solid #E5E7EB',
        borderBottom: '1px solid #D1D5DB'
      }}>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            size="small"
            variant="outlined"
            placeholder="Search by company name, URL, or city..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            sx={{ 
              width: 280,
              height: 36,
              '& .MuiOutlinedInput-root': {
                height: 36,
                borderRadius: '6px',
                backgroundColor: 'white',
                fontSize: '0.875rem',
                '& fieldset': {
                  borderColor: '#E5E7EB',
                },
                '&:hover fieldset': {
                  borderColor: '#D1D5DB',
                },
              }
            }}
            InputProps={{
              startAdornment: <SearchIcon sx={{ mr: 1, color: '#9CA3AF', fontSize: '18px' }} />,
              endAdornment: (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <FavoritesFilter
                    favoriteType="companies"
                    showFavoritesOnly={showFavoritesOnly}
                    onToggle={setShowFavoritesOnly}
                    showText={false}
                    size="small"
                    sx={{
                      minWidth: '32px',
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      '&:hover': {
                        backgroundColor: showFavoritesOnly ? 'primary.dark' : 'action.hover'
                      }
                    }}
                  />
                  {search && (
                    <IconButton
                      size="small"
                      onClick={() => setSearch('')}
                      sx={{ mr: 0.5, p: 0.5 }}
                    >
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  )}
                </Box>
              ),
            }}
          />

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
                {['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'].map((st) => (
                  <MenuItem key={st} value={st}>{st}</MenuItem>
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

          <Box sx={{ ml: 'auto' }}>
            <Button
              variant="contained"
              color="primary"
              startIcon={<AddIcon />}
              onClick={handleAddNew}
              sx={{
                height: 36,
                borderRadius: '6px',
                textTransform: 'none',
                fontWeight: 500,
                fontSize: '0.875rem',
                px: 2.5,
                py: 0.75
              }}
            >
              Add Company
            </Button>
          </Box>
        </Box>
      </Box>
      
      {/* Divider */}
      <Box sx={{ height: '1px', backgroundColor: '#E5E7EB', mb: 2 }} />

      {/* Companies Table */}
      <CompanyTable
        companies={filteredCompanies}
        loading={loading}
        hasMore={hasMore}
        onLoadMore={loadMoreCompanies}
        columns={{
          favorites: true,
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
          filteredCompanies.length === 0 && !loading ? (
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
      />

      {/* Company Dialog */}
      <Dialog 
        open={showCompanyDialog} 
        onClose={() => {
          if (!savingCompany) {
            setShowCompanyDialog(false);
            setError('');
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
