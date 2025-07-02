import React, { useState } from 'react';
import { Accordion, AccordionSummary, AccordionDetails, Typography, TextField, Button, IconButton, Grid, MenuItem, Chip } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DeleteIcon from '@mui/icons-material/Delete';
import Autocomplete from '@mui/material/Autocomplete';

const employmentTypes = ["Full-time", "Part-time", "Contract", "Temporary", "Internship", "Volunteer", "Other"];

const emptyEntry = {
  jobTitle: '',
  employer: '',
  location: '',
  startDate: '',
  endDate: '',
  employmentType: '',
  responsibilities: '',
  skillsUsed: [],
  reference: ''
};

const WorkExperienceSection = ({ value, onChange, onetSkills, onetJobTitles }: { value: any[]; onChange: (arr: any[]) => void; onetSkills: any[]; onetJobTitles: string[] }) => {
  const [work, setWork] = useState(value || []);

  const handleFieldChange = (idx: number, field: string, val: any) => {
    const updated = work.map((entry, i) =>
      i === idx ? { ...entry, [field]: val } : entry
    );
    setWork(updated);
    onChange(updated);
  };

  const handleAdd = () => {
    const updated = [...work, { ...emptyEntry }];
    setWork(updated);
    onChange(updated);
  };

  const handleDelete = (idx: number) => {
    const updated = work.filter((_, i) => i !== idx);
    setWork(updated);
    onChange(updated);
  };

  return (
    <div>
      <Typography variant="h6" gutterBottom>Work Experience</Typography>
      {work.map((entry, idx) => (
        <Accordion key={idx} sx={{ mb: 2 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography>
              {entry.jobTitle || 'Job Title'} @ {entry.employer || 'Employer'}
              {entry.startDate && ` (${entry.startDate} - ${entry.endDate || 'Present'})`}
            </Typography>
            <IconButton onClick={e => { e.stopPropagation(); handleDelete(idx); }} size="small" sx={{ ml: 2 }}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <Autocomplete
                  options={onetJobTitles}
                  value={entry.jobTitle}
                  onChange={(_, newValue) => handleFieldChange(idx, 'jobTitle', newValue || '')}
                  renderInput={params => <TextField {...params} label="Job Title" fullWidth />}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Employer" fullWidth value={entry.employer} onChange={e => handleFieldChange(idx, 'employer', e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Location" fullWidth value={entry.location} onChange={e => handleFieldChange(idx, 'location', e.target.value)} />
              </Grid>
              <Grid item xs={6} sm={3}>
                <TextField label="Start Date" type="month" fullWidth value={entry.startDate} onChange={e => handleFieldChange(idx, 'startDate', e.target.value)} InputLabelProps={{ shrink: true }} />
              </Grid>
              <Grid item xs={6} sm={3}>
                <TextField label="End Date" type="month" fullWidth value={entry.endDate} onChange={e => handleFieldChange(idx, 'endDate', e.target.value)} InputLabelProps={{ shrink: true }} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField select label="Employment Type" fullWidth value={entry.employmentType} onChange={e => handleFieldChange(idx, 'employmentType', e.target.value)}>
                  {employmentTypes.map(type => <MenuItem key={type} value={type}>{type}</MenuItem>)}
                </TextField>
              </Grid>
              <Grid item xs={12}>
                <TextField label="Responsibilities / Achievements" fullWidth multiline minRows={2} value={entry.responsibilities} onChange={e => handleFieldChange(idx, 'responsibilities', e.target.value)} />
              </Grid>
              <Grid item xs={12}>
                <Autocomplete
                  multiple
                  options={onetSkills}
                  groupBy={option => option.type}
                  getOptionLabel={option => option.name}
                  value={entry.skillsUsed}
                  onChange={(_, newValue) => handleFieldChange(idx, 'skillsUsed', newValue)}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip label={option.name} {...getTagProps({ index })} key={option.name} />
                    ))
                  }
                  renderInput={params => <TextField {...params} label="Skills Used" fullWidth />}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Reference / Contact" fullWidth value={entry.reference} onChange={e => handleFieldChange(idx, 'reference', e.target.value)} />
              </Grid>
            </Grid>
          </AccordionDetails>
        </Accordion>
      ))}
      <Button variant="outlined" onClick={handleAdd}>Add Work Experience</Button>
    </div>
  );
};

export default WorkExperienceSection; 