import React from 'react';
import { Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Typography, Box, TableSortLabel, Chip, Avatar, Stack, Tooltip, Snackbar, Alert, FormControl, Select, MenuItem, Checkbox, ListItemText, OutlinedInput } from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import { getFunctions, httpsCallable } from 'firebase/functions';
import StandardTablePagination from '../components/StandardTablePagination';
import PersonIcon from '@mui/icons-material/Person';
import { TABLE_AVATAR_SIZE } from '../utils/uiConstants';
import { useAuth } from '../contexts/AuthContext';
import {
  TENANT_ROLE_DEFAULTS,
  TENANT_ROLE_DEFAULT_LABELS,
  TENANT_ROLE_DEFAULT_DESCRIPTIONS,
  TENANT_ROLE_DEFAULT_FIELD,
  tenantRoleDefaultMembershipForUser,
  type TenantRoleDefault,
  type TenantRoleDefaultsDoc,
} from '../shared/tenantRoleDefaults';

export interface WorkersTableProps {
  contacts: any[];
  locations: any[];
  departments: any[];
  divisions?: any[];
  regions?: any[];
  selectedWorkers: string[];
  handleWorkerSelection: (workerId: string) => void;
  handleSelectAll: () => void;
  navigateToUser: (userId: string) => void;
  contextType: 'agency' | 'customer';
  loading?: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  effectiveTenantId?: string; // Add tenant ID for nested data access
  /**
   * Live `tenants/{tid}/settings/roleDefaults` doc. Drives the inline
   * Roles chips. Optional — when undefined we render the chips as if
   * no one is assigned (still useful so the column lines up).
   */
  tenantRoleDefaults?: TenantRoleDefaultsDoc;
}

// Compact chip color per role — matches the legend used elsewhere in the
// admin UI so the chip means the same thing on every page.
const chipColorFor = (r: TenantRoleDefault): 'info' | 'success' | 'default' =>
  r === 'hrx_systems_operator' ? 'info'
  : r === 'payroll_coordinator' ? 'success'
  : 'default';

// Short labels — full names blow out the column width with four chips.
const chipShortLabel = (r: TenantRoleDefault): string => ({
  hrx_systems_operator: 'HRX Op',
  payroll_coordinator: 'Payroll',
  scheduler_fallback: 'Sched fb',
}[r]);

// Helper function to get tenant-dependent field from nested structure
const getTenantField = (contact: any, field: string, effectiveTenantId?: string) => {
  if (!effectiveTenantId || !contact.tenantIds?.[effectiveTenantId]) {
    return contact[field];
  }
  
  // Get from nested tenantIds structure first, fallback to direct field
  return contact.tenantIds[effectiveTenantId][field] || contact[field];
};

// Helper function to get security level label
const getSecurityLevelLabel = (level: string | number | undefined): string => {
  const levelStr = String(level || '0');
  switch (levelStr) {
    case '7': return 'Admin';
    case '6': return 'Manager';
    case '5': return 'Worker';
    case '4': return 'Hired Staff';
    case '3': return 'Flex';
    case '2': return 'Applicant';
    case '1': return 'Dismissed';
    case '0': return 'Suspended';
    default: return levelStr;
  }
};

// Helper function to get security level color
const getSecurityLevelColor = (level: string | number | undefined): 'default' | 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info' => {
  const levelStr = String(level || '0');
  switch (levelStr) {
    case '7': return 'primary';
    case '6': return 'secondary';
    case '5': return 'info';
    case '4': return 'success';
    case '3': return 'info';
    case '2': return 'default';
    case '1': return 'error';
    case '0': return 'error';
    default: return 'default';
  }
};

