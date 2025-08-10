import React from 'react';
import { Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Checkbox, Button, Typography, Box, TableSortLabel } from '@mui/material';

export interface WorkersTableProps {
  contacts: any[];
  locations: any[];
  departments: any[];
  selectedWorkers: string[];
  handleWorkerSelection: (workerId: string) => void;
  handleSelectAll: () => void;
  navigateToUser: (userId: string) => void;
  contextType: 'agency' | 'customer';
  loading?: boolean;
  search: string;
  onSearchChange: (value: string) => void;
}

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
    if (orderBy === 'city') {
      aValue = a.addressInfo?.city || '';
      bValue = b.addressInfo?.city || '';
    }
    if (orderBy === 'state') {
      aValue = a.addressInfo?.state || '';
      bValue = b.addressInfo?.state || '';
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
  selectedWorkers,
  handleWorkerSelection,
  handleSelectAll,
  navigateToUser,
  contextType,
  loading = false,
  search,
  onSearchChange,
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
        const aLoc = locations.filter((loc: any) => (a.locationIds || []).includes(loc.id)).map((loc: any) => loc.nickname).join(', ') || '';
        const bLoc = locations.filter((loc: any) => (b.locationIds || []).includes(loc.id)).map((loc: any) => loc.nickname).join(', ') || '';
        if (aLoc < bLoc) return order === 'asc' ? -1 : 1;
        if (aLoc > bLoc) return order === 'asc' ? 1 : -1;
        return 0;
      });
    } else {
      data.sort(getComparator(order, orderBy));
    }
    return data;
  }, [filteredContacts, order, orderBy, departments, locations]);

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
            <TableCell padding="checkbox">
              <Checkbox
                checked={selectedWorkers.length === contacts.length && contacts.length > 0}
                indeterminate={
                  selectedWorkers.length > 0 && selectedWorkers.length < contacts.length
                }
                onChange={handleSelectAll}
              />
            </TableCell>
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
            {/* City */}
            <TableCell sortDirection={orderBy === 'city' ? order : false}>
              <TableSortLabel
                active={orderBy === 'city'}
                direction={orderBy === 'city' ? order : 'asc'}
                onClick={() => handleRequestSort('city')}
              >
                City
              </TableSortLabel>
            </TableCell>
            {/* State */}
            <TableCell sortDirection={orderBy === 'state' ? order : false}>
              <TableSortLabel
                active={orderBy === 'state'}
                direction={orderBy === 'state' ? order : 'asc'}
                onClick={() => handleRequestSort('state')}
              >
                State
              </TableSortLabel>
            </TableCell>
            <TableCell>View</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sortedContacts.map((contact) => (
            <TableRow key={contact.id} hover>
              <TableCell padding="checkbox">
                <Checkbox
                  checked={selectedWorkers.includes(contact.id)}
                  onChange={(e) => {
                    e.stopPropagation();
                    handleWorkerSelection(contact.id);
                  }}
                />
              </TableCell>
              {/* First Name */}
              <TableCell
                style={{ cursor: 'pointer' }}
                onClick={() => navigateToUser(contact.id)}
              >
                {contact.firstName}
              </TableCell>
              {/* Last Name */}
              <TableCell
                style={{ cursor: 'pointer' }}
                onClick={() => navigateToUser(contact.id)}
              >
                {contact.lastName}
              </TableCell>
              <TableCell>{contact.email}</TableCell>
              <TableCell>{contact.phone || '-'}</TableCell>
              <TableCell>{contact.jobTitle || '-'}</TableCell>
              <TableCell>
                {locations
                  .filter((loc: any) => (contact.locationIds || []).includes(loc.id))
                  .map((loc: any) => loc.nickname)
                  .join(', ') || '-'}
              </TableCell>
              <TableCell>
                {departments.find((dept: any) => dept.id === contact.departmentId)?.name || '-'}
              </TableCell>
              {/* City */}
              <TableCell>{contact.addressInfo?.city || '-'}</TableCell>
              {/* State */}
              <TableCell>{contact.addressInfo?.state || '-'}</TableCell>
              <TableCell>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigateToUser(contact.id);
                  }}
                >
                  View
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {contacts.length === 0 && (
            <TableRow>
              <TableCell colSpan={11} align="center">
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