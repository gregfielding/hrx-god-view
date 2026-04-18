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
  IconButton,
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
import type { ScoreSummary } from '../../../utils/scoreSummary';
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
 * Default body copy for profile field values — matches Skills & experience bio.
 */
export const overviewProfileFieldValueSx = {
  fontSize: '0.78rem',
  lineHeight: 1.45,
  color: 'text.secondary',
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

export type OverviewSkillsExperienceProps = {
  bio: string;
  skillLabels: string[];
  workExperienceHeadlines: string[];
  onOpenResumeTab?: () => void;
  onOpenQualificationsTab?: () => void;
};

/** Section 4: Skills + experience snapshot */
export function OverviewSkillsExperienceCard({
  bio,
  skillLabels,
  workExperienceHeadlines,
  onOpenResumeTab,
  onOpenQualificationsTab,
}: OverviewSkillsExperienceProps) {
  const hasAny = bio.trim() || skillLabels.length > 0 || workExperienceHeadlines.length > 0;
  const cardSx = {
    borderRadius: 1,
    borderColor: 'divider',
    ...overviewCardFlatSx,
  } as const;

  if (!hasAny) {
    return (
      <Card variant="outlined" sx={cardSx}>
        <CardContent sx={{ py: 1, px: 1.25 }}>
          <Typography {...overviewSectionTitleTypographyProps} sx={{ ...overviewSectionTitleTypographyProps.sx, mb: 0.35 }}>
            Skills &amp; experience
          </Typography>
          <Typography variant="body2" sx={overviewProfileFieldValueSx}>
            No summary on file yet. Add skills and experience in Qualifications or Resume.
          </Typography>
          <Stack direction="row" spacing={0.75} sx={{ mt: 1 }}>
            {onOpenQualificationsTab && (
              <Button size="small" variant="outlined" sx={{ fontSize: '0.75rem', py: 0.35 }} onClick={onOpenQualificationsTab}>
                Qualifications
              </Button>
            )}
            {onOpenResumeTab && (
              <Button size="small" variant="outlined" sx={{ fontSize: '0.75rem', py: 0.35 }} onClick={onOpenResumeTab}>
                Resume
              </Button>
            )}
          </Stack>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="outlined" sx={cardSx}>
      <CardContent sx={{ py: 1, px: 1.25, '&:last-child': { pb: 1 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 0.65 }} flexWrap="wrap" gap={0.75}>
          <Typography {...overviewSectionTitleTypographyProps}>Skills &amp; experience</Typography>
          <Stack direction="row" spacing={0} sx={{ gap: 0.15 }} alignItems="center">
            {onOpenQualificationsTab && (
              <Button
                size="small"
                variant="text"
                sx={{ fontSize: '0.68rem', minWidth: 0, py: 0, px: 0.35, color: 'text.secondary', fontWeight: 500 }}
                onClick={onOpenQualificationsTab}
              >
                More
              </Button>
            )}
            {onOpenQualificationsTab && onOpenResumeTab ? (
              <Typography component="span" sx={{ color: 'text.disabled', fontSize: '0.65rem', userSelect: 'none' }}>
                ·
              </Typography>
            ) : null}
            {onOpenResumeTab && (
              <Button
                size="small"
                variant="text"
                sx={{ fontSize: '0.68rem', minWidth: 0, py: 0, px: 0.35, color: 'text.secondary', fontWeight: 500 }}
                onClick={onOpenResumeTab}
              >
                Resume
              </Button>
            )}
          </Stack>
        </Stack>
        {bio.trim() && (
          <Typography
            variant="body2"
            sx={{
              ...overviewProfileFieldValueSx,
              maxWidth: 720,
              mb: skillLabels.length || workExperienceHeadlines.length ? 0.75 : 0,
              display: '-webkit-box',
              WebkitLineClamp: 4,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {bio.trim()}
          </Typography>
        )}
        {skillLabels.length > 0 && (
          <Box sx={{ mb: workExperienceHeadlines.length ? 0.75 : 0 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.3, fontSize: '0.62rem', fontWeight: 600, letterSpacing: '0.05em' }}>
              Top skills
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={0.3}>
              {skillLabels.slice(0, 8).map((s) => (
                <Chip key={s} label={s} size="small" variant="outlined" sx={{ height: 22, fontSize: '0.68rem' }} />
              ))}
              {skillLabels.length > 8 && (
                <Chip label={`+${skillLabels.length - 8}`} size="small" variant="outlined" sx={{ height: 22, fontSize: '0.68rem' }} />
              )}
            </Stack>
          </Box>
        )}
        {workExperienceHeadlines.length > 0 && (
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.3, fontSize: '0.62rem', fontWeight: 600, letterSpacing: '0.05em' }}>
              Recent roles
            </Typography>
            <Stack spacing={0.3}>
              {workExperienceHeadlines.slice(0, 3).map((line, i) => (
                <Typography key={i} variant="body2" sx={{ fontSize: '0.78rem', lineHeight: 1.4, pl: 0.5, borderLeft: '2px solid', borderColor: 'divider' }}>
                  {line}
                </Typography>
              ))}
            </Stack>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

/** One row from `users/{uid}/activityLogs` — same shape as Activity Log tab. */
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
  onOpenActivityTab?: () => void;
  onOpenApplicationsTab?: () => void;
};

/** Section 5: Last 5 activity log entries (condensed table — same fields as Activity Log tab). */
export function OverviewRecentActivityCard({
  activities,
  activitiesLoading,
  activitiesError,
  onOpenActivityTab,
  onOpenApplicationsTab,
}: OverviewRecentActivityProps) {
  const cardSx = { borderRadius: 1, borderColor: 'divider', ...overviewCardFlatSx } as const;

  const headerActions = (
    <Stack direction="row" spacing={0} sx={{ gap: 0.25 }}>
      {onOpenApplicationsTab && (
        <Button
          size="small"
          variant="text"
          sx={{ fontSize: '0.68rem', minWidth: 0, py: 0, px: 0.35, color: 'text.secondary', fontWeight: 500 }}
          onClick={onOpenApplicationsTab}
        >
          Applications
        </Button>
      )}
      {onOpenActivityTab && (
        <Button
          size="small"
          variant="text"
          sx={{ fontSize: '0.68rem', minWidth: 0, py: 0, px: 0.35, color: 'text.secondary', fontWeight: 500 }}
          onClick={onOpenActivityTab}
        >
          Full log
        </Button>
      )}
    </Stack>
  );

  const titleRow = (
    <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} sx={{ mb: 0.75 }}>
      <Typography {...overviewSectionTitleTypographyProps}>Activity &amp; touchpoints</Typography>
      {headerActions}
    </Stack>
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
        No activity entries yet. Open Activity Log for the full history.
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
            }}
          >
            <Table size="small" sx={{ minWidth: 520 }}>
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
                        <Tooltip title="Details on file — open Activity Log">
                          <IconButton size="small" sx={{ p: 0.25 }} onClick={onOpenActivityTab}>
                            <InfoIcon sx={{ fontSize: 18 }} color="action" />
                          </IconButton>
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