// Helper function to get module access chips for a user
const getModuleAccessChips = (contact: any, effectiveTenantId?: string): string[] => {
  const modules: string[] = [];
  
  // Check user-level module flags
  if (contact.recruiter || contact.tenantIds?.[effectiveTenantId || '']?.recruiter) {
    modules.push('Recruiter');
    // Jobs Board is included with Recruiter access, so don't show it separately
  }
  if (contact.crm_sales || contact.tenantIds?.[effectiveTenantId || '']?.crm_sales) {
    modules.push('CRM');
  }
  
  // Check for other common module flags
  if (contact.flex || contact.tenantIds?.[effectiveTenantId || '']?.flex) {
    modules.push('Flex');
  }
  
  return modules;
};

// Removed unused sortableColumns to satisfy TS6133

function getComparator(order: 'asc' | 'desc', orderBy: string, effectiveTenantId?: string) {
  return (a: any, b: any) => {
    let aValue = a[orderBy];
    let bValue = b[orderBy];
    // Special handling for department, location, city, state
    if (orderBy === 'department') {
      aValue = a.departmentId;
      bValue = b.departmentId;
    }
    if (orderBy === 'location') {
      aValue = (a.locationIds && a.locationIds[0]) || '';
      bValue = (b.locationIds && b.locationIds[0]) || '';
    }
  if (orderBy === 'division') {
    aValue = a.divisionId || '';
    bValue = b.divisionId || '';
  }
  if (orderBy === 'region') {
    aValue = a.regionId || '';
    bValue = b.regionId || '';
  }
  if (orderBy === 'securityLevel') {
    aValue = a.securityLevel || a.tenantIds?.[effectiveTenantId || '']?.securityLevel || '0';
    bValue = b.securityLevel || b.tenantIds?.[effectiveTenantId || '']?.securityLevel || '0';
  }
    if (aValue === undefined || aValue === null) aValue = '';
    if (bValue === undefined || bValue === null) bValue = '';
    if (aValue < bValue) return order === 'asc' ? -1 : 1;
    if (aValue > bValue) return order === 'asc' ? 1 : -1;
    return 0;
  };
}

