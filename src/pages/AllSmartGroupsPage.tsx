/**
 * All Smart Groups – list all saved smart groups in the tenant.
 * Recruiters can see groups created by others and "Add to My Smart Groups" to copy one into their own list.
 */

import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  CircularProgress,
  Alert,
  Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, addDoc, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import type { SavedSmartGroupFilters } from '../services/runSavedSmartGroupSearch';

export interface AllSmartGroupsPageProps {
  hideHeader?: boolean;
}

interface GroupRow {
  id: string;
  name: string;
  memberIds: string[];
  memberStatusById: Record<string, string>;
  filterMode: string;
  filters: SavedSmartGroupFilters;
  createdBy: string | null;
  createdByName: string | null;
  copiedFromGroupId: string | null; // if set, this doc is a copy of another; used to hide originals you already added
  originalCreatedByName: string | null; // when copied, display name of the original group's creator (e.g. "Donna Person")
  createdAt: any;
  updatedAt: any;
}

const AllSmartGroupsPage: React.FC<AllSmartGroupsPageProps> = ({ hideHeader = false }) => {
  const navigate = useNavigate();
  const { tenantId, user } = useAuth();
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId || !user?.uid) return;
    let mounted = true;
    (async () => {
      try {
        const ref = collection(db, 'tenants', tenantId, 'savedSmartGroups');
        const snap = await getDocs(ref);
        if (!mounted) return;
        const creatorIds = new Set<string>();
        const rows: GroupRow[] = snap.docs.map((d) => {
          const data = d.data();
          const createdBy = data.createdBy ?? null;
          if (createdBy) creatorIds.add(createdBy);
          return {
            id: d.id,
            name: data.name ?? 'Untitled',
            memberIds: Array.isArray(data.memberIds) ? data.memberIds : [],
            memberStatusById: (data.memberStatusById ?? {}) as Record<string, string>,
            filterMode: data.filterMode ?? 'residence',
            filters: (data.filters ?? {}) as SavedSmartGroupFilters,
            createdBy,
            createdByName: null,
            copiedFromGroupId: data.copiedFromGroupId ?? null,
            originalCreatedByName: null,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          };
        });
        if (creatorIds.size > 0) {
          const names: Record<string, string> = {};
          await Promise.all(
            Array.from(creatorIds).map(async (uid) => {
              const userSnap = await getDoc(doc(db, 'users', uid));
              if (userSnap.exists()) {
                const d = userSnap.data() as any;
                names[uid] = [d.firstName, d.lastName].filter(Boolean).join(' ').trim() || d.email || 'Unknown';
              } else {
                names[uid] = 'Unknown';
              }
            })
          );
          rows.forEach((r) => {
            if (r.createdBy) r.createdByName = names[r.createdBy] ?? 'Unknown';
          });
        }
        // For copies (added to My Smart Groups), resolve original creator so "Created by" shows who created the group, not who added the copy
        const copiedIds = rows.filter((r) => r.copiedFromGroupId).map((r) => r.copiedFromGroupId!);
        const originalCreatorIds = new Set<string>();
        const sourceCreatedByByCopyId: Record<string, string> = {};
        for (const sourceId of copiedIds) {
          const sourceSnap = await getDoc(doc(db, 'tenants', tenantId!, 'savedSmartGroups', sourceId));
          if (sourceSnap.exists()) {
            const uid = sourceSnap.data()?.createdBy ?? null;
            if (uid) {
              originalCreatorIds.add(uid);
              sourceCreatedByByCopyId[sourceId] = uid;
            }
          }
        }
        if (originalCreatorIds.size > 0) {
          const originalNames: Record<string, string> = {};
          await Promise.all(
            Array.from(originalCreatorIds).map(async (uid) => {
              const userSnap = await getDoc(doc(db, 'users', uid));
              if (userSnap.exists()) {
                const d = userSnap.data() as any;
                originalNames[uid] = [d.firstName, d.lastName].filter(Boolean).join(' ').trim() || d.email || 'Unknown';
              } else {
                originalNames[uid] = 'Unknown';
              }
            })
          );
          rows.forEach((r) => {
            if (r.copiedFromGroupId) {
              const originalUid = sourceCreatedByByCopyId[r.copiedFromGroupId];
              if (originalUid) r.originalCreatedByName = originalNames[originalUid] ?? 'Unknown';
            }
          });
        }
        // Hide originals that the current user has already added (so we don't show the same group twice)
        const myCopiedFromIds = new Set(
          rows.filter((r) => r.createdBy === user.uid && r.copiedFromGroupId).map((r) => r.copiedFromGroupId!)
        );
        const myGroupNames = new Set(
          rows.filter((r) => r.createdBy === user.uid).map((r) => r.name.trim().toLowerCase())
        );
        const filtered = rows.filter((r) => {
          if (myCopiedFromIds.has(r.id)) return false; // exact: I have a copy of this group
          if (r.createdBy !== user.uid && myGroupNames.has(r.name.trim().toLowerCase())) return false; // same name: I already have one (e.g. pre-existing copies)
          return true;
        });
        setGroups(filtered);
      } catch (err: any) {
        if (mounted) setError(err?.message ?? 'Failed to load smart groups');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [tenantId, user?.uid]);

  const handleAddToMySmartGroups = async (row: GroupRow) => {
    if (!tenantId || !user?.uid) return;
    setAddingId(row.id);
    setAddError(null);
    try {
      const ref = collection(db, 'tenants', tenantId, 'savedSmartGroups');
      await addDoc(ref, {
        name: row.name,
        filterMode: row.filterMode,
        filters: row.filters,
        memberIds: row.memberIds,
        memberStatusById: row.memberStatusById,
        createdAt: serverTimestamp(),
        createdBy: user.uid,
        copiedFromGroupId: row.id,
        updatedAt: serverTimestamp(),
      });
      navigate('/users/my-smart-groups');
    } catch (err: any) {
      setAddError(err?.message ?? 'Failed to add to My Smart Groups');
    } finally {
      setAddingId(null);
    }
  };

  const formatDate = (ts: any) => {
    if (!ts) return '—';
    try {
      const date = ts?.toDate ? ts.toDate() : new Date(ts);
      return isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { dateStyle: 'short' });
    } catch {
      return '—';
    }
  };

  const isMine = (row: GroupRow) => row.createdBy === user?.uid;

  return (
    <Box sx={{ pt: 2, px: 2, pb: 2 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {addError && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setAddError(null)}>
          {addError}
        </Alert>
      )}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : groups.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            No smart groups in this tenant yet. Use <strong>Smart Groups</strong> to run a search, then <strong>Save Smart Search</strong> to create one.
          </Typography>
        </Paper>
      ) : (
        <Paper variant="outlined">
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell><strong>Name</strong></TableCell>
                  <TableCell><strong>Created by</strong></TableCell>
                  <TableCell align="right"><strong>Members</strong></TableCell>
                  <TableCell><strong>Updated</strong></TableCell>
                  <TableCell align="right" sx={{ width: 160 }}><strong>Actions</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {groups.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell>
                      <Typography
                        variant="body2"
                        sx={{ cursor: isMine(row) ? 'pointer' : 'default', fontWeight: 500 }}
                        onClick={() => isMine(row) && navigate(`/users/my-smart-groups/${row.id}`)}
                      >
                        {row.name}
                      </Typography>
                    </TableCell>
                    <TableCell>{row.originalCreatedByName ?? row.createdByName ?? '—'}</TableCell>
                    <TableCell align="right">{row.memberIds.length}</TableCell>
                    <TableCell>{formatDate(row.updatedAt)}</TableCell>
                    <TableCell align="right">
                      {isMine(row) ? (
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => navigate(`/users/my-smart-groups/${row.id}`)}
                        >
                          Open
                        </Button>
                      ) : (
                        <Tooltip title="Save a copy to My Smart Groups">
                          <Button
                            size="small"
                            variant="contained"
                            startIcon={addingId === row.id ? <CircularProgress size={14} color="inherit" /> : <AddIcon />}
                            disabled={addingId !== null}
                            onClick={() => handleAddToMySmartGroups(row)}
                          >
                            Add to My Smart Groups
                          </Button>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </Box>
  );
};

export default AllSmartGroupsPage;
