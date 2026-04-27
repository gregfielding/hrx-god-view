import React from 'react';
import { SxProps, TablePagination, TablePaginationProps, Theme } from '@mui/material';

export type StandardTablePaginationProps = Omit<
  TablePaginationProps,
  | 'component'
  | 'labelRowsPerPage'
  | 'labelDisplayedRows'
  | 'rowsPerPageOptions'
  | 'sx'
> & {
  /**
   * Override the default options if a table needs different page sizes.
   * Defaults match the Inbox standard.
   */
  rowsPerPageOptions?: number[];
  sx?: SxProps<Theme>;
};

/**
 * StandardTablePagination
 *
 * Canonical Inbox-standard footer for paginated tables.
 * Matches the UX in the Inbox: "Rows per page", range label, and chevrons.
 */
const StandardTablePagination: React.FC<StandardTablePaginationProps> = ({
  rowsPerPageOptions = [10, 20, 50, 100],
  sx,
  ...props
}) => {
  return (
    <TablePagination
      component="div"
      rowsPerPageOptions={rowsPerPageOptions}
      labelRowsPerPage="Rows per page:"
      labelDisplayedRows={({ from, to, count }) => `${from}\u2013${to} of ${count}`}
      sx={{
        flexShrink: 0,
        borderTop: 1,
        borderColor: 'divider',
        backgroundColor: 'background.paper',
        '& .MuiTablePagination-toolbar': {
          minHeight: 56,
          px: 2,
        },
        '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': {
          fontSize: '14px',
          color: 'text.secondary',
          my: 0,
        },
        '& .MuiTablePagination-select': {
          fontSize: '14px',
        },
        '& .MuiIconButton-root': {
          borderRadius: 1,
        },
        ...sx,
      }}
      {...props}
    />
  );
};

export default StandardTablePagination;


