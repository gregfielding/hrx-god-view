import React, { useState } from 'react';
import { 
  Box, 
  Typography, 
  Button, 
  Chip, 
  Stack, 
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  useTheme, 
  useMediaQuery,
  Autocomplete
} from '@mui/material';
import { AddCircle } from '@mui/icons-material';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../../firebase';
import onetSkills from '../../../data/onetSkills.json';
import onetJobTitles from '../../../data/onetJobTitles.json';

type Props = {
  value: any;
  onChange: (v: any) => void;
  context?: 'application' | 'profile';
  tenantId?: string;
  jobId?: string;
  jobPosting?: any;
};

const degreeTypes = [
  'High School Diploma',
  'GED',
  'Some College',
  "Associate's",
  "Bachelor's",
  "Master's",
  'Doctorate',
  'Certificate',
  'Trade School',
  'CNA Certification',
  'ServSafe',
  'Culinary School',
  'Other',
];

const quickAddEducation = [
  'High School Diploma',
  'GED',
  'CNA Certification',
  'ServSafe',
  'Culinary School',
];

const quickAddExperience = [
  'Line Cook',
  'Prep Cook',
  'Dishwasher',
  'Server / FOH',
  'Retail / Cashier',
];

const ExperienceStep: React.FC<Props> = ({ value, onChange, context = 'application', tenantId, jobId, jobPosting }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  
  const [educationDialogOpen, setEducationDialogOpen] = useState(false);
  const [experienceDialogOpen, setExperienceDialogOpen] = useState(false);
  const [quickAddEducationValue, setQuickAddEducationValue] = useState<string | null>(null);
  const [quickAddExperienceValue, setQuickAddExperienceValue] = useState<string | null>(null);
  
  const [newEducation, setNewEducation] = useState({
    school: '',
    degree: '',
    field: '',
    startDate: '',
    endDate: '',
    status: 'Completed',
  });
  
  const [newExperience, setNewExperience] = useState({
    jobTitle: '',
    employer: '',
    startDate: '',
    endDate: '',
    employmentType: 'Full-time',
  });

  const debounceRef = React.useRef<any>(null);
  const debouncedUpdate = (ref: any, data: any) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try { await updateDoc(ref, data); } catch {}
    }, 500);
  };

  const education = value?.education || [];
  const workExperience = value?.workExperience || value?.workHistory || [];

  const handleQuickAddEducation = (degree: string) => {
    setQuickAddEducationValue(degree);
    setNewEducation({
      school: '',
      degree: degree,
      field: '',
      startDate: '',
      endDate: '',
      status: 'Completed',
    });
    setEducationDialogOpen(true);
  };

  const handleQuickAddExperience = (jobTitle: string) => {
    setQuickAddExperienceValue(jobTitle);
    setNewExperience({
      jobTitle: jobTitle,
      employer: '',
      startDate: '',
      endDate: '',
      employmentType: 'Full-time',
    });
    setExperienceDialogOpen(true);
  };

  const handleSaveEducation = () => {
    const updated = [...education, { ...newEducation }];
    onChange({ ...value, education: updated });
    const uid = auth.currentUser?.uid;
    if (uid) {
      debouncedUpdate(doc(db, 'users', uid), { education: updated, updatedAt: serverTimestamp() });
    }
    setEducationDialogOpen(false);
    setNewEducation({
      school: '',
      degree: '',
      field: '',
      startDate: '',
      endDate: '',
      status: 'Completed',
    });
    setQuickAddEducationValue(null);
  };

  const handleSaveExperience = () => {
    const updated = [...workExperience, { ...newExperience }];
    onChange({ ...value, workExperience: updated, workHistory: updated });
    const uid = auth.currentUser?.uid;
    if (uid) {
      debouncedUpdate(doc(db, 'users', uid), { 
        workExperience: updated, 
        workHistory: updated, 
        updatedAt: serverTimestamp() 
      });
    }
    setExperienceDialogOpen(false);
    setNewExperience({
      jobTitle: '',
      employer: '',
      startDate: '',
      endDate: '',
      employmentType: 'Full-time',
    });
    setQuickAddExperienceValue(null);
  };

  const handleDeleteEducation = (idx: number) => {
    const updated = education.filter((_, i) => i !== idx);
    onChange({ ...value, education: updated });
    const uid = auth.currentUser?.uid;
    if (uid) {
      debouncedUpdate(doc(db, 'users', uid), { education: updated, updatedAt: serverTimestamp() });
    }
  };

  const handleDeleteExperience = (idx: number) => {
    const updated = workExperience.filter((_, i) => i !== idx);
    onChange({ ...value, workExperience: updated, workHistory: updated });
    const uid = auth.currentUser?.uid;
    if (uid) {
      debouncedUpdate(doc(db, 'users', uid), { 
        workExperience: updated, 
        workHistory: updated, 
        updatedAt: serverTimestamp() 
      });
    }
  };

  const handleOpenEducationDialog = () => {
    setNewEducation({
      school: '',
      degree: '',
      field: '',
      startDate: '',
      endDate: '',
      status: 'Completed',
    });
    setQuickAddEducationValue(null);
    setEducationDialogOpen(true);
  };

  const handleOpenExperienceDialog = () => {
    setNewExperience({
      jobTitle: '',
      employer: '',
      startDate: '',
      endDate: '',
      employmentType: 'Full-time',
    });
    setQuickAddExperienceValue(null);
    setExperienceDialogOpen(true);
  };

  return (
    <Box>
      {/* Education Section */}
      <Box sx={{ mb: 2.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
          🎓 Education
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Education (Optional — helps you qualify for more jobs)
        </Typography>

        {education.length > 0 ? (
          <Stack spacing={1} sx={{ mb: 2 }}>
            {education.map((entry: any, idx: number) => (
              <Box
                key={idx}
                sx={{
                  p: 1.5,
                  borderRadius: 1,
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: 'white',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <Box>
                  <Typography variant="body1" sx={{ fontWeight: 500 }}>
                    {entry.degree || 'Education'}
                    {entry.school && ` @ ${entry.school}`}
                  </Typography>
                  {entry.startDate && (
                    <Typography variant="body2" color="text.secondary">
                      {entry.startDate} - {entry.endDate || 'Present'}
                    </Typography>
                  )}
                </Box>
                <Button
                  size="small"
                  color="error"
                  onClick={() => handleDeleteEducation(idx)}
                  sx={{ minWidth: 'auto' }}
                >
                  Delete
                </Button>
              </Box>
            ))}
          </Stack>
        ) : (
          <Box sx={{ mb: 2 }}>
            <Box sx={{ mb: 2, p: 1.5, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                🎓 No education listed yet
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Add GED, High School Diploma, CNA License, or other training.
              </Typography>
            </Box>

            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, fontSize: '0.85rem' }}>
              Quick add:
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 2 }}>
              {quickAddEducation.map((degree) => (
                <Chip
                  key={degree}
                  label={degree}
                  onClick={() => handleQuickAddEducation(degree)}
                  variant="outlined"
                  sx={{
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      bgcolor: 'primary.light',
                      color: 'white',
                      borderColor: 'primary.light',
                      transform: 'translateY(-2px)',
                      boxShadow: '0 4px 8px rgba(0,0,0,0.15)'
                    }
                  }}
                />
              ))}
            </Stack>
          </Box>
        )}

        <Button
          variant="outlined"
          startIcon={<AddCircle />}
          onClick={handleOpenEducationDialog}
          sx={{ mt: education.length > 0 ? 0 : 0 }}
        >
          + Add Education
        </Button>
      </Box>

      {/* Work Experience Section */}
      <Box sx={{ mb: 2.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
          🧑‍🍳 Work Experience
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Work Experience (Optional — highly recommended)
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontStyle: 'italic' }}>
          The more experience you list, the more jobs & pay rates you'll qualify for.
        </Typography>

        {workExperience.length > 0 ? (
          <Stack spacing={1} sx={{ mb: 2 }}>
            {workExperience.map((entry: any, idx: number) => (
              <Box
                key={idx}
                sx={{
                  p: 1.5,
                  borderRadius: 1,
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: 'white',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <Box>
                  <Typography variant="body1" sx={{ fontWeight: 500 }}>
                    {entry.jobTitle || 'Job Title'}
                    {entry.employer && ` @ ${entry.employer}`}
                  </Typography>
                  {entry.startDate && (
                    <Typography variant="body2" color="text.secondary">
                      {entry.startDate} - {entry.endDate || 'Still working'}
                    </Typography>
                  )}
                </Box>
                <Button
                  size="small"
                  color="error"
                  onClick={() => handleDeleteExperience(idx)}
                  sx={{ minWidth: 'auto' }}
                >
                  Delete
                </Button>
              </Box>
            ))}
          </Stack>
        ) : (
          <Box sx={{ mb: 2 }}>
            <Box sx={{ mb: 2, p: 1.5, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                🧑‍🍳 No work experience yet
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Add ANY job — even non-kitchen roles count.
              </Typography>
            </Box>

            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, fontSize: '0.85rem' }}>
              Quick add:
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 2 }}>
              {quickAddExperience.map((jobTitle) => (
                <Chip
                  key={jobTitle}
                  label={jobTitle}
                  onClick={() => handleQuickAddExperience(jobTitle)}
                  variant="outlined"
                  sx={{
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      bgcolor: 'primary.light',
                      color: 'white',
                      borderColor: 'primary.light',
                      transform: 'translateY(-2px)',
                      boxShadow: '0 4px 8px rgba(0,0,0,0.15)'
                    }
                  }}
                />
              ))}
            </Stack>
          </Box>
        )}

        <Button
          variant="outlined"
          startIcon={<AddCircle />}
          onClick={handleOpenExperienceDialog}
          sx={{ mt: workExperience.length > 0 ? 0 : 0 }}
        >
          + Add Work Experience
        </Button>
      </Box>

      {/* Education Dialog */}
      <Dialog 
        open={educationDialogOpen} 
        onClose={() => setEducationDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Add Education</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              select
              label="Degree"
              fullWidth
              value={newEducation.degree}
              onChange={(e) => setNewEducation({ ...newEducation, degree: e.target.value })}
            >
              {degreeTypes.map((type) => (
                <MenuItem key={type} value={type}>
                  {type}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="School"
              fullWidth
              value={newEducation.school}
              onChange={(e) => setNewEducation({ ...newEducation, school: e.target.value })}
              placeholder="e.g. Local High School, Community College"
            />
            <TextField
              label="Field of Study (Optional)"
              fullWidth
              value={newEducation.field}
              onChange={(e) => setNewEducation({ ...newEducation, field: e.target.value })}
            />
            <TextField
              label="Start Year"
              type="month"
              fullWidth
              value={newEducation.startDate}
              onChange={(e) => setNewEducation({ ...newEducation, startDate: e.target.value })}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="End Year"
              type="month"
              fullWidth
              value={newEducation.endDate}
              onChange={(e) => setNewEducation({ ...newEducation, endDate: e.target.value })}
              InputLabelProps={{ shrink: true }}
              helperText="Leave empty if still in progress"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEducationDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveEducation}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Work Experience Dialog */}
      <Dialog 
        open={experienceDialogOpen} 
        onClose={() => setExperienceDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Add Work Experience</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Autocomplete
              freeSolo
              options={onetJobTitles}
              value={newExperience.jobTitle}
              onChange={(_, newValue) => setNewExperience({ ...newExperience, jobTitle: newValue || '' })}
              onInputChange={(_, newInputValue) => setNewExperience({ ...newExperience, jobTitle: newInputValue })}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Job Title"
                  fullWidth
                />
              )}
            />
            <TextField
              label="Company"
              fullWidth
              value={newExperience.employer}
              onChange={(e) => setNewExperience({ ...newExperience, employer: e.target.value })}
            />
            <TextField
              label="Start Year"
              type="month"
              fullWidth
              value={newExperience.startDate}
              onChange={(e) => setNewExperience({ ...newExperience, startDate: e.target.value })}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="End Year"
              type="month"
              fullWidth
              value={newExperience.endDate}
              onChange={(e) => setNewExperience({ ...newExperience, endDate: e.target.value })}
              InputLabelProps={{ shrink: true }}
              helperText="Leave empty if still working"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExperienceDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveExperience}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ExperienceStep;
