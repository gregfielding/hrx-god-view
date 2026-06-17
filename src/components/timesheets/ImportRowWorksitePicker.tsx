/**
 * ImportRowWorksitePicker — set the worksite (work location) on a CSV-import
 * Grid row, mirroring the Import tab's worksite lookup: pick an Account, then a
 * Worksite under it. The pick is written to the entry via setImportEntryWorksite
 * so the W-2 import submit sends a PA/MD/etc. `overrideWorkLocationId` and Everee
 * validates the WC code against the right state.
 *
 * Account → worksite resolution mirrors CsvTimesheetImport: a child account is
 * scoped to its specifically-linked location(s); a standalone / national parent
 * exposes every location under its company.
 */

import React, { useEffect, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../../firebase';

interface WsAccount {
  id: string;
  name: string;
  isChild: boolean;
  companyIds: string[];
  linkedLocations: Array<{ companyId: string; locationId: string }>;
}
interface WsWorksite {
  worksiteId: string;
  companyId: string;
  worksiteName: string;
  address: { street: string; city: string; state: string; zip: string };
}

export interface ImportRowWorksitePickerProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  tenantId: string;
  entryId: string;
  currentWorksiteName?: string | null;
}

function toWsWorksite(id: string, companyId: string, d: any): WsWorksite {
  const a = d.address || {};
  // CRM locations sometimes store address as a single street string with
  // city/state/zip at the top level (e.g. CORT venues).
  const street = typeof d.address === 'string' ? d.address : String(a.street || d.street || '');
  return {
    worksiteId: id,
    companyId,
    worksiteName: String(d.nickname || d.name || 'Location'),
    address: {
      street,
      city: String(a.city || d.city || ''),
      state: String(a.state || d.state || ''),
      zip: String(a.zipCode || a.zip || d.zipCode || d.zip || ''),
    },
  };
}

