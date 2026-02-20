/**
 * Settings → Documents (HRX Signatures Spec Phase S0).
 * Tabs: Templates, Bundles, Envelopes.
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Tabs,
  Tab,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Alert,
} from '@mui/material';
import { collection, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../../firebase';
import { p } from '../../../data/firestorePaths';
import { useAuth } from '../../../contexts/AuthContext';
import type { DocumentTemplate, DocumentBundle } from '../../../types/signatures';

type DocSubTab = 'templates' | 'bundles' | 'envelopes';

const SignaturesDocumentsPage: React.FC = () => {
  const { activeTenant } = useAuth();
  const tenantId = activeTenant?.id ?? '';
  const [subTab, setSubTab] = useState<DocSubTab>('templates');
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [bundles, setBundles] = useState<DocumentBundle[]>([]);
  const [envelopes, setEnvelopes] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [envelopesLoading, setEnvelopesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [templatesSnap, bundlesSnap] = await Promise.all([
          getDocs(collection(db, p.documentTemplates(tenantId))),
          getDocs(collection(db, p.documentBundles(tenantId))),
        ]);
        setTemplates(
          templatesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as DocumentTemplate))
        );
        setBundles(
          bundlesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as DocumentBundle))
        );
      } catch (e) {
        setError((e as Error)?.message ?? 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId || subTab !== 'envelopes') return;
    setEnvelopesLoading(true);
    const listFn = httpsCallable<{ tenantId: string }, { envelopes: Record<string, unknown>[] }>(
      functions,
      'signatureAdminListEnvelopes'
    );
    listFn({ tenantId })
      .then((res) => setEnvelopes(res.data?.envelopes ?? []))
      .catch((e) => setError((e as Error)?.message ?? 'Failed to load envelopes'))
      .finally(() => setEnvelopesLoading(false));
  }, [tenantId, subTab]);

  if (!tenantId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">Select a tenant to manage documents.</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ px: { xs: 2, md: 3 }, py: 2 }}>
      <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
        Documents &amp; Signatures
      </Typography>
      <Tabs value={subTab} onChange={(_, v) => setSubTab(v)} sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tab label="Templates" value="templates" />
        <Tab label="Bundles" value="bundles" />
        <Tab label="Envelopes" value="envelopes" />
      </Tabs>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {(subTab === 'templates' || subTab === 'bundles') && loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {subTab === 'templates' && !loading && (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Document templates (HRX-uploaded PDFs). Upload and version templates in a future update.
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Category</TableCell>
                  <TableCell>Version</TableCell>
                  <TableCell>Active</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {templates.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} align="center" sx={{ py: 3 }} color="text.secondary">
                      No templates yet. Add templates when upload is available.
                    </TableCell>
                  </TableRow>
                ) : (
                  templates.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>{t.name}</TableCell>
                      <TableCell>{t.category}</TableCell>
                      <TableCell>{t.version}</TableCell>
                      <TableCell>{t.active ? 'Yes' : 'No'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {subTab === 'bundles' && !loading && (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Document bundles (workflow packs). Assemble templates and signer roles.
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell>Items</TableCell>
                  <TableCell>Active</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {bundles.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} align="center" sx={{ py: 3 }} color="text.secondary">
                      No bundles yet. Create bundles when templates exist.
                    </TableCell>
                  </TableRow>
                ) : (
                  bundles.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>{b.name}</TableCell>
                      <TableCell>{b.description ?? '—'}</TableCell>
                      <TableCell>{Array.isArray(b.items) ? b.items.length : 0}</TableCell>
                      <TableCell>{b.active ? 'Yes' : 'No'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {subTab === 'envelopes' && (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Signature envelopes (stub mode: create via callable; list here).
          </Typography>
          {envelopesLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress />
            </Box>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Envelope ID</TableCell>
                    <TableCell>Entity</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Purpose</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {envelopes.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} align="center" sx={{ py: 3 }} color="text.secondary">
                        No envelopes yet. Create envelopes via signatureCreateEnvelope callable.
                      </TableCell>
                    </TableRow>
                  ) : (
                    envelopes.map((env: Record<string, unknown>) => (
                      <TableRow key={String(env.id)}>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                          {String(env.id).slice(0, 8)}…
                        </TableCell>
                        <TableCell>{String(env.entityId ?? '—')}</TableCell>
                        <TableCell>{String(env.status ?? '—')}</TableCell>
                        <TableCell>{String(env.purpose ?? '—')}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      )}
    </Box>
  );
};

export default SignaturesDocumentsPage;
