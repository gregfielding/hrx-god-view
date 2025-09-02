import React, { useState, useEffect } from 'react';
import { 
  FormControl, 
  InputLabel, 
  Select, 
  MenuItem, 
  SelectChangeEvent,
  CircularProgress,
  Box,
  Typography
} from '@mui/material';
import { useSalespeople } from '../contexts/SalespeopleContext';

interface SalespersonDropdownProps {
  tenantId: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  fullWidth?: boolean;
}

export const SalespersonDropdown: React.FC<SalespersonDropdownProps> = ({
  tenantId,
  value,
  onChange,
  label = 'Select Salesperson',
  placeholder = 'Choose a salesperson...',
  disabled = false,
  required = false,
  fullWidth = true
}) => {
  const { salespeople, loading, error, getSalespeopleForTenant } = useSalespeople();
  const [localSalespeople, setLocalSalespeople] = useState<any[]>([]);

  // Load salespeople for this specific tenant
  useEffect(() => {
    if (tenantId) {
      getSalespeopleForTenant(tenantId).then(setLocalSalespeople);
    }
  }, [tenantId, getSalespeopleForTenant]);

  const handleChange = (event: SelectChangeEvent<string>) => {
    onChange(event.target.value);
  };

  if (loading && localSalespeople.length === 0) {
    return (
      <Box display="flex" alignItems="center" gap={1}>
        <CircularProgress size={20} />
        <Typography variant="body2" color="text.secondary">
          Loading salespeople...
        </Typography>
      </Box>
    );
  }

  if (error && localSalespeople.length === 0) {
    return (
      <Typography variant="body2" color="error">
        Error loading salespeople: {error}
      </Typography>
    );
  }

  return (
    <FormControl 
      fullWidth={fullWidth} 
      disabled={disabled}
      required={required}
      error={!!error}
    >
      <InputLabel id="salesperson-select-label">{label}</InputLabel>
      <Select
        labelId="salesperson-select-label"
        id="salesperson-select"
        value={value}
        label={label}
        onChange={handleChange}
        displayEmpty
      >
        <MenuItem value="" disabled>
          <em>{placeholder}</em>
        </MenuItem>
        {localSalespeople.map((salesperson) => (
          <MenuItem key={salesperson.id} value={salesperson.id}>
            {salesperson.firstName} {salesperson.lastName}
            {salesperson.email && ` (${salesperson.email})`}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
};

// Optimized version that only loads when needed
export const LazySalespersonDropdown: React.FC<SalespersonDropdownProps> = (props) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Only load when component becomes visible
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );

    const element = document.getElementById('salesperson-dropdown-container');
    if (element) {
      observer.observe(element);
    }

    return () => observer.disconnect();
  }, []);

  if (!isVisible) {
    return (
      <Box id="salesperson-dropdown-container">
        <FormControl fullWidth={props.fullWidth} disabled>
          <InputLabel>{props.label}</InputLabel>
          <Select value="" label={props.label}>
            <MenuItem value="" disabled>
              <em>Loading...</em>
            </MenuItem>
          </Select>
        </FormControl>
      </Box>
    );
  }

  return <SalespersonDropdown {...props} />;
};
