/**
 * Shared I-9 supporting documents workspace: list, upload, request, review.
 * Used by Backgrounds (page) and Employment (drawer). Storage / callables unchanged.
 */
import React, { useCallback, useRef, useState } from 'react';
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
  FormControl,
  FormControlLabel,
  FormLabel,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import AddIcon from '@mui/icons-material/Add';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import {
  Timestamp,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';

import { db, functions, storage } from '../../firebase';
import { p } from '../../data/firestorePaths';
import { useAuth } from '../../contexts/AuthContext';
import { formatFirebaseHttpsError } from '../../utils/firebaseHttpsErrors';
import {
  buildI9SupportingStorageObjectPath,
  viewerCanStaffManageI9SupportingDocuments,
} from '../../utils/i9SupportingDocumentsUi';
import {
  I9_SUPPORTING_DOCUMENT_TYPE_OPTIONS,
  labelForI9SupportingDocumentType,
} from '../../constants/i9SupportingDocumentUi';
import {
  I9_APPROVE_CONFIRM_BODY,
  I9_REQUEST_CREATED_STAFF_HINT,
  I9_WORKER_PATH_CHOICE_TITLE,
  I9_WORKER_PATH_HINT_A,
  I9_WORKER_PATH_HINT_BC,
  I9_WORKER_PATH_LIST_A,
  I9_WORKER_PATH_LIST_BC,
  I9_WORKER_UPLOAD_HEADING,
} from '../../constants/i9SupportingDocumentsEmploymentStrings';
import {
  callCreateWorkerI9SupportingDocumentRequest,
  callGetI9SupportingDocumentSignedUrl,
  callReviewWorkerI9SupportingDocument,
} from '../../services/i9SupportingDocumentCallables';
import { useWorkerI9SupportingDocumentsRows, type I9SupportingDocRow } from '../../hooks/useWorkerI9SupportingDocumentsRows';
import type { I9DocumentExtractionBlock } from '../../types/i9SupportingDocumentV1';

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = /^image\/.+|application\/pdf$/i;

function formatTs(value: unknown): string {
  if (value == null) return '—';
  if (value instanceof Timestamp) return value.toDate().toLocaleString();
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as Timestamp).toDate === 'function') {
    try {
      return (value as Timestamp).toDate().toLocaleString();
    } catch {
      return '—';
    }
  }
  return '—';
}

function extractionChip(
  ext: I9DocumentExtractionBlock | undefined,
): { label: string; color: 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info' } {
  const st = String(ext?.status || '');
  switch (st) {
    case 'extraction_complete':
      return { label: 'Reader: extracted', color: 'success' };
    case 'extraction_pending':
      return { label: 'Reader: running', color: 'warning' };
    case 'extraction_failed':
      return { label: 'Reader: failed', color: 'error' };
    case 'extraction_unsupported':
      return { label: 'Reader: n/a', color: 'default' };
    default:
      return { label: 'Reader: —', color: 'default' };
  }
}

function ExtractionReviewAssist({
  ext,
  compact,
}: {
  ext: I9DocumentExtractionBlock | undefined;
  compact?: boolean;
}) {
  if (!ext || !ext.status) return null;
  const ef = ext.extractedFields;
  const lines: string[] = [];
  if (ef?.fullName) lines.push(`Name: ${ef.fullName}`);
  else if (ef?.firstName || ef?.lastName) {
    lines.push(`Name: ${[ef.firstName, ef.lastName].filter(Boolean).join(' ')}`.trim());
  }
  if (ef?.documentNumber) lines.push(`Document #: ${ef.documentNumber}`);
  if (ef?.expirationDate) lines.push(`Expires: ${ef.expirationDate}`);
  if (ef?.dateOfBirth) lines.push(`DOB: ${ef.dateOfBirth}`);
  const warn = [...(ext.extractionWarnings || []), ...(ef?.extractionWarnings || [])].filter(Boolean);

  if (compact) {
    return (
      <Box sx={{ mt: 0.75, maxWidth: 320 }}>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ fontWeight: 600 }}>
          Document reader (assistive)
        </Typography>
        {lines.slice(0, 4).map((line) => (
          <Typography key={line} variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.4 }}>
            {line}
          </Typography>
        ))}
        {warn.length > 0 ? (
          <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 0.5 }}>
            {warn.slice(0, 3).join(' · ')}
          </Typography>
        ) : null}
        {ext.status === 'extraction_failed' && ext.error?.message ? (
          <Typography variant="caption" color="error" display="block" sx={{ mt: 0.5 }}>
            {ext.error.message}
          </Typography>
        ) : null}
      </Box>
    );
  }

  return (
    <Box sx={{ mt: 0.75, maxWidth: 360 }}>
      {lines.map((line) => (
        <Typography key={line} variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.45 }}>
          {line}
        </Typography>
      ))}
      {warn.length > 0 ? (
        <Alert severity="warning" sx={{ mt: 0.75, py: 0 }}>
          {warn.join(' ')}
        </Alert>
      ) : null}
    </Box>
  );
}

