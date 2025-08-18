import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Alert,
  CircularProgress,
} from '@mui/material';
import { Timeline as TimelineIcon } from '@mui/icons-material';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

// Types for contact activity items
type ContactActivityItem = {
  id: string;
  type: 'task' | 'email';
  timestamp: Date;
  title: string;
  description?: string;
  metadata?: any;
};

interface ContactActivityTabProps {
  contact: any;
  tenantId: string;
}

const ContactActivityTab: React.FC<ContactActivityTabProps> = ({ contact, tenantId }) => {
  const [items, setItems] = useState<ContactActivityItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  // Filters
  const [typeFilter, setTypeFilter] = useState<'all' | 'task' | 'email'>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  // Pagination
  const PAGE_SIZE = 25;
  const [page, setPage] = useState<number>(1);

  useEffect(() => {
    const load = async () => {
      if (!contact?.id || !tenantId) return;
      setLoading(true);
      setError('');
      try {
        const contactId: string = contact.id;
        const aggregated: ContactActivityItem[] = [];

        // Tasks: completed tasks associated to this contact
        try {
          const tasksRef = collection(db, 'tenants', tenantId, 'tasks');
          const tq = query(
            tasksRef,
            where('associations.contacts', 'array-contains', contactId),
            where('status', '==', 'completed'),
            orderBy('updatedAt', 'desc'),
            limit(200)
          );
          const ts = await getDocs(tq);
          ts.forEach((docSnap) => {
            const d = docSnap.data() as any;
            aggregated.push({
              id: `task_${docSnap.id}`,
              type: 'task',
              timestamp: d.completedAt ? new Date(d.completedAt) : (d.updatedAt?.toDate?.() || new Date()),
              title: d.title || 'Task completed',
              description: d.description || '',
              metadata: { priority: d.priority, taskType: d.type }
            });
          });
        } catch {}

        // Emails: email_logs filtered by contactId
        try {
          const emailsRef = collection(db, 'tenants', tenantId, 'email_logs');
          const cq = query(emailsRef, where('contactId', '==', contactId), orderBy('timestamp', 'desc'), limit(200));
          const cs = await getDocs(cq);
          cs.forEach((docSnap) => {
            const d = docSnap.data() as any;
            aggregated.push({
              id: `email_${docSnap.id}`,
              type: 'email',
              timestamp: d.timestamp?.toDate?.() || new Date(),
              title: `Email: ${d.subject || '(no subject)'}`,
              description: d.bodySnippet,
              metadata: { from: d.from, to: d.to, direction: d.direction }
            });
          });
        } catch {}

        // Sort newest first
        aggregated.sort((a, b) => (b.timestamp?.getTime?.() || 0) - (a.timestamp?.getTime?.() || 0));
        setItems(aggregated);
        setPage(1);
      } catch (e: any) {
        setError(e?.message || 'Failed to load activity');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [contact?.id, tenantId]);

  // Derived list after filters
  const filtered = items.filter((it) => {
    if (typeFilter !== 'all' && it.type !== typeFilter) return false;
    if (startDate) {
      const s = new Date(startDate + 'T00:00:00');
      if (it.timestamp < s) return false;
    }
    if (endDate) {
      const e = new Date(endDate + 'T23:59:59');
      if (it.timestamp > e) return false;
    }
    return true;
  });
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Box>
      <Box display="flex" alignItems="center" justifyContent="space-between" sx={{ mt: 0, mb: 1, px: 3 }}>
        <Box display="flex" alignItems="center" gap={1}>
          <TimelineIcon /><Typography variant="h6">Contact Activity</Typography>
        </Box>
        {/* Filters */}
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Type</InputLabel>
            <Select value={typeFilter} label="Type" onChange={(e) => { setTypeFilter(e.target.value as any); setPage(1); }}>
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="task">Tasks</MenuItem>
              <MenuItem value="email">Emails</MenuItem>
            </Select>
          </FormControl>
          <TextField
            type="date"
            size="small"
            label="Start"
            InputLabelProps={{ shrink: true }}
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
          />
          <TextField
            type="date"
            size="small"
            label="End"
            InputLabelProps={{ shrink: true }}
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
          />
          <Typography variant="body2" color="text.secondary">
            {total} results
          </Typography>
        </Box>
      </Box>
      <Card>
        <CardContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {loading ? (
            <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>
          ) : filtered.length === 0 ? (
            <Box textAlign="center" py={4}>
              <Typography color="text.secondary">No activity yet.</Typography>
              <Typography variant="caption" color="text.secondary">Completed tasks and emails will appear here.</Typography>
            </Box>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Type</TableCell>
                    <TableCell>Title</TableCell>
                    <TableCell>Description</TableCell>
                    <TableCell>When</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pageItems.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell><Chip size="small" label={it.type} /></TableCell>
                      <TableCell><Typography variant="body2">{it.title}</Typography></TableCell>
                      <TableCell><Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>{it.description}</Typography></TableCell>
                      <TableCell><Typography variant="caption" color="text.secondary">{it.timestamp?.toLocaleString?.()}</Typography></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
          {/* Pagination */}
          {filtered.length > 0 && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 2 }}>
              <Button size="small" variant="outlined" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
              <Typography variant="caption">Page {page} of {totalPages}</Typography>
              <Button size="small" variant="outlined" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

export default ContactActivityTab;
