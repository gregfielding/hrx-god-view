import React, { useState } from 'react';
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Typography,
  TextField,
  Button,
  IconButton,
  Grid,
  MenuItem,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DeleteIcon from '@mui/icons-material/Delete';

const degreeTypes = [
  'High School Diploma',
  'Some College',
  "Associate's",
  "Bachelor's",
  "Master's",
  'Doctorate',
  'Certificate',
  'Trade School',
  'Other',
];
const statusOptions = ['Completed', 'In Progress', 'Incomplete'];

const emptyEntry = {
  school: '',
  degree: '',
  field: '',
  startDate: '',
  endDate: '',
  status: '',
  notes: '',
};

const EducationSection = ({
  value,
  onChange,
}: {
  value: any[];
  onChange: (arr: any[]) => void;
}) => {
  const [education, setEducation] = useState(value || []);

  const handleFieldChange = (idx: number, field: string, val: string) => {
    const updated = education.map((entry, i) => (i === idx ? { ...entry, [field]: val } : entry));
    setEducation(updated);
    onChange(updated);
  };

  const handleAdd = () => {
    const updated = [...education, { ...emptyEntry }];
    setEducation(updated);
    onChange(updated);
  };

  const handleDelete = (idx: number) => {
    const updated = education.filter((_, i) => i !== idx);
    setEducation(updated);
    onChange(updated);
  };

  return (
    <div>
      <Typography variant="h6" gutterBottom>
        Education
      </Typography>
      {education.map((entry, idx) => (
        <Accordion key={idx} sx={{ mb: 2 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography>
              {entry.degree || 'Degree'} @ {entry.school || 'School'}
              {entry.startDate && ` (${entry.startDate} - ${entry.endDate || 'Present'})`}
            </Typography>
            <IconButton
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(idx);
              }}
              size="small"
              sx={{ ml: 2 }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="School"
                  fullWidth
                  value={entry.school}
                  onChange={(e) => handleFieldChange(idx, 'school', e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  select
                  label="Degree"
                  fullWidth
                  value={entry.degree}
                  onChange={(e) => handleFieldChange(idx, 'degree', e.target.value)}
                >
                  {degreeTypes.map((type) => (
                    <MenuItem key={type} value={type}>
                      {type}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Field of Study"
                  fullWidth
                  value={entry.field}
                  onChange={(e) => handleFieldChange(idx, 'field', e.target.value)}
                />
              </Grid>
              <Grid item xs={6} sm={3}>
                <TextField
                  label="Start Date"
                  type="month"
                  fullWidth
                  value={entry.startDate}
                  onChange={(e) => handleFieldChange(idx, 'startDate', e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={6} sm={3}>
                <TextField
                  label="End Date"
                  type="month"
                  fullWidth
                  value={entry.endDate}
                  onChange={(e) => handleFieldChange(idx, 'endDate', e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  select
                  label="Status"
                  fullWidth
                  value={entry.status}
                  onChange={(e) => handleFieldChange(idx, 'status', e.target.value)}
                >
                  {statusOptions.map((opt) => (
                    <MenuItem key={opt} value={opt}>
                      {opt}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label="Notes"
                  fullWidth
                  multiline
                  minRows={2}
                  value={entry.notes}
                  onChange={(e) => handleFieldChange(idx, 'notes', e.target.value)}
                />
              </Grid>
            </Grid>
          </AccordionDetails>
        </Accordion>
      ))}
      <Button variant="outlined" onClick={handleAdd}>
        Add Education
      </Button>
    </div>
  );
};

export default EducationSection;
