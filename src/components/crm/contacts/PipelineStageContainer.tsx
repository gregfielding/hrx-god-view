import React, { useState } from 'react';
import {
  Box,
  Button,
  Paper,
  TextField,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import LeadConversionIcon from '@mui/icons-material/TrendingUp';
import OpportunityIcon from '@mui/icons-material/AttachMoney';

type PipelineStage = 'contact' | 'prospect' | 'lead';
const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  contact: 'Contact',
  prospect: 'Prospect',
  lead: 'Lead',
};

/** Contact shape compatible with both CrmContact and ContactData (fullName, etc.) */
interface ContactLike {
  id?: string;
  contactName?: string;
  fullName?: string;
  companyName?: string;
  companyId?: string;
  locationId?: string;
  worksiteName?: string;
  pipelineStage?: PipelineStage | null;
  prospectFollowPlan?: string;
  leadTiming?: string;
  leadVolume?: string;
  leadNotes?: string;
}

interface PipelineStageContainerProps {
  contact: ContactLike;
  onUpdate: (updates: Record<string, unknown>) => Promise<void>;
  onCreateOpportunity?: (contact: ContactLike) => void;
}

export const PipelineStageContainer: React.FC<PipelineStageContainerProps> = ({
  contact,
  onUpdate,
  onCreateOpportunity,
}) => {
  const [convertConfirmOpen, setConvertConfirmOpen] = useState(false);
  const [prospectNotes, setProspectNotes] = useState(contact.prospectFollowPlan ?? '');
  const [leadTiming, setLeadTiming] = useState(contact.leadTiming ?? '');
  const [leadVolume, setLeadVolume] = useState(contact.leadVolume ?? '');
  const [leadNotes, setLeadNotes] = useState(contact.leadNotes ?? '');
  const stage = (contact.pipelineStage ?? 'contact') as PipelineStage;

  React.useEffect(() => {
    setProspectNotes(contact.prospectFollowPlan ?? '');
    setLeadTiming(contact.leadTiming ?? '');
    setLeadVolume(contact.leadVolume ?? '');
    setLeadNotes(contact.leadNotes ?? '');
  }, [
    contact.id,
    contact.prospectFollowPlan,
    contact.leadTiming,
    contact.leadVolume,
    contact.leadNotes,
  ]);

  if (stage === 'contact') return null;

  // Hide lead box from contact page for now (per product request)
  if (stage === 'lead') return null;

  const handleConvertToLead = () => setConvertConfirmOpen(true);
  const handleConvertConfirm = async () => {
    await onUpdate({ pipelineStage: 'lead' });
    setConvertConfirmOpen(false);
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
        Pipeline: {PIPELINE_STAGE_LABELS[stage]}
      </Typography>

      {stage === 'prospect' && (
        <>
          <TextField
            fullWidth
            label="Follow plan / qualification notes"
            placeholder="Uses staffing partners? Budget timeline? Next steps?"
            multiline
            minRows={2}
            value={prospectNotes}
            onChange={(e) => setProspectNotes(e.target.value)}
            onBlur={() => onUpdate({ prospectFollowPlan: prospectNotes })}
            sx={{ mb: 2 }}
          />
          <Button
            variant="contained"
            startIcon={<LeadConversionIcon />}
            onClick={handleConvertToLead}
          >
            Convert to Lead
          </Button>
        </>
      )}

      {/* Lead stage UI hidden for now (stage === 'lead' returns null above) */}

      <Dialog open={convertConfirmOpen} onClose={() => setConvertConfirmOpen(false)}>
        <DialogTitle>Convert to Lead?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Mark this contact as a Lead. The pipeline section will update with lead-specific fields
            and the option to create an Opportunity.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConvertConfirmOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleConvertConfirm}>
            Convert to Lead
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};
