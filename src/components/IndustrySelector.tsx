import React, { useState, useEffect } from 'react';
import {
  TextField,
  Autocomplete,
  Chip,
  Box,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormHelperText,
} from '@mui/material';
import {
  INDUSTRIES,
  Industry,
  getIndustryByCode,
  getIndustriesByCategory,
} from '../data/industries';

interface IndustrySelectorProps {
  value: string;
  onChange: (industryCode: string) => void;
  label?: string;
  required?: boolean;
  error?: boolean;
  helperText?: string;
  variant?: 'autocomplete' | 'select';
  showCategory?: boolean;
  disabled?: boolean;
  size?: 'small' | 'medium';
  fullWidth?: boolean;
}

const IndustrySelector: React.FC<IndustrySelectorProps> = ({
  value,
  onChange,
  label = 'Industry',
  required = false,
  error = false,
  helperText,
  variant = 'autocomplete',
  showCategory = true,
  disabled = false,
  size = 'medium',
  fullWidth = true,
}) => {
  const [selectedIndustry, setSelectedIndustry] = useState<Industry | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  useEffect(() => {
    if (value) {
      const industry = getIndustryByCode(value);
      setSelectedIndustry(industry || null);
      if (industry) {
        setSelectedCategory(industry.category);
      }
    } else {
      setSelectedIndustry(null);
      setSelectedCategory('');
    }
  }, [value]);

  useEffect(() => {
    const uniqueCategories = [...new Set(INDUSTRIES.map((industry) => industry.category))];
    setCategories(uniqueCategories.sort());
  }, []);

  const handleIndustryChange = (industry: Industry | null) => {
    setSelectedIndustry(industry);
    onChange(industry?.code || '');
  };

  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category);
    // Reset industry selection when category changes
    setSelectedIndustry(null);
    onChange('');
  };

  const getFilteredIndustries = () => {
    if (selectedCategory) {
      return getIndustriesByCategory(selectedCategory);
    }
    return INDUSTRIES;
  };

  if (variant === 'select') {
    return (
      <Box>
        {showCategory && (
          <FormControl fullWidth={fullWidth} size={size} sx={{ mb: 2 }} disabled={disabled}>
            <InputLabel>Industry Category</InputLabel>
            <Select
              value={selectedCategory}
              label="Industry Category"
              onChange={(e) => handleCategoryChange(e.target.value)}
            >
              <MenuItem value="">All Categories</MenuItem>
              {categories.map((category) => (
                <MenuItem key={category} value={category}>
                  {category}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

        <FormControl
          fullWidth={fullWidth}
          size={size}
          required={required}
          error={error}
          disabled={disabled}
        >
          <InputLabel>{label}</InputLabel>
          <Select value={value} label={label} onChange={(e) => onChange(e.target.value)}>
            {getFilteredIndustries().map((industry) => (
              <MenuItem key={industry.code} value={industry.code}>
                <Box>
                  <Typography variant="body2">{industry.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {industry.code} • {industry.category}
                  </Typography>
                </Box>
              </MenuItem>
            ))}
          </Select>
          {helperText && <FormHelperText>{helperText}</FormHelperText>}
        </FormControl>
      </Box>
    );
  }

  return (
    <Box>
      {showCategory && (
        <FormControl fullWidth={fullWidth} size={size} sx={{ mb: 2 }} disabled={disabled}>
          <InputLabel>Industry Category</InputLabel>
          <Select
            value={selectedCategory}
            label="Industry Category"
            onChange={(e) => handleCategoryChange(e.target.value)}
          >
            <MenuItem value="">All Categories</MenuItem>
            {categories.map((category) => (
              <MenuItem key={category} value={category}>
                {category}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}

      <Autocomplete
        options={getFilteredIndustries()}
        getOptionLabel={(option) => `${option.name} (${option.code})`}
        value={selectedIndustry}
        onChange={(_, newValue) => handleIndustryChange(newValue)}
        renderInput={(params) => (
          <TextField
            {...params}
            label={label}
            required={required}
            error={error}
            helperText={helperText}
            size={size}
            fullWidth={fullWidth}
            disabled={disabled}
          />
        )}
        renderOption={(props, option) => (
          <Box component="li" {...props}>
            <Box>
              <Typography variant="body2">{option.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {option.code} • {option.category}
              </Typography>
            </Box>
          </Box>
        )}
        renderTags={(value, getTagProps) =>
          value.map((option, index) => (
            <Chip
              {...getTagProps({ index })}
              key={option.code}
              label={`${option.name} (${option.code})`}
              size="small"
            />
          ))
        }
        isOptionEqualToValue={(option, value) => option.code === value.code}
        filterOptions={(options, { inputValue }) => {
          const filtered = options.filter(
            (option) =>
              option.name.toLowerCase().includes(inputValue.toLowerCase()) ||
              option.code.includes(inputValue) ||
              option.category.toLowerCase().includes(inputValue.toLowerCase()),
          );
          return filtered;
        }}
        noOptionsText="No industries found"
        loadingText="Loading industries..."
      />
    </Box>
  );
};

export default IndustrySelector;
