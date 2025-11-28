import React from 'react';
import {
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Paper,
  TableSortLabel,
  Skeleton,
  Box,
  Typography,
} from '@mui/material';

interface ContactTableProps {
  contacts: any[];
  loading: boolean;
  columns: {
    favorites?: boolean;
    name?: boolean;
    jobTitle?: boolean;
    title?: boolean;
    role?: boolean;
    contactInfo?: boolean;
    company?: boolean;
    location?: boolean;
    lastActivity?: boolean;
  };
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  onSort?: (field: string) => void;
  renderRow: (contact: any, index: number) => React.ReactNode;
}

const ContactTable: React.FC<ContactTableProps> = ({
  contacts,
  loading,
  columns,
  sortField,
  sortDirection,
  onSort,
  renderRow,
}) => {
  // Standardized column widths
  const getColumnWidth = (columnKey: string): number | string | undefined => {
    const widths: { [key: string]: number } = {
      favorites: 60,
      name: 220,
      jobTitle: 150,
      role: 130,
      contactInfo: 220,
      company: 180,
      location: 150,
      lastActivity: 150,
    };
    return widths[columnKey];
  };

  const renderHeaderCell = (
    label: string,
    field?: string,
    columnKey?: string
  ) => {
    const width = columnKey ? getColumnWidth(columnKey) : undefined;
    const cellContent = field && onSort ? (
      <TableSortLabel
        active={sortField === field}
        direction={sortField === field ? sortDirection : 'asc'}
        onClick={() => onSort(field)}
        sx={{ 
          fontSize: '0.75rem',
          fontWeight: 600,
          color: '#374151',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          '& .MuiTableSortLabel-icon': {
            fontSize: '1rem',
            opacity: sortField === field ? 1 : 0.3
          }
        }}
      >
        {label}
      </TableSortLabel>
    ) : (
      <Typography
        variant="caption"
        sx={{
          fontSize: '0.75rem',
          fontWeight: 600,
          color: '#374151',
          textTransform: 'uppercase',
          letterSpacing: '0.05em'
        }}
      >
        {label}
      </Typography>
    );

    return (
      <TableCell 
        sx={{ 
          ...(width && { width, minWidth: width, ...(columnKey === 'favorites' && { maxWidth: width }) }),
          fontSize: '0.75rem',
          fontWeight: 600, 
          color: '#374151',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          py: 1.75,
          ...(columnKey === 'favorites' && { px: 1 }),
          ...(columnKey === 'name' && { pl: 2 })
        }}
      >
        {cellContent}
      </TableCell>
    );
  };

  return (
      <TableContainer 
        component={Paper} 
        variant="outlined"
        sx={{ 
          overflowX: 'auto',
          borderRadius: 1,
          border: '1px solid',
          borderColor: 'divider',
          boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
          '& .MuiTable-root': {
            borderCollapse: 'separate',
            borderSpacing: 0
          }
        }}
      >
        <Table sx={{ minWidth: 1200 }}>
          <TableHead>
            <TableRow sx={{ 
              backgroundColor: 'grey.50',
              borderBottom: '2px solid',
              borderColor: 'divider',
              '& th': {
                borderBottom: '2px solid',
                borderColor: 'divider',
                fontWeight: 600
              }
            }}>
              {columns.favorites && renderHeaderCell('Favorites', undefined, 'favorites')}
              {columns.name && renderHeaderCell('Contact Name', 'fullName', 'name')}
              {(columns.jobTitle || columns.title) && renderHeaderCell('Job Title', 'jobTitle', 'jobTitle')}
              {columns.role && renderHeaderCell('Role', undefined, 'role')}
              {columns.contactInfo && renderHeaderCell('Contact Info', undefined, 'contactInfo')}
              {columns.company && renderHeaderCell('Company', 'companyName', 'company')}
              {columns.location && renderHeaderCell('Location', undefined, 'location')}
              {columns.lastActivity && renderHeaderCell('Last Activity', 'lastActivity', 'lastActivity')}
            </TableRow>
          </TableHead>
        <TableBody>
          {loading || contacts.length === 0 ? (
            // Skeleton loader rows
            Array.from({ length: 8 }).map((_, index) => (
              <TableRow 
                key={`skeleton-${index}`} 
                sx={{ 
                  height: '48px',
                  bgcolor: index % 2 === 0 ? 'background.paper' : '#FAFAFA',
                  '& td': {
                    borderBottom: '1px solid',
                    borderColor: 'divider'
                  }
                }}
              >
                {columns.favorites && (
                  <TableCell sx={{ width: 60, minWidth: 60, maxWidth: 60, px: 1, py: 1.5 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                      <Skeleton variant="circular" width={24} height={24} />
                    </Box>
                  </TableCell>
                )}
                {columns.name && (
                  <TableCell sx={{ pl: 2, pr: 2, py: 1.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Skeleton variant="circular" width={32} height={32} />
                      <Skeleton variant="text" width={140} height={20} />
                    </Box>
                  </TableCell>
                )}
                {(columns.jobTitle || columns.title) && (
                  <TableCell sx={{ px: 1.5, py: 1.5 }}>
                    <Skeleton variant="text" width={100} height={20} />
                  </TableCell>
                )}
                {columns.role && (
                  <TableCell sx={{ px: 1.5, py: 1.5 }}>
                    <Skeleton variant="rectangular" width={80} height={24} sx={{ borderRadius: 1 }} />
                  </TableCell>
                )}
                {columns.contactInfo && (
                  <TableCell sx={{ px: 1.5, py: 1.5 }}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      <Skeleton variant="text" width={140} height={16} />
                      <Skeleton variant="text" width={100} height={16} />
                    </Box>
                  </TableCell>
                )}
                {columns.company && (
                  <TableCell sx={{ px: 1.5, py: 1.5 }}>
                    <Skeleton variant="text" width={120} height={20} />
                  </TableCell>
                )}
                {columns.location && (
                  <TableCell sx={{ px: 1.5, py: 1.5 }}>
                    <Skeleton variant="text" width={100} height={20} />
                  </TableCell>
                )}
                {columns.lastActivity && (
                  <TableCell sx={{ px: 1.5, py: 1.5 }}>
                    <Skeleton variant="text" width={90} height={20} />
                  </TableCell>
                )}
              </TableRow>
            ))
          ) : (
            contacts.map((contact, index) => renderRow(contact, index))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default ContactTable;

