import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

export interface ReviewRequestRow {
  id: string;
  userId: string;
  kind: 'review' | 'accommodation';
  details: string;
  postingTitle: string | null;
  createdAt: Date | null;
}

/**
 * Open "Ask a recruiter" requests (Illinois AI-in-hiring, Greg 2026-09-10) for
 * a job order, keyed by worker. Workers write them from the posting, apply
 * wizard, prescreen and My Applications (web + app); the orchestrator sweep
 * alerts the assigned recruiters and fills in jobOrderId when a request lacks it.
 */
export function useOpenReviewRequestsByUserId(
  tenantId: string | null | undefined,
  jobOrderId: string | null | undefined,
): Map<string, ReviewRequestRow[]> {
  const [byUser, setByUser] = useState<Map<string, ReviewRequestRow[]>>(new Map());
  useEffect(() => {
    if (!tenantId || !jobOrderId) {
      setByUser(new Map());
      return undefined;
    }
    const q = query(
      collection(db, 'tenants', tenantId, 'recruiter_review_requests'),
      where('jobOrderId', '==', jobOrderId),
      where('status', '==', 'open'),
    );
    return onSnapshot(
      q,
      (snap) => {
        const next = new Map<string, ReviewRequestRow[]>();
        snap.forEach((d) => {
          const r = d.data();
          const userId = String(r.userId || '');
          if (!userId) return;
          next.set(userId, [
            ...(next.get(userId) ?? []),
            {
              id: d.id,
              userId,
              kind: r.kind === 'accommodation' ? 'accommodation' : 'review',
              details: typeof r.details === 'string' ? r.details : '',
              postingTitle: typeof r.postingTitle === 'string' ? r.postingTitle : null,
              createdAt: typeof r.createdAt?.toDate === 'function' ? r.createdAt.toDate() : null,
            },
          ]);
        });
        setByUser(next);
      },
      () => setByUser(new Map()),
    );
  }, [tenantId, jobOrderId]);
  return byUser;
}

/** Applicant-row chips for open requests; each opens the request with a Mark resolved action. */
export const ReviewRequestChips: React.FC<{ tenantId: string; requests: ReviewRequestRow[] | undefined }> = ({
  tenantId,
  requests,
}) => {
  const { user } = useAuth();
  const [open, setOpen] = useState<ReviewRequestRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!requests || requests.length === 0) return null;

  const resolve = async () => {
    if (!open) return;
    setSaving(true);
    setError(null);
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'recruiter_review_requests', open.id), {
        status: 'resolved',
        resolvedAt: serverTimestamp(),
        resolvedBy: user?.uid ?? null,
        updatedAt: serverTimestamp(),
      });
      setOpen(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The request could not be marked resolved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {requests.map((req) => (
        <Chip
          key={req.id}
          size="small"
          color="warning"
          variant="outlined"
          sx={{ ml: 0.5, mt: 0.5, cursor: 'pointer' }}
          label={req.kind === 'accommodation' ? 'Accommodation request' : 'Review requested'}
          onClick={(e) => {
            e.stopPropagation();
            setError(null);
            setOpen(req);
          }}
        />
      ))}
      <Dialog
        open={Boolean(open)}
        onClose={() => !saving && setOpen(null)}
        onClick={(e) => e.stopPropagation()}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{open?.kind === 'accommodation' ? 'Accommodation request' : 'Recruiter review requested'}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              {open?.createdAt ? `Sent ${open.createdAt.toLocaleString()}` : 'Sent recently'}
              {open?.postingTitle ? ` · ${open.postingTitle}` : ''}
            </Typography>
            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
              {open?.details || 'No details were added.'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {open?.kind === 'accommodation'
                ? 'Contact the worker about the accommodation, then mark this resolved. Keep medical details out of notes.'
                : 'Review the application personally and contact the worker, then mark this resolved.'}
            </Typography>
            {error ? <Alert severity="error">{error}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(null)} disabled={saving}>
            Close
          </Button>
          <Button variant="contained" onClick={() => void resolve()} disabled={saving}>
            Mark resolved
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
