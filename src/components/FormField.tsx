import React from 'react';
import { Box, TextField, Typography, FormHelperText } from '@mui/material';
import { Info as InfoIcon } from '@mui/icons-material';

interface FormFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  helperText?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  multiline?: boolean;
  rows?: number;
  type?: 'text' | 'email' | 'password' | 'number' | 'url';
  startIcon?: React.ReactNode;
  endIcon?: React.ReactNode;
  variant?: 'filled' | 'outlined';
  size?: 'small' | 'medium';
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  value,
  onChange,
  placeholder,
  helperText,
  error,
  required = false,
  disabled = false,
  multiline = false,
  rows = 3,
  type = 'text',
  startIcon,
  endIcon,
  variant = 'filled',
  size = 'small'
}) => {
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography
          variant="body2"
          sx={{
            fontWeight: 600,
            color: error ? '#D14343' : '#0B0D12'
          }}
        >
          {label}
          {required && (
            <Typography
              component="span"
              sx={{
                color: '#D14343',
                ml: 0.5
              }}
            >
              *
            </Typography>
          )}
        </Typography>
        
        {helperText && (
          <InfoIcon
            sx={{
              fontSize: 16,
              color: '#8B94A3',
              cursor: 'help'
            }}
          />
        )}
      </Box>
      
      <TextField
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        multiline={multiline}
        rows={multiline ? rows : undefined}
        type={type}
        variant={variant}
        size={size}
        error={!!error}
        InputProps={{
          startAdornment: startIcon,
          endAdornment: endIcon,
        }}
        sx={{
          width: '100%',
          '& .MuiFilledInput-root': {
            backgroundColor: '#F7F9FC',
            borderRadius: 12,
            '&:hover': {
              backgroundColor: '#F0F2F5',
            },
            '&.Mui-focused': {
              backgroundColor: '#FFFFFF',
              border: '1px solid #4A90E2',
            },
            '&.Mui-error': {
              backgroundColor: '#FDECEC',
              border: '1px solid #D14343',
            },
          },
          '& .MuiInputLabel-root': {
            color: '#5A6372',
            '&.Mui-focused': {
              color: '#4A90E2',
            },
            '&.Mui-error': {
              color: '#D14343',
            },
          },
          '& .MuiInputBase-input': {
            color: '#0B0D12',
            '&::placeholder': {
              color: '#8B94A3',
              opacity: 1,
            },
          },
        }}
      />
      
      {(helperText || error) && (
        <FormHelperText
          sx={{
            mt: 1,
            color: error ? '#D14343' : '#8B94A3',
            fontSize: '0.75rem',
            lineHeight: 1.4,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 0.5
          }}
        >
          {error || helperText}
        </FormHelperText>
      )}
    </Box>
  );
};
