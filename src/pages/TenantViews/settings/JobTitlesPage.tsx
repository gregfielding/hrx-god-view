/**
 * Job Titles — per-tenant master list with optional default job description
 * and default uniform per title. Persisted to
 * `tenants/{tid}/modules/hrx-flex/jobTitles` (one doc per title) so it
 * matches the existing `addJobTitle.ts` script and the read path used by
 * `TenantJobOrdersTab`.
 *
 * UX:
 *   - Sortable columns (Title / Description / Uniform).
 *   - Inline edit per row, save-on-blur (no per-row Save button — feels
 *     like a spreadsheet).
 *   - Add new title creates an empty row at the top, focuses the title
 *     input.
 *   - Delete with confirm.
 *   - Empty-state offers a one-click seed from the bundled O*NET master
 *     list (`src/data/onetJobTitles.json`) so tenants don't start blank.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  InputAdornment,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import SearchIcon from '@mui/icons-material/Search';
import WorkIcon from '@mui/icons-material/Work';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from '../../../firebase';
import { p } from '../../../data/firestorePaths';
import { useAuth } from '../../../contexts/AuthContext';
import PageHeader from '../../../components/PageHeader';
import onetJobTitlesData from '../../../data/onetJobTitles.json';

type JobTitleRow = {
  id: string;
  title: string;
  description: string;
  uniform: string;
};

type SortKey = 'title' | 'description' | 'uniform';
type SortOrder = 'asc' | 'desc';

const ONET_TITLES: string[] = Array.isArray(onetJobTitlesData)
  ? (onetJobTitlesData as string[])
  : [];

export interface JobTitlesPageProps {
  tenantId?: string | null;
  /** When true, omit duplicate page chrome (used inside Settings shell). */
  embeddedInSettings?: boolean;
}