function statusChip(status: string): { label: string; color: 'default' | 'primary' | 'success' | 'warning' | 'error' } {
  switch (status) {
    case 'awaiting_upload':
      return { label: 'Upload requested', color: 'warning' };
    case 'pending_review':
      return { label: 'Under review', color: 'primary' };
    case 'approved':
      return { label: 'Approved', color: 'success' };
    case 'rejected':
      return { label: 'Rejected', color: 'error' };
    default:
      return { label: status || '—', color: 'default' };
  }
}

const LIST_A_TYPES = I9_SUPPORTING_DOCUMENT_TYPE_OPTIONS.filter((o) => o.value.startsWith('list_a_'));
const LIST_B_TYPES = I9_SUPPORTING_DOCUMENT_TYPE_OPTIONS.filter((o) => o.value.startsWith('list_b_'));
const LIST_C_TYPES = I9_SUPPORTING_DOCUMENT_TYPE_OPTIONS.filter((o) => o.value.startsWith('list_c_'));

export interface I9SupportingDocumentsWorkspaceProps {
  tenantId: string;
  workerUserId: string;
  variant: 'page' | 'drawer';
  /** When set, workspace does not open its own Firestore subscription. */
  externalRows?: I9SupportingDocRow[];
  externalLoading?: boolean;
  externalError?: string | null;
  requestedForEntityId?: string | null;
  showPageIntro?: boolean;
  /** When true, hide "Request upload" (e.g. Employment drawer — requests come from compact subsection). */
  suppressStaffRequestButton?: boolean;
  onAfterRequestCreated?: (payload: { staffHint: string }) => void;
}

