import React from 'react';
import { Box, Button, Divider, Stack, Typography, Accordion, AccordionSummary, AccordionDetails, Chip } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

type Props = {
  value: any;
  tenantName?: string;
  submitting?: boolean;
  onSubmit: () => void;
  onEditStep?: (stepIndex: number) => void;
};

const ReviewSubmitStep: React.FC<Props> = ({ value, tenantName, submitting, onSubmit, onEditStep }) => {
  return (
    <Box>
      <Box sx={{ mb: 2, p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
        <Typography variant="subtitle2" color="text.secondary">
          You’re applying for <b>{tenantName || 'this role'}</b>
        </Typography>
      </Box>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>Review your application</Typography>
      <Divider sx={{ my: 2 }} />
      <Stack spacing={1}>
        <Accordion defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>Personal</AccordionSummary>
          <AccordionDetails>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1 }}>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(value.personal || {}, null, 2)}</Typography>
              {onEditStep && (
                <Button size="small" onClick={() => onEditStep(0)} aria-label="Edit Personal Info">Edit</Button>
              )}
            </Stack>
          </AccordionDetails>
        </Accordion>

        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>Resume</AccordionSummary>
          <AccordionDetails>
            <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip label={value.resume?.parsed ? 'Provided' : 'Not provided'} size="small" />
                <Typography variant="body2" color="text.secondary">You can upload or skip this step.</Typography>
              </Stack>
              {onEditStep && (
                <Button size="small" onClick={() => onEditStep(3)} aria-label="Edit Resume">Edit</Button>
              )}
            </Stack>
          </AccordionDetails>
        </Accordion>

        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>Qualifications</AccordionSummary>
          <AccordionDetails>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1 }}>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(value.qualifications || {}, null, 2)}</Typography>
              {onEditStep && (
                <Button size="small" onClick={() => onEditStep(4)} aria-label="Edit Qualifications">Edit</Button>
              )}
            </Stack>
          </AccordionDetails>
        </Accordion>
      </Stack>
      <Stack direction="row" justifyContent="flex-end" mt={3}>
        <Button variant="contained" onClick={onSubmit} disabled={!!submitting}>Submit Application</Button>
      </Stack>
    </Box>
  );
};

export default ReviewSubmitStep;


