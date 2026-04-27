/**
 * Onboarding Documents Tab — Phase 1C
 * Document repository: upload, version, set active/archive.
 */
import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Snackbar,
  Alert,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Collapse,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  CloudUpload as UploadIcon,
} from '@mui/icons-material';
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../../../firebase';
import { p } from '../../../data/firestorePaths';
import type {
  OnboardingDocument,
  OnboardingDocumentMode,
  OnboardingDocumentStatus,
} from '../../../types/phase1cOnboarding';

const MODE_OPTIONS: { value: OnboardingDocumentMode; label: string }[] = [
  { value: 'acknowledge', label: 'Acknowledge' },
  { value: 'upload', label: 'Upload' },
  { value: 'esign', label: 'E-sign (placeholder)' },
];

const STATUS_OPTIONS: OnboardingDocumentStatus[] = ['draft', 'active', 'archived'];

interface OnboardingDocumentsTabProps {
  tenantId: string;
}

const OnboardingDocumentsTab: React.FC<OnboardingDocumentsTabProps> = ({ tenantId }) => {
  const [docs, setDocs] = useState<OnboardingDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    docKey: '',
    title: '',
    version: '',
    effectiveDate: '',
    mode: 'acknowledge' as OnboardingDocumentMode,
    file: null as File | null,
  });
  const [uploading, setUploading] = useState(false);

  const fetchDocs = async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const snapshot = await getDocs(collection(db, 'tenants', tenantId, 'onboarding_documents'));
      const list: OnboardingDocument[] = snapshot.docs.map((d) => ({
        docId: d.id,
        ...d.data(),
      })) as OnboardingDocument[];
      setDocs(list);
    } catch (err: any) {
      setError(err?.message || 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocs();
  }, [tenantId]);

  const groupedByDocKey = docs.reduce<Record<string, OnboardingDocument[]>>((acc, d) => {
    const key = d.docKey || 'unknown';
    if (!acc[key]) acc[key] = [];
    acc[key].push(d);
    acc[key].sort((a, b) => (b.version || '').localeCompare(a.version || ''));
    return acc;
  }, {});

  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleUpload = async () => {
    if (!tenantId || !uploadForm.file) {
      setError('Select a PDF file');
      return;
    }
    const docKey = (uploadForm.docKey || '').trim();
    const title = (uploadForm.title || '').trim();
    const version = (uploadForm.version || '').trim();
    if (!docKey || !title || !version) {
      setError('Doc key, title, and version are required');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const file = uploadForm.file;
      const storagePath = `tenants/${tenantId}/onboarding_docs/${docKey}/${version}/${file.name}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, file);

      const docPayload = {
        tenantId,
        docKey,
        title,
        version,
        effectiveDate: uploadForm.effectiveDate?.trim() || undefined,
        status: 'draft' as OnboardingDocumentStatus,
        mode: uploadForm.mode,
        file: {
          storagePath,
          fileName: file.name,
          contentType: file.type || 'application/pdf',
          size: file.size,
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await addDoc(collection(db, 'tenants', tenantId, 'onboarding_documents'), docPayload);
      setSuccess('Document uploaded');
      setUploadDialogOpen(false);
      setUploadForm({
        docKey: '',
        title: '',
        version: '',
        effectiveDate: '',
        mode: 'acknowledge',
        file: null,
      });
      fetchDocs();
    } catch (err: any) {
      setError(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleSetStatus = async (
    document: OnboardingDocument,
    newStatus: OnboardingDocumentStatus
  ) => {
    if (!tenantId) return;
    setError(null);
    try {
      if (newStatus === 'active') {
        const batch = writeBatch(db);
        const sameKey = docs.filter((d) => d.docKey === document.docKey);
        for (const d of sameKey) {
          const ref = doc(db, p.onboardingDocument(tenantId, d.docId));
          batch.update(ref, {
            status: d.docId === document.docId ? 'active' : 'archived',
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
      } else {
        await updateDoc(doc(db, p.onboardingDocument(tenantId, document.docId)), {
          status: newStatus,
          updatedAt: serverTimestamp(),
        });
      }
      setSuccess('Status updated');
      fetchDocs();
    } catch (err: any) {
      setError(err?.message || 'Failed to update');
    }
  };

  const handleSetMode = async (document: OnboardingDocument, mode: OnboardingDocumentMode) => {
    if (!tenantId) return;
    setError(null);
    try {
      await updateDoc(doc(db, p.onboardingDocument(tenantId, document.docId)), {
        mode,
        updatedAt: serverTimestamp(),
      });
      setSuccess('Mode updated');
      fetchDocs();
    } catch (err: any) {
      setError(err?.message || 'Failed to update');
    }
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="body2" color="text.secondary">
          Upload PDFs by docKey. Mark one version active per docKey.
        </Typography>
        <Button variant="contained" startIcon={<UploadIcon />} onClick={() => setUploadDialogOpen(true)}>
          Upload New Version
        </Button>
      </Box>

      {loading ? (
        <Typography color="text.secondary">Loading…</Typography>
      ) : Object.keys(groupedByDocKey).length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 4 }}>
          No documents. Upload handbooks, IC agreements, etc.
        </Typography>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell width={48} />
                <TableCell>Doc Key</TableCell>
                <TableCell>Versions</TableCell>
                <TableCell>Active</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {Object.entries(groupedByDocKey).map(([docKey, versions]) => {
                const expanded = expandedKeys.has(docKey);
                const activeVersion = versions.find((v) => v.status === 'active');
                return (
                  <React.Fragment key={docKey}>
                    <TableRow hover>
                      <TableCell>
                        <IconButton size="small" onClick={() => toggleExpand(docKey)}>
                          {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                        </IconButton>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontFamily="monospace" fontWeight={500}>
                          {docKey}
                        </Typography>
                        {versions[0]?.title && (
                          <Typography variant="caption" color="text.secondary">
                            {versions[0].title}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>{versions.length} version(s)</TableCell>
                      <TableCell>
                        {activeVersion ? (
                          <Chip
                            label={`${activeVersion.version} (active)`}
                            size="small"
                            color="success"
                            variant="outlined"
                          />
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            No active
                          </Typography>
                        )}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={4} sx={{ py: 0, borderBottom: 0 }}>
                        <Collapse in={expanded} timeout="auto">
                          <Box sx={{ pl: 4, pr: 2, pb: 2 }}>
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell>Version</TableCell>
                                  <TableCell>Title</TableCell>
                                  <TableCell>Mode</TableCell>
                                  <TableCell>Status</TableCell>
                                  <TableCell>Effective</TableCell>
                                  <TableCell>File</TableCell>
                                  <TableCell align="right">Actions</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {versions.map((v) => (
                                  <TableRow key={v.docId}>
                                    <TableCell>
                                      <Typography fontFamily="monospace">{v.version}</Typography>
                                    </TableCell>
                                    <TableCell>{v.title}</TableCell>
                                    <TableCell>
                                      <Select
                                        size="small"
                                        value={v.mode || 'acknowledge'}
                                        onChange={(e) =>
                                          handleSetMode(v, e.target.value as OnboardingDocumentMode)
                                        }
                                        sx={{ minWidth: 120 }}
                                      >
                                        {MODE_OPTIONS.map((o) => (
                                          <MenuItem key={o.value} value={o.value}>
                                            {o.label}
                                          </MenuItem>
                                        ))}
                                      </Select>
                                    </TableCell>
                                    <TableCell>
                                      <Select
                                        size="small"
                                        value={v.status || 'draft'}
                                        onChange={(e) =>
                                          handleSetStatus(
                                            v,
                                            e.target.value as OnboardingDocumentStatus
                                          )
                                        }
                                        sx={{ minWidth: 100 }}
                                      >
                                        {STATUS_OPTIONS.map((s) => (
                                          <MenuItem key={s} value={s}>
                                            {s}
                                          </MenuItem>
                                        ))}
                                      </Select>
                                    </TableCell>
                                    <TableCell>{v.effectiveDate || '—'}</TableCell>
                                    <TableCell>
                                      <Typography variant="caption">{v.file?.fileName}</Typography>
                                    </TableCell>
                                    <TableCell align="right">
                                      {v.status !== 'active' && (
                                        <Button
                                          size="small"
                                          onClick={() => handleSetStatus(v, 'active')}
                                        >
                                          Set Active
                                        </Button>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </Box>
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={uploadDialogOpen} onClose={() => setUploadDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Upload Onboarding Document</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              label="Doc Key"
              value={uploadForm.docKey}
              onChange={(e) => setUploadForm((f) => ({ ...f, docKey: e.target.value }))}
              placeholder="e.g. handbook_employee, ic_agreement"
              fullWidth
              required
            />
            <TextField
              label="Title"
              value={uploadForm.title}
              onChange={(e) => setUploadForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Employee Handbook 2026"
              fullWidth
              required
            />
            <TextField
              label="Version"
              value={uploadForm.version}
              onChange={(e) => setUploadForm((f) => ({ ...f, version: e.target.value }))}
              placeholder="e.g. 2026.02 or v3"
              fullWidth
              required
            />
            <TextField
              label="Effective Date"
              value={uploadForm.effectiveDate}
              onChange={(e) => setUploadForm((f) => ({ ...f, effectiveDate: e.target.value }))}
              placeholder="YYYY-MM-DD"
              fullWidth
            />
            <FormControl fullWidth>
              <InputLabel>Mode</InputLabel>
              <Select
                value={uploadForm.mode}
                label="Mode"
                onChange={(e) =>
                  setUploadForm((f) => ({ ...f, mode: e.target.value as OnboardingDocumentMode }))
                }
              >
                {MODE_OPTIONS.map((o) => (
                  <MenuItem key={o.value} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button variant="outlined" component="label">
              {uploadForm.file ? uploadForm.file.name : 'Choose PDF'}
              <input
                type="file"
                hidden
                accept=".pdf,application/pdf"
                onChange={(e) =>
                  setUploadForm((f) => ({ ...f, file: e.target.files?.[0] || null }))
                }
              />
            </Button>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUploadDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleUpload}
            disabled={uploading || !uploadForm.file || !uploadForm.docKey || !uploadForm.title || !uploadForm.version}
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!error} autoHideDuration={5000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Snackbar>
      <Snackbar open={!!success} autoHideDuration={2000} onClose={() => setSuccess(null)}>
        <Alert severity="success">{success}</Alert>
      </Snackbar>
    </Box>
  );
};

export default OnboardingDocumentsTab;
