/**
 * Recruiter Accounts – list and add accounts (customer hub).
 * Design matches Companies: search + favorites + Add in header; full-width table.
 * tenants/{tenantId}/accounts; Active/Inactive.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Paper,
  CircularProgress,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
} from '@mui/material';
import { Business as BusinessIcon, AccountTree as AccountTreeIcon, Add as AddIcon, Star, StarBorder } from '@mui/icons-material';
import { useOutletContext, useSearchParams, useNavigate } from 'react-router-dom';
import { collection, query, orderBy, getDocs, addDoc, serverTimestamp, doc, updateDoc, arrayUnion } from 'firebase/firestore';

import { useAuth } from '../contexts/AuthContext';
import type { RecruiterOutletContext } from './RecruiterDashboard';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import type { RecruiterAccount, RecruiterAccountFormData } from '../types/recruiter/account';
import { isAccountAssignedToUser } from '../utils/myAccounts';
import AddAccountModal from '../components/recruiter/AddAccountModal';
import StandardTablePagination from '../components/StandardTablePagination';
import { useFavorites } from '../hooks/useFavorites';

interface RecruiterAccountsProps {
  onlyMyAccounts?: boolean;
}

const RecruiterAccounts: React.FC<RecruiterAccountsProps> = ({ onlyMyAccounts = false }) => {
  const { user, tenantId } = useAuth();
  const outletCtx = useOutletContext<RecruiterOutletContext | null>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const headerSearch = outletCtx?.search ?? '';
  const headerShowFavoritesOnly = outletCtx?.showFavoritesOnly ?? false;

  const [accounts, setAccounts] = useState<RecruiterAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<'name' | 'createdAt'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [addModalOpen, setAddModalOpen] = useState(false);
  type EntityOption = { id: string; name: string };
  const [entityOptions, setEntityOptions] = useState<EntityOption[]>([]);

  const { isFavorite, toggleFavorite } = useFavorites('accounts');

  useEffect(() => {
    if (!tenantId) return;
    getDocs(collection(db, 'tenants', tenantId, 'entities'))
      .then((snap) => {
        setEntityOptions(
          snap.docs.map((d) => ({
            id: d.id,
            name: (d.data()?.name ?? d.data()?.label ?? d.id) as string,
          }))
        );
      })
      .catch(() => setEntityOptions([]));
  }, [tenantId]);

  const fetchAccounts = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const ref = collection(db, p.recruiterAccounts(tenantId));
      const q = query(ref, orderBy('name', 'asc'));
      const snap = await getDocs(q);
      const list: RecruiterAccount[] = snap.docs.map((d) => {
        const data = d.data();
        const defaults = data.defaults;
        const eVerify = defaults?.eVerify && typeof defaults.eVerify === 'object' ? defaults.eVerify : null;
        const parentAccountId = data.parentAccountId ?? null;
        const childAccountIdsArr = Array.isArray(data.childAccountIds) ? data.childAccountIds : [];
        const rawAccountType = data.accountType ?? null;
        // Derive account type same as RecruiterAccountDetails: explicit value, else child if has parent, else national if has children, else standalone
        const accountType =
          rawAccountType != null && rawAccountType !== ''
            ? rawAccountType
            : parentAccountId
              ? 'child'
              : childAccountIdsArr.length > 0
                ? 'national'
                : 'standalone';
        return {
          id: d.id,
          name: data.name ?? '',
          active: data.active !== false,
          parentAccountId,
          childAccountIds: childAccountIdsArr,
          accountType,
          hiringEntityId: data.hiringEntityId ?? null,
          eVerifyRequired: eVerify ? !!eVerify.eVerifyRequired : false,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          createdBy: data.createdBy,
          updatedBy: data.updatedBy,
          associations: data.associations ?? undefined,
        };
      });
      // Second pass: treat as child if this account's id appears in any other account's childAccountIds (detail page sync may not have written parentAccountId yet)
      list.forEach((acc, i) => {
        if (acc.accountType === 'standalone' && !acc.parentAccountId) {
          const isChildOfSomeone = list.some((other) => other.id !== acc.id && (other.childAccountIds || []).includes(acc.id));
          if (isChildOfSomeone) {
            list[i] = { ...acc, accountType: 'child' };
          }
        }
      });
      setAccounts(list);
    } catch (err) {
      console.error('RecruiterAccounts: fetch error', err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  // Open Add Account modal when navigated with ?new=1 from header button
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setAddModalOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    setPage(0);
  }, [headerSearch, headerShowFavoritesOnly, statusFilter, sortField, sortDirection]);

  const handleAddAccount = async (data: RecruiterAccountFormData) => {
    if (!tenantId || !user?.uid) return;
    const ref = collection(db, p.recruiterAccounts(tenantId));
    const docRef = await addDoc(ref, {
      name: data.name.trim(),
      active: data.active,
      parentAccountId: data.parentAccountId || null,
      childAccountIds: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: user.uid,
      updatedBy: user.uid,
    });
    if (data.parentAccountId) {
      await updateDoc(doc(db, p.recruiterAccount(tenantId, data.parentAccountId)), {
        childAccountIds: arrayUnion(docRef.id),
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
    }
    await fetchAccounts();
  };

  const filteredAccounts = useMemo(() => {
    let list = accounts;
    // My Accounts: only accounts where current user is assigned salesperson or recruiter (app-wide rule)
    if (onlyMyAccounts) {
      list = list.filter((a) => isAccountAssignedToUser(a, user?.uid));
    }
    list = list.filter((a) => {
      if (statusFilter === 'active') return a.active;
      if (statusFilter === 'inactive') return !a.active;
      return true;
    });
    if (headerSearch.trim()) {
      const q = headerSearch.toLowerCase().trim();
      list = list.filter((a) => (a.name || '').toLowerCase().includes(q));
    }
    if (headerShowFavoritesOnly) {
      list = list.filter((a) => a.id && isFavorite(a.id));
    }
    return list;
  }, [accounts, onlyMyAccounts, user?.uid, statusFilter, headerSearch, headerShowFavoritesOnly, isFavorite]);

  const sortedAccounts = useMemo(() => {
    return [...filteredAccounts].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') {
        cmp = (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
      } else {
        const aT = a.createdAt?.toMillis?.() ?? 0;
        const bT = b.createdAt?.toMillis?.() ?? 0;
        cmp = aT - bT;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [filteredAccounts, sortField, sortDirection]);

  const paginatedAccounts = useMemo(() => {
    return sortedAccounts.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
  }, [sortedAccounts, page, rowsPerPage]);

  const handleSort = (field: 'name' | 'createdAt') => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    setPage(0);
  };

  const handleFavoriteClick = (e: React.MouseEvent, accountId: string) => {
    e.stopPropagation();
    toggleFavorite(accountId);
  };

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        px: { xs: 2, md: 3 },
        pt: 1,
      }}
    >
      {/* Filter bar – same pattern as Companies (State Filter row) */}
      <Box
        sx={{
          mt: 0,
          mb: 0,
          px: 1.5,
          py: 1.25,
          backgroundColor: '#F9FAFB',
          borderRadius: 0,
          border: '1px solid #E5E7EB',
          borderBottom: '1px solid #EAEEF4',
          overflowX: 'auto',
          overflowY: 'hidden',
        }}
      >
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 160, height: 36 }}>
            <InputLabel sx={{ fontSize: '0.875rem' }}>Status</InputLabel>
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              label="Status"
              sx={{
                height: 36,
                borderRadius: '6px',
                backgroundColor: 'white',
                fontSize: '0.875rem',
                '& .MuiOutlinedInput-notchedOutline': { borderColor: '#E5E7EB' },
                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#D1D5DB' },
              }}
            >
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="inactive">Inactive</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 160, height: 36 }}>
            <InputLabel sx={{ fontSize: '0.875rem' }}>Sort By</InputLabel>
            <Select
              value={sortField}
              onChange={(e) => setSortField(e.target.value as 'name' | 'createdAt')}
              label="Sort By"
              sx={{
                height: 36,
                borderRadius: '6px',
                backgroundColor: 'white',
                fontSize: '0.875rem',
                '& .MuiOutlinedInput-notchedOutline': { borderColor: '#E5E7EB' },
                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#D1D5DB' },
              }}
            >
              <MenuItem value="name">Name</MenuItem>
              <MenuItem value="createdAt">Date Created</MenuItem>
            </Select>
          </FormControl>
        </Box>
      </Box>

      {/* Full-width table – CompanyTable-style */}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', pt: 0, pb: 2 }}>
        {loading && accounts.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, p: 4 }}>
            <CircularProgress />
          </Box>
        ) : sortedAccounts.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 8, flex: 1 }}>
            <BusinessIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h6" color="text.secondary" gutterBottom>
              No accounts found
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              {statusFilter !== 'all' || headerSearch || headerShowFavoritesOnly
                ? 'Try changing filters or search'
                : 'Create your first account to get started'}
            </Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setAddModalOpen(true)}
              sx={{ textTransform: 'none', borderRadius: 1, fontWeight: 500 }}
            >
              Add Account
            </Button>
          </Box>
        ) : (
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <TableContainer
              component={Paper}
              sx={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                overflowY: 'auto',
                overflowX: 'auto',
                borderRadius: 0,
                border: '1px solid #EAEEF4',
                borderTop: '1px solid #EAEEF4',
                boxShadow: 'none',
                width: '100%',
                '&::-webkit-scrollbar': { width: '8px', height: '8px' },
                '&::-webkit-scrollbar-track': {
                  background: 'rgba(0, 0, 0, 0.02)',
                  borderRadius: '4px',
                },
                '&::-webkit-scrollbar-thumb': {
                  background: 'rgba(0, 0, 0, 0.15)',
                  borderRadius: '4px',
                  '&:hover': { background: 'rgba(0, 0, 0, 0.25)' },
                },
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
              }}
            >
              <Table size="small" stickyHeader sx={{ width: '100%' }}>
                <TableHead sx={{ backgroundColor: '#FFFFFF' }}>
                  <TableRow sx={{ backgroundColor: '#FFFFFF' }}>
                    <TableCell
                      align="center"
                      sx={{
                        width: 60,
                        minWidth: 60,
                        maxWidth: 60,
                        position: 'sticky',
                        top: 0,
                        zIndex: 12,
                        bgcolor: '#FFFFFF',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: '#374151',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        py: 1.75,
                        px: 1,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                      }}
                    />
                    <TableCell
                      sx={{
                        position: 'sticky',
                        top: 0,
                        zIndex: 12,
                        bgcolor: '#FFFFFF',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: '#374151',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        py: 1.75,
                        pl: 2,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                      }}
                    >
                      <TableSortLabel
                        active={sortField === 'name'}
                        direction={sortField === 'name' ? sortDirection : 'asc'}
                        onClick={() => handleSort('name')}
                        sx={{
                          '& .MuiTableSortLabel-icon': {
                            fontSize: '1rem',
                            opacity: sortField === 'name' ? 1 : 0.3,
                          },
                        }}
                      >
                        ACCOUNT NAME
                      </TableSortLabel>
                    </TableCell>
                    <TableCell
                      sx={{
                        position: 'sticky',
                        top: 0,
                        zIndex: 12,
                        bgcolor: '#FFFFFF',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: '#374151',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        py: 1.75,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                      }}
                    >
                      STATUS
                    </TableCell>
                    <TableCell
                      sx={{
                        position: 'sticky',
                        top: 0,
                        zIndex: 12,
                        bgcolor: '#FFFFFF',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: '#374151',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        py: 1.75,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                      }}
                    >
                      ACCOUNT TYPE
                    </TableCell>
                    <TableCell
                      sx={{
                        position: 'sticky',
                        top: 0,
                        zIndex: 12,
                        bgcolor: '#FFFFFF',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: '#374151',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        py: 1.75,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                      }}
                    >
                      E-VERIFY
                    </TableCell>
                    <TableCell
                      sx={{
                        position: 'sticky',
                        top: 0,
                        zIndex: 12,
                        bgcolor: '#FFFFFF',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: '#374151',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        py: 1.75,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                      }}
                    >
                      HIRING ENTITY
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {paginatedAccounts.map((account, index) => (
                    <TableRow
                      key={account.id}
                      hover
                      onClick={() => account.id && navigate(`/recruiter/accounts/${account.id}`)}
                      sx={{
                        cursor: account.id ? 'pointer' : 'default',
                        backgroundColor: index % 2 === 0 ? 'background.paper' : '#FAFAFA',
                        '&:hover': { backgroundColor: 'action.hover' },
                      }}
                    >
                      <TableCell
                        align="center"
                        sx={{
                          width: 60,
                          minWidth: 60,
                          maxWidth: 60,
                          py: 1.5,
                          px: 1,
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                        }}
                      >
                        <IconButton
                          size="small"
                          onClick={(e) => account.id && handleFavoriteClick(e, account.id)}
                          sx={{
                            p: 0.25,
                            color: account.id && isFavorite(account.id) ? '#0B63C5' : '#6B7280',
                            '&:hover': { color: '#0B63C5', backgroundColor: 'rgba(11, 99, 197, 0.08)' },
                          }}
                        >
                          {account.id && isFavorite(account.id) ? (
                            <Star fontSize="small" />
                          ) : (
                            <StarBorder fontSize="small" />
                          )}
                        </IconButton>
                      </TableCell>
                      <TableCell
                        sx={{
                          py: 1.5,
                          pl: 2,
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {(account.accountType === 'child' || account.parentAccountId) ? (
                            <AccountTreeIcon sx={{ fontSize: 20, color: 'text.secondary' }} />
                          ) : (
                            <BusinessIcon sx={{ fontSize: 20, color: 'text.secondary' }} />
                          )}
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {account.name || '—'}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell
                        sx={{
                          py: 1.5,
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                        }}
                      >
                        <Chip
                          label={account.active ? 'Active' : 'Inactive'}
                          color={account.active ? 'success' : 'default'}
                          size="small"
                          variant={account.active ? 'filled' : 'outlined'}
                          sx={{ fontWeight: 500 }}
                        />
                      </TableCell>
                      <TableCell
                        sx={{
                          py: 1.5,
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                          fontSize: '0.875rem',
                        }}
                      >
                        {account.accountType === 'national'
                          ? 'National account'
                          : account.accountType === 'child'
                            ? 'Child account'
                            : 'Standalone'}
                      </TableCell>
                      <TableCell
                        sx={{
                          py: 1.5,
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                          fontSize: '0.875rem',
                        }}
                      >
                        {account.eVerifyRequired ? 'Yes' : 'No'}
                      </TableCell>
                      <TableCell
                        sx={{
                          py: 1.5,
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                          fontSize: '0.875rem',
                        }}
                      >
                        {(() => {
                          const effectiveId =
                            account.hiringEntityId ??
                            (account.parentAccountId
                              ? accounts.find((a) => a.id === account.parentAccountId)?.hiringEntityId
                              : null);
                          return effectiveId
                            ? (entityOptions.find((e) => e.id === effectiveId)?.name ?? '—')
                            : '—';
                        })()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <StandardTablePagination
              count={sortedAccounts.length}
              page={page}
              onPageChange={(_, newPage) => setPage(newPage)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setPage(0);
              }}
            />
          </Box>
        )}
      </Box>

      <AddAccountModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onSubmit={handleAddAccount}
        accountOptions={accounts.map((account) => ({ id: account.id || '', label: account.name || 'Unnamed Account' })).filter((option) => option.id)}
      />
    </Box>
  );
};

export default RecruiterAccounts;
