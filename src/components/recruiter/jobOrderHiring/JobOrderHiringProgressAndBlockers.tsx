import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  Link as MuiLink,
  Stack,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import {
  RECRUITER_LIFECYCLE_BUCKET_LABELS,
  type RecruiterLifecycleFilterBucket,
} from '../../../utils/recruiterApplicationLifecycleBucket';

export type JobOrderHiringProgressAndBlockersProps = {
  loading: boolean;
  totalApplicants: number;
  assigned: number;
  targetReadyCount: number | null;
  targetReadyLabel: string;
  fillProgress: number | null;
  lifecycleBucketCounts: Record<RecruiterLifecycleFilterBucket, number>;
  interviewPendingCount: number;
  reviewCount: number;
  profileIncompleteCount: number;
  thresholdBlockerCount: number;
};

/** Primary funnel order with qualified surfaced as “Ready to move”. */
const FUNNEL_BUCKETS: Array<{ bucket: RecruiterLifecycleFilterBucket; funnelLabel: string }> = [
  { bucket: 'profile_incomplete', funnelLabel: RECRUITER_LIFECYCLE_BUCKET_LABELS.profile_incomplete },
  { bucket: 'interview_pending', funnelLabel: 'Interview' },
  { bucket: 'qualified', funnelLabel: 'Ready to move' },
  { bucket: 'review', funnelLabel: RECRUITER_LIFECYCLE_BUCKET_LABELS.review },
  { bucket: 'waitlisted', funnelLabel: RECRUITER_LIFECYCLE_BUCKET_LABELS.waitlisted },
];

/**
 * Zone 2 — staffing progress, funnel counts with deep links, action-oriented blockers.
 */
const JobOrderHiringProgressAndBlockers: React.FC<JobOrderHiringProgressAndBlockersProps> = ({
  loading,
  totalApplicants,
  assigned,
  targetReadyCount,
  targetReadyLabel,
  fillProgress,
  lifecycleBucketCounts,
  interviewPendingCount,
  reviewCount,
  profileIncompleteCount,
  thresholdBlockerCount,
}) => {
  const otherCombined = lifecycleBucketCounts.other + lifecycleBucketCounts.unknown_legacy;

  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          Hiring progress & blockers
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
          Summarized from applications for this job order. Open the Applications tab for row-level actions—nothing here
          duplicates that table.
        </Typography>

        {loading ? (
          <Typography variant="body2" color="text.secondary">
            Loading…
          </Typography>
        ) : (
          <Stack spacing={2.5}>
            <Box>
              <Typography variant="body2" fontWeight={600} gutterBottom>
                Staffing vs ready target
              </Typography>
              {targetReadyCount != null && targetReadyCount > 0 ? (
                <>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(100, (fillProgress ?? 0) * 100)}
                    sx={{ height: 8, borderRadius: 1, mb: 0.75 }}
                  />
                  <Typography variant="body2" color="text.secondary">
                    {assigned} assigned · target {targetReadyCount} ready ({targetReadyLabel})
                  </Typography>
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No numeric ready target on this job order—use tenant defaults or set a target when the editor ships.
                </Typography>
              )}
            </Box>

            <Box>
              <Typography variant="body2" fontWeight={600} gutterBottom>
                Funnel (lifecycle)
              </Typography>
              <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.75} sx={{ mb: 0.5 }}>
                {FUNNEL_BUCKETS.map(({ bucket, funnelLabel }) => {
                  const n = lifecycleBucketCounts[bucket];
                  const search =
                    bucket === 'qualified'
                      ? '?tab=applications&lifecycle=qualified'
                      : `?tab=applications&lifecycle=${bucket}`;
                  return (
                    <Chip
                      key={bucket}
                      size="small"
                      component={RouterLink}
                      to={search}
                      clickable
                      variant={n > 0 ? 'filled' : 'outlined'}
                      color={bucket === 'qualified' && n > 0 ? 'success' : 'default'}
                      label={`${funnelLabel} · ${n}`}
                      sx={{ fontWeight: bucket === 'qualified' ? 700 : 400 }}
                    />
                  );
                })}
                <Chip
                  size="small"
                  component={RouterLink}
                  to="?tab=applications"
                  clickable
                  variant={otherCombined > 0 ? 'filled' : 'outlined'}
                  label={`Other / legacy · ${otherCombined}`}
                />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Chips link to the Applications tab with a matching lifecycle filter where available.{' '}
                <strong>Ready to move</strong> is qualified candidates. “Other / legacy” opens Applications without a
                lifecycle filter (combines other + unknown buckets).
              </Typography>
            </Box>

            <Box>
              <Typography variant="body2" fontWeight={600} gutterBottom>
                Execution focus
              </Typography>
              <Stack component="ul" sx={{ m: 0, pl: 2.25, mb: 0 }}>
                {profileIncompleteCount > 0 ? (
                  <Typography component="li" variant="body2" sx={{ mb: 0.5 }}>
                    <MuiLink component={RouterLink} to="?tab=applications&lifecycle=profile_incomplete" underline="hover">
                      {profileIncompleteCount} candidate{profileIncompleteCount === 1 ? '' : 's'} need to complete
                      profile
                    </MuiLink>
                  </Typography>
                ) : null}
                {interviewPendingCount > 0 ? (
                  <Typography component="li" variant="body2" sx={{ mb: 0.5 }}>
                    <MuiLink component={RouterLink} to="?tab=applications&lifecycle=interview_pending" underline="hover">
                      {interviewPendingCount} candidate{interviewPendingCount === 1 ? '' : 's'} need to complete
                      interview
                    </MuiLink>
                  </Typography>
                ) : null}
                {reviewCount > 0 ? (
                  <Typography component="li" variant="body2" sx={{ mb: 0.5 }}>
                    <MuiLink component={RouterLink} to="?tab=applications&lifecycle=review" underline="hover">
                      {reviewCount} candidate{reviewCount === 1 ? '' : 's'} in recruiter review
                    </MuiLink>
                  </Typography>
                ) : null}
                {thresholdBlockerCount > 0 ? (
                  <Typography component="li" variant="body2" sx={{ mb: 0.5 }}>
                    <MuiLink component={RouterLink} to="?tab=applications" underline="hover">
                      {thresholdBlockerCount} candidate{thresholdBlockerCount === 1 ? '' : 's'} below score or job-fit
                      threshold
                    </MuiLink>
                    <Typography variant="caption" color="text.secondary" component="span" display="block">
                      Filter in Applications using lifecycle and scores; blockers are stored on application lifecycle when
                      present.
                    </Typography>
                  </Typography>
                ) : null}
                {profileIncompleteCount === 0 &&
                interviewPendingCount === 0 &&
                reviewCount === 0 &&
                thresholdBlockerCount === 0 ? (
                  <Typography variant="body2" color="text.secondary" component="li" sx={{ listStyle: 'none', ml: -2.25 }}>
                    No highlighted blockers for these buckets ({totalApplicants} applicant
                    {totalApplicants === 1 ? '' : 's'} total).
                  </Typography>
                ) : null}
              </Stack>
            </Box>

            <Box>
              <MuiLink component={RouterLink} to="?tab=applications" underline="hover" fontWeight={600}>
                Open Applications
              </MuiLink>
              <Typography variant="caption" color="text.secondary" display="block">
                Only table for applicant rows, messaging, and status changes.
              </Typography>
            </Box>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
};

export default JobOrderHiringProgressAndBlockers;
