import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
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
  CircularProgress,
  Autocomplete,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  FormControlLabel,
  Switch,
  Chip,
  Alert,
  Snackbar,
} from '@mui/material';
import {
  Clear as ClearIcon,
  Add as AddIcon,
  Email as EmailIcon,
  Phone as PhoneIcon,
  Business as BusinessIcon,
  LocationOn as LocationOnIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { collection, query, where, orderBy, getDocs, doc, getDoc, limit, startAfter, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useFavorites } from '../hooks/useFavorites';
import { usePageCache } from '../hooks/usePageCache';
import { formatPhoneNumber } from '../utils/formatPhone';
import ContactTable from '../components/ContactTable';
import ContactTableRow from '../components/ContactTableRow';
import type { RecruiterOutletContext } from './RecruiterDashboard';
import PageHeader from '../components/PageHeader';
import InboxSearchBar from '../components/InboxSearchBar';
import FavoritesFilter from '../components/FavoritesFilter';
import { normalizeUsStateCode } from '../utils/usStateNormalize';

interface Contact {
  id: string;
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  title: string;
  companyId: string;
  companyName?: string;
  locationId?: string;
  locationName?: string;
  role: string;
  status: string;
  /** Pipeline stage: contact, prospect, or lead */
  pipelineStage?: 'contact' | 'prospect' | 'lead' | null;
  tags: string[];
  createdAt?: any;
  updatedAt?: any;
}

const RecruiterContacts: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId, currentUser } = useAuth();
  const outletCtx = useOutletContext<RecruiterOutletContext | null>();
  
  // Page cache for search and filters
  const { cacheState, updateCache } = usePageCache({
    pageKey: 'contacts',
    defaultState: {
      companyFilter: 'all',
      roleFilter: 'all',
      statusFilter: 'all',
      pipelineFilter: 'contact',
      stateFilter: 'all',
      sortField: 'fullName',
      sortDirection: 'asc',
      searchQuery: '',
      page: 0,
      rowsPerPage: 20,
      showFavoritesOnly: false,
    },
  });
  
  // `RecruiterContacts` is used both within `RecruiterDashboard` (with outlet context)
  // AND as a standalone route at `/contacts` (no outlet context). Provide local fallbacks
  // so the search field is always editable.
  const [localSearch, setLocalSearch] = useState(cacheState.searchQuery || '');
  const [localShowFavoritesOnly, setLocalShowFavoritesOnly] = useState(cacheState.showFavoritesOnly || false);

  const headerSearch = outletCtx ? outletCtx.search : localSearch;
  const headerShowFavoritesOnly = outletCtx ? outletCtx.showFavoritesOnly : localShowFavoritesOnly;
  
  // Wrapped setters that update cache
  const setHeaderSearch = useCallback((value: string) => {
    if (outletCtx) {
      outletCtx.setSearch(value);
      updateCache({ searchQuery: value });
    } else {
      setLocalSearch(value);
      updateCache({ searchQuery: value });
    }
  }, [outletCtx, updateCache]);
  
  const setHeaderShowFavoritesOnly = useCallback((value: boolean) => {
    if (outletCtx) {
      outletCtx.setShowFavoritesOnly(value);
      updateCache({ showFavoritesOnly: value });
    } else {
      setLocalShowFavoritesOnly(value);
      updateCache({ showFavoritesOnly: value });
    }
  }, [outletCtx, updateCache]);

  // Only start searching after 3+ characters. Anything shorter behaves like "no search".
  const effectiveSearch = headerSearch.trim().length >= 3 ? headerSearch.trim() : '';
  
  // State - initialize from cache
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyFilter, setCompanyFilter] = useState<string>(cacheState.companyFilter || 'all');
  const [roleFilter, setRoleFilter] = useState<string>(cacheState.roleFilter || 'all');
  const [statusFilter, setStatusFilter] = useState<string>(cacheState.statusFilter || 'all');
  const [pipelineFilter, setPipelineFilter] = useState<string>(
    cacheState.pipelineFilter === 'prospect' || cacheState.pipelineFilter === 'lead'
      ? cacheState.pipelineFilter
      : 'contact'
  );
  const [stateFilter, setStateFilter] = useState<string>(() => {
    const raw = cacheState.stateFilter || 'all';
    if (raw === 'all') return 'all';
    return normalizeUsStateCode(raw) || 'all';
  });
  const [sortField, setSortField] = useState<string>(cacheState.sortField || 'fullName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(cacheState.sortDirection || 'asc');
  const [page, setPage] = useState(typeof cacheState.page === 'number' ? cacheState.page : 0);
  const [rowsPerPage, setRowsPerPage] = useState(typeof cacheState.rowsPerPage === 'number' ? cacheState.rowsPerPage : 20);
  
  // Pagination state
  const contactsPageSize = 50;
  const [contactsLastDoc, setContactsLastDoc] = useState<any>(null);
  const [contactsHasMore, setContactsHasMore] = useState(false);
  const loadingMoreRef = useRef(false);
  
  // Refs for sticky positioning
  const contentRef = useRef<HTMLDivElement | null>(null);
  const filtersRef = useRef<HTMLDivElement | null>(null);

  // Favorites
  const { favorites, isFavorite, toggleFavorite } = useFavorites('contacts');

  // Add Contact Dialog state
  const [showAddContactDialog, setShowAddContactDialog] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [contactForm, setContactForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    jobTitle: '',
    linkedinUrl: '',
    contactType: 'Unknown',
    isActive: true,
    tags: [] as string[],
    companyId: '',
    locationId: '',
  });
  const [companyLocations, setCompanyLocations] = useState<any[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const [contactSuccess, setContactSuccess] = useState(false);
  const firstNameInputRef = useRef<HTMLInputElement | null>(null);

  // Restore search from cache when using outlet context (on mount only)
  useEffect(() => {
    if (outletCtx) {
      if (cacheState.searchQuery && !outletCtx.search) {
        outletCtx.setSearch(cacheState.searchQuery);
      }
      if (cacheState.showFavoritesOnly !== undefined && outletCtx.showFavoritesOnly !== cacheState.showFavoritesOnly) {
        outletCtx.setShowFavoritesOnly(cacheState.showFavoritesOnly);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Sync outlet context changes to cache (when outletCtx manages search)
  useEffect(() => {
    if (outletCtx) {
      if (outletCtx.search !== headerSearch) {
        updateCache({ searchQuery: outletCtx.search });
      }
      if (outletCtx.showFavoritesOnly !== headerShowFavoritesOnly) {
        updateCache({ showFavoritesOnly: outletCtx.showFavoritesOnly });
      }
    }
  }, [outletCtx?.search, outletCtx?.showFavoritesOnly, headerSearch, headerShowFavoritesOnly, updateCache]);

  // Load contacts and companies
  useEffect(() => {
    if (tenantId) {
      loadCompanies();
      loadContacts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // Move focus into dialog as soon as it opens to avoid aria-hidden focus warnings.
  useEffect(() => {
    if (!showAddContactDialog) return;
    const timeoutId = window.setTimeout(() => {
      firstNameInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [showAddContactDialog]);

  // Reload contacts when search changes (reset pagination)
  // Note: Other filters (company, role, status, state) are applied client-side
  useEffect(() => {
    if (tenantId) {
      setContactsLastDoc(null);
      setContactsHasMore(false);
      loadContacts(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSearch]);

  // Load company locations when creating a contact (depends on selected company)
  useEffect(() => {
    if (!showAddContactDialog) return;
    if (!tenantId) return;

    const companyId = contactForm.companyId?.trim();
    if (!companyId) {
      setCompanyLocations([]);
      setLoadingLocations(false);
      return;
    }

    let cancelled = false;
    setLoadingLocations(true);
    setCompanyLocations([]);

    (async () => {
      const locationsRef = collection(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations');
      const q = query(locationsRef);
      const snap = await getDocs(q);

      const locations = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      locations.sort((a: any, b: any) => {
        const an = String(a.nickname || a.name || '').toLowerCase();
        const bn = String(b.nickname || b.name || '').toLowerCase();
        return an.localeCompare(bn);
      });

      if (!cancelled) setCompanyLocations(locations);
    })()
      .catch((err) => {
        console.error('Error loading company locations:', err);
        if (!cancelled) setCompanyLocations([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingLocations(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAddContactDialog, tenantId, contactForm.companyId]);

  // Update cache when filters, search, pagination change
  useEffect(() => {
    updateCache({
      companyFilter: companyFilter as any,
      roleFilter,
      statusFilter,
      pipelineFilter,
      stateFilter,
      sortField,
      sortDirection,
      searchQuery: headerSearch,
      page,
      rowsPerPage,
      showFavoritesOnly: headerShowFavoritesOnly,
    });
  }, [companyFilter, roleFilter, statusFilter, pipelineFilter, stateFilter, sortField, sortDirection, headerSearch, page, rowsPerPage, headerShowFavoritesOnly, updateCache]);

  // Reset UI pagination when filters/search/sort change (but preserve when navigating back)
  // Only reset if this is a new filter/search, not when restoring from cache
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return; // Don't reset on initial mount (cache will restore pagination)
    }
    setPage(0);
  }, [headerSearch, headerShowFavoritesOnly, companyFilter, roleFilter, statusFilter, pipelineFilter, stateFilter, sortField, sortDirection]);

  const loadCompanies = async () => {
    if (!tenantId) return;
    
    try {
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
    }
  };

  const loadContacts = async (append = false) => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    
    try {
      setLoading(true);
      const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
      
      // If searching, fetch ALL contacts and filter client-side (like CRM does)
      if (effectiveSearch) {
        const searchLower = effectiveSearch.toLowerCase();
        
        // Query ALL contacts without limit for comprehensive search
        const q = query(contactsRef, orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
          const contactsData: Contact[] = [];
          
          // First pass: collect all contact data and unique company/location IDs
          const companyIds = new Set<string>();
          const locationKeys = new Set<string>(); // Format: "companyId:locationId"
          
          for (const contactDoc of snapshot.docs) {
            const contactData = {
              id: contactDoc.id,
              ...contactDoc.data()
            } as Contact;
            
            // Ensure fullName exists
            if (!contactData.fullName && (contactData.firstName || contactData.lastName)) {
              contactData.fullName = `${contactData.firstName || ''} ${contactData.lastName || ''}`.trim();
            }
            
            if (contactData.companyId) {
              companyIds.add(contactData.companyId);
              if (contactData.locationId) {
                locationKeys.add(`${contactData.companyId}:${contactData.locationId}`);
              }
            }
            
            contactsData.push(contactData);
          }
          
          // Batch load all companies at once
          const companyMap = new Map<string, any>();
          if (companyIds.size > 0) {
            const companyPromises = Array.from(companyIds).map(async (companyId) => {
              try {
                const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId);
                const companySnap = await getDoc(companyRef);
                if (companySnap.exists()) {
                  const companyData = companySnap.data();
                  companyMap.set(companyId, {
                    companyName: companyData.companyName || companyData.name
                  });
                }
              } catch (error) {
                console.warn(`Error loading company ${companyId}:`, error);
              }
            });
            await Promise.all(companyPromises);
          }
          
          // Batch load all locations at once
          const locationMap = new Map<string, any>();
          if (locationKeys.size > 0) {
            const locationPromises = Array.from(locationKeys).map(async (key) => {
              const [companyId, locationId] = key.split(':');
              try {
                const locationRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations', locationId);
                const locationSnap = await getDoc(locationRef);
                if (locationSnap.exists()) {
                  const locationData = locationSnap.data();
                  locationMap.set(key, {
                    locationName: locationData.name || locationData.nickname
                  });
                }
              } catch (error) {
                console.warn(`Error loading location ${key}:`, error);
              }
            });
            await Promise.all(locationPromises);
          }
          
          // Second pass: enrich contacts with company and location names
          for (const contactData of contactsData) {
            if (contactData.companyId) {
              const companyInfo = companyMap.get(contactData.companyId);
              if (companyInfo) {
                contactData.companyName = companyInfo.companyName;
              }
              
              if (contactData.locationId) {
                const locationKey = `${contactData.companyId}:${contactData.locationId}`;
                const locationInfo = locationMap.get(locationKey);
                if (locationInfo) {
                  contactData.locationName = locationInfo.locationName;
                }
              }
            }
          }
          
          // Filter client-side for substring matching
          const filteredData = contactsData.filter((contact) => {
            const firstName = (contact.firstName || '').toLowerCase();
            const lastName = (contact.lastName || '').toLowerCase();
            const email = (contact.email || '').toLowerCase();
            const companyName = (contact.companyName || '').toLowerCase();
            
            return firstName.includes(searchLower) ||
                   lastName.includes(searchLower) ||
                   email.includes(searchLower) ||
                   companyName.includes(searchLower);
          });
          
          // Sort by relevance (exact matches first, then prefix matches)
          filteredData.sort((a, b) => {
            const aName = (a.fullName || `${a.firstName || ''} ${a.lastName || ''}` || '').toLowerCase();
            const bName = (b.fullName || `${b.firstName || ''} ${b.lastName || ''}` || '').toLowerCase();
            
            // Exact match gets highest priority
            if (aName === searchLower && bName !== searchLower) return -1;
            if (bName === searchLower && aName !== searchLower) return 1;
            
            // Prefix match gets second priority
            if (aName.startsWith(searchLower) && !bName.startsWith(searchLower)) return -1;
            if (bName.startsWith(searchLower) && !aName.startsWith(searchLower)) return 1;
            
            // Then sort alphabetically
            return aName.localeCompare(bName);
          });
          
          // Paginate results
          setContacts(filteredData);
          setContactsHasMore(false);
          setContactsLastDoc(null); // No lastDoc for search results
        } else {
          if (!append) {
            setContacts([]);
          }
          setContactsHasMore(false);
        }
      } else {
        // No search - load ALL contacts for proper pagination
        // This allows the pagination component to show the correct total count
        const q = query(contactsRef, orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
          const contactsData: Contact[] = [];
          
          // First pass: collect all contact data and unique company/location IDs
          const companyIds = new Set<string>();
          const locationKeys = new Set<string>(); // Format: "companyId:locationId"
          
          for (const contactDoc of snapshot.docs) {
            const contactData = {
              id: contactDoc.id,
              ...contactDoc.data()
            } as Contact;
            
            // Ensure fullName exists
            if (!contactData.fullName && (contactData.firstName || contactData.lastName)) {
              contactData.fullName = `${contactData.firstName || ''} ${contactData.lastName || ''}`.trim();
            }
            
            if (contactData.companyId) {
              companyIds.add(contactData.companyId);
              if (contactData.locationId) {
                locationKeys.add(`${contactData.companyId}:${contactData.locationId}`);
              }
            }
            
            contactsData.push(contactData);
          }
          
          // Batch load all companies at once
          const companyMap = new Map<string, any>();
          if (companyIds.size > 0) {
            const companyPromises = Array.from(companyIds).map(async (companyId) => {
              try {
                const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId);
                const companySnap = await getDoc(companyRef);
                if (companySnap.exists()) {
                  const companyData = companySnap.data();
                  companyMap.set(companyId, {
                    companyName: companyData.companyName || companyData.name
                  });
                }
              } catch (error) {
                console.warn(`Error loading company ${companyId}:`, error);
              }
            });
            await Promise.all(companyPromises);
          }
          
          // Batch load all locations at once
          const locationMap = new Map<string, any>();
          if (locationKeys.size > 0) {
            const locationPromises = Array.from(locationKeys).map(async (key) => {
              const [companyId, locationId] = key.split(':');
              try {
                const locationRef = doc(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations', locationId);
                const locationSnap = await getDoc(locationRef);
                if (locationSnap.exists()) {
                  const locationData = locationSnap.data();
                  locationMap.set(key, {
                    locationName: locationData.name || locationData.nickname
                  });
                }
              } catch (error) {
                console.warn(`Error loading location ${key}:`, error);
              }
            });
            await Promise.all(locationPromises);
          }
          
          // Second pass: enrich contacts with company and location names
          for (const contactData of contactsData) {
            if (contactData.companyId) {
              const companyInfo = companyMap.get(contactData.companyId);
              if (companyInfo) {
                contactData.companyName = companyInfo.companyName;
              }
              
              if (contactData.locationId) {
                const locationKey = `${contactData.companyId}:${contactData.locationId}`;
                const locationInfo = locationMap.get(locationKey);
                if (locationInfo) {
                  contactData.locationName = locationInfo.locationName;
                }
              }
            }
          }
          
          setContacts(prev => append ? [...prev, ...contactsData] : contactsData);
          // No more pagination needed since we loaded all contacts
          setContactsLastDoc(null);
          setContactsHasMore(false);
        } else {
          if (!append) {
            setContacts([]);
          }
          setContactsHasMore(false);
        }
      }
    } catch (error: any) {
      console.error('Error loading contacts:', error);
      setContacts([]);
      setContactsHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  // Prefetch more contacts when user paginates past loaded data (non-search mode)
  useEffect(() => {
    if (loadingMoreRef.current) return;
    if (headerSearch.trim()) return; // search mode has full dataset in memory
    if (!contactsHasMore) return;
    if (loading) return;

    const needCount = (page + 1) * rowsPerPage;
    if (needCount > contacts.length) {
      loadingMoreRef.current = true;
      loadContacts(true).finally(() => {
        loadingMoreRef.current = false;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, rowsPerPage, contacts.length, contactsHasMore, loading, headerSearch]);

  // Handle sorting
  const handleSort = (field: string) => {
    if (sortField === field) {
      const newDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      setSortDirection(newDirection);
      updateCache({ sortDirection: newDirection });
    } else {
      setSortField(field);
      setSortDirection('asc');
      updateCache({ sortField: field, sortDirection: 'asc' });
    }
  };

  // Get sortable value for a contact and field
  const getSortableValue = (contact: Contact, field: string) => {
    switch (field) {
      case 'fullName':
        return (contact.fullName || `${contact.firstName} ${contact.lastName}` || '').toLowerCase();
      case 'companyName':
        return (contact.companyName || '').toLowerCase();
      case 'title':
      case 'jobTitle':
        return (contact.title || '').toLowerCase();
      case 'role':
        return (contact.role || '').toLowerCase();
      case 'email':
        return (contact.email || '').toLowerCase();
      case 'phone':
        return (contact.phone || '').toLowerCase();
      default:
        return '';
    }
  };

  // Filter and sort contacts
  const filteredContacts = useMemo(() => {
    let filtered = contacts;
    
    // Apply favorites filter
    if (headerShowFavoritesOnly) {
      filtered = filtered.filter(contact => isFavorite(contact.id));
    }
    
    // Apply search filter (support multi-word: every token must match at least one field)
    if (effectiveSearch) {
      const tokens = effectiveSearch.toLowerCase().split(/\s+/).filter(Boolean);
      filtered = filtered.filter(contact => {
        const firstName = (contact.firstName || '').toLowerCase();
        const lastName = (contact.lastName || '').toLowerCase();
        const fullName = (contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || '').toLowerCase();
        const email = (contact.email || '').toLowerCase();
        const companyName = (contact.companyName || '').toLowerCase();
        return tokens.every(token =>
          firstName.includes(token) ||
          lastName.includes(token) ||
          fullName.includes(token) ||
          email.includes(token) ||
          companyName.includes(token)
        );
      });
    }
    
    // Apply company filter
    if (companyFilter !== 'all') {
      filtered = filtered.filter(contact => contact.companyId === companyFilter);
    }
    
    // Apply role filter
    if (roleFilter !== 'all') {
      filtered = filtered.filter(contact => contact.role === roleFilter);
    }
    
    // Apply status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(contact => contact.status === statusFilter);
    }
    
    // Apply pipeline stage tab filter (Contact / Prospect / Lead)
    // When searching, show results from ALL types so users can find anyone by name/email/company
    if (!effectiveSearch) {
      filtered = filtered.filter(contact => {
        const stage = contact.pipelineStage ?? 'contact';
        return stage === pipelineFilter;
      });
    }
    
    // Apply state filter (requires loading company data)
    if (stateFilter !== 'all') {
      const selectedCode = normalizeUsStateCode(stateFilter);
      filtered = filtered.filter(contact => {
        const company = companies.find(c => c.id === contact.companyId);
        const rawState = company?.state || company?.address?.state || '';
        const companyCode = normalizeUsStateCode(rawState);
        // Match both "NV" and "Nevada" (and ignore invalid state values like city names)
        return !!selectedCode && companyCode === selectedCode;
      });
    }
    
    // Sort the filtered contacts
    filtered.sort((a, b) => {
      const aValue = getSortableValue(a, sortField);
      const bValue = getSortableValue(b, sortField);
      
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    
    return filtered;
  }, [contacts, effectiveSearch, sortField, sortDirection, companyFilter, roleFilter, statusFilter, pipelineFilter, stateFilter, headerShowFavoritesOnly, isFavorite, companies, favorites]);

  const paginatedContacts = useMemo(() => {
    const start = page * rowsPerPage;
    return filteredContacts.slice(start, start + rowsPerPage);
  }, [filteredContacts, page, rowsPerPage]);

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

  // Get initials for avatar
  const getInitials = (contact: Contact) => {
    if (contact.fullName) {
      const parts = contact.fullName.trim().split(' ');
      if (parts.length >= 2) {
        return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
      }
      return contact.fullName[0].toUpperCase();
    }
    if (contact.firstName && contact.lastName) {
      return `${contact.firstName[0]}${contact.lastName[0]}`.toUpperCase();
    }
    return '?';
  };

  // Get role label
  const getRoleLabel = (role: string) => {
    return role.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  // Get role color
  const getRoleColor = (role: string) => {
    switch (role) {
      case 'decision_maker': return 'primary';
      case 'influencer': return 'success';
      case 'finance': return 'warning';
      case 'operations': return 'info';
      case 'hr': return 'secondary';
      default: return 'default';
    }
  };

  const handleViewContact = (contact: Contact) => {
    navigate(`/contacts/${contact.id}`);
  };

  const handleAddNew = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      active.blur();
    }
    setShowAddContactDialog(true);
  };

  const handleCloseAddContactDialog = () => {
    if (savingContact) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      active.blur();
    }
    setShowAddContactDialog(false);
  };

  const handleContactFormChange = (field: string, value: any) => {
    setContactForm(prev => ({ ...prev, [field]: value }));
  };

  const handleTagsChange = (newTags: string[]) => {
    setContactForm(prev => ({ ...prev, tags: newTags }));
  };

  const handleSaveContact = async () => {
    if (!tenantId) return;
    
    if (!contactForm.firstName || !contactForm.lastName) {
      setContactError('First name and last name are required');
      return;
    }

    setSavingContact(true);
    setContactError(null);

    try {
      // If email is provided, check for an existing contact with that email
      const emailTrimmed = (contactForm.email || '').trim();
      if (emailTrimmed) {
        const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
        const q = query(contactsRef, where('email', '==', emailTrimmed));
        const existingSnap = await getDocs(q);
        if (!existingSnap.empty) {
          const existing = existingSnap.docs[0].data();
          const name = existing.fullName || [existing.firstName, existing.lastName].filter(Boolean).join(' ') || 'Another contact';
          setContactError(`A contact with this email already exists in the system: ${name}. Please search for them or use a different email.`);
          setSavingContact(false);
          return;
        }
      }

      const selectedLocation =
        contactForm.companyId && contactForm.locationId
          ? companyLocations.find((l) => l.id === contactForm.locationId)
          : null;

      const contactData: any = {
        firstName: contactForm.firstName,
        lastName: contactForm.lastName,
        fullName: `${contactForm.firstName} ${contactForm.lastName}`,
        email: contactForm.email || '',
        phone: contactForm.phone || '',
        workPhone: contactForm.phone || '',
        jobTitle: contactForm.jobTitle || '',
        title: contactForm.jobTitle || '',
        linkedinUrl: (contactForm.linkedinUrl || '').trim(),
        contactType: contactForm.contactType,
        role: contactForm.contactType.toLowerCase().replace(' ', '_'),
        isActive: contactForm.isActive,
        tags: contactForm.tags,
        companyId: contactForm.companyId || '',
        locationId: contactForm.locationId || '',
        locationName: selectedLocation ? (selectedLocation.nickname || selectedLocation.name || '') : '',
        pipelineStage: 'contact',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      // If company is selected, add company association
      if (contactForm.companyId) {
        const company = companies.find(c => c.id === contactForm.companyId);
        contactData.companyName = company?.companyName || company?.name || '';
        contactData.associations = {
          companies: [contactForm.companyId],
        };
      }

      await addDoc(collection(db, 'tenants', tenantId, 'crm_contacts'), contactData);
      
      setContactSuccess(true);
      setShowAddContactDialog(false);
      setContactForm({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        jobTitle: '',
        linkedinUrl: '',
        contactType: 'Unknown',
        isActive: true,
        tags: [],
        companyId: '',
        locationId: '',
      });
      
      // Reload contacts
      loadContacts();
    } catch (error: any) {
      console.error('Error saving contact:', error);
      setContactError(error.message || 'Failed to save contact');
    } finally {
      setSavingContact(false);
    }
  };

  // Get unique roles from contacts
  const uniqueRoles = useMemo(() => {
    const roles = new Set<string>();
    contacts.forEach(contact => {
      if (contact.role) {
        roles.add(contact.role);
      }
    });
    return Array.from(roles).sort();
  }, [contacts]);

  // Get unique states from companies
  const uniqueStates = useMemo(() => {
    const states = new Set<string>();
    companies.forEach(company => {
      const state = company.state || company.address?.state;
      const code = normalizeUsStateCode(state);
      if (code) states.add(code);
    });
    return Array.from(states).sort();
  }, [companies]);

  const pipelineTabs = [
    { value: 'contact', label: 'Contacts' },
    { value: 'prospect', label: 'Prospects' },
    { value: 'lead', label: 'Leads' },
  ] as const;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <PageHeader
        hideHeading
        dense
        title=""
        filters={
          <Box sx={{ display: 'flex', gap: 0.35, alignItems: 'center', flexWrap: 'wrap' }}>
            {pipelineTabs.map((tab) => {
              const isActive = pipelineFilter === tab.value;
              return (
                <Button
                  key={tab.value}
                  variant="text"
                  onClick={() => {
                    setPipelineFilter(tab.value);
                    setPage(0);
                    updateCache({ pipelineFilter: tab.value });
                  }}
                  sx={{
                    textTransform: 'none',
                    borderRadius: '999px',
                    fontSize: '13px',
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? 'white' : 'rgba(0, 0, 0, 0.7)',
                    bgcolor: isActive ? '#0057B8' : 'rgba(0, 0, 0, 0.04)',
                    px: 1.25,
                    py: 0.5,
                    minHeight: 30,
                    minWidth: 'auto',
                    whiteSpace: 'nowrap',
                    '&:hover': {
                      bgcolor: isActive ? '#004a9f' : 'rgba(0, 0, 0, 0.08)',
                    },
                  }}
                >
                  {tab.label}
                </Button>
              );
            })}
          </Box>
        }
        rightActions={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0 }}>
            <FavoritesFilter
              favoriteType="contacts"
              showFavoritesOnly={headerShowFavoritesOnly}
              onToggle={setHeaderShowFavoritesOnly}
              showText={false}
              size="small"
              sx={{
                minWidth: '32px',
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                '&:hover': {
                  backgroundColor: headerShowFavoritesOnly ? 'primary.dark' : 'action.hover',
                },
              }}
            />
            <InboxSearchBar
              value={headerSearch}
              onChange={setHeaderSearch}
              onSearch={setHeaderSearch}
              placeholder="Search contacts..."
            />
            <Button
              variant="contained"
              startIcon={<AddIcon sx={{ fontSize: 16 }} />}
              onClick={handleAddNew}
              sx={{
                textTransform: 'none',
                borderRadius: '999px',
                px: 1.5,
                py: 0.5,
                minHeight: 30,
                height: 30,
                fontWeight: 600,
                fontSize: '13px',
                bgcolor: '#0057B8',
                boxShadow: 'none',
                '& .MuiButton-startIcon': { mr: 0.35 },
                '&:hover': {
                  bgcolor: '#004a9f',
                  boxShadow: '0 2px 8px rgba(0, 87, 184, 0.25)',
                },
                whiteSpace: 'nowrap',
              }}
            >
              Add Contact
            </Button>
          </Box>
        }
      />

      <Box
        ref={contentRef}
        sx={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          paddingTop: '8px',
          '&::-webkit-scrollbar': { width: '8px', height: '8px' },
          '&::-webkit-scrollbar-track': {
            background: 'rgba(0, 0, 0, 0.02)',
            borderRadius: '4px',
          },
          '&::-webkit-scrollbar-thumb': {
            background: 'rgba(0, 0, 0, 0.15)',
            borderRadius: '4px',
            '&:hover': { background: 'rgba(0, 0, 0, 0.25)' },
          },
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
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
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>

          {/* Company Filter */}
          <Autocomplete
            size="small"
            options={companies}
            getOptionLabel={(option) => option.companyName || option.name || 'Unnamed Company'}
            isOptionEqualToValue={(option, value) => option?.id === value?.id}
            value={companyFilter === 'all' ? null : companies.find(c => c.id === companyFilter) || null}
            onChange={(_, newValue) => {
              const newFilter = newValue?.id || 'all';
              setCompanyFilter(newFilter);
              updateCache({ companyFilter: newFilter });
            }}
            renderOption={(props, option) => (
              <li {...props} key={option.id}>
                {option.companyName || option.name || 'Unnamed Company'}
              </li>
            )}
            sx={{ 
              minWidth: 200,
              height: 36,
              '& .MuiOutlinedInput-root': {
                height: 36,
                borderRadius: '6px',
                backgroundColor: 'white',
                fontSize: '0.875rem',
              }
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Company"
                placeholder="All Companies"
              />
            )}
          />

          {/* Role Filter */}
          <FormControl size="small" sx={{ minWidth: 160, height: 36 }}>
            <InputLabel sx={{ fontSize: '0.875rem' }}>Role</InputLabel>
            <Select
              value={roleFilter}
              onChange={(e) => {
                const newFilter = String(e.target.value);
                setRoleFilter(newFilter);
                updateCache({ roleFilter: newFilter });
              }}
              label="Role"
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
              <MenuItem value="all">All Roles</MenuItem>
              {uniqueRoles.map((role) => (
                <MenuItem key={role} value={role}>{getRoleLabel(role)}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Status Filter */}
          <FormControl size="small" sx={{ minWidth: 140, height: 36 }}>
            <InputLabel sx={{ fontSize: '0.875rem' }}>Status</InputLabel>
            <Select
              value={statusFilter}
              onChange={(e) => {
                const newFilter = String(e.target.value);
                setStatusFilter(newFilter);
                updateCache({ statusFilter: newFilter });
              }}
              label="Status"
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
              <MenuItem value="all">All Status</MenuItem>
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="inactive">Inactive</MenuItem>
            </Select>
          </FormControl>

          {/* State Filter */}
          <FormControl size="small" sx={{ minWidth: 160, height: 36 }}>
            <InputLabel sx={{ fontSize: '0.875rem' }}>State</InputLabel>
            <Select
              value={stateFilter}
              onChange={(e) => {
                const newFilter = String(e.target.value);
                setStateFilter(newFilter);
                updateCache({ stateFilter: newFilter });
              }}
              label="State"
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
              {uniqueStates.map((state) => (
                <MenuItem key={state} value={state}>{state}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      </Box>
      
      {/* Contacts Table */}
      <Box sx={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Loading overlay */}
        {loading && (
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
        {!loading && filteredContacts.length === 0 && (
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
        
        <ContactTable
          contacts={paginatedContacts}
          loading={loading}
          square={true}
          columns={{
            favorites: true,
            name: true,
            jobTitle: true,
            role: true,
            contactInfo: true,
            company: true,
            location: true,
          }}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={handleSort}
        renderRow={(contact, index) => (
          <ContactTableRow
            key={contact.id}
            contact={contact}
            isFavorite={isFavorite}
            toggleFavorite={toggleFavorite}
            onRowClick={handleViewContact}
            getAvatarColor={getAvatarColor}
            getAvatarTextColor={getAvatarTextColor}
            getInitials={getInitials}
            columns={{
              favorites: true,
              name: true,
              jobTitle: true,
              role: true,
              contactInfo: true,
              company: true,
              location: true,
            }}
            companies={companies}
            locations={[]}
            getRoleLabel={getRoleLabel}
            getRoleColor={getRoleColor}
            rowIndex={index}
          />
        )}
        pagination={{
          count: filteredContacts.length,
          page,
          rowsPerPage,
          onPageChange: (_e, newPage) => setPage(newPage),
          onRowsPerPageChange: (e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          },
        }}
      />
      </Box>
      </Box>

      {/* Add Contact Dialog */}
      <Dialog open={showAddContactDialog} onClose={handleCloseAddContactDialog} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Typography variant="h6">Add New Contact</Typography>
            <IconButton onClick={handleCloseAddContactDialog} disabled={savingContact}>
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            {contactError && (
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setContactError(null)}>
                {contactError}
              </Alert>
            )}
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="First Name"
                  inputRef={firstNameInputRef}
                  value={contactForm.firstName}
                  onChange={(e) => handleContactFormChange('firstName', e.target.value)}
                  required
                  disabled={savingContact}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Last Name"
                  value={contactForm.lastName}
                  onChange={(e) => handleContactFormChange('lastName', e.target.value)}
                  required
                  disabled={savingContact}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Email"
                  type="email"
                  value={contactForm.email}
                  onChange={(e) => handleContactFormChange('email', e.target.value)}
                  disabled={savingContact}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Phone"
                  value={contactForm.phone}
                  onChange={(e) => handleContactFormChange('phone', e.target.value)}
                  disabled={savingContact}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Job Title"
                  value={contactForm.jobTitle}
                  onChange={(e) => handleContactFormChange('jobTitle', e.target.value)}
                  disabled={savingContact}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="LinkedIn URL"
                  placeholder="https://www.linkedin.com/in/username"
                  value={contactForm.linkedinUrl}
                  onChange={(e) => handleContactFormChange('linkedinUrl', e.target.value)}
                  disabled={savingContact}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Contact Type</InputLabel>
                  <Select
                    value={contactForm.contactType}
                    label="Contact Type"
                    onChange={(e) => handleContactFormChange('contactType', e.target.value)}
                    disabled={savingContact}
                  >
                    <MenuItem value="Decision Maker">Decision Maker</MenuItem>
                    <MenuItem value="Influencer">Influencer</MenuItem>
                    <MenuItem value="Gatekeeper">Gatekeeper</MenuItem>
                    <MenuItem value="Referrer">Referrer</MenuItem>
                    <MenuItem value="Evaluator">Evaluator</MenuItem>
                    <MenuItem value="Unknown">Unknown</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12}>
                <Autocomplete
                  size="small"
                  options={companies}
                  getOptionLabel={(option) => option.companyName || option.name || 'Unnamed Company'}
                  isOptionEqualToValue={(option, value) => option?.id === value?.id}
                  value={contactForm.companyId ? companies.find(c => c.id === contactForm.companyId) || null : null}
                  onChange={(_, newValue) => {
                    handleContactFormChange('companyId', newValue?.id || '');
                    // Company change invalidates location selection
                    handleContactFormChange('locationId', '');
                  }}
                  disabled={savingContact}
                  renderOption={(props, option) => (
                    <li {...props} key={option.id}>
                      {option.companyName || option.name || 'Unnamed Company'}
                    </li>
                  )}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Company"
                      placeholder="Select a company"
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12}>
                <Autocomplete
                  size="small"
                  options={companyLocations}
                  getOptionLabel={(option: any) => option.nickname || option.name || 'Unnamed Location'}
                  value={
                    contactForm.locationId
                      ? companyLocations.find((l) => l.id === contactForm.locationId) || null
                      : null
                  }
                  onChange={(_, newValue) => {
                    handleContactFormChange('locationId', newValue?.id || '');
                  }}
                  disabled={savingContact || loadingLocations || !contactForm.companyId}
                  noOptionsText={
                    !contactForm.companyId ? 'Select a company first' : 'No locations available for this company'
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Company Location"
                      placeholder={!contactForm.companyId ? 'Select a company first' : 'Select a location'}
                      helperText={
                        loadingLocations
                          ? 'Loading locations...'
                          : !contactForm.companyId
                            ? 'Select a company to choose a location'
                            : undefined
                      }
                    />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={contactForm.isActive}
                      onChange={(e) => handleContactFormChange('isActive', e.target.checked)}
                      color="primary"
                      disabled={savingContact}
                    />
                  }
                  label="Active Contact"
                />
              </Grid>
              <Grid item xs={12}>
                <Autocomplete
                  multiple
                  freeSolo
                  options={[]}
                  value={contactForm.tags}
                  onChange={(event, newValue) => handleTagsChange(newValue)}
                  disabled={savingContact}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip
                        key={`${option}-${index}`}
                        variant="outlined"
                        label={option}
                        {...getTagProps({ index })}
                        color="primary"
                      />
                    ))
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Tags"
                      placeholder="Add tags (e.g., Hospitality, Seasonal Hiring)"
                    />
                  )}
                />
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseAddContactDialog} disabled={savingContact}>
            Cancel
          </Button>
          <Button onClick={handleSaveContact} variant="contained" disabled={savingContact}>
            {savingContact ? 'Saving...' : 'Save Contact'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Success Snackbar */}
      <Snackbar
        open={contactSuccess}
        autoHideDuration={3000}
        onClose={() => setContactSuccess(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity="success" onClose={() => setContactSuccess(false)}>
          Contact added successfully!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default RecruiterContacts;
