import React, { useEffect, useMemo, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import GroupIcon from '@mui/icons-material/Groups';
import { collection, addDoc, getDocs, serverTimestamp } from 'firebase/firestore';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';
import StandardTablePagination from '../components/StandardTablePagination';
import { db } from '../firebase';
import { TABLE_AVATAR_SIZE } from '../utils/uiConstants';

import type { RecruiterOutletContext } from './RecruiterDashboard';
import { TriggerGroupInterviewDialog } from '../components/recruiter/userGroup/TriggerGroupInterviewDialog';

type UserGroup = {
  id: string;
  title?: string;
  description?: string;
  memberIds?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
};

const RecruiterUserGroups: React.FC = () => {
  const navigate = useNavigate();
  const { activeTenant } = useAuth();
  const tenantId = activeTenant?.id;

  const outletCtx = useOutletContext<RecruiterOutletContext | null>();
  const headerSearch = outletCtx?.search ?? '';

  const [searchParams, setSearchParams] = useSearchParams();

  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [interviewInviteOpen, setInterviewInviteOpen] = useState(false);
  const [interviewInviteGroup, setInterviewInviteGroup] = useState<{ id: string; title: string } | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const groupsRef = collection(db, 'tenants', tenantId, 'userGroups');
        const snapshot = await getDocs(groupsRef);
        const data = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Partial<UserGroup>) })) as UserGroup[];
        setGroups(data);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to load user groups');
        setGroups([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [tenantId]);

  // Open "New Group" dialog via header button (?new=1)
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setShowCreateDialog(true);
    }
  }, [searchParams]);

  // Reset pagination when search changes
  useEffect(() => {
    setPage(0);
  }, [headerSearch]);

  const filteredGroups = useMemo(() => {
    const search = headerSearch.trim().toLowerCase();
    if (!search) return groups;
    return groups.filter((g) => {
      const title = (g.title || '').toLowerCase();
      const desc = (g.description || '').toLowerCase();
      return title.includes(search) || desc.includes(search);
    });
  }, [groups, headerSearch]);

  const paginatedGroups = useMemo(() => {
    const start = page * rowsPerPage;
    return filteredGroups.slice(start, start + rowsPerPage);
  }, [filteredGroups, page, rowsPerPage]);

  const closeCreateDialog = () => {
    setShowCreateDialog(false);
    setNewTitle('');
    setNewDescription('');
    if (searchParams.get('new') === '1') setSearchParams({});
  };

  const handleCreate = async () => {
    if (!tenantId) return;
    const title = newTitle.trim();
    if (!title) return;
    try {
      const groupsRef = collection(db, 'tenants', tenantId, 'userGroups');
      const docRef = await addDoc(groupsRef, {
        title,
        description: newDescription.trim() || '',
        memberIds: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      closeCreateDialog();
      navigate(`/recruiter/user-groups/${docRef.id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create group');
    }
  };

  if (error) {
    return (
      <Box sx={{ px: { xs: 2, md: 3 }, pt: 2 }}>
        <Typography color="error">{error}</Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        px: { xs: 2, md: 3 },
        pt: 2,
      }}
    >
      <TableContainer
        component={Paper}
        elevation={0}
        sx={{
          borderRadius: 2,
          border: '1px solid #EAEEF4',
          position: 'relative',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'auto',
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
          <TableHead
            sx={{
              position: 'sticky',
              top: 0,
              zIndex: 10,
              backgroundColor: '#FFFFFF',
            }}
          >
            <TableRow sx={{ backgroundColor: '#FFFFFF' }}>
              <TableCell sx={{ width: 60, bgcolor: '#FFFFFF' }} />
              <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                Group
              </TableCell>
              <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                Description
              </TableCell>
              <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                Members
              </TableCell>
              <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                Actions
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={5} sx={{ py: 4, textAlign: 'center' }}>
                  <Typography variant="body2" color="text.secondary">
                    Loading user groups…
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {!loading && paginatedGroups.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} sx={{ py: 6, textAlign: 'center' }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                    <Avatar sx={{ width: 72, height: 72, bgcolor: 'rgba(0,0,0,0.04)' }}>
                      <GroupIcon sx={{ color: 'rgba(0,0,0,0.35)' }} />
                    </Avatar>
                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 600 }}>
                        No user groups found
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Create a group to organize access and assignments.
                      </Typography>
                    </Box>
                    <Button
                      variant="contained"
                      startIcon={<AddIcon />}
                      onClick={() => setShowCreateDialog(true)}
                      sx={{
                        textTransform: 'none',
                        borderRadius: '24px',
                        px: 2.5,
                        py: 1,
                        height: '40px',
                        fontWeight: 500,
                        bgcolor: '#0057B8',
                        '&:hover': { bgcolor: '#004a9f' },
                      }}
                    >
                      New Group
                    </Button>
                  </Box>
                </TableCell>
              </TableRow>
            )}

            {!loading &&
              paginatedGroups.map((g) => {
                const title = g.title || 'Untitled Group';
                const initials = title.trim().charAt(0).toUpperCase();
                const memberCount = Array.isArray(g.memberIds) ? g.memberIds.length : 0;
                return (
                  <TableRow
                    key={g.id}
                    hover
                    sx={{
                      cursor: 'pointer',
                      '&:hover': { backgroundColor: 'action.hover' },
                    }}
                    onClick={() => navigate(`/recruiter/user-groups/${g.id}`)}
                  >
                    <TableCell sx={{ width: 60 }}>
                      <Avatar sx={{ width: TABLE_AVATAR_SIZE, height: TABLE_AVATAR_SIZE, bgcolor: 'primary.main', fontSize: '12px' }}>
                        {initials}
                      </Avatar>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {title}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {g.description || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{memberCount}</Typography>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="small"
                        variant="outlined"
                        sx={{ textTransform: 'none' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setInterviewInviteGroup({ id: g.id, title });
                          setInterviewInviteOpen(true);
                        }}
                      >
                        Trigger Interviews
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </TableContainer>

      <StandardTablePagination
        count={filteredGroups.length}
        page={page}
        onPageChange={(_e, newPage) => setPage(newPage)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(e) => {
          setRowsPerPage(parseInt(e.target.value, 10));
          setPage(0);
        }}
      />

      {tenantId && interviewInviteGroup ? (
        <TriggerGroupInterviewDialog
          open={interviewInviteOpen}
          onClose={() => {
            setInterviewInviteOpen(false);
            setInterviewInviteGroup(null);
          }}
          tenantId={tenantId}
          groupId={interviewInviteGroup.id}
          groupTitle={interviewInviteGroup.title}
        />
      ) : null}

      <Dialog open={showCreateDialog} onClose={closeCreateDialog} maxWidth="sm" fullWidth>
        <DialogTitle>New User Group</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label="Group Name"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              autoFocus
              fullWidth
            />
            <TextField
              label="Description (optional)"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              fullWidth
              multiline
              minRows={3}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeCreateDialog} variant="outlined" sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button onClick={handleCreate} variant="contained" disabled={!newTitle.trim()} sx={{ textTransform: 'none' }}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default RecruiterUserGroups;

