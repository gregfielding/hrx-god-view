import React from 'react';
import SearchIcon from '@mui/icons-material/Search';
import { InputAdornment, TextField } from '@mui/material';

/** Filters onboarding queue rows by worker display name, email, and phone (digits). */
const OnboardingQueueWorkerSearchField: React.FC<{
  id: string;
  value: string;
  onChange: (value: string) => void;
}> = ({ id, value, onChange }) => (
  <TextField
    id={id}
    size="small"
    placeholder="Search by name, email, or phone"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    InputProps={{
      startAdornment: (
        <InputAdornment position="start">
          <SearchIcon fontSize="small" color="action" />
        </InputAdornment>
      ),
    }}
    sx={{ maxWidth: 380, width: '100%' }}
  />
);

export default OnboardingQueueWorkerSearchField;
