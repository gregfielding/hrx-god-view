import React from 'react';
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Checkbox, Button
} from '@mui/material';

interface JobOrder {
  id: string;
  title: string;
  tenantId?: string;
  customerId?: string;
  worksiteId?: string;
  type?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  aiInstructions?: string;
}

interface Tenant { id: string; name: string; }
interface Customer { id: string; name: string; companyName?: string; }

interface JobOrdersTableProps {
  jobOrders: JobOrder[];
  showTenantColumn?: boolean;
  tenants?: Tenant[];
  customers?: Customer[];
  worksiteInfo?: Record<string, { nickname?: string; city?: string }>;
  onView?: (jobOrderId: string) => void;
  selectedJobOrders?: string[];
  onSelect?: (jobOrderId: string) => void;
  onSelectAll?: () => void;
}

const JobOrdersTable: React.FC<JobOrdersTableProps> = ({
  jobOrders,
  showTenantColumn = false,
  tenants = [],
  customers = [],
  worksiteInfo,
  onView,
  selectedJobOrders = [],
  onSelect,
  onSelectAll,
}) => {
  return (
    <TableContainer component={Paper}>
      <Table>
        <TableHead>
          <TableRow>
            {onSelect && (
              <TableCell padding="checkbox" sx={{ height: 48, py: 0 }}>
                <Checkbox
                  checked={selectedJobOrders.length === jobOrders.length && jobOrders.length > 0}
                  indeterminate={selectedJobOrders.length > 0 && selectedJobOrders.length < jobOrders.length}
                  onChange={onSelectAll}
                />
              </TableCell>
            )}
            <TableCell sx={{ height: 48, py: 0 }}>Title</TableCell>
            {showTenantColumn && <TableCell sx={{ height: 48, py: 0 }}>Customer</TableCell>}
            <TableCell sx={{ height: 48, py: 0 }}>Worksite</TableCell>
            <TableCell sx={{ height: 48, py: 0 }}>Type</TableCell>
            <TableCell sx={{ height: 48, py: 0 }}>Start Date</TableCell>
            <TableCell sx={{ height: 48, py: 0 }}>End Date</TableCell>
            <TableCell sx={{ height: 48, py: 0 }}>Status</TableCell>
            <TableCell sx={{ height: 48, py: 0 }}>AI Instructions</TableCell>
            <TableCell sx={{ height: 48, py: 0 }}>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {jobOrders.map((order) => (
            <TableRow key={order.id}>
              {onSelect && (
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={selectedJobOrders.includes(order.id)}
                    onChange={() => onSelect(order.id)}
                  />
                </TableCell>
              )}
              <TableCell>{order.title}</TableCell>
              {showTenantColumn && (
                <TableCell>
                  {order.customerId ? 
                    customers.find(c => c.id === order.customerId)?.companyName || 
                    customers.find(c => c.id === order.customerId)?.name || 
                    order.customerId || '-' 
                    : 
                    tenants.find(t => t.id === order.tenantId)?.name || order.tenantId || '-'
                  }
                </TableCell>
              )}
              <TableCell>{worksiteInfo && worksiteInfo[order.worksiteId]?.nickname ? worksiteInfo[order.worksiteId].nickname : order.worksiteId || '-'}</TableCell>
              <TableCell>{order.type || '-'}</TableCell>
              <TableCell>{order.startDate || '-'}</TableCell>
              <TableCell>{order.endDate || '-'}</TableCell>
              <TableCell>{order.status || '-'}</TableCell>
              <TableCell>
                {order.aiInstructions ? (
                  <div style={{ 
                    maxWidth: 200, 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis', 
                    whiteSpace: 'nowrap',
                    cursor: 'pointer'
                  }} 
                  title={order.aiInstructions}
                  >
                    {order.aiInstructions}
                  </div>
                ) : '-'}
              </TableCell>
              <TableCell>
                <Button size="small" onClick={() => onView && onView(order.id)}>
                  View
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default JobOrdersTable; 