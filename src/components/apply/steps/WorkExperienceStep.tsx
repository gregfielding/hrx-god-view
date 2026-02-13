import React, { useState, useMemo, useEffect } from 'react';
import { queueProfileUpdate, flushProfileUpdates } from '../../../utils/userProfileBatching';
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
  Autocomplete,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  IconButton,
  FormControlLabel,
  Checkbox,
  Alert
} from '@mui/material';
import { AddCircle, Delete as DeleteIcon, ExpandMore, Business, CalendarToday } from '@mui/icons-material';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../../firebase';
import onetJobTitles from '../../../data/onetJobTitles.json';
import { experienceOptions } from '../../../data/experienceOptions';

type Props = {
  value: any;
  onChange: (v: any) => void;
  context?: 'application' | 'profile';
  tenantId?: string;
  jobId?: string;
  jobPosting?: any;
};

const quickAddExperience = [
  'Line Cook',
  'Prep Cook',
  'Dishwasher',
  'Server / FOH',
  'Retail / Cashier',
];

// Generate years from 1970 to 2026 for date picker
const yearOptions = Array.from({ length: 57 }, (_, i) => 2026 - i);

// Common job titles for suggestions
const commonJobTitles = [
  'Line Cook', 'Prep Cook', 'Dishwasher', 'Server', 'Host', 'Bartender',
  'Cashier', 'Retail Associate', 'Stock Clerk', 'Janitor', 'Housekeeper',
  'Food Service Worker', 'Kitchen Helper', 'Barista', 'Delivery Driver'
];

