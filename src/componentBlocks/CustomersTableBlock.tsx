import React from 'react';
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Button, CircularProgress,
  Chip // Add Chip import
} from '@mui/material';

interface Customer {
  id: string;
  name: string;
  avatar?: string;
  city?: string;
  state?: string;
  workforceCount?: number;
  agencyName?: string;
  status?: boolean; // Add status field
  companyLocationId?: string;
}

interface CustomersTableBlockProps {
  tenants: Customer[];
  loading?: boolean;
  onView?: (id: string) => void;
  tenantId?: string;
  companyLocations?: { id: string; nickname?: string; name?: string }[];
}

const CustomersTableBlock: React.FC<CustomersTableBlockProps> = ({
  tenants,
  loading = false,
  onView,
  tenantId,
  companyLocations = [],
}) => {
  const filteredCustomers = tenantId
    ? tenants.filter((customer: any) => customer.tenantId === tenantId)
    : tenants;
  const getLocationName = (customer: Customer) => {
    if (!customer.companyLocationId) return '-';
    const location = companyLocations.find(loc => loc.id === customer.companyLocationId);
    return location ? location.nickname || location.name || location.id : '-';
  };
  return (
    <TableContainer component={Paper}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Logo</TableCell>
            <TableCell>Name</TableCell>
            <TableCell>Workforce</TableCell>
            <TableCell>Agency</TableCell>
            <TableCell>City</TableCell>
            <TableCell>State</TableCell>
            <TableCell>Company Location</TableCell>
            <TableCell>View</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={8} align="center">
                <CircularProgress />
              </TableCell>
            </TableRow>
          ) : filteredCustomers.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} align="center">
                No tenants found.
              </TableCell>
            </TableRow>
          ) : (
            filteredCustomers.map((customer) => (
              <TableRow key={customer.id}>
                <TableCell>
                  {customer.avatar && customer.avatar !== '/img/default-logo.png' ? (
                    <img
                      src={customer.avatar}
                      alt={customer.name}
                      style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, border: '1px solid #eee' }}
                      onError={(e) => { (e.target as HTMLImageElement).src = '/img/default-logo.png'; }}
                    />
                  ) : null}
                </TableCell>
                <TableCell>
                  <Chip
                    label={customer.status !== false ? 'Active' : 'Inactive'}
                    color={customer.status !== false ? 'success' : 'default'}
                    size="small"
                    variant="filled"
                    sx={{ mr: 1, verticalAlign: 'middle' }}
                  />
                  {customer.name}
                </TableCell>
                <TableCell>{customer.workforceCount !== undefined ? customer.workforceCount : '-'}</TableCell>
                <TableCell>{customer.agencyName || '-'}</TableCell>
                <TableCell>{customer.city || '-'}</TableCell>
                <TableCell>{customer.state || '-'}</TableCell>
                <TableCell>{getLocationName(customer)}</TableCell>
                <TableCell>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => onView && onView(customer.id)}
                  >
                    View
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default CustomersTableBlock; 