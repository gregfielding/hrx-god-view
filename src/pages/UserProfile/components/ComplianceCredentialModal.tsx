/**
 * Phase 2A.1: Add/Edit compliance item for expiring credentials and screenings.
 * Minimal admin CRUD: type, required, status, entity, issuedAt, expiresAt, renewalDueAt, notes.
 */
import React, { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
} from '@mui/material';
import { collection, doc, addDoc, updateDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../firebase';
import { p } from '../../../data/firestorePaths';
import {
  COMPLIANCE_STATUS,
  getComplianceTypeConfig,
  type WorkerComplianceItem,
  type ComplianceStatus,
  type ComplianceItemTypeKey,
} from '../../../types/compliance';

/** Types that support manual add/edit for credentials/permits/screenings with expiration. */
export const CREDENTIAL_EDIT_TYPES: ComplianceItemTypeKey[] = [
  'drivers_license',
  'work_permit',
  'food_handler',
  'cpr_bls',
  'forklift_certification',
  'tb_test',
];

interface ComplianceCredentialModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  tenantId: string;
  userId: string;
  /** When set, we're editing; otherwise adding. */
  item?: (WorkerComplianceItem & { id: string }) | null;
}

function toDateInputValue(value: unknown): string {
  if (!value) return '';
  let date: Date;
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    date = (value as { toDate: () => Date }).toDate();
  } else if (typeof value === 'string') {
    date = new Date(value);
  } else {
    return '';
  }
  return date.toISOString().slice(0, 10);
}

const ComplianceCredentialModal: React.FC<ComplianceCredentialModalProps> = ({
  open,
  onClose,
  onSaved,
  tenantId,
  userId,
  item,
}) => {
  const isEdit = !!item;
  const [employmentOptions, setEmploymentOptions] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [type, setType] = useState<string>(item?.type ?? 'drivers_license');
  const [required, setRequired] = useState(item?.required ?? false);
  const [status, setStatus] = useState<ComplianceStatus>(item?.status as ComplianceStatus ?? 'pending');
  const [employmentId, setEmploymentId] = useState<string>(item?.employmentId ?? '');
  const [issuedAt, setIssuedAt] = useState(toDateInputValue(item?.issuedAt));
  const [expiresAt, setExpiresAt] = useState(toDateInputValue(item?.expiresAt));
  const [renewalDueAt, setRenewalDueAt] = useState(toDateInputValue(item?.renewalDueAt));
  const [notes, setNotes] = useState(item?.notes ?? '');

  useEffect(() => {
    if (!open || !tenantId || !userId) return;
    if (item) {
      setType(item.type as string);
      setRequired(!!item.required);
      setStatus((item.status as ComplianceStatus) ?? 'pending');
      setEmploymentId(item.employmentId ?? '');
      setIssuedAt(toDateInputValue(item.issuedAt));
      setExpiresAt(toDateInputValue(item.expiresAt));
      setRenewalDueAt(toDateInputValue(item.renewalDueAt));
      setNotes(item.notes ?? '');
    } else {
      setType('drivers_license');
      setRequired(false);
      setStatus('pending');
      setEmploymentId('');
      setIssuedAt('');
      setExpiresAt('');
      setRenewalDueAt('');
      setNotes('');
    }
  }, [open, tenantId, userId, item]);

  useEffect(() => {
    if (!open || !tenantId || !userId) {
      setEmploymentOptions([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const ref = collection(db, p.entityEmployments(tenantId));
    getDocs(query(ref, where('userId', '==', userId)))
      .then((snap) => {
        if (cancelled) return;
        const list = snap.docs.map((d) => {
          const data = d.data() as { entityName?: string; entityKey?: string };
          return { id: d.id, label: data.entityName || data.entityKey || d.id };
        });
        setEmploymentOptions(list);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, tenantId, userId]);

  const handleSave = async () => {
    if (!tenantId || !userId) return;
    setSaving(true);
    try {
      const config = getComplianceTypeConfig(type);
      const payload = {
        tenantId,
        userId,
        entityId: null as string | null,
        employmentId: employmentId || null,
        category: config?.category ?? 'credential',
        type,
        title: config?.label ?? type,
        required,
        status,
        source: isEdit ? (item?.source ?? 'admin_manual') : 'admin_manual',
        documentIds: null,
        issuedAt: issuedAt ? new Date(issuedAt) : null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        renewalDueAt: renewalDueAt ? new Date(renewalDueAt) : null,
        verifiedAt: null,
        verifiedBy: null,
        notes: notes.trim() || null,
        metadata: null,
        updatedAt: serverTimestamp(),
      };
      if (isEdit && item?.id) {
        await updateDoc(doc(db, p.workerComplianceItem(tenantId, item.id)), payload);
      } else {
        await addDoc(collection(db, p.workerComplianceItems(tenantId)), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? 'Edit compliance item' : 'Add credential / permit'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <FormControl fullWidth size="small" disabled={isEdit}>
            <InputLabel>Type</InputLabel>
            <Select
              value={type}
              label="Type"
              onChange={(e) => setType(e.target.value)}
            >
              {CREDENTIAL_EDIT_TYPES.map((t) => {
                const c = getComplianceTypeConfig(t);
                return (
                  <MenuItem key={t} value={t}>
                    {c?.label ?? t}
                  </MenuItem>
                );
              })}
            </Select>
          </FormControl>
          <FormControl fullWidth size="small">
            <InputLabel>Status</InputLabel>
            <Select
              value={status}
              label="Status"
              onChange={(e) => setStatus(e.target.value as ComplianceStatus)}
            >
              {COMPLIANCE_STATUS.map((s) => (
                <MenuItem key={s} value={s}>{s}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControlLabel
            control={<Switch checked={required} onChange={(_, v) => setRequired(v)} />}
            label="Required"
          />
          <FormControl fullWidth size="small">
            <InputLabel>Entity (optional)</InputLabel>
            <Select
              value={employmentId}
              label="Entity (optional)"
              onChange={(e) => setEmploymentId(e.target.value)}
              disabled={loading}
            >
              <MenuItem value="">— None —</MenuItem>
              {employmentOptions.map((opt) => (
                <MenuItem key={opt.id} value={opt.id}>{opt.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            fullWidth
            size="small"
            type="date"
            label="Issued date"
            value={issuedAt}
            onChange={(e) => setIssuedAt(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            fullWidth
            size="small"
            type="date"
            label="Expires"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            fullWidth
            size="small"
            type="date"
            label="Renewal due"
            value={renewalDueAt}
            onChange={(e) => setRenewalDueAt(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            fullWidth
            size="small"
            multiline
            minRows={2}
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save' : 'Add'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ComplianceCredentialModal;
