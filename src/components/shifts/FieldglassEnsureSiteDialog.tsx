/**
 * FieldglassEnsureSiteDialog — opens from a Fieldglass row's "Create
 * site + account" button on /shifts/log.
 *
 * Runs the `fieldglassEnsureSite` callable in dry-run on open and shows
 * the resolution plan layer by layer: site directory match (Site Code +
 * city/state/zip), CRM location (reuse or create), child account (reuse,
 * link, or create). When a location will be created, the browser
 * geocodes "{site name}, {city}, {state} {zip}" with the existing Maps
 * key to prefill the street address — editable before executing, since
 * geocoding a cafeteria inside a hospital is only usually right.
 *
 * Execute re-runs the same chain with writes on. Everything is
 * idempotent server-side, so a double-click or a re-open can't create
 * duplicates.
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
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { CheckCircleOutline, AddCircleOutline, LinkOutlined } from '@mui/icons-material';

import { functions } from '../../firebase';
import {
  callFieldglassEnsureSite,
  type FieldglassEnsureSiteResult,
  type FieldglassLayerStatus,
} from '../../services/fieldglassEnsureSiteCallable';
import { geocodeAddressDetailed } from '../../utils/geocodeAddress';
import { formatFirebaseHttpsError } from '../../utils/firebaseHttpsErrors';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (result: FieldglassEnsureSiteResult) => void;
  tenantId: string;
  /** Site name from the Fieldglass email — editable in the dialog. */
  initialSiteName: string;
  /** Review-queue row to stamp with the resolved ids. */
  requestId?: string;
}

interface AddressState {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  lat?: number;
  lng?: number;
}

const EMPTY_ADDRESS: AddressState = { street: '', city: '', state: '', zipCode: '' };

function layerChip(status: FieldglassLayerStatus): React.ReactElement {
  switch (status) {
    case 'exists':
      return <Chip size="small" color="success" icon={<CheckCircleOutline />} label="Already exists — reuse" />;
    case 'created':
      return <Chip size="small" color="success" icon={<AddCircleOutline />} label="Created" />;
    case 'would_create':
      return <Chip size="small" color="warning" icon={<AddCircleOutline />} label="Will create" />;
    case 'would_link':
      return <Chip size="small" color="warning" icon={<LinkOutlined />} label="Will link to location" />;
    case 'linked':
      return <Chip size="small" color="success" icon={<LinkOutlined />} label="Linked" />;
  }
}

