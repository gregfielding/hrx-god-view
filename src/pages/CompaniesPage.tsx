import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Box, 
  TextField, 
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  Autocomplete,
  CircularProgress,
  Alert,
  Snackbar,
  Typography
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import { collection, query, where, orderBy, limit, getDocs, startAfter, addDoc, serverTimestamp, doc, getDoc } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';
import PageHeader from '../components/PageHeader';
import CompanyTable from '../components/CompanyTable';
import InboxSearchBar from '../components/InboxSearchBar';
import FavoritesFilter from '../components/FavoritesFilter';
import { useFavorites } from '../hooks/useFavorites';
import { usePageCache } from '../hooks/usePageCache';
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
  
  // Page cache for search and filters
  const { cacheState, updateCache, getCachedResults } = usePageCache({
    pageKey: 'companies',
    defaultState: {
      search: '',
      companyFilter: 'all',
      locationStateFilter: 'all',
      showFavoritesOnly: false,
    },
  });
  
  // State - initialize from cache (including cached results)
  const cachedResults = getCachedResults();
  const [companies, setCompanies] = useState<any[]>(cachedResults || []);
  const [contacts, setContacts] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [salesTeam, setSalesTeam] = useState<any[]>([]);
  const [search, setSearch] = useState(cacheState.search || '');
  const [companyFilter, setCompanyFilter] = useState<'all' | 'my'>(cacheState.companyFilter || 'all');
  const [locationStateFilter, setLocationStateFilter] = useState<string>(cacheState.locationStateFilter || 'all');
  const [companiesLoading, setCompaniesLoading] = useState(!cachedResults); // Don't show loading if we have cached results
  const [companiesLastDoc, setCompaniesLastDoc] = useState<any>(null);
  const [companiesHasMore, setCompaniesHasMore] = useState(true);
  const [companiesPageSize] = useState(20);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(cacheState.showFavoritesOnly || false);
  
  // Pagination state for inbox spec
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  
  // Add Company Dialog state
  const [showAddCompanyDialog, setShowAddCompanyDialog] = useState(false);
  const [companyForm, setCompanyForm] = useState({
    name: '',
    website: '',
    parentCompany: ''
  });
  const [savingCompany, setSavingCompany] = useState(false);
  const [allCompanies, setAllCompanies] = useState<any[]>([]);
  const [loadingAllCompanies, setLoadingAllCompanies] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  
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
      
      // Advanced filter: Companies with at least one location in selected state
      if (selectedState && selectedState !== 'all') {
        console.log('🔍 Companies state filter active:', { selectedState });
        
        // Fast path using mirror collection: tenants/{tenantId}/company_locations
        const locationsRef = collection(db, 'tenants', tenantId, 'company_locations');
        const locQ = query(locationsRef, where('stateCode', '==', selectedState));
        const locSnap = await getDocs(locQ);
        console.log(`📍 Found ${locSnap.docs.length} location documents in mirror collection for state ${selectedState}`);
        const companyIdSet = new Set<string>();
        locSnap.docs.forEach(d => {
          const data: any = d.data();
          if (data?.companyId) companyIdSet.add(data.companyId);
        });

        const ids = Array.from(companyIdSet);
        console.log(`📍 Found ${ids.length} unique company IDs from mirror collection`);

        // Fallback: if mirror has no entries for this state, scan company subcollections directly
        if (ids.length === 0) {
          // Map for full state names by code
          const STATE_BY_CODE: Record<string, string> = {
            AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming'
          };
          const code = selectedState;
          const full = STATE_BY_CODE[code] || code;
          const variants = [code, code.toLowerCase(), (full || '').toString(), (full || '').toString().toLowerCase(), (full || '').toString().toUpperCase()];

          const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
          const allCompaniesQuery = query(companiesRef, orderBy('companyName', 'asc'));
          const allCompaniesSnapshot = await getDocs(allCompaniesQuery);

          const validated: any[] = [];
          for (const companyDoc of allCompaniesSnapshot.docs) {
            try {
              const cData = companyDoc.data();
              const c = { id: companyDoc.id, ...cData } as any;
              const locRef = collection(db, 'tenants', tenantId, 'crm_companies', companyDoc.id, 'locations');
              let exists = false;
              try {
                const s1 = await getDocs(query(locRef, where('stateCode', '==', code), limit(1)));
                exists = !s1.empty;
              } catch {}
              if (!exists) {
                try {
                  const s2 = await getDocs(query(locRef, where('state', 'in', variants.slice(0, 10)), limit(1)));
                  exists = !s2.empty;
                } catch {}
              }
              if (!exists) {
                try {
                  const s3 = await getDocs(query(locRef, where('address.state', 'in', variants.slice(0, 10)), limit(1)));
                  exists = !s3.empty;
                } catch {}
              }
              if (exists) validated.push(c);
            } catch {}
          }

          const searchLower = searchQuery.trim().toLowerCase();
          const companiesData = validated.filter((company: any) => {
            if (filterByUser && currentUser?.uid) {
              if (company.accountOwnerId !== currentUser.uid) return false;
            }
            if (!searchLower) return true;
            const companyName = (company.companyName || company.name || '').toLowerCase();
            const companyUrl = (company.companyUrl || company.url || '').toLowerCase();
            const city = (company.city || '').toLowerCase();
            const industry = (company.industry || '').toLowerCase();
            return companyName.includes(searchLower) || companyUrl.includes(searchLower) || city.includes(searchLower) || industry.includes(searchLower);
          });

          const resultData = companiesData;
          if (append) {
            setCompanies(prev => [...prev, ...resultData]);
          } else {
            setCompanies(resultData);
            // Cache the results
            updateCache({ cachedResults: resultData });
          }
          setCompaniesHasMore(false);
          setCompaniesLastDoc(null);
          setCompaniesLoading(false);
          return;
        }

        // OPTIMIZED: Batch fetch companies using 'in' queries (much faster than individual getDoc calls)
        const companyDocs: any[] = [];
        const batchSize = 10; // Firestore limit for 'in' queries
        
        for (let i = 0; i < ids.length; i += batchSize) {
          const batch = ids.slice(i, i + batchSize);
          const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
          // Use __name__ to query by document ID
          const q = query(companiesRef, where('__name__', 'in', batch));
          const snapshot = await getDocs(q);
          snapshot.docs.forEach(doc => {
            companyDocs.push({ id: doc.id, ...doc.data() });
          });
        }
        
        // OPTIMIZATION: Skip re-validation since mirror collection is maintained by Cloud Functions
        // This saves 100+ subcollection queries. If validation is needed, it can be done in background.
        const validated = companyDocs;

        // Apply search and my filters client-side
        const searchLower = searchQuery.trim().toLowerCase();
        const companiesData = validated.filter((company: any) => {
          if (filterByUser && currentUser?.uid) {
            if (company.accountOwnerId !== currentUser.uid) return false;
          }
          if (!searchLower) return true;
          const companyName = (company.companyName || company.name || '').toLowerCase();
          const companyUrl = (company.companyUrl || company.url || '').toLowerCase();
          const city = (company.city || '').toLowerCase();
          const industry = (company.industry || '').toLowerCase();
          return companyName.includes(searchLower) || companyUrl.includes(searchLower) || city.includes(searchLower) || industry.includes(searchLower);
        });

        // When filtering by state, return full results (no pagination cap)
        const resultData = companiesData;
        console.log(`✅ Applying ${resultData.length} companies for state ${selectedState}`, {
          totalValidated: validated.length,
          afterUserFilter: companiesData.length,
          companyIds: resultData.map(c => c.id).slice(0, 5)
        });
        if (append) {
          setCompanies(prev => [...prev, ...resultData]);
        } else {
          setCompanies(resultData);
          // Cache the results
          updateCache({ cachedResults: resultData });
        }
        setCompaniesHasMore(false);
        setCompaniesLastDoc(null);
        setCompaniesLoading(false);
        return;
      }

      // Normal load (no state filter) - default to ascending alphabetical by companyName
      const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
      
      let q: any = query(companiesRef, orderBy('companyName', 'asc'), limit(companiesPageSize));
      
      if (startDoc) {
        q = query(companiesRef, orderBy('companyName', 'asc'), startAfter(startDoc), limit(companiesPageSize));
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
        // Cache the results (only for non-filtered loads)
        if (!filterByUser && !searchQuery) {
          updateCache({ cachedResults: newCompanies });
        }
      }
      
      setCompaniesLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
      setCompaniesHasMore(snapshot.docs.length === companiesPageSize);
    } catch (error: any) {
      console.error('Error loading companies:', error);
    } finally {
      setCompaniesLoading(false);
    }
  }, [tenantId, currentUser, locationStateFilter, companiesPageSize]);

  // Load all companies for parent company autocomplete
  useEffect(() => {
    if (!tenantId || !showAddCompanyDialog) return;
    
    const loadAllCompanies = async () => {
      setLoadingAllCompanies(true);
      try {
        const companiesRef = collection(db, 'tenants', tenantId, 'crm_companies');
        const snapshot = await getDocs(companiesRef);
        setAllCompanies(snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) })));
      } catch (error) {
        console.error('Error loading all companies:', error);
      } finally {
        setLoadingAllCompanies(false);
      }
    };
    
    loadAllCompanies();
  }, [tenantId, showAddCompanyDialog]);

  // Handle company form changes
  const handleCompanyFormChange = (field: string, value: any) => {
    setCompanyForm(prev => ({ ...prev, [field]: value }));
  };

  // Handle close dialog
  const handleCloseDialog = () => {
    if (!savingCompany) {
      setShowAddCompanyDialog(false);
      setCompanyForm({ name: '', website: '', parentCompany: '' });
      setError('');
    }
  };

  // Handle save company
  const handleSaveCompany = async () => {
    if (!tenantId || !currentUser) return;
    
    if (!companyForm.name) {
      setError('Company name is required');
      return;
    }

    setSavingCompany(true);
    setError('');
    try {
      const { parentCompany, ...rest } = companyForm as any;
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
          const fn = httpsCallable(getFunctions(), 'registerChildCompany');
          await fn({ tenantId, parentCompanyId: parentCompany, childCompanyId: newCompanyId });
        } catch (e) {
          console.warn('registerChildCompany failed', e);
        }
      }

      // Reset form and close dialog
      setCompanyForm({ name: '', website: '', parentCompany: '' });
      setShowAddCompanyDialog(false);
      setSuccess(true);
      setSuccessMessage('Company added successfully!');
      
      // Reload companies
      loadCompanies('', null, false, companyFilter === 'my');
    } catch (err: any) {
      console.error('Error adding company:', err);
      setError(err.message || 'Failed to add company');
    } finally {
      setSavingCompany(false);
    }
  };

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

  // Initial load and reload when filters change
  useEffect(() => {
    if (tenantId) {
      // Check if we have cached results that match current filters
      const cached = getCachedResults();
      if (cached && cached.length > 0) {
        // Restore cached results immediately (no loading spinner)
        setCompanies(cached);
        setCompaniesLoading(false);
      } else {
        // No cache, load fresh data
        setCompanies([]);
        setCompaniesLoading(true);
        loadCompanies('', null, false, companyFilter === 'my', locationStateFilter);
      }
    }
  }, [tenantId, companyFilter, locationStateFilter, loadCompanies, getCachedResults]);

  // Sorting state - default to ascending alphabetical by company name
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

  // Paginated companies (for inbox spec)
  const paginatedCompanies = React.useMemo(() => {
    const startIndex = page * rowsPerPage;
    const endIndex = startIndex + rowsPerPage;
    return filteredCompanies.slice(startIndex, endIndex);
  }, [filteredCompanies, page, rowsPerPage]);

  // Update cache when search or filters change (but don't clear cached results unless filters actually changed)
  const prevFiltersRef = useRef({ search, companyFilter, locationStateFilter, showFavoritesOnly });
  useEffect(() => {
    const filtersChanged = 
      prevFiltersRef.current.search !== search ||
      prevFiltersRef.current.companyFilter !== companyFilter ||
      prevFiltersRef.current.locationStateFilter !== locationStateFilter ||
      prevFiltersRef.current.showFavoritesOnly !== showFavoritesOnly;
    
    if (filtersChanged) {
      // Only clear cached results if filters actually changed
      updateCache({
        search,
        companyFilter,
        locationStateFilter,
        showFavoritesOnly,
        cachedResults: undefined,
        cachedResultsTimestamp: undefined,
      });
      prevFiltersRef.current = { search, companyFilter, locationStateFilter, showFavoritesOnly };
    } else {
      // Just update the cache state without clearing results
      updateCache({
        search,
        companyFilter,
        locationStateFilter,
        showFavoritesOnly,
      });
    }
  }, [search, companyFilter, locationStateFilter, showFavoritesOnly, updateCache]);

  // Reset page when search or filters change
  useEffect(() => {
    setPage(0);
  }, [search, showFavoritesOnly, locationStateFilter, companyFilter]);

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
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 2 }}>
            <Typography
              variant="h6"
              sx={{
                fontSize: { xs: '20px', md: '24px' },
                fontWeight: 600,
                lineHeight: 1.2,
              }}
            >
              Companies
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0 }}>
              <InboxSearchBar
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  updateCache({ search: value });
                }}
                onSearch={(value) => {
                  setSearch(value);
                  updateCache({ search: value });
                }}
                placeholder="Search companies..."
              />
              
              {/* Favorites filter */}
              <FavoritesFilter
                favoriteType="companies"
                showFavoritesOnly={showFavoritesOnly}
                onToggle={(value) => {
                  setShowFavoritesOnly(value);
                  updateCache({ showFavoritesOnly: value });
                }}
                showText={false}
                size="small"
                sx={{
                  minWidth: '32px',
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  '&:hover': {
                    backgroundColor: showFavoritesOnly ? 'primary.dark' : 'action.hover',
                  },
                }}
              />

              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setShowAddCompanyDialog(true)}
                sx={{
                  textTransform: 'none',
                  borderRadius: '24px',
                  px: 3,
                  py: 1,
                  height: '40px',
                  fontWeight: 500,
                  fontSize: '14px',
                  bgcolor: '#0057B8',
                  boxShadow: '0 2px 8px rgba(0, 87, 184, 0.25)',
                  '&:hover': {
                    bgcolor: '#004a9f',
                    boxShadow: '0 4px 12px rgba(0, 87, 184, 0.35)',
                  },
                  whiteSpace: 'nowrap',
                }}
              >
                Add Company
              </Button>
            </Box>
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
                  updateCache({ companyFilter: newFilter });
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
                  onChange={(e) => {
                    const newState = String(e.target.value);
                    setLocationStateFilter(newState);
                    updateCache({ locationStateFilter: newState });
                    // The useEffect will handle reloading when locationStateFilter changes
                  }}
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
                onClick={() => {
                  setLocationStateFilter('all');
                  updateCache({ locationStateFilter: 'all' });
                  // The useEffect will handle reloading when locationStateFilter changes
                }}
                disabled={locationStateFilter === 'all'}
                sx={{ height: 36, width: 36, p: 0.75 }}
              >
                <ClearIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>
        </Box>
        
        {/* Companies Table */}
        <Box sx={{ 
          px: 2, 
          pb: 2, 
          flex: 1, 
          minHeight: 0, 
          display: 'flex', 
          flexDirection: 'column',
          position: 'relative',
        }}>
          {/* Loading overlay */}
          {companiesLoading && (
            <Box
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(255, 255, 255, 0.8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
                borderRadius: '8px',
              }}
            >
              <CircularProgress size={40} />
            </Box>
          )}
          
          {/* No Results Found message */}
          {!companiesLoading && filteredCompanies.length === 0 && (
            <Box
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 999,
                flexDirection: 'column',
                gap: 2,
              }}
            >
              <Typography variant="h6" color="text.secondary" sx={{ fontWeight: 500 }}>
                No Results Found
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Try adjusting your search or filters
              </Typography>
            </Box>
          )}
          
          <CompanyTable
            companies={paginatedCompanies}
            loading={companiesLoading}
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
            useOuterScroll={false}
            square
            pagination={{
              count: filteredCompanies.length,
              page: page,
              rowsPerPage: rowsPerPage,
              onPageChange: (_, newPage) => setPage(newPage),
              onRowsPerPageChange: (e) => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setPage(0);
              },
            }}
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

      {/* Add Company Dialog */}
      <Dialog open={showAddCompanyDialog} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <DialogTitle>Add New Company</DialogTitle>
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
                onChange={(e) => handleCompanyFormChange('name', e.target.value)}
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
                onChange={(e) => handleCompanyFormChange('website', e.target.value)}
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
                  handleCompanyFormChange('parentCompany', newValue?.id || '');
                }}
                loading={loadingAllCompanies}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                disabled={savingCompany}
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
          <Button onClick={handleCloseDialog} disabled={savingCompany}>
            Cancel
          </Button>
          <Button 
            onClick={handleSaveCompany} 
            variant="contained" 
            disabled={savingCompany || !companyForm.name}
          >
            {savingCompany ? <CircularProgress size={20} /> : 'Save Company'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Success/Error Snackbars */}
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
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

export default CompaniesPage;
