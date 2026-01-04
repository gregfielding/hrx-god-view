import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Chip,
  Snackbar,
  Alert,
  TableContainer,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Paper,
  IconButton,
  MenuItem,
} from '@mui/material';
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  updateDoc,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import Autocomplete from '@mui/material/Autocomplete';
import CircularProgress from '@mui/material/CircularProgress';

import jobTitlesData from '../../data/onetJobTitles.json';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

const languageOptions = [
  'English',
  'Spanish',
  'Chinese (Mandarin)',
  'Tagalog',
  'Vietnamese',
];

const physicalRequirementOptions = [
  'Standing for long periods',
  'Lifting up to 25 lbs',
  'Lifting up to 50 lbs',
  'Lifting up to 100 lbs',
  'Bending or stooping',
  'Repetitive motion',
  'Climbing ladders/stairs',
  'Operating machinery',
  'Exposure to heat/cold',
  'Use of personal protective equipment (PPE)',
];

const shiftTypeOptions = [
  'First Shift (Day)',
  'Second Shift (Evening)',
  'Third Shift (Night)',
  'Rotating Shifts',
  'Split Shift',
  'On Call',
  'Some Weekends',
  'Some Holidays',
];

const FlexPositions: React.FC = () => {
  const { tenantId } = useAuth();
  const [jobTitleInput, setJobTitleInput] = useState('');
  const [jobDescriptionInput, setJobDescriptionInput] = useState('');
  const [experienceInput, setExperienceInput] = useState('');
  const [educationInput, setEducationInput] = useState('');
  const [certifications, setCertifications] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [licenses, setLicenses] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [physicalRequirements, setPhysicalRequirements] = useState<string[]>([]);
  const [shiftTypes, setShiftTypes] = useState<string[]>([]);
  const [payRangeInput, setPayRangeInput] = useState('');
  const [jobTitles, setJobTitles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    title: '',
    description: '',
    experience: '',
    education: '',
    certifications: [] as string[],
    skills: [] as string[],
    licenses: [] as string[],
    languages: [] as string[],
    physicalRequirements: [] as string[],
    shiftType: [] as string[],
    payRange: '',
  });
  const [showAddPosition, setShowAddPosition] = useState(false);
  const [descLoading, setDescLoading] = useState(false);

  useEffect(() => {
    if (tenantId) {
      fetchJobTitles();
    }
  }, [tenantId]);

  const fetchJobTitles = async () => {
    setLoading(true);
    try {
      // Try to get from hrx-flex module settings first
      const flexModuleRef = doc(db, 'tenants', tenantId, 'modules', 'hrx-flex');
      const flexDoc = await getDoc(flexModuleRef);
      
      if (flexDoc.exists() && flexDoc.data().jobTitles) {
        // If jobTitles exists in module settings, use that
        setJobTitles(flexDoc.data().jobTitles.map((item: any, index: number) => ({
          id: index.toString(),
          ...item
        })));
      } else {
        // Fallback to subcollection
        const jobTitlesCollection = collection(db, 'tenants', tenantId, 'modules', 'hrx-flex', 'jobTitles');
        const snapshot = await getDocs(jobTitlesCollection);
        const jobTitlesData = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data()
        }));
        setJobTitles(jobTitlesData);
      }
    } catch (err: any) {
      console.error('Error fetching job titles:', err);
      setError(err.message || 'Failed to fetch job titles');
    }
    setLoading(false);
  };

  const handleAddJobTitle = async () => {
    if (!jobTitleInput.trim() || !tenantId) return;
    setLoading(true);
    setError('');
    try {
      const newJobTitle = {
        title: jobTitleInput.trim(),
        description: jobDescriptionInput.trim(),
        experience: experienceInput.trim(),
        education: educationInput.trim(),
        certifications: certifications,
        skills: skills,
        licenses: licenses,
        languages: languages,
        physicalRequirements: physicalRequirements,
        shiftType: shiftTypes,
        payRange: payRangeInput.trim(),
      };

      // Try to add to subcollection first
      try {
        const jobTitlesCollection = collection(db, 'tenants', tenantId, 'modules', 'hrx-flex', 'jobTitles');
        await addDoc(jobTitlesCollection, newJobTitle);
      } catch (subcollectionError) {
        // If subcollection fails, add to module settings
        const flexModuleRef = doc(db, 'tenants', tenantId, 'modules', 'hrx-flex');
        const currentData = (await getDoc(flexModuleRef)).data() || {};
        const existingJobTitles = currentData.jobTitles || [];
        await setDoc(flexModuleRef, {
          ...currentData,
          jobTitles: [...existingJobTitles, newJobTitle]
        }, { merge: true });
      }

      setJobTitles([...jobTitles, { ...newJobTitle, id: Date.now().toString() }]);
      setJobTitleInput('');
      setJobDescriptionInput('');
      setExperienceInput('');
      setEducationInput('');
      setCertifications([]);
      setSkills([]);
      setLicenses([]);
      setLanguages([]);
      setPhysicalRequirements([]);
      setShiftTypes([]);
      setPayRangeInput('');
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to add job title');
    }
    setLoading(false);
  };

  const handleDeleteJobTitle = async (jobTitleId: string) => {
    setLoading(true);
    setError('');
    try {
      // Try to delete from subcollection first
      try {
        const jobTitleRef = doc(db, 'tenants', tenantId, 'modules', 'hrx-flex', 'jobTitles', jobTitleId);
        await deleteDoc(jobTitleRef);
      } catch (subcollectionError) {
        // If subcollection fails, update module settings
        const flexModuleRef = doc(db, 'tenants', tenantId, 'modules', 'hrx-flex');
        const currentData = (await getDoc(flexModuleRef)).data() || {};
        const existingJobTitles = currentData.jobTitles || [];
        const updatedJobTitles = existingJobTitles.filter((_: any, index: number) => index.toString() !== jobTitleId);
        await setDoc(flexModuleRef, {
          ...currentData,
          jobTitles: updatedJobTitles
        }, { merge: true });
      }

      setJobTitles(jobTitles.filter(j => j.id !== jobTitleId));
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to delete job title');
    }
    setLoading(false);
  };

  const handleEdit = (job: any) => {
    setEditId(job.id);
    setEditForm({
      title: job.title,
      description: job.description,
      experience: job.experience || '',
      education: job.education || '',
      certifications: Array.isArray(job.certifications) ? job.certifications : [],
      skills: Array.isArray(job.skills) ? job.skills : [],
      licenses: Array.isArray(job.licenses) ? job.licenses : [],
      languages: Array.isArray(job.languages) ? job.languages : [],
      physicalRequirements: Array.isArray(job.physicalRequirements) ? job.physicalRequirements : [],
      shiftType: Array.isArray(job.shiftType) ? job.shiftType : [],
      payRange: job.payRange || '',
    });
  };

  const handleEditChange = (field: string, value: any) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleEditSave = async () => {
    if (!editId || !tenantId) return;
    setLoading(true);
    setError('');
    try {
      const updatedJobTitle = {
        title: editForm.title,
        description: editForm.description,
        experience: editForm.experience,
        education: editForm.education,
        certifications: editForm.certifications,
        skills: editForm.skills,
        licenses: editForm.licenses,
        languages: editForm.languages,
        physicalRequirements: editForm.physicalRequirements,
        shiftType: editForm.shiftType,
        payRange: editForm.payRange,
      };

      // Try to update in subcollection first
      try {
        const jobTitleRef = doc(db, 'tenants', tenantId, 'modules', 'hrx-flex', 'jobTitles', editId);
        await updateDoc(jobTitleRef, updatedJobTitle);
      } catch (subcollectionError) {
        // If subcollection fails, update module settings
        const flexModuleRef = doc(db, 'tenants', tenantId, 'modules', 'hrx-flex');
        const currentData = (await getDoc(flexModuleRef)).data() || {};
        const existingJobTitles = currentData.jobTitles || [];
        const updatedJobTitles = existingJobTitles.map((jobTitle: any, index: number) => 
          index.toString() === editId ? { ...jobTitle, ...updatedJobTitle } : jobTitle
        );
        await setDoc(flexModuleRef, {
          ...currentData,
          jobTitles: updatedJobTitles
        }, { merge: true });
      }

      setJobTitles(jobTitles.map(j => 
        j.id === editId ? { ...j, ...updatedJobTitle } : j
      ));
      setEditId(null);
      setEditForm({
        title: '',
        description: '',
        experience: '',
        education: '',
        certifications: [],
        skills: [],
        licenses: [],
        languages: [],
        physicalRequirements: [],
        shiftType: [],
        payRange: '',
      });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to update job title');
    }
    setLoading(false);
  };

  const handleEditCancel = () => {
    setEditId(null);
    setEditForm({
      title: '',
      description: '',
      experience: '',
      education: '',
      certifications: [],
      skills: [],
      licenses: [],
      languages: [],
      physicalRequirements: [],
      shiftType: [],
      payRange: '',
    });
  };

  // AI job description generation
  const callGenerateDescription = async (title: string) => {
    if (!title) return;
    console.log('Generating job description for:', title);
    setDescLoading(true);
    try {
      const functions = getFunctions();
      const generateJobDescription = httpsCallable(functions, 'generateJobDescription');
      console.log('Calling generateJobDescription function...');
      const result = await generateJobDescription({ title });
      const data = result.data as { description: string };
      console.log('Received description:', data.description);
      setJobDescriptionInput(data.description || '');
    } catch (err: any) {
      console.error('Failed to generate job description:', err);
      setJobDescriptionInput('');
    }
    setDescLoading(false);
  };

  // AI suggestions for certifications, licenses, and skills
  const generateJobRequirements = async (title: string) => {
    if (!title) return;
    console.log('Generating job requirements for:', title);
    
    // Expanded requirements for healthcare and common jobs
    const requirementsMap: Record<string, { certifications: string[], licenses: string[], skills: string[] }> = {
      'Forklift Driver': {
        certifications: ['Forklift Certification', 'OSHA Safety Training'],
        licenses: ['Forklift Operator License'],
        skills: ['Equipment Operation', 'Safety Procedures', 'Inventory Management']
      },
      'Truck Driver': {
        certifications: ['CDL Training', 'Hazmat Certification'],
        licenses: ['Commercial Driver License (CDL)', 'Hazmat Endorsement'],
        skills: ['Route Planning', 'Vehicle Maintenance', 'Logbook Management']
      },
      'Warehouse Worker': {
        certifications: ['OSHA Safety Training', 'First Aid Certification'],
        licenses: [],
        skills: ['Inventory Management', 'Order Picking', 'Equipment Operation']
      },
      'Security Guard': {
        certifications: ['Security Guard Training', 'First Aid Certification'],
        licenses: ['Security Guard License'],
        skills: ['Surveillance', 'Emergency Response', 'Customer Service']
      },
      'Janitor': {
        certifications: ['OSHA Safety Training'],
        licenses: [],
        skills: ['Cleaning Procedures', 'Equipment Maintenance', 'Chemical Safety']
      },
      'Construction Worker': {
        certifications: ['OSHA Safety Training', 'Construction Safety'],
        licenses: [],
        skills: ['Blueprint Reading', 'Tool Operation', 'Safety Procedures']
      },
      'Electrician': {
        certifications: ['Electrical Apprenticeship', 'OSHA Safety Training'],
        licenses: ['Electrical License'],
        skills: ['Electrical Systems', 'Troubleshooting', 'Code Compliance']
      },
      'Plumber': {
        certifications: ['Plumbing Apprenticeship', 'OSHA Safety Training'],
        licenses: ['Plumbing License'],
        skills: ['Pipe Systems', 'Troubleshooting', 'Code Compliance']
      },
      'Carpenter': {
        certifications: ['Carpentry Apprenticeship', 'OSHA Safety Training'],
        licenses: [],
        skills: ['Woodworking', 'Blueprint Reading', 'Tool Operation']
      },
      'Painter': {
        certifications: ['OSHA Safety Training', 'Lead Paint Certification'],
        licenses: [],
        skills: ['Surface Preparation', 'Color Mixing', 'Equipment Operation']
      },
      // Healthcare roles
      'Licensed Practical Nurse': {
        certifications: ['Basic Life Support (BLS)', 'IV Certification'],
        licenses: ['LPN License'],
        skills: ['Patient Care', 'Medication Administration', 'Vital Signs Monitoring']
      },
      'LPN': {
        certifications: ['Basic Life Support (BLS)', 'IV Certification'],
        licenses: ['LPN License'],
        skills: ['Patient Care', 'Medication Administration', 'Vital Signs Monitoring']
      },
      'Licensed Vocational Nurse': {
        certifications: ['Basic Life Support (BLS)', 'IV Certification'],
        licenses: ['LVN License'],
        skills: ['Patient Care', 'Medication Administration', 'Vital Signs Monitoring']
      },
      'Registered Nurse': {
        certifications: ['Basic Life Support (BLS)', 'ACLS', 'PALS'],
        licenses: ['RN License'],
        skills: ['Patient Assessment', 'Care Planning', 'Critical Thinking']
      },
      'RN': {
        certifications: ['Basic Life Support (BLS)', 'ACLS', 'PALS'],
        licenses: ['RN License'],
        skills: ['Patient Assessment', 'Care Planning', 'Critical Thinking']
      },
      'Certified Nursing Assistant': {
        certifications: ['CNA Certification', 'Basic Life Support (BLS)'],
        licenses: ['CNA License'],
        skills: ['Patient Hygiene', 'Mobility Assistance', 'Communication']
      },
      'CNA': {
        certifications: ['CNA Certification', 'Basic Life Support (BLS)'],
        licenses: ['CNA License'],
        skills: ['Patient Hygiene', 'Mobility Assistance', 'Communication']
      },
      'Medical Assistant': {
        certifications: ['Certified Medical Assistant (CMA)', 'Basic Life Support (BLS)'],
        licenses: [],
        skills: ['Phlebotomy', 'EKG', 'Patient Scheduling']
      },
      'Phlebotomist': {
        certifications: ['Certified Phlebotomy Technician (CPT)'],
        licenses: ['Phlebotomy License'],
        skills: ['Venipuncture', 'Specimen Handling', 'Infection Control']
      },
    };

    // Find matching requirements or use default
    const jobTitleLower = title.toLowerCase();
    let requirements = null;
    // Try exact match first
    if (requirementsMap[title]) {
      requirements = requirementsMap[title];
    } else {
      // Try partial/substring/abbreviation match
      for (const [key, value] of Object.entries(requirementsMap)) {
        const keyLower = key.toLowerCase();
        if (
          jobTitleLower === keyLower ||
          jobTitleLower.includes(keyLower) ||
          keyLower.includes(jobTitleLower) ||
          (keyLower.split(' ').map(w => w[0]).join('') === jobTitleLower.replace(/[^a-z]/g, '')) // abbreviation match
        ) {
          requirements = value;
          break;
        }
      }
    }
    // Fallbacks
    if (!requirements) {
      // Healthcare fallback
      if (jobTitleLower.includes('nurse') || jobTitleLower.includes('medical') || jobTitleLower.includes('assistant') || jobTitleLower.includes('phlebotomist')) {
        requirements = {
          certifications: ['Basic Life Support (BLS)'],
          licenses: ['State License'],
          skills: ['Patient Care', 'Communication', 'Teamwork']
        };
      } else {
        // General fallback
        requirements = {
          certifications: ['OSHA Safety Training'],
          licenses: [],
          skills: ['Communication', 'Problem Solving', 'Teamwork']
        };
      }
    }
    setCertifications(requirements.certifications);
    setLicenses(requirements.licenses);
    setSkills(requirements.skills);
  };

  if (!tenantId) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h6" color="error">
          No tenant selected. Please select a tenant to continue.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 0, width: '100%' }}>
      <Typography variant="h6" gutterBottom>
        Positions We Staff
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Manage job positions and requirements for your workforce.
      </Typography>

      {!showAddPosition && (
        <Button variant="contained" onClick={() => setShowAddPosition(true)} sx={{ mb: 2 }}>
          Add Position
        </Button>
      )}
      
      {showAddPosition && (
        <Box display="flex" flexDirection="column" gap={2} mb={4}>
          <Box display="flex" gap={2}>
            <Autocomplete
              options={jobTitlesData}
              value={jobTitleInput}
              onChange={(_, newValue) => {
                console.log('Autocomplete onChange triggered with:', newValue);
                setJobTitleInput(newValue || '');
                if (newValue) {
                  console.log('Calling generateDescription for:', newValue);
                  callGenerateDescription(newValue);
                  generateJobRequirements(newValue);
                }
              }}
              onInputChange={(_, newInputValue) => setJobTitleInput(newInputValue)}
              renderInput={(params) => (
                <TextField {...params} label="Add Job Title" sx={{ flex: 1, minWidth: 360 }} />
              )}
              freeSolo
            />
            <TextField
              label="Description"
              value={jobDescriptionInput}
              onChange={(e) => setJobDescriptionInput(e.target.value)}
              sx={{ flex: 2, minWidth: 0 }}
              multiline
              rows={5}
              InputProps={{
                endAdornment: descLoading ? <CircularProgress size={20} /> : null,
              }}
            />
          </Box>
          <Box display="flex" gap={2}>
            <TextField
              select
              label="Experience Requirements"
              value={experienceInput}
              onChange={(e) => setExperienceInput(e.target.value)}
              sx={{ flex: 1 }}
            >
              <MenuItem value="No Experience Required">No Experience Required</MenuItem>
              <MenuItem value="6 Months">6 Months</MenuItem>
              <MenuItem value="1 Year">1 Year</MenuItem>
              <MenuItem value="2 Years">2 Years</MenuItem>
              <MenuItem value="5 Years">5 Years</MenuItem>
            </TextField>
            <TextField
              select
              label="Education Requirements"
              value={educationInput}
              onChange={(e) => setEducationInput(e.target.value)}
              sx={{ flex: 1 }}
            >
              <MenuItem value="No Requirements">No Requirements</MenuItem>
              <MenuItem value="High School Diploma">High School Diploma</MenuItem>
              <MenuItem value="Trade School Certification">Trade School Certification</MenuItem>
              <MenuItem value="Associates Degree">Associates Degree</MenuItem>
              <MenuItem value="Bachelors Degree">Bachelors Degree</MenuItem>
              <MenuItem value="Masters Degree">Masters Degree</MenuItem>
              <MenuItem value="Doctorate (PhD)">Doctorate (PhD)</MenuItem>
            </TextField>
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                Certifications
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, minHeight: 40, alignItems: 'center' }}>
                {certifications.map((cert, index) => (
                  <Chip
                    key={index}
                    label={cert}
                    onDelete={() => setCertifications(certifications.filter((_, i) => i !== index))}
                    size="small"
                  />
                ))}
                {certifications.length === 0 && (
                  <Typography variant="body2" color="textSecondary">
                    Select a job title to see suggested certifications
                  </Typography>
                )}
              </Box>
            </Box>
          </Box>
          <Box display="flex" gap={2}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                Skills Required
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, minHeight: 40, alignItems: 'center' }}>
                {skills.map((skill, index) => (
                  <Chip
                    key={index}
                    label={skill}
                    onDelete={() => setSkills(skills.filter((_, i) => i !== index))}
                    size="small"
                  />
                ))}
                {skills.length === 0 && (
                  <Typography variant="body2" color="textSecondary">
                    Select a job title to see suggested skills
                  </Typography>
                )}
              </Box>
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                Licensing Requirements
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, minHeight: 40, alignItems: 'center' }}>
                {licenses.map((license, index) => (
                  <Chip
                    key={index}
                    label={license}
                    onDelete={() => setLicenses(licenses.filter((_, i) => i !== index))}
                    size="small"
                  />
                ))}
                {licenses.length === 0 && (
                  <Typography variant="body2" color="textSecondary">
                    Select a job title to see suggested licenses
                  </Typography>
                )}
              </Box>
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                Languages
              </Typography>
              <Autocomplete
                multiple
                options={languageOptions}
                value={languages}
                onChange={(_, newValue) => setLanguages(newValue)}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      variant="outlined"
                      label={option}
                      {...getTagProps({ index })}
                    />
                  ))
                }
                renderInput={(params) => (
                  <TextField {...params} label="Select Languages" placeholder="Languages" />
                )}
              />
            </Box>
          </Box>
          <Box display="flex" gap={2}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                Physical Requirements
              </Typography>
              <Autocomplete
                multiple
                options={physicalRequirementOptions}
                value={physicalRequirements}
                onChange={(_, newValue) => setPhysicalRequirements(newValue)}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      variant="outlined"
                      label={option}
                      {...getTagProps({ index })}
                    />
                  ))
                }
                renderInput={(params) => (
                  <TextField {...params} label="Select Physical Requirements" placeholder="Physical Requirements" />
                )}
              />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                Shift Type
              </Typography>
              <Autocomplete
                multiple
                options={shiftTypeOptions}
                value={shiftTypes}
                onChange={(_, newValue) => setShiftTypes(newValue)}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      variant="outlined"
                      label={option}
                      {...getTagProps({ index })}
                    />
                  ))
                }
                renderInput={(params) => (
                  <TextField {...params} label="Select Shift Types" placeholder="Shift Types" />
                )}
              />
            </Box>
            <TextField
              label="Pay Range"
              value={payRangeInput}
              onChange={(e) => setPayRangeInput(e.target.value)}
              sx={{ flex: 1 }}
            />
          </Box>
          <Box display="flex" gap={2}>
            <Button
              variant="contained"
              onClick={handleAddJobTitle}
              disabled={!jobTitleInput.trim() || loading}
            >
              Add Position
            </Button>
            <Button
              variant="outlined"
              color="secondary"
              onClick={() => {
                setShowAddPosition(false);
                setJobTitleInput('');
                setJobDescriptionInput('');
                setExperienceInput('');
                setEducationInput('');
                setCertifications([]);
                setSkills([]);
                setLicenses([]);
                setLanguages([]);
                setPhysicalRequirements([]);
                setShiftTypes([]);
                setPayRangeInput('');
              }}
            >
              Cancel
            </Button>
          </Box>
        </Box>
      )}

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Title</TableCell>
              <TableCell>Experience</TableCell>
              <TableCell>Education</TableCell>
              <TableCell>Certifications</TableCell>
              <TableCell>Skills</TableCell>
              <TableCell>Licenses</TableCell>
              <TableCell>Languages</TableCell>
              <TableCell>Physical Req.</TableCell>
              <TableCell>Shift Type</TableCell>
              <TableCell>Pay Range</TableCell>
              <TableCell>Edit</TableCell>
              <TableCell>Delete</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {jobTitles.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12}>No job titles yet.</TableCell>
              </TableRow>
            ) : (
              jobTitles.map((job) => (
                <TableRow key={job.id}>
                  <TableCell>
                    {editId === job.id ? (
                      <TextField
                        value={editForm.title}
                        onChange={(e) => handleEditChange('title', e.target.value)}
                        size="small"
                      />
                    ) : (
                      job.title
                    )}
                  </TableCell>
                  <TableCell>
                    {editId === job.id ? (
                      <TextField
                        value={editForm.experience}
                        onChange={(e) => handleEditChange('experience', e.target.value)}
                        size="small"
                      />
                    ) : (
                      job.experience
                    )}
                  </TableCell>
                  <TableCell>
                    {editId === job.id ? (
                      <TextField
                        value={editForm.education}
                        onChange={(e) => handleEditChange('education', e.target.value)}
                        size="small"
                      />
                    ) : (
                      job.education
                    )}
                  </TableCell>
                  <TableCell>
                    {editId === job.id ? (
                      <TextField
                        value={editForm.certifications.join(', ')}
                        onChange={(e) => handleEditChange('certifications', e.target.value.split(', ').filter(s => s.trim()))}
                        size="small"
                      />
                    ) : (
                      Array.isArray(job.certifications) ? job.certifications.join(', ') : job.certifications
                    )}
                  </TableCell>
                  <TableCell>
                    {editId === job.id ? (
                      <TextField
                        value={editForm.skills.join(', ')}
                        onChange={(e) => handleEditChange('skills', e.target.value.split(', ').filter(s => s.trim()))}
                        size="small"
                      />
                    ) : (
                      Array.isArray(job.skills) ? job.skills.join(', ') : job.skills
                    )}
                  </TableCell>
                  <TableCell>
                    {editId === job.id ? (
                      <TextField
                        value={editForm.licenses.join(', ')}
                        onChange={(e) => handleEditChange('licenses', e.target.value.split(', ').filter(s => s.trim()))}
                        size="small"
                      />
                    ) : (
                      Array.isArray(job.licenses) ? job.licenses.join(', ') : job.licenses
                    )}
                  </TableCell>
                  <TableCell>
                    {editId === job.id ? (
                      <TextField
                        value={editForm.languages.join(', ')}
                        onChange={(e) => handleEditChange('languages', e.target.value.split(', ').filter(s => s.trim()))}
                        size="small"
                      />
                    ) : (
                      Array.isArray(job.languages) ? job.languages.join(', ') : job.languages
                    )}
                  </TableCell>
                  <TableCell>
                    {editId === job.id ? (
                      <TextField
                        value={editForm.physicalRequirements.join(', ')}
                        onChange={(e) => handleEditChange('physicalRequirements', e.target.value.split(', ').filter(s => s.trim()))}
                        size="small"
                      />
                    ) : (
                      Array.isArray(job.physicalRequirements) ? job.physicalRequirements.join(', ') : job.physicalRequirements
                    )}
                  </TableCell>
                  <TableCell>
                    {editId === job.id ? (
                      <TextField
                        value={editForm.shiftType.join(', ')}
                        onChange={(e) => handleEditChange('shiftType', e.target.value.split(', ').filter(s => s.trim()))}
                        size="small"
                      />
                    ) : (
                      Array.isArray(job.shiftType) ? job.shiftType.join(', ') : job.shiftType
                    )}
                  </TableCell>
                  <TableCell>
                    {editId === job.id ? (
                      <TextField
                        value={editForm.payRange}
                        onChange={(e) => handleEditChange('payRange', e.target.value)}
                        size="small"
                      />
                    ) : (
                      job.payRange
                    )}
                  </TableCell>
                  <TableCell>
                    {editId === job.id ? (
                      <Button
                        size="small"
                        variant="contained"
                        onClick={handleEditSave}
                        disabled={loading || !editForm.title}
                      >
                        Save
                      </Button>
                    ) : (
                      <IconButton onClick={() => handleEdit(job)}>
                        <EditIcon />
                      </IconButton>
                    )}
                    {editId === job.id && (
                      <Button size="small" onClick={handleEditCancel} sx={{ ml: 1 }}>
                        Cancel
                      </Button>
                    )}
                  </TableCell>
                  <TableCell>
                    <IconButton color="error" onClick={() => handleDeleteJobTitle(job.id)}>
                      <DeleteIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')} sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
      <Snackbar open={success} autoHideDuration={2000} onClose={() => setSuccess(false)}>
        <Alert severity="success" sx={{ width: '100%' }}>
          Job titles updated!
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default FlexPositions; 