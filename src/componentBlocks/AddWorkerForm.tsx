import React, { useState } from 'react';
import { 
  Box, 
  Typography, 
  TextField, 
  Button, 
  Grid, 
  FormControl, 
  InputLabel, 
  Select, 
  MenuItem, 
  OutlinedInput, 
  Chip, 
  Autocomplete, 
  Snackbar, 
  Alert,
  Divider,
  FormHelperText,
  Checkbox,
  FormControlLabel,
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PersonIcon from '@mui/icons-material/Person';
import WorkIcon from '@mui/icons-material/Work';
import InfoIcon from '@mui/icons-material/Info';

// Define the prop types for the AddWorkerForm
export interface AddWorkerFormProps {
  form: any;
  onChange: (field: string, value: string | string[] | boolean | Date) => void;
  onPhoneChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: React.FormEvent) => void;
  loading: boolean;
  departments: any[];
  locations: any[];
  divisions?: any[];
  managers?: any[];
  userGroups?: any[];
  selectedUserGroups?: string[];
  setSelectedUserGroups?: (ids: string[]) => void;
  showForm: boolean;
  setShowForm: (show: boolean) => void;
  isFormValid: boolean;
  jobTitles: string[];
  error?: string;
  success?: boolean;
  setError?: (msg: string) => void;
  setSuccess?: (val: boolean) => void;
  contextType: 'agency' | 'customer';
  isStaffingCompany?: boolean;
  flexModuleEnabled?: boolean;
}

