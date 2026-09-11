/**
 * /reports/ai-hiring-illinois — Illinois AI Hiring Monitor (Compliance, Greg
 * 2026-09-10). For applicants to Illinois postings: how often each
 * self-identified group reaches Tier 1–2 and gets hired, compared with the
 * best-performing group. Recomputed daily by the orchestrator's
 * ai_hiring_monitor_sweep into tenants/{t}/compliance_reports/ai_hiring_illinois.
 * Aggregates only — individual self-ID answers are never readable here.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { doc, getDoc } from 'firebase/firestore';

import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

interface GroupRate {
  group: string;
  applicants: number;
  promoted: number;
  hired: number;
  promotionRate: number | null;
  hireRate: number | null;
  promotionImpactRatio: number | null;
  hireImpactRatio: number | null;
  flag: 'ok' | 'below_four_fifths' | 'too_few';
}

interface DimensionRates {
  groups: GroupRate[];
  declined: number;
  unanswered: number;
}

interface MonitorReport {
  generatedAt?: { toDate?: () => Date };
  postings: number;
  applicants: number;
  selfIdResponses: number;
  minGroupSize: number;
  fourFifthsThreshold: number;
  raceEthnicity: DimensionRates;
  sex: DimensionRates;
  ageBand: DimensionRates;
  openReviewRequests: number;
}

const GROUP_LABELS: Record<string, string> = {
  hispanic_latino: 'Hispanic or Latino',
  white: 'White',
  black_african_american: 'Black or African American',
  asian: 'Asian',
  american_indian_alaska_native: 'American Indian or Alaska Native',
  native_hawaiian_pacific_islander: 'Native Hawaiian or Other Pacific Islander',
  two_or_more: 'Two or more races',
  male: 'Male',
  female: 'Female',
  nonbinary: 'Nonbinary',
  under_40: 'Under 40',
  '40_plus': '40 and over',
};

const pct = (n: number | null): string => (n == null ? '—' : `${Math.round(n * 100)}%`);
const ratio = (n: number | null): string => (n == null ? '—' : n.toFixed(2));

const FLAG_CHIP: Record<GroupRate['flag'], { label: string; color: 'success' | 'warning' | 'default' }> = {
  ok: { label: 'OK', color: 'success' },
  below_four_fifths: { label: 'Below 0.80 — review', color: 'warning' },
  too_few: { label: 'Too few to compare', color: 'default' },
};

function DimensionTable({ title, rates }: { title: string; rates: DimensionRates | undefined }) {
  const groups = rates?.groups ?? [];
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
          {title}
        </Typography>
        {groups.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No answers yet.
          </Typography>
        ) : (
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Group</TableCell>
                  <TableCell align="right">Applicants</TableCell>
                  <TableCell align="right">Tier 1–2 rate</TableCell>
                  <TableCell align="right">Ratio</TableCell>
                  <TableCell align="right">Hire rate</TableCell>
                  <TableCell align="right">Ratio</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {groups.map((g) => (
                  <TableRow key={g.group}>
                    <TableCell>{GROUP_LABELS[g.group] ?? g.group}</TableCell>
                    <TableCell align="right">{g.applicants}</TableCell>
                    <TableCell align="right">{pct(g.promotionRate)}</TableCell>
                    <TableCell align="right">{ratio(g.promotionImpactRatio)}</TableCell>
                    <TableCell align="right">{pct(g.hireRate)}</TableCell>
                    <TableCell align="right">{ratio(g.hireImpactRatio)}</TableCell>
                    <TableCell>
                      <Chip size="small" label={FLAG_CHIP[g.flag].label} color={FLAG_CHIP[g.flag].color} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          Declined to answer: {rates?.declined ?? 0} · Not answered: {rates?.unanswered ?? 0}
        </Typography>
      </CardContent>
    </Card>
  );
}

const AiHiringMonitorReportPage: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId } = useAuth();
  const [report, setReport] = useState<MonitorReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    getDoc(doc(db, 'tenants', tenantId, 'compliance_reports', 'ai_hiring_illinois'))
      .then((snap) => {
        if (!cancelled) setReport(snap.exists() ? (snap.data() as MonitorReport) : null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'The report could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const generated = report?.generatedAt?.toDate?.();
  const responseRate = report && report.applicants > 0 ? report.selfIdResponses / report.applicants : null;

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1100, mx: 'auto' }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/reports')} sx={{ mb: 1 }}>
        Reports
      </Button>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        Illinois AI Hiring Monitor
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2, maxWidth: 820 }}>
        Applicants to Illinois postings: how often each self-identified group reaches Tier 1–2 and gets hired,
        compared with the best-performing group. A ratio under 0.80 (the four-fifths rule of thumb) is flagged for
        review. Groups with fewer than {report?.minGroupSize ?? 5} people aren&apos;t compared, and neither is an outcome
        with fewer than {(report as { minSelectionsToCompare?: number } | null)?.minSelectionsToCompare ?? 10}{' '}
        selections overall. Self-identification is voluntary, so race and sex numbers cover only workers who answered.
      </Typography>

      {loading ? (
        <Stack alignItems="center" sx={{ py: 6 }}>
          <CircularProgress />
        </Stack>
      ) : error ? (
        <Alert severity="error">{error}</Alert>
      ) : !report ? (
        <Alert severity="info">
          No report yet. It&apos;s generated once a day after Illinois postings receive applications.
        </Alert>
      ) : (
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip label={`${report.postings} Illinois postings`} />
            <Chip label={`${report.applicants} applicants`} />
            <Chip label={`${report.selfIdResponses} self-identified (${pct(responseRate)})`} />
            <Chip
              label={`${report.openReviewRequests} open recruiter-review requests`}
              color={report.openReviewRequests > 0 ? 'warning' : 'default'}
            />
            {generated ? <Chip variant="outlined" label={`Updated ${generated.toLocaleString()}`} /> : null}
          </Stack>
          <DimensionTable title="Race / ethnicity" rates={report.raceEthnicity} />
          <DimensionTable title="Sex" rates={report.sex} />
          <DimensionTable title="Age (from date of birth)" rates={report.ageBand} />
        </Stack>
      )}
    </Box>
  );
};

export default AiHiringMonitorReportPage;
