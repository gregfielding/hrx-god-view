/**
 * AccuSource screening package: synced Firestore catalog (`integrations_accusource/catalog`).
 * Use controlled `catalog` + `catalogLoading` from a parent when the parent already loads the doc;
 * otherwise the component loads the catalog via `useAccusourceCatalog`.
 */
import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import Autocomplete from '@mui/material/Autocomplete';
import RefreshIcon from '@mui/icons-material/Refresh';
import type { Timestamp } from 'firebase/firestore';
import { useAccusourceCatalog } from '../../hooks/useAccusourceCatalog';
import type { AccusourceCatalogDocument, AccusourceCatalogService } from '../../types/accusourceCatalog';
import { findAccusourcePackageById, isAccusourcePackageIdMissingFromCatalog } from '../../utils/accusourceCatalogHelpers';

function formatCatalogLastSyncedAt(catalog: AccusourceCatalogDocument | null): string {
  const ts = catalog?.lastSyncedAt;
  if (ts == null) return '—';
  try {
    const d =
      typeof (ts as Timestamp).toDate === 'function'
        ? (ts as Timestamp).toDate()
        : new Date((ts as { seconds?: number }).seconds! * 1000);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

function foundInCatalogLabel(
  catalog: AccusourceCatalogDocument | null | undefined,
  packageId: string,
  loading: boolean
): string {
  const id = String(packageId || '').trim();
  if (!id) return '—';
  if (loading) return '…';
  const pkgs = catalog?.packages;
  if (!pkgs?.length) return 'Unknown (catalog empty)';
  return pkgs.some((p) => p.id === id) ? 'Yes' : 'No';
}

export interface AccusourcePackageSelectorBaseProps {
  packageId: string;
  packageName: string;
  onChange: (next: { packageId: string; packageName: string }) => void;
  disabled?: boolean;
  /** Shown under the optional helper Typography */
  helperText?: string;

  catalog: AccusourceCatalogDocument | null;
  catalogLoading: boolean;

  /** Multi-select for add-on services (exact catalog IDs). */
  selectedServiceIds?: string[];
  onServicesChange?: (ids: string[]) => void;

  showDiagnostics?: boolean;
  /** Sync chips + last synced line */
  showCatalogMeta?: boolean;
  showSyncErrorAlert?: boolean;

  showRefresh?: boolean;
  onRefreshCatalog?: () => void | Promise<void>;
  catalogRefreshing?: boolean;
  canRefreshCatalog?: boolean;

  emptyMenuLabel?: React.ReactNode;
  selectLabel?: string;
  packageNameHelperText?: string;
  description?: React.ReactNode;

  /** When catalog is empty: modal uses warning, forms use info */
  emptyCatalogSeverity?: 'info' | 'warning';

  /** "None" vs "Select a package…" */
  emptyCatalogMessage?: string;

  /** Modal copy uses "from selection"; defaults form uses catalog. */
  packageNameFieldLabel?: string;
}

export const AccusourcePackageSelectorBase: React.FC<AccusourcePackageSelectorBaseProps> = ({
  packageId,
  packageName,
  onChange,
  disabled,
  helperText,
  catalog,
  catalogLoading,
  selectedServiceIds = [],
  onServicesChange,
  showDiagnostics = false,
  showCatalogMeta = false,
  showSyncErrorAlert = true,
  showRefresh = false,
  onRefreshCatalog,
  catalogRefreshing = false,
  canRefreshCatalog = true,
  emptyMenuLabel,
  selectLabel = 'AccuSource screening package',
  packageNameHelperText,
  description,
  emptyCatalogSeverity = 'info',
  emptyCatalogMessage,
  packageNameFieldLabel = 'Package name (from catalog)',
}) => {
  const missing = isAccusourcePackageIdMissingFromCatalog(catalog, packageId);
  const hasCatalog = Boolean(catalog?.packages?.length);
  const busy = catalogLoading || catalogRefreshing;
  const diagId = String(packageId || '').trim() || '—';
  const diagName = String(packageName || '').trim() || '—';
  const diagFound = foundInCatalogLabel(catalog, packageId, catalogLoading);
  const diagSynced = formatCatalogLastSyncedAt(catalog);
  const defaultEmptyMsg =
    emptyCatalogSeverity === 'warning'
      ? 'No packages in Firestore yet. An admin must run Refresh packages to sync from AccuSource before ordering.'
      : 'No package catalog in Firestore yet. An admin should open Order screening (AccuSource) on a user profile and run Refresh packages once.';

  return (
    <Stack spacing={1.5}>
      {description ? (
        typeof description === 'string' ? (
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
        ) : (
          description
        )
      ) : null}

      {busy && (
        <Stack direction="row" alignItems="center" gap={1}>
          <CircularProgress size={18} />
          <Typography variant="caption" color="text.secondary">
            {catalogRefreshing ? 'Syncing catalog from AccuSource…' : 'Loading catalog…'}
          </Typography>
        </Stack>
      )}

      {showSyncErrorAlert && catalog?.lastError && catalog.syncStatus === 'error' && (
        <Alert severity="error">Last sync error: {catalog.lastError}</Alert>
      )}

      {!catalogLoading && !hasCatalog && (
        <Alert severity={emptyCatalogSeverity}>{emptyCatalogMessage ?? defaultEmptyMsg}</Alert>
      )}

      {showCatalogMeta && (
        <Stack direction="row" flexWrap="wrap" gap={1} alignItems="center">
          {showRefresh && (
            <Tooltip
              title={
                !canRefreshCatalog
                  ? 'AccuSource admin permission required.'
                  : 'Re-fetch packages from SourceDirect.'
              }
            >
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={catalogRefreshing ? <CircularProgress size={16} /> : <RefreshIcon />}
                  disabled={!canRefreshCatalog || catalogRefreshing}
                  onClick={() => void onRefreshCatalog?.()}
                >
                  Refresh packages
                </Button>
              </span>
            </Tooltip>
          )}
          {catalog?.syncStatus && <Chip size="small" label={`Sync: ${catalog.syncStatus}`} variant="outlined" />}
          {catalog?.providerEnvironment && (
            <Chip size="small" label={catalog.providerEnvironment} variant="outlined" />
          )}
          {catalog?.lastSyncedAt && (
            <Typography variant="caption" color="text.secondary">
              Last synced: {formatCatalogLastSyncedAt(catalog)}
            </Typography>
          )}
        </Stack>
      )}

      {showRefresh && !showCatalogMeta && (
        <Tooltip
          title={
            !canRefreshCatalog ? 'AccuSource admin permission required.' : 'Re-fetch packages from SourceDirect.'
          }
        >
          <span>
            <Button
              size="small"
              variant="outlined"
              startIcon={catalogRefreshing ? <CircularProgress size={16} /> : <RefreshIcon />}
              disabled={!canRefreshCatalog || catalogRefreshing}
              onClick={() => void onRefreshCatalog?.()}
            >
              Refresh packages
            </Button>
          </span>
        </Tooltip>
      )}

      <FormControl fullWidth size="small" variant="outlined" disabled={disabled || catalogLoading || !hasCatalog}>
        <InputLabel id="accusource-package-select-label" shrink>
          {selectLabel}
        </InputLabel>
        <Select
          labelId="accusource-package-select-label"
          label={selectLabel}
          value={packageId}
          displayEmpty
          onChange={(e) => {
            const v = e.target.value as string;
            const row = findAccusourcePackageById(catalog, v);
            onChange({ packageId: v, packageName: row?.name ?? '' });
          }}
        >
          <MenuItem value="">
            {typeof emptyMenuLabel === 'string' || emptyMenuLabel == null ? (
              <em>{emptyMenuLabel ?? 'None'}</em>
            ) : (
              emptyMenuLabel
            )}
          </MenuItem>
          {(catalog?.packages ?? []).map((pk) => (
            <MenuItem key={pk.id} value={pk.id}>
              {pk.name} ({pk.id})
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <TextField
        size="small"
        label={packageNameFieldLabel}
        value={packageName}
        fullWidth
        InputProps={{ readOnly: true }}
        InputLabelProps={{ shrink: true }}
        helperText={packageNameHelperText || ' '}
      />

      {missing && (
        <Alert severity="warning">
          Stored package id <code>{packageId}</code> is not in the current synced catalog. Sync or pick a package that matches SourceDirect.
        </Alert>
      )}

      {onServicesChange && (
        <Autocomplete<AccusourceCatalogService, true, false, false>
          multiple
          disableCloseOnSelect
          options={catalog?.services ?? []}
          getOptionLabel={(o) => (o?.name ? `${o.name} (${o.id})` : o.id)}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          value={(catalog?.services ?? []).filter((s) => selectedServiceIds.includes(s.id))}
          onChange={(_, v) => onServicesChange(v.map((x) => x.id))}
          disabled={!catalog?.services?.length}
          renderInput={(params) => (
            <TextField
              {...params}
              size="small"
              label="Additional services (optional)"
              helperText="Exact service IDs from the synced catalog; sent to AccuSource as orders[].serviceId on create (with packageId)."
            />
          )}
        />
      )}

      {helperText ? (
        <Typography variant="caption" color="text.secondary">
          {helperText}
        </Typography>
      ) : null}

      {showDiagnostics && (
        <Box
          component="section"
          aria-label="AccuSource catalog diagnostics"
          sx={{
            mt: 0.5,
            p: 1.5,
            borderRadius: 1,
            border: 1,
            borderColor: 'divider',
            bgcolor: 'action.hover',
          }}
        >
          <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: 'block', mb: 1 }}>
            Diagnostics
          </Typography>
          <Stack spacing={0.75} sx={{ m: 0 }}>
            {[
              ['Selected package ID', diagId],
              ['Selected package name', diagName],
              ['Found in current catalog', diagFound],
              ['Catalog last synced at', diagSynced],
            ].map(([label, value]) => (
              <Box key={label} sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'baseline' }}>
                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 168, flexShrink: 0 }}>
                  {label}
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'ui-monospace, monospace', wordBreak: 'break-word' }}>
                  {value}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  );
};

/** Loads catalog via hook (single Firestore read). */
const AccusourcePackageSelectorWithHook: React.FC<
  Omit<AccusourcePackageSelectorBaseProps, 'catalog' | 'catalogLoading'>
> = (props) => {
  const { catalog, loading } = useAccusourceCatalog();
  return <AccusourcePackageSelectorBase {...props} catalog={catalog} catalogLoading={loading} />;
};

export type AccusourcePackageSelectorProps = Omit<AccusourcePackageSelectorBaseProps, 'catalog' | 'catalogLoading'> & {
  catalog?: AccusourceCatalogDocument | null;
  catalogLoading?: boolean;
};

/**
 * When `catalog` is passed (including `null`), uses that catalog and optional `catalogLoading`.
 * When `catalog` is omitted, loads via `useAccusourceCatalog`.
 */
export const AccusourcePackageSelector: React.FC<AccusourcePackageSelectorProps> = (props) => {
  const { catalog: catalogProp, catalogLoading: catalogLoadingProp, ...rest } = props;
  if (catalogProp !== undefined) {
    return (
      <AccusourcePackageSelectorBase
        {...rest}
        catalog={catalogProp}
        catalogLoading={catalogLoadingProp ?? false}
      />
    );
  }
  return <AccusourcePackageSelectorWithHook {...rest} />;
};

export default AccusourcePackageSelector;