const AddWorkerForm: React.FC<AddWorkerFormProps> = ({
  form,
  onChange,
  onPhoneChange,
  onSubmit,
  loading,
  departments,
  locations,
  divisions = [],
  managers = [],
  userGroups = [],
  selectedUserGroups = [],
  setSelectedUserGroups,
  showForm,
  setShowForm,
  isFormValid,
  jobTitles,
  error,
  success,
  setError,
  setSuccess,
  contextType,
  isStaffingCompany = false,
  flexModuleEnabled = false,
}) => {
  const [expandedSection, setExpandedSection] = useState<string | false>('basic');

  const handleSectionChange = (section: string) => (event: React.SyntheticEvent, isExpanded: boolean) => {
    setExpandedSection(isExpanded ? section : false);
  };

  const handleDateChange = (field: string, value: string) => {
    onChange(field, value || '');
  };

  const handleBooleanChange = (field: string, value: boolean) => {
    onChange(field, value);
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Add New Worker
      </Typography>
      
      <form onSubmit={onSubmit}>
        {/* Basic Identity Section */}
        <Accordion 
          expanded={expandedSection === 'basic'} 
          onChange={handleSectionChange('basic')}
          defaultExpanded
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <PersonIcon sx={{ mr: 1 }} />
            <Typography variant="subtitle1">Basic Identity</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="First Name *"
                  fullWidth
                  required
                  value={form.firstName || ''}
                  onChange={(e) => onChange('firstName', e.target.value)}
                  helperText="Legal first name"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Last Name *"
                  fullWidth
                  required
                  value={form.lastName || ''}
                  onChange={(e) => onChange('lastName', e.target.value)}
                  helperText="Legal last name"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Preferred Name"
                  fullWidth
                  value={form.preferredName || ''}
                  onChange={(e) => onChange('preferredName', e.target.value)}
                  helperText="Shown in Companion/chat and dashboards"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Email *"
                  fullWidth
                  required
                  type="email"
                  value={form.email || ''}
                  onChange={(e) => onChange('email', e.target.value)}
                  helperText="Unique user login + messaging"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Phone *"
                  fullWidth
                  required
                  value={form.phone || ''}
                  onChange={onPhoneChange}
                  helperText="Used for SMS and Companion alerts"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Date of Birth"
                  fullWidth
                  required
                  type="date"
                  value={form.dateOfBirth || ''}
                  onChange={(e) => handleDateChange('dateOfBirth', e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  helperText="Used for EEO reporting or validation"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Gender</InputLabel>
                  <Select
                    value={form.gender || ''}
                    onChange={(e) => onChange('gender', e.target.value)}
                    input={<OutlinedInput label="Gender" />}
                  >
                    <MenuItem value="Male">Male</MenuItem>
                    <MenuItem value="Female">Female</MenuItem>
                    <MenuItem value="Nonbinary">Nonbinary</MenuItem>
                    <MenuItem value="Other">Other</MenuItem>
                    <MenuItem value="Prefer not to say">Prefer not to say</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          </AccordionDetails>
        </Accordion>

        {/* Employment Classification Section */}
        <Accordion 
          expanded={expandedSection === 'employment'} 
          onChange={handleSectionChange('employment')}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <WorkIcon sx={{ mr: 1 }} />
            <Typography variant="subtitle1">Employment Classification</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth required>
                  <InputLabel>Security Level *</InputLabel>
                  <Select
                    value={form.securityLevel || ''}
                    onChange={(e) => onChange('securityLevel', e.target.value)}
                    input={<OutlinedInput label="Security Level *" />}
                  >
                    <MenuItem value="7">Admin</MenuItem>
                    <MenuItem value="6">Manager</MenuItem>
                    <MenuItem value="5">Worker</MenuItem>
                    {isStaffingCompany && <MenuItem value="4">Hired Staff</MenuItem>}
                    {flexModuleEnabled && <MenuItem value="3">Flex</MenuItem>}
                    <MenuItem value="2">Applicant</MenuItem>
                    <MenuItem value="1">Dismissed</MenuItem>
                    <MenuItem value="0">Suspended</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Employment Type *</InputLabel>
                  <Select
                    value={form.employmentType || ''}
                    onChange={(e) => onChange('employmentType', e.target.value)}
                    input={<OutlinedInput label="Employment Type *" />}
                  >
                    <MenuItem value="Full-Time">Full-Time</MenuItem>
                    <MenuItem value="Part-Time">Part-Time</MenuItem>
                    <MenuItem value="Contract">Contract</MenuItem>
                    <MenuItem value="Flex">Flex</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Autocomplete
                  options={jobTitles}
                  value={form.jobTitle || ''}
                  onChange={(_, newValue) => onChange('jobTitle', newValue || '')}
                  renderInput={(params) => <TextField {...params} label="Job Title" fullWidth />}
                  freeSolo
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                {departments.length === 0 ? (
                  <TextField
                    label="Department"
                    fullWidth
                    disabled
                    value="No departments available"
                    helperText="Please create departments first"
                  />
                ) : (
                  <FormControl fullWidth>
                    <InputLabel id="department-label">Department *</InputLabel>
                    <Select
                      labelId="department-label"
                      value={form.departmentId || ''}
                      onChange={(e) => onChange('departmentId', e.target.value)}
                      input={<OutlinedInput label="Department *" />}
                    >
                      {departments.map((dept: any) => (
                        <MenuItem key={dept.id} value={dept.id}>
                          {dept.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              </Grid>
              <Grid item xs={12} sm={6}>
                {divisions.length === 0 ? (
                  <TextField
                    label="Division"
                    fullWidth
                    disabled
                    value="No divisions available"
                    helperText="Optional - useful for reporting"
                  />
                ) : (
                  <FormControl fullWidth>
                    <InputLabel id="division-label">Division</InputLabel>
                    <Select
                      labelId="division-label"
                      value={form.divisionId || ''}
                      onChange={(e) => onChange('divisionId', e.target.value)}
                      input={<OutlinedInput label="Division" />}
                    >
                      <MenuItem value="">None</MenuItem>
                      {divisions.map((div: any) => (
                        <MenuItem key={div.id} value={div.id}>
                          {div.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              </Grid>
              <Grid item xs={12} sm={6}>
                {locations.length === 0 ? (
                  <TextField
                    label="Primary Location"
                    fullWidth
                    disabled
                    value="No locations available"
                    helperText="Optional - primary physical location"
                  />
                ) : (
                  <FormControl fullWidth>
                    <InputLabel id="location-label">Primary Location</InputLabel>
                    <Select
                      labelId="location-label"
                      value={form.locationId || ''}
                      onChange={(e) => onChange('locationId', e.target.value)}
                      input={<OutlinedInput label="Primary Location" />}
                    >
                      <MenuItem value="">None</MenuItem>
                      {locations.map((loc: any) => (
                        <MenuItem key={loc.id} value={loc.id}>
                          {loc.nickname || loc.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              </Grid>
              <Grid item xs={12} sm={6}>
                {managers.length === 0 ? (
                  <TextField
                    label="Manager"
                    fullWidth
                    disabled
                    value="No managers available"
                    helperText="Optional - direct supervisor"
                  />
                ) : (
                  <Autocomplete
                    options={managers}
                    getOptionLabel={(option) => `${option.firstName} ${option.lastName}`}
                    value={managers.find(m => m.id === form.managerId) || null}
                    onChange={(_, newValue) => onChange('managerId', newValue?.id || '')}
                    renderInput={(params) => <TextField {...params} label="Manager" fullWidth />}
                    isOptionEqualToValue={(option, value) => option.id === value.id}
                  />
                )}
              </Grid>
            </Grid>
          </AccordionDetails>
        </Accordion>

        {/* Metadata & Structure Section */}
        <Accordion 
          expanded={expandedSection === 'metadata'} 
          onChange={handleSectionChange('metadata')}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <InfoIcon sx={{ mr: 1 }} />
            <Typography variant="subtitle1">Metadata & Structure</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Start Date"
                  fullWidth
                  type="date"
                  value={form.startDate || ''}
                  onChange={(e) => handleDateChange('startDate', e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  helperText="Used for tenure calculations"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth>
                  <InputLabel>Work Status *</InputLabel>
                  <Select
                    value={form.workStatus || 'Active'}
                    onChange={(e) => onChange('workStatus', e.target.value)}
                    input={<OutlinedInput label="Work Status *" />}
                  >
                    <MenuItem value="Active">Active</MenuItem>
                    <MenuItem value="On Leave">On Leave</MenuItem>
                    <MenuItem value="Terminated">Terminated</MenuItem>
                    <MenuItem value="Suspended">Suspended</MenuItem>
                    <MenuItem value="Pending">Pending</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Worker ID"
                  fullWidth
                  value={form.workerId || ''}
                  onChange={(e) => onChange('workerId', e.target.value)}
                  helperText="Optional custom ID from HRIS"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Union"
                  fullWidth
                  value={form.union || ''}
                  onChange={(e) => onChange('union', e.target.value)}
                  helperText="Optional union name or boolean flag"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={form.workEligibility || false}
                      onChange={(e) => handleBooleanChange('workEligibility', e.target.checked)}
                    />
                  }
                  label="Work Eligibility"
                />
                <FormHelperText>Eligibility for employment in the region</FormHelperText>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Autocomplete
                  multiple
                  options={['English', 'Spanish', 'French', 'German', 'Chinese', 'Japanese', 'Korean', 'Arabic', 'Portuguese', 'Russian']}
                  value={form.languages || []}
                  onChange={(_, newValue) => onChange('languages', newValue)}
                  renderInput={(params) => (
                    <TextField 
                      {...params} 
                      label="Languages" 
                      fullWidth 
                      helperText="Spoken/written languages"
                    />
                  )}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip label={option} {...getTagProps({ index })} />
                    ))
                  }
                  freeSolo
                />
              </Grid>
            </Grid>
          </AccordionDetails>
        </Accordion>

        {/* User Groups Section */}
        {userGroups.length > 0 && (
          <Accordion 
            expanded={expandedSection === 'groups'} 
            onChange={handleSectionChange('groups')}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="subtitle1">User Groups</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <Autocomplete
                    multiple
                    options={userGroups}
                    getOptionLabel={(option) => option.name}
                    value={userGroups.filter(group => selectedUserGroups.includes(group.id))}
                    onChange={(_, newValue) => {
                      const groupIds = newValue.map(group => group.id);
                      setSelectedUserGroups && setSelectedUserGroups(groupIds);
                    }}
                    renderInput={(params) => <TextField {...params} label="User Groups" fullWidth />}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => (
                        <Chip label={option.name} {...getTagProps({ index })} />
                      ))
                    }
                    isOptionEqualToValue={(option, value) => option.id === value.id}
                  />
                </Grid>
              </Grid>
            </AccordionDetails>
          </Accordion>
        )}

        {/* Form Actions */}
        <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
          <Button
            type="submit"
            variant="contained"
            color="primary"
            disabled={loading || !isFormValid}
          >
            {loading ? 'Adding...' : 'Add Worker'}
          </Button>
          <Button variant="outlined" color="secondary" onClick={() => setShowForm(false)}>
            Cancel
          </Button>
        </Box>
      </form>

      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError && setError('')}>
        <Alert severity="error" onClose={() => setError && setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
      <Snackbar open={!!success} autoHideDuration={2000} onClose={() => setSuccess && setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Worker added!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default AddWorkerForm; 