const WorkersTable: React.FC<WorkersTableProps> = ({
  contacts,
  locations,
  departments,
  divisions = [],
  regions = [],
  selectedWorkers,
  handleWorkerSelection,
  handleSelectAll,
  navigateToUser,
  contextType,
  loading = false,
  search,
  onSearchChange,
  effectiveTenantId,
  tenantRoleDefaults,
}) => {
  const { tenantRolesFromProfile, securityLevel: callerActiveSecurityLevel } = useAuth();
  const [order, setOrder] = React.useState<'asc' | 'desc'>('asc');
  const [orderBy, setOrderBy] = React.useState<string>('firstName');
  const [page, setPage] = React.useState(0);
  const [rowsPerPage, setRowsPerPage] = React.useState(20);

  // Whether the *caller* (logged-in user) can edit role-defaults for this
  // tenant. The chips are still rendered for everyone — they're useful as
  // read-only context — but only level-5+ users get the click handler.
  const callerCanEditRoles = React.useMemo(() => {
    const raw =
      (effectiveTenantId && tenantRolesFromProfile?.[effectiveTenantId]?.securityLevel) ||
      callerActiveSecurityLevel ||
      '0';
    return parseInt(String(raw), 10) >= 5;
  }, [effectiveTenantId, tenantRolesFromProfile, callerActiveSecurityLevel]);

  // Optimistic overlay over the live `tenantRoleDefaults` doc. Keyed by
  // `${uid}:${role}`. We flip the chip immediately on click, then remove
  // the entry when the snapshot updates (or when the callable rejects and
  // we revert). Without this the chip would lag a network round-trip
  // behind the user's click.
  const [pendingMembership, setPendingMembership] = React.useState<
    Record<string, boolean>
  >({});
  // Tracks in-flight callables so we can disable the chip and avoid
  // double-fires on rapid clicks.
  const [busyChips, setBusyChips] = React.useState<Record<string, boolean>>({});

  // Snackbar for "Role updated" / error messages. Local — the parent
  // doesn't need to know about role-default writes.
  const [snackbar, setSnackbar] = React.useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error';
  }>({ open: false, message: '', severity: 'success' });

  const handleRoleChipClick = React.useCallback(
    async (uid: string, role: TenantRoleDefault, currentMember: boolean) => {
      if (!effectiveTenantId || !callerCanEditRoles) return;
      const key = `${uid}:${role}`;
      if (busyChips[key]) return;
      const next = !currentMember;
      setPendingMembership((prev) => ({ ...prev, [key]: next }));
      setBusyChips((prev) => ({ ...prev, [key]: true }));
      try {
        const fn = httpsCallable(getFunctions(), 'setTenantRoleDefaultMembership');
        await fn({ tenantId: effectiveTenantId, uid, role, isMember: next });
        setSnackbar({ open: true, message: 'Role updated', severity: 'success' });
        // Don't clear the optimistic entry yet — we wait for the next
        // onSnapshot tick from the parent so there's no flash back to the
        // old value. The effect below clears it once the doc agrees.
      } catch (err: any) {
        setPendingMembership((prev) => {
          const copy = { ...prev };
          delete copy[key];
          return copy;
        });
        setSnackbar({
          open: true,
          message: err?.message || 'Failed to update role',
          severity: 'error',
        });
      } finally {
        setBusyChips((prev) => {
          const copy = { ...prev };
          delete copy[key];
          return copy;
        });
      }
    },
    [effectiveTenantId, callerCanEditRoles, busyChips],
  );

  // Reconcile the optimistic overlay with the live doc — drop keys whose
  // pending value already matches the snapshot so subsequent renders read
  // straight from the doc.
  React.useEffect(() => {
    if (!tenantRoleDefaults) return;
    setPendingMembership((prev) => {
      let mutated = false;
      const next = { ...prev };
      for (const key of Object.keys(prev)) {
        const [uid, role] = key.split(':') as [string, TenantRoleDefault];
        const fieldName = TENANT_ROLE_DEFAULT_FIELD[role];
        const liveMembers = (tenantRoleDefaults as any)[fieldName] as
          | string[]
          | undefined;
        const liveIsMember = (liveMembers ?? []).includes(uid);
        if (liveIsMember === prev[key]) {
          delete next[key];
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });
  }, [tenantRoleDefaults]);

  const handleRequestSort = (property: string) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  const filteredContacts = React.useMemo(() => {
    if (!search) return contacts;
    const q = search.toLowerCase();
    return contacts.filter((c) =>
      (c.firstName || '').toLowerCase().includes(q) ||
      (c.lastName || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q)
    );
  }, [contacts, search]);

  const sortedContacts = React.useMemo(() => {
    const data = [...filteredContacts];
    if (orderBy === 'department') {
      data.sort((a, b) => {
        const aDept = departments.find((dept: any) => dept.id === a.departmentId)?.name || '';
        const bDept = departments.find((dept: any) => dept.id === b.departmentId)?.name || '';
        if (aDept < bDept) return order === 'asc' ? -1 : 1;
        if (aDept > bDept) return order === 'asc' ? 1 : -1;
        return 0;
      });
    } else if (orderBy === 'location') {
      data.sort((a, b) => {
        const getLocationName = (contact: any) => {
          // First check if there's a direct locationName field
          if (contact.locationName) {
            return contact.locationName;
          }
          
          // Then check for locationId (singular)
          if (contact.locationId) {
            const location = locations.find((loc: any) => loc.id === contact.locationId);
            return location ? (location.nickname || location.name) : '';
          }
          
          // Finally check for locationIds (plural array) - legacy support
          if (contact.locationIds && contact.locationIds.length > 0) {
            return locations
              .filter((loc: any) => contact.locationIds.includes(loc.id))
              .map((loc: any) => loc.nickname || loc.name)
              .join(', ');
          }
          
          return '';
        };
        
        const aLoc = getLocationName(a);
        const bLoc = getLocationName(b);
        if (aLoc < bLoc) return order === 'asc' ? -1 : 1;
        if (aLoc > bLoc) return order === 'asc' ? 1 : -1;
        return 0;
      });
           } else if (orderBy === 'division') {
             data.sort((a, b) => {
               const aDiv = divisions.find((div: any) => div.id === a.divisionId)?.name || '';
               const bDiv = divisions.find((div: any) => div.id === b.divisionId)?.name || '';
               if (aDiv < bDiv) return order === 'asc' ? -1 : 1;
               if (aDiv > bDiv) return order === 'asc' ? 1 : -1;
               return 0;
             });
           } else if (orderBy === 'region') {
             data.sort((a, b) => {
               // Get region name for contact a
               let aRegion = '';
               if (a.regionName) {
                 aRegion = a.regionName;
               } else if (a.regionId) {
                 aRegion = regions.find((region: any) => region.id === a.regionId)?.name || '';
               } else if (a.locationId) {
                 const location = locations.find((loc: any) => loc.id === a.locationId);
                 const regionId = location?.primaryContacts?.region || location?.region || location?.regionId;
                 if (regionId) {
                   aRegion = regions.find((region: any) => region.id === regionId)?.name || '';
                 }
               }
               
               // Get region name for contact b
               let bRegion = '';
               if (b.regionName) {
                 bRegion = b.regionName;
               } else if (b.regionId) {
                 bRegion = regions.find((region: any) => region.id === b.regionId)?.name || '';
               } else if (b.locationId) {
                 const location = locations.find((loc: any) => loc.id === b.locationId);
                 const regionId = location?.primaryContacts?.region || location?.region || location?.regionId;
                 if (regionId) {
                   bRegion = regions.find((region: any) => region.id === regionId)?.name || '';
                 }
               }
               
               if (aRegion < bRegion) return order === 'asc' ? -1 : 1;
               if (aRegion > bRegion) return order === 'asc' ? 1 : -1;
               return 0;
             });
           } else if (orderBy === 'securityLevel') {
             data.sort((a, b) => {
               const aLevel = getTenantField(a, 'securityLevel', effectiveTenantId) || '0';
               const bLevel = getTenantField(b, 'securityLevel', effectiveTenantId) || '0';
               // Convert to numbers for proper sorting (higher number = higher level)
               const aNum = parseInt(String(aLevel), 10);
               const bNum = parseInt(String(bLevel), 10);
               if (aNum < bNum) return order === 'asc' ? -1 : 1;
               if (aNum > bNum) return order === 'asc' ? 1 : -1;
               return 0;
             });
           } else {
      data.sort(getComparator(order, orderBy, effectiveTenantId));
    }
    return data;
  }, [filteredContacts, order, orderBy, departments, locations, divisions, regions, effectiveTenantId]);

  // Paginate sorted contacts
  const paginatedContacts = React.useMemo(() => {
    const start = page * rowsPerPage;
    return sortedContacts.slice(start, start + rowsPerPage);
  }, [sortedContacts, page, rowsPerPage]);

  // Reset page when search changes
  React.useEffect(() => {
    setPage(0);
  }, [search]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <Typography>Loading workers...</Typography>
      </Box>
    );
  }

  const getInitials = (firstName?: string, lastName?: string) => {
    const f = (firstName || '').trim();
    const l = (lastName || '').trim();
    const first = f ? f[0] : '';
    const last = l ? l[0] : '';
    const initials = `${first}${last}`.toUpperCase();
    return initials || '?';
  };

  const getAvatarSrc = (contact: any): string | undefined => {
    return (
      contact.avatar ||
      contact.avatarUrl ||
      contact.photoURL ||
      contact.photoUrl ||
      contact.photo ||
      undefined
    );
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', px: 2 }}>
      <TableContainer 
        component={Paper}
        sx={{
          borderRadius: 2,
          position: 'relative',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'auto',
          width: '100%',
          // Custom scrollbar styling (lighter and thinner)
          '&::-webkit-scrollbar': {
            width: '8px',
            height: '8px',
          },
          '&::-webkit-scrollbar-track': {
            background: 'rgba(0, 0, 0, 0.02)',
            borderRadius: '4px',
          },
          '&::-webkit-scrollbar-thumb': {
            background: 'rgba(0, 0, 0, 0.15)',
            borderRadius: '4px',
            '&:hover': {
              background: 'rgba(0, 0, 0, 0.25)',
            },
          },
          // Firefox scrollbar styling
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
        }}
      >
      <Table size="small" stickyHeader sx={{ width: '100%' }}>
        <TableHead sx={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          backgroundColor: 'background.paper',
        }}>
          <TableRow sx={{ backgroundColor: 'background.paper' }}>
            {/* Avatar (no label) */}
            <TableCell sx={{ width: 56, minWidth: 56, maxWidth: 56, bgcolor: '#FFFFFF' }} />
            {/* First Name */}
            <TableCell 
              sortDirection={orderBy === 'firstName' ? order : false}
              sx={{ fontWeight: 700, bgcolor: '#FFFFFF' }}
            >
              <TableSortLabel
                active={orderBy === 'firstName'}
                direction={orderBy === 'firstName' ? order : 'asc'}
                onClick={() => handleRequestSort('firstName')}
              >
                First
              </TableSortLabel>
            </TableCell>
            {/* Last Name */}
            <TableCell 
              sortDirection={orderBy === 'lastName' ? order : false}
              sx={{ fontWeight: 700, bgcolor: '#FFFFFF' }}
            >
              <TableSortLabel
                active={orderBy === 'lastName'}
                direction={orderBy === 'lastName' ? order : 'asc'}
                onClick={() => handleRequestSort('lastName')}
              >
                Last
              </TableSortLabel>
            </TableCell>
            <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF' }}>Email</TableCell>
            <TableCell sx={{ minWidth: '140px', fontWeight: 700, bgcolor: '#FFFFFF' }}>Phone</TableCell>
            {/* Job Title */}
            <TableCell 
              sortDirection={orderBy === 'jobTitle' ? order : false}
              sx={{ fontWeight: 700, bgcolor: '#FFFFFF' }}
            >
              <TableSortLabel
                active={orderBy === 'jobTitle'}
                direction={orderBy === 'jobTitle' ? order : 'asc'}
                onClick={() => handleRequestSort('jobTitle')}
              >
                Job Title
              </TableSortLabel>
            </TableCell>
                  {/* Region */}
                  <TableCell 
                    sortDirection={orderBy === 'region' ? order : false}
                    sx={{ fontWeight: 700, bgcolor: '#FFFFFF' }}
                  >
                    <TableSortLabel
                      active={orderBy === 'region'}
                      direction={orderBy === 'region' ? order : 'asc'}
                      onClick={() => handleRequestSort('region')}
                    >
                      Region
                    </TableSortLabel>
                  </TableCell>
                  {/* Division */}
                  <TableCell 
                    sortDirection={orderBy === 'division' ? order : false}
                    sx={{ fontWeight: 700, bgcolor: '#FFFFFF' }}
                  >
                    <TableSortLabel
                      active={orderBy === 'division'}
                      direction={orderBy === 'division' ? order : 'asc'}
                      onClick={() => handleRequestSort('division')}
                    >
                      Division
                    </TableSortLabel>
                  </TableCell>
                  {/* Department */}
                  <TableCell 
                    sortDirection={orderBy === 'department' ? order : false}
                    sx={{ fontWeight: 700, bgcolor: '#FFFFFF' }}
                  >
                    <TableSortLabel
                      active={orderBy === 'department'}
                      direction={orderBy === 'department' ? order : 'asc'}
                      onClick={() => handleRequestSort('department')}
                    >
                      Department
                    </TableSortLabel>
                  </TableCell>
                  {/* Location */}
                  <TableCell 
                    sortDirection={orderBy === 'location' ? order : false}
                    sx={{ fontWeight: 700, bgcolor: '#FFFFFF' }}
                  >
                    <TableSortLabel
                      active={orderBy === 'location'}
                      direction={orderBy === 'location' ? order : 'asc'}
                      onClick={() => handleRequestSort('location')}
                    >
                      Location
                    </TableSortLabel>
                  </TableCell>
                  {/* Role */}
                  <TableCell 
                    sortDirection={orderBy === 'securityLevel' ? order : false}
                    sx={{ fontWeight: 700, bgcolor: '#FFFFFF' }}
                  >
                    <TableSortLabel
                      active={orderBy === 'securityLevel'}
                      direction={orderBy === 'securityLevel' ? order : 'asc'}
                      onClick={() => handleRequestSort('securityLevel')}
                    >
                      Role
                    </TableSortLabel>
                  </TableCell>
                  {/* Roles (tenant-role-defaults chips) */}
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF' }}>
                    Roles
                  </TableCell>
                  {/* Module Access */}
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF' }}>
                    Module Access
                  </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {paginatedContacts.map((contact) => (
            <TableRow key={contact.id} hover onClick={() => navigateToUser(contact.id)} sx={{ cursor: 'pointer' }}>
              {/* Avatar */}
              <TableCell sx={{ width: 56, minWidth: 56, maxWidth: 56 }}>
                <Avatar
                  src={getAvatarSrc(contact)}
                  sx={{ width: TABLE_AVATAR_SIZE, height: TABLE_AVATAR_SIZE, fontSize: '0.75rem' }}
                >
                  {getAvatarSrc(contact) ? null : (
                    (contact.firstName || contact.lastName)
                      ? getInitials(contact.firstName, contact.lastName)
                      : <PersonIcon sx={{ fontSize: 18 }} />
                  )}
                </Avatar>
              </TableCell>
              {/* First Name */}
              <TableCell>
                {contact.firstName}
              </TableCell>
              {/* Last Name */}
              <TableCell>
                {contact.lastName}
              </TableCell>
              <TableCell>{contact.email}</TableCell>
              <TableCell sx={{ minWidth: '140px', whiteSpace: 'nowrap' }}>{contact.phone || '-'}</TableCell>
              <TableCell>{getTenantField(contact, 'jobTitle', effectiveTenantId) || '-'}</TableCell>
              {/* Region */}
              <TableCell>
                {(() => {
                  // Get regionId and locationId from nested structure first
                  const regionId = getTenantField(contact, 'regionId', effectiveTenantId);
                  const locationId = getTenantField(contact, 'locationId', effectiveTenantId);
                  
                  // Debug logging for region lookup
                  console.log(`Region lookup for ${contact.firstName} ${contact.lastName}:`, {
                    regionName: contact.regionName,
                    regionId,
                    locationId,
                    hasLocation: !!locations.find((loc: any) => loc.id === locationId)
                  });
                  
                  // First check if there's a direct regionName field
                  if (contact.regionName) {
                    console.log(`Found direct regionName: ${contact.regionName}`);
                    return contact.regionName;
                  }
                  
                  // Then check for regionId from nested structure
                  if (regionId) {
                    const region = regions.find((region: any) => region.id === regionId);
                    console.log(`Found region via regionId: ${region?.name || 'not found'}`);
                    return region ? region.name : '-';
                  }
                  
                  // Check region through location (multiple possible structures)
                  if (locationId) {
                    const location = locations.find((loc: any) => loc.id === locationId);
                    console.log(`Location found:`, location);
                    
                    // Try different possible region field locations in the location document
                    let regionId = null;
                    
                    // Check primaryContacts.region (expected structure)
                    if (location?.primaryContacts?.region) {
                      regionId = location.primaryContacts.region;
                    }
                    // Check direct region field
                    else if (location?.region) {
                      regionId = location.region;
                    }
                    // Check regionId field
                    else if (location?.regionId) {
                      regionId = location.regionId;
                    }
                    
                    if (regionId) {
                      const region = regions.find((region: any) => region.id === regionId);
                      console.log(`Region found via location (${regionId}): ${region?.name || 'not found'}`);
                      return region ? region.name : '-';
                    } else {
                      console.log(`No region field found in location. Available fields:`, Object.keys(location || {}));
                    }
                  } else {
                    console.log(`No locationId found for user`);
                  }
                  
                  return '-';
                })()}
              </TableCell>
              {/* Division */}
              <TableCell>
                {(() => {
                  // First check if there's a direct divisionName field
                  if (contact.divisionName) {
                    return contact.divisionName;
                  }
                  
                  // Then check for divisionId from nested structure
                  const divisionId = getTenantField(contact, 'divisionId', effectiveTenantId);
                  if (divisionId) {
                    const division = divisions.find((div: any) => div.id === divisionId);
                    return division ? division.name : '-';
                  }
                  
                  return '-';
                })()}
              </TableCell>
              {/* Department */}
              <TableCell>
                {(() => {
                  const departmentId = getTenantField(contact, 'departmentId', effectiveTenantId);
                  return departments.find((dept: any) => dept.id === departmentId)?.name || '-';
                })()}
              </TableCell>
              {/* Location */}
              <TableCell>
                {(() => {
                  // First check if there's a direct locationName field
                  if (contact.locationName) {
                    return contact.locationName;
                  }
                  
                  // Then check for locationId from nested structure
                  const locationId = getTenantField(contact, 'locationId', effectiveTenantId);
                  if (locationId) {
                    const location = locations.find((loc: any) => loc.id === locationId);
                    return location ? (location.nickname || location.name) : '-';
                  }
                  
                  // Finally check for locationIds (plural array) - legacy support
                  if (contact.locationIds && contact.locationIds.length > 0) {
                    return locations
                      .filter((loc: any) => contact.locationIds.includes(loc.id))
                      .map((loc: any) => loc.nickname || loc.name)
                      .join(', ') || '-';
                  }
                  
                  return '-';
                })()}
              </TableCell>
              {/* Role */}
              <TableCell>
                {(() => {
                  const securityLevel = getTenantField(contact, 'securityLevel', effectiveTenantId);
                  const label = getSecurityLevelLabel(securityLevel);
                  const color = getSecurityLevelColor(securityLevel);
                  return (
                    <Chip
                      label={label}
                      color={color}
                      size="small"
                      variant="outlined"
                    />
                  );
                })()}
              </TableCell>
              {/* Roles (tenant-role-defaults — multi-select dropdown) */}
              <TableCell onClick={(e) => e.stopPropagation()} sx={{ cursor: 'default' }}>
                {(() => {
                  const baseMembership = tenantRoleDefaultMembershipForUser(
                    tenantRoleDefaults,
                    contact.id,
                  );
                  // Resolve effective membership per role with the
                  // optimistic overlay applied (so the chip + checkbox
                  // flip the moment the user clicks, not after the
                  // callable resolves).
                  const activeRoles: TenantRoleDefault[] = TENANT_ROLE_DEFAULTS.filter(
                    (role) => {
                      const key = `${contact.id}:${role}`;
                      return key in pendingMembership
                        ? pendingMembership[key]
                        : baseMembership[role];
                    },
                  );
                  const anyBusy = TENANT_ROLE_DEFAULTS.some(
                    (role) => busyChips[`${contact.id}:${role}`],
                  );
                  const interactive = callerCanEditRoles;

                  return (
                    <FormControl size="small" sx={{ minWidth: 200, maxWidth: 320 }}>
                      <Select<TenantRoleDefault[]>
                        multiple
                        displayEmpty
                        value={activeRoles}
                        disabled={!interactive || anyBusy}
                        input={
                          <OutlinedInput
                            sx={{
                              '& .MuiOutlinedInput-input': {
                                py: 0.5,
                                fontSize: '0.75rem',
                              },
                            }}
                          />
                        }
                        // MUI's Select dispatches one change per click on
                        // a MenuItem with the *full* next array, so we
                        // diff against the previous array to figure out
                        // which single role flipped — then route through
                        // the same single-role callable as before.
                        onChange={(e: SelectChangeEvent<TenantRoleDefault[]>) => {
                          const raw = e.target.value;
                          const next = (
                            typeof raw === 'string' ? raw.split(',') : raw
                          ) as TenantRoleDefault[];
                          const prev = new Set(activeRoles);
                          const after = new Set(next);
                          const toggled: TenantRoleDefault[] = TENANT_ROLE_DEFAULTS.filter(
                            (role) => prev.has(role) !== after.has(role),
                          );
                          for (const role of toggled) {
                            handleRoleChipClick(contact.id, role, prev.has(role));
                          }
                        }}
                        renderValue={(selected) => {
                          if (!selected || selected.length === 0) {
                            return (
                              <Typography
                                variant="body2"
                                sx={{ color: 'text.secondary', fontSize: '0.75rem' }}
                              >
                                No roles
                              </Typography>
                            );
                          }
                          return (
                            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                              {(selected as TenantRoleDefault[]).map((role) => (
                                <Chip
                                  key={role}
                                  label={chipShortLabel(role)}
                                  size="small"
                                  variant="filled"
                                  color={chipColorFor(role)}
                                  sx={{ fontSize: '0.65rem', height: 20 }}
                                />
                              ))}
                            </Stack>
                          );
                        }}
                        MenuProps={{
                          PaperProps: { sx: { maxWidth: 320 } },
                        }}
                      >
                        {TENANT_ROLE_DEFAULTS.map((role) => {
                          const key = `${contact.id}:${role}`;
                          const checked =
                            key in pendingMembership
                              ? pendingMembership[key]
                              : baseMembership[role];
                          const busy = !!busyChips[key];
                          return (
                            <MenuItem key={role} value={role} disabled={busy}>
                              <Checkbox checked={checked} size="small" />
                              <Tooltip
                                title={TENANT_ROLE_DEFAULT_DESCRIPTIONS[role]}
                                placement="right"
                                arrow
                              >
                                <ListItemText
                                  primary={TENANT_ROLE_DEFAULT_LABELS[role]}
                                  primaryTypographyProps={{ fontSize: '0.8rem' }}
                                />
                              </Tooltip>
                            </MenuItem>
                          );
                        })}
                      </Select>
                    </FormControl>
                  );
                })()}
              </TableCell>
              {/* Module Access */}
              <TableCell>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {(() => {
                    const modules = getModuleAccessChips(contact, effectiveTenantId);
                    if (modules.length === 0) {
                      return <Typography variant="body2" color="text.secondary">—</Typography>;
                    }
                    return modules.map((module) => (
                      <Chip
                        key={module}
                        label={module}
                        size="small"
                        variant="outlined"
                        color="primary"
                      />
                    ));
                  })()}
                </Box>
              </TableCell>
            </TableRow>
          ))}
          {sortedContacts.length === 0 && (
            <TableRow>
              <TableCell colSpan={12} align="center">
                No workers found. Add your first worker using the button above.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      </TableContainer>

      {/* Pagination Footer */}
      <StandardTablePagination
        count={sortedContacts.length}
        page={page}
        onPageChange={(_, newPage) => setPage(newPage)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(e) => {
          setRowsPerPage(parseInt(e.target.value, 10));
          setPage(0);
        }}
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          severity={snackbar.severity}
          variant="filled"
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default WorkersTable; 