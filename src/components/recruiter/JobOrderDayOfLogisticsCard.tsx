/**
 * Day-of logistics header for the JO Staff Instructions tab (Greg
 * 2026-09-03, day-of-shift completeness layer 1).
 *
 * Two jobs:
 *   1. Structured ON-SITE CONTACT (name / phone / role) on the JO doc —
 *      `onsiteContactName` / `onsiteContactPhone` / `onsiteContactRole`.
 *      The worker app's day-of hero card and assignment detail resolve
 *      these through the assignment → shift → JO chain and render
 *      tap-to-text / tap-to-call, so the phone must be a real dialable
 *      number, not "front desk".
 *   2. A DAY-OF READINESS strip — which of the five day-of essentials
 *      (contact, first day, parking, check-in, uniform) have content —
 *      so gaps are visible before shifts go out.
 *
 * Save style matches StaffInstructionCard: debounced auto-save (1s) +
 * save-on-blur, dotted field paths on the JO doc.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Snackbar,
  Stack,
  TextField,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import PersonPinCircleOutlinedIcon from '@mui/icons-material/PersonPinCircleOutlined';
import { doc, updateDoc } from 'firebase/firestore';

import { db } from '../../firebase';
import { p } from '../../data/firestorePaths';

interface JobOrderDayOfLogisticsCardProps {
  jobOrder: any;
  jobOrderId: string;
  tenantId: string;
}

/** Same tolerant read as StaffInstructionCard.instructionTextToString. */
function instructionHasContent(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    const text = o.text ?? o.en ?? o.instructions;
    if (typeof text === 'string' && text.trim()) return true;
    if (typeof text === 'object' && text !== null && typeof (text as Record<string, unknown>).en === 'string') {
      if (((text as Record<string, unknown>).en as string).trim()) return true;
    }
    if (Array.isArray(o.files) && o.files.length > 0) return true;
  }
  return false;
}

const CONTACT_FIELDS = [
  { key: 'onsiteContactName', label: 'Contact name', placeholder: 'Who workers should find on arrival (e.g., Maria Lopez)' },
  { key: 'onsiteContactPhone', label: 'Contact phone', placeholder: 'Dialable number — workers get tap-to-text / tap-to-call' },
  { key: 'onsiteContactRole', label: 'Role / where to find them', placeholder: 'e.g., Catering Lead — loading dock office' },
] as const;

const JobOrderDayOfLogisticsCard: React.FC<JobOrderDayOfLogisticsCardProps> = ({
  jobOrder,
  jobOrderId,
  tenantId,
}) => {
  const [values, setValues] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ open: boolean; message: string; severity: 'success' | 'error' } | null>(null);
  const lastSavedRef = useRef<Record<string, string>>({});
  const timerRef = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const f of CONTACT_FIELDS) {
      next[f.key] = typeof jobOrder?.[f.key] === 'string' ? jobOrder[f.key] : '';
    }
    setValues(next);
    lastSavedRef.current = { ...next };
  }, [jobOrder?.onsiteContactName, jobOrder?.onsiteContactPhone, jobOrder?.onsiteContactRole]);

  const saveField = async (key: string, raw: string) => {
    const value = raw.trim();
    if (value === (lastSavedRef.current[key] ?? '')) return;
    try {
      await updateDoc(doc(db, p.jobOrder(tenantId, jobOrderId)), {
        [key]: value,
        updatedAt: new Date(),
      });
      lastSavedRef.current[key] = value;
      setToast({ open: true, message: 'Saved', severity: 'success' });
    } catch (error: any) {
      setToast({ open: true, message: `Failed to save: ${error?.message || 'Permission denied'}`, severity: 'error' });
    }
  };

  const handleChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (timerRef.current[key]) clearTimeout(timerRef.current[key]!);
    timerRef.current[key] = setTimeout(() => {
      timerRef.current[key] = null;
      void saveField(key, value);
    }, 1000);
  };

  const handleBlur = (key: string) => {
    if (timerRef.current[key]) {
      clearTimeout(timerRef.current[key]!);
      timerRef.current[key] = null;
    }
    void saveField(key, values[key] ?? '');
  };

  useEffect(() => () => {
    Object.values(timerRef.current).forEach((t) => t && clearTimeout(t));
  }, []);

  const readiness: Array<{ label: string; done: boolean }> = [
    {
      label: 'On-site contact',
      done: Boolean((values.onsiteContactName ?? '').trim() && (values.onsiteContactPhone ?? '').trim()),
    },
    { label: 'First day', done: instructionHasContent(jobOrder?.staffInstructions?.firstDay) },
    { label: 'Parking', done: instructionHasContent(jobOrder?.staffInstructions?.parking) },
    { label: 'Check-in', done: instructionHasContent(jobOrder?.staffInstructions?.checkIn) },
    { label: 'Uniform', done: instructionHasContent(jobOrder?.staffInstructions?.uniform) },
  ];
  const doneCount = readiness.filter((r) => r.done).length;

  return (
    <Card sx={{ mb: 0 }}>
      <CardHeader
        avatar={<PersonPinCircleOutlinedIcon color="primary" />}
        title="Day-of logistics"
        subheader={`Day-of readiness ${doneCount}/${readiness.length} — what workers see on their day-of card`}
      />
      <CardContent sx={{ pt: 0 }}>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
          {readiness.map((r) => (
            <Chip
              key={r.label}
              size="small"
              label={r.label}
              color={r.done ? 'success' : 'default'}
              variant={r.done ? 'filled' : 'outlined'}
              icon={r.done ? <CheckCircleIcon /> : <RadioButtonUncheckedIcon />}
            />
          ))}
        </Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' }, gap: 2 }}>
          {CONTACT_FIELDS.map((f) => (
            <TextField
              key={f.key}
              label={f.label}
              placeholder={f.placeholder}
              value={values[f.key] ?? ''}
              onChange={(e) => handleChange(f.key, e.target.value)}
              onBlur={() => handleBlur(f.key)}
              size="small"
              fullWidth
            />
          ))}
        </Box>
      </CardContent>
      {toast && (
        <Snackbar
          open={toast.open}
          autoHideDuration={2000}
          onClose={() => setToast(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert severity={toast.severity} onClose={() => setToast(null)}>
            {toast.message}
          </Alert>
        </Snackbar>
      )}
    </Card>
  );
};

export default JobOrderDayOfLogisticsCard;
