/**
 * Nearby Jobs tab on User Details (Greg 2026-07-28): "we have a great
 * worker — find them a job." Two sub-tabs, both ranked by distance from
 * the worker's geocoded home address (closest 10):
 *
 *   - Open Jobs: active public postings (same corpus as the public
 *     jobs board) with distance, pay, and a link to the job order.
 *   - Nearby Companies: CRM companies whose geocoded locations are
 *     close by — prospects/customers worth a call even with no open
 *     order. Links to the account.
 *
 * All ranking happens server-side in `getWorkerNearbyOpportunities`.
 */
import React, { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Link,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../../../firebase';

const usd = (n: number): string =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

interface OpenJobRow {
  postingId: string;
  jobOrderId: string | null;
  title: string;
  companyName: string | null;
  worksiteName: string | null;
  city: string | null;
  state: string | null;
  jobType: string | null;
  payRate: number | null;
  distanceMi: number;
}

interface NearbyCompanyRow {
  accountId: string;
  companyName: string;
  locationName: string | null;
  city: string | null;
  state: string | null;
  distanceMi: number;
}

interface Result {
  noCoordinates: boolean;
  openJobs: OpenJobRow[];
  nearbyCompanies: NearbyCompanyRow[];
}

interface Props {
  uid: string;
  tenantId: string | null;
  workerDisplayName: string | null;
}

const WorkerNearbyJobsTab: React.FC<Props> = ({ uid, tenantId, workerDisplayName }) => {
  const [tab, setTab] = useState<'jobs' | 'companies'>('jobs');
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId || !uid) return;
    let cancelled = false;
    const fn = httpsCallable(functions, 'getWorkerNearbyOpportunities');
    fn({ tenantId, workerId: uid })
      .then((res) => {
        if (!cancelled) setData(res.data as Result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, uid]);

  if (!tenantId) return null;

  return (
    <Card>
      <CardContent>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
          Nearby opportunities
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Closest 10 to {workerDisplayName ?? 'this worker'}&apos;s home address.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {data?.noCoordinates && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            This worker&apos;s home address hasn&apos;t been geocoded yet, so distance search
            isn&apos;t available. Updating their address on the Overview tab will fix this.
          </Alert>
        )}

        <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 1 }}>
          <Tab value="jobs" label={`Open Jobs${data ? ` (${data.openJobs.length})` : ''}`} />
          <Tab
            value="companies"
            label={`Nearby Companies${data ? ` (${data.nearbyCompanies.length})` : ''}`}
          />
        </Tabs>

        {!data && !error ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : tab === 'jobs' ? (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Distance</TableCell>
                  <TableCell>Job</TableCell>
                  <TableCell>Company / worksite</TableCell>
                  <TableCell>Location</TableCell>
                  <TableCell align="right">Pay</TableCell>
                  <TableCell>Type</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(data?.openJobs ?? []).map((r) => (
                  <TableRow key={r.postingId} hover>
                    <TableCell>
                      <Chip size="small" label={`${r.distanceMi} mi`} />
                    </TableCell>
                    <TableCell>
                      {r.jobOrderId ? (
                        <Link component={RouterLink} to={`/jobs/job-orders/${r.jobOrderId}`}>
                          {r.title}
                        </Link>
                      ) : (
                        r.title
                      )}
                    </TableCell>
                    <TableCell>{r.companyName ?? r.worksiteName ?? '—'}</TableCell>
                    <TableCell>{[r.city, r.state].filter(Boolean).join(', ') || '—'}</TableCell>
                    <TableCell align="right">{r.payRate != null ? `${usd(r.payRate)}/hr` : '—'}</TableCell>
                    <TableCell>{r.jobType ?? '—'}</TableCell>
                  </TableRow>
                ))}
                {data && data.openJobs.length === 0 && !data.noCoordinates && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Typography variant="body2" color="text.secondary">
                        No active postings with a mapped location.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Distance</TableCell>
                  <TableCell>Company</TableCell>
                  <TableCell>Nearest location</TableCell>
                  <TableCell>Location</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(data?.nearbyCompanies ?? []).map((r) => (
                  <TableRow key={r.accountId} hover>
                    <TableCell>
                      <Chip size="small" label={`${r.distanceMi} mi`} />
                    </TableCell>
                    <TableCell>
                      <Link component={RouterLink} to={`/accounts/${r.accountId}`}>
                        {r.companyName}
                      </Link>
                    </TableCell>
                    <TableCell>{r.locationName ?? '—'}</TableCell>
                    <TableCell>{[r.city, r.state].filter(Boolean).join(', ') || '—'}</TableCell>
                  </TableRow>
                ))}
                {data && data.nearbyCompanies.length === 0 && !data.noCoordinates && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Typography variant="body2" color="text.secondary">
                        No CRM company locations with coordinates yet.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
};

export default WorkerNearbyJobsTab;
