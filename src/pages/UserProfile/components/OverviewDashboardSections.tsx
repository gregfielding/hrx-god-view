import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  Stack,
  Tooltip,
  Button,
  Link,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
} from '@mui/material';
import {
  Login as LoginIcon,
  Logout as LogoutIcon,
  Edit as EditIcon,
  Work as WorkIcon,
  Assignment as AssignmentIcon,
  Description as DescriptionIcon,
  Security as SecurityIcon,
  Notifications as NotificationsIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import GppMaybeOutlinedIcon from '@mui/icons-material/GppMaybeOutlined';
import {
  formatOneDecimal,
  getCanonicalStoredAiScore,
  type ScoreSummary,
} from '../../../utils/scoreSummary';
import { recruiterTableLetterGrade } from '../../../utils/recruiterUsersReadinessDisplay';
import { overallRiskBandLabel } from '../utils/recordHeaderScoreHelpers';
import UserEntityOnboardingStatusCell from '../../../components/tables/UserEntityOnboardingStatusCell';
import type { UserListEntityOnboardingItem } from '../../../utils/userListEntityEmploymentStatus';
import {
  composeOverviewBlockersOperational,
  riskSeverityChipColor,
} from '../utils/overviewDashboardComposer';
import {
  normalizeRiskProfileFromUserDoc,
  workerRiskPrimaryLine,
  workerRiskTooltipContent,
} from '../../../utils/workerRiskProfileDisplay';
import { recordHeaderTooltipComponentsProps } from './recordHeaderStyles';
import WorkAuthorizedChip from '../../../components/WorkAuthorizedChip';
import ShiftPreferencesCard from './ShiftPreferencesCard';
import type { OverviewQualificationsData } from '../utils/overviewQualificationsSnapshot';

/** User-record overview only: flat cards, no hover elevation (jobs board etc. unchanged). */
const overviewCardFlatSx = {
  boxShadow: 'none',
  transition: 'none',
  '&:hover': { boxShadow: 'none' },
} as const;

/**
 * Shared semantic + visual style for Overview tab card titles.
 * All use the same `h2` for a consistent heading level under the page title.
 */
export const overviewSectionTitleTypographyProps = {
  component: 'h2' as const,
  variant: 'subtitle2' as const,
  sx: {
    fontWeight: 600,
    letterSpacing: '0.03em',
    fontSize: '0.78rem',
    textTransform: 'uppercase' as const,
    color: 'text.primary',
    lineHeight: 1.2,
    m: 0,
  },
} as const;

/**
 * Sub-headings inside overview cards (e.g. Contact & identity, Home address).
 * Must stay smaller than the card title (`overviewSectionTitleTypographyProps`).
 */
export const overviewSubsectionHeadingTypographyProps = {
  component: 'h3' as const,
  variant: 'subtitle2' as const,
  sx: {
    fontWeight: 600,
    color: 'text.secondary',
    mb: 0.75,
    fontSize: '0.68rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    lineHeight: 1.2,
    m: 0,
  },
} as const;

/**
 * Default body copy for profile field values — matches Qualifications / overview body text.
 */
export const overviewProfileFieldValueSx = {
  fontSize: '0.78rem',
  lineHeight: 1.45,
  color: 'text.secondary',
} as const;

/** Semibold label prefix on the same line as body copy (same font size as {@link overviewProfileFieldValueSx}). */
export const overviewInlineLabelSx = {
  fontWeight: 600,
  color: 'text.primary',
} as const;

/** Text actions in card headers (More, Resume, Score) — same type scale as body, no extra font size tier. */
export const overviewCardHeaderTextButtonSx = {
  ...overviewProfileFieldValueSx,
  minWidth: 0,
  py: 0,
  px: 0.35,
  textTransform: 'none' as const,
  fontWeight: 500,
} as const;

/** Skill / language chips aligned to overview body size (one visual rhythm with {@link overviewProfileFieldValueSx}). */
export const overviewBodyChipSx = {
  height: 'auto',
  fontSize: '0.78rem',
  lineHeight: 1.45,
  py: 0.35,
  '& .MuiChip-label': {
    px: 0.75,
    whiteSpace: 'normal',
  },
} as const;

export type OverviewDeploymentSnapshotProps = {
  showRecruiterOps: boolean;
  scoreSummary?: ScoreSummary | null;
  riskProfileRaw: unknown;
  workAuthorized: boolean;
  entityItems: UserListEntityOnboardingItem[];
  entityLoading: boolean;
  onOpenEmploymentTab?: () => void;
};

/**
 * Section 1: Deployment snapshot — readiness, risk, blockers (score/interview live on record header).
 */
export function OverviewDeploymentSnapshotCard({
  showRecruiterOps,
  scoreSummary,
  riskProfileRaw,
  workAuthorized,
  entityItems,
  entityLoading,
  onOpenEmploymentTab,
}: OverviewDeploymentSnapshotProps) {
  if (!showRecruiterOps) return null;

  const risk = normalizeRiskProfileFromUserDoc(riskProfileRaw);
  const riskLine = workerRiskPrimaryLine(risk);
  const riskTip = workerRiskTooltipContent(risk);
  const blockers = composeOverviewBlockersOperational({
    workAuthorized,
    scoreSummary,
  });

  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        ...overviewCardFlatSx,
      }}
    >
      <CardContent sx={{ py: 1, px: 1.25, '&:last-child': { pb: 1 } }}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={1} flexWrap="wrap">
          <Box sx={{ minWidth: 0 }}>
            <Typography {...overviewSectionTitleTypographyProps}>Deployment snapshot</Typography>
          </Box>
          {onOpenEmploymentTab && (
            <Button
              size="small"
              variant="text"
              sx={{ minWidth: 0, fontSize: '0.68rem', py: 0.125, px: 0.4, color: 'text.secondary', fontWeight: 500 }}
              onClick={onOpenEmploymentTab}
            >
              Employment
            </Button>
          )}
        </Stack>

        <Stack spacing={0.75} sx={{ mt: 0.75 }}>
          {/* Readiness */}
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.35, fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.06em' }}>
              Readiness
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
              {entityLoading ? (
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem' }}>
                  Loading…
                </Typography>
              ) : entityItems.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem' }}>
                  No active entity employment on file
                </Typography>
              ) : (
                <UserEntityOnboardingStatusCell
                  items={entityItems}
                  loading={false}
                  emptyDisplay="hidden"
                  density="compact"
                />
              )}
            </Box>
          </Box>

          {/* Risk + blockers — operational column */}
          {(riskLine || blockers.length > 0) && (
            <Box
              sx={{
                pl: 1.25,
                borderLeft: '2px solid',
                borderColor: 'divider',
                py: 0.25,
              }}
            >
              {riskLine && (
                <Box sx={{ mb: blockers.length > 0 ? 0.75 : 0 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.35, fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.06em' }}>
                    Top concern
                  </Typography>
                  <Tooltip title={riskTip || ''} arrow placement="top" componentsProps={recordHeaderTooltipComponentsProps}>
                    <Chip
                      size="small"
                      icon={<WarningAmberOutlinedIcon sx={{ fontSize: 14 }} />}
                      label={riskLine}
                      color={riskSeverityChipColor(risk)}
                      variant="outlined"
                      sx={{
                        maxWidth: '100%',
                        height: 'auto',
                        py: 0.125,
                        fontSize: '0.75rem',
                        '& .MuiChip-label': { whiteSpace: 'normal', lineHeight: 1.25 },
                      }}
                    />
                  </Tooltip>
                </Box>
              )}
              {blockers.length > 0 && (
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.35, fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.06em' }}>
                    Attention
                  </Typography>
                  <Stack direction="row" flexWrap="wrap" gap={0.35}>
                    {blockers.map((b, i) => (
                      <Chip
                        key={i}
                        size="small"
                        label={b.label}
                        color={b.severity === 'error' ? 'error' : b.severity === 'warning' ? 'warning' : 'default'}
                        variant={b.severity === 'info' ? 'outlined' : 'filled'}
                        sx={{ height: 22, fontSize: '0.7rem', fontWeight: 600 }}
                      />
                    ))}
                  </Stack>
                </Box>
              )}
            </Box>
          )}

          {/* Work auth — compact */}
          <Stack direction="row" alignItems="flex-start" spacing={0.75} flexWrap="wrap" sx={{ pt: 0.25 }}>
            <GppMaybeOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary', mt: 0.15 }} />
            <Typography variant="body2" sx={{ fontSize: '0.78rem', lineHeight: 1.4, color: 'text.secondary' }}>
              Work authorization: <strong style={{ color: 'inherit', fontWeight: 600 }}>{workAuthorized ? 'Yes' : 'No'}</strong>
              {' · '}
              <Link
                component="button"
                type="button"
                variant="body2"
                onClick={() => onOpenEmploymentTab?.()}
                sx={{ fontSize: '0.78rem', verticalAlign: 'baseline', fontWeight: 500 }}
              >
                Compliance detail
              </Link>
            </Typography>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

export type OverviewQualificationsCardProps = {
  uid: string;
  qualifications: OverviewQualificationsData;
  onOpenResumeTab?: () => void;
  onOpenQualificationsTab?: () => void;
};

/** Section 4: Full Qualifications snapshot (same sections as Qualifications tab, flat — no accordions). */
export function OverviewQualificationsCard({
  uid,
  qualifications: q,
  onOpenResumeTab,
  onOpenQualificationsTab,
}: OverviewQualificationsCardProps) {
  const cardSx = {
    borderRadius: 1,
    borderColor: 'divider',
    ...overviewCardFlatSx,
  } as const;

  const hasSubstance =
    q.workAuthorizedStatus !== 'skipped' ||
    q.gender.trim().length > 0 ||
    q.veteranStatus.trim().length > 0 ||
    q.disabilityStatus.trim().length > 0 ||
    q.requireSponsorship !== null ||
    q.hasResume ||
    q.bio.trim().length > 0 ||
    q.skillLabels.length > 0 ||
    q.workExperienceLines.length > 0 ||
    q.educationLines.length > 0 ||
    q.certifications.length > 0;

  const sponsorshipDisplay =
    q.requireSponsorship === null ? '—' : q.requireSponsorship ? 'Yes' : 'No';

  const eeocInlineLine = (
    <Typography
      variant="body2"
      component="p"
      sx={{
        ...overviewProfileFieldValueSx,
        m: 0,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        columnGap: 0.75,
        rowGap: 0.5,
      }}
    >
      <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
        <Box component="span" sx={overviewInlineLabelSx}>
          Gender
        </Box>
        {' — '}
        {q.gender.trim() ? q.gender : '—'}
      </Box>
      <Box component="span" aria-hidden sx={{ color: 'text.disabled', userSelect: 'none' }}>
        ·
      </Box>
      <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
        <Box component="span" sx={overviewInlineLabelSx}>
          Veteran
        </Box>
        {' — '}
        {q.veteranStatus.trim() ? q.veteranStatus : '—'}
      </Box>
      <Box component="span" aria-hidden sx={{ color: 'text.disabled', userSelect: 'none' }}>
        ·
      </Box>
      <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
        <Box component="span" sx={overviewInlineLabelSx}>
          Disability
        </Box>
        {' — '}
        {q.disabilityStatus.trim() ? q.disabilityStatus : '—'}
      </Box>
      <Box component="span" aria-hidden sx={{ color: 'text.disabled', userSelect: 'none' }}>
        ·
      </Box>
      <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
        <Box component="span" sx={overviewInlineLabelSx}>
          Sponsorship
        </Box>
        {' — '}
        {sponsorshipDisplay}
      </Box>
    </Typography>
  );

  return (
    <Card variant="outlined" sx={cardSx}>
      <CardContent sx={{ py: 1.25, px: 1.25, '&:last-child': { pb: 1.25 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1.25 }} flexWrap="wrap" gap={0.75}>
          <Typography {...overviewSectionTitleTypographyProps}>Qualifications</Typography>
          <Stack direction="row" spacing={0} sx={{ gap: 0.25 }} alignItems="center">
            {onOpenQualificationsTab && (
              <Button size="small" variant="text" sx={overviewCardHeaderTextButtonSx} onClick={onOpenQualificationsTab}>
                More
              </Button>
            )}
            {onOpenQualificationsTab && onOpenResumeTab ? (
              <Typography component="span" sx={{ ...overviewProfileFieldValueSx, userSelect: 'none', color: 'text.disabled' }}>
                ·
              </Typography>
            ) : null}
            {onOpenResumeTab && (
              <Button size="small" variant="text" sx={overviewCardHeaderTextButtonSx} onClick={onOpenResumeTab}>
                Resume
              </Button>
            )}
          </Stack>
        </Stack>

        {!hasSubstance ? (
          <Typography variant="body2" component="p" sx={{ ...overviewProfileFieldValueSx, m: 0, mb: 1.25 }}>
            No profile details on file yet. Add qualifications or a resume to build this section.
          </Typography>
        ) : null}

        <Stack spacing={1.5}>
          <Box>
            <Typography {...overviewSubsectionHeadingTypographyProps}>Resume</Typography>
            <Box sx={{ mt: 0.5 }}>
              {q.hasResume && q.resumeUrl ? (
                <Link
                  href={q.resumeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="body2"
                  sx={{ ...overviewProfileFieldValueSx, fontWeight: 500 }}
                >
                  View resume
                </Link>
              ) : q.hasResume ? (
                <Typography variant="body2" component="p" sx={{ ...overviewProfileFieldValueSx, m: 0 }}>
                  Resume on file.
                </Typography>
              ) : (
                <Typography variant="body2" component="p" sx={{ ...overviewProfileFieldValueSx, m: 0 }}>
                  No resume on file.
                </Typography>
              )}
            </Box>
          </Box>

          <Box>
            <Typography {...overviewSubsectionHeadingTypographyProps}>Bio</Typography>
            <Box sx={{ mt: 0.5 }}>
              {q.bio.trim() ? (
                <Typography variant="body2" component="p" sx={{ ...overviewProfileFieldValueSx, m: 0, whiteSpace: 'pre-wrap' }}>
                  {q.bio.trim()}
                </Typography>
              ) : (
                <Typography variant="body2" component="p" sx={{ ...overviewProfileFieldValueSx, m: 0 }}>
                  No bio.
                </Typography>
              )}
            </Box>
          </Box>

          <Box>
            <Typography {...overviewSubsectionHeadingTypographyProps}>Work authorization</Typography>
            <Box sx={{ mt: 0.5 }}>
              <WorkAuthorizedChip status={q.workAuthorizedStatus} />
            </Box>
            <Box sx={{ mt: 1 }}>{eeocInlineLine}</Box>
          </Box>

          <Box>
            <Typography {...overviewSubsectionHeadingTypographyProps}>Education</Typography>
            <Stack spacing={0.75} sx={{ mt: 0.5 }}>
              {q.educationLines.length > 0 ? (
                q.educationLines.map((line, i) => (
                  <Typography key={i} variant="body2" component="p" sx={{ ...overviewProfileFieldValueSx, m: 0 }}>
                    {line}
                  </Typography>
                ))
              ) : (
                <Typography variant="body2" component="p" sx={{ ...overviewProfileFieldValueSx, m: 0 }}>
                  No education on file.
                </Typography>
              )}
            </Stack>
          </Box>

          <Box>
            <Typography {...overviewSubsectionHeadingTypographyProps}>Certifications &amp; Licenses</Typography>
            <Stack spacing={0.75} sx={{ mt: 0.5 }}>
              {q.certifications.length > 0 ? (
                q.certifications.map((c, i) => (
                  <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography variant="body2" component="span" sx={overviewProfileFieldValueSx}>
                      {c.label}
                    </Typography>
                    {c.fileUrl ? (
                      <Link
                        href={c.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="body2"
                        sx={{ ...overviewProfileFieldValueSx, fontWeight: 500 }}
                      >
                        View file
                      </Link>
                    ) : null}
                  </Box>
                ))
              ) : (
                <Typography variant="body2" component="p" sx={{ ...overviewProfileFieldValueSx, m: 0 }}>
                  No certifications on file.
                </Typography>
              )}
            </Stack>
          </Box>

          <Box>
            <Typography {...overviewSubsectionHeadingTypographyProps}>Work experience</Typography>
            <Stack spacing={0.75} sx={{ mt: 0.5 }}>
              {q.workExperienceLines.length > 0 ? (
                q.workExperienceLines.map((line, i) => (
                  <Typography key={i} variant="body2" component="p" sx={{ ...overviewProfileFieldValueSx, m: 0 }}>
                    {line}
                  </Typography>
                ))
              ) : (
                <Typography variant="body2" component="p" sx={{ ...overviewProfileFieldValueSx, m: 0 }}>
                  No work experience on file.
                </Typography>
              )}
            </Stack>
          </Box>

          <Box>
            <Typography {...overviewSubsectionHeadingTypographyProps}>Skills</Typography>
            <Box sx={{ mt: 0.5 }}>
              {q.skillLabels.length > 0 ? (
                <Stack direction="row" flexWrap="wrap" useFlexGap gap={0.5}>
                  {q.skillLabels.map((s, i) => (
                    <Chip
                      key={`s-${i}-${s}`}
                      label={s}
                      size="small"
                      variant="outlined"
                      sx={overviewBodyChipSx}
                    />
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" component="p" sx={{ ...overviewProfileFieldValueSx, m: 0 }}>
                  No skills on file.
                </Typography>
              )}
            </Box>
          </Box>

          <Box>
            <Typography {...overviewSubsectionHeadingTypographyProps}>Availability and preferences</Typography>
            <Box sx={{ mt: 0.5 }}>
              <ShiftPreferencesCard uid={uid} titleOverride="Availability and preferences" displayOnly />
            </Box>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

export type OverviewScoringCardProps = {
  scoreSummary: ScoreSummary | undefined;
  riskProfileRaw: unknown;
  onOpenScoreTab?: () => void;
};

/** Hiring score snapshot (grade, interviews, reviews, risk, recommendations) — opens Score tab for detail. */
export function OverviewScoringCard({ scoreSummary, riskProfileRaw, onOpenScoreTab }: OverviewScoringCardProps) {
  const cardSx = { borderRadius: 1, borderColor: 'divider', ...overviewCardFlatSx } as const;

  const rawScore = getCanonicalStoredAiScore(scoreSummary);
  const hasStoredAi = rawScore !== null && !Number.isNaN(rawScore);
  const displayScore = hasStoredAi ? Math.round(rawScore!) : null;
  const grade = displayScore != null ? recruiterTableLetterGrade(displayScore) : '—';

  let scoreColor: 'success.main' | 'warning.main' | 'text.primary' = 'text.primary';
  if (displayScore != null) {
    if (displayScore >= 80) scoreColor = 'success.main';
    else if (displayScore >= 60) scoreColor = 'warning.main';
  }

  const risk = normalizeRiskProfileFromUserDoc(riskProfileRaw);
  const riskBand = overallRiskBandLabel(risk);
  const topConcernLine = workerRiskPrimaryLine(risk);

  const nextActions = (scoreSummary?.explainability?.nextActions ?? [])
    .map((a) => String(a?.label || '').trim())
    .filter(Boolean)
    .slice(0, 3);
  const firstGap = scoreSummary?.explainability?.missingFields?.[0];
  const recommendationLines: string[] = [...nextActions];
  if (recommendationLines.length < 3 && firstGap) {
    recommendationLines.push(`Profile: add ${firstGap}`);
  }

  const comps = scoreSummary?.components;
  const componentsLine =
    comps &&
    [comps.completeness, comps.depth, comps.reliability].some((n) => typeof n === 'number' && Number.isFinite(n))
      ? `Completeness ${Math.round(comps.completeness)} · Depth ${Math.round(comps.depth)} · Reliability ${Math.round(comps.reliability)}`
      : null;

  const hasInterviewAvg = scoreSummary?.interviewAvg != null && !Number.isNaN(scoreSummary.interviewAvg!);
  const hasReviewAvg = scoreSummary?.reviewAvg != null && !Number.isNaN(scoreSummary.reviewAvg!);

  const hasAny =
    hasStoredAi ||
    hasInterviewAvg ||
    hasReviewAvg ||
    componentsLine ||
    riskBand !== '—' ||
    Boolean(topConcernLine) ||
    recommendationLines.length > 0;

  return (
    <Card variant="outlined" sx={cardSx}>
      <CardContent sx={{ py: 1, px: 1.25, '&:last-child': { pb: 1 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1 }} flexWrap="wrap" gap={0.75}>
          <Typography {...overviewSectionTitleTypographyProps}>Scoring</Typography>
          {onOpenScoreTab && (
            <Button size="small" variant="text" sx={overviewCardHeaderTextButtonSx} onClick={onOpenScoreTab}>
              Score
            </Button>
          )}
        </Stack>

        {!hasAny ? (
          <Typography variant="body2" sx={overviewProfileFieldValueSx}>
            No scoring data on file yet. Interviews, reviews, and profile signals populate this section.
          </Typography>
        ) : (
          <Stack spacing={0.65} alignItems="flex-start">
            {hasStoredAi && (
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                <Typography
                  component="span"
                  sx={{
                    fontWeight: 800,
                    color: scoreColor,
                    fontSize: '1.75rem',
                    lineHeight: 1,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {grade}
                </Typography>
                <Typography
                  component="span"
                  sx={{
                    fontWeight: 700,
                    color: 'text.primary',
                    fontSize: '1.35rem',
                    lineHeight: 1,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {displayScore ?? '—'}
                </Typography>
              </Box>
            )}

            {componentsLine ? (
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.68rem', fontWeight: 500, lineHeight: 1.35 }}>
                {componentsLine}
              </Typography>
            ) : null}

            {(hasInterviewAvg || hasReviewAvg) && (
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.68rem', lineHeight: 1.35 }}>
                {hasInterviewAvg ? <>Interview avg: {formatOneDecimal(scoreSummary!.interviewAvg)}/10</> : null}
                {hasInterviewAvg && hasReviewAvg ? ' · ' : null}
                {hasReviewAvg ? <>Reviews: {formatOneDecimal(scoreSummary!.reviewAvg)}/5</> : null}
              </Typography>
            )}

            <Typography
              variant="caption"
              sx={{
                fontSize: '0.68rem',
                fontWeight: 600,
                color:
                  riskBand === 'High' ? 'error.main' : riskBand === 'Medium' ? 'warning.dark' : 'text.secondary',
              }}
            >
              Risk: {riskBand}
            </Typography>

            {topConcernLine ? (
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.74rem', lineHeight: 1.4 }}>
                {topConcernLine}
              </Typography>
            ) : null}

            {recommendationLines.length > 0 && (
              <Box sx={{ pt: 0.15, width: '100%' }}>
                <Typography
                  variant="caption"
                  sx={{
                    fontSize: '0.6rem',
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'text.secondary',
                    display: 'block',
                    mb: 0.35,
                  }}
                >
                  Recommendations
                </Typography>
                <Stack spacing={0.35} component="ul" sx={{ m: 0, pl: 2 }}>
                  {recommendationLines.map((line, i) => (
                    <Typography
                      key={i}
                      component="li"
                      variant="body2"
                      color="text.secondary"
                      sx={{ fontSize: '0.72rem', lineHeight: 1.4, display: 'list-item' }}
                    >
                      {line}
                    </Typography>
                  ))}
                </Stack>
              </Box>
            )}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

/** One row from `users/{uid}/activityLogs`. */
export type OverviewActivityLogEntry = {
  id: string;
  action: string;
  actionType: string;
  description: string;
  timestamp: Date;
  severity: string;
  source: string;
  metadata?: Record<string, unknown>;
};

function overviewActivityActionIcon(actionType: string) {
  switch (actionType) {
    case 'login':
      return <LoginIcon sx={{ fontSize: 16 }} color="success" />;
    case 'logout':
      return <LogoutIcon sx={{ fontSize: 16 }} color="error" />;
    case 'profile_update':
      return <EditIcon sx={{ fontSize: 16 }} color="primary" />;
    case 'job_application':
      return <WorkIcon sx={{ fontSize: 16 }} color="info" />;
    case 'assignment_update':
      return <AssignmentIcon sx={{ fontSize: 16 }} color="warning" />;
    case 'document_upload':
      return <DescriptionIcon sx={{ fontSize: 16 }} color="secondary" />;
    case 'security_change':
      return <SecurityIcon sx={{ fontSize: 16 }} color="error" />;
    case 'notification':
      return <NotificationsIcon sx={{ fontSize: 16 }} color="info" />;
    default:
      return <InfoIcon sx={{ fontSize: 16 }} color="action" />;
  }
}

function overviewSeverityChipColor(severity: string): 'error' | 'warning' | 'success' | 'default' {
  switch (severity) {
    case 'high':
      return 'error';
    case 'medium':
      return 'warning';
    case 'low':
      return 'success';
    default:
      return 'default';
  }
}

function overviewSourceChipColor(source: string): 'primary' | 'secondary' | 'info' | 'warning' | 'default' {
  switch (source) {
    case 'web':
      return 'primary';
    case 'mobile':
      return 'secondary';
    case 'api':
      return 'info';
    case 'system':
      return 'warning';
    default:
      return 'default';
  }
}

function formatOverviewActivityTimestamp(ts: Date) {
  return ts.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export type OverviewRecentActivityProps = {
  activities: OverviewActivityLogEntry[];
  activitiesLoading: boolean;
  activitiesError?: string | null;
};

/** Section 5: Activity log entries (condensed table). */
export function OverviewRecentActivityCard({
  activities,
  activitiesLoading,
  activitiesError,
}: OverviewRecentActivityProps) {
  const cardSx = { borderRadius: 1, borderColor: 'divider', ...overviewCardFlatSx } as const;

  const titleRow = (
    <Box sx={{ mb: 1 }}>
      <Typography {...overviewSectionTitleTypographyProps}>Activity &amp; touchpoints</Typography>
    </Box>
  );

  const emptyState = (
    <Box
      sx={{
        borderRadius: 1,
        bgcolor: 'action.hover',
        border: '1px dashed',
        borderColor: 'divider',
        px: 1.25,
        py: 1,
      }}
    >
      <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.78rem', lineHeight: 1.45 }}>
        No activity entries yet.
      </Typography>
    </Box>
  );

  return (
    <Card variant="outlined" sx={cardSx}>
      <CardContent sx={{ py: 1, px: 1.25, '&:last-child': { pb: 1 } }}>
        {titleRow}
        {activitiesError && (
          <Typography variant="body2" color="error" sx={{ fontSize: '0.78rem', mb: 1 }}>
            {activitiesError}
          </Typography>
        )}
        {activitiesLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={28} />
          </Box>
        ) : activities.length === 0 ? (
          emptyState
        ) : (
          <TableContainer
            sx={{
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.paper',
              maxHeight: { xs: 360, sm: 420 },
              overflow: 'auto',
            }}
          >
            <Table size="small" stickyHeader sx={{ minWidth: 520 }}>
              <TableHead>
                <TableRow>
                  {(['Action', 'Description', 'Severity', 'Source', 'Timestamp', 'Details'] as const).map((header) => (
                    <TableCell
                      key={header}
                      sx={{
                        fontSize: '0.62rem',
                        fontWeight: 600,
                        color: 'text.secondary',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        py: 0.5,
                        px: 0.75,
                        bgcolor: 'background.paper',
                      }}
                    >
                      {header}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {activities.map((activity) => (
                  <TableRow
                    key={activity.id}
                    sx={{
                      '&:nth-of-type(even)': { bgcolor: 'action.hover' },
                      '&:hover': { bgcolor: 'action.selected' },
                      '& td': { py: 0.4, px: 0.75, fontSize: '0.7rem', verticalAlign: 'middle', borderColor: 'divider' },
                    }}
                  >
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Box display="flex" alignItems="center" gap={0.75}>
                        {overviewActivityActionIcon(activity.actionType)}
                        <Typography component="span" sx={{ fontWeight: 600, fontSize: '0.72rem' }}>
                          {activity.action}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 320 }}>
                      <Tooltip title={activity.description} placement="top-start" enterDelay={400}>
                        <Typography
                          sx={{
                            fontSize: '0.72rem',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            display: 'block',
                          }}
                        >
                          {activity.description}
                        </Typography>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Chip
                        label={activity.severity}
                        color={overviewSeverityChipColor(activity.severity)}
                        size="small"
                        sx={{ height: 22, fontSize: '0.65rem', fontWeight: 600 }}
                      />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Chip
                        label={activity.source}
                        color={overviewSourceChipColor(activity.source)}
                        size="small"
                        variant="outlined"
                        sx={{ height: 22, fontSize: '0.65rem', fontWeight: 600 }}
                      />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>
                      {formatOverviewActivityTimestamp(activity.timestamp)}
                    </TableCell>
                    <TableCell align="right" sx={{ width: 40, pr: 0.5 }}>
                      {activity.metadata && Object.keys(activity.metadata).length > 0 ? (
                        <Tooltip title="This entry has additional details on file.">
                          <Box component="span" sx={{ display: 'inline-flex', verticalAlign: 'middle' }}>
                            <InfoIcon sx={{ fontSize: 18 }} color="action" />
                          </Box>
                        </Tooltip>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
}
