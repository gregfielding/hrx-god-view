import React, { useState } from 'react';
import { TextField, Slider, Switch, FormControlLabel, Select, MenuItem, FormControl, InputLabel } from '@mui/material';

import { useAIFieldLogging, isAIField } from '../utils/aiFieldLogging';

// AI-Aware TextField Component
interface AITextFieldProps {
  fieldName: string;
  contextId: string;
  contextType: 'customer' | 'agency';
  value: string;
  onChange: (value: string) => void;
  label?: string;
  multiline?: boolean;
  minRows?: number;
  placeholder?: string;
  fullWidth?: boolean;
  required?: boolean;
  disabled?: boolean;
  helperText?: string;
  error?: boolean;
}

export const AITextField: React.FC<AITextFieldProps> = ({ 
  fieldName, 
  contextId, 
  contextType, 
  value, 
  onChange,
  ...props 
}) => {
  const [originalValue, setOriginalValue] = useState(value);
  const logFieldChange = useAIFieldLogging(fieldName, contextId, contextType);
  
  const handleChange = (newValue: string) => {
    onChange(newValue);
    
    // Log the change if it's different from original and it's an AI field
    if (newValue !== originalValue && isAIField(fieldName)) {
      logFieldChange(originalValue, newValue);
    }
  };
  
  const handleBlur = () => {
    // Update original value when field loses focus
    setOriginalValue(value);
  };
  
  return (
    <TextField
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={handleBlur}
      {...props}
    />
  );
};

// AI-Aware Slider Component
interface AISliderProps {
  fieldName: string;
  contextId: string;
  contextType: 'customer' | 'agency';
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  marks?: boolean | Array<{ value: number; label: string }>;
  disabled?: boolean;
  sx?: any;
}

export const AISlider: React.FC<AISliderProps> = ({ 
  fieldName, 
  contextId, 
  contextType, 
  value, 
  onChange,
  ...props 
}) => {
  const [originalValue, setOriginalValue] = useState(value);
  const logFieldChange = useAIFieldLogging(fieldName, contextId, contextType);
  
  const handleChange = (newValue: number) => {
    onChange(newValue);
    
    // Log the change if it's significantly different and it's an AI field
    if (Math.abs(newValue - originalValue) > 0.01 && isAIField(fieldName)) {
      logFieldChange(originalValue, newValue);
    }
  };
  
  const handleChangeCommitted = () => {
    // Update original value when slider interaction ends
    setOriginalValue(value);
  };
  
  return (
    <Slider
      value={value}
      onChange={(_, newValue) => handleChange(newValue as number)}
      onChangeCommitted={handleChangeCommitted}
      {...props}
    />
  );
};

// AI-Aware Switch Component
interface AISwitchProps {
  fieldName: string;
  contextId: string;
  contextType: 'customer' | 'agency';
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  color?: 'primary' | 'secondary' | 'default';
}

export const AISwitch: React.FC<AISwitchProps> = ({ 
  fieldName, 
  contextId, 
  contextType, 
  checked, 
  onChange,
  ...props 
}) => {
  const [originalValue, setOriginalValue] = useState(checked);
  const logFieldChange = useAIFieldLogging(fieldName, contextId, contextType);
  
  const handleChange = (newValue: boolean) => {
    onChange(newValue);
    
    // Log the change if it's different and it's an AI field
    if (newValue !== originalValue && isAIField(fieldName)) {
      logFieldChange(originalValue, newValue);
    }
  };
  
  const handleBlur = () => {
    // Update original value when switch loses focus
    setOriginalValue(checked);
  };
  
  return (
    <FormControlLabel
      control={
        <Switch
          checked={checked}
          onChange={(e) => handleChange(e.target.checked)}
          onBlur={handleBlur}
          {...props}
        />
      }
      label={props.label}
    />
  );
};

// AI-Aware Select Component
interface AISelectProps {
  fieldName: string;
  contextId: string;
  contextType: 'customer' | 'agency';
  value: string | number;
  onChange: (value: string | number) => void;
  options: Array<{ value: string | number; label: string }>;
  label?: string;
  fullWidth?: boolean;
  disabled?: boolean;
  required?: boolean;
  error?: boolean;
  helperText?: string;
}

