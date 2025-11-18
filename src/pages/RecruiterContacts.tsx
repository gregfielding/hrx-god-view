import React, { useState, useEffect, useMemo } from 'react';
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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  TableSortLabel,
  CircularProgress,
  Skeleton,
  Autocomplete,
  Chip,
} from '@mui/material';
import {
  Search as SearchIcon,
  Clear as ClearIcon,
  Add as AddIcon,
  Email as EmailIcon,
  Phone as PhoneIcon,
  Business as BusinessIcon,
  LocationOn as LocationOnIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { collection, query, orderBy, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import FavoritesFilter from '../components/FavoritesFilter';
import { useFavorites } from '../hooks/useFavorites';
import FavoriteButton from '../components/FavoriteButton';
import { formatPhoneNumber } from '../utils/formatPhone';
import { BreadcrumbNav } from '../components/BreadcrumbNav';

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
  
  // State
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<string>('fullName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  // Favorites
  const { favorites, isFavorite, toggleFavorite } = useFavorites('contacts');

  // Load contacts and companies
  useEffect(() => {
    if (tenantId) {
      loadCompanies();
      loadContacts();
    }
  }, [tenantId]);

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

  const loadContacts = async () => {
    if (!tenantId) {
      console.error('❌ Cannot load contacts: tenantId is missing');
      setLoading(false);
      return;
    }
    
    try {
      setLoading(true);
      console.log(`🔍 Loading contacts for tenant: ${tenantId}`);
      const contactsRef = collection(db, 'tenants', tenantId, 'crm_contacts');
      
      // Try to order by fullName first, fallback to createdAt if that fails
      let snapshot;
      try {
        const q = query(contactsRef, orderBy('fullName', 'asc'));
        snapshot = await getDocs(q);
        console.log(`✅ Loaded ${snapshot.docs.length} contacts (ordered by fullName)`);
      } catch (orderByError: any) {
        // If orderBy fails (e.g., missing index or field), try ordering by createdAt
        console.warn('⚠️ Failed to order by fullName, trying createdAt:', orderByError);
        try {
          const q = query(contactsRef, orderBy('createdAt', 'desc'));
          snapshot = await getDocs(q);
          console.log(`✅ Loaded ${snapshot.docs.length} contacts (ordered by createdAt)`);
        } catch (createdAtError: any) {
          // If that also fails, just get all contacts without ordering
          console.warn('⚠️ Failed to order by createdAt, loading without order:', createdAtError);
          snapshot = await getDocs(contactsRef);
          console.log(`✅ Loaded ${snapshot.docs.length} contacts (no ordering)`);
        }
      }
      
      const contactsData: Contact[] = [];
      
      for (const contactDoc of snapshot.docs) {
        const contactData = {
          id: contactDoc.id,
          ...contactDoc.data()
        } as Contact;
        
        // Ensure fullName exists (construct from firstName/lastName if needed)
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
      
      // Sort in memory by fullName if we couldn't order by it in the query
      contactsData.sort((a, b) => {
        const aName = (a.fullName || `${a.firstName || ''} ${a.lastName || ''}` || '').toLowerCase();
        const bName = (b.fullName || `${b.firstName || ''} ${b.lastName || ''}` || '').toLowerCase();
        return aName.localeCompare(bName);
      });
      
      console.log(`✅ Successfully processed ${contactsData.length} contacts`);
      setContacts(contactsData);
    } catch (error: any) {
      console.error('❌ Error loading contacts:', error);
      console.error('Error details:', {
        code: error?.code,
        message: error?.message,
        stack: error?.stack,
        tenantId
      });
      setContacts([]);
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

  // Get sortable value for a contact and field
  const getSortableValue = (contact: Contact, field: string) => {
    switch (field) {
      case 'fullName':
        return (contact.fullName || `${contact.firstName} ${contact.lastName}` || '').toLowerCase();
      case 'companyName':
        return (contact.companyName || '').toLowerCase();
      case 'title':
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
    if (showFavoritesOnly) {
      filtered = filtered.filter(contact => isFavorite(contact.id));
    }
    
    // Apply search filter
    if (search.trim()) {
      const searchLower = search.toLowerCase().trim();
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
  }, [contacts, search, sortField, sortDirection, companyFilter, roleFilter, statusFilter, stateFilter, showFavoritesOnly, isFavorite, companies]);

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
    <Box>
      {/* Breadcrumbs */}
      <Box sx={{ mb: 2, pt: 1 }}>
        <BreadcrumbNav
          items={[
            { label: 'Recruiter', href: '/recruiter' },
            { label: 'Contacts' }
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
            placeholder="Search contacts..."
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
                    favoriteType="contacts"
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
              Add Contact
            </Button>
          </Box>
        </Box>
      </Box>
      
      {/* Divider */}
      <Box sx={{ height: '1px', backgroundColor: '#E5E7EB', mb: 2 }} />

      {/* Contacts Table */}
      <TableContainer component={Paper} sx={{
        overflowX: 'auto',
        borderRadius: '8px',
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)'
      }}>
        {loading || contacts.length === 0 ? (
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
                    active={sortField === 'fullName'}
                    direction={sortField === 'fullName' ? sortDirection : 'asc'}
                    onClick={() => handleSort('fullName')}
                    sx={{ 
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#374151',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}
                  >
                    Contact Name
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
                    Company
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
                  Title
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
                  Role
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
                  Contact Info
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
                  Location
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredContacts.map((contact) => (
                <TableRow 
                  key={contact.id} 
                  hover
                  onClick={() => handleViewContact(contact)}
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
                      itemId={contact.id}
                      favoriteType="contacts"
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
                        sx={{ 
                          width: 32, 
                          height: 32,
                          backgroundColor: getAvatarColor(contact.fullName || contact.firstName || ''),
                          color: getAvatarTextColor(contact.fullName || contact.firstName || ''),
                          fontWeight: 600,
                          fontSize: '12px'
                        }}
                      >
                        {getInitials(contact)}
                      </Avatar>
                      <Typography 
                        variant="body2" 
                        fontWeight={600} 
                        color="#111827"
                        sx={{ fontSize: '0.9375rem' }}
                      >
                        {contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unnamed Contact'}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell sx={{ py: 1 }}>
                    {contact.companyName ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <BusinessIcon sx={{ color: '#9CA3AF', fontSize: 16 }} />
                        <Typography variant="body2" color="#6B7280" sx={{ fontSize: '0.875rem' }}>
                          {contact.companyName}
                        </Typography>
                      </Box>
                    ) : (
                      <Typography variant="body2" color="#9CA3AF" sx={{ fontSize: '0.875rem' }}>-</Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ py: 1 }}>
                    <Typography variant="body2" color="#6B7280" sx={{ fontSize: '0.875rem' }}>
                      {contact.title || '-'}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ py: 1 }}>
                    {contact.role ? (
                      <Chip
                        label={getRoleLabel(contact.role)}
                        size="small"
                        color={getRoleColor(contact.role) as any}
                        sx={{ height: 24, fontSize: '0.75rem' }}
                      />
                    ) : (
                      <Typography variant="body2" color="#9CA3AF" sx={{ fontSize: '0.875rem' }}>-</Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ py: 1 }}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      {contact.email && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <EmailIcon sx={{ color: '#9CA3AF', fontSize: 14 }} />
                          <Typography variant="body2" color="#6B7280" sx={{ fontSize: '0.875rem' }}>
                            {contact.email}
                          </Typography>
                        </Box>
                      )}
                      {contact.phone && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <PhoneIcon sx={{ color: '#9CA3AF', fontSize: 14 }} />
                          <Typography variant="body2" color="#6B7280" sx={{ fontSize: '0.875rem' }}>
                            {formatPhoneNumber(contact.phone)}
                          </Typography>
                        </Box>
                      )}
                      {!contact.email && !contact.phone && (
                        <Typography variant="body2" color="#9CA3AF" sx={{ fontSize: '0.875rem' }}>-</Typography>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell sx={{ py: 1 }}>
                    {contact.locationName ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <LocationOnIcon sx={{ color: '#9CA3AF', fontSize: 16 }} />
                        <Typography variant="body2" color="#6B7280" sx={{ fontSize: '0.875rem' }}>
                          {contact.locationName}
                        </Typography>
                      </Box>
                    ) : (
                      <Typography variant="body2" color="#9CA3AF" sx={{ fontSize: '0.875rem' }}>-</Typography>
                    )}
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
            <Typography variant="body2" color="#6B7280">Loading contacts...</Typography>
          </Box>
        </Box>
      )}

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
            {search || companyFilter !== 'all' || roleFilter !== 'all' || statusFilter !== 'all' || stateFilter !== 'all'
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
