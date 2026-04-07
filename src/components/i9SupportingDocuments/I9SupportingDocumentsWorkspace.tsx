/**
 * Shared I-9 supporting documents workspace: list, upload, request, review.
 * Used by Backgrounds (page) and Employment (drawer). Storage / callables unchanged.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  Divider,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import AddIcon from '@mui/icons-material/Add';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import {
  Timestamp,
  collection,
  doc,
  serverTimestamp,
  setDoc,
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
import { filterI9RowsForEntityEmployment } from '../../utils/workerEmploymentWorkerSurface';
import { useWorkerI9SupportingDocumentsRows, type I9SupportingDocRow } from '../../hooks/useWorkerI9SupportingDocumentsRows';
import type {
  I9DocumentExtractionBlock,
  I9DocumentReviewBlock,
  I9DocumentReviewVerifiedFields,
} from '../../types/i9SupportingDocumentV1';
import type { I9ReviewFieldKey } from '../../utils/i9SupportingDocumentReviewDisplay';
import {
  I9_REVIEW_EDITABLE_FIELD_KEYS,
  allExtractionWarnings,
  approveDialogSummaryLines,
  categoryHintsFromWarnings,
  displayReviewField,
  hasPartialExtractedUsableFields,
  initialFormValuesFromRow,
  isLowConfidenceExtraction,
  labelForI9ReviewField,
  shouldShowStaffExtractionPanel,
  verifiedFieldsSnapshotFromCurrentDisplay,
} from '../../utils/i9SupportingDocumentReviewDisplay';

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

function extractionAssistLines(ext: I9DocumentExtractionBlock | undefined): string[] {
  if (!ext) return [];
  const ef = ext.extractedFields;
  const lines: string[] = [];
  if (ef?.extractedDocumentTypeLabel) lines.push(`Document: ${ef.extractedDocumentTypeLabel}`);
  if (ef?.fullName) lines.push(`Name: ${ef.fullName}`);
  else if (ef?.firstName || ef?.lastName) {
    lines.push(`Name: ${[ef.firstName, ef.lastName].filter(Boolean).join(' ')}`.trim());
  }
  if (ef?.documentNumber) lines.push(`Document #: ${ef.documentNumber}`);
  if (ef?.expirationDate) lines.push(`Expires: ${ef.expirationDate}`);
  if (ef?.dateOfBirth) lines.push(`DOB: ${ef.dateOfBirth}`);
  if (ef?.issueDate) lines.push(`Issued: ${ef.issueDate}`);
  if (ef?.issuingState) lines.push(`State: ${ef.issuingState}`);
  if (ef?.issuingCountry) lines.push(`Country: ${ef.issuingCountry}`);
  const overall = ext.confidenceSummary?.overall;
  if (typeof overall === 'number' && Number.isFinite(overall)) {
    const pct = overall <= 1 ? Math.round(overall * 100) : Math.round(overall);
    lines.push(`Reader confidence (avg): ${pct}%`);
  }
  return lines;
}

function ExtractionReviewAssist({
  ext,
  compact,
}: {
  ext: I9DocumentExtractionBlock | undefined;
  compact?: boolean;
}) {
  if (!ext || !ext.status) return null;
  const lines = extractionAssistLines(ext);
  const warn = [...(ext.extractionWarnings || []), ...(ext.extractedFields?.extractionWarnings || [])].filter(Boolean);

  if (compact) {
    return (
      <Box sx={{ mt: 0.75, maxWidth: 360 }}>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ fontWeight: 600 }}>
          Document reader (assistive — verify on image/PDF)
        </Typography>
        {lines.slice(0, 8).map((line, i) => (
          <Typography key={`${i}-${line.slice(0, 40)}`} variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.4 }}>
            {line}
          </Typography>
        ))}
        {warn.length > 0 ? (
          <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 0.5 }}>
            {warn.slice(0, 5).join(' · ')}
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
    <Box sx={{ mt: 0.75, maxWidth: 420 }}>
      {lines.map((line, i) => (
        <Typography key={`${i}-${line.slice(0, 40)}`} variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.45 }}>
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

function StaffAiExtractedDataPanel({
  ext,
  review,
  docId,
  viewerUid,
  reviewBusyDocId,
  onOpenEdit,
  onConfirmValues,
}: {
  ext: I9DocumentExtractionBlock | undefined;
  review: I9DocumentReviewBlock | undefined;
  docId: string;
  viewerUid: string | undefined;
  reviewBusyDocId: string | null;
  onOpenEdit: () => void;
  onConfirmValues: () => void;
}) {
  if (!shouldShowStaffExtractionPanel(ext)) return null;

  const st = String(ext?.status || '');
  const ef = ext?.extractedFields;
  const warns = allExtractionWarnings(ext);
  const categoryHints = categoryHintsFromWarnings(warns);
  const lowConf = isLowConfidenceExtraction(ext);
  const partial = hasPartialExtractedUsableFields(ext);
  const busy = reviewBusyDocId === docId;

  return (
    <Box
      sx={{
        mt: 1,
        p: 1,
        borderRadius: 1,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'action.hover',
        maxHeight: 320,
        overflow: 'auto',
      }}
    >
      <Typography variant="caption" color="text.secondary" fontWeight={700} display="block" sx={{ mb: 0.75 }}>
        AI extracted data
      </Typography>

      {st === 'extraction_unsupported' ? (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ lineHeight: 1.45 }}>
          AI extraction isn&apos;t available for this document type. Review the file manually.
        </Typography>
      ) : null}

      {st === 'extraction_failed' ? (
        <Alert severity="error" sx={{ py: 0, mb: 0.75 }}>
          <Typography variant="caption" display="block">
            {ext?.error?.message || 'Extraction failed — use the document image/PDF for review.'}
          </Typography>
        </Alert>
      ) : null}

      {st === 'extraction_pending' ? (
        <Typography variant="caption" color="warning.main" display="block" sx={{ mb: 0.75 }}>
          Reader is still running… refresh in a moment or open the file to review manually.
        </Typography>
      ) : null}

      {(st === 'extraction_complete' || partial) && (warns.length > 0 || lowConf) ? (
        <Alert severity="warning" sx={{ py: 0.25, mb: 0.75, '& .MuiAlert-message': { width: '100%' } }}>
          <Typography variant="caption" component="div" fontWeight={600}>
            Check these before relying on extracted text
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2, mb: 0 }}>
            {warns.slice(0, 8).map((w) => (
              <Typography key={w} variant="caption" component="li" display="list-item">
                {w}
              </Typography>
            ))}
            {lowConf ? (
              <Typography variant="caption" component="li" display="list-item">
                Average field confidence is low — compare to the document.
              </Typography>
            ) : null}
          </Box>
        </Alert>
      ) : null}

      {ef?.extractedDocumentTypeLabel ? (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
          <strong>Type (reader)</strong>: {ef.extractedDocumentTypeLabel}
        </Typography>
      ) : null}

      {categoryHints.length > 0 ? (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75 }}>
          <strong>Category / codes</strong>: {categoryHints.join(' · ')}
        </Typography>
      ) : null}

      {typeof ext?.confidenceSummary?.overall === 'number' && Number.isFinite(ext.confidenceSummary.overall) ? (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75 }}>
          <strong>Reader confidence (avg)</strong>:{' '}
          {ext.confidenceSummary.overall <= 1
            ? `${Math.round(ext.confidenceSummary.overall * 100)}%`
            : `${Math.round(ext.confidenceSummary.overall)}%`}
        </Typography>
      ) : null}

      {st === 'extraction_complete' || partial ? (
        <>
          <Divider sx={{ my: 0.75 }} />
          <Table size="small" sx={{ '& td': { border: 0, py: 0.35, verticalAlign: 'top' } }}>
            <TableBody>
              {I9_REVIEW_EDITABLE_FIELD_KEYS.map((key) => {
                const { text, source } = displayReviewField(key, ext, review);
                return (
                  <TableRow key={key}>
                    <TableCell sx={{ width: '38%', pr: 0.5 }}>
                      <Typography variant="caption" color="text.secondary">
                        {labelForI9ReviewField(key)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" alignItems="center" flexWrap="wrap" gap={0.5}>
                        <Typography variant="caption" sx={{ wordBreak: 'break-word' }}>
                          {text}
                        </Typography>
                        {source === 'verified' ? (
                          <Chip size="small" label="Verified" color="success" variant="outlined" sx={{ height: 20 }} />
                        ) : null}
                        {source === 'extracted' ? (
                          <Chip size="small" label="AI" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
                        ) : null}
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {review?.reviewedExtractionAt ? (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              Last verified/edited: {formatTs(review.reviewedExtractionAt)}
            </Typography>
          ) : null}
          <Stack direction="row" spacing={0.75} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
            <Button size="small" variant="outlined" disabled={busy || !viewerUid} onClick={onOpenEdit}>
              Edit / verify
            </Button>
            <Button size="small" variant="text" disabled={busy || !viewerUid} onClick={onConfirmValues}>
              Confirm values
            </Button>
          </Stack>
        </>
      ) : null}
    </Box>
  );
}

function statusChip(status: string): { label: string; color: 'default' | 'primary' | 'success' | 'warning' | 'error' } {
  switch (status) {
    case 'awaiting_upload':
      return { label: 'Not uploaded yet', color: 'default' };
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

function findReusableDocumentIdForListGroup(rows: I9SupportingDocRow[], group: 'a' | 'b' | 'c'): string | null {
  const prefix = group === 'a' ? 'list_a_' : group === 'b' ? 'list_b_' : 'list_c_';
  for (const r of rows) {
    const dt = String(r.data.documentType || '');
    if (!dt.startsWith(prefix)) continue;
    const st = String(r.data.status || '');
    const path = String(r.data.storagePath || '').trim();
    if (st === 'awaiting_upload' && !path) return r.id;
    if (st === 'rejected') return r.id;
    if (st === 'pending_review') return r.id;
  }
  return null;
}

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
  /** `entity_employments.entityKey` — used with `requestedForEntityId` to scope the document list for workers. */
  employmentEntityKey?: string | null;
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
  employmentEntityKey,
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

  const sortedRows = rows;
  const tableRows =
    staffMode || !workerSelf || !requestedForEntityId
      ? sortedRows
      : filterI9RowsForEntityEmployment(sortedRows, { entityId: requestedForEntityId, entityKey: employmentEntityKey ?? null }, 99);

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

  const [reviewEditDocId, setReviewEditDocId] = useState<string | null>(null);
  const [reviewForm, setReviewForm] = useState<Record<I9ReviewFieldKey, string> | null>(null);
  const [reviewBusyDocId, setReviewBusyDocId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTargetId, setUploadTargetId] = useState<string | null>(null);

  const [workerPathChoice, setWorkerPathChoice] = useState<'a' | 'bc'>('bc');
  const [workerListAType, setWorkerListAType] = useState(LIST_A_TYPES[0]?.value ?? 'list_a_us_passport');
  const [workerListBType, setWorkerListBType] = useState(LIST_B_TYPES[0]?.value ?? 'list_b_drivers_license');
  const [workerListCType, setWorkerListCType] = useState(LIST_C_TYPES[0]?.value ?? 'list_c_ssn_card');
  const pendingUploadNewGroupRef = useRef<'a' | 'b' | 'c' | null>(null);

  useEffect(() => {
    if (!workerSelf || loading) return;
    if (rows.length === 0) return;
    const hasA = rows.some((r) => String(r.data.documentType || '').startsWith('list_a_'));
    const hasB = rows.some((r) => String(r.data.documentType || '').startsWith('list_b_'));
    const hasC = rows.some((r) => String(r.data.documentType || '').startsWith('list_c_'));
    if (hasA && !(hasB || hasC)) setWorkerPathChoice('a');
    else if ((hasB || hasC) && !hasA) setWorkerPathChoice('bc');
  }, [workerSelf, loading, rows]);

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

  const handleConfirmReviewValues = async (documentId: string) => {
    if (!tenantId || !viewerUid) return;
    const row = tableRows.find((r) => r.id === documentId);
    if (!row) return;
    const ext = row.data.documentExtraction as I9DocumentExtractionBlock | undefined;
    const review = row.data.documentReview as I9DocumentReviewBlock | undefined;
    const vf = verifiedFieldsSnapshotFromCurrentDisplay(ext, review);
    setReviewBusyDocId(documentId);
    setActionError(null);
    try {
      await updateDoc(doc(db, p.workerI9SupportingDocument(tenantId, documentId)), {
        documentReview: {
          verifiedFields: vf,
          reviewedExtractionAt: serverTimestamp(),
          reviewedExtractionBy: viewerUid,
        },
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      setActionError(formatFirebaseHttpsError(e));
    } finally {
      setReviewBusyDocId(null);
    }
  };

  const submitReviewFieldEdits = async () => {
    if (!reviewEditDocId || !reviewForm || !tenantId || !viewerUid) return;
    const vf: I9DocumentReviewVerifiedFields = {};
    for (const key of I9_REVIEW_EDITABLE_FIELD_KEYS) {
      const v = reviewForm[key].trim();
      if (v !== '') vf[key] = v;
    }
    setReviewBusyDocId(reviewEditDocId);
    setActionError(null);
    try {
      await updateDoc(doc(db, p.workerI9SupportingDocument(tenantId, reviewEditDocId)), {
        documentReview: {
          verifiedFields: vf,
          reviewedExtractionAt: serverTimestamp(),
          reviewedExtractionBy: viewerUid,
        },
        updatedAt: serverTimestamp(),
      });
      setReviewEditDocId(null);
      setReviewForm(null);
    } catch (e) {
      setActionError(formatFirebaseHttpsError(e));
    } finally {
      setReviewBusyDocId(null);
    }
  };

  const NEW_UPLOAD_BUSY = '__new_i9_upload__';

  const triggerFilePick = (documentId: string) => {
    pendingUploadNewGroupRef.current = null;
    setUploadTargetId(documentId);
    setActionError(null);
    fileInputRef.current?.click();
  };

  const startWorkerListGroupUpload = useCallback(
    (group: 'a' | 'b' | 'c') => {
      if (!workerSelf) return;
      setActionError(null);
      const reuse = findReusableDocumentIdForListGroup(tableRows, group);
      if (reuse) {
        pendingUploadNewGroupRef.current = null;
        setUploadTargetId(reuse);
        fileInputRef.current?.click();
        return;
      }
      if (!requestedForEntityId?.trim()) {
        setActionError('Open Employment for this employer to upload I-9 documents.');
        return;
      }
      pendingUploadNewGroupRef.current = group;
      setUploadTargetId(null);
      fileInputRef.current?.click();
    },
    [workerSelf, tableRows, requestedForEntityId],
  );

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const newGroup = pendingUploadNewGroupRef.current;
    pendingUploadNewGroupRef.current = null;
    const documentId = uploadTargetId;
    setUploadTargetId(null);

    if (!file || !tenantId || !workerUserId) return;

    if (file.size > MAX_BYTES) {
      setActionError('File must be 15 MB or smaller.');
      return;
    }
    if (!ALLOWED_TYPES.test(file.type || '')) {
      setActionError('Only images and PDF files are allowed.');
      return;
    }

    if (newGroup && workerSelf && viewerUid) {
      if (!requestedForEntityId?.trim()) {
        setActionError('Use your Employment page for this employer to start an I-9 upload.');
        return;
      }
      const documentType =
        newGroup === 'a' ? workerListAType : newGroup === 'b' ? workerListBType : workerListCType;
      setUploadBusyId(NEW_UPLOAD_BUSY);
      setActionError(null);
      try {
        const colRef = collection(db, p.workerI9SupportingDocuments(tenantId));
        const newDocRef = doc(colRef);
        const newId = newDocRef.id;
        const storagePath = buildI9SupportingStorageObjectPath(tenantId, workerUserId, newId, file.name);
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, file, { contentType: file.type || 'application/octet-stream' });

        await setDoc(newDocRef, {
          tenantId,
          userId: workerUserId,
          documentType,
          status: 'pending_review',
          storagePath,
          uploadedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          uploadedFileName: file.name,
          uploadedContentType: file.type || null,
          reviewedAt: null,
          reviewedBy: null,
          rejectionReason: null,
          retainUntil: null,
          createdByUid: viewerUid,
          createdAt: serverTimestamp(),
          requestedForEntityId: requestedForEntityId.trim(),
        });
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setUploadBusyId(null);
      }
      return;
    }

    if (!documentId) return;

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
          {requestedForEntityId?.trim() ? (
            <>
              {workerPathChoice === 'a' ? (
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1.5}
                  alignItems={{ sm: 'flex-end' }}
                  flexWrap="wrap"
                  sx={{ mt: 1.5 }}
                >
                  <FormControl size="small" sx={{ minWidth: 240 }}>
                    <InputLabel id="i9-w-list-a">List A document</InputLabel>
                    <Select
                      labelId="i9-w-list-a"
                      label="List A document"
                      value={workerListAType}
                      onChange={(ev) => setWorkerListAType(ev.target.value)}
                    >
                      {LIST_A_TYPES.map((o) => (
                        <MenuItem key={o.value} value={o.value}>
                          {o.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={
                      uploadBusyId === NEW_UPLOAD_BUSY ? <CircularProgress size={16} color="inherit" /> : <UploadFileIcon />
                    }
                    disabled={Boolean(uploadBusyId)}
                    onClick={() => startWorkerListGroupUpload('a')}
                  >
                    Upload List A
                  </Button>
                </Stack>
              ) : (
                <Stack spacing={1.5} sx={{ mt: 1.5 }}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1.5}
                    alignItems={{ sm: 'flex-end' }}
                    flexWrap="wrap"
                  >
                    <FormControl size="small" sx={{ minWidth: 240 }}>
                      <InputLabel id="i9-w-list-b">List B document</InputLabel>
                      <Select
                        labelId="i9-w-list-b"
                        label="List B document"
                        value={workerListBType}
                        onChange={(ev) => setWorkerListBType(ev.target.value)}
                      >
                        {LIST_B_TYPES.map((o) => (
                          <MenuItem key={o.value} value={o.value}>
                            {o.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<UploadFileIcon />}
                      disabled={Boolean(uploadBusyId)}
                      onClick={() => startWorkerListGroupUpload('b')}
                    >
                      Upload List B
                    </Button>
                  </Stack>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1.5}
                    alignItems={{ sm: 'flex-end' }}
                    flexWrap="wrap"
                  >
                    <FormControl size="small" sx={{ minWidth: 240 }}>
                      <InputLabel id="i9-w-list-c">List C document</InputLabel>
                      <Select
                        labelId="i9-w-list-c"
                        label="List C document"
                        value={workerListCType}
                        onChange={(ev) => setWorkerListCType(ev.target.value)}
                      >
                        {LIST_C_TYPES.map((o) => (
                          <MenuItem key={o.value} value={o.value}>
                            {o.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<UploadFileIcon />}
                      disabled={Boolean(uploadBusyId)}
                      onClick={() => startWorkerListGroupUpload('c')}
                    >
                      Upload List C
                    </Button>
                  </Stack>
                </Stack>
              )}
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5, lineHeight: 1.45 }}>
                Your employer will review uploads. You can replace a file from the table below while it&apos;s under review or
                if it was rejected.
              </Typography>
            </>
          ) : (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1, lineHeight: 1.45 }}>
              Use the <strong>Upload</strong> buttons in the table when rows exist, or open <strong>Employment</strong> for a
              specific employer to upload I-9 documents there.
            </Typography>
          )}
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
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={28} />
        </Box>
      ) : tableRows.length > 0 ? (
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
              {tableRows.map(({ id, data }) => {
                const status = String(data.status || '');
                const sc = statusChip(status);
                const path = String(data.storagePath || '').trim();
                const canPreview = Boolean(path);
                const canStaffReview = staffMode && status === 'pending_review';
                const showUpload =
                  workerSelf &&
                  (status === 'awaiting_upload' || status === 'rejected' || status === 'pending_review');
                const ext = data.documentExtraction as I9DocumentExtractionBlock | undefined;
                const review = data.documentReview as I9DocumentReviewBlock | undefined;
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
                          <StaffAiExtractedDataPanel
                            ext={ext}
                            review={review}
                            docId={id}
                            viewerUid={viewerUid}
                            reviewBusyDocId={reviewBusyDocId}
                            onOpenEdit={() => {
                              setReviewForm(initialFormValuesFromRow(ext, review));
                              setReviewEditDocId(id);
                            }}
                            onConfirmValues={() => void handleConfirmReviewValues(id)}
                          />
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
      ) : !(workerSelf && requestedForEntityId?.trim()) ? (
        <Typography variant="body2" color="text.secondary">
          {staffMode
            ? 'No supporting documents on file. Use Request upload to add one.'
            : workerSelf
              ? 'No I-9 documents on file yet.'
              : 'No supporting documents on file.'}
        </Typography>
      ) : null}

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
          {approveConfirmDocId ? (() => {
            const approveRow = sortedRows.find((r) => r.id === approveConfirmDocId);
            const aext = approveRow?.data?.documentExtraction as I9DocumentExtractionBlock | undefined;
            const arev = approveRow?.data?.documentReview as I9DocumentReviewBlock | undefined;
            const sumLines = approveDialogSummaryLines(aext, arev);
            const sumWarns = allExtractionWarnings(aext);
            if (!aext) {
              return (
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>
                  No reader output for this upload yet — confirm against the file.
                </Typography>
              );
            }
            return (
              <Box sx={{ mt: 1.5 }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" sx={{ mb: 0.5 }}>
                  Reader summary (assistive)
                </Typography>
                {sumLines.length > 0 ? (
                  sumLines.map((line, i) => (
                    <Typography key={`${i}-${line.slice(0, 32)}`} variant="caption" color="text.secondary" display="block">
                      {line}
                    </Typography>
                  ))
                ) : (
                  <Typography variant="caption" color="text.secondary" display="block">
                    No name / document # / expiration extracted — open the file to verify.
                  </Typography>
                )}
                {sumWarns.length > 0 ? (
                  <Alert severity="warning" sx={{ mt: 1, py: 0.25 }}>
                    <Typography variant="caption" component="div">
                      {sumWarns.slice(0, 6).join(' · ')}
                    </Typography>
                  </Alert>
                ) : null}
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.25, lineHeight: 1.5 }}>
                  Please confirm these details match the document before approving.
                </Typography>
              </Box>
            );
          })() : null}
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

      <Dialog
        open={Boolean(reviewEditDocId)}
        onClose={() => {
          if (reviewBusyDocId) return;
          setReviewEditDocId(null);
          setReviewForm(null);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Verify extracted details</DialogTitle>
        <DialogContent>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5, lineHeight: 1.45 }}>
            Optional corrections for staff review only. Clear a field and save to show the reader value again for that field.
          </Typography>
          {reviewForm ? (
            <Stack spacing={1.25} sx={{ mt: 0.5 }}>
              {I9_REVIEW_EDITABLE_FIELD_KEYS.map((key) => (
                <TextField
                  key={key}
                  size="small"
                  fullWidth
                  label={labelForI9ReviewField(key)}
                  value={reviewForm[key]}
                  onChange={(ev) =>
                    setReviewForm((prev) => (prev ? { ...prev, [key]: ev.target.value } : prev))
                  }
                />
              ))}
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setReviewEditDocId(null);
              setReviewForm(null);
            }}
            disabled={Boolean(reviewBusyDocId)}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => void submitReviewFieldEdits()}
            disabled={!reviewForm || Boolean(reviewBusyDocId)}
          >
            {reviewBusyDocId === reviewEditDocId ? <CircularProgress size={20} /> : 'Save'}
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
