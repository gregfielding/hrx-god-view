import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Stack,
  Alert,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from '@mui/material';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import {
  EVERIFY_ICA_MAPPINGS_SETTINGS_ID,
  type EverifyIcaDocumentMappingsDoc,
} from '../../../types/everifyIcaDocumentMappings';

interface EVerifyTabProps {
  tenantId: string;
}

const emptyMappings = (): EverifyIcaDocumentMappingsDoc => ({
  schemaVersion: 1,
  listBDriversLicense: {},
  listBGovernmentIdCard: {},
});

const EVerifyTab: React.FC<EVerifyTabProps> = ({ tenantId }) => {
  const docRef = useMemo(
    () => doc(db, 'tenants', tenantId, 'settings', EVERIFY_ICA_MAPPINGS_SETTINGS_ID),
    [tenantId],
  );

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [m, setM] = useState<EverifyIcaDocumentMappingsDoc>(() => emptyMappings());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(docRef);
        if (cancelled) return;
        if (snap.exists()) {
          const d = snap.data() as Partial<EverifyIcaDocumentMappingsDoc>;
          setM({
            ...emptyMappings(),
            ...d,
            schemaVersion: 1,
            listBDriversLicense: { ...emptyMappings().listBDriversLicense, ...d.listBDriversLicense },
            listBGovernmentIdCard: { ...emptyMappings().listBGovernmentIdCard, ...d.listBGovernmentIdCard },
          });
        } else {
          setM(emptyMappings());
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docRef]);

  const setDl = (field: 'REAL_ID' | 'NON_REAL_ID', v: string) => {
    setM((prev) => ({
      ...prev,
      listBDriversLicense: { ...prev.listBDriversLicense, [field]: v },
    }));
  };

  const setGov = (field: 'REAL_ID' | 'NON_REAL_ID', v: string) => {
    setM((prev) => ({
      ...prev,
      listBGovernmentIdCard: { ...prev.listBGovernmentIdCard, [field]: v },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await setDoc(docRef, { ...m, schemaVersion: 1, updatedAt: new Date().toISOString() }, { merge: true });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ p: 0 }}>
        <Typography variant="body2">Loading E-Verify ICA mappings…</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0, maxWidth: 960 }}>
      <Typography variant="h6" fontWeight={700}>
        E-Verify — ICA document subtype mapping
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
        Map human-readable REAL ID / Non-REAL ID choices to the exact <code>document_sub_type_code</code> strings from{' '}
        <strong>your signed E-Verify ICA</strong>. Admins use friendly labels in the Complete E-Verify flow; HRX fills the
        API payload automatically. Wrong strings return <code>ATTRIBUTE_INVALID_ENUM</code> from USCIS — copy values
        verbatim from your ICA appendix.
      </Typography>

      <Alert severity="info" sx={{ mb: 2 }}>
        Firestore: <code>tenants/{'{tenantId}'}/settings/{EVERIFY_ICA_MAPPINGS_SETTINGS_ID}</code>
      </Alert>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>List B (REST code)</TableCell>
              <TableCell>REAL ID (ICA enum)</TableCell>
              <TableCell>Non-REAL ID (ICA enum)</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell>
                <Typography variant="body2" fontWeight={600}>
                  DRIVERS_LICENSE
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Driver&apos;s license
                </Typography>
              </TableCell>
              <TableCell>
                <TextField
                  size="small"
                  fullWidth
                  value={m.listBDriversLicense?.REAL_ID ?? ''}
                  onChange={(e) => setDl('REAL_ID', e.target.value)}
                  placeholder="From ICA"
                />
              </TableCell>
              <TableCell>
                <TextField
                  size="small"
                  fullWidth
                  value={m.listBDriversLicense?.NON_REAL_ID ?? ''}
                  onChange={(e) => setDl('NON_REAL_ID', e.target.value)}
                  placeholder="From ICA"
                />
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                <Typography variant="body2" fontWeight={600}>
                  GOVERNMENT_ID_CARD
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  State-issued ID card
                </Typography>
              </TableCell>
              <TableCell>
                <TextField
                  size="small"
                  fullWidth
                  value={m.listBGovernmentIdCard?.REAL_ID ?? ''}
                  onChange={(e) => setGov('REAL_ID', e.target.value)}
                  placeholder="From ICA"
                />
              </TableCell>
              <TableCell>
                <TextField
                  size="small"
                  fullWidth
                  value={m.listBGovernmentIdCard?.NON_REAL_ID ?? ''}
                  onChange={(e) => setGov('NON_REAL_ID', e.target.value)}
                  placeholder="From ICA"
                />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Paper>

      <Stack direction="row" spacing={2} alignItems="center">
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save mappings'}
        </Button>
        <Typography variant="caption" color="text.secondary">
          Leave a cell blank if your ICA does not use that combination; the UI will hide or auto-select accordingly.
        </Typography>
      </Stack>
    </Box>
  );
};

export default EVerifyTab;
