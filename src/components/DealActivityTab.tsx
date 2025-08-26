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
import { collection, query, where, orderBy, limit, getDocs, onSnapshot } from 'firebase/firestore';
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

const getActivityTypeColor = (type: string): string => {
  const colors: { [key: string]: string } = {
    task: '#10B981',      // Green for completed tasks
    note: '#3B82F6',      // Blue for notes
    deal_stage: '#8B5CF6', // Purple for deal stages
    email: '#F59E0B'      // Orange for emails
  };
  return colors[type] || '#6B7280'; // Gray fallback
};

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
  // Real-time listeners for tasks, notes, stage history, and emails
  useEffect(() => {
    if (!deal?.id || !tenantId) return;
    setLoading(true);
    setError('');

    const dealId: string = deal.id;
    const contactIds: string[] = Array.isArray(deal.associations?.contacts)
      ? (deal.associations.contacts as any[])
          .map((c: any) => (typeof c === 'string' ? c : c?.id))
          .filter((id: any) => typeof id === 'string' && id.length > 0)
      : [];

    const unsubs: Array<() => void> = [];

    const update = (parts: DealActivityItem[][]) => {
      const aggregated = parts.flat();
      aggregated.sort((a, b) => (b.timestamp?.getTime?.() || 0) - (a.timestamp?.getTime?.() || 0));
      setItems(aggregated);
      setPage(1);
      setLoading(false);
    };

    let tasks: DealActivityItem[] = [];
    let notes: DealActivityItem[] = [];
    let stages: DealActivityItem[] = [];
    let emails: DealActivityItem[] = [];

    // Tasks listener
    try {
      const tasksRef = collection(db, 'tenants', tenantId, 'tasks');
      const tq = query(
        tasksRef,
        where('associations.deals', 'array-contains', dealId),
        where('status', '==', 'completed'),
        orderBy('updatedAt', 'desc'),
        limit(200)
      );
      unsubs.push(onSnapshot(tq, (snap) => {
        tasks = snap.docs.map((docSnap) => {
          const d = docSnap.data() as any;
          return {
            id: `task_${docSnap.id}`,
            type: 'task',
            timestamp: d.completedAt ? new Date(d.completedAt) : (d.updatedAt?.toDate?.() || new Date()),
            title: d.title || 'Task completed',
            description: d.description || '',
            metadata: { priority: d.priority, taskType: d.type }
          } as DealActivityItem;
        });
        update([tasks, notes, stages, emails]);
      }));
    } catch {}

    // Notes listener
    try {
      const notesRef = collection(db, 'tenants', tenantId, 'notes');
      const nq = query(
        notesRef,
        where('entityId', '==', dealId),
        where('entityType', '==', 'deal'),
        orderBy('timestamp', 'desc'),
        limit(200)
      );
      unsubs.push(onSnapshot(nq, (snap) => {
        notes = snap.docs.map((docSnap) => {
          const d = docSnap.data() as any;
          return {
            id: `note_${docSnap.id}`,
            type: 'note',
            timestamp: d.timestamp?.toDate?.() || new Date(),
            title: d.category ? `Note (${d.category})` : 'Note',
            description: d.content,
            metadata: { authorName: d.authorName, priority: d.priority, source: d.source }
          } as DealActivityItem;
        });
        update([tasks, notes, stages, emails]);
      }));
    } catch {}

    // Stage history listener
    try {
      const stageRef = collection(db, 'tenants', tenantId, 'crm_deals', dealId, 'stage_history');
      const sq = query(stageRef, orderBy('timestamp', 'desc'), limit(100));
      unsubs.push(onSnapshot(sq, (snap) => {
        stages = snap.docs.map((docSnap) => {
          const d = docSnap.data() as any;
          return {
            id: `dealstage_${dealId}_${docSnap.id}`,
            type: 'deal_stage',
            timestamp: d.timestamp?.toDate?.() || new Date(),
            title: `Deal stage: ${d.fromStage || '?'} → ${d.toStage || d.stage || '?'}`,
            description: d.reason || 'Stage updated',
            metadata: { dealId }
          } as DealActivityItem;
        });
        update([tasks, notes, stages, emails]);
      }));
    } catch {}

    // Emails listeners (deal + contacts)
    try {
      const emailsRef = collection(db, 'tenants', tenantId, 'email_logs');
      const dq = query(emailsRef, where('dealId', '==', dealId), orderBy('timestamp', 'desc'), limit(200));
      unsubs.push(onSnapshot(dq, (snap) => {
        const dealEmails = snap.docs.map((docSnap) => {
          const d = docSnap.data() as any;
          return {
            id: `email_deal_${docSnap.id}`,
            type: 'email',
            timestamp: d.timestamp?.toDate?.() || new Date(),
            title: `Email: ${d.subject || '(no subject)'}`,
            description: d.bodySnippet,
            metadata: { from: d.from, to: d.to, direction: d.direction }
          } as DealActivityItem;
        });
        // Keep contact emails; merge with deal emails
        emails = [...dealEmails, ...emails.filter((e) => e.id.startsWith('email_contact_'))];
        update([tasks, notes, stages, emails]);
      }));

      // Contact-specific emails
      for (const contactId of contactIds) {
        try {
          const cq = query(emailsRef, where('contactId', '==', contactId), orderBy('timestamp', 'desc'), limit(200));
          unsubs.push(onSnapshot(cq, (snap) => {
            const contactEmails = snap.docs.map((docSnap) => {
              const d = docSnap.data() as any;
              return {
                id: `email_contact_${contactId}_${docSnap.id}`,
                type: 'email',
                timestamp: d.timestamp?.toDate?.() || new Date(),
                title: `Email: ${d.subject || '(no subject)'}`,
                description: d.bodySnippet,
                metadata: { from: d.from, to: d.to, direction: d.direction }
              } as DealActivityItem;
            });
            // Remove previous entries for this contact and merge
            emails = [
              ...emails.filter((e) => !e.id.startsWith(`email_contact_${contactId}_`)),
              ...contactEmails,
            ];
            update([tasks, notes, stages, emails]);
          }));
        } catch {}
      }
    } catch {}

    return () => {
      unsubs.forEach((u) => {
        try { u(); } catch {}
      });
    };
  }, [deal?.id, tenantId, deal?.associations?.contacts]);

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
      <Box display="flex" alignItems="center" justifyContent="space-between" sx={{ mt: 0, mb: 2, px: 3 }}>
        <Box display="flex" alignItems="center" gap={1}>
          <TimelineIcon />
          <Typography variant="h6" fontWeight={700}>Deal Activity</Typography>
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
        <CardContent sx={{ p: 0 }}>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {loading ? (
            <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>
          ) : filtered.length === 0 ? (
            <Box textAlign="center" py={4}>
              <Typography color="text.secondary">No activity yet.</Typography>
              <Typography variant="caption" color="text.secondary">Completed tasks, notes, deal stage changes, and emails will appear here.</Typography>
            </Box>
          ) : (
            <TableContainer 
              component={Paper} 
              variant="outlined"
              sx={{
                overflowX: 'auto',
                borderRadius: '8px',
                boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)'
              }}
            >
              <Table sx={{ minWidth: 1400 }}>
                <TableHead>
                  <TableRow sx={{ backgroundColor: '#F9FAFB' }}>
                    <TableCell sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#374151',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid #E5E7EB',
                      py: 1.5
                    }}>
                      Type
                    </TableCell>
                    <TableCell sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#374151',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid #E5E7EB',
                      py: 1.5
                    }}>
                      Title
                    </TableCell>
                    <TableCell sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#374151',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid #E5E7EB',
                      py: 1.5
                    }}>
                      Description
                    </TableCell>
                    <TableCell sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#374151',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid #E5E7EB',
                      py: 1.5
                    }}>
                      When
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pageItems.map((it) => (
                    <TableRow 
                      key={it.id}
                      sx={{
                        height: '48px',
                        cursor: 'pointer',
                        '&:hover': {
                          backgroundColor: '#F9FAFB'
                        }
                      }}
                    >
                      <TableCell sx={{ py: 1 }}>
                        <Chip 
                          size="small" 
                          label={it.type.replace('_', ' ')} 
                          sx={{
                            fontSize: '0.75rem',
                            height: 24,
                            fontWeight: 600,
                            backgroundColor: getActivityTypeColor(it.type),
                            color: 'white'
                          }}
                        />
                      </TableCell>
                      <TableCell sx={{ py: 1, px: 2 }}>
                        <Typography sx={{
                          variant: "body2",
                          color: "#111827",
                          fontSize: '0.9375rem',
                          fontWeight: 600
                        }}>
                          {it.title}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        <Typography sx={{
                          variant: "body2",
                          color: "#6B7280",
                          fontSize: '0.875rem',
                          maxWidth: 420,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}>
                          {it.description}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ py: 1 }}>
                        <Typography sx={{
                          variant: "body2",
                          color: "#6B7280",
                          fontSize: '0.875rem'
                        }}>
                          {it.timestamp?.toLocaleString?.()}
                        </Typography>
                      </TableCell>
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