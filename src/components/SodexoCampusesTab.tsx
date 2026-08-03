/**
 * Sodexo Campuses — dedicated CRM tab (Greg, 2026-08-01).
 *
 * The campus dining prospect universe is a SEPARATE sales motion from the
 * regular pipeline: C1 is already a national Sodexo vendor, but each campus
 * must be sold individually (email-first campaign). This tab lists the 232
 * campus child accounts loaded by the 2026-07-14 sodexomyway.com sweep
 * (accounts.source === 'sodexomyway_scrape_2026-07-14') with their scraped
 * contact counts (crm_contacts.leadSource === the campus-scrape marker), so
 * the campaign never mixes into Opportunities.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Chip,
  CircularProgress,
  IconButton,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { OpenInNew as OpenInNewIcon } from '@mui/icons-material';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';

const CAMPUS_ACCOUNT_SOURCE = 'sodexomyway_scrape_2026-07-14';
const CAMPUS_CONTACT_LEAD_SOURCE = 'Sodexo Campus Scrape (sodexomyway.com)';

interface CampusRow {
  id: string;
  name: string;
  state: string;
  salesStatus: string;
  teamPageUrl: string;
  contactCount: number;
  emailCount: number;
}

const SodexoCampusesTab: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [rows, setRows] = useState<CampusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        const [acctSnap, contactSnap] = await Promise.all([
          getDocs(
            query(
              collection(db, 'tenants', tenantId, 'accounts'),
              where('source', '==', CAMPUS_ACCOUNT_SOURCE),
            ),
          ),
          getDocs(
            query(
              collection(db, 'tenants', tenantId, 'crm_contacts'),
              where('leadSource', '==', CAMPUS_CONTACT_LEAD_SOURCE),
            ),
          ),
        ]);
        if (cancelled) return;
        const counts = new Map<string, { contacts: number; emails: number }>();
        contactSnap.forEach((d) => {
          const x = d.data() as any;
          const key = String(x.accountId || '');
          if (!key) return;
          const cur = counts.get(key) ?? { contacts: 0, emails: 0 };
          cur.contacts += 1;
          if (x.email) cur.emails += 1;
          counts.set(key, cur);
        });
        const list: CampusRow[] = acctSnap.docs.map((d) => {
          const x = d.data() as any;
          const c = counts.get(d.id) ?? { contacts: 0, emails: 0 };
          return {
            id: d.id,
            name: String(x.name || '').replace(/^Sodexo\s+—\s+/, ''),
            state: String(x.state || ''),
            salesStatus: String(x.salesStatus || 'prospect'),
            teamPageUrl: String(x.teamPageUrl || ''),
            contactCount: c.contacts,
            emailCount: c.emails,
          };
        });
        list.sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
        setRows(list);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const states = useMemo(
    () => Array.from(new Set(rows.map((r) => r.state).filter(Boolean))).sort(),
    [rows],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (stateFilter === 'all' || r.state === stateFilter) &&
        (!q || r.name.toLowerCase().includes(q)),
    );
  }, [rows, stateFilter, search]);

  const totals = useMemo(
    () => ({
      contacts: visible.reduce((s, r) => s + r.contactCount, 0),
      emails: visible.reduce((s, r) => s + r.emailCount, 0),
    }),
    [visible],
  );

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  return (
    <Box sx={{ px: 2, py: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h6" sx={{ fontWeight: 600, mr: 1 }}>
          Sodexo Campus Dining
        </Typography>
        <Chip size="small" label={`${visible.length} campuses`} />
        <Chip size="small" label={`${totals.contacts} contacts · ${totals.emails} emails`} />
        <Box sx={{ flex: 1 }} />
        <TextField
          size="small"
          select
          label="State"
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          sx={{ minWidth: 110 }}
        >
          <MenuItem value="all">All states</MenuItem>
          {states.map((s) => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          placeholder="Search campuses…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: 220 }}
        />
      </Box>
      <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Campus</TableCell>
              <TableCell>State</TableCell>
              <TableCell align="right">Contacts</TableCell>
              <TableCell align="right">Emails</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="center">Team page</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.map((r) => (
              <TableRow key={r.id} hover>
                <TableCell sx={{ fontWeight: 500 }}>{r.name}</TableCell>
                <TableCell>{r.state}</TableCell>
                <TableCell align="right">{r.contactCount}</TableCell>
                <TableCell align="right">{r.emailCount}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={r.salesStatus}
                    color={r.salesStatus === 'customer' ? 'success' : 'default'}
                    variant={r.salesStatus === 'customer' ? 'filled' : 'outlined'}
                  />
                </TableCell>
                <TableCell align="center">
                  {r.teamPageUrl ? (
                    <Tooltip title="Open sodexomyway team page">
                      <IconButton
                        size="small"
                        component="a"
                        href={r.teamPageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <OpenInNewIcon fontSize="inherit" />
                      </IconButton>
                    </Tooltip>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                    No campuses match this filter.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

export default SodexoCampusesTab;