export const AISelect: React.FC<AISelectProps> = ({ 
  fieldName, 
  contextId, 
  contextType, 
  value, 
  onChange,
  options,
  ...props 
}) => {
  const [originalValue, setOriginalValue] = useState(value);
  const logFieldChange = useAIFieldLogging(fieldName, contextId, contextType);
  
  const handleChange = (newValue: string | number) => {
    onChange(newValue);
    
    // Log the change if it's different and it's an AI field
    if (newValue !== originalValue && isAIField(fieldName)) {
      logFieldChange(originalValue, newValue);
    }
  };
  
  const handleBlur = () => {
    // Update original value when select loses focus
    setOriginalValue(value);
  };
  
  return (
    <FormControl fullWidth={!!props.fullWidth} error={!!props.error} required={!!props.required}>
      {props.label && <InputLabel>{props.label}</InputLabel>}
      <Select
        value={value}
        label={props.label}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        disabled={!!props.disabled}
      >
        {options.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
};

// AI-Aware Number Input Component
interface AINumberInputProps {
  fieldName: string;
  contextId: string;
  contextType: 'customer' | 'agency';
  value: number;
  onChange: (value: number) => void;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  fullWidth?: boolean;
  disabled?: boolean;
  required?: boolean;
  error?: boolean;
  helperText?: string;
}

export const AINumberInput: React.FC<AINumberInputProps> = ({ 
  fieldName, 
  contextId, 
  contextType, 
  value, 
  onChange,
  ...props 
}) => {
  const [originalValue, setOriginalValue] = useState(value);
  const logFieldChange = useAIFieldLogging(fieldName, contextId, contextType);
  
  const handleChange = (newValue: number) => {
    onChange(newValue);
    
    // Log the change if it's different and it's an AI field
    if (newValue !== originalValue && isAIField(fieldName)) {
      logFieldChange(originalValue, newValue);
    }
  };
  
  const handleBlur = () => {
    // Update original value when input loses focus
    setOriginalValue(value);
  };
  
  return (
    <TextField
      type="number"
      value={value}
      onChange={(e) => handleChange(parseFloat(e.target.value) || 0)}
      onBlur={handleBlur}
      inputProps={{
        min: props.min,
        max: props.max,
        step: props.step
      }}
      {...props}
    />
  );
};

// AI-Aware Array Input Component (for arrays like sampleSocialPosts)
interface AIArrayInputProps {
  fieldName: string;
  contextId: string;
  contextType: 'customer' | 'agency';
  value: string[];
  onChange: (value: string[]) => void;
  label?: string;
  maxItems?: number;
  fullWidth?: boolean;
  disabled?: boolean;
  multiline?: boolean;
  minRows?: number;
  placeholder?: string;
}

export const AIArrayInput: React.FC<AIArrayInputProps> = ({ 
  fieldName, 
  contextId, 
  contextType, 
  value, 
  onChange,
  maxItems = 3,
  ...props 
}) => {
  const [originalValue, setOriginalValue] = useState<string[]>(value);
  const logFieldChange = useAIFieldLogging(fieldName, contextId, contextType);
  
  const handleItemChange = (index: number, newItemValue: string) => {
    const newArray = [...value];
    newArray[index] = newItemValue;
    onChange(newArray);
    
    // Log the change if it's different and it's an AI field
    if (JSON.stringify(newArray) !== JSON.stringify(originalValue) && isAIField(fieldName)) {
      logFieldChange(originalValue, newArray);
    }
  };
  
  const handleBlur = () => {
    // Update original value when any input loses focus
    setOriginalValue(value);
  };
  
  return (
    <div>
      {Array.from({ length: maxItems }, (_, index) => (
        <TextField
          key={index}
          label={`${props.label || 'Item'} ${index + 1}`}
          value={value[index] || ''}
          onChange={(e) => handleItemChange(index, e.target.value)}
          onBlur={handleBlur}
          fullWidth={!!props.fullWidth}
          disabled={!!props.disabled}
          multiline={props.multiline ?? false}
          minRows={(props.minRows ?? 1) as number | string}
          placeholder={props.placeholder ?? ''}
          sx={{ mb: 2 }}
        />
      ))}
    </div>
  );
};

// AI-Aware Object Input Component (for complex objects like tone settings)
interface AIObjectInputProps {
  fieldName: string;
  contextId: string;
  contextType: 'customer' | 'agency';
  value: Record<string, any>;
  onChange: (value: Record<string, any>) => void;
  fields: Array<{ key: string; label: string; type: 'slider' | 'switch' | 'text' | 'number' }>;
  disabled?: boolean;
}

export const AIObjectInput: React.FC<AIObjectInputProps> = ({ 
  fieldName, 
  contextId, 
  contextType, 
  value, 
  onChange,
  fields,
  disabled = false
}) => {
  const [originalValue] = useState<Record<string, any>>(value);
  const logFieldChange = useAIFieldLogging(fieldName, contextId, contextType);
  
  const handleFieldChange = (key: string, newValue: any) => {
    const newObject = { ...value, [key]: newValue };
    onChange(newObject);
    
    // Log the change if it's different and it's an AI field
    if (JSON.stringify(newObject) !== JSON.stringify(originalValue) && isAIField(fieldName)) {
      logFieldChange(originalValue, newObject);
    }
  };
  
  // const handleBlur = () => {
    // Update original value when any field loses focus
  //   setOriginalValue(value);
  // };
  
  return (
    <div>
      {fields.map((field) => {
        const fieldValue = value[field.key];
        
        switch (field.type) {
          case 'slider':
            return (
              <div key={field.key} style={{ marginBottom: 16 }}>
                <div>{field.label}</div>
                <AISlider
                  fieldName={`${fieldName}.${field.key}`}
                  contextId={contextId}
                  contextType={contextType}
                  value={fieldValue || 0}
                  onChange={(newValue) => handleFieldChange(field.key, newValue)}
                  min={0}
                  max={1}
                  step={0.01}
                  disabled={disabled}
                />
                <div style={{ fontSize: '0.875rem', color: 'rgba(0, 0, 0, 0.6)' }}>
                  Value: {(fieldValue || 0).toFixed(2)}
                </div>
              </div>
            );
          
          case 'switch':
            return (
              <AISwitch
                key={field.key}
                fieldName={`${fieldName}.${field.key}`}
                contextId={contextId}
                contextType={contextType}
                checked={fieldValue || false}
                onChange={(newValue) => handleFieldChange(field.key, newValue)}
                label={field.label}
                disabled={disabled}
              />
            );
          
          case 'text':
            return (
              <AITextField
                key={field.key}
                fieldName={`${fieldName}.${field.key}`}
                contextId={contextId}
                contextType={contextType}
                value={fieldValue || ''}
                onChange={(newValue) => handleFieldChange(field.key, newValue)}
                label={field.label}
                fullWidth
                disabled={disabled}
              />
            );
          
          case 'number':
            return (
              <AINumberInput
                key={field.key}
                fieldName={`${fieldName}.${field.key}`}
                contextId={contextId}
                contextType={contextType}
                value={fieldValue || 0}
                onChange={(newValue) => handleFieldChange(field.key, newValue)}
                label={field.label}
                fullWidth
                disabled={disabled}
              />
            );
          
          default:
            return null;
        }
      })}
    </div>
  );
}; 