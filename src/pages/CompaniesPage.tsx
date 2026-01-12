import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, TextField, InputAdornment, Button } from '@mui/material';
import { Search as SearchIcon, Add as AddIcon } from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import { collection, query, where, orderBy, limit, getDocs, startAfter } from 'firebase/firestore';
import { db } from '../firebase';
import PageHeader from '../components/PageHeader';
import CompanyTable from '../components/CompanyTable';
import { useFavorites } from '../hooks/useFavorites';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ToggleButton from '@mui/material/ToggleButton';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import IconButton from '@mui/material/IconButton';
import ClearIcon from '@mui/icons-material/Clear';
import BusinessIcon from '@mui/icons-material/Business';

const CompaniesPage: React.FC = () => {
  const { tenantId, currentUser } = useAuth();
  const navigate = useNavigate();
  const contentRef = useRef<HTMLDivElement | null>(null);
  
  // State
  const [companies, setCompanies] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [salesTeam, setSalesTeam] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState<'all' | 'my'>('all');
  const [locationStateFilter, setLocationStateFilter] = useState<string>('all');
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [companiesLastDoc, setCompaniesLastDoc] = useState<any>(null);
  const [companiesHasMore, setCompaniesHasMore] = useState(true);
  const [companiesPageSize] = useState(20);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  
  // Favorites
  const { isFavorite, toggleFavorite } = useFavorites('companies');
  const filtersRef = useRef<HTMLDivElement | null>(null);
  const [filtersHeight, setFiltersHeight] = useState<number>(0);
  const [isScrolled, setIsScrolled] = useState(false);

  // Measure filters height
  useEffect(() => {
    const update = () => setFiltersHeight(filtersRef.current?.offsetHeight ?? 0);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Track scroll state
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onScroll = () => setIsScrolled(el.scrollTop > 0);
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true } as any);
    return () => el.removeEventListener('scroll', onScroll as any);
  }, []);

  // Load companies
  const loadCompanies = useCallback(async (searchQuery = '', startDoc: any = null, append = false, filterByUser = false, stateOverride?: string) => {
    if (!tenantId) return;
    
    setCompaniesLoading(true);
    try {
      const selectedState = stateOverride ?? locationStateFilter;
      const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
      
      let q: any = query(companiesRef, orderBy('createdAt', 'desc'), limit(companiesPageSize));
      
      if (startDoc) {
        q = query(companiesRef, orderBy('createdAt', 'desc'), startAfter(startDoc), limit(companiesPageSize));
      }
      
      if (filterByUser && currentUser?.uid) {
        q = query(q, where('accountOwnerId', '==', currentUser.uid));
      }
      
      const snapshot = await getDocs(q);
      const newCompanies = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
      
      if (append) {
        setCompanies(prev => [...prev, ...newCompanies]);
      } else {
        setCompanies(newCompanies);
      }
      
      setCompaniesLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
      setCompaniesHasMore(snapshot.docs.length === companiesPageSize);
    } catch (error: any) {
      console.error('Error loading companies:', error);
    } finally {
      setCompaniesLoading(false);
    }
  }, [tenantId, currentUser, locationStateFilter, companiesPageSize]);

  // Load contacts and deals for calculations
  useEffect(() => {
    if (!tenantId) return;
    
    const loadContacts = async () => {
      try {
        const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
        const contactsQuery = query(contactsRef, limit(1000));
        const snapshot = await getDocs(contactsQuery);
        setContacts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch (error) {
        console.error('Error loading contacts:', error);
      }
    };
    
    const loadDeals = async () => {
      try {
        const dealsRef = collection(db, 'tenants', tenantId, 'crm_deals');
        const dealsQuery = query(dealsRef, limit(1000));
        const snapshot = await getDocs(dealsQuery);
        setDeals(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch (error) {
        console.error('Error loading deals:', error);
      }
    };
    
    const loadSalesTeam = async () => {
      try {
        const usersRef = collection(db, 'users');
        const usersQuery = query(usersRef, where('tenantIds.' + tenantId + '.securityLevel', '>=', 5), limit(100));
        const snapshot = await getDocs(usersQuery);
        setSalesTeam(snapshot.docs.map(doc => ({ id: doc.id, uid: doc.id, ...doc.data() })));
      } catch (error) {
        console.error('Error loading sales team:', error);
      }
    };
    
    loadContacts();
    loadDeals();
    loadSalesTeam();
  }, [tenantId]);

  // Initial load
  useEffect(() => {
    loadCompanies('', null, false, companyFilter === 'my');
  }, [tenantId, companyFilter]);

  // Sorting state
  const [sortField, setSortField] = useState<string>('companyName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Helper functions
  const getCompanyContacts = (companyId: string) => {
    return contacts.filter((contact: any) => {
      const assocCompanies = (contact.associations?.companies || []).map((c: any) => (typeof c === 'string' ? c : c?.id)).filter(Boolean);
      if (assocCompanies.includes(companyId)) return true;
      if (contact.companyId === companyId) return true;
      return false;
    });
  };

  const getCompanyDeals = (companyId: string) => {
    return deals.filter((deal: any) => {
      const dealCompanyIds = [
        deal.companyId,
        ...(deal.companies || []).map((c: any) => typeof c === 'string' ? c : c?.id).filter(Boolean)
      ].filter(Boolean);
      return dealCompanyIds.includes(companyId);
    });
  };

  const getSalespersonName = (salespersonId: string) => {
    const salesperson = salesTeam.find(sp => sp.id === salespersonId || sp.uid === salespersonId);
    return salesperson ? (salesperson.name || salesperson.displayName || salesperson.email) : salespersonId;
  };

  const getCompanyPipelineValue = (company: any) => {
    if (company.pipelineValue) {
      return {
        totalLow: company.pipelineValue.low || 0,
        totalHigh: company.pipelineValue.high || 0,
        dealCount: company.pipelineValue.dealCount || 0
      };
    }
    
    const companyDeals = getCompanyDeals(company.id);
    const pipelineDeals = companyDeals.filter(deal => 
      deal.status !== 'closed' && deal.status !== 'lost' && deal.expectedAnnualRevenueRange
    );
    
    let totalLow = 0;
    let totalHigh = 0;
    
    pipelineDeals.forEach(deal => {
      const range = deal.expectedAnnualRevenueRange;
      if (range && typeof range === 'string') {
        const match = range.match(/\$([\d,]+)\s*-\s*\$([\d,]+)/);
        if (match) {
          const low = parseInt(match[1].replace(/,/g, ''));
          const high = parseInt(match[2].replace(/,/g, ''));
          totalLow += low;
          totalHigh += high;
        }
      }
    });
    
    return { totalLow, totalHigh, dealCount: pipelineDeals.length };
  };

  const getCompanySalespeople = (company: any): string[] => {
    const names: string[] = [];
    const seen = new Set<string>();
    const addName = (label?: string) => {
      const v = (label || '').trim();
      if (!v) return;
      if (seen.has(v)) return;
      seen.add(v);
      names.push(v);
    };
    const assoc = company.associations?.salespeople || [];
    assoc.forEach((sp: any) => {
      if (typeof sp === 'string') {
        addName(getSalespersonName(sp));
      } else if (sp && typeof sp === 'object') {
        const full = [sp.firstName, sp.lastName].filter(Boolean).join(' ').trim();
        addName(sp.name || sp.displayName || full || sp.email || getSalespersonName(sp.id));
      }
    });
    if (names.length === 0) {
      addName(company.salesOwnerName);
      if (company.salesOwnerId) addName(getSalespersonName(company.salesOwnerId));
      if (company.accountOwnerId) addName(getSalespersonName(company.accountOwnerId));
      addName(company.accountOwner);
    }
    return names;
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getAvatarColor = (name: string) => {
    const colors = ['#F3F4F6', '#FEF3C7', '#DBEAFE', '#D1FAE5', '#FCE7F3', '#EDE9FE', '#FEE2E2', '#FEF5E7'];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  const getAvatarTextColor = (name: string) => {
    const colors = ['#6B7280', '#92400E', '#1E40AF', '#065F46', '#BE185D', '#5B21B6', '#DC2626', '#EA580C'];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  const getSortableValue = (company: any, field: string) => {
    switch (field) {
      case 'companyName':
        return (company.companyName || company.name || '').toLowerCase();
      case 'contacts':
        return getCompanyContacts(company.id).length;
      case 'deals':
        return getCompanyDeals(company.id).length;
      case 'pipelineValue': {
        const pipeline = getCompanyPipelineValue(company);
        return pipeline.totalLow + pipeline.totalHigh;
      }
      case 'accountOwner':
        return getCompanySalespeople(company)[0]?.toLowerCase() || '';
      default:
        return '';
    }
  };

  // Filter and sort companies
  const filteredCompanies = React.useMemo(() => {
    let filtered = companies;
    
    if (showFavoritesOnly) {
      filtered = filtered.filter(company => isFavorite(company.id));
    }
    
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
    
    filtered.sort((a, b) => {
      const aValue = getSortableValue(a, sortField);
      const bValue = getSortableValue(b, sortField);
      
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    
    return filtered;
  }, [companies, search, sortField, sortDirection, showFavoritesOnly, isFavorite]);

  const handleViewCompany = (company: any) => {
    navigate(`/companies/${company.id}`);
  };

  const handleLoadMore = () => {
    if (!companiesLoading && companiesHasMore && companiesLastDoc) {
      loadCompanies(search, companiesLastDoc, true, companyFilter === 'my');
    }
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PageHeader
        title="Companies"
        subtitle="Manage your company relationships"
        rightActions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/crm?tab=companies')}
            sx={{ textTransform: 'none' }}
          >
            Add Company
          </Button>
        }
        filters={
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', width: '100%' }}>
            <TextField
              placeholder="Search companies..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              size="small"
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
              sx={{ flex: 1, maxWidth: 400 }}
            />
          </Box>
        }
      />
      
      <Box
        ref={contentRef}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Filter & Toolbar Area */}
        <Box
          ref={filtersRef}
          sx={{ 
            mt: 0,
            mb: 0,
            px: 1.5,
            py: 1.25,
            backgroundColor: '#F9FAFB',
            borderRadius: 0,
            border: '1px solid #E5E7EB',
            borderBottom: '1px solid #EAEEF4',
            overflowX: 'auto',
            overflowY: 'hidden',
            position: 'sticky',
            top: 0,
            zIndex: 15,
          }}
        >
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'nowrap', minWidth: 'max-content' }}>
            <ToggleButtonGroup
              value={companyFilter}
              exclusive
              onChange={(event, newFilter) => {
                if (newFilter !== null) {
                  setCompanyFilter(newFilter);
                }
              }}
              size="small"
              sx={{ 
                height: 36,
                '& .MuiToggleButton-root': {
                  px: 2.5,
                  py: 0.75,
                  fontSize: '0.8125rem',
                  fontWeight: 500,
                  borderRadius: '18px',
                  border: '1px solid #E5E7EB',
                  color: '#6B7280',
                  backgroundColor: 'white',
                  '&.Mui-selected': {
                    backgroundColor: '#0B63C5',
                    color: 'white',
                  }
                },
              }}
            >
              <ToggleButton value="all">All Companies</ToggleButton>
              <ToggleButton value="my">My Companies</ToggleButton>
            </ToggleButtonGroup>

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
                onClick={() => setLocationStateFilter('all')}
                disabled={locationStateFilter === 'all'}
                sx={{ height: 36, width: 36, p: 0.75 }}
              >
                <ClearIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>
        </Box>
        
        {/* Companies Table */}
        <CompanyTable
          companies={filteredCompanies}
          loading={companiesLoading}
          hasMore={companiesHasMore}
          onLoadMore={handleLoadMore}
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
          stickyHeaderOffset={isScrolled ? filtersHeight : 0}
          useOuterScroll
          square
          emptyStateMessage="No companies found"
          emptyStateAction={
            filteredCompanies.length === 0 && !companiesLoading ? (
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
              </Box>
            ) : undefined
          }
        />
      </Box>
    </Box>
  );
};

export default CompaniesPage;