const JobTitlesPage: React.FC<JobTitlesPageProps> = ({
  tenantId: tenantIdProp,
  embeddedInSettings,
}) => {
  const { activeTenant, tenantId: authTenantId, user } = useAuth();
  const tenantId = tenantIdProp ?? activeTenant?.id ?? authTenantId;

  const [rows, setRows] = useState<JobTitleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  /** Surfaced after a seed run so the recruiter knows what changed. */
  const [seedResult, setSeedResult] = useState<{ added: number; skipped: number } | null>(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('title');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  /** Per-row save state for the small inline status indicator. */
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /** Auto-focus the title cell of a freshly added row. */
  const newRowFocusIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const snap = await getDocs(collection(db, p.flexJobTitles(tenantId)));
      const list: JobTitleRow[] = snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          title: typeof data.title === 'string' ? data.title : '',
          description: typeof data.description === 'string' ? data.description : '',
          uniform: typeof data.uniform === 'string' ? data.uniform : '',
        };
      });
      setRows(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load job titles');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredSortedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? rows.filter((r) =>
          (r.title + '\n' + r.description + '\n' + r.uniform)
            .toLowerCase()
            .includes(q),
        )
      : rows.slice();
    list.sort((a, b) => {
      const av = (a[sortBy] || '').toLowerCase();
      const bv = (b[sortBy] || '').toLowerCase();
      const cmp = av.localeCompare(bv);
      return sortOrder === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [rows, search, sortBy, sortOrder]);

  const handleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortOrder('asc');
    }
  };

  /** Update local row immediately; persistence happens on blur. */
  const updateRowLocal = (id: string, patch: Partial<JobTitleRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  /** Persist a single row to Firestore. */
  const persistRow = useCallback(
    async (row: JobTitleRow) => {
      if (!tenantId) return;
      setSavingRowId(row.id);
      try {
        await setDoc(
          doc(db, p.flexJobTitle(tenantId, row.id)),
          {
            title: row.title.trim(),
            description: row.description.trim(),
            uniform: row.uniform.trim(),
            updatedAt: serverTimestamp(),
            updatedBy: user?.uid ?? null,
          },
          { merge: true },
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save row');
      } finally {
        setSavingRowId(null);
      }
    },
    [tenantId, user?.uid],
  );

  /** Add an empty row at the top, focused for editing. */
  const handleAdd = async () => {
    if (!tenantId) return;
    setError(null);
    try {
      const ref = await addDoc(collection(db, p.flexJobTitles(tenantId)), {
        title: '',
        description: '',
        uniform: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: user?.uid ?? null,
        updatedBy: user?.uid ?? null,
      });
      newRowFocusIdRef.current = ref.id;
      setRows((prev) => [
        { id: ref.id, title: '', description: '', uniform: '' },
        ...prev,
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add row');
    }
  };

  const handleDelete = async (id: string) => {
    if (!tenantId) return;
    setError(null);
    try {
      await deleteDoc(doc(db, p.flexJobTitle(tenantId, id)));
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete row');
    } finally {
      setConfirmDeleteId(null);
    }
  };

  /**
   * Seed the collection from the bundled O*NET title list. Skips titles
   * that already exist (case-insensitive). Also pulls in legacy entries
   * stored as a `jobTitles[]` array on the parent `modules/hrx-flex` doc
   * so existing customizations aren't lost.
   */
  const handleSeedFromOnet = async () => {
    if (!tenantId) return;
    setSeeding(true);
    setError(null);
    setSeedResult(null);
    try {
      const existing = new Set(
        rows.map((r) => r.title.trim().toLowerCase()).filter(Boolean),
      );
      const additions: Array<{ title: string; description: string; uniform: string }> = [];
      let skipped = 0;
      for (const t of ONET_TITLES) {
        const trimmed = String(t || '').trim();
        if (!trimmed) continue;
        const k = trimmed.toLowerCase();
        if (existing.has(k)) {
          skipped += 1;
          continue;
        }
        existing.add(k);
        additions.push({ title: trimmed, description: '', uniform: '' });
      }

      // Pull legacy module-doc array titles too (if any), so seeding is
      // idempotent across the two historical storage shapes.
      try {
        const legacyDoc = await getDoc(doc(db, p.flexModule(tenantId)));
        if (legacyDoc.exists()) {
          const legacyArr = (legacyDoc.data() as Record<string, unknown>)?.jobTitles;
          if (Array.isArray(legacyArr)) {
            for (const it of legacyArr) {
              const title = typeof (it as { title?: unknown })?.title === 'string'
                ? String((it as { title?: unknown }).title)
                : typeof it === 'string'
                  ? it
                  : '';
              const trimmed = title.trim();
              if (!trimmed) continue;
              const k = trimmed.toLowerCase();
              if (existing.has(k)) continue;
              existing.add(k);
              const desc = typeof (it as { description?: unknown })?.description === 'string'
                ? String((it as { description?: unknown }).description)
                : '';
              additions.push({ title: trimmed, description: desc, uniform: '' });
            }
          }
        }
      } catch {
        // Best-effort — legacy doc absent or unreadable is fine.
      }

      // Batch additions sequentially so we keep the UI responsive without
      // pounding Firestore — the O*NET list is ~900 entries.
      for (const a of additions) {
        await addDoc(collection(db, p.flexJobTitles(tenantId)), {
          ...a,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: user?.uid ?? null,
          updatedBy: user?.uid ?? null,
        });
      }
      await load();
      setSeedResult({ added: additions.length, skipped });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to seed job titles');
    } finally {
      setSeeding(false);
    }
  };

  const titleCount = rows.length;

  return (
    <Box sx={embeddedInSettings ? { px: { xs: 2, md: 3 }, py: 2 } : { p: 2 }}>
      {!embeddedInSettings && (
        <PageHeader
          title={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <WorkIcon fontSize="small" />
              <span>Job Titles</span>
            </Box>
          }
          subtitle="Manage your master job title list. Default description and uniform are optional and prefill new shifts."
        />
      )}

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {seedResult && (
        <Alert
          severity={seedResult.added > 0 ? 'success' : 'info'}
          onClose={() => setSeedResult(null)}
          sx={{ mb: 2 }}
        >
          {seedResult.added > 0
            ? `Imported ${seedResult.added.toLocaleString()} title${seedResult.added === 1 ? '' : 's'} from the O*NET master list${seedResult.skipped ? ` · ${seedResult.skipped.toLocaleString()} already existed` : ''}.`
            : `Already up to date — all ${seedResult.skipped.toLocaleString()} O*NET titles are present.`}
        </Alert>
      )}

      <Card>
        <CardContent>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            sx={{ alignItems: { xs: 'stretch', sm: 'center' }, mb: 2 }}
          >
            <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
              Job titles{titleCount ? ` (${titleCount})` : ''}
            </Typography>
            <TextField
              size="small"
              placeholder="Search title, description, or uniform"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ minWidth: { sm: 280 } }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
            <Tooltip
              title={`Adds any of the ${ONET_TITLES.length.toLocaleString()} bundled O*NET titles you don't already have. Safe to re-run; duplicates are skipped.`}
            >
              <span>
                <Button
                  variant="outlined"
                  onClick={handleSeedFromOnet}
                  disabled={seeding || !tenantId}
                  startIcon={seeding ? <CircularProgress size={16} /> : <CloudDownloadIcon />}
                >
                  {seeding ? 'Importing…' : `Import from O*NET (${ONET_TITLES.length.toLocaleString()})`}
                </Button>
              </span>
            </Tooltip>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={handleAdd}
              disabled={!tenantId}
            >
              Add Job Title
            </Button>
          </Stack>

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={32} />
            </Box>
          ) : rows.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography color="text.secondary" sx={{ mb: 1.5 }}>
                No job titles yet.
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Start blank with <strong>Add Job Title</strong>, or seed from the
                bundled O*NET master list ({ONET_TITLES.length.toLocaleString()} titles).
              </Typography>
              <Button
                variant="outlined"
                onClick={handleSeedFromOnet}
                disabled={seeding || !tenantId}
                startIcon={seeding ? <CircularProgress size={16} /> : null}
              >
                {seeding ? 'Seeding…' : `Seed from O*NET (${ONET_TITLES.length.toLocaleString()})`}
              </Button>
            </Box>
          ) : filteredSortedRows.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 2 }}>
              No matches for &ldquo;{search}&rdquo;.
            </Typography>
          ) : (
            <Table size="small" stickyHeader sx={{ tableLayout: 'fixed', width: '100%' }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: '24%', minWidth: 200 }}>
                    <TableSortLabel
                      active={sortBy === 'title'}
                      direction={sortBy === 'title' ? sortOrder : 'asc'}
                      onClick={() => handleSort('title')}
                    >
                      Title
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ width: '40%', minWidth: 240 }}>
                    <TableSortLabel
                      active={sortBy === 'description'}
                      direction={sortBy === 'description' ? sortOrder : 'asc'}
                      onClick={() => handleSort('description')}
                    >
                      Default job description
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ width: '28%', minWidth: 180 }}>
                    <TableSortLabel
                      active={sortBy === 'uniform'}
                      direction={sortBy === 'uniform' ? sortOrder : 'asc'}
                      onClick={() => handleSort('uniform')}
                    >
                      Default uniform
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="right" sx={{ width: 56 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredSortedRows.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell sx={{ verticalAlign: 'top', py: 1 }}>
                      <TextField
                        fullWidth
                        size="small"
                        variant="standard"
                        value={row.title}
                        placeholder="e.g. Forklift Driver"
                        onChange={(e) => updateRowLocal(row.id, { title: e.target.value })}
                        onBlur={() => void persistRow(row)}
                        inputRef={(node: HTMLInputElement | null) => {
                          if (node && newRowFocusIdRef.current === row.id) {
                            node.focus();
                            newRowFocusIdRef.current = null;
                          }
                        }}
                        InputProps={{ disableUnderline: true, sx: { fontWeight: 500 } }}
                      />
                    </TableCell>
                    <TableCell sx={{ verticalAlign: 'top', py: 1 }}>
                      <TextField
                        fullWidth
                        size="small"
                        variant="standard"
                        value={row.description}
                        placeholder="Optional — prefills new shifts"
                        multiline
                        maxRows={4}
                        onChange={(e) => updateRowLocal(row.id, { description: e.target.value })}
                        onBlur={() => void persistRow(row)}
                        InputProps={{ disableUnderline: true }}
                      />
                    </TableCell>
                    <TableCell sx={{ verticalAlign: 'top', py: 1 }}>
                      <TextField
                        fullWidth
                        size="small"
                        variant="standard"
                        value={row.uniform}
                        placeholder="Optional — e.g. Black non-slip shoes, white shirt"
                        multiline
                        maxRows={3}
                        onChange={(e) => updateRowLocal(row.id, { uniform: e.target.value })}
                        onBlur={() => void persistRow(row)}
                        InputProps={{ disableUnderline: true }}
                      />
                    </TableCell>
                    <TableCell align="right" sx={{ verticalAlign: 'top', py: 1 }}>
                      {savingRowId === row.id ? (
                        <Box sx={{ pr: 1, pt: 0.5 }}>
                          <CircularProgress size={14} />
                        </Box>
                      ) : (
                        <Tooltip title="Delete">
                          <IconButton
                            size="small"
                            onClick={() => setConfirmDeleteId(row.id)}
                            aria-label={`Delete ${row.title || 'job title'}`}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!confirmDeleteId} onClose={() => setConfirmDeleteId(null)}>
        <DialogTitle>Delete job title?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {(() => {
              const t = rows.find((r) => r.id === confirmDeleteId)?.title;
              return t
                ? `Remove "${t}" from your job title list? This won't change any existing shifts or job orders that already use it.`
                : 'Remove this job title? This won\u2019t change any existing shifts or job orders that already use it.';
            })()}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              if (confirmDeleteId) void handleDelete(confirmDeleteId);
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default JobTitlesPage;
