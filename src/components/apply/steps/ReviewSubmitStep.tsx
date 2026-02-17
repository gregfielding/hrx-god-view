import React from 'react';
import { Box, Button, Divider, Stack, Typography, Accordion, AccordionSummary, AccordionDetails, Chip } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useT } from '../../../i18n';

type Props = {
  value: any;
  tenantName?: string;
  submitting?: boolean;
  onSubmit: () => void;
  onEditStep?: (stepIndex: number) => void;
};

const ReviewSubmitStep: React.FC<Props> = ({ value, tenantName, submitting, onSubmit, onEditStep }) => {
  const t = useT();
  return (
    <Box>
      <Box sx={{ mb: 2, p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
        <Typography variant="subtitle2" color="text.secondary">
          {t('apply.applyingFor')} <b>{tenantName || t('apply.thisRole')}</b>
        </Typography>
      </Box>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>{t('apply.reviewApplication')}</Typography>
      <Divider sx={{ my: 2 }} />
      <Stack spacing={1}>
        <Accordion defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>{t('apply.personal')}</AccordionSummary>
          <AccordionDetails>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1 }}>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(value.personal || {}, null, 2)}</Typography>
              {onEditStep && (
                <Button size="small" onClick={() => onEditStep(0)} aria-label={t('apply.editPersonalInfo')}>{t('apply.edit')}</Button>
              )}
            </Stack>
          </AccordionDetails>
        </Accordion>

        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>{t('apply.resume')}</AccordionSummary>
          <AccordionDetails>
            <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip label={value.resume?.parsed ? t('apply.provided') : t('apply.notProvided')} size="small" />
                <Typography variant="body2" color="text.secondary">{t('apply.youCanUploadOrSkip')}</Typography>
              </Stack>
              {onEditStep && (
                <Button size="small" onClick={() => onEditStep(3)} aria-label={t('apply.editResume')}>{t('apply.edit')}</Button>
              )}
            </Stack>
          </AccordionDetails>
        </Accordion>

        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>{t('apply.qualifications')}</AccordionSummary>
          <AccordionDetails>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1 }}>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(value.qualifications || {}, null, 2)}</Typography>
              {onEditStep && (
                <Button size="small" onClick={() => onEditStep(4)} aria-label={t('apply.editQualifications')}>{t('apply.edit')}</Button>
              )}
            </Stack>
          </AccordionDetails>
        </Accordion>
      </Stack>
      <Stack direction="row" justifyContent="flex-end" mt={3}>
        <Button variant="contained" onClick={onSubmit} disabled={!!submitting}>{t('apply.submitApplication')}</Button>
      </Stack>
    </Box>
  );
};

export default ReviewSubmitStep;


