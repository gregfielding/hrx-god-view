import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '../../../../contexts/AuthContext';
import { db, functions } from '../../../../firebase';
import { p } from '../../../../data/firestorePaths';
import { AccusourcePackageSelector } from '../../../../components/recruiter/AccusourcePackageSelector';
import { useAccusourceCatalog } from '../../../../hooks/useAccusourceCatalog';
import { formatFirebaseHttpsError } from '../../../../utils/firebaseHttpsErrors';
import { canAccusourceAdminFromUserDoc } from '../backgroundsComplianceModel';
import type { EmploymentEntityKey } from './employmentV2Types';
import { EMPLOYMENT_ENTITY_KEYS, resolveEntityFirestoreIdForTab } from '../../../../utils/employmentEntityPresentation';

export interface StartOnCallEmploymentDialogProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  profileUserId: string;
  /** Current entity tab — pre-select matching hiring entity when possible. */
  entityKey: EmploymentEntityKey;
  onSuccess: () => void;
}

type EntityOption = { id: string; name: string };

const startOnCallFn = httpsCallable<
  {
    tenantId: string;
    userId: string;
    entityId: string;
    /** Omitted: server uses each entity’s Worker type from Tenant → Entities (e.g. C1 Events = 1099, C1 Select / Workforce = W2). */
    workerType?: 'w2' | '1099' | 'entity_default';
    screeningPackageId?: string | null;
    screeningPackageName?: string | null;
    /** À la carte service IDs; same partial-profile request as the package. */
    screeningRequestedServiceIds?: string[] | null;
    note?: string | null;
  },
  { pipelineId: string; created: boolean; entityKey: string; hiringEntityId: string; entityName: string }
>(functions, 'startOnCallOnboarding');

const syncAccusourcePackageCatalog = httpsCallable(functions, 'syncAccusourcePackageCatalog');

