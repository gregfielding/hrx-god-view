import React, { useState } from 'react';
import { Box, Typography, TextField, Button, Chip, MenuItem, Select, InputLabel, FormControl, Grid, IconButton } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import Autocomplete from '@mui/material/Autocomplete';
import { EducationSection, WorkExperienceSection } from './index';

const educationLevels = [
  "High School",
  "Associate's",
  "Bachelor's",
  "Master's",
  "Doctorate",
];

const backgroundStatuses = ['Passed', 'Pending', 'Failed'];
const vaccinationStatuses = ['Up to date', 'Not up to date', 'Declined'];

export interface SkillsTabProps {
  user: any;
  onUpdate: (updated: any) => void;
  onetSkills: { name: string; type: string }[];
  onetJobTitles: string[];
}

const SkillsTab: React.FC<SkillsTabProps> = ({ user, onUpdate, onetSkills, onetJobTitles }) => {
  const [appliedJobTitle, setAppliedJobTitle] = useState(user.appliedJobTitle || '');
  const [certifications, setCertifications] = useState<string[]>(user.certifications || []);
  const [certInput, setCertInput] = useState('');
  const [skills, setSkills] = useState<{ name: string; type: string }[]>(
    (user.skills || []).map((skillName: string) =>
      onetSkills.find(s => s.name === skillName) || { name: skillName, type: 'Other' }
    )
  );
  const [skillInput, setSkillInput] = useState('');
  const [languages, setLanguages] = useState<string[]>(user.languages || []);
  const [langInput, setLangInput] = useState('');
  const [specialTraining, setSpecialTraining] = useState(user.specialTraining || '');
  const [resume, setResume] = useState<File | null>(null);
  const [aspirationalJobTitles, setAspirationalJobTitles] = useState<string[]>(user.aspirationalJobTitles || []);
  const [employmentHistory, setEmploymentHistory] = useState<any[]>(user.employmentHistory || []);
  const [education, setEducation] = useState<any[]>(user.education || []);
  const [reviews, setReviews] = useState<any[]>(user.reviews || []);

  const handleAdd = (type: string) => {
    if (type === 'cert' && certInput) {
      setCertifications([...certifications, certInput]);
      setCertInput('');
    }
    if (type === 'skill' && skillInput) {
      setSkills([...skills, { name: skillInput, type: 'Other' }]);
      setSkillInput('');
    }
    if (type === 'lang' && langInput) {
      setLanguages([...languages, langInput]);
      setLangInput('');
    }
  };

  const handleDelete = (type: string, idx: number) => {
    if (type === 'cert') setCertifications(certifications.filter((_, i) => i !== idx));
    if (type === 'skill') setSkills(skills.filter((_, i) => i !== idx));
    if (type === 'lang') setLanguages(languages.filter((_, i) => i !== idx));
  };

  const handleResumeUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setResume(e.target.files[0]);
    }
  };

  const handleSave = () => {
    onUpdate({
      appliedJobTitle,
      aspirationalJobTitles,
      certifications,
      skills: skills.map(s => s.name),
      languages,
      specialTraining,
      resume,
      education,
      employmentHistory,
      reviews,
    });
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>Job Skills & Qualifications</Typography>
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6}>
          <Autocomplete
            options={onetJobTitles}
            value={appliedJobTitle}
            onChange={(_, newValue) => setAppliedJobTitle(newValue || '')}
            renderInput={params => <TextField {...params} label="Applied Job Title" fullWidth />}
          />
        </Grid>
        <Grid item xs={12}>
          <Typography variant="subtitle1">Certifications</Typography>
          <Box display="flex" alignItems="center" mb={1}>
            <TextField label="Add Certification" value={certInput} onChange={e => setCertInput(e.target.value)} size="small" />
            <IconButton onClick={() => handleAdd('cert')}><AddIcon /></IconButton>
          </Box>
          <Box display="flex" flexWrap="wrap" gap={1} mb={2}>
            {certifications.map((cert, idx) => (
              <Chip key={idx} label={cert} onDelete={() => handleDelete('cert', idx)} />
            ))}
          </Box>
        </Grid>
        <Grid item xs={12}>
          <Typography variant="subtitle1">Skills</Typography>
          <Autocomplete
            multiple
            options={onetSkills}
            groupBy={option => option.type}
            getOptionLabel={option => option.name}
            value={skills}
            onChange={(_, newValue) => setSkills(newValue)}
            renderInput={params => <TextField {...params} label="Add Skills" />}
          />
        </Grid>
        <Grid item xs={12}>
          <Typography variant="subtitle1">Languages Spoken</Typography>
          <Box display="flex" alignItems="center" mb={1}>
            <TextField label="Add Language" value={langInput} onChange={e => setLangInput(e.target.value)} size="small" />
            <IconButton onClick={() => handleAdd('lang')}><AddIcon /></IconButton>
          </Box>
          <Box display="flex" flexWrap="wrap" gap={1} mb={2}>
            {languages.map((lang, idx) => (
              <Chip key={idx} label={lang} onDelete={() => handleDelete('lang', idx)} />
            ))}
          </Box>
        </Grid>
        <Grid item xs={12}>
          <Typography variant="subtitle1">Resume / CV</Typography>
          <Button variant="contained" component="label">
            Upload Resume
            <input type="file" hidden onChange={handleResumeUpload} />
          </Button>
          {resume && <Typography variant="body2" sx={{ ml: 2 }}>{resume.name}</Typography>}
        </Grid>
        <Grid item xs={12}>
          <Autocomplete
            multiple
            options={onetJobTitles}
            value={aspirationalJobTitles}
            onChange={(_, newValue) => setAspirationalJobTitles(newValue)}
            renderInput={params => <TextField {...params} label="Aspirational Job Titles" fullWidth />}
          />
        </Grid>
        <Grid item xs={12}>
          <EducationSection value={education} onChange={setEducation} />
        </Grid>
        <Grid item xs={12}>
          <WorkExperienceSection value={employmentHistory} onChange={setEmploymentHistory} onetSkills={onetSkills} onetJobTitles={onetJobTitles} />
        </Grid>
        <Grid item xs={12}>
          <Button variant="contained" color="primary" onClick={handleSave}>Save Skills & Qualifications</Button>
        </Grid>
      </Grid>
    </Box>
  );
};

export default SkillsTab; 