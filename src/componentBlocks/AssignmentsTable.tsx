import React, { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  TableSortLabel,
} from '@mui/material';

export interface AssignmentsTableProps {
  assignments: any[];
  showAgency?: boolean;
  showFullAgencyTable?: boolean;
}

const AssignmentsTable: React.FC<AssignmentsTableProps> = ({
  assignments,
  showAgency = true,
  showFullAgencyTable = false,
}) => {
  const [sortField, setSortField] = useState<string>('startDate');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedAssignments = [...assignments].sort((a, b) => {
    let aValue = a[sortField];
    let bValue = b[sortField];
    if (aValue === undefined) aValue = '';
    if (bValue === undefined) bValue = '';
    if (sortField === 'startDate' || sortField === 'endDate') {
      aValue = new Date(aValue);
      bValue = new Date(bValue);
      return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
    }
    aValue = (aValue || '').toString().toLowerCase();
    bValue = (bValue || '').toString().toLowerCase();
    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  return (
    <TableContainer component={Paper}>
      <Table size="small">
        <TableHead>
          <TableRow>
            {showFullAgencyTable ? (
              <>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'firstName'}
                    direction={sortDirection}
                    onClick={() => handleSort('firstName')}
                  >
                    First Name
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'lastName'}
                    direction={sortDirection}
                    onClick={() => handleSort('lastName')}
                  >
                    Last Name
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'jobOrderTitle'}
                    direction={sortDirection}
                    onClick={() => handleSort('jobOrderTitle')}
                  >
                    Job Order Title
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'customerName'}
                    direction={sortDirection}
                    onClick={() => handleSort('customerName')}
                  >
                    Customer
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'worksiteName'}
                    direction={sortDirection}
                    onClick={() => handleSort('worksiteName')}
                  >
                    Worksite
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'jobTitle'}
                    direction={sortDirection}
                    onClick={() => handleSort('jobTitle')}
                  >
                    Job Title
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'shiftTitle'}
                    direction={sortDirection}
                    onClick={() => handleSort('shiftTitle')}
                  >
                    Shift Title
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'startDate'}
                    direction={sortDirection}
                    onClick={() => handleSort('startDate')}
                  >
                    Start Date
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'endDate'}
                    direction={sortDirection}
                    onClick={() => handleSort('endDate')}
                  >
                    End Date
                  </TableSortLabel>
                </TableCell>
                <TableCell>
                  <TableSortLabel
                    active={sortField === 'status'}
                    direction={sortDirection}
                    onClick={() => handleSort('status')}
                  >
                    Status
                  </TableSortLabel>
                </TableCell>
              </>
            ) : (
              <>
                <TableCell>Title</TableCell>
                {showAgency && <TableCell>Agency</TableCell>}
                <TableCell>Worksite</TableCell>
                <TableCell>Start Date</TableCell>
                <TableCell>End Date</TableCell>
                <TableCell>Status</TableCell>
              </>
            )}
          </TableRow>
        </TableHead>
        <TableBody>
          {sortedAssignments.length === 0 ? (
            <TableRow>
              <TableCell colSpan={showFullAgencyTable ? 10 : showAgency ? 6 : 5}>
                No assignments found.
              </TableCell>
            </TableRow>
          ) : showFullAgencyTable ? (
            sortedAssignments.map((a) => (
              <TableRow key={a.id}>
                <TableCell>{a.firstName || '-'}</TableCell>
                <TableCell>{a.lastName || '-'}</TableCell>
                <TableCell>{a.jobOrderTitle || '-'}</TableCell>
                <TableCell>{a.customerName || '-'}</TableCell>
                <TableCell>{a.worksiteName || '-'}</TableCell>
                <TableCell>{a.jobTitle || '-'}</TableCell>
                <TableCell>{a.shiftTitle || '-'}</TableCell>
                <TableCell>{a.startDate || '-'}</TableCell>
                <TableCell>{a.endDate || '-'}</TableCell>
                <TableCell>{a.status || '-'}</TableCell>
              </TableRow>
            ))
          ) : (
            sortedAssignments.map((a) => (
              <TableRow key={a.id}>
                <TableCell>{a.shiftTitle || '-'}</TableCell>
                {showAgency && <TableCell>{a.agencyName || a.tenantId || '-'}</TableCell>}
                <TableCell>{a.worksiteName || '-'}</TableCell>
                <TableCell>{a.startDate || '-'}</TableCell>
                <TableCell>{a.endDate || '-'}</TableCell>
                <TableCell>{a.status || '-'}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default AssignmentsTable; 