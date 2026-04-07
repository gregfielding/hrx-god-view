/**
 * Temporary demo/QA: full AccuSource screening fields + raw create snapshot.
 * Remove or hide after sandbox validation.
 */
import React, { useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Collapse,
  Link,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { BackgroundCheckRecord } from '../../types/backgroundCheck';
import { Timestamp } from 'firebase/firestore';

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

function display(v: unknown): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

/** Shallow scan for http(s) strings on common vendor keys (snapshot + doc). */
function collectReportUrlHints(rec: Record<string, unknown>): string[] {
  const seen = new Set<string>();
  const add = (label: string, s: string) => {
    const t = s.trim();
    if (t.startsWith('http') && t.length < 2500) seen.add(`${label}: ${t}`);
  };

  const snap = rec.lastProviderProfileSnapshot;
  if (snap && typeof snap === 'object') {
    const walk = (obj: unknown, depth: number) => {
      if (depth > 6 || obj == null) return;
      if (typeof obj === 'string' && /^https?:\/\//i.test(obj)) {
        add('snapshot', obj);
        return;
      }
      if (typeof obj !== 'object') return;
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        const kl = k.toLowerCase();
        if (typeof v === 'string' && /^https?:\/\//i.test(v) && /url|link|report|href/i.test(kl)) {
          add(k, v);
        } else if (v && typeof v === 'object') walk(v, depth + 1);
      }
    };
    walk(snap, 0);
  }

  for (const key of [
    'finalReportUrl',
    'drugReportUrl',
    'final_report_url',
    'drug_report_url',
    'providerFinalReportUrl',
    'providerDrugReportUrl',
  ]) {
    const v = rec[key];
    if (typeof v === 'string' && v.startsWith('http')) add(key, v);
  }

  return Array.from(seen);
}

function snapshotJson(snapshot: unknown): string {
  if (snapshot === undefined || snapshot === null) return '— (no snapshot stored yet)';
  try {
    return JSON.stringify(snapshot, null, 2);
  } catch {
    return String(snapshot);
  }
}

const KV: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <Box>
    <Typography variant="caption" color="text.secondary" display="block">
      {label}
    </Typography>
    <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
      {value}
    </Typography>
  </Box>
);

export interface AccusourceScreeningDebugSectionProps {
  record: BackgroundCheckRecord;
}

const AccusourceScreeningDebugSection: React.FC<AccusourceScreeningDebugSectionProps> = ({ record }) => {
  const rec = record as BackgroundCheckRecord & Record<string, unknown>;
  const [jsonOpen, setJsonOpen] = useState(false);

  const urlHints = useMemo(
    () => collectReportUrlHints(rec as Record<string, unknown>),
    [rec]
  );

  const packageLine = useMemo(() => {
    const name = record.requestedPackageName?.trim();
    const id = record.requestedPackageId != null ? String(record.requestedPackageId) : '';
    if (name && id) return `${name} · id ${id}`;
    if (name) return name;
    if (id) return `id ${id}`;
    return '—';
  }, [record.requestedPackageName, record.requestedPackageId]);

  const statusLine = useMemo(() => {
    const h = record.hrxStatus || '—';
    const p = record.providerStatus || '—';
    return `${h} (HRX) · ${p} (provider)`;
  }, [record.hrxStatus, record.providerStatus]);

  const webhookSummary =
    record.lastWebhookType || record.lastWebhookAt
      ? `${record.lastWebhookType || '—'} @ ${formatTs(record.lastWebhookAt)}`
      : '—';

  const lastService =
    record.lastServiceComponent?.serviceName || record.lastServiceComponent?.status
      ? `${record.lastServiceComponent?.serviceName || '—'}: ${record.lastServiceComponent?.status || '—'}`
      : '—';

  return (
    <Accordion disableGutters elevation={0} sx={{ bgcolor: 'transparent', '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0, minHeight: 40, '& .MuiAccordionSummary-content': { my: 0.5 } }}>
        <Typography variant="caption" color="text.secondary" fontWeight={600}>
          AccuSource Debug Details
        </Typography>
        <Typography variant="caption" color="warning.main" sx={{ ml: 1 }}>
          (temporary — demo / QA)
        </Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 0, pt: 0 }}>
        <Alert severity="info" sx={{ mb: 2, py: 0.5 }}>
          For sandbox validation only. Remove or gate off after production approval.
        </Alert>

        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Key fields
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
            gap: 1.5,
            mb: 2,
          }}
        >
          <KV label="Package" value={packageLine} />
          <KV label="Profile ID" value={display(record.providerProfileId)} />
          <KV label="Profile number" value={display(record.providerProfileNumber)} />
          <KV label="Subject ID" value={display(record.providerSubjectId)} />
          <KV label="Client ID" value={display(record.providerClientId || record.clientId)} />
          <KV label="Environment" value={display(record.providerEnvironment)} />
          <KV label="Status" value={statusLine} />
        </Box>

        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Timestamps, flags & webhook summary
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
            gap: 1.5,
            mb: 2,
          }}
        >
          <KV label="createdAt" value={formatTs(record.createdAt)} />
          <KV label="updatedAt" value={formatTs(record.updatedAt)} />
          <KV label="lastSyncAt" value={formatTs(rec.lastSyncAt)} />
          <KV label="Last webhook" value={webhookSummary} />
          <KV label="Last service component" value={lastService} />
          <KV label="finalReportReady" value={display(record.finalReportReady)} />
          <KV label="drugReportReady" value={display(record.drugReportReady)} />
          <KV label="profileCompleted" value={display(record.profileCompleted)} />
          <KV label="orderCompleted" value={display(record.orderCompleted)} />
          <KV label="orderMode" value={display(record.orderMode)} />
          <KV label="simulated order" value={display(record.screeningOrderSimulated)} />
          <KV
            label="applicantPortalLink"
            value={
              record.applicantPortalLink ? (
                <Link href={record.applicantPortalLink} target="_blank" rel="noopener noreferrer">
                  Open portal
                </Link>
              ) : (
                '—'
              )
            }
          />
          <KV label="syncError" value={record.syncError ? String(record.syncError) : '—'} />
          <KV label="Firestore doc id" value={record.id} />
        </Box>

        {urlHints.length > 0 ? (
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
              URL-like fields (from doc / snapshot scan)
            </Typography>
            {urlHints.map((line) => (
              <Typography key={line} variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem', wordBreak: 'break-all' }}>
                {line}
              </Typography>
            ))}
          </Box>
        ) : null}

        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          Raw provider snapshot
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
          From last successful create response (pretty JSON). Toggle to expand.
        </Typography>
        <Box
          component="button"
          type="button"
          onClick={() => setJsonOpen((o) => !o)}
          sx={{
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            p: 1,
            width: '100%',
            textAlign: 'left',
            cursor: 'pointer',
            bgcolor: 'action.hover',
            mb: 0,
          }}
        >
          <Typography variant="caption" fontWeight={600}>
            {jsonOpen ? '▼' : '▶'} JSON viewer
          </Typography>
        </Box>
        <Collapse in={jsonOpen}>
          <Box
            component="pre"
            sx={{
              m: 0,
              mt: 0.5,
              p: 1.5,
              maxHeight: 320,
              overflow: 'auto',
              bgcolor: 'grey.100',
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              fontSize: '0.7rem',
              fontFamily: 'ui-monospace, monospace',
            }}
          >
            {snapshotJson(rec.lastProviderProfileSnapshot)}
          </Box>
        </Collapse>
      </AccordionDetails>
    </Accordion>
  );
};

export default AccusourceScreeningDebugSection;
