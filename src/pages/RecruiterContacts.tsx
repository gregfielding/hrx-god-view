import React, { useEffect, useMemo, useRef, useState } from 'react';
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
} from '@mui/material';
import {
  Clear as ClearIcon,
  Add as AddIcon,
  Email as EmailIcon,
  Phone as PhoneIcon,
  Business as BusinessIcon,
  LocationOn as LocationOnIcon,
} from '@mui/icons-material';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { collection, query, orderBy, getDocs, doc, getDoc, limit, startAfter } from 'firebase/firestore';
import { db } from '../firebase';
import { useFavorites } from '../hooks/useFavorites';
import { formatPhoneNumber } from '../utils/formatPhone';
import ContactTable from '../components/ContactTable';
import ContactTableRow from '../components/ContactTableRow';
import type { RecruiterOutletContext } from './RecruiterDashboard';

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
  tags: string[];
  createdAt?: any;
  updatedAt?: any;
}

const RecruiterContacts: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId, currentUser } = useAuth();
  const outletCtx = useOutletContext<RecruiterOutletContext | null>();
  const headerSearch = outletCtx?.search ?? '';
  const headerShowFavoritesOnly = outletCtx?.showFavoritesOnly ?? false;
  
  // State
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<string>('fullName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  
  // Pagination state
  const contactsPageSize = 50;
  const [contactsLastDoc, setContactsLastDoc] = useState<any>(null);
  const [contactsHasMore, setContactsHasMore] = useState(false);
  const loadingMoreRef = useRef(false);

  // Favorites
  const { favorites, isFavorite, toggleFavorite } = useFavorites('contacts');

  // Load contacts and companies
  useEffect(() => {
    if (tenantId) {
      loadCompanies();
      loadContacts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // Reload contacts when search changes (reset pagination)
  // Note: Other filters (company, role, status, state) are applied client-side
  useEffect(() => {
    if (tenantId) {
      setContactsLastDoc(null);
      setContactsHasMore(false);
      loadContacts(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headerSearch]);

  // Reset UI pagination when filters/search/sort change
  useEffect(() => {
    setPage(0);
  }, [headerSearch, headerShowFavoritesOnly, companyFilter, roleFilter, statusFilter, stateFilter, sortField, sortDirection]);

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
      if (headerSearch.trim()) {
        const searchLower = headerSearch.toLowerCase().trim();
        
        // Query ALL contacts without limit for comprehensive search
        const q = query(contactsRef, orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
          const contactsData: Contact[] = [];
          
          // Process all contacts
          for (const contactDoc of snapshot.docs) {
            const contactData = {
              id: contactDoc.id,
              ...contactDoc.data()
            } as Contact;
            
            // Ensure fullName exists
            if (!contactData.fullName && (contactData.firstName || contactData.lastName)) {
              contactData.fullName = `${contactData.firstName || ''} ${contactData.lastName || ''}`.trim();
            }
            
            // Load company name if companyId exists
            if (contactData.companyId) {
              try {
                const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', contactData.companyId);
                const companySnap = await getDoc(companyRef);
                if (companySnap.exists()) {
                  const companyData = companySnap.data();
                  contactData.companyName = companyData.companyName || companyData.name;
                }
              } catch (error) {
                console.warn(`Error loading company for contact ${contactData.id}:`, error);
              }
            }
            
            // Load location name if locationId exists
            if (contactData.locationId && contactData.companyId) {
              try {
                const locationRef = doc(db, 'tenants', tenantId, 'crm_companies', contactData.companyId, 'locations', contactData.locationId);
                const locationSnap = await getDoc(locationRef);
                if (locationSnap.exists()) {
                  const locationData = locationSnap.data();
                  contactData.locationName = locationData.name || locationData.nickname;
                }
              } catch (error) {
                console.warn(`Error loading location for contact ${contactData.id}:`, error);
              }
            }
            
            contactsData.push(contactData);
          }
          
          // Filter client-side for substring matching
          const filteredData = contactsData.filter((contact) => {
            const fullName = (contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}` || '').toLowerCase();
            const email = (contact.email || '').toLowerCase();
            const phone = (contact.phone || '').toLowerCase();
            const title = (contact.title || '').toLowerCase();
            const companyName = (contact.companyName || '').toLowerCase();
            
            return fullName.includes(searchLower) ||
                   email.includes(searchLower) ||
                   phone.includes(searchLower) ||
                   title.includes(searchLower) ||
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
        // No search - use normal pagination
        const constraints: any[] = [orderBy('createdAt', 'desc'), limit(contactsPageSize)];
        
        if (contactsLastDoc && append) {
          constraints.push(startAfter(contactsLastDoc));
        }
        
        const q = query(contactsRef, ...constraints);
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
          const contactsData: Contact[] = [];
          
          for (const contactDoc of snapshot.docs) {
            const contactData = {
              id: contactDoc.id,
              ...contactDoc.data()
            } as Contact;
            
            // Ensure fullName exists
            if (!contactData.fullName && (contactData.firstName || contactData.lastName)) {
              contactData.fullName = `${contactData.firstName || ''} ${contactData.lastName || ''}`.trim();
            }
            
            // Load company name if companyId exists
            if (contactData.companyId) {
              try {
                const companyRef = doc(db, 'tenants', tenantId, 'crm_companies', contactData.companyId);
                const companySnap = await getDoc(companyRef);
                if (companySnap.exists()) {
                  const companyData = companySnap.data();
                  contactData.companyName = companyData.companyName || companyData.name;
                }
              } catch (error) {
                console.warn(`Error loading company for contact ${contactData.id}:`, error);
              }
            }
            
            // Load location name if locationId exists
            if (contactData.locationId && contactData.companyId) {
              try {
                const locationRef = doc(db, 'tenants', tenantId, 'crm_companies', contactData.companyId, 'locations', contactData.locationId);
                const locationSnap = await getDoc(locationRef);
                if (locationSnap.exists()) {
                  const locationData = locationSnap.data();
                  contactData.locationName = locationData.name || locationData.nickname;
                }
              } catch (error) {
                console.warn(`Error loading location for contact ${contactData.id}:`, error);
              }
            }
            
            contactsData.push(contactData);
          }
          
          setContacts(prev => append ? [...prev, ...contactsData] : contactsData);
          setContactsLastDoc(snapshot.docs[snapshot.docs.length - 1]);
          setContactsHasMore(snapshot.size === contactsPageSize);
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
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
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
    
    // Apply search filter
    if (headerSearch.trim()) {
      const searchLower = headerSearch.toLowerCase().trim();
      filtered = filtered.filter(contact => {
        const fullName = (contact.fullName || `${contact.firstName} ${contact.lastName}` || '').toLowerCase();
        const email = (contact.email || '').toLowerCase();
        const phone = (contact.phone || '').toLowerCase();
        const title = (contact.title || '').toLowerCase();
        const companyName = (contact.companyName || '').toLowerCase();
        
        return fullName.includes(searchLower) ||
               email.includes(searchLower) ||
               phone.includes(searchLower) ||
               title.includes(searchLower) ||
               companyName.includes(searchLower);
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
    
    // Apply state filter (requires loading company data)
    if (stateFilter !== 'all') {
      filtered = filtered.filter(contact => {
        const company = companies.find(c => c.id === contact.companyId);
        const state = company?.state || company?.address?.state || '';
        return state === stateFilter;
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
  }, [contacts, headerSearch, sortField, sortDirection, companyFilter, roleFilter, statusFilter, stateFilter, headerShowFavoritesOnly, isFavorite, companies, favorites]);

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
    navigate(`/recruiter/contacts/${contact.id}`);
  };

  const handleAddNew = () => {
    // Navigate to CRM contacts page for now
    navigate('/crm/contacts');
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
      if (state) {
        states.add(state);
      }
    });
    return Array.from(states).sort();
  }, [companies]);

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
      {/* Filters (search + favorites + add are in the header per Inbox Standard) */}
      <Box sx={{ 
        mb: 2,
        p: 1.5,
        backgroundColor: '#F9FAFB',
        borderRadius: '8px',
        border: '1px solid #E5E7EB',
        borderBottom: '1px solid #D1D5DB'
      }}>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>

          {/* Company Filter */}
          <Autocomplete
            size="small"
            options={companies}
            getOptionLabel={(option) => option.companyName || option.name || 'Unnamed Company'}
            value={companyFilter === 'all' ? null : companies.find(c => c.id === companyFilter) || null}
            onChange={(_, newValue) => setCompanyFilter(newValue?.id || 'all')}
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
              onChange={(e) => setRoleFilter(String(e.target.value))}
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
              onChange={(e) => setStatusFilter(String(e.target.value))}
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
              onChange={(e) => setStateFilter(String(e.target.value))}
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
      <ContactTable
        contacts={paginatedContacts}
        loading={loading}
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

      {/* Empty State */}
      {filteredContacts.length === 0 && !loading && (
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
            <EmailIcon sx={{ fontSize: 48, color: '#9CA3AF' }} />
          </Box>
          <Typography variant="h6" sx={{ fontWeight: 600, color: '#111827', mb: 1 }}>
            No contacts found
          </Typography>
          <Typography variant="body2" color="#6B7280" sx={{ mb: 3 }}>
            {headerSearch || companyFilter !== 'all' || roleFilter !== 'all' || statusFilter !== 'all' || stateFilter !== 'all'
              ? 'Try adjusting your filters to see more results'
              : 'Add your first contact to start building your CRM'}
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
            Add Your First Contact
          </Button>
        </Box>
      )}
    </Box>
  );
};

export default RecruiterContacts;
