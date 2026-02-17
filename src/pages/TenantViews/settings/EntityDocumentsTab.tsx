/**
 * Entity Documents Tab — Phase 1C
 * Map which onboarding documents apply to this entity (handbooks, IC agreement, WC info).
 */
import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Alert,
  Snackbar,
  Paper,
} from '@mui/material';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../../firebase';
import { p } from '../../../data/firestorePaths';
import type { EntityDocuments } from './EntitiesPage';

interface EntityDocumentsTabProps {
  tenantId: string;
  entityId: string | null;
  entityDocuments: EntityDocuments | undefined;
  onSave: (documents: EntityDocuments) => Promise<void>;
}

const DOC_KEY_LABELS: Record<string, string> = {
  handbook_employee: 'Employee Handbook',
  handbook_contractor: 'Contractor Handbook',
  ic_agreement: 'IC Agreement',
  workers_comp_info: 'Workers Comp Info',
  safety_policy: 'Safety Policy',
  drug_policy: 'Drug Policy',
};

const EntityDocumentsTab: React.FC<EntityDocumentsTabProps> = ({
  tenantId,
  entityId,
  entityDocuments,
  onSave,
}) => {
  const [docKeys, setDocKeys] = useState<string[]>([]);
  const [form, setForm] = useState<EntityDocuments>({
    handbookEmployeeDocKey: entityDocuments?.handbookEmployeeDocKey || '',
    handbookContractorDocKey: entityDocuments?.handbookContractorDocKey || '',
    icAgreementDocKey: entityDocuments?.icAgreementDocKey || '',
    workersCompInfoDocKey: entityDocuments?.workersCompInfoDocKey || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      handbookEmployeeDocKey: entityDocuments?.handbookEmployeeDocKey || '',
      handbookContractorDocKey: entityDocuments?.handbookContractorDocKey || '',
      icAgreementDocKey: entityDocuments?.icAgreementDocKey || '',
      workersCompInfoDocKey: entityDocuments?.workersCompInfoDocKey || '',
    });
  }, [entityDocuments]);

  useEffect(() => {
    if (!tenantId) return;
    const load = async () => {
      try {
        const snapshot = await getDocs(
          collection(db, 'tenants', tenantId, 'onboarding_documents')
        );
        const keys = new Set<string>();
        snapshot.docs.forEach((d) => {
          const key = (d.data() as { docKey?: string }).docKey;
          if (key) keys.add(key);
        });
        setDocKeys(Array.from(keys).sort());
      } catch {
        setDocKeys([]);
      }
    };
    load();
  }, [tenantId]);

  const handleSave = async () => {
    if (!entityId) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(form);
      setSuccess('Documents mapping saved');
    } catch (err: any) {
      setError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (!entityId) {
    return (
      <Box sx={{ py: 2 }}>
        <Alert severity="info">Select an entity to map documents.</Alert>
      </Box>
    );
  }

  const options = docKeys.map((k) => ({
    value: k,
    label: DOC_KEY_LABELS[k] || k,
  }));

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Map which onboarding documents apply to this entity. Doc keys come from Settings → Onboarding
        Library → Documents.
      </Typography>
      <Paper variant="outlined" sx={{ p: 2, maxWidth: 480 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <FormControl fullWidth>
            <InputLabel>Employee Handbook</InputLabel>
            <Select
              value={form.handbookEmployeeDocKey || ''}
              label="Employee Handbook"
              onChange={(e) =>
                setForm((f) => ({ ...f, handbookEmployeeDocKey: e.target.value || undefined }))
              }
            >
              <MenuItem value="">None</MenuItem>
              {options.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label} ({o.value})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth>
            <InputLabel>Contractor Handbook</InputLabel>
            <Select
              value={form.handbookContractorDocKey || ''}
              label="Contractor Handbook"
              onChange={(e) =>
                setForm((f) => ({ ...f, handbookContractorDocKey: e.target.value || undefined }))
              }
            >
              <MenuItem value="">None</MenuItem>
              {options.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label} ({o.value})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth>
            <InputLabel>IC Agreement</InputLabel>
            <Select
              value={form.icAgreementDocKey || ''}
              label="IC Agreement"
              onChange={(e) =>
                setForm((f) => ({ ...f, icAgreementDocKey: e.target.value || undefined }))
              }
            >
              <MenuItem value="">None</MenuItem>
              {options.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label} ({o.value})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth>
            <InputLabel>Workers Comp Info</InputLabel>
            <Select
              value={form.workersCompInfoDocKey || ''}
              label="Workers Comp Info"
              onChange={(e) =>
                setForm((f) => ({ ...f, workersCompInfoDocKey: e.target.value || undefined }))
              }
            >
              <MenuItem value="">None</MenuItem>
              {options.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label} ({o.value})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button variant="contained" onClick={handleSave} disabled={saving} sx={{ alignSelf: 'flex-start' }}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </Box>
      </Paper>
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

export default EntityDocumentsTab;
