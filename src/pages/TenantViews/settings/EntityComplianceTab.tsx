/**
 * Entity Compliance Tab — Phase 1B Extension
 * CRUD for entity_jurisdictions (state registrations).
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
  Grid,
} from '@mui/material';
import { Add as AddIcon, Edit as EditIcon, Upload as UploadIcon } from '@mui/icons-material';
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  arrayUnion,
} from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../../../firebase';
import { p } from '../../../data/firestorePaths';

export type ComplianceDocType = 'sos' | 'employment_dept' | 'wc' | 'tax' | 'other';

export interface ComplianceDocument {
  id: string;
  title: string;
  docType: ComplianceDocType;
  entityId: string;
  state?: string | null;
  effectiveDate?: string;
  expiresDate?: string | null;
  file: {
    storagePath: string;
    fileName: string;
    contentType: string;
    size: number;
  };
  visibility: 'admin_only' | 'tenant_admin' | 'all_internal';
  createdAt?: any;
  updatedAt?: any;
}

const DOC_TYPES: { value: ComplianceDocType; label: string }[] = [
  { value: 'sos', label: 'Secretary of State' },
  { value: 'employment_dept', label: 'Employment Dept' },
  { value: 'wc', label: 'Workers Comp' },
  { value: 'tax', label: 'Tax' },
  { value: 'other', label: 'Other' },
];

const US_STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'];

export type JurisdictionStatus = 'active' | 'pending' | 'inactive' | 'not_registered';

export interface EntityJurisdiction {
  id: string;
  entityId: string;
  state: string;
  status: JurisdictionStatus;
  sos?: {
    filingNumber?: string;
    status?: string;
    registrationDate?: string;
    url?: string;
  };
  employmentDept?: {
    employerAccountNumber?: string;
    suiAccountNumber?: string;
    withholdingAccountNumber?: string;
  };
  notes?: string;
  documentIds?: string[];
  createdAt?: any;
  updatedAt?: any;
}

const STATUS_OPTIONS: { value: JurisdictionStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'not_registered', label: 'Not Registered' },
];

interface EntityComplianceTabProps {
  tenantId: string;
  entityId: string | null;
}

const EntityComplianceTab: React.FC<EntityComplianceTabProps> = ({
  tenantId,
  entityId,
}) => {
  const [items, setItems] = useState<EntityJurisdiction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<EntityJurisdiction | null>(null);
  const [form, setForm] = useState<Partial<EntityJurisdiction> & {
    sosFilingNumber?: string;
    sosStatus?: string;
    sosRegistrationDate?: string;
    empEmployerAccount?: string;
    empSuiAccount?: string;
    empWithholdingAccount?: string;
  }>({});
  const [saving, setSaving] = useState(false);
  const [complianceDocs, setComplianceDocs] = useState<ComplianceDocument[]>([]);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadForm, setUploadForm] = useState<{
    title: string;
    docType: ComplianceDocType;
    state: string;
    linkToJurisdictionId: string;
    file: File | null;
  }>({ title: '', docType: 'sos', state: '', linkToJurisdictionId: '', file: null });
  const [uploading, setUploading] = useState(false);

  const fetchItems = async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const snapshot = await getDocs(collection(db, 'tenants', tenantId, 'entity_jurisdictions'));
      const list: EntityJurisdiction[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as EntityJurisdiction[];
      setItems(list.filter((i) => i.entityId === entityId));
    } catch (err: any) {
      setError(err?.message || 'Failed to load jurisdictions');
    } finally {
      setLoading(false);
    }
  };

  const fetchComplianceDocs = async () => {
    if (!tenantId || !entityId) return;
    try {
      const snapshot = await getDocs(collection(db, 'tenants', tenantId, 'compliance_documents'));
      const list: ComplianceDocument[] = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() })) as ComplianceDocument[];
      setComplianceDocs(list.filter((d) => d.entityId === entityId));
    } catch {
      setComplianceDocs([]);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [tenantId, entityId]);

  useEffect(() => {
    fetchComplianceDocs();
  }, [tenantId, entityId]);

  const handleOpenCreate = () => {
    setEditingItem(null);
    setForm({
      entityId: entityId!,
      state: '',
      status: 'not_registered',
      sosFilingNumber: '',
      sosStatus: '',
      sosRegistrationDate: '',
      empEmployerAccount: '',
      empSuiAccount: '',
      empWithholdingAccount: '',
      notes: '',
    });
    setDialogOpen(true);
  };

  const handleOpenEdit = (item: EntityJurisdiction) => {
    setEditingItem(item);
    setForm({
      ...item,
      sosFilingNumber: item.sos?.filingNumber || '',
      sosStatus: item.sos?.status || '',
      sosRegistrationDate: item.sos?.registrationDate || '',
      empEmployerAccount: item.employmentDept?.employerAccountNumber || '',
      empSuiAccount: item.employmentDept?.suiAccountNumber || '',
      empWithholdingAccount: item.employmentDept?.withholdingAccountNumber || '',
    });
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingItem(null);
  };

  const handleSave = async () => {
    if (!tenantId || !entityId) return;
    const state = (form.state || '').trim();
    if (!state) {
      setError('State is required');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, any> = {
        entityId,
        state,
        status: form.status || 'not_registered',
        notes: (form.notes || '').trim() || undefined,
        updatedAt: serverTimestamp(),
      };
      if (form.sosFilingNumber || form.sosStatus || form.sosRegistrationDate) {
        payload.sos = {
          filingNumber: form.sosFilingNumber?.trim() || undefined,
          status: form.sosStatus?.trim() || undefined,
          registrationDate: form.sosRegistrationDate?.trim() || undefined,
        };
      }
      if (form.empEmployerAccount || form.empSuiAccount || form.empWithholdingAccount) {
        payload.employmentDept = {
          employerAccountNumber: form.empEmployerAccount?.trim() || undefined,
          suiAccountNumber: form.empSuiAccount?.trim() || undefined,
          withholdingAccountNumber: form.empWithholdingAccount?.trim() || undefined,
        };
      }

      if (editingItem) {
        await updateDoc(doc(db, p.entityJurisdiction(tenantId, editingItem.id)), payload);
        setSuccess('Jurisdiction updated');
      } else {
        payload.createdAt = serverTimestamp();
        await addDoc(collection(db, 'tenants', tenantId, 'entity_jurisdictions'), payload);
        setSuccess('Jurisdiction created');
      }
      handleCloseDialog();
      fetchItems();
    } catch (err: any) {
      setError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async () => {
    if (!tenantId || !entityId || !uploadForm.file) {
      setError('Select a file to upload');
      return;
    }
    const title = (uploadForm.title || '').trim();
    if (!title) {
      setError('Title is required');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const file = uploadForm.file;
      const storagePath = `tenants/${tenantId}/compliance_docs/${entityId}/${uploadForm.state || 'general'}/${uploadForm.docType}/${Date.now()}_${file.name}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, file);

      const docPayload = {
        title,
        docType: uploadForm.docType,
        entityId,
        state: uploadForm.state || null,
        file: {
          storagePath,
          fileName: file.name,
          contentType: file.type,
          size: file.size,
        },
        visibility: 'tenant_admin' as const,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const docRef = await addDoc(collection(db, 'tenants', tenantId, 'compliance_documents'), docPayload);

      if (uploadForm.linkToJurisdictionId) {
        const jurRef = doc(db, p.entityJurisdiction(tenantId, uploadForm.linkToJurisdictionId));
        await updateDoc(jurRef, {
          documentIds: arrayUnion(docRef.id),
          updatedAt: serverTimestamp(),
        });
      }
      setSuccess('Document uploaded');
      setUploadDialogOpen(false);
      setUploadForm({ title: '', docType: 'sos', state: '', linkToJurisdictionId: '', file: null });
      fetchComplianceDocs();
      fetchItems();
    } catch (err: any) {
      setError(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  if (!entityId) {
    return (
      <Box sx={{ py: 2 }}>
        <Alert severity="info">Select an entity to manage compliance / state registrations.</Alert>
      </Box>
    );
  }

  const statusColor = (s: JurisdictionStatus) =>
    s === 'active' ? 'success' : s === 'pending' ? 'warning' : 'default';

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
        <Typography variant="body2" color="text.secondary">
          Secretary of State and employment department registrations by state
        </Typography>
        <Box display="flex" gap={1}>
          <Button variant="outlined" startIcon={<UploadIcon />} onClick={() => setUploadDialogOpen(true)}>
            Upload Document
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate}>
            Add State
          </Button>
        </Box>
      </Box>

      {loading ? (
        <Typography color="text.secondary">Loading…</Typography>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>State</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>SOS Filing #</TableCell>
                <TableCell>Employer Acct</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                    No state registrations. Add states where this entity operates.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.id} hover>
                    <TableCell>{item.state}</TableCell>
                    <TableCell>
                      <Chip
                        label={STATUS_OPTIONS.find((o) => o.value === item.status)?.label || item.status}
                        size="small"
                        color={statusColor(item.status)}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>{item.sos?.filingNumber || '—'}</TableCell>
                    <TableCell>{item.employmentDept?.employerAccountNumber || '—'}</TableCell>
                    <TableCell align="right">
                      <IconButton size="small" onClick={() => handleOpenEdit(item)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>Compliance Documents</Typography>
      {complianceDocs.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
          No documents uploaded. Use &quot;Upload Document&quot; to add state filings, certificates, etc.
        </Typography>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Title</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>State</TableCell>
                <TableCell>File</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {complianceDocs.map((d) => (
                <TableRow key={d.id} hover>
                  <TableCell>{d.title}</TableCell>
                  <TableCell>{DOC_TYPES.find((t) => t.value === d.docType)?.label || d.docType}</TableCell>
                  <TableCell>{d.state || '—'}</TableCell>
                  <TableCell>
                    <Typography variant="caption">{d.file?.fileName}</Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={uploadDialogOpen} onClose={() => setUploadDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Upload Compliance Document</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              label="Title"
              value={uploadForm.title}
              onChange={(e) => setUploadForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. NV SOS Certificate"
              fullWidth
              required
            />
            <FormControl fullWidth>
              <InputLabel>Document Type</InputLabel>
              <Select
                value={uploadForm.docType}
                label="Document Type"
                onChange={(e) => setUploadForm((f) => ({ ...f, docType: e.target.value as ComplianceDocType }))}
              >
                {DOC_TYPES.map((o) => (
                  <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>State</InputLabel>
              <Select
                value={uploadForm.state}
                label="State"
                onChange={(e) => setUploadForm((f) => ({ ...f, state: e.target.value }))}
              >
                <MenuItem value="">—</MenuItem>
                {US_STATES.map((s) => (
                  <MenuItem key={s} value={s}>{s}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Link to Jurisdiction (optional)</InputLabel>
              <Select
                value={uploadForm.linkToJurisdictionId}
                label="Link to Jurisdiction (optional)"
                onChange={(e) => setUploadForm((f) => ({ ...f, linkToJurisdictionId: e.target.value }))}
              >
                <MenuItem value="">None</MenuItem>
                {items.map((j) => (
                  <MenuItem key={j.id} value={j.id}>{j.state}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button variant="outlined" component="label">
              {uploadForm.file ? uploadForm.file.name : 'Choose PDF/File'}
              <input
                type="file"
                hidden
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                onChange={(e) => setUploadForm((f) => ({ ...f, file: e.target.files?.[0] || null }))}
              />
            </Button>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUploadDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleUpload} disabled={uploading || !uploadForm.file}>
            {uploading ? 'Uploading…' : 'Upload'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editingItem ? 'Edit Jurisdiction' : 'Add State Registration'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <FormControl fullWidth required>
              <InputLabel>State</InputLabel>
              <Select
                value={form.state || ''}
                label="State"
                onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                disabled={!!editingItem}
              >
                {US_STATES.map((s) => (
                  <MenuItem key={s} value={s}>{s}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Status</InputLabel>
              <Select
                value={form.status || 'not_registered'}
                label="Status"
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as JurisdictionStatus }))}
              >
                {STATUS_OPTIONS.map((o) => (
                  <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Typography variant="subtitle2">Secretary of State</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Filing Number"
                  value={form.sosFilingNumber || ''}
                  onChange={(e) => setForm((f) => ({ ...f, sosFilingNumber: e.target.value }))}
                  fullWidth
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Registration Date"
                  value={form.sosRegistrationDate || ''}
                  onChange={(e) => setForm((f) => ({ ...f, sosRegistrationDate: e.target.value }))}
                  placeholder="YYYY-MM-DD"
                  fullWidth
                />
              </Grid>
            </Grid>
            <Typography variant="subtitle2">Employment Department</Typography>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  label="Employer Account Number"
                  value={form.empEmployerAccount || ''}
                  onChange={(e) => setForm((f) => ({ ...f, empEmployerAccount: e.target.value }))}
                  fullWidth
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="SUI Account"
                  value={form.empSuiAccount || ''}
                  onChange={(e) => setForm((f) => ({ ...f, empSuiAccount: e.target.value }))}
                  fullWidth
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Withholding Account"
                  value={form.empWithholdingAccount || ''}
                  onChange={(e) => setForm((f) => ({ ...f, empWithholdingAccount: e.target.value }))}
                  fullWidth
                />
              </Grid>
            </Grid>
            <TextField
              label="Notes"
              value={form.notes || ''}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              fullWidth
              multiline
              rows={2}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : editingItem ? 'Save' : 'Create'}
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

export default EntityComplianceTab;