const ImportRowWorksitePicker: React.FC<ImportRowWorksitePickerProps> = ({
  open,
  onClose,
  onSaved,
  tenantId,
  entryId,
  currentWorksiteName,
}) => {
  const [accounts, setAccounts] = useState<WsAccount[] | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [account, setAccount] = useState<WsAccount | null>(null);
  const [worksites, setWorksites] = useState<WsWorksite[]>([]);
  const [worksitesLoading, setWorksitesLoading] = useState(false);
  const [worksite, setWorksite] = useState<WsWorksite | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAccounts = async () => {
    setAccountsLoading(true);
    try {
      const snap = await getDocs(collection(db, 'tenants', tenantId, 'accounts'));
      const raw = snap.docs.map((d) => ({ id: d.id, data: d.data() as any }));
      const byId = new Map(raw.map((r) => [r.id, r.data]));
      const list: WsAccount[] = raw
        .filter(({ data }) => data.active !== false)
        .map(({ id, data }) => {
          const assoc = data.associations || {};
          let companyIds: string[] = Array.isArray(assoc.companyIds)
            ? assoc.companyIds.filter((x: any) => typeof x === 'string' && x.trim())
            : [];
          if (companyIds.length === 0 && data.parentAccountId) {
            const pa = byId.get(data.parentAccountId)?.associations;
            if (Array.isArray(pa?.companyIds)) {
              companyIds = pa.companyIds.filter((x: any) => typeof x === 'string' && x.trim());
            }
          }
          const linkedLocations = Array.isArray(assoc.locations)
            ? assoc.locations
                .filter((x: any) => x && typeof x.companyId === 'string' && typeof x.locationId === 'string')
                .map((x: any) => ({ companyId: String(x.companyId), locationId: String(x.locationId) }))
            : [];
          return {
            id,
            name: String(data.name || data.accountName || id),
            isChild: !!data.parentAccountId,
            companyIds,
            linkedLocations,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      setAccounts(list);
    } catch (err: any) {
      console.error('loadAccounts (worksite picker) failed:', err);
      setError(err?.message || 'Failed to load accounts.');
      setAccounts([]);
    } finally {
      setAccountsLoading(false);
    }
  };

  const loadWorksites = async (acc: WsAccount) => {
    setWorksitesLoading(true);
    setWorksites([]);
    setWorksite(null);
    try {
      const out: WsWorksite[] = [];
      if (acc.isChild && acc.linkedLocations.length > 0) {
        await Promise.all(
          acc.linkedLocations.map(async ({ companyId, locationId }) => {
            const s = await getDoc(doc(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations', locationId));
            if (s.exists()) out.push(toWsWorksite(s.id, companyId, s.data()));
          }),
        );
      } else {
        await Promise.all(
          acc.companyIds.map(async (companyId) => {
            const snap = await getDocs(collection(db, 'tenants', tenantId, 'crm_companies', companyId, 'locations'));
            snap.forEach((d) => out.push(toWsWorksite(d.id, companyId, d.data())));
          }),
        );
      }
      out.sort((a, b) => a.worksiteName.localeCompare(b.worksiteName));
      setWorksites(out);
      if (out.length === 1) setWorksite(out[0]);
    } catch (err: any) {
      console.error('loadWorksites (worksite picker) failed:', err);
      setError(err?.message || 'Failed to load worksites.');
    } finally {
      setWorksitesLoading(false);
    }
  };

  useEffect(() => {
    if (open && !accounts && !accountsLoading) void loadAccounts();
    if (!open) {
      setAccount(null);
      setWorksites([]);
      setWorksite(null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async () => {
    if (!worksite) return;
    setSaving(true);
    setError(null);
    try {
      const fn = httpsCallable<
        {
          tenantId: string;
          entryId: string;
          worksiteId: string;
          worksiteName: string;
          worksiteAddress: { street: string; city: string; state: string; zip: string };
        },
        { ok: true; workState: string }
      >(functions, 'setImportEntryWorksite', { timeout: 60000 });
      await fn({
        tenantId,
        entryId,
        worksiteId: worksite.worksiteId,
        worksiteName: worksite.worksiteName,
        worksiteAddress: worksite.address,
      });
      onSaved();
      onClose();
    } catch (err: any) {
      console.error('setImportEntryWorksite failed:', err);
      setError(err?.message || 'Failed to set the worksite.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle>Set worksite</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {currentWorksiteName && (
            <Typography variant="caption" color="text.secondary">
              Current: {currentWorksiteName}
            </Typography>
          )}
          <Typography variant="body2" color="text.secondary">
            Pick the account, then the worksite where this work happened. Everee validates the WC
            code against the worksite's state — set it so the submit uses the right state.
          </Typography>

          <Autocomplete
            options={accounts ?? []}
            loading={accountsLoading}
            getOptionLabel={(o) => o.name}
            value={account}
            onChange={(_, v) => {
              setAccount(v);
              setWorksites([]);
              setWorksite(null);
              if (v) void loadWorksites(v);
            }}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Account"
                size="small"
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {accountsLoading ? <CircularProgress size={16} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
          />

          <Autocomplete
            options={worksites}
            loading={worksitesLoading}
            disabled={!account}
            getOptionLabel={(o) =>
              `${o.worksiteName}${o.address.state ? ` — ${o.address.city || ''} ${o.address.state}`.trimEnd() : ''}`
            }
            value={worksite}
            onChange={(_, v) => setWorksite(v)}
            isOptionEqualToValue={(a, b) => a.worksiteId === b.worksiteId}
            renderInput={(params) => (
              <TextField
                {...params}
                label={account ? 'Worksite' : 'Pick an account first'}
                size="small"
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {worksitesLoading ? <CircularProgress size={16} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
          />

          {worksite && (
            <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
              <Typography variant="body2" fontWeight={600}>
                {worksite.worksiteName}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {[worksite.address.street, worksite.address.city, worksite.address.state, worksite.address.zip]
                  .filter(Boolean)
                  .join(', ')}
              </Typography>
            </Box>
          )}

          {error && (
            <Typography variant="caption" color="error.main">
              {error}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving} sx={{ textTransform: 'none' }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={save}
          disabled={!worksite || saving}
          sx={{ textTransform: 'none' }}
        >
          {saving ? 'Saving…' : 'Use worksite'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ImportRowWorksitePicker;
