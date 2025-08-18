import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardHeader,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Chip,
  Button,
  CircularProgress,
  Alert,
} from '@mui/material';
import {
  Timeline as TimelineIcon,
} from '@mui/icons-material';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

type DealActivityItem = {
  id: string;
  type: 'task' | 'note' | 'deal_stage' | 'email';
  timestamp: Date;
  title: string;
  description?: string;
  metadata?: any;
};

interface DealActivityTabProps {
  deal: any;
  tenantId: string;
}

const DealActivityTab: React.FC<DealActivityTabProps> = ({ deal, tenantId }) => {
  const [items, setItems] = useState<DealActivityItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  // Filters
  const [typeFilter, setTypeFilter] = useState<'all' | 'task' | 'note' | 'deal_stage' | 'email'>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  // Pagination
  const PAGE_SIZE = 25;
  const [page, setPage] = useState<number>(1);

  useEffect(() => {
    const load = async () => {
      if (!deal?.id || !tenantId) return;
      setLoading(true);
      setError('');
      try {
        const dealId: string = deal.id;
        const contactIds: string[] = Array.isArray(deal.associations?.contacts) ? deal.associations.contacts : [];

        const aggregated: DealActivityItem[] = [];

        // Tasks: completed tasks associated to this deal
        try {
          const tasksRef = collection(db, 'tenants', tenantId, 'tasks');
          const tq = query(
            tasksRef,
            where('associations.deals', 'array-contains', dealId),
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

        // Notes: deal notes
        try {
          const notesRef = collection(db, 'tenants', tenantId, 'notes');
          const nq = query(
            notesRef, 
            where('entityId', '==', dealId), 
            where('entityType', '==', 'deal'),
            orderBy('timestamp', 'desc'), 
            limit(200)
          );
          const ns = await getDocs(nq);
          ns.forEach((docSnap) => {
            const d = docSnap.data() as any;
            aggregated.push({
              id: `note_${docSnap.id}`,
              type: 'note',
              timestamp: d.timestamp?.toDate?.() || new Date(),
              title: d.category ? `Note (${d.category})` : 'Note',
              description: d.content,
              metadata: { authorName: d.authorName, priority: d.priority, source: d.source }
            });
          });
        } catch {}

        // Deal stage progression: subcollection stage_history under the deal
        try {
          const stageRef = collection(db, 'tenants', tenantId, 'crm_deals', dealId, 'stage_history');
          const sq = query(stageRef, orderBy('timestamp', 'desc'), limit(100));
          const ss = await getDocs(sq);
          ss.forEach((docSnap) => {
            const d = docSnap.data() as any;
            aggregated.push({
              id: `dealstage_${dealId}_${docSnap.id}`,
              type: 'deal_stage',
              timestamp: d.timestamp?.toDate?.() || new Date(),
              title: `Deal stage: ${d.fromStage || '?'} → ${d.toStage || d.stage || '?'}`,
              description: d.reason || 'Stage updated',
              metadata: { dealId }
            });
          });
        } catch {}

        // Emails: email_logs filtered by dealId and by each contactId
        try {
          const emailsRef = collection(db, 'tenants', tenantId, 'email_logs');
          // Deal-specific emails
          const dq = query(emailsRef, where('dealId', '==', dealId), orderBy('timestamp', 'desc'), limit(200));
          const ds = await getDocs(dq);
          ds.forEach((docSnap) => {
            const d = docSnap.data() as any;
            aggregated.push({
              id: `email_deal_${docSnap.id}`,
              type: 'email',
              timestamp: d.timestamp?.toDate?.() || new Date(),
              title: `Email: ${d.subject || '(no subject)'}`,
              description: d.bodySnippet,
              metadata: { from: d.from, to: d.to, direction: d.direction }
            });
          });
          
          // Contact-specific emails
          for (const contactId of contactIds) {
            try {
              const cq = query(emailsRef, where('contactId', '==', contactId), orderBy('timestamp', 'desc'), limit(200));
              const cs = await getDocs(cq);
              cs.forEach((docSnap) => {
                const d = docSnap.data() as any;
                aggregated.push({
                  id: `email_contact_${contactId}_${docSnap.id}`,
                  type: 'email',
                  timestamp: d.timestamp?.toDate?.() || new Date(),
                  title: `Email: ${d.subject || '(no subject)'}`,
                  description: d.bodySnippet,
                  metadata: { from: d.from, to: d.to, direction: d.direction }
                });
              });
            } catch {}
          }
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
  }, [deal?.id, tenantId]);

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
          <TimelineIcon /><Typography variant="h6">Deal Activity</Typography>
        </Box>
        {/* Filters */}
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Type</InputLabel>
            <Select value={typeFilter} label="Type" onChange={(e) => { setTypeFilter(e.target.value as any); setPage(1); }}>
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="task">Tasks</MenuItem>
              <MenuItem value="note">Notes</MenuItem>
              <MenuItem value="deal_stage">Deal Stages</MenuItem>
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
              <Typography variant="caption" color="text.secondary">Completed tasks, notes, deal stage changes, and emails will appear here.</Typography>
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
                      <TableCell><Chip size="small" label={it.type.replace('_', ' ')} /></TableCell>
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

export default DealActivityTab; 