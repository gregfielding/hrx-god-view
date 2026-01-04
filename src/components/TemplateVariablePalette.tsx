/**
 * Template Variable Palette Component
 * 
 * Displays available variables for template insertion
 */

import React from 'react';
import {
  Box,
  Typography,
  Stack,
  Chip,
  Paper,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

interface TemplateVariablePaletteProps {
  variables: string[];
  onVariableClick?: (variable: string) => void;
  grouped?: boolean;
}

const COMMON_VARIABLES = [
  'firstName',
  'lastName',
  'fullName',
  'email',
  'phone',
  'jobTitle',
  'locationCity',
  'locationState',
  'locationName',
  'shiftDate',
  'shiftTime',
  'shiftEndTime',
  'companyName',
  'applicationStatus',
  'assignmentStatus',
];

const TemplateVariablePalette: React.FC<TemplateVariablePaletteProps> = ({
  variables,
  onVariableClick,
  grouped = false,
}) => {
  const handleVariableClick = (variable: string) => {
    if (onVariableClick) {
      onVariableClick(variable);
    }
  };

  if (grouped) {
    const commonVars = variables.filter(v => COMMON_VARIABLES.includes(v));
    const otherVars = variables.filter(v => !COMMON_VARIABLES.includes(v));

    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" fontWeight={600} gutterBottom>
          Available Variables
        </Typography>
        
        {commonVars.length > 0 && (
          <Accordion defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="body2" fontWeight={500}>
                Common Variables ({commonVars.length})
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" gap={0.5}>
                {commonVars.map((variable) => (
                  <Chip
                    key={variable}
                    label={`{{${variable}}}`}
                    size="small"
                    variant="outlined"
                    onClick={() => handleVariableClick(variable)}
                    sx={{ cursor: 'pointer' }}
                  />
                ))}
              </Stack>
            </AccordionDetails>
          </Accordion>
        )}

        {otherVars.length > 0 && (
          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="body2" fontWeight={500}>
                Other Variables ({otherVars.length})
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" gap={0.5}>
                {otherVars.map((variable) => (
                  <Chip
                    key={variable}
                    label={`{{${variable}}}`}
                    size="small"
                    variant="outlined"
                    onClick={() => handleVariableClick(variable)}
                    sx={{ cursor: 'pointer' }}
                  />
                ))}
              </Stack>
            </AccordionDetails>
          </Accordion>
        )}

        {variables.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            No variables available. Variables are automatically detected from your template.
          </Typography>
        )}
      </Paper>
    );
  }

  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>
        Available Variables
      </Typography>
      <Stack direction="row" spacing={0.5} flexWrap="wrap" gap={0.5}>
        {variables.map((variable) => (
          <Chip
            key={variable}
            label={`{{${variable}}}`}
            size="small"
            variant="outlined"
            onClick={() => handleVariableClick(variable)}
            sx={{ cursor: 'pointer' }}
          />
        ))}
      </Stack>
      {variables.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          No variables available
        </Typography>
      )}
    </Box>
  );
};

export default TemplateVariablePalette;