const StartOnCallEmploymentDialog: React.FC<StartOnCallEmploymentDialogProps> = ({
  open,
  onClose,
  tenantId,
  profileUserId,
  entityKey,
  onSuccess,
}) => {
  const { user } = useAuth();
  const [viewerUserDoc, setViewerUserDoc] = useState<Record<string, unknown> | null | undefined>(undefined);
  const [entities, setEntities] = useState<EntityOption[]>([]);
  const [loadingEntities, setLoadingEntities] = useState(false);
  const [entityId, setEntityId] = useState('');
  const [packageId, setPackageId] = useState('');
  const [packageName, setPackageName] = useState('');
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogSyncing, setCatalogSyncing] = useState(false);
  const [catalogSyncMessage, setCatalogSyncMessage] = useState<string | null>(null);
  const { catalog: accusourceCatalog, loading: catalogLoading, refetch: refetchAccusourceCatalog } =
    useAccusourceCatalog();
  /** Synchronous guard — state updates async, so double-clicks could otherwise fire two callable invocations. */
  const submitInFlightRef = useRef(false);

  const canAccusourceAdmin = useMemo(() => {
    if (viewerUserDoc === undefined) return false;
    return canAccusourceAdminFromUserDoc(viewerUserDoc, tenantId);
  }, [viewerUserDoc, tenantId]);

  useEffect(() => {
    const vid = user?.uid;
    if (!open || !vid) {
      if (!open) setViewerUserDoc(undefined);
      return;
    }
    let cancelled = false;
    getDoc(doc(db, 'users', vid))
      .then((s) => {
        if (cancelled) return;
        setViewerUserDoc(s.exists() ? (s.data() as Record<string, unknown>) : null);
      })
      .catch(() => {
        if (!cancelled) setViewerUserDoc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, user?.uid]);

  const handleRefreshAccusourceCatalog = async () => {
    if (!canAccusourceAdmin) return;
    setCatalogSyncing(true);
    setCatalogSyncMessage(null);
    try {
      await syncAccusourcePackageCatalog({ tenantId: tenantId || undefined });
      const read = await refetchAccusourceCatalog();
      if (read.ok === false) {
        setCatalogSyncMessage(`Synced on the server but could not re-read catalog: ${read.error}`);
      }
    } catch (e: unknown) {
      setCatalogSyncMessage(formatFirebaseHttpsError(e));
    } finally {
      setCatalogSyncing(false);
    }
  };

  useEffect(() => {
    if (!open) {
      submitInFlightRef.current = false;
      setSubmitting(false);
    }
  }, [open]);

  const loadEntities = useCallback(async () => {
    setLoadingEntities(true);
    try {
      const snap = await getDocs(collection(db, p.entities(tenantId)));
      const list: EntityOption[] = snap.docs.map((d) => {
        const data = d.data() as { name?: string };
        return { id: d.id, name: String(data.name || d.id) };
      });
      list.sort((a, b) => a.name.localeCompare(b.name));
      setEntities(list);
    } catch {
      setEntities([]);
    } finally {
      setLoadingEntities(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (!open) return;
    void loadEntities();
    void refetchAccusourceCatalog();
  }, [open, loadEntities, refetchAccusourceCatalog]);

  useEffect(() => {
    if (!open) return;
    setPackageId('');
    setPackageName('');
    setSelectedServiceIds([]);
    setCatalogSyncMessage(null);
  }, [open]);

  useEffect(() => {
    if (!open || entities.length === 0) return;
    const brief = entities.map((e) => ({ id: e.id, name: e.name, entityCode: '' }));
    const resolved = resolveEntityFirestoreIdForTab(entityKey, brief, null);
    if (resolved) {
      setEntityId(resolved);
    } else {
      setEntityId((prev) => prev || entities[0]?.id || '');
    }
  }, [open, entities, entityKey]);

  const handleSubmit = async () => {
    if (submitInFlightRef.current) return;
    setError(null);
    if (!entityId.trim()) {
      setError('Select a hiring entity.');
      return;
    }
    submitInFlightRef.current = true;
    setSubmitting(true);
    try {
      await startOnCallFn({
        tenantId,
        userId: profileUserId,
        entityId: entityId.trim(),
        screeningPackageId: packageId.trim() || null,
        screeningPackageName: packageName.trim() || null,
        screeningRequestedServiceIds: selectedServiceIds.length > 0 ? selectedServiceIds : null,
        note: note.trim() || null,
      });
      onClose();
    } catch (e: unknown) {
      const fe = e as { message?: string; code?: string };
      const raw = typeof fe?.message === 'string' ? fe.message.trim() : '';
      const msg =
        raw && raw !== 'INTERNAL'
          ? raw
          : typeof fe?.code === 'string'
            ? `${fe.code.replace(/^functions\//, '')}: request failed`
            : 'Request failed';
      setError(msg);
    } finally {
      submitInFlightRef.current = false;
      // Always reload employment overview after a round-trip: server may have written (messages sent) even if
      // the client sees an error (timeout / flaky HTTPS). Also heals teammates blocked on a single restricted read during refetch.
      void onSuccess();
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Start on-call employment</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Opens entity employment and the standard onboarding pipeline for this worker <strong>without</strong> an
            assignment — for labor pool / pre-placement hiring. Configure automation for trigger{' '}
            <Typography component="span" variant="body2" sx={{ fontFamily: 'monospace' }}>
              on_call_employment_started
            </Typography>{' '}
            and message type On-call employment started if you want templated notifications.
          </Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <FormControl fullWidth size="small" disabled={loadingEntities || submitting}>
            <InputLabel id="oncall-entity-label">Hiring entity</InputLabel>
            <Select
              labelId="oncall-entity-label"
              label="Hiring entity"
              value={entityId}
              onChange={(e) => setEntityId(String(e.target.value))}
            >
              {entities.map((e) => (
                <MenuItem key={e.id} value={e.id}>
                  {e.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {loadingEntities ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
              <CircularProgress size={24} />
            </Box>
          ) : null}
          <Typography variant="caption" color="text.secondary" display="block">
            W-2 vs 1099 follows the <strong>Worker type</strong> saved on the hiring entity (Tenant → Entities → Overview),
            not a choice here.
          </Typography>
          {catalogSyncMessage ? (
            <Alert severity="warning" onClose={() => setCatalogSyncMessage(null)}>
              {catalogSyncMessage}
            </Alert>
          ) : null}
          <AccusourcePackageSelector
            catalog={accusourceCatalog}
            catalogLoading={catalogLoading || catalogSyncing}
            packageId={packageId}
            packageName={packageName}
            onChange={(next) => {
              setPackageId(next.packageId);
              setPackageName(next.packageName);
            }}
            selectedServiceIds={selectedServiceIds}
            onServicesChange={setSelectedServiceIds}
            showCatalogMeta
            showRefresh
            onRefreshCatalog={() => void handleRefreshAccusourceCatalog()}
            catalogRefreshing={catalogSyncing}
            canRefreshCatalog={canAccusourceAdmin}
            emptyCatalogSeverity="warning"
            selectLabel="Screening package"
            emptyMenuLabel="None (optional)"
            packageNameFieldLabel="Package name (from selection)"
            description="Same synced catalog as User → Backgrounds → Order screening (AccuSource). Choose a package, optional add-on services, or à la carte services only (no package); leave all empty to skip screening."
          />
          <TextField
            label="Internal note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            size="small"
            fullWidth
            multiline
            minRows={2}
            disabled={submitting}
          />
          <Typography variant="caption" color="text.secondary">
            Entity tabs: {EMPLOYMENT_ENTITY_KEYS.join(', ')} — pick the legal entity that matches this worker&apos;s
            hiring path.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => void handleSubmit()}
          disabled={submitting || catalogSyncing || !entityId}
          aria-busy={submitting}
        >
          {submitting ? (
            <>
              <CircularProgress size={20} sx={{ mr: 1 }} color="inherit" />
              Starting…
            </>
          ) : (
            'Start on-call employment'
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default StartOnCallEmploymentDialog;
