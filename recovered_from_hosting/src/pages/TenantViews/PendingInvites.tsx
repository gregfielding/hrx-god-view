import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  TableSortLabel,
  CircularProgress,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, getDocs, query, where } from 'firebase/firestore';

import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

const PendingInvites: React.FC = () => {
  const { tenantId, activeTenant } = useAuth();
  const navigate = useNavigate();
  
  const effectiveTenantId = activeTenant?.id || tenantId;
  
  const [pendingInvites, setPendingInvites] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [orderBy, setOrderBy] = useState<'name' | 'email' | 'department' | 'role' | 'inviteSentAt'>('inviteSentAt');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    if (effectiveTenantId) {
      fetchData();
    }
  }, [effectiveTenantId]);

  const fetchData = async () => {
    if (!effectiveTenantId) return;
    
    setLoading(true);
    try {
      await Promise.all([
        fetchPendingInvites(),
        fetchDepartments()
      ]);
    } catch (error) {
      console.error('Error fetching pending invites data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPendingInvites = async () => {
    if (!effectiveTenantId) return;
    try {
      console.log('🔍 Fetching pending invites for tenant:', effectiveTenantId);
      
      // Use the same Cloud Function approach as other components
      const functions = getFunctions();
      const getUsersByTenantFn = httpsCallable(functions, 'getUsersByTenant');
      
      const result = await getUsersByTenantFn({ tenantId: effectiveTenantId });
      const data = result.data as { users: any[], count: number };
      
      console.log('✅ Cloud Function returned users:', data.count);
      
      // Filter for users with inviteStatus: 'pending'
      const pendingUsers = data.users.filter((user: any) => user.inviteStatus === 'pending');
      
      console.log('📋 Pending invites found:', pendingUsers.length);
      setPendingInvites(pendingUsers);
    } catch (err: any) {
      console.error('❌ Error fetching pending invites:', err);
    }
  };

  const fetchDepartments = async () => {
    if (!effectiveTenantId) return;
    try {
      const q = collection(db, 'tenants', effectiveTenantId, 'departments');
      const snapshot = await getDocs(q);
      setDepartments(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    } catch (err: any) {
      console.warn('Could not fetch departments:', err);
      setDepartments([]);
    }
  };

  // Helper functions for sorting and filtering
  const getSortedAndFilteredPendingInvites = () => {
    const filtered = pendingInvites.filter((invite: any) => {
      const fullName = `${invite.firstName || invite.lastName || ''}`.toLowerCase();
      return fullName.includes(search.toLowerCase());
    });

    const sorted = [...filtered].sort((a: any, b: any) => {
      let aValue: any;
      let bValue: any;

      switch (orderBy) {
        case 'name':
          aValue = `${a.firstName || ''} ${a.lastName || ''}`.toLowerCase();
          bValue = `${b.firstName || ''} ${b.lastName || ''}`.toLowerCase();
          break;
        case 'email':
          aValue = (a.email || '').toLowerCase();
          bValue = (b.email || '').toLowerCase();
          break;
        case 'department': {
          const aDept = departments.find(d => d.id === a.departmentId)?.name || '';
          const bDept = departments.find(d => d.id === b.departmentId)?.name || '';
          aValue = aDept.toLowerCase();
          bValue = bDept.toLowerCase();
          break;
        }
        case 'role': {
          aValue = (a.tenantIds && a.tenantIds[tenantId]?.role) || '';
          bValue = (b.tenantIds && b.tenantIds[tenantId]?.role) || '';
          aValue = aValue.toLowerCase();
          bValue = bValue.toLowerCase();
          break;
        }
        case 'inviteSentAt':
          aValue = a.inviteSentAt?.toDate ? a.inviteSentAt.toDate() : new Date(0);
          bValue = b.inviteSentAt?.toDate ? b.inviteSentAt.toDate() : new Date(0);
          break;
        default:
          return 0;
      }

      if (order === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
         return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    });

    return sorted;
  };

  const handleSort = (property: 'name' | 'email' | 'department' | 'role' | 'inviteSentAt') => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  // Resend invite
  const handleResendInvite = async (invite: any) => {
    setLoading(true);
    try {
      const functions = getFunctions();
      const resendInvite = httpsCallable(functions, 'resendInviteV2');
      await resendInvite({ email: invite.email });
    } catch (err: any) {
      console.error('Failed to resend invite:', err);
    }
    setLoading(false);
  };

  // Revoke invite
  const handleRevokeInvite = async (invite: any) => {
    setLoading(true);
    try {
      const functions = getFunctions();
      const revokeInvite = httpsCallable(functions, 'revokeInviteV2');
      await revokeInvite({ email: invite.email });
      setPendingInvites((prev) => prev.filter((i) => i.id !== invite.id));
    } catch (err: any) {
      console.error('Failed to revoke invite:', err);
    }
    setLoading(false);
  };

  // Fix pending user status
  const handleFixPendingUser = async (invite: any) => {
    setLoading(true);
    try {
      const functions = getFunctions();
      const fixPendingUser = httpsCallable(functions, 'fixPendingUser');
      await fixPendingUser({ 
        email: invite.email, 
        tenantId: effectiveTenantId 
      });
      setPendingInvites((prev) => prev.filter((i) => i.id !== invite.id));
    } catch (err: any) {
      console.error('Failed to fix user status:', err);
    }
    setLoading(false);
  };

  if (loading && pendingInvites.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
        <CircularProgress />
        <Typography variant="body1" sx={{ ml: 2 }}>
          Loading pending invites...
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0 }}>
      {/* Header with search */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">Pending Invites ({getSortedAndFilteredPendingInvites().length})</Typography>
        <TextField
          size="small"
          variant="outlined"
          placeholder="Search by name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          sx={{ width: 300 }}
        />
      </Box>
      
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow sx={{ height: 48 }}>
              <TableCell sx={{ py: 1, px: 2 }}>
                <TableSortLabel
                  active={orderBy === 'name'}
                  direction={orderBy === 'name' ? order : 'asc'}
                  onClick={() => handleSort('name')}
                >
                  Name
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ py: 1, px: 2 }}>
                <TableSortLabel
                  active={orderBy === 'email'}
                  direction={orderBy === 'email' ? order : 'asc'}
                  onClick={() => handleSort('email')}
                >
                  Email
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ py: 1, px: 2 }}>
                <TableSortLabel
                  active={orderBy === 'department'}
                  direction={orderBy === 'department' ? order : 'asc'}
                  onClick={() => handleSort('department')}
                >
                  Department
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ py: 1, px: 2 }}>
                <TableSortLabel
                  active={orderBy === 'role'}
                  direction={orderBy === 'role' ? order : 'asc'}
                  onClick={() => handleSort('role')}
                >
                  Role
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ py: 1, px: 2 }}>
                <TableSortLabel
                  active={orderBy === 'inviteSentAt'}
                  direction={orderBy === 'inviteSentAt' ? order : 'asc'}
                  onClick={() => handleSort('inviteSentAt')}
                >
                  Invite Sent At
                </TableSortLabel>
              </TableCell>
              <TableCell sx={{ py: 1, px: 2 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {getSortedAndFilteredPendingInvites().map((invite) => (
              <TableRow key={invite.id}>
                <TableCell>{invite.firstName} {invite.lastName}</TableCell>
                <TableCell>{invite.email}</TableCell>
                <TableCell>{departments.find(d => d.id === invite.departmentId)?.name || ''}</TableCell>
                <TableCell>{invite.tenantIds && invite.tenantIds[tenantId]?.role}</TableCell>
                <TableCell>{invite.inviteSentAt?.toDate ? invite.inviteSentAt.toDate().toLocaleString() : ''}</TableCell>
                <TableCell>
                  <Button size="small" variant="outlined" onClick={() => handleResendInvite(invite)} sx={{ mr: 1 }}>Resend</Button>
                  <Button size="small" variant="outlined" color="error" onClick={() => handleRevokeInvite(invite)} sx={{ mr: 1 }}>Revoke</Button>
                  <Button size="small" variant="contained" color="success" onClick={() => handleFixPendingUser(invite)}>Fix Status</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

export default PendingInvites;