const WorkExperienceStep: React.FC<Props> = ({ value, onChange, context = 'application', tenantId, jobId, jobPosting }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  
  const [experienceDialogOpen, setExperienceDialogOpen] = useState(false);
  const [quickAddExperienceValue, setQuickAddExperienceValue] = useState<string | null>(null);
  
  const [newExperience, setNewExperience] = useState({
    jobTitle: '',
    employer: '',
    startYear: '',
    endYear: '',
    stillWorking: false,
    showDates: false,
  });

  // Use batched updates, but flush immediately for array operations (workExperience, workHistory)
  const debouncedUpdate = (ref: any, data: any) => {
    // Queue each field for batched save
    Object.keys(data).forEach(key => {
      if (key !== 'updatedAt') {
        queueProfileUpdate(key, data[key]);
      }
    });
    // Flush immediately for critical array operations
    if (data.workExperience || data.workHistory) {
      flushProfileUpdates(true);
    }
  };

  const workExperience = value?.workExperience || value?.workHistory || [];

  // Get required experience from job posting (multiple possible fields)
  const requiredExperience = useMemo(() => {
    if (!jobPosting) return null;

    // Prefer explicit years string (e.g. "1-2 years")
    const yearsStr = jobPosting.yearsOfExperience || jobPosting.experienceYears;
    if (yearsStr && typeof yearsStr === 'string' && yearsStr.trim()) {
      let s = yearsStr.trim();
      if (/\d/.test(s) && !s.toLowerCase().includes('year')) s = `${s} of experience`;
      return s;
    }

    let expLevels: string[] = [];
    if (Array.isArray(jobPosting.experienceLevels) && jobPosting.experienceLevels.length > 0) {
      expLevels = jobPosting.experienceLevels;
    } else if (Array.isArray(jobPosting.requiredExperienceLevels) && jobPosting.requiredExperienceLevels.length > 0) {
      expLevels = jobPosting.requiredExperienceLevels;
    } else if (jobPosting.experienceRequired) {
      expLevels = Array.isArray(jobPosting.experienceRequired)
        ? jobPosting.experienceRequired
        : [jobPosting.experienceRequired];
    } else if (jobPosting.jobOrder?.experienceRequired) {
      const er = jobPosting.jobOrder.experienceRequired;
      expLevels = Array.isArray(er) ? er : [er];
    }

    if (expLevels.length === 0) return null;
    
    // Get the first experience level
    const expValueOrLabel = expLevels[0];
    if (!expValueOrLabel) return null;
    
    // Try to find matching option - could be a value (like 'entry') or a label (like 'Entry-Level (0–1 year)')
    let expOption = experienceOptions.find(opt => opt.value === expValueOrLabel);
    
    // If not found by value, try to find by label
    if (!expOption) {
      expOption = experienceOptions.find(opt => opt.label === expValueOrLabel);
    }
    
    // If still not found, check if it's already a formatted label with years
    if (!expOption) {
      // Check if it already contains years pattern like "0–1 year" or "1–2 Years"
      if (expValueOrLabel.match(/\d/)) {
        // Extract years from the label if it has parentheses
        if (expValueOrLabel.includes('(') && expValueOrLabel.includes(')')) {
          const match = expValueOrLabel.match(/\(([^)]+)\)/);
          if (match) {
            let years = match[1];
            if (years.includes('year') && !years.includes('years')) {
              years = years.replace('year', 'years');
            }
            return years;
          }
        }
        // Otherwise return the label as-is if it contains numbers
        return expValueOrLabel;
      }
      return null;
    }
    
    // Extract years from label (e.g., "Entry-Level (0–1 year)" -> "0–1 years")
    if (expOption.label.includes('(') && expOption.label.includes(')')) {
      const match = expOption.label.match(/\(([^)]+)\)/);
      if (match) {
        let years = match[1];
        // Convert singular "year" to plural "years" for the message
        if (years.includes('year') && !years.includes('years')) {
          years = years.replace('year', 'years');
        }
        return years;
      }
    }
    // Fallback: try to extract years from labels like "1–2 Years"
    if (expOption.label.match(/\d/)) {
      return expOption.label;
    }
    return null;
  }, [jobPosting]);

  // Suggest jobs based on what's already added
  const suggestedJobs = useMemo(() => {
    const addedTitles = workExperience.map((exp: any) => exp.jobTitle?.toLowerCase() || '');
    return commonJobTitles.filter(title => 
      !addedTitles.includes(title.toLowerCase())
    ).slice(0, 5);
  }, [workExperience]);

  const handleQuickAddExperience = (jobTitle: string, e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    setQuickAddExperienceValue(jobTitle);
    setNewExperience({
      jobTitle: jobTitle,
      employer: '',
      startYear: '',
      endYear: '',
      stillWorking: false,
      showDates: false,
    });
    setExperienceDialogOpen(true);
  };

  const handleSaveExperience = () => {
    const entry: any = {
      jobTitle: newExperience.jobTitle.trim(),
      employer: newExperience.employer.trim(),
    };
    
    if (newExperience.showDates || newExperience.stillWorking) {
      if (newExperience.startYear) entry.startYear = newExperience.startYear;
      if (newExperience.stillWorking) {
        entry.endYear = 'Present';
      } else if (newExperience.endYear) {
        entry.endYear = newExperience.endYear;
      }
    }
    
    const updated = [...workExperience, entry];
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
      startYear: '',
      endYear: '',
      stillWorking: false,
      showDates: false,
    });
    setQuickAddExperienceValue(null);
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

  const handleOpenExperienceDialog = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    setNewExperience({
      jobTitle: '',
      employer: '',
      startYear: '',
      endYear: '',
      stillWorking: false,
      showDates: false,
    });
    setQuickAddExperienceValue(null);
    setExperienceDialogOpen(true);
  };

  return (
    <Box>
      {/* Job requirement callout when this job has an experience requirement */}
      {requiredExperience && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <strong>This job requires:</strong> {requiredExperience.toLowerCase().includes('experience') ? requiredExperience : `${requiredExperience} of relevant work experience`}.
        </Alert>
      )}
      {/* Work Experience Section */}
      <Box sx={{ mb: 2.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
          🧑‍🍳 Work Experience
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          The more experience you list, the more jobs & pay rates you'll qualify for.
        </Typography>

        {workExperience.length > 0 ? (
          <>
            <Stack spacing={1.5} sx={{ mb: 2 }}>
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
                    alignItems: 'center',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      borderColor: 'primary.main',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                    }
                  }}
                >
                  <Box>
                    <Typography variant="body1" sx={{ fontWeight: 500 }}>
                      {entry.jobTitle || 'Job Title'}
                      {entry.employer && ` @ ${entry.employer}`}
                    </Typography>
                    {(entry.startYear || entry.startDate) && (
                      <Typography variant="body2" color="text.secondary">
                        {entry.startYear || entry.startDate} - {entry.endYear || entry.endDate || 'Still working'}
                      </Typography>
                    )}
                  </Box>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => handleDeleteExperience(idx)}
                    sx={{ ml: 1 }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
            </Stack>
            
            {workExperience.length === 1 && (
              <Box sx={{ mb: 2, p: 1.5, bgcolor: 'success.50', borderRadius: 1, border: '1px solid', borderColor: 'success.main' }}>
                <Typography variant="body2" color="success.dark" sx={{ fontWeight: 500 }}>
                  Great — adding just 1 or 2 jobs helps you get placed faster.
                </Typography>
              </Box>
            )}
            
            {workExperience.length >= 2 && (
              <Box sx={{ mb: 2, p: 1.5, bgcolor: 'success.50', borderRadius: 1, border: '1px solid', borderColor: 'success.main' }}>
                <Typography variant="body2" color="success.dark" sx={{ fontWeight: 500 }}>
                  Nice! You're now qualified for 3x more positions.
                </Typography>
              </Box>
            )}

            {/* Show suggestions after entries are added */}
            {suggestedJobs.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, fontSize: '0.85rem' }}>
                  Add more experience:
                </Typography>
                <Stack direction="row" flexWrap="wrap" gap={1}>
                  {suggestedJobs.map((jobTitle) => (
                    <Chip
                      key={jobTitle}
                      label={jobTitle}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleQuickAddExperience(jobTitle, e);
                      }}
                      variant="outlined"
                      sx={{
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        '&:hover': {
                          bgcolor: 'primary.main',
                          color: 'white',
                          borderColor: 'primary.main',
                          transform: 'translateY(-2px)',
                          boxShadow: '0 4px 8px rgba(0,0,0,0.15)'
                        }
                      }}
                    />
                  ))}
                </Stack>
              </Box>
            )}
          </>
        ) : (
          <Box sx={{ mb: 2 }}>
            <Box sx={{ mb: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                🧑‍🍳 You haven't added experience yet
              </Typography>
              <Typography variant="body2" color="text.secondary">
                (Add ANY job — fast food, retail, or gig work all count!)
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
                      bgcolor: 'primary.main',
                      color: 'white',
                      borderColor: 'primary.main',
                      transform: 'translateY(-2px)',
                      boxShadow: '0 4px 8px rgba(0,0,0,0.15)'
                    }
                  }}
                />
              ))}
            </Stack>
          </Box>
        )}

        <Chip
          label="Add Work Experience"
          onClick={(e) => handleOpenExperienceDialog(e)}
          icon={<AddCircle />}
          color="primary"
          variant={workExperience.length > 0 ? "outlined" : "filled"}
          sx={{ 
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            '&:hover': {
              transform: 'translateY(-2px)',
              boxShadow: '0 4px 8px rgba(0,0,0,0.1)'
            }
          }}
        />
      </Box>

      {/* Work Experience Dialog */}
      <Dialog 
        open={experienceDialogOpen} 
        onClose={() => setExperienceDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            position: 'fixed',
            bottom: { xs: 0, sm: 'auto' },
            top: { xs: 'auto', sm: '50%' },
            transform: { xs: 'none', sm: 'translateY(-50%)' },
            margin: { xs: 0, sm: 'auto' },
            maxHeight: { xs: '90vh', sm: '85vh' },
            borderRadius: { xs: '16px 16px 0 0', sm: 1 }
          }
        }}
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
                  required
                  InputProps={{
                    ...params.InputProps,
                    startAdornment: (
                      <Box sx={{ mr: 1, display: 'flex', alignItems: 'center' }}>
                        <Business fontSize="small" color="action" />
                      </Box>
                    )
                  }}
                />
              )}
            />
            <TextField
              label="Company"
              fullWidth
              required
              value={newExperience.employer}
              onChange={(e) => setNewExperience({ ...newExperience, employer: e.target.value })}
              InputProps={{
                startAdornment: (
                  <Box sx={{ mr: 1, display: 'flex', alignItems: 'center' }}>
                    <Business fontSize="small" color="action" />
                  </Box>
                )
              }}
            />
            
            <Accordion 
              expanded={newExperience.showDates || newExperience.stillWorking}
              onChange={(_, expanded) => setNewExperience({ ...newExperience, showDates: expanded, stillWorking: expanded ? newExperience.stillWorking : false })}
              sx={{ boxShadow: 'none', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
            >
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CalendarToday fontSize="small" color="action" />
                  <Typography variant="body2">Add Dates (Optional)</Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={2}>
                  <TextField
                    select
                    label="Start Year"
                    fullWidth
                    value={newExperience.startYear}
                    onChange={(e) => setNewExperience({ ...newExperience, startYear: e.target.value })}
                    InputProps={{
                      startAdornment: (
                        <Box sx={{ mr: 1, display: 'flex', alignItems: 'center' }}>
                          <CalendarToday fontSize="small" color="action" />
                        </Box>
                      )
                    }}
                  >
                    {yearOptions.map((year) => (
                      <MenuItem key={year} value={year.toString()}>
                        {year}
                      </MenuItem>
                    ))}
                  </TextField>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={newExperience.stillWorking}
                        onChange={(e) => setNewExperience({ 
                          ...newExperience, 
                          stillWorking: e.target.checked,
                          endYear: e.target.checked ? '' : newExperience.endYear
                        })}
                      />
                    }
                    label="I'm still working here"
                  />
                  {!newExperience.stillWorking && (
                    <TextField
                      select
                      label="End Year"
                      fullWidth
                      value={newExperience.endYear}
                      onChange={(e) => setNewExperience({ ...newExperience, endYear: e.target.value })}
                      helperText="Leave empty if still working"
                      InputProps={{
                        startAdornment: (
                          <Box sx={{ mr: 1, display: 'flex', alignItems: 'center' }}>
                            <CalendarToday fontSize="small" color="action" />
                          </Box>
                        )
                      }}
                    >
                      <MenuItem value="">Present</MenuItem>
                      {yearOptions.map((year) => (
                        <MenuItem key={year} value={year.toString()}>
                          {year}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                </Stack>
              </AccordionDetails>
            </Accordion>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, pt: 1 }}>
          <Button onClick={() => setExperienceDialogOpen(false)}>Cancel</Button>
          <Button 
            variant="contained" 
            onClick={handleSaveExperience}
            disabled={!newExperience.jobTitle || !newExperience.employer}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default WorkExperienceStep;

