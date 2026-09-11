import React, { useState } from 'react';
import { Button, Card, CardContent, Stack, Typography } from '@mui/material';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import SupportAgentOutlinedIcon from '@mui/icons-material/SupportAgentOutlined';
import { useT } from '../../../i18n';
import RecruiterReviewRequestDialog from './RecruiterReviewRequestDialog';
import VoluntarySelfIdDialog from './VoluntarySelfIdDialog';

type Props = {
  tenantId?: string | null;
  jobId?: string | null;
  jobOrderId?: string | null;
  applicationId?: string | null;
  postingTitle?: string | null;
  /** Rendered under the actions — e.g. the prescreen gate's Continue button. */
  footer?: React.ReactNode;
};

/**
 * Illinois AI-use notice (Greg 2026-09-10): shown on Illinois postings before
 * anyone applies, at the end of the apply wizard, on the worker's Illinois
 * applications and ahead of the prescreen, with the recruiter-review and
 * voluntary self-identification entry points. Flutter parity: AiHiringNoticeCard.
 */
const AiHiringNoticeCard: React.FC<Props> = ({ tenantId, jobId, jobOrderId, applicationId, postingTitle, footer }) => {
  const t = useT();
  const [requestOpen, setRequestOpen] = useState(false);
  const [selfIdOpen, setSelfIdOpen] = useState(false);

  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <SmartToyOutlinedIcon fontSize="small" aria-hidden />
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>
            {t('aiHiring.noticeTitle')}
          </Typography>
        </Stack>
        <Typography variant="body2" sx={{ lineHeight: 1.55 }}>
          {t('aiHiring.noticeBody')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t('aiHiring.noticeData')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t('aiHiring.noticeRights')}
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
          {tenantId ? (
            <Button
              size="small"
              variant="outlined"
              startIcon={<SupportAgentOutlinedIcon fontSize="small" />}
              onClick={() => setRequestOpen(true)}
            >
              {t('aiHiring.askRecruiter')}
            </Button>
          ) : null}
          <Button size="small" onClick={() => setSelfIdOpen(true)}>
            {t('aiHiring.selfIdCta')}
          </Button>
        </Stack>
        {footer}
      </CardContent>
      {tenantId ? (
        <RecruiterReviewRequestDialog
          open={requestOpen}
          onClose={() => setRequestOpen(false)}
          tenantId={tenantId}
          jobId={jobId}
          jobOrderId={jobOrderId}
          applicationId={applicationId}
          postingTitle={postingTitle}
        />
      ) : null}
      <VoluntarySelfIdDialog open={selfIdOpen} onClose={() => setSelfIdOpen(false)} />
    </Card>
  );
};

export default AiHiringNoticeCard;
