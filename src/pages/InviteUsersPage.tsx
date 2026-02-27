/**
 * Invite Users – form to send SMS/email invites to potential workers
 * (e.g. applicants from Indeed or other platforms) to bring them to HRX.
 * Path and message template persist so recruiters can send multiple invites to the same job/group.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Autocomplete,
  CircularProgress,
  Snackbar,
  Alert,
  Tabs,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { format } from 'date-fns';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import { useAuth } from '../contexts/AuthContext';

export type InviteTabValue = 'invite' | 'past';

export type InvitePath = 'job_post' | 'group' | 'general';

export interface JobOrderOption {
  id: string;
  label: string;   // job order name (for dropdown display)
  jobTitle?: string; // job title within the order (for email subject)
}

export interface GroupOption {
  id: string;
  label: string;
}

const SUBJECT_GENERAL_AND_GROUP = '{firstName}, thank you for your application to C1';
const SUBJECT_JOB_POST = '{firstName}, thank you for your application as a {jobTitle} with C1';
const DEFAULT_MESSAGE_BODY = `Hi {firstName},

Thank you for your application. You seem like a perfect fit. Please click the link below to register in our system so we can move forward and schedule an interview.

{applyLink}

We look forward to speaking with you.`;

export interface InviteUsersPageProps {
  hideHeader?: boolean;
}

function buildApplyLink(
  path: InvitePath,
  _tenantId: string | null,
  jobPostId: string | null,
  groupId: string | null
): string {
  const baseUrl = 'https://hrxone.com';
  if (path === 'general') return `${baseUrl}/c1/apply`;
  if (path === 'group' && groupId) return `${baseUrl}/c1/apply/group/${groupId}`;
  // Job Post: link to jobs board detail page (same URL candidates see), not the apply wizard
  if (path === 'job_post' && jobPostId) return `${baseUrl}/c1/jobs-board/${jobPostId}`;
  return '';
}

const InviteUsersPage: React.FC<InviteUsersPageProps> = ({ hideHeader = false }) => {
  const { tenantId } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [cellPhone, setCellPhone] = useState('');
  const [emailAddress, setEmailAddress] = useState('');
  const [path, setPath] = useState<InvitePath>('general');
  const [selectedJobOrder, setSelectedJobOrder] = useState<JobOrderOption | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<GroupOption | null>(null);
  const [messageBody, setMessageBody] = useState(DEFAULT_MESSAGE_BODY);

  const [jobPosts, setJobPosts] = useState<JobOrderOption[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [loadingJobPosts, setLoadingJobPosts] = useState(false);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [sending, setSending] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });
  const [inviteTab, setInviteTab] = useState<InviteTabValue>('invite');
  const [pastInvites, setPastInvites] = useState<Array<{ id: string; firstName: string; lastName: string; email: string; phone: string | null; path: string; pathLabel: string | null; inviteSentAt: any }>>([]);
  const [loadingPastInvites, setLoadingPastInvites] = useState(false);
  const [pastSearch, setPastSearch] = useState('');
  const [pastOrderBy, setPastOrderBy] = useState<'firstName' | 'lastName' | 'email' | 'phone' | 'inviteSentAt'>('inviteSentAt');
  const [pastOrder, setPastOrder] = useState<'asc' | 'desc'>('desc');

  // Load job board posts (job_postings) so invite link goes to /c1/jobs-board/{postId}
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      setLoadingJobPosts(true);
      try {
        const postsRef = collection(db, 'tenants', tenantId, 'job_postings');
        const snap = await getDocs(postsRef);
        if (cancelled) return;
        setJobPosts(
          snap.docs.map((d) => {
            const data = d.data();
            const postTitle = (data.postTitle as string) || (data.jobOrderName as string);
            const jobTitle = (data.jobTitle as string);
            return {
              id: d.id,
              label: postTitle || jobTitle || 'Unnamed posting',
              jobTitle: jobTitle || undefined,
            };
          })
        );
      } catch (e) {
        if (!cancelled) setJobPosts([]);
      } finally {
        if (!cancelled) setLoadingJobPosts(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      setLoadingGroups(true);
      try {
        const groupsRef = collection(db, p.userGroups(tenantId));
        const snap = await getDocs(groupsRef);
        if (cancelled) return;
        setGroups(
          snap.docs.map((d) => {
            const data = d.data();
            const label = (data.title as string) || (data.name as string) || 'Unnamed Group';
            return { id: d.id, label };
          })
        );
      } catch (e) {
        if (!cancelled) setGroups([]);
      } finally {
        if (!cancelled) setLoadingGroups(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const applyLink = useMemo(
    () =>
      buildApplyLink(
        path,
        tenantId ?? null,
        path === 'job_post' ? (selectedJobOrder?.id ?? null) : null,
        path === 'group' ? selectedGroup?.id ?? null : null
      ),
    [path, tenantId, selectedJobOrder?.id, selectedGroup?.id]
  );

  const previewSubject = useMemo(() => {
    const first = firstName.trim() || '{firstName}';
    if (path === 'general' || path === 'group') {
      return SUBJECT_GENERAL_AND_GROUP.replace(/\{firstName\}/g, first);
    }
    if (path === 'job_post') {
      const jobTitle = (selectedJobOrder?.jobTitle ?? selectedJobOrder?.label)?.trim() || 'candidate';
      return SUBJECT_JOB_POST.replace(/\{firstName\}/g, first).replace(/\{jobTitle\}/g, jobTitle);
    }
    return '';
  }, [path, firstName, selectedJobOrder?.label, selectedJobOrder?.jobTitle]);

  const previewBody = useMemo(() => {
    const first = firstName.trim() || '{firstName}';
    const link = applyLink || '{applyLink}';
    return messageBody.replace(/\{firstName\}/g, first).replace(/\{applyLink\}/g, link);
  }, [firstName, messageBody, applyLink]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = emailAddress.trim();
    if (!email) {
      setSnackbar({ open: true, message: 'Email address is required.', severity: 'error' });
      return;
    }
    setSending(true);
    setSnackbar(prev => ({ ...prev, open: false }));
    try {
      const functions = getFunctions();
      const pathLabel =
        path === 'general'
          ? 'General'
          : path === 'group' && selectedGroup
            ? `Group: ${selectedGroup.label}`
            : path === 'job_post' && selectedJobOrder
              ? `Job Post: ${selectedJobOrder.label}`
              : path === 'group'
                ? 'Group'
                : path === 'job_post'
                  ? 'Job Post'
                  : 'General';
      const sendInvite = httpsCallable<{ email: string; firstName?: string; lastName?: string; phone?: string; subject: string; body: string; tenantId?: string; path?: string; pathLabel?: string }, { success: boolean; emailSent: boolean; smsSent: boolean }>(functions, 'sendRecruiterInvite');
      await sendInvite({
        email,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: cellPhone.trim() || undefined,
        subject: previewSubject,
        body: previewBody,
        tenantId: tenantId ?? undefined,
        path,
        pathLabel,
      });
      setFirstName('');
      setLastName('');
      setCellPhone('');
      setEmailAddress('');
      setSnackbar({ open: true, message: 'Invite sent successfully. Email and SMS (if phone provided) were delivered.', severity: 'success' });
    } catch (err: any) {
      const message = err?.message || err?.code || 'Failed to send invite. Please try again.';
      setSnackbar({ open: true, message, severity: 'error' });
    } finally {
      setSending(false);
    }
  };

  const handlePathChange = (value: InvitePath) => {
    setPath(value);
    if (value !== 'job_post') setSelectedJobOrder(null);
    if (value !== 'group') setSelectedGroup(null);
  };

  // Load past invites when switching to Past invites tab
  useEffect(() => {
    if (inviteTab !== 'past' || !tenantId) return;
    let cancelled = false;
    setLoadingPastInvites(true);
    (async () => {
      try {
        const ref = collection(db, p.inviteLog(tenantId));
        const q = query(ref, orderBy('inviteSentAt', 'desc'));
        const snap = await getDocs(q);
        if (cancelled) return;
        setPastInvites(
          snap.docs.map((d) => {
            const data = d.data();
            const pathVal = (data.path as string) || 'general';
            return {
              id: d.id,
              firstName: (data.firstName as string) || '',
              lastName: (data.lastName as string) || '',
              email: (data.email as string) || '',
              phone: (data.phone as string) || null,
              path: pathVal,
              pathLabel: (data.pathLabel as string) || null,
              inviteSentAt: data.inviteSentAt,
            };
          })
        );
      } catch (e) {
        if (!cancelled) setPastInvites([]);
      } finally {
        if (!cancelled) setLoadingPastInvites(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteTab, tenantId]);

  const filteredAndSortedPastInvites = useMemo(() => {
    const searchLower = pastSearch.toLowerCase().trim();
    let list = pastInvites;
    if (searchLower) {
      list = list.filter(
        (row) =>
          (row.firstName || '').toLowerCase().includes(searchLower) ||
          (row.lastName || '').toLowerCase().includes(searchLower) ||
          (row.email || '').toLowerCase().includes(searchLower) ||
          (row.phone || '').toLowerCase().includes(searchLower)
      );
    }
    const sorted = [...list].sort((a, b) => {
      let aVal: string | number | Date = '';
      let bVal: string | number | Date = '';
      switch (pastOrderBy) {
        case 'firstName':
          aVal = (a.firstName || '').toLowerCase();
          bVal = (b.firstName || '').toLowerCase();
          break;
        case 'lastName':
          aVal = (a.lastName || '').toLowerCase();
          bVal = (b.lastName || '').toLowerCase();
          break;
        case 'email':
          aVal = (a.email || '').toLowerCase();
          bVal = (b.email || '').toLowerCase();
          break;
        case 'phone':
          aVal = (a.phone || '').toLowerCase();
          bVal = (b.phone || '').toLowerCase();
          break;
        case 'inviteSentAt':
          aVal = a.inviteSentAt?.toDate ? a.inviteSentAt.toDate().getTime() : 0;
          bVal = b.inviteSentAt?.toDate ? b.inviteSentAt.toDate().getTime() : 0;
          break;
        default:
          return 0;
      }
      if (pastOrder === 'asc') return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
    });
    return sorted;
  }, [pastInvites, pastSearch, pastOrderBy, pastOrder]);

  const handlePastSort = (property: typeof pastOrderBy) => {
    const isAsc = pastOrderBy === property && pastOrder === 'asc';
    setPastOrder(isAsc ? 'desc' : 'asc');
    setPastOrderBy(property);
  };

  const formatInviteSent = (ts: any) => {
    if (!ts) return '—';
    try {
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return format(d, 'MMM d, yyyy h:mm a');
    } catch {
      return '—';
    }
  };

  return (
    <Box sx={{ pt: 2, px: 2, pb: 2, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        Invite users to HRX
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Send an SMS or email invite to potential workers who have applied on Indeed or other platforms to bring them into HRX.
      </Typography>
      <Tabs value={inviteTab} onChange={(_, v) => setInviteTab(v as InviteTabValue)} sx={{ mb: 2, minHeight: 36 }}>
        <Tab label="Invite User" value="invite" />
        <Tab label="Past invites" value="past" />
      </Tabs>

      {inviteTab === 'invite' && (
      <Grid container spacing={3} sx={{ flex: 1, minHeight: 0 }}>
        <Grid item xs={12} md={6}>
          <Paper variant="outlined" sx={{ p: 3 }}>
            <form onSubmit={handleSubmit}>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="First Name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    variant="outlined"
                    size="small"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Last Name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    variant="outlined"
                    size="small"
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Cell Phone"
                    value={cellPhone}
                    onChange={(e) => setCellPhone(e.target.value)}
                    variant="outlined"
                    size="small"
                    placeholder="e.g. (555) 123-4567"
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Email Address"
                    type="email"
                    value={emailAddress}
                    onChange={(e) => setEmailAddress(e.target.value)}
                    variant="outlined"
                    size="small"
                  />
                </Grid>
                <Grid item xs={12}>
                  <FormControl fullWidth size="small">
                    <InputLabel id="invite-path-label">Path</InputLabel>
                    <Select
                      labelId="invite-path-label"
                      label="Path"
                      value={path}
                      onChange={(e) => handlePathChange(e.target.value as InvitePath)}
                    >
                      <MenuItem value="job_post">Job Post</MenuItem>
                      <MenuItem value="group">Group</MenuItem>
                      <MenuItem value="general">General</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                {path === 'job_post' && (
                  <Grid item xs={12}>
                    <Autocomplete
                      size="small"
                      options={jobPosts}
                      getOptionLabel={(opt) => opt.label}
                      value={selectedJobOrder}
                      onChange={(_, v) => setSelectedJobOrder(v)}
                      loading={loadingJobPosts}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="Job post"
                          placeholder="Search job postings"
                        />
                      )}
                    />
                  </Grid>
                )}
                {path === 'group' && (
                  <Grid item xs={12}>
                    <Autocomplete
                      size="small"
                      options={groups}
                      getOptionLabel={(opt) => opt.label}
                      value={selectedGroup}
                      onChange={(_, v) => setSelectedGroup(v)}
                      loading={loadingGroups}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="Group"
                          placeholder="Search group names"
                        />
                      )}
                    />
                  </Grid>
                )}
                <Grid item xs={12}>
                  <Button
                    type="submit"
                    variant="contained"
                    startIcon={sending ? <CircularProgress size={20} color="inherit" /> : <SendIcon />}
                    disabled={sending}
                    sx={{ textTransform: 'none' }}
                  >
                    {sending ? 'Sending…' : 'Send invite'}
                  </Button>
                </Grid>
              </Grid>
            </form>
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper variant="outlined" sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column', minHeight: 320 }}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
              Message (subject + body; body used for both SMS and email)
            </Typography>
            <TextField
              fullWidth
              size="small"
              label="Email subject"
              value={previewSubject}
              disabled
              helperText={
                path === 'job_post'
                  ? 'Uses first name and selected job order title.'
                  : 'For General and Group: firstName, thank you for your application to C1'
              }
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              multiline
              minRows={4}
              label="Body template"
              placeholder="Use {firstName} and {applyLink} as placeholders"
              value={messageBody}
              onChange={(e) => setMessageBody(e.target.value)}
              sx={{ mb: 2 }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
              Preview (resolved)
            </Typography>
            <TextField
              fullWidth
              multiline
              minRows={6}
              maxRows={12}
              value={previewBody}
              disabled
              InputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.875rem' } }}
              sx={{ flex: 1 }}
            />
            {!applyLink && path !== 'general' && (
              <Typography variant="caption" color="warning.main" sx={{ mt: 1 }}>
                {path === 'job_post' ? 'Select a job order to see the apply link.' : 'Select a group to see the apply link.'}
              </Typography>
            )}
          </Paper>
        </Grid>
      </Grid>
      )}

      {inviteTab === 'past' && (
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
            <TextField
              size="small"
              placeholder="Search by name, email, or phone…"
              value={pastSearch}
              onChange={(e) => setPastSearch(e.target.value)}
              sx={{ maxWidth: 320 }}
            />
          </Box>
          <TableContainer component={Paper} variant="outlined" sx={{ flex: 1, overflow: 'auto' }}>
            {loadingPastInvites ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress />
              </Box>
            ) : (
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>
                      <TableSortLabel
                        active={pastOrderBy === 'firstName'}
                        direction={pastOrderBy === 'firstName' ? pastOrder : 'asc'}
                        onClick={() => handlePastSort('firstName')}
                      >
                        First Name
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>
                      <TableSortLabel
                        active={pastOrderBy === 'lastName'}
                        direction={pastOrderBy === 'lastName' ? pastOrder : 'asc'}
                        onClick={() => handlePastSort('lastName')}
                      >
                        Last Name
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>
                      <TableSortLabel
                        active={pastOrderBy === 'email'}
                        direction={pastOrderBy === 'email' ? pastOrder : 'asc'}
                        onClick={() => handlePastSort('email')}
                      >
                        Email
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>
                      <TableSortLabel
                        active={pastOrderBy === 'phone'}
                        direction={pastOrderBy === 'phone' ? pastOrder : 'asc'}
                        onClick={() => handlePastSort('phone')}
                      >
                        Phone
                      </TableSortLabel>
                    </TableCell>
                    <TableCell><strong>Path</strong></TableCell>
                    <TableCell>
                      <TableSortLabel
                        active={pastOrderBy === 'inviteSentAt'}
                        direction={pastOrderBy === 'inviteSentAt' ? pastOrder : 'asc'}
                        onClick={() => handlePastSort('inviteSentAt')}
                      >
                        Invite Sent
                      </TableSortLabel>
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredAndSortedPastInvites.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ py: 3 }}>
                        {pastSearch ? 'No matching invites.' : 'No invites sent yet.'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAndSortedPastInvites.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>{row.firstName || '—'}</TableCell>
                        <TableCell>{row.lastName || '—'}</TableCell>
                        <TableCell>{row.email || '—'}</TableCell>
                        <TableCell>{row.phone || '—'}</TableCell>
                        <TableCell>
                          {row.pathLabel ?? (row.path === 'job_post' ? 'Job Post' : row.path === 'group' ? 'Group' : 'General')}
                        </TableCell>
                        <TableCell>{formatInviteSent(row.inviteSentAt)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </TableContainer>
        </Box>
      )}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default InviteUsersPage;
