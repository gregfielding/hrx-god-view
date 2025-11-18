import React, { useState, useEffect } from 'react';
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
  TextField,
  Button,
  Avatar,
  ToggleButtonGroup,
  ToggleButton,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  TableSortLabel,
  CircularProgress,
  Skeleton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid
} from '@mui/material';
import {
  Search as SearchIcon,
  Clear as ClearIcon,
  Add as AddIcon,
  Person as PersonIcon,
  Business as BusinessIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { collection, query, where, orderBy, limit, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import FavoritesFilter from '../components/FavoritesFilter';
import { useFavorites } from '../hooks/useFavorites';
import FavoriteButton from '../components/FavoriteButton';
import { BreadcrumbNav } from '../components/BreadcrumbNav';

const RecruiterCompanies: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId, currentUser } = useAuth();
  
  // State
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [locationStateFilter, setLocationStateFilter] = useState('all');
  const [sortField, setSortField] = useState<string>('companyName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showCompanyDialog, setShowCompanyDialog] = useState(false);
  const [editingCompany, setEditingCompany] = useState<any>(null);

  // Favorites
  const { favorites, isFavorite, toggleFavorite } = useFavorites('companies');

  // Load companies
  useEffect(() => {
    loadCompanies();
  }, [tenantId]);

  const loadCompanies = async () => {
    if (!tenantId) return;
    
    try {
      setLoading(true);
      const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
      const q = query(companiesRef, orderBy('companyName', 'asc'));
      
      const snapshot = await getDocs(q);
      const companiesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      setCompanies(companiesData);
    } catch (error) {
      console.error('Error loading companies:', error);
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

  // Filter and sort companies
  const filteredCompanies = React.useMemo(() => {
    let filtered = companies;
    
    // Apply favorites filter
    if (showFavoritesOnly) {
      filtered = filtered.filter(company => isFavorite(company.id));
    }
    
    // Apply search filter
    if (search.trim()) {
      const searchLower = search.toLowerCase().trim();
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
    
    // Sort the filtered companies
    filtered.sort((a, b) => {
      const aValue = getSortableValue(a, sortField);
      const bValue = getSortableValue(b, sortField);
      
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    
    return filtered;
  }, [companies, search, sortField, sortDirection, locationStateFilter, showFavoritesOnly, isFavorite]);

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

  const handleViewCompany = (company: any) => {
    navigate(`/recruiter/companies/${company.id}`);
  };

  const handleAddNew = () => {
    setEditingCompany(null);
    setShowCompanyDialog(true);
  };

  return (
    <Box>
      {/* Breadcrumbs */}
      <Box sx={{ mb: 2, pt: 1 }}>
        <BreadcrumbNav
          items={[
            { label: 'Recruiter', href: '/recruiter' },
            { label: 'Companies' }
          ]}
        />
      </Box>
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
      <TableContainer component={Paper} sx={{
        overflowX: 'auto',
        borderRadius: '8px',
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)'
      }}>
        {loading || companies.length === 0 ? (
          <Table sx={{ minWidth: 1200 }}>
            <TableHead>
              <TableRow sx={{ backgroundColor: '#F9FAFB' }}>
                <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E5E7EB', py: 1.5 }}>
                  <Skeleton variant="text" width={80} height={20} />
                </TableCell>
                <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E5E7EB', py: 1.5 }}>
                  <Skeleton variant="text" width={100} height={20} />
                </TableCell>
                <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E5E7EB', py: 1.5 }}>
                  <Skeleton variant="text" width={80} height={20} />
                </TableCell>
                <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E5E7EB', py: 1.5 }}>
                  <Skeleton variant="text" width={120} height={20} />
                </TableCell>
                <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E5E7EB', py: 1.5 }}>
                  <Skeleton variant="text" width={100} height={20} />
                </TableCell>
                <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E5E7EB', py: 1.5 }}>
                  <Skeleton variant="text" width={90} height={20} />
                </TableCell>
                <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E5E7EB', py: 1.5 }}>
                  <Skeleton variant="text" width={110} height={20} />
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {Array.from({ length: 8 }).map((_, index) => (
                <TableRow key={`skeleton-${index}`} sx={{ height: '48px' }}>
                  <TableCell sx={{ py: 1 }}>
                    <Skeleton variant="circular" width={24} height={24} />
                  </TableCell>
                  <TableCell sx={{ px: 2, py: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Skeleton variant="circular" width={32} height={32} />
                      <Skeleton variant="text" width={150} height={20} />
                    </Box>
                  </TableCell>
                  <TableCell sx={{ py: 1 }}>
                    <Skeleton variant="text" width={60} height={20} />
                  </TableCell>
                  <TableCell sx={{ py: 1 }}>
                    <Skeleton variant="text" width={100} height={20} />
                  </TableCell>
                  <TableCell sx={{ py: 1 }}>
                    <Skeleton variant="text" width={80} height={20} />
                  </TableCell>
                  <TableCell sx={{ py: 1 }}>
                    <Skeleton variant="text" width={70} height={20} />
                  </TableCell>
                  <TableCell sx={{ py: 1 }}>
                    <Skeleton variant="text" width={90} height={20} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Table sx={{ minWidth: 1200 }}>
            <TableHead>
              <TableRow sx={{ backgroundColor: '#F9FAFB' }}>
                <TableCell sx={{ 
                  fontSize: '0.75rem',
                  fontWeight: 600, 
                  color: '#374151',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '1px solid #E5E7EB',
                  py: 1.5
                }}>
                  Favorites
                </TableCell>
                <TableCell sx={{ 
                  fontSize: '0.75rem',
                  fontWeight: 600, 
                  color: '#374151',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '1px solid #E5E7EB',
                  py: 1.5
                }}>
                  <TableSortLabel
                    active={sortField === 'companyName'}
                    direction={sortField === 'companyName' ? sortDirection : 'asc'}
                    onClick={() => handleSort('companyName')}
                    sx={{ 
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#374151',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}
                  >
                    Company Name
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ 
                  fontSize: '0.75rem',
                  fontWeight: 600, 
                  color: '#374151',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '1px solid #E5E7EB',
                  py: 1.5
                }}>
                  Contacts
                </TableCell>
                <TableCell sx={{ 
                  fontSize: '0.75rem',
                  fontWeight: 600, 
                  color: '#374151',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '1px solid #E5E7EB',
                  py: 1.5
                }}>
                  Deals
                </TableCell>
                <TableCell sx={{ 
                  fontSize: '0.75rem',
                  fontWeight: 600, 
                  color: '#374151',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '1px solid #E5E7EB',
                  textAlign: 'right',
                  py: 1.5
                }}>
                  Pipeline Value
                </TableCell>
                <TableCell sx={{ 
                  fontSize: '0.75rem',
                  fontWeight: 600, 
                  color: '#374151',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '1px solid #E5E7EB',
                  textAlign: 'right',
                  py: 1.5
                }}>
                  Closed Value
                </TableCell>
                <TableCell sx={{ 
                  fontSize: '0.75rem',
                  fontWeight: 600, 
                  color: '#374151',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '1px solid #E5E7EB',
                  py: 1.5
                }}>
                  Salespeople
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredCompanies.map((company) => (
                <TableRow 
                  key={company.id} 
                  hover
                  onClick={() => handleViewCompany(company)}
                  sx={{ 
                    height: '48px',
                    cursor: 'pointer',
                    '&:hover': {
                      backgroundColor: '#F9FAFB'
                    }
                  }}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
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
                  </TableCell>
                  <TableCell sx={{ px: 2, py: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Avatar 
                        src={company.logo || company.logoUrl || company.logo_url || company.avatar}
                        sx={{ 
                          width: 32, 
                          height: 32,
                          backgroundColor: getAvatarColor(company.companyName || company.name || ''),
                          color: getAvatarTextColor(company.companyName || company.name || ''),
                          fontWeight: 600,
                          fontSize: '12px'
                        }}
                      >
                        {(company.companyName || company.name || '?').charAt(0).toUpperCase()}
                      </Avatar>
                      <Typography 
                        variant="body2" 
                        fontWeight={600} 
                        color="#111827"
                        sx={{ fontSize: '0.9375rem' }}
                      >
                        {company.companyName || company.name || company.legalName || '-'}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell sx={{ py: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <PersonIcon sx={{ color: '#9CA3AF', fontSize: 18 }} />
                      <Typography variant="body2" color="#6B7280" sx={{ fontSize: '0.875rem' }}>
                        0
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell sx={{ py: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <BusinessIcon sx={{ color: '#9CA3AF', fontSize: 18 }} />
                      <Typography variant="body2" color="#6B7280" sx={{ fontSize: '0.875rem' }}>
                        0
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell sx={{ py: 1, textAlign: 'right' }}>
                    <Typography variant="body2" color="#9CA3AF" sx={{ fontSize: '0.875rem' }}>-</Typography>
                  </TableCell>
                  <TableCell sx={{ py: 1, textAlign: 'right' }}>
                    <Typography variant="body2" color="#9CA3AF" sx={{ fontSize: '0.875rem' }}>-</Typography>
                  </TableCell>
                  <TableCell sx={{ py: 1 }}>
                    <Typography variant="body2" color="#6B7280" sx={{ fontSize: '0.875rem' }}>
                      {company.accountOwner || '-'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableContainer>

      {/* Loading State */}
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3, gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={20} />
            <Typography variant="body2" color="#6B7280">Loading companies...</Typography>
          </Box>
        </Box>
      )}

      {/* Empty State */}
      {filteredCompanies.length === 0 && !loading && (
        <Box sx={{ 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center', 
          py: 8,
          textAlign: 'center'
        }}>
          <Box sx={{ 
            width: 120, 
            height: 120, 
            borderRadius: '50%', 
            backgroundColor: '#F3F4F6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            mb: 3
          }}>
            <BusinessIcon sx={{ fontSize: 48, color: '#9CA3AF' }} />
          </Box>
          <Typography variant="h6" sx={{ fontWeight: 600, color: '#111827', mb: 1 }}>
            No companies yet
          </Typography>
          <Typography variant="body2" color="#6B7280" sx={{ mb: 3 }}>
            Add your first company to start building your CRM
          </Typography>
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={handleAddNew}
            sx={{
              borderRadius: '8px',
              textTransform: 'none',
              fontWeight: 500
            }}
          >
            Add Your First Company
          </Button>
        </Box>
      )}

      {/* Company Dialog */}
      <Dialog open={showCompanyDialog} onClose={() => setShowCompanyDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          {editingCompany ? 'Edit Company' : 'Add New Company'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Company Name"
                value={editingCompany?.companyName || ''}
                disabled
                sx={{ mb: 2 }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Industry"
                value={editingCompany?.industry || ''}
                disabled
                sx={{ mb: 2 }}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowCompanyDialog(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => setShowCompanyDialog(false)}>
            {editingCompany ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default RecruiterCompanies;