const I9SupportingDocumentsWorkspace: React.FC<I9SupportingDocumentsWorkspaceProps> = ({
  tenantId,
  workerUserId,
  variant,
  externalRows,
  externalLoading,
  externalError,
  requestedForEntityId,
  showPageIntro = true,
  suppressStaffRequestButton = false,
  onAfterRequestCreated,
}) => {
  const useExternal = externalRows !== undefined;
  const internal = useWorkerI9SupportingDocumentsRows(tenantId, workerUserId, !useExternal);
  const rows = useExternal ? externalRows! : internal.rows;
  const loading = useExternal ? Boolean(externalLoading) : internal.loading;
  const listError = useExternal ? externalError ?? null : internal.error;

  const { user, isHRX, claimsRoles } = useAuth();
  const viewerUid = user?.uid;

  const staffMode = React.useMemo(
    () =>
      viewerCanStaffManageI9SupportingDocuments(tenantId, workerUserId, viewerUid, isHRX, claimsRoles),
    [tenantId, workerUserId, viewerUid, isHRX, claimsRoles],
  );
  const workerSelf = viewerUid === workerUserId;

  const [actionError, setActionError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createType, setCreateType] = useState(I9_SUPPORTING_DOCUMENT_TYPE_OPTIONS[0]?.value ?? 'other_supporting');
  const [createBusy, setCreateBusy] = useState(false);
  const [createSuccessMessage, setCreateSuccessMessage] = useState<string | null>(null);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectDocId, setRejectDocId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectBusy, setRejectBusy] = useState(false);

  const [approveConfirmDocId, setApproveConfirmDocId] = useState<string | null>(null);
  const [approveBusyId, setApproveBusyId] = useState<string | null>(null);
  const [previewBusyId, setPreviewBusyId] = useState<string | null>(null);
  const [uploadBusyId, setUploadBusyId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTargetId, setUploadTargetId] = useState<string | null>(null);

  const [workerPathChoice, setWorkerPathChoice] = useState<'a' | 'bc' | ''>('');

  const openPreview = useCallback(
    async (documentId: string) => {
      setActionError(null);
      setPreviewBusyId(documentId);
      try {
        const res = await callGetI9SupportingDocumentSignedUrl(functions, { tenantId, documentId });
        const data = res.data as { url?: string };
        if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer');
        else setActionError('This link expires quickly — click Open again.');
      } catch {
        setActionError('This link expires quickly — click Open again.');
      } finally {
        setPreviewBusyId(null);
      }
    },
    [tenantId],
  );

  const submitCreate = async () => {
    if (!createType.trim()) return;
    setCreateBusy(true);
    setActionError(null);
    try {
      await callCreateWorkerI9SupportingDocumentRequest(functions, {
        tenantId,
        userId: workerUserId,
        documentType: createType.trim(),
        ...(requestedForEntityId ? { requestedForEntityId } : {}),
      });
      setCreateOpen(false);
      const hint = I9_REQUEST_CREATED_STAFF_HINT;
      setCreateSuccessMessage(hint);
      onAfterRequestCreated?.({ staffHint: hint });
    } catch (e) {
      setActionError(formatFirebaseHttpsError(e));
    } finally {
      setCreateBusy(false);
    }
  };

  const submitApprove = async (documentId: string) => {
    setApproveBusyId(documentId);
    setActionError(null);
    try {
      await callReviewWorkerI9SupportingDocument(functions, {
        tenantId,
        documentId,
        decision: 'approved',
      });
      setApproveConfirmDocId(null);
    } catch (e) {
      setActionError(formatFirebaseHttpsError(e));
    } finally {
      setApproveBusyId(null);
    }
  };

  const openReject = (documentId: string) => {
    setRejectDocId(documentId);
    setRejectReason('');
    setRejectOpen(true);
  };

  const submitReject = async () => {
    if (!rejectDocId || !rejectReason.trim()) return;
    setRejectBusy(true);
    setActionError(null);
    try {
      await callReviewWorkerI9SupportingDocument(functions, {
        tenantId,
        documentId: rejectDocId,
        decision: 'rejected',
        rejectionReason: rejectReason.trim(),
      });
      setRejectOpen(false);
      setRejectDocId(null);
    } catch (e) {
      setActionError(formatFirebaseHttpsError(e));
    } finally {
      setRejectBusy(false);
    }
  };

  const triggerFilePick = (documentId: string) => {
    setUploadTargetId(documentId);
    setActionError(null);
    fileInputRef.current?.click();
  };

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const documentId = uploadTargetId;
    setUploadTargetId(null);
    if (!file || !documentId || !tenantId || !workerUserId) return;

    if (file.size > MAX_BYTES) {
      setActionError('File must be 15 MB or smaller.');
      return;
    }
    if (!ALLOWED_TYPES.test(file.type || '')) {
      setActionError('Only images and PDF files are allowed.');
      return;
    }

    const row = rows.find((r) => r.id === documentId);
    const status = String(row?.data.status || '');
    if (!(workerSelf && (status === 'awaiting_upload' || status === 'rejected' || status === 'pending_review'))) {
      if (!workerSelf) {
        setActionError('Only the worker can upload files for this document.');
        return;
      }
      setActionError('Upload is not available for this status.');
      return;
    }

    setUploadBusyId(documentId);
    setActionError(null);
    try {
      const storagePath = buildI9SupportingStorageObjectPath(tenantId, workerUserId, documentId, file.name);
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, file, { contentType: file.type || 'application/octet-stream' });

      const docRef = doc(db, p.workerI9SupportingDocument(tenantId, documentId));
      const basePatch: Record<string, unknown> = {
        storagePath,
        uploadedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: 'pending_review',
        uploadedFileName: file.name,
        uploadedContentType: file.type || null,
      };
      if (status === 'rejected') {
        await updateDoc(docRef, {
          ...basePatch,
          rejectionReason: null,
          reviewedAt: null,
          reviewedBy: null,
        });
      } else {
        await updateDoc(docRef, basePatch);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadBusyId(null);
    }
  };

  const sortedRows = rows;

  return (
    <Box sx={{ pt: variant === 'drawer' ? 0 : 0 }}>
      <input
        ref={fileInputRef}
        type="file"
        hidden
        accept="image/*,application/pdf"
        onChange={onFileSelected}
      />

      {variant === 'page' && staffMode && !suppressStaffRequestButton && (
        <Stack direction="row" alignItems="center" justifyContent="flex-end" sx={{ mb: 1 }}>
          <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
            Request upload
          </Button>
        </Stack>
      )}

      {variant === 'page' && showPageIntro && (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, lineHeight: 1.45 }}>
            Each row uses a stable document id (part of the Storage path). Replacing a file updates the upload timestamp.
            {workerSelf ? (
              <>
                {' '}
                After a rejection, uploading again clears the previous rejection message and sends the document back for
                review.
              </>
            ) : null}
          </Typography>
        </>
      )}

      {workerSelf && (
        <Box sx={{ mb: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
            {I9_WORKER_UPLOAD_HEADING}
          </Typography>
          <FormControl component="fieldset" variant="standard" fullWidth>
            <FormLabel component="legend" sx={{ typography: 'body2', fontWeight: 600, mb: 0.5 }}>
              {I9_WORKER_PATH_CHOICE_TITLE}
            </FormLabel>
            <RadioGroup
              value={workerPathChoice}
              onChange={(_, v) => setWorkerPathChoice(v as 'a' | 'bc')}
            >
              <FormControlLabel value="a" control={<Radio size="small" />} label={I9_WORKER_PATH_LIST_A} />
              <FormControlLabel value="bc" control={<Radio size="small" />} label={I9_WORKER_PATH_LIST_BC} />
            </RadioGroup>
          </FormControl>
          {workerPathChoice === 'a' ? (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1, lineHeight: 1.45 }}>
              {I9_WORKER_PATH_HINT_A}
            </Typography>
          ) : null}
          {workerPathChoice === 'bc' ? (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1, lineHeight: 1.45 }}>
              {I9_WORKER_PATH_HINT_BC}
            </Typography>
          ) : null}
        </Box>
      )}

      {createSuccessMessage && (
        <Alert severity="success" sx={{ mb: 1 }} onClose={() => setCreateSuccessMessage(null)}>
          {createSuccessMessage}
        </Alert>
      )}

      {listError && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => {}}>
          {listError}
        </Alert>
      )}
      {actionError && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={28} />
        </Box>
      ) : sortedRows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No supporting documents on file{staffMode ? '. Use Request upload to add one.' : '.'}
        </Typography>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Document type</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Last uploaded</TableCell>
                <TableCell>File</TableCell>
                {staffMode && <TableCell align="right">Staff actions</TableCell>}
                {workerSelf && <TableCell align="right">Your actions</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedRows.map(({ id, data }) => {
                const status = String(data.status || '');
                const sc = statusChip(status);
                const path = String(data.storagePath || '').trim();
                const canPreview = Boolean(path);
                const canStaffReview = staffMode && status === 'pending_review';
                const showUpload =
                  workerSelf &&
                  (status === 'awaiting_upload' || status === 'rejected' || status === 'pending_review');
                const ext = data.documentExtraction as I9DocumentExtractionBlock | undefined;
                const ec = extractionChip(ext);

                return (
                  <TableRow key={id}>
                    <TableCell>
                      <Typography variant="body2">{labelForI9SupportingDocumentType(String(data.documentType || ''))}</Typography>
                      <Typography variant="caption" color="text.secondary" display="block">
                        ID: {id}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={sc.label} color={sc.color} variant={sc.color === 'default' ? 'outlined' : 'filled'} />
                      {staffMode && path ? (
                        <Box sx={{ mt: 0.5 }}>
                          <Chip size="small" label={ec.label} color={ec.color} variant="outlined" sx={{ mr: 0.5 }} />
                          <ExtractionReviewAssist ext={ext} compact />
                        </Box>
                      ) : null}
                      {status === 'pending_review' ? (
                        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5, maxWidth: 280 }}>
                          The worker can replace this file while you review. Click Open again to see the latest version.
                        </Typography>
                      ) : null}
                      {status === 'rejected' && data.rejectionReason ? (
                        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                          {String(data.rejectionReason)}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell>{formatTs(data.uploadedAt)}</TableCell>
                    <TableCell>
                      {data.uploadedFileName ? String(data.uploadedFileName) : '—'}
                      {data.uploadedContentType ? (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {String(data.uploadedContentType)}
                        </Typography>
                      ) : null}
                    </TableCell>
                    {staffMode && (
                      <TableCell align="right">
                        <Stack direction="row" spacing={0.5} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
                          <Button
                            size="small"
                            disabled={!canPreview || previewBusyId === id}
                            startIcon={previewBusyId === id ? <CircularProgress size={14} /> : <OpenInNewIcon />}
                            onClick={() => void openPreview(id)}
                          >
                            Open
                          </Button>
                          <Button
                            size="small"
                            color="success"
                            variant="outlined"
                            disabled={!canStaffReview || approveBusyId === id}
                            onClick={() => setApproveConfirmDocId(id)}
                          >
                            Approve
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            variant="outlined"
                            disabled={!canStaffReview}
                            onClick={() => openReject(id)}
                          >
                            Reject
                          </Button>
                        </Stack>
                      </TableCell>
                    )}
                    {workerSelf && (
                      <TableCell align="right">
                        <Stack direction="row" spacing={0.5} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
                          {canPreview && (
                            <Button
                              size="small"
                              disabled={previewBusyId === id}
                              startIcon={previewBusyId === id ? <CircularProgress size={14} /> : <OpenInNewIcon />}
                              onClick={() => void openPreview(id)}
                            >
                              Open
                            </Button>
                          )}
                          {showUpload ? (
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={uploadBusyId === id ? <CircularProgress size={14} /> : <UploadFileIcon />}
                              disabled={uploadBusyId === id}
                              onClick={() => triggerFilePick(id)}
                            >
                              {status === 'awaiting_upload' ? 'Upload' : 'Replace file'}
                            </Button>
                          ) : null}
                          {!canPreview && !showUpload ? '—' : null}
                        </Stack>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={createOpen} onClose={() => !createBusy && setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Request supporting document upload</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Creates a row for this worker. They upload from Employment (or Backgrounds) when viewing their profile.
          </Typography>
          <FormControl fullWidth size="small" sx={{ mt: 1 }}>
            <InputLabel id="i9-doc-type-label-ws">Document type</InputLabel>
            <Select
              labelId="i9-doc-type-label-ws"
              label="Document type"
              value={createType}
              onChange={(ev) => setCreateType(ev.target.value)}
            >
              {I9_SUPPORTING_DOCUMENT_TYPE_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} disabled={createBusy}>
            Cancel
          </Button>
          <Button variant="contained" onClick={() => void submitCreate()} disabled={createBusy}>
            {createBusy ? <CircularProgress size={20} /> : 'Create request'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(approveConfirmDocId)}
        onClose={() =>
          !(approveConfirmDocId && approveBusyId === approveConfirmDocId) && setApproveConfirmDocId(null)
        }
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Approve document?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {I9_APPROVE_CONFIRM_BODY}
          </Typography>
          {approveConfirmDocId ? (
            <ExtractionReviewAssist
              compact
              ext={sortedRows.find((r) => r.id === approveConfirmDocId)?.data?.documentExtraction as I9DocumentExtractionBlock | undefined}
            />
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setApproveConfirmDocId(null)}
            disabled={Boolean(approveConfirmDocId && approveBusyId === approveConfirmDocId)}
          >
            Cancel
          </Button>
          <Button
            color="success"
            variant="contained"
            disabled={!approveConfirmDocId || approveBusyId === approveConfirmDocId}
            onClick={() => approveConfirmDocId && void submitApprove(approveConfirmDocId)}
          >
            {approveConfirmDocId && approveBusyId === approveConfirmDocId ? (
              <CircularProgress size={20} />
            ) : (
              'Approve'
            )}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={rejectOpen} onClose={() => !rejectBusy && setRejectOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Reject document</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Workers see this message — be specific.
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            Examples: “Image is blurry — please upload a clearer photo.” · “Document expired 3/1/2025 — upload a current
            List B ID.” · “We need the full passport page, including the photo.”
          </Typography>
          <TextField
            autoFocus
            margin="dense"
            label="Reason (shown to worker)"
            fullWidth
            multiline
            minRows={3}
            value={rejectReason}
            onChange={(ev) => setRejectReason(ev.target.value)}
            placeholder='e.g. "Photo too dark — retake with better lighting"'
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectOpen(false)} disabled={rejectBusy}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={() => void submitReject()} disabled={rejectBusy || !rejectReason.trim()}>
            {rejectBusy ? <CircularProgress size={20} /> : 'Reject'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export { LIST_A_TYPES, LIST_B_TYPES, LIST_C_TYPES };
export default I9SupportingDocumentsWorkspace;
