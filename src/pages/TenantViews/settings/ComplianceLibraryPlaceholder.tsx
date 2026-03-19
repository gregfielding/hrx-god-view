/**
 * Phase 2A: Compliance Library — source of compliance item types (code-defined).
 * Future: templates, required items per entity/role, links to Credential Types / Screening Types.
 */
import React from 'react';
import { Box, Chip, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { COMPLIANCE_ITEM_TYPES } from '../../../types/compliance';

const ComplianceLibraryPage: React.FC = () => (
  <Box sx={{ p: 3 }}>
    <Typography variant="h6" gutterBottom>
      Compliance item types
    </Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
      Supported types for worker compliance items. Required-by-entity and templates will be configurable in a later phase.
    </Typography>
    <TableContainer component={Paper} variant="outlined" sx={{ maxWidth: 720 }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Type key</TableCell>
            <TableCell>Label</TableCell>
            <TableCell>Category</TableCell>
            <TableCell>Expiration</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {COMPLIANCE_ITEM_TYPES.map((row) => (
            <TableRow key={row.type}>
              <TableCell sx={{ fontFamily: 'monospace' }}>{row.type}</TableCell>
              <TableCell>{row.label}</TableCell>
              <TableCell>
                <Chip label={row.category} size="small" variant="outlined" />
              </TableCell>
              <TableCell>{row.hasExpiration ? 'Yes' : '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  </Box>
);

export default ComplianceLibraryPage;
