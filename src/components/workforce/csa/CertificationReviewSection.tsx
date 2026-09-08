/**
 * Section on /readiness/employee-readiness — "Certifications to review".
 *
 * Lists `tenants/{tid}/certification_reviews` rows (server-maintained mirror
 * of worker certification_records the AI scan could not decide on its own —
 * see functions/src/certifications/certificationScanTrigger.ts). Every field
 * Claude read off the card is pre-filled so a decision is one click; the
 * reviewer can correct issuer / expiration before approving. Decisions go
 * through the `setCertificationReviewDecision` callable, which removes the
 * row — the live snapshot drops it from the table.
 *
 * Rows the scan auto-approved or auto-rejected never appear here; those
 * outcomes live on the worker's profile (Licenses & Certs tab).
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useNavigate } from 'react-router-dom';
import { db, functions } from '../../../firebase';
import {
  CERTIFICATION_SCAN_REASON_LABELS,
  type CertificationAiExtractionV1,
  type CertificationScanReasonCode,
  type CertificationScanVerdict,
} from '../../../shared/certifications/certificationAiVerification';

export interface CertificationReviewSectionProps {
  tenantId: string | null;
}

interface QueueRow {
  id: string;
  userId: string;
  certificationRecordId: string;
  workerName: string;
  displayName: string;
  catalogEntryId: string;
  claimed: { issuer: string | null; expirationDate: string | null };
  evidence: { storageUrl: string | null; fileName: string | null; mediaType: string | null };
  ai: {
    verdict: CertificationScanVerdict | null;
    reasonCode: CertificationScanReasonCode | null;
    confidence: 'high' | 'medium' | 'low' | null;
    notes: string;
    extracted: CertificationAiExtractionV1 | null;
    model: string | null;
  };
  submittedAtMs: number;
}

type Decision = 'approve' | 'reject' | 'request_reupload';

const REJECT_REASONS: Array<{ code: CertificationScanReasonCode; label: string }> = [
  { code: 'unreadable', label: 'Photo unreadable' },
  { code: 'not_a_certificate', label: 'Not the certificate itself' },
  { code: 'wrong_credential', label: 'Different credential than claimed' },
  { code: 'name_mismatch', label: 'Name does not match worker' },
  { code: 'expired', label: 'Expired' },
  { code: 'tampering_suspected', label: 'Looks edited' },
  { code: 'other', label: 'Other (see note)' },
];

const HEADER_CELL_SX = { fontSize: 12, fontWeight: 600, textTransform: 'uppercase' as const, color: 'text.secondary', letterSpacing: 0.4 };
const CELL_SX = { fontSize: 13, py: 1, verticalAlign: 'top' as const };

function relativeTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const minutes = Math.floor((Date.now() - ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

function reasonLabel(code: CertificationScanReasonCode | null): string {
  return code ? CERTIFICATION_SCAN_REASON_LABELS[code] ?? code : 'No scan';
}

function reasonChipColor(code: CertificationScanReasonCode | null): 'default' | 'warning' | 'error' | 'info' {
  if (!code) return 'default';
  if (code === 'tampering_suspected' || code === 'name_mismatch' || code === 'expired') return 'error';
  if (code === 'scan_error' || code === 'file_unsupported') return 'info';
  return 'warning';
}

const CertificationReviewSection: React.FC<CertificationReviewSectionProps> = ({ tenantId }) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<{ row: QueueRow; decision: Decision } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    // Single equality, no orderBy → no composite index; sorted client-side.
    const q = query(collection(db, 'tenants', tenantId, 'certification_reviews'), where('status', '==', 'pending'), limit(200));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const next: QueueRow[] = [];
        snap.forEach((d) => {
          const data = d.data() as Record<string, any>;
          next.push({
            id: d.id,
            userId: String(data.userId || ''),
            certificationRecordId: String(data.certificationRecordId || ''),
            workerName: String(data.workerName || 'Worker'),
            displayName: String(data.displayName || data.catalogEntryId || 'Certification'),
            catalogEntryId: String(data.catalogEntryId || ''),
            claimed: { issuer: data.claimed?.issuer ?? null, expirationDate: data.claimed?.expirationDate ?? null },
            evidence: {
              storageUrl: data.evidence?.storageUrl ?? null,
              fileName: data.evidence?.fileName ?? null,
              mediaType: data.evidence?.mediaType ?? null,
            },
            ai: {
              verdict: data.ai?.verdict ?? null,
              reasonCode: data.ai?.reasonCode ?? null,
              confidence: data.ai?.confidence ?? null,
              notes: String(data.ai?.notes || ''),
              extracted: data.ai?.extracted ?? null,
              model: data.ai?.model ?? null,
            },
            submittedAtMs: data.submittedAt?.toMillis?.() ?? 0,
          });
        });
        next.sort((a, b) => b.submittedAtMs - a.submittedAtMs);
        setRows(next);
        setLoading(false);
      },
      (err) => {
        setError(err?.message || 'Could not load the certification queue.');
        setLoading(false);
      },
    );
    return () => unsub();
  }, [tenantId]);

  const count = rows.length;
  const title = useMemo(() => (count ? `Certifications to review (${count})` : 'Certifications to review'), [count]);

  return (
    <Box sx={{ mb: 4 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <FactCheckOutlinedIcon fontSize="small" color="action" />
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Uploads the AI scan could not decide on its own. Clear cards are approved automatically; receipts, wrong documents, and expired cards are sent back without a person. Everything here needs a human call.
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}
      {toast && (
        <Alert severity="success" onClose={() => setToast(null)} sx={{ mb: 1 }}>
          {toast}
        </Alert>
      )}
      {loading && (
        <Box sx={{ py: 2 }}>
          <CircularProgress size={20} />
        </Box>
      )}
      {!loading && rows.length === 0 && !error && (
        <Typography variant="body2" color="text.secondary">
          Nothing waiting. New uploads land here only when the scan is unsure.
        </Typography>
      )}
      {rows.length > 0 && (
        <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={HEADER_CELL_SX}>Worker</TableCell>
                <TableCell sx={HEADER_CELL_SX}>Credential</TableCell>
                <TableCell sx={HEADER_CELL_SX}>Why it&apos;s here</TableCell>
                <TableCell sx={HEADER_CELL_SX}>What the scan read</TableCell>
                <TableCell sx={HEADER_CELL_SX}>Uploaded</TableCell>
                <TableCell sx={HEADER_CELL_SX} align="right">
                  Decision
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => {
                const x = r.ai.extracted;
                const busy = busyId === r.id;
                return (
                  <TableRow key={r.id} hover>
                    <TableCell sx={CELL_SX}>
                      <Stack direction="row" alignItems="center" spacing={0.5}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {r.workerName}
                        </Typography>
                        <Tooltip title="Open profile">
                          <IconButton size="small" onClick={() => navigate(`/users/${r.userId}`)}>
                            <OpenInNewIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                      {r.evidence.storageUrl && (
                        <Button
                          size="small"
                          variant="text"
                          href={r.evidence.storageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          sx={{ px: 0, minWidth: 0, fontSize: 12, textTransform: 'none' }}
                        >
                          View upload{r.evidence.mediaType === 'application/pdf' ? ' (PDF)' : ''}
                        </Button>
                      )}
                    </TableCell>
                    <TableCell sx={CELL_SX}>
                      <Typography variant="body2">{r.displayName}</Typography>
                      {(r.claimed.issuer || r.claimed.expirationDate) && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          Worker typed: {[r.claimed.issuer, r.claimed.expirationDate && `exp ${r.claimed.expirationDate}`].filter(Boolean).join(' · ')}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={CELL_SX}>
                      <Chip size="small" label={reasonLabel(r.ai.reasonCode)} color={reasonChipColor(r.ai.reasonCode)} variant="outlined" />
                      {r.ai.confidence && (
                        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                          Confidence {r.ai.confidence}
                        </Typography>
                      )}
                      {r.ai.notes && (
                        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5, maxWidth: 260 }}>
                          {r.ai.notes}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={CELL_SX}>
                      {x ? (
                        <Box sx={{ fontSize: 12.5, lineHeight: 1.5 }}>
                          <div>
                            <strong>Doc:</strong> {x.documentDescription || '—'}
                          </div>
                          <div>
                            <strong>Holder:</strong> {x.holderName || '—'}
                          </div>
                          <div>
                            <strong>Issuer:</strong> {[x.issuer, x.issuingJurisdiction, x.accreditation].filter(Boolean).join(' · ') || '—'}
                          </div>
                          <div>
                            <strong>Dates:</strong> {x.issueDate ? `issued ${x.issueDate}` : 'no issue date'}
                            {x.expirationDate ? `, expires ${x.expirationDate}` : ', no expiration'}
                          </div>
                          {x.certificateNumber && (
                            <div>
                              <strong>No.:</strong> {x.certificateNumber}
                            </div>
                          )}
                          {x.tamperingSignals.length > 0 && (
                            <div style={{ color: '#b71c1c' }}>
                              <strong>Editing signals:</strong> {x.tamperingSignals.join('; ')}
                            </div>
                          )}
                        </Box>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          No reading — open the upload.
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={CELL_SX}>{relativeTime(r.submittedAtMs)}</TableCell>
                    <TableCell sx={CELL_SX} align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Button size="small" variant="contained" color="success" disabled={busy} onClick={() => setActive({ row: r, decision: 'approve' })}>
                          Approve
                        </Button>
                        <Button size="small" variant="outlined" color="warning" disabled={busy} onClick={() => setActive({ row: r, decision: 'request_reupload' })}>
                          New photo
                        </Button>
                        <Button size="small" variant="outlined" color="error" disabled={busy} onClick={() => setActive({ row: r, decision: 'reject' })}>
                          Reject
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {active && (
        <DecisionDialog
          row={active.row}
          decision={active.decision}
          busy={busyId === active.row.id}
          onClose={() => setActive(null)}
          onSubmit={async (payload) => {
            setBusyId(active.row.id);
            try {
              const call = httpsCallable(functions, 'setCertificationReviewDecision');
              await call({
                userId: active.row.userId,
                certificationRecordId: active.row.certificationRecordId,
                decision: active.decision,
                tenantId,
                ...payload,
              });
              setToast(
                active.decision === 'approve'
                  ? `${active.row.displayName} approved for ${active.row.workerName}.`
                  : active.decision === 'request_reupload'
                    ? `${active.row.workerName} was asked for a new photo.`
                    : `${active.row.displayName} rejected for ${active.row.workerName}.`,
              );
              setActive(null);
            } catch (e) {
              setError((e as { message?: string })?.message || 'Decision failed.');
            } finally {
              setBusyId(null);
            }
          }}
        />
      )}
    </Box>
  );
};

const DecisionDialog: React.FC<{
  row: QueueRow;
  decision: Decision;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: { note?: string; reasonCode?: CertificationScanReasonCode; corrections?: { issuer?: string | null; expirationDate?: string | null } }) => Promise<void>;
}> = ({ row, decision, busy, onClose, onSubmit }) => {
  const x = row.ai.extracted;
  const [issuer, setIssuer] = useState<string>(x?.issuer || row.claimed.issuer || '');
  const [expiration, setExpiration] = useState<string>(x?.expirationDate || row.claimed.expirationDate || '');
  const [reason, setReason] = useState<CertificationScanReasonCode>(
    row.ai.reasonCode && REJECT_REASONS.some((r) => r.code === row.ai.reasonCode) ? row.ai.reasonCode : 'other',
  );
  const [note, setNote] = useState('');
  const approve = decision === 'approve';
  const titles: Record<Decision, string> = {
    approve: `Approve ${row.displayName}`,
    reject: `Reject ${row.displayName}`,
    request_reupload: `Ask ${row.workerName} for a new photo`,
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 17 }}>{titles[decision]}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            {approve
              ? 'Confirm the details below — they become the record. The card wins over what the worker typed.'
              : decision === 'request_reupload'
                ? 'The worker gets an in-app notice and a text asking for a clear photo of the whole certificate.'
                : 'The worker gets an in-app notice. No text is sent.'}
          </Typography>
          {approve && (
            <>
              <TextField label="Issuer" size="small" value={issuer} onChange={(e) => setIssuer(e.target.value)} />
              <TextField
                label="Expiration (YYYY-MM-DD)"
                size="small"
                value={expiration}
                onChange={(e) => setExpiration(e.target.value)}
                placeholder="Leave empty if it does not expire"
              />
            </>
          )}
          {!approve && (
            <TextField select label="Reason" size="small" value={reason} onChange={(e) => setReason(e.target.value as CertificationScanReasonCode)}>
              {REJECT_REASONS.map((r) => (
                <MenuItem key={r.code} value={r.code}>
                  {r.label}
                </MenuItem>
              ))}
            </TextField>
          )}
          <TextField label="Note (internal)" size="small" multiline minRows={2} value={note} onChange={(e) => setNote(e.target.value)} inputProps={{ maxLength: 500 }} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color={approve ? 'success' : decision === 'reject' ? 'error' : 'warning'}
          disabled={busy || (approve && !!expiration && !/^\d{4}-\d{2}-\d{2}$/.test(expiration))}
          onClick={() =>
            onSubmit(
              approve
                ? { note, corrections: { issuer: issuer.trim() || null, expirationDate: expiration.trim() || null } }
                : { note, reasonCode: reason },
            )
          }
        >
          {busy ? 'Saving…' : approve ? 'Approve' : decision === 'reject' ? 'Reject' : 'Send request'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CertificationReviewSection;
