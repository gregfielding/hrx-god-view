/**
 * Job Order → Cascading Data tab — read-only bridge to national → account → order cascade.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

import { useEntity } from '../../hooks/useEntity';
import type { JobOrder } from '../../types/recruiter/jobOrder';
import type { AccountPositionPricing } from '../../types/recruiter/account';
import { fetchResolvedAccountPricingPositions } from '../../utils/accountPricingForJobOrder';

export interface JobOrderCascadingDataTabProps {
  tenantId: string;
  jobOrder: JobOrder;
  recruiterAccountId: string | null;
  schedulerName: string | null;
}

function summarizeJoPositions(jobOrder: JobOrder): Array<{ jobTitle: string; note?: string }> {
  const positions = (jobOrder as any).positions;
  const gig = (jobOrder as any).gigPositions;
  if (Array.isArray(positions) && positions.length > 0) {
    return positions
      .filter((p: any) => p && String(p.jobTitle || '').trim())
      .map((p: any) => ({ jobTitle: String(p.jobTitle).trim() }));
  }
  if ((jobOrder as any).jobType === 'gig' && Array.isArray(gig) && gig.length > 0) {
    return gig
      .filter((p: any) => p && String(p.jobTitle || '').trim())
      .map((p: any) => ({ jobTitle: String(p.jobTitle).trim() }));
  }
  if (jobOrder.jobTitle?.trim()) {
    return [{ jobTitle: jobOrder.jobTitle.trim(), note: 'Single title (legacy or career)' }];
  }
  return [];
}

const JobOrderCascadingDataTab: React.FC<JobOrderCascadingDataTabProps> = ({
  tenantId,
  jobOrder,
  recruiterAccountId,
  schedulerName,
}) => {
  const [resolvedPositions, setResolvedPositions] = useState<AccountPositionPricing[]>([]);
  const [loadingPositions, setLoadingPositions] = useState(true);
  const { entity: hiringEntity } = useEntity(tenantId, jobOrder.hiringEntityId ?? null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingPositions(true);
      try {
        const rows = await fetchResolvedAccountPricingPositions(tenantId, {
          recruiterAccountId,
          companyId: jobOrder.companyId,
        });
        if (!cancelled) setResolvedPositions(rows);
      } catch {
        if (!cancelled) setResolvedPositions([]);
      } finally {
        if (!cancelled) setLoadingPositions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, recruiterAccountId, jobOrder.companyId]);

  const joPositionRows = useMemo(() => summarizeJoPositions(jobOrder), [jobOrder]);

  const parentAccountLabel =
    typeof (jobOrder as any).parentAccountName === 'string' && (jobOrder as any).parentAccountName.trim()
      ? String((jobOrder as any).parentAccountName).trim()
      : null;

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
          Cascading Data
        </Typography>
        <Typography variant="body2" color="text.secondary">
          This order pulls defaults from the linked recruiter account (national → child → order). Edit templates and
          venue rates on the account&apos;s Cascading Data tab; shift creation snapshots position pricing onto each shift.
        </Typography>
      </Box>

      {recruiterAccountId ? (
        <Box>
          <Button
            component={RouterLink}
            to={`/accounts/${recruiterAccountId}?tab=cascading-data`}
            variant="outlined"
            size="small"
            sx={{ textTransform: 'none' }}
          >
            Open account Cascading Data
          </Button>
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No recruiter account is linked — cascade uses company-linked account lookup where available.
        </Typography>
      )}

      <Card variant="outlined" elevation={0}>
        <CardHeader titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }} title="Hiring entity & E-Verify" />
        <CardContent sx={{ pt: 0 }}>
          <Typography variant="body2">
            <strong>Entity:</strong> {hiringEntity?.name ?? '—'}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            <strong>E-Verify:</strong> {hiringEntity ? (hiringEntity.everifyRequired ? 'Yes' : 'No') : '—'}
          </Typography>
          {parentAccountLabel ? (
            <Typography variant="body2" sx={{ mt: 0.5 }} color="text.secondary">
              National / parent (reference): {parentAccountLabel}
            </Typography>
          ) : null}
        </CardContent>
      </Card>

      <Card variant="outlined" elevation={0}>
        <CardHeader titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }} title="Scheduler" />
        <CardContent sx={{ pt: 0 }}>
          <Typography variant="body2">{schedulerName ?? '—'}</Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            Scheduler of record is stamped from the account; see the header for activation snapshot details if shown.
          </Typography>
        </CardContent>
      </Card>

      <Card variant="outlined" elevation={0}>
        <CardHeader
          titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
          title="Account default positions (resolved)"
        />
        <CardContent sx={{ pt: 0 }}>
          {loadingPositions ? (
            <CircularProgress size={28} />
          ) : resolvedPositions.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No default positions on the linked account. Add them under Account → Cascading Data → Positions &amp;
              Pricing.
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Job title</TableCell>
                  <TableCell align="right">Pay</TableCell>
                  <TableCell align="right">Bill</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {resolvedPositions.map((row, i) => (
                  <TableRow key={`${row.jobTitle}-${i}`}>
                    <TableCell>{row.jobTitle}</TableCell>
                    <TableCell align="right">{row.payRate ?? '—'}</TableCell>
                    <TableCell align="right">{row.billRate ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card variant="outlined" elevation={0}>
        <CardHeader titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }} title="Positions on this job order" />
        <CardContent sx={{ pt: 0 }}>
          {joPositionRows.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No position rows on this order yet.
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Job title</TableCell>
                  <TableCell>Note</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {joPositionRows.map((r, i) => (
                  <TableRow key={`${r.jobTitle}-${i}`}>
                    <TableCell>{r.jobTitle}</TableCell>
                    <TableCell>{r.note ?? ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </Stack>
  );
};

export default JobOrderCascadingDataTab;