const FieldglassEnsureSiteDialog: React.FC<Props> = ({
  open,
  onClose,
  onSuccess,
  tenantId,
  initialSiteName,
  requestId,
}) => {
  const [siteName, setSiteName] = useState(initialSiteName);
  const [siteCode, setSiteCode] = useState<string>('');
  const [plan, setPlan] = useState<FieldglassEnsureSiteResult | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState<AddressState>(EMPTY_ADDRESS);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeNote, setGeocodeNote] = useState<string | null>(null);
  /** Guards the one-shot auto-geocode per plan load. */
  const geocodedForPlan = useRef<string | null>(null);

  const runDryRun = useCallback(
    async (name: string, code: string): Promise<void> => {
      if (!name.trim()) return;
      setPlanLoading(true);
      setError(null);
      try {
        const { data } = await callFieldglassEnsureSite(functions, {
          tenantId,
          siteName: name.trim(),
          ...(code ? { siteCode: code } : {}),
          ...(requestId ? { requestId } : {}),
          execute: false,
        });
        setPlan(data);
      } catch (e) {
        setPlan(null);
        setError(formatFirebaseHttpsError(e));
      } finally {
        setPlanLoading(false);
      }
    },
    [tenantId, requestId],
  );

  // Reset + initial dry-run when the dialog opens.
  useEffect(() => {
    if (!open) return;
    setSiteName(initialSiteName);
    setSiteCode('');
    setPlan(null);
    setError(null);
    setAddress(EMPTY_ADDRESS);
    setGeocodeNote(null);
    geocodedForPlan.current = null;
    void runDryRun(initialSiteName, '');
  }, [open, initialSiteName, runDryRun]);

  const directoryRow =
    plan?.directory.status === 'exact' ? plan.directory.row : undefined;

  const geocode = useCallback(async (): Promise<void> => {
    const cityStateZip = directoryRow
      ? `${directoryRow.city}, ${directoryRow.state} ${directoryRow.zip}`
      : [address.city, address.state, address.zipCode].filter(Boolean).join(', ');
    const query = `${siteName.trim()}${cityStateZip ? `, ${cityStateZip}` : ''}`;
    setGeocoding(true);
    setGeocodeNote(null);
    try {
      const d = await geocodeAddressDetailed(query);
      setAddress({
        street: d.street ?? '',
        city: d.city ?? directoryRow?.city ?? '',
        state: d.stateCode ?? d.state ?? directoryRow?.state ?? '',
        zipCode: d.zip ?? directoryRow?.zip ?? '',
        lat: d.lat,
        lng: d.lng,
      });
      setGeocodeNote(d.formattedAddress ? `Google: ${d.formattedAddress}` : null);
    } catch (e) {
      setGeocodeNote(
        `Address lookup failed — enter the street manually. (${e instanceof Error ? e.message : String(e)})`,
      );
      // Still seed city/state/zip from the directory so the recruiter
      // only has to type the street.
      if (directoryRow) {
        setAddress((a) => ({
          ...a,
          city: a.city || directoryRow.city,
          state: a.state || directoryRow.state,
          zipCode: a.zipCode || directoryRow.zip,
        }));
      }
    } finally {
      setGeocoding(false);
    }
  }, [siteName, directoryRow, address.city, address.state, address.zipCode]);

  // Auto-geocode once when the plan says we'll create a location.
  useEffect(() => {
    if (!plan || plan.location.status !== 'would_create') return;
    const key = `${siteName}|${directoryRow?.siteCode ?? ''}`;
    if (geocodedForPlan.current === key) return;
    geocodedForPlan.current = key;
    void geocode();
  }, [plan, siteName, directoryRow, geocode]);

  const ambiguous = plan?.directory.status === 'ambiguous';
  const willCreateLocation = plan?.location.status === 'would_create';
  const canExecute =
    !!plan &&
    !planLoading &&
    !executing &&
    !ambiguous &&
    // Creating a location without a street is allowed but strongly
    // discouraged — require an explicit street OR directory city/state.
    (!willCreateLocation || !!address.city.trim());

  const handlePickCandidate = (code: string): void => {
    setSiteCode(code);
    geocodedForPlan.current = null;
    void runDryRun(siteName, code);
  };

  const handleExecute = async (): Promise<void> => {
    if (!plan) return;
    setExecuting(true);
    setError(null);
    try {
      const { data } = await callFieldglassEnsureSite(functions, {
        tenantId,
        siteName: siteName.trim(),
        ...(siteCode ? { siteCode } : {}),
        ...(requestId ? { requestId } : {}),
        execute: true,
        ...(willCreateLocation
          ? {
              address: {
                street: address.street.trim(),
                city: address.city.trim(),
                state: address.state.trim(),
                zipCode: address.zipCode.trim(),
                ...(address.lat != null ? { lat: address.lat } : {}),
                ...(address.lng != null ? { lng: address.lng } : {}),
              },
            }
          : {}),
      });
      onSuccess(data);
      onClose();
    } catch (e) {
      setError(formatFirebaseHttpsError(e));
    } finally {
      setExecuting(false);
    }
  };

  return (
    <Dialog open={open} onClose={executing ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Create site + account</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Ensures the full chain for this Sodexo site: CRM location → child
            account → linkage. Every layer checks for an existing record
            first, so this is safe to run on sites you already work.
          </Typography>

          <Stack direction="row" spacing={1}>
            <TextField
              label="Site name (from email)"
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              size="small"
              fullWidth
              disabled={planLoading || executing}
            />
            <Button
              variant="outlined"
              size="small"
              onClick={() => {
                setSiteCode('');
                geocodedForPlan.current = null;
                void runDryRun(siteName, '');
              }}
              disabled={planLoading || executing || !siteName.trim()}
              sx={{ flexShrink: 0 }}
            >
              Re-check
            </Button>
          </Stack>

          {planLoading && (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={16} />
              <Typography variant="body2" color="text.secondary">
                Checking directory, locations, and accounts…
              </Typography>
            </Stack>
          )}

          {error && <Alert severity="error">{error}</Alert>}

          {plan?.alreadyResolved && (
            <Alert severity="info">
              This order was already resolved (location{' '}
              <code>{plan.alreadyResolved.locationId.slice(0, 8)}…</code>, account{' '}
              <code>{plan.alreadyResolved.childAccountId.slice(0, 8)}…</code>). Running again is
              harmless — it reuses what exists.
            </Alert>
          )}

          {plan && !planLoading && (
            <>
              {/* Layer 1 — directory */}
              <Box sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Typography variant="caption" color="text.secondary" fontWeight={700}>
                  1 · SODEXO SITE DIRECTORY
                </Typography>
                {plan.directory.status === 'exact' && directoryRow && (
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    <strong>{directoryRow.siteName}</strong> — code{' '}
                    <code>{directoryRow.siteCode}</code> · {directoryRow.city},{' '}
                    {directoryRow.state} {directoryRow.zip}
                  </Typography>
                )}
                {plan.directory.status === 'ambiguous' && (
                  <Stack spacing={1} sx={{ mt: 0.5 }}>
                    <Typography variant="body2" color="warning.main">
                      {plan.directory.candidates?.length} directory sites share this name — pick
                      the right one:
                    </Typography>
                    <TextField
                      select
                      size="small"
                      label="Directory site"
                      value={siteCode}
                      onChange={(e) => handlePickCandidate(e.target.value)}
                      disabled={executing}
                    >
                      {(plan.directory.candidates ?? []).map((c) => (
                        <MenuItem key={c.siteCode} value={c.siteCode}>
                          {c.siteCode} — {c.city}, {c.state} {c.zip}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Stack>
                )}
                {plan.directory.status === 'not_in_directory' && (
                  <Typography variant="body2" color="warning.main" sx={{ mt: 0.5 }}>
                    Not in the site directory snapshot (Sodexo adds sites over time). You can
                    still proceed — fill in the address below.
                  </Typography>
                )}
              </Box>

              {/* Layer 2 — CRM location */}
              <Box sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="caption" color="text.secondary" fontWeight={700}>
                    2 · CRM LOCATION (on Sodexo company)
                  </Typography>
                  {layerChip(plan.location.status)}
                </Stack>
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  {plan.location.name}
                  {plan.location.codeBackfilled && (
                    <Typography component="span" variant="caption" color="text.secondary">
                      {' '}
                      (site code will be stamped on the existing location)
                    </Typography>
                  )}
                </Typography>
                {willCreateLocation && (
                  <Stack spacing={1} sx={{ mt: 1 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <TextField
                        label="Street address"
                        value={address.street}
                        onChange={(e) => setAddress((a) => ({ ...a, street: e.target.value }))}
                        size="small"
                        fullWidth
                        disabled={executing}
                      />
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => void geocode()}
                        disabled={geocoding || executing}
                        sx={{ flexShrink: 0 }}
                      >
                        {geocoding ? <CircularProgress size={16} /> : 'Look up'}
                      </Button>
                    </Stack>
                    <Stack direction="row" spacing={1}>
                      <TextField
                        label="City"
                        value={address.city}
                        onChange={(e) => setAddress((a) => ({ ...a, city: e.target.value }))}
                        size="small"
                        fullWidth
                        disabled={executing}
                      />
                      <TextField
                        label="State"
                        value={address.state}
                        onChange={(e) => setAddress((a) => ({ ...a, state: e.target.value }))}
                        size="small"
                        sx={{ width: 110 }}
                        disabled={executing}
                      />
                      <TextField
                        label="ZIP"
                        value={address.zipCode}
                        onChange={(e) => setAddress((a) => ({ ...a, zipCode: e.target.value }))}
                        size="small"
                        sx={{ width: 130 }}
                        disabled={executing}
                      />
                    </Stack>
                    {geocodeNote && (
                      <Typography variant="caption" color="text.secondary">
                        {geocodeNote}
                      </Typography>
                    )}
                  </Stack>
                )}
              </Box>

              {/* Layer 3 — child account */}
              <Box sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="caption" color="text.secondary" fontWeight={700}>
                    3 · CHILD ACCOUNT
                  </Typography>
                  {layerChip(plan.childAccount.status)}
                </Stack>
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  {plan.childAccount.name}
                  {plan.childAccount.matchedBy === 'name' && (
                    <Typography component="span" variant="caption" color="text.secondary">
                      {' '}
                      (matched by name — legacy account)
                    </Typography>
                  )}
                </Typography>
              </Box>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={executing}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleExecute}
          disabled={!canExecute}
          startIcon={executing ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {executing ? 'Creating…' : 'Create / link'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FieldglassEnsureSiteDialog;
