import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Rating,
  Select,
  Snackbar,
  Alert,
  Stack,
  TextField,
  Typography,
  IconButton,
  Tooltip,
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { addDoc, collection, doc, getDocs, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../../firebase';
import { useAuth } from '../../../contexts/AuthContext';

type Props = { uid: string };

type ReviewVisibility = 'internal' | 'shared_with_client' | 'worker_visible';
type ReviewStatus = 'active' | 'flagged' | 'removed';

type UserReview = {
  id: string;
  createdAt?: any;
  createdAtMs?: number;
  createdByUid?: string;
  createdByName?: string;
  reviewerType?: 'internal' | 'client';
  stars5: number;
  title?: string;
  note?: string;
  visibility: ReviewVisibility;
  status: ReviewStatus;
};

const toDateTimeLabel = (ts: any): string => {
  try {
    const d: Date | null =
      ts?.toDate?.() ||
      (ts instanceof Date ? ts : null) ||
      (typeof ts === 'number' ? new Date(ts) : null) ||
      (typeof ts === 'string' ? new Date(ts) : null) ||
      // Callable JSON can turn Firestore Timestamps into {seconds/nanoseconds} or {_seconds/_nanoseconds}
      (ts && typeof ts === 'object' && (typeof ts.seconds === 'number' || typeof ts._seconds === 'number')
        ? new Date(((ts.seconds ?? ts._seconds) as number) * 1000)
        : null);
    if (!d) return '';
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
};

export default function ReviewsTab({ uid }: Props) {
  const { currentUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [reviews, setReviews] = useState<UserReview[]>([]);
  const [openCreate, setOpenCreate] = useState(false);
  const [deleteReviewId, setDeleteReviewId] = useState<string | null>(null);
  const [realtimeActive, setRealtimeActive] = useState(false);
  const [toast, setToast] = useState<{ open: boolean; severity: 'success' | 'error'; message: string }>({
    open: false,
    severity: 'success',
    message: '',
  });

  const [stars5, setStars5] = useState<number | null>(5);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [visibility, setVisibility] = useState<ReviewVisibility>('internal');

  const average = useMemo(() => {
    const active = reviews.filter((r) => r.status === 'active' && typeof r.stars5 === 'number');
    if (!active.length) return undefined;
    const avg = active.reduce((sum, r) => sum + r.stars5, 0) / active.length;
    return Math.round(avg * 10) / 10;
  }, [reviews]);

  const load = async () => {
    setLoading(true);
    try {
      // Prefer callable (bypasses Firestore rules that may not allow /users/{uid}/reviews)
      let data: any[] = [];
      try {
        const fn = httpsCallable(functions, 'getUserReviews');
        const res: any = await fn({ uid });
        data = Array.isArray(res?.data?.reviews) ? res.data.reviews : [];
      } catch {
        const ref = collection(db, 'users', uid, 'reviews');
        const snap = await getDocs(query(ref, orderBy('createdAt', 'desc')));
        data = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as any[];
      }
      setReviews(
        data
          .map((r) => ({
            id: r.id,
            createdAt: r.createdAt,
            createdAtMs: typeof r.createdAtMs === 'number' ? r.createdAtMs : undefined,
            createdByUid: r.createdByUid,
            createdByName: r.createdByName,
            reviewerType: r.reviewerType,
            stars5: typeof r.stars5 === 'number' ? r.stars5 : Number(r.stars5) || 0,
            title: r.title,
            note: r.note,
            visibility: r.visibility || 'internal',
            status: r.status || 'active',
          }))
          // Soft-deleted reviews should not be shown
          .filter((r) => r.status !== 'removed')
      );
    } catch (e) {
      console.error('ReviewsTab: failed to load', e);
      setReviews([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let unsub: undefined | (() => void);
    setRealtimeActive(false);

    // Try realtime listener first (best UX). If it fails (permissions), fall back to one-shot load().
    try {
      const ref = collection(db, 'users', uid, 'reviews');
      const q = query(ref, orderBy('createdAt', 'desc'));
      unsub = onSnapshot(
        q,
        (snap) => {
          setRealtimeActive(true);
          const data = snap.docs.map((d) => {
            const r = d.data() as any;
            const createdAtMs = r?.createdAt?.toDate ? r.createdAt.toDate().getTime() : (typeof r.createdAtMs === 'number' ? r.createdAtMs : undefined);
            return {
              id: d.id,
              createdAt: r.createdAt,
              createdAtMs,
              createdByUid: r.createdByUid,
              createdByName: r.createdByName,
              reviewerType: r.reviewerType,
              stars5: typeof r.stars5 === 'number' ? r.stars5 : Number(r.stars5) || 0,
              title: r.title,
              note: r.note,
              visibility: r.visibility || 'internal',
              status: r.status || 'active',
            } as UserReview;
          });
          // Soft-deleted reviews should not be shown
          setReviews(data.filter((r) => r.status !== 'removed'));
        },
        (_err) => {
          setRealtimeActive(false);
          // Fallback if realtime is blocked by rules
          load();
        }
      );
    } catch {
      setRealtimeActive(false);
      load();
    }

    return () => {
      if (unsub) unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // Deep-link: open create modal with prefilled stars (from header quick rating)
  useEffect(() => {
    const shouldOpen = searchParams.get('openReview') === '1';
    if (!shouldOpen) return;
    const starsParam = Number(searchParams.get('stars'));
    if (Number.isFinite(starsParam) && starsParam >= 1 && starsParam <= 5) {
      setStars5(starsParam);
    }
    setOpenCreate(true);
    const next = new URLSearchParams(searchParams);
    next.delete('openReview');
    next.delete('stars');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const recomputeAndWriteSummary = async () => {
    try {
      const ref = collection(db, 'users', uid, 'reviews');
      const snap = await getDocs(ref);
      const active = snap.docs
        .map((d) => d.data() as any)
        .filter((r) => r && r.status !== 'removed')
        .map((r) => (typeof r.stars5 === 'number' ? r.stars5 : Number(r.stars5)))
        .filter((n) => Number.isFinite(n));

      const reviewCount = active.length;
      const reviewAvg = reviewCount ? Math.round(((active.reduce((a, b) => a + b, 0) / reviewCount) * 10)) / 10 : null;
      // NOTE: use dot-path updates to avoid overwriting other scoreSummary fields
      await updateDoc(doc(db, 'users', uid), {
        'scoreSummary.reviewAvg': reviewAvg,
        'scoreSummary.reviewCount': reviewCount,
        'scoreSummary.reviewLastAt': serverTimestamp(),
      } as any);
    } catch {
      // non-fatal
    }
  };

  const handleCreate = async () => {
    if (!stars5 || stars5 < 1) {
      setToast({ open: true, severity: 'error', message: 'Star rating is required' });
      return;
    }
    setLoading(true);
    try {
      const createdByName = currentUser?.displayName || currentUser?.email || 'Internal';
      // Prefer callable (bypasses Firestore rules); fallback to direct write if rules allow.
      let usedCallable = false;
      try {
        const fn = httpsCallable(functions, 'createUserReview');
        await fn({
          uid,
          stars5,
          title: title.trim() || '',
          note: note.trim() || '',
          visibility,
        });
        usedCallable = true;
      } catch {
        const ref = collection(db, 'users', uid, 'reviews');
        await addDoc(ref, {
          createdAt: serverTimestamp(),
          createdByUid: currentUser?.uid || '',
          createdByName,
          reviewerType: 'internal',
          stars5,
          title: title.trim() || null,
          note: note.trim() || null,
          privateNote: null,
          visibility,
          status: 'active',
          updatedAt: serverTimestamp(),
          updatedByUid: currentUser?.uid || '',
        });
      }
      setOpenCreate(false);
      setStars5(5);
      setTitle('');
      setNote('');
      setVisibility('internal');
      // If realtime is active, the new doc will appear immediately via onSnapshot.
      if (!realtimeActive) await load();
      // If callable was used, server recomputed summary; if fallback write was used, recompute client-side.
      if (!usedCallable) await recomputeAndWriteSummary();
      setToast({ open: true, severity: 'success', message: 'Review added' });
    } catch (e: any) {
      console.error('ReviewsTab: create failed', e);
      const code = e?.code ? String(e.code) : '';
      const msg = e?.message ? String(e.message) : '';
      setToast({
        open: true,
        severity: 'error',
        message: `Failed to add review${code ? ` (${code})` : ''}${msg ? `: ${msg}` : ''}`,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (reviewId: string) => {
    if (!reviewId) return;
    setLoading(true);
    try {
      // Optimistic remove from UI immediately
      setReviews((prev) => prev.filter((r) => r.id !== reviewId));

      // Prefer callable (bypasses rules)
      let usedCallable = false;
      try {
        const fn = httpsCallable(functions, 'deleteUserReview');
        await fn({ uid, reviewId });
        usedCallable = true;
      } catch {
        // Fallback: soft-delete via Firestore (if rules allow)
        await updateDoc(doc(db, 'users', uid, 'reviews', reviewId), {
          status: 'removed',
          updatedAt: serverTimestamp(),
          updatedByUid: currentUser?.uid || '',
        } as any);
      }
      setDeleteReviewId(null);
      if (!realtimeActive) await load();
      if (!usedCallable) await recomputeAndWriteSummary();
      setToast({ open: true, severity: 'success', message: 'Review deleted' });
    } catch (e: any) {
      console.error('ReviewsTab: delete failed', e);
      const code = e?.code ? String(e.code) : '';
      const msg = e?.message ? String(e.message) : '';
      setToast({
        open: true,
        severity: 'error',
        message: `Failed to delete review${code ? ` (${code})` : ''}${msg ? `: ${msg}` : ''}`,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Card variant="outlined">
        <CardHeader
          title="Reviews"
          titleTypographyProps={{ variant: 'h6', fontWeight: 700 }}
          action={
            <Button startIcon={<AddIcon />} variant="contained" onClick={() => setOpenCreate(true)} disabled={loading}>
              Add Review
            </Button>
          }
        />
        <CardContent>
          {average !== undefined && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" color="text.secondary">
                Average
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <Rating value={average} precision={0.1} readOnly />
                <Typography variant="body2" fontWeight={700}>
                  {average}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  ({reviews.filter((r) => r.status === 'active').length})
                </Typography>
              </Stack>
            </Box>
          )}

          {reviews.length === 0 && (
            <Typography color="text.secondary" sx={{ fontStyle: 'italic' }}>
              No reviews yet.
            </Typography>
          )}

          <Stack spacing={2}>
            {reviews.map((r) => (
              <Box key={r.id}>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
                  <Box sx={{ minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Rating value={r.stars5} readOnly />
                      <Typography variant="body2" fontWeight={700}>
                        {r.title || ''}
                      </Typography>
                    </Stack>
                    {r.note && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>
                        {r.note}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                      {r.createdByName || 'Internal'} • {toDateTimeLabel(r.createdAtMs ?? r.createdAt)}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
                    <Typography variant="caption" color="text.secondary">
                      {r.visibility.replace(/_/g, ' ')}
                    </Typography>
                    <Tooltip title="Delete review" arrow>
                      <IconButton size="small" onClick={() => setDeleteReviewId(r.id)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Stack>
                <Divider sx={{ mt: 2 }} />
              </Box>
            ))}
          </Stack>
        </CardContent>
      </Card>

      <Dialog open={openCreate} onClose={() => setOpenCreate(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Review</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <Box>
              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 0.5 }}>
                Stars
              </Typography>
              <Rating value={stars5} onChange={(_, v) => setStars5(v)} />
            </Box>
            <TextField label="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} fullWidth />
            <TextField
              label="Note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              fullWidth
              multiline
              rows={3}
              placeholder="1–3 sentences recommended"
            />
            <FormControl fullWidth>
              <InputLabel>Visibility</InputLabel>
              <Select value={visibility} label="Visibility" onChange={(e) => setVisibility(e.target.value as ReviewVisibility)}>
                <MenuItem value="internal">Internal</MenuItem>
                <MenuItem value="shared_with_client">Shared with client</MenuItem>
                <MenuItem value="worker_visible">Worker visible</MenuItem>
              </Select>
            </FormControl>
            <Alert severity="info">
              MVP: internal reviews only. This will later support client reviews + moderation.
            </Alert>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenCreate(false)} disabled={loading}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleCreate} disabled={loading}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(deleteReviewId)} onClose={() => setDeleteReviewId(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete review?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            This will remove the review from scoring and lists.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteReviewId(null)} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => deleteReviewId && handleDelete(deleteReviewId)}
            disabled={loading || !deleteReviewId}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={toast.open} autoHideDuration={4000} onClose={() => setToast((p) => ({ ...p, open: false }))}>
        <Alert severity={toast.severity} onClose={() => setToast((p) => ({ ...p, open: false }))}>
          {toast.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

