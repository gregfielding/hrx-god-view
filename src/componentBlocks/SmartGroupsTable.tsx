/**
 * SmartGroupsTable
 *
 * Reusable table for the Smart Groups surfaces under the Users hub.
 * Two scopes today:
 *   - `all`  → "/users/all-smart-groups": every saved smart group in the
 *              tenant, deduped against what the viewer has already copied.
 *   - `mine` → "/users/my-smart-groups": only groups the viewer created or
 *              copied into their personal list (`createdBy === viewer.uid`).
 *
 * The visual chrome (flat 1px #EAEEF4 border, square corners, sticky header,
 * alternating row backgrounds) intentionally mirrors the User Groups table in
 * `src/pages/AgencyProfile/components/UserGroupsTab.tsx` so all of the lists
 * under the Users hub feel like one surface.
 *
 * The two action buttons ("Open" and "Add to My Smart Groups") are sized and
 * styled to match the small pill buttons used elsewhere in the Users hub.
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  CircularProgress,
  Alert,
  Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, addDoc, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import type { SavedSmartGroupFilters } from '../services/runSavedSmartGroupSearch';

export type SmartGroupsTableScope = 'all' | 'mine';

export interface SmartGroupsTableProps {
  /**
   * `all`  – show every smart group in the tenant (de-duped against the
   *          viewer's existing copies).
   * `mine` – show only groups owned by the viewer (created or copied).
   */
  scope: SmartGroupsTableScope;
  /**
   * Optional copy override for the empty state. Defaults to a generic message
   * appropriate for the active `scope`.
   */
  emptyMessage?: React.ReactNode;
  /**
   * Free-text filter applied client-side across the visible columns
   * (name, address, creator). Falsy / whitespace-only values disable
   * the filter. Wired up by the parent so the search input can live in
   * `UsersLayout`'s tab-row right slot and survive scope toggles.
   */
  search?: string;
}

interface SmartGroupRow {
  id: string;
  name: string;
  memberIds: string[];
  memberStatusById: Record<string, string>;
  filterMode: string;
  filters: SavedSmartGroupFilters;
  createdBy: string | null;
  createdByName: string | null;
  /** When set, this row is a copy of another smart group in the same tenant. */
  copiedFromGroupId: string | null;
  /**
   * For copies, the display name of the original creator (so "Created by"
   * shows who built the search rather than who pulled it into their list).
   */
  originalCreatedByName: string | null;
  createdAt: any;
  updatedAt: any;
}

const formatDate = (ts: any): string => {
  if (!ts) return '—';
  try {
    const date = ts?.toDate ? ts.toDate() : new Date(ts);
    return isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { dateStyle: 'short' });
  } catch {
    return '—';
  }
};

/**
 * Best-effort "where is this group searching" label, derived from the saved
 * filters. Prefers the explicit radius address (since that's what powers a
 * radius search), then falls back to whatever locality fields the area-mode
 * search captured.
 */
const formatAddress = (filters: SavedSmartGroupFilters | undefined): string => {
  if (!filters) return '—';
  const radiusAddress = filters.radiusAddress?.trim();
  if (radiusAddress) return radiusAddress;
  const cityFilter = filters.cityFilter?.trim();
  if (cityFilter) return cityFilter;
  const areaFilter = filters.areaFilter?.trim();
  if (areaFilter) return areaFilter;
  const metroFilter = filters.metroFilter?.trim();
  if (metroFilter) return metroFilter;
  return '—';
};

/**
 * Radius is only meaningful for radius-mode searches; for area/metro mode
 * we render an em-dash since the geographic scope is the area itself.
 */
const formatRadius = (filters: SavedSmartGroupFilters | undefined): string => {
  if (!filters) return '—';
  const isRadiusMode = filters.residenceSubMode === 'radius' || (filters.radiusAddress?.trim()?.length ?? 0) > 0;
  if (!isRadiusMode) return '—';
  const miles = filters.radiusMiles;
  if (typeof miles !== 'number' || !isFinite(miles)) return '—';
  return `${miles} mi`;
};

