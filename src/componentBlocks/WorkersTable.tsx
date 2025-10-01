import React from 'react';
import { Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Typography, Box, TableSortLabel } from '@mui/material';

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
}

// Helper function to get tenant-dependent field from nested structure
const getTenantField = (contact: any, field: string, effectiveTenantId?: string) => {
  if (!effectiveTenantId || !contact.tenantIds?.[effectiveTenantId]) {
    return contact[field];
  }
  
  // Get from nested tenantIds structure first, fallback to direct field
  return contact.tenantIds[effectiveTenantId][field] || contact[field];
};

// Removed unused sortableColumns to satisfy TS6133

function getComparator(order: 'asc' | 'desc', orderBy: string) {
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
}) => {
  const [order, setOrder] = React.useState<'asc' | 'desc'>('asc');
  const [orderBy, setOrderBy] = React.useState<string>('firstName');

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
           } else {
      data.sort(getComparator(order, orderBy));
    }
    return data;
  }, [filteredContacts, order, orderBy, departments, locations, divisions, regions]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <Typography>Loading workers...</Typography>
      </Box>
    );
  }
  return (
    <TableContainer component={Paper}>
      <Table size="small">
        <TableHead>
          <TableRow>
            {/* First Name */}
            <TableCell sortDirection={orderBy === 'firstName' ? order : false}>
              <TableSortLabel
                active={orderBy === 'firstName'}
                direction={orderBy === 'firstName' ? order : 'asc'}
                onClick={() => handleRequestSort('firstName')}
              >
                First Name
              </TableSortLabel>
            </TableCell>
            {/* Last Name */}
            <TableCell sortDirection={orderBy === 'lastName' ? order : false}>
              <TableSortLabel
                active={orderBy === 'lastName'}
                direction={orderBy === 'lastName' ? order : 'asc'}
                onClick={() => handleRequestSort('lastName')}
              >
                Last Name
              </TableSortLabel>
            </TableCell>
            <TableCell>Email</TableCell>
            <TableCell>Phone</TableCell>
            {/* Job Title */}
            <TableCell sortDirection={orderBy === 'jobTitle' ? order : false}>
              <TableSortLabel
                active={orderBy === 'jobTitle'}
                direction={orderBy === 'jobTitle' ? order : 'asc'}
                onClick={() => handleRequestSort('jobTitle')}
              >
                Job Title
              </TableSortLabel>
            </TableCell>
                  {/* Region */}
                  <TableCell sortDirection={orderBy === 'region' ? order : false}>
                    <TableSortLabel
                      active={orderBy === 'region'}
                      direction={orderBy === 'region' ? order : 'asc'}
                      onClick={() => handleRequestSort('region')}
                    >
                      Region
                    </TableSortLabel>
                  </TableCell>
                  {/* Division */}
                  <TableCell sortDirection={orderBy === 'division' ? order : false}>
                    <TableSortLabel
                      active={orderBy === 'division'}
                      direction={orderBy === 'division' ? order : 'asc'}
                      onClick={() => handleRequestSort('division')}
                    >
                      Division
                    </TableSortLabel>
                  </TableCell>
                  {/* Department */}
                  <TableCell sortDirection={orderBy === 'department' ? order : false}>
                    <TableSortLabel
                      active={orderBy === 'department'}
                      direction={orderBy === 'department' ? order : 'asc'}
                      onClick={() => handleRequestSort('department')}
                    >
                      Department
                    </TableSortLabel>
                  </TableCell>
                  {/* Location */}
                  <TableCell sortDirection={orderBy === 'location' ? order : false}>
                    <TableSortLabel
                      active={orderBy === 'location'}
                      direction={orderBy === 'location' ? order : 'asc'}
                      onClick={() => handleRequestSort('location')}
                    >
                      Location
                    </TableSortLabel>
                  </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sortedContacts.map((contact) => (
            <TableRow key={contact.id} hover onClick={() => navigateToUser(contact.id)} sx={{ cursor: 'pointer' }}>
              {/* First Name */}
              <TableCell>
                {contact.firstName}
              </TableCell>
              {/* Last Name */}
              <TableCell>
                {contact.lastName}
              </TableCell>
              <TableCell>{contact.email}</TableCell>
              <TableCell>{contact.phone || '-'}</TableCell>
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
            </TableRow>
          ))}
          {contacts.length === 0 && (
            <TableRow>
              <TableCell colSpan={9} align="center">
                No workers found. Add your first worker using the button above.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default WorkersTable; 