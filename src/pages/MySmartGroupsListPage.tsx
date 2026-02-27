/**
 * My Smart Groups – list of saved smart searches.
 */

import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  List,
  ListItemButton,
  ListItemText,
  CircularProgress,
  Alert,
  Paper,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

export interface MySmartGroupsListPageProps {
  hideHeader?: boolean;
}

const MySmartGroupsListPage: React.FC<MySmartGroupsListPageProps> = ({ hideHeader = false }) => {
  const navigate = useNavigate();
  const { tenantId } = useAuth();
  const [groups, setGroups] = useState<Array<{ id: string; name: string; memberIds: string[]; updatedAt: any }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { user } = useAuth();

  useEffect(() => {
    if (!tenantId || !user?.uid) return;
    let mounted = true;
    (async () => {
      try {
        const ref = collection(db, 'tenants', tenantId, 'savedSmartGroups');
        const q = query(ref, where('createdBy', '==', user.uid));
        const snap = await getDocs(q);
        if (!mounted) return;
        const list = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            name: data.name ?? 'Untitled',
            memberIds: Array.isArray(data.memberIds) ? data.memberIds : [],
            updatedAt: data.updatedAt,
          };
        });
        setGroups(list);
      } catch (err: any) {
        if (mounted) setError(err?.message ?? 'Failed to load saved groups');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [tenantId, user?.uid]);

  const formatDate = (ts: any) => {
    if (!ts) return '—';
    try {
      const date = ts?.toDate ? ts.toDate() : new Date(ts);
      return isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { dateStyle: 'short' });
    } catch {
      return '—';
    }
  };

  return (
    <Box sx={{ pt: 2, px: 2, pb: 2 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : groups.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            No saved smart groups yet. Use Smart Groups to run a search, then click <strong>Save Smart Search</strong> to save it here.
          </Typography>
        </Paper>
      ) : (
        <Paper variant="outlined">
          <List disablePadding>
            {groups.map((g) => (
              <ListItemButton
                key={g.id}
                onClick={() => navigate(`/users/my-smart-groups/${g.id}`)}
              >
                <ListItemText
                  primary={g.name}
                  secondary={`${g.memberIds.length} member${g.memberIds.length !== 1 ? 's' : ''} · Updated ${formatDate(g.updatedAt)}`}
                />
              </ListItemButton>
            ))}
          </List>
        </Paper>
      )}
    </Box>
  );
};

export default MySmartGroupsListPage;