const SmartGroupsTable: React.FC<SmartGroupsTableProps> = ({ scope, emptyMessage, search }) => {
  const navigate = useNavigate();
  const { tenantId, user } = useAuth();

  const [groups, setGroups] = useState<SmartGroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId || !user?.uid) return;
    let mounted = true;

    (async () => {
      try {
        const ref = collection(db, 'tenants', tenantId, 'savedSmartGroups');
        const snap = await getDocs(ref);
        if (!mounted) return;

        const creatorIds = new Set<string>();
        const rows: SmartGroupRow[] = snap.docs.map((d) => {
          const data = d.data();
          const createdBy = data.createdBy ?? null;
          if (createdBy) creatorIds.add(createdBy);
          return {
            id: d.id,
            name: data.name ?? 'Untitled',
            memberIds: Array.isArray(data.memberIds) ? data.memberIds : [],
            memberStatusById: (data.memberStatusById ?? {}) as Record<string, string>,
            filterMode: data.filterMode ?? 'residence',
            filters: (data.filters ?? {}) as SavedSmartGroupFilters,
            createdBy,
            createdByName: null,
            copiedFromGroupId: data.copiedFromGroupId ?? null,
            originalCreatedByName: null,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          };
        });

        // Resolve display names for direct creators
        if (creatorIds.size > 0) {
          const names: Record<string, string> = {};
          await Promise.all(
            Array.from(creatorIds).map(async (uid) => {
              const userSnap = await getDoc(doc(db, 'users', uid));
              if (userSnap.exists()) {
                const ud = userSnap.data() as any;
                names[uid] = [ud.firstName, ud.lastName].filter(Boolean).join(' ').trim() || ud.email || 'Unknown';
              } else {
                names[uid] = 'Unknown';
              }
            })
          );
          rows.forEach((r) => {
            if (r.createdBy) r.createdByName = names[r.createdBy] ?? 'Unknown';
          });
        }

        // Resolve "original creator" for copied rows so /mine doesn't just
        // attribute every group to the viewer.
        const copiedIds = rows.filter((r) => r.copiedFromGroupId).map((r) => r.copiedFromGroupId!);
        const originalCreatorIds = new Set<string>();
        const sourceCreatedByByCopyId: Record<string, string> = {};
        for (const sourceId of copiedIds) {
          const sourceSnap = await getDoc(doc(db, 'tenants', tenantId, 'savedSmartGroups', sourceId));
          if (sourceSnap.exists()) {
            const uid = sourceSnap.data()?.createdBy ?? null;
            if (uid) {
              originalCreatorIds.add(uid);
              sourceCreatedByByCopyId[sourceId] = uid;
            }
          }
        }
        if (originalCreatorIds.size > 0) {
          const originalNames: Record<string, string> = {};
          await Promise.all(
            Array.from(originalCreatorIds).map(async (uid) => {
              const userSnap = await getDoc(doc(db, 'users', uid));
              if (userSnap.exists()) {
                const ud = userSnap.data() as any;
                originalNames[uid] = [ud.firstName, ud.lastName].filter(Boolean).join(' ').trim() || ud.email || 'Unknown';
              } else {
                originalNames[uid] = 'Unknown';
              }
            })
          );
          rows.forEach((r) => {
            if (r.copiedFromGroupId) {
              const originalUid = sourceCreatedByByCopyId[r.copiedFromGroupId];
              if (originalUid) r.originalCreatedByName = originalNames[originalUid] ?? 'Unknown';
            }
          });
        }

        // Scope-aware filtering.
        let filtered: SmartGroupRow[];
        if (scope === 'mine') {
          // Only the viewer's own rows (originals AND copies of others' groups
          // — both are stored as `createdBy === viewer.uid`).
          filtered = rows.filter((r) => r.createdBy === user.uid);
        } else {
          // `all`: hide originals the viewer has already copied so they don't
          // appear twice in the list.
          const myCopiedFromIds = new Set(
            rows
              .filter((r) => r.createdBy === user.uid && r.copiedFromGroupId)
              .map((r) => r.copiedFromGroupId!)
          );
          const myGroupNames = new Set(
            rows.filter((r) => r.createdBy === user.uid).map((r) => r.name.trim().toLowerCase())
          );
          filtered = rows.filter((r) => {
            if (myCopiedFromIds.has(r.id)) return false; // exact: I have a copy of this group
            if (r.createdBy !== user.uid && myGroupNames.has(r.name.trim().toLowerCase())) {
              return false; // same name: I already have one (e.g. legacy copies)
            }
            return true;
          });
        }

        setGroups(filtered);
      } catch (err: any) {
        if (mounted) setError(err?.message ?? 'Failed to load smart groups');
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [tenantId, user?.uid, scope]);

  const isMine = useCallback((row: SmartGroupRow) => row.createdBy === user?.uid, [user?.uid]);

  // Apply the (optional) free-text filter from the layout's universal search
  // bar. We match name/address/creator since those are the human-readable
  // columns. Falls through unchanged when the search is empty.
  const visibleGroups = useMemo(() => {
    const q = search?.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((row) => {
      const haystack = [
        row.name,
        formatAddress(row.filters),
        row.originalCreatedByName ?? row.createdByName ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [groups, search]);

  const handleAddToMySmartGroups = async (row: SmartGroupRow) => {
    if (!tenantId || !user?.uid) return;
    setAddingId(row.id);
    setAddError(null);
    try {
      const ref = collection(db, 'tenants', tenantId, 'savedSmartGroups');
      await addDoc(ref, {
        name: row.name,
        filterMode: row.filterMode,
        filters: row.filters,
        memberIds: row.memberIds,
        memberStatusById: row.memberStatusById,
        createdAt: serverTimestamp(),
        createdBy: user.uid,
        copiedFromGroupId: row.id,
        updatedAt: serverTimestamp(),
      });
      navigate('/users/my-smart-groups');
    } catch (err: any) {
      setAddError(err?.message ?? 'Failed to add to My Smart Groups');
    } finally {
      setAddingId(null);
    }
  };

  const fallbackEmptyMessage =
    scope === 'mine' ? (
      <>
        No saved smart groups yet. Use <strong>Smart Groups</strong> to run a search,
        then click <strong>Save Smart Search</strong> to add one to your list.
      </>
    ) : (
      <>
        No smart groups in this tenant yet. Use <strong>Smart Groups</strong> to run a search,
        then <strong>Save Smart Search</strong> to create one.
      </>
    );

  return (
    // Match the User Groups tab layout — flex column that fills the outlet
    // container so the table can stretch, with px gutters owned by the inner
    // content Box (no pb here; the global Layout supplies the 16px gutter at
    // the bottom of the page).
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {error && (
        <Alert severity="error" sx={{ mx: 2, mb: 2, flexShrink: 0 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {addError && (
        <Alert severity="warning" sx={{ mx: 2, mb: 2, flexShrink: 0 }} onClose={() => setAddError(null)}>
          {addError}
        </Alert>
      )}

      <Box sx={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', px: 2, pb: 0 }}>
        {loading && (
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(255, 255, 255, 0.8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
            }}
          >
            <CircularProgress />
          </Box>
        )}

        {!loading && visibleGroups.length === 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, textAlign: 'center', px: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {search?.trim()
                ? `No smart groups match "${search.trim()}".`
                : emptyMessage ?? fallbackEmptyMessage}
            </Typography>
          </Box>
        )}

        {visibleGroups.length > 0 && (
          <TableContainer
            component={Paper}
            elevation={0}
            sx={{
              // Identical chrome to the User Groups table — flat 1px #EAEEF4
              // border, square corners, sticky header, custom scrollbars.
              borderRadius: 0,
              border: '1px solid #EAEEF4',
              position: 'relative',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              overflowY: 'auto',
              overflowX: 'auto',
              width: '100%',
              '&::-webkit-scrollbar': { width: '8px', height: '8px' },
              '&::-webkit-scrollbar-track': {
                background: 'rgba(0, 0, 0, 0.02)',
                borderRadius: '4px',
              },
              '&::-webkit-scrollbar-thumb': {
                background: 'rgba(0, 0, 0, 0.15)',
                borderRadius: '4px',
                '&:hover': { background: 'rgba(0, 0, 0, 0.25)' },
              },
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
            }}
          >
            <Table size="small" stickyHeader sx={{ width: '100%' }}>
              <TableHead
                sx={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 10,
                  backgroundColor: 'background.paper',
                  borderRadius: 0,
                  '& .MuiTableCell-root': {
                    borderRadius: 0,
                  },
                }}
              >
                <TableRow sx={{ backgroundColor: 'background.paper', borderRadius: 0 }}>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                    Name
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                    Address
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0, width: 90 }}>
                    Radius
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                    Created by
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                    Members
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                    Updated
                  </TableCell>
                  <TableCell align="right" sx={{ width: 200, fontWeight: 700, bgcolor: '#FFFFFF', textTransform: 'uppercase', fontSize: '0.75rem', borderRadius: 0 }}>
                    Actions
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleGroups.map((row, index) => (
                  <TableRow
                    key={row.id}
                    hover
                    sx={{
                      cursor: isMine(row) ? 'pointer' : 'default',
                      backgroundColor: index % 2 === 0 ? 'background.paper' : '#FAFAFA',
                      '&:hover': { backgroundColor: 'action.selected' },
                    }}
                    onClick={() => isMine(row) && navigate(`/users/my-smart-groups/${row.id}`)}
                  >
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {row.name}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>{formatAddress(row.filters)}</TableCell>
                    <TableCell sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{formatRadius(row.filters)}</TableCell>
                    <TableCell>{row.originalCreatedByName ?? row.createdByName ?? '—'}</TableCell>
                    <TableCell>{row.memberIds.length}</TableCell>
                    <TableCell>{formatDate(row.updatedAt)}</TableCell>
                    <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                      {isMine(row) ? (
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => navigate(`/users/my-smart-groups/${row.id}`)}
                          sx={{
                            textTransform: 'none',
                            borderRadius: '999px',
                            fontSize: '13px',
                            fontWeight: 500,
                            px: 1.5,
                            py: 0.5,
                            minHeight: 28,
                            height: 28,
                            minWidth: 'auto',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Open
                        </Button>
                      ) : (
                        <Tooltip title="Save a copy to My Smart Groups">
                          <span>
                            <Button
                              size="small"
                              variant="contained"
                              startIcon={addingId === row.id ? <CircularProgress size={12} color="inherit" /> : <AddIcon />}
                              disabled={addingId !== null}
                              onClick={() => handleAddToMySmartGroups(row)}
                              sx={{
                                textTransform: 'none',
                                borderRadius: '999px',
                                fontSize: '13px',
                                fontWeight: 600,
                                px: 1.5,
                                py: 0.5,
                                minHeight: 28,
                                height: 28,
                                minWidth: 'auto',
                                whiteSpace: 'nowrap',
                                bgcolor: '#0057B8',
                                boxShadow: 'none',
                                '&:hover': { bgcolor: '#004a9f', boxShadow: 'none' },
                                '& .MuiButton-startIcon': {
                                  mr: 0.5,
                                  '& svg': { fontSize: 14 },
                                },
                              }}
                            >
                              Add to My Smart Groups
                            </Button>
                          </span>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>
    </Box>
  );
};

export default SmartGroupsTable;
