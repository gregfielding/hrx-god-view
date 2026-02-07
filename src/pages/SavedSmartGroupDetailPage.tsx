/**
 * Saved Smart Group detail: member list with status and "Update results".
 */

import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Alert,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Menu,
  MenuItem,
  Avatar,
  Tooltip,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RefreshIcon from '@mui/icons-material/Refresh';
import EmailIcon from '@mui/icons-material/Email';
import PhoneIcon from '@mui/icons-material/Phone';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import InsightsIcon from '@mui/icons-material/Insights';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import BlockIcon from '@mui/icons-material/Block';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { runSavedSmartGroupSearch, type SavedSmartGroupFilters } from '../services/runSavedSmartGroupSearch';
import type { CustomMetrosMap } from '../hooks/useSmartGroupSettings';
import { formatPhoneNumber } from '../utils/formatPhone';
import { TABLE_AVATAR_SIZE } from '../utils/uiConstants';
import { formatOneDecimal } from '../utils/scoreSummary';

type MemberStatus = 'preferred' | 'member' | 'not_preferred';

export interface SavedSmartGroupDetailPageProps {
  hideHeader?: boolean;
}

const SavedSmartGroupDetailPage: React.FC<SavedSmartGroupDetailPageProps> = ({ hideHeader = false }) => {
  const navigate = useNavigate();
  const { groupId } = useParams<{ groupId: string }>();
  const { tenantId } = useAuth();
  const [group, setGroup] = useState<{
    name: string;
    memberIds: string[];
    memberStatusById: Record<string, MemberStatus>;
    filters: SavedSmartGroupFilters;
  } | null>(null);
  const [membersData, setMembersData] = useState<Array<{
    id: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    avatar?: string;
    city?: string;
    state?: string;
    scoreSummary?: { aiScore?: number; interviewLastAt?: any; interviewLastScore10?: number };
    securityLevel?: string;
    skills?: string[];
  }>>([]);
  const [statusMenuAnchor, setStatusMenuAnchor] = useState<{ [userId: string]: HTMLElement | null }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId || !groupId) return;
    let mounted = true;
    (async () => {
      try {
        const ref = doc(db, 'tenants', tenantId, 'savedSmartGroups', groupId);
        const snap = await getDoc(ref);
        if (!mounted) return;
        if (!snap.exists()) {
          setError('Group not found');
          setGroup(null);
          return;
        }
        const data = snap.data();
        const memberIds = Array.isArray(data?.memberIds) ? data.memberIds : [];
        const memberStatusById = (data?.memberStatusById ?? {}) as Record<string, MemberStatus>;
        setGroup({
          name: data?.name ?? 'Untitled',
          memberIds,
          memberStatusById,
          filters: (data?.filters ?? {}) as SavedSmartGroupFilters,
        });
        if (memberIds.length === 0) {
          setMembersData([]);
          return;
        }
        const users: Array<{
          id: string;
          firstName?: string;
          lastName?: string;
          email?: string;
          phone?: string;
          avatar?: string;
          city?: string;
          state?: string;
          scoreSummary?: any;
          securityLevel?: string;
          skills?: string[];
        }> = [];
        for (const uid of memberIds) {
          const userSnap = await getDoc(doc(db, 'users', uid));
          if (!mounted) return;
          if (userSnap.exists()) {
            const d = userSnap.data() as any;
            const tenantData = d?.tenantIds?.[tenantId] || {};
            const addr = d?.addressInfo || d?.address || {};
            users.push({
              id: uid,
              firstName: d?.firstName,
              lastName: d?.lastName,
              email: d?.email,
              phone: d?.phone,
              avatar: d?.avatar || tenantData?.avatar,
              city: addr?.city ?? d?.city,
              state: addr?.state ?? d?.state,
              scoreSummary: d?.scoreSummary,
              securityLevel: String(tenantData?.securityLevel ?? d?.securityLevel ?? '0'),
              skills: Array.isArray(d?.skills) ? d.skills : [],
            });
          } else {
            users.push({ id: uid });
          }
        }
        setMembersData(users);
      } catch (err: any) {
        if (mounted) setError(err?.message ?? 'Failed to load group');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [tenantId, groupId]);

  const handleStatusChange = async (userId: string, status: MemberStatus) => {
    if (!tenantId || !groupId || !group) return;
    const next = { ...group.memberStatusById, [userId]: status };
    setGroup({ ...group, memberStatusById: next });
    try {
      const ref = doc(db, 'tenants', tenantId, 'savedSmartGroups', groupId);
      await updateDoc(ref, { memberStatusById: next, updatedAt: serverTimestamp() });
    } catch (err: any) {
      setUpdateError(err?.message ?? 'Failed to update status');
    }
  };

  const handleUpdateResults = async () => {
    if (!tenantId || !groupId || !group) return;
    setUpdating(true);
    setUpdateError(null);
    try {
      let customMetros: CustomMetrosMap = {};
      try {
        const settingsSnap = await getDoc(doc(db, 'tenants', tenantId, 'settings', 'smartGroups'));
        const settings = settingsSnap.data();
        customMetros = (settings?.customMetros ?? {}) as CustomMetrosMap;
      } catch (_) {}
      const newMemberIds = await runSavedSmartGroupSearch(tenantId, group.filters, customMetros);
      const existing = group.memberStatusById;
      const memberStatusById: Record<string, MemberStatus> = {};
      newMemberIds.forEach((id) => {
        memberStatusById[id] = (existing[id] as MemberStatus) ?? 'member';
      });
      const ref = doc(db, 'tenants', tenantId, 'savedSmartGroups', groupId);
      await updateDoc(ref, {
        memberIds: newMemberIds,
        memberStatusById,
        updatedAt: serverTimestamp(),
      });
      setGroup((g) => (g ? { ...g, memberIds: newMemberIds, memberStatusById } : null));
      const users: Array<{ id: string; firstName?: string; lastName?: string; email?: string; phone?: string; avatar?: string; city?: string; state?: string; scoreSummary?: any; securityLevel?: string; skills?: string[] }> = [];
      for (const uid of newMemberIds) {
        const userSnap = await getDoc(doc(db, 'users', uid));
        if (userSnap.exists()) {
          const d = userSnap.data() as any;
          const tenantData = d?.tenantIds?.[tenantId] || {};
          const addr = d?.addressInfo || d?.address || {};
          users.push({
            id: uid,
            firstName: d?.firstName,
            lastName: d?.lastName,
            email: d?.email,
            phone: d?.phone,
            avatar: d?.avatar || tenantData?.avatar,
            city: addr?.city ?? d?.city,
            state: addr?.state ?? d?.state,
            scoreSummary: d?.scoreSummary,
            securityLevel: String(tenantData?.securityLevel ?? d?.securityLevel ?? '0'),
            skills: Array.isArray(d?.skills) ? d.skills : [],
          });
        } else {
          users.push({ id: uid });
        }
      }
      setMembersData(users);
    } catch (err: any) {
      setUpdateError(err?.message ?? 'Failed to update results');
    } finally {
      setUpdating(false);
    }
  };

  if (loading || !group) {
    return (
      <Box sx={{ pt: 2, px: 2, pb: 2 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        )}
      </Box>
    );
  }

  const getStatus = (id: string): MemberStatus =>
    group.memberStatusById[id] === 'preferred' || group.memberStatusById[id] === 'not_preferred'
      ? group.memberStatusById[id]
      : 'member';

  const getGroupStatusChipProps = (status: MemberStatus) => {
    if (status === 'preferred') return { label: 'Preferred' as const, sx: { bgcolor: '#0057B8', color: '#FFFFFF', fontWeight: 700 } };
    if (status === 'not_preferred') return { label: 'Not Preferred' as const, sx: { bgcolor: '#D14343', color: '#FFFFFF', fontWeight: 700 } };
    return { label: 'Member' as const, sx: { fontWeight: 700 } };
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return 'N/A';
    try {
      const date = timestamp?.toDate ? timestamp.toDate() : timestamp instanceof Date ? timestamp : new Date(timestamp);
      return isNaN(date.getTime()) ? 'N/A' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return 'N/A';
    }
  };

  const getWorkStatusDisplay = (m: (typeof membersData)[0]) => {
    const sl = String(m.securityLevel ?? '0');
    switch (sl) {
      case '4': return { label: 'Hired', color: 'success' as const };
      case '3': return { label: 'Candidate', color: 'primary' as const };
      case '2': return { label: 'Applicant', color: 'info' as const };
      case '1': return { label: 'Dismissed', color: 'default' as const };
      case '0': return { label: 'Suspended', color: 'error' as const };
      default: return { label: sl || '—', color: 'default' as const };
    }
  };

  const renderAiScore = (m: (typeof membersData)[0]) => {
    const score = m.scoreSummary?.aiScore;
    if (score === undefined || score === null || Number.isNaN(score)) {
      return <Typography variant="body2" color="text.secondary">N/A</Typography>;
    }
    const color: 'default' | 'success' | 'warning' | 'error' = score >= 80 ? 'success' : score >= 60 ? 'warning' : 'default';
    return (
      <Chip
        icon={<InsightsIcon sx={{ fontSize: 16 }} />}
        label={`${Math.round(score)}`}
        color={color}
        size="small"
        variant={color === 'default' ? 'outlined' : 'filled'}
        sx={{ minWidth: 96, justifyContent: 'flex-start' }}
      />
    );
  };

  return (
    <Box sx={{ pt: 2, px: 2, pb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/users/my-smart-groups')}
          sx={{ textTransform: 'none' }}
        >
          Back
        </Button>
        <Typography variant="h6">{group.name}</Typography>
        <Button
          variant="contained"
          startIcon={<RefreshIcon />}
          onClick={handleUpdateResults}
          disabled={updating}
          sx={{ textTransform: 'none', ml: 'auto' }}
        >
          {updating ? 'Updating…' : 'Update results'}
        </Button>
      </Box>
      {updateError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setUpdateError(null)}>
          {updateError}
        </Alert>
      )}
      <Paper variant="outlined" elevation={0} sx={{ border: '1px solid #EAEEF4', borderRadius: 2, overflow: 'hidden' }}>
        <TableContainer sx={{ overflowX: 'auto', '&::-webkit-scrollbar': { width: 8, height: 8 } }}>
          <Table size="small" stickyHeader sx={{ width: '100%' }}>
            <TableHead sx={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: 'background.paper' }}>
              <TableRow sx={{ backgroundColor: 'background.paper' }}>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>Person</TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>Contact</TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>Work Status</TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>Score</TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>Interview</TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>Group Status</TableCell>
                <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem' }}>Skills</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {membersData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                    No members. Click &quot;Update results&quot; to re-run the saved search.
                  </TableCell>
                </TableRow>
              ) : (
                membersData.map((m, idx) => {
                  const status = getStatus(m.id);
                  const chipProps = getGroupStatusChipProps(status);
                  const ws = getWorkStatusDisplay(m);
                  const skills = m.skills ?? [];
                  return (
                    <TableRow
                      key={m.id}
                      hover
                      sx={{
                        cursor: 'pointer',
                        backgroundColor: idx % 2 === 0 ? 'background.paper' : 'action.hover',
                        '&:hover': { backgroundColor: 'action.selected' },
                      }}
                      onClick={() => navigate(`/users/${m.id}`)}
                    >
                      <TableCell sx={{ minWidth: 200 }} onClick={() => navigate(`/users/${m.id}`)}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <Avatar src={m.avatar} sx={{ width: TABLE_AVATAR_SIZE, height: TABLE_AVATAR_SIZE }}>
                            {String(m.firstName || '').charAt(0)}
                          </Avatar>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                              {[m.firstName, m.lastName].filter(Boolean).join(' ').trim() || m.id}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>#{String(m.id).slice(-6)}</Typography>
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                          {m.email && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <EmailIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                              <Typography variant="body2" sx={{ fontSize: '0.85rem' }}>{m.email}</Typography>
                            </Box>
                          )}
                          {m.phone && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <PhoneIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                              <Typography variant="body2" sx={{ fontSize: '0.85rem' }}>{formatPhoneNumber(m.phone)}</Typography>
                            </Box>
                          )}
                          {(m.city || m.state) && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <LocationOnIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.85rem' }}>{[m.city, m.state].filter(Boolean).join(', ')}</Typography>
                            </Box>
                          )}
                          {!m.email && !m.phone && !m.city && !m.state && '—'}
                        </Box>
                      </TableCell>
                      <TableCell><Chip size="small" label={ws.label} color={ws.color} /></TableCell>
                      <TableCell>{renderAiScore(m)}</TableCell>
                      <TableCell>
                        {m.scoreSummary?.interviewLastAt != null && typeof m.scoreSummary?.interviewLastScore10 === 'number' ? (
                          <Typography variant="body2">{formatDate(m.scoreSummary.interviewLastAt)} — {formatOneDecimal(m.scoreSummary.interviewLastScore10)}/10</Typography>
                        ) : (
                          <Typography variant="body2" color="text.secondary">—</Typography>
                        )}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Chip
                          size="small"
                          label={chipProps.label}
                          variant={status === 'member' ? 'outlined' : 'filled'}
                          onClick={(e) => { e.stopPropagation(); setStatusMenuAnchor((prev) => ({ ...prev, [m.id]: e.currentTarget })); }}
                          sx={{ cursor: 'pointer', ...(chipProps.sx || {}) }}
                        />
                        <Menu
                          anchorEl={statusMenuAnchor[m.id]}
                          open={Boolean(statusMenuAnchor[m.id])}
                          onClose={() => setStatusMenuAnchor((prev) => ({ ...prev, [m.id]: null }))}
                          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                        >
                          <MenuItem onClick={() => { handleStatusChange(m.id, 'member'); setStatusMenuAnchor((prev) => ({ ...prev, [m.id]: null })); }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <CheckCircleIcon fontSize="small" />
                              Member
                            </Box>
                          </MenuItem>
                          <MenuItem onClick={() => { handleStatusChange(m.id, 'preferred'); setStatusMenuAnchor((prev) => ({ ...prev, [m.id]: null })); }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <CheckCircleIcon fontSize="small" />
                              Preferred
                            </Box>
                          </MenuItem>
                          <MenuItem onClick={() => { handleStatusChange(m.id, 'not_preferred'); setStatusMenuAnchor((prev) => ({ ...prev, [m.id]: null })); }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <BlockIcon fontSize="small" />
                              Not Preferred
                            </Box>
                          </MenuItem>
                        </Menu>
                      </TableCell>
                      <TableCell>
                        {skills.length === 0 ? (
                          <Typography variant="body2" color="text.secondary">—</Typography>
                        ) : (
                          <Tooltip title={skills.length <= 1 ? skills[0] : <Box component="span" sx={{ display: 'block', maxHeight: 320, overflowY: 'auto', py: 0.5 }}>{skills.map((s) => <Typography key={s} component="span" variant="body2" sx={{ display: 'block' }}>{s}</Typography>)}</Box>} placement="top" enterDelay={300}>
                            <Typography variant="body2" noWrap component="span" sx={{ display: 'block' }}>{skills[0]}{skills.length > 1 ? '…' : ''}</Typography>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
};

export default SavedSmartGroupDetailPage;
