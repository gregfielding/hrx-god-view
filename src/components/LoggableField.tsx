import React, { ReactNode } from 'react';
import { useAIFieldLogging } from '../utils/aiFieldLogging';
import { LogTriggerDefinition } from '../utils/loggingTriggerMap';

interface LoggableFieldProps {
  fieldPath: string;
  trigger: 'update' | 'create' | 'delete';
  destinationModules: string[];
  children: ReactNode;
  value?: any;
  onChange?: (value: any) => void;
  onBlur?: () => void;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  // Additional metadata for enhanced logging
  contextType?: string;
  urgencyScore?: number;
  description?: string;
  // Validation
  validate?: (value: any) => boolean;
  errorMessage?: string;
}

export const LoggableField: React.FC<LoggableFieldProps> = ({
  fieldPath,
  trigger,
  destinationModules,
  children,
  value,
  onChange,
  onBlur,
  required = false,
  disabled = false,
  className = '',
  style = {},
  contextType,
  urgencyScore,
  description,
  validate,
  errorMessage
}) => {
  // Extract field name and context from fieldPath
  const fieldParts = fieldPath.split('.');
  const fieldName = fieldParts[fieldParts.length - 1];
  const contextId = fieldParts[0].includes(':') ? fieldParts[0].split(':')[1] : '';
  const contextTypeFromPath = fieldParts[0].includes('tenants') ? 'customer' : 'agency';
  
  const logFieldChange = useAIFieldLogging(fieldName, contextId, contextTypeFromPath);

  // Enhanced change handler with logging
  const handleChange = (newValue: any) => {
    if (disabled) return;

    // Validation
    if (validate && !validate(newValue)) {
      console.warn(`Validation failed for field ${fieldPath}:`, errorMessage);
      return;
    }

    // Log the change
    logFieldChange(value, newValue);

    // Call original onChange if provided
    if (onChange) {
      onChange(newValue);
    }
  };

  // Enhanced blur handler with logging
  const handleBlur = () => {
    if (onBlur) {
      onBlur();
    }
  };

  // Create data attributes for Cursor detection
  const dataAttributes = {
    'data-ai-log': 'true',
    'data-log-field': fieldPath,
    'data-log-trigger': trigger,
    'data-log-destinations': destinationModules.join(','),
    'data-log-context': contextType || 'general',
    'data-log-urgency': urgencyScore?.toString() || '5',
    'data-log-required': required.toString(),
    'data-log-description': description || `Field: ${fieldPath}`
  };

  return (
    <div
      {...dataAttributes}
      className={`loggable-field ${className}`}
      style={style}
    >
      {/* Clone children and inject enhanced handlers */}
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child, {
            value,
            onChange: handleChange,
            onBlur: handleBlur,
            disabled,
            required,
            ...child.props
          });
        }
        return child;
      })}
      
      {/* Error display */}
      {errorMessage && (
        <div className="loggable-field-error" style={{ color: 'red', fontSize: '0.8rem', marginTop: '4px' }}>
          {errorMessage}
        </div>
      )}
    </div>
  );
};

// Specialized LoggableField components for common use cases
export const LoggableTextField: React.FC<{
  fieldPath: string;
  trigger: 'update' | 'create' | 'delete';
  destinationModules: string[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  multiline?: boolean;
  rows?: number;
  contextType?: string;
  urgencyScore?: number;
  description?: string;
}> = ({
  fieldPath,
  trigger,
  destinationModules,
  value,
  onChange,
  label,
  placeholder,
  required = false,
  disabled = false,
  multiline = false,
  rows = 4,
  contextType,
  urgencyScore,
  description
}) => {
  // Ensure value is always defined to prevent controlled/uncontrolled input warning
  const safeValue = value ?? '';
  
  return (
    <LoggableField
      fieldPath={fieldPath}
      trigger={trigger}
      destinationModules={destinationModules}
      value={safeValue}
      onChange={onChange}
      required={required}
      disabled={disabled}
      contextType={contextType}
      urgencyScore={urgencyScore}
      description={description}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {label && (
          <label style={{ fontWeight: '500', fontSize: '0.9rem' }}>
            {label}
            {required && <span style={{ color: 'red' }}> *</span>}
          </label>
        )}
        {multiline ? (
          <textarea
            value={safeValue}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            rows={rows}
            disabled={disabled}
            required={required}
            style={{
              padding: '8px 12px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '0.9rem',
              resize: 'vertical'
            }}
          />
        ) : (
          <input
            type="text"
            value={safeValue}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            required={required}
            style={{
              padding: '8px 12px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '0.9rem'
            }}
          />
        )}
      </div>
    </LoggableField>
  );
};

export const LoggableSlider: React.FC<{
  fieldPath: string;
  trigger: 'update' | 'create' | 'delete';
  destinationModules: string[];
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  contextType?: string;
  urgencyScore?: number;
  description?: string;
}> = ({
  fieldPath,
  trigger,
  destinationModules,
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  required = false,
  disabled = false,
  contextType,
  urgencyScore,
  description
}) => {
  // Ensure value is always defined to prevent controlled/uncontrolled input warning
  const safeValue = value ?? 0;
  
  return (
    <LoggableField
      fieldPath={fieldPath}
      trigger={trigger}
      destinationModules={destinationModules}
      value={safeValue}
      onChange={onChange}
      required={required}
      disabled={disabled}
      contextType={contextType}
      urgencyScore={urgencyScore}
      description={description}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {label && (
          <label style={{ fontWeight: '500', fontSize: '0.9rem' }}>
            {label}: {safeValue}
            {required && <span style={{ color: 'red' }}> *</span>}
          </label>
        )}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={safeValue}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={disabled}
          required={required}
          style={{
            width: '100%',
            height: '6px',
            borderRadius: '3px',
            background: '#ddd',
            outline: 'none'
          }}
        />
      </div>
    </LoggableField>
  );
};

export const LoggableSwitch: React.FC<{
  fieldPath: string;
  trigger: 'update' | 'create' | 'delete';
  destinationModules: string[];
  value: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  contextType?: string;
  urgencyScore?: number;
  description?: string;
}> = ({
  fieldPath,
  trigger,
  destinationModules,
  value,
  onChange,
  label,
  required = false,
  disabled = false,
  contextType,
  urgencyScore,
  description
}) => {
  return (
    <LoggableField
      fieldPath={fieldPath}
      trigger={trigger}
      destinationModules={destinationModules}
      value={value}
      onChange={onChange}
      required={required}
      disabled={disabled}
      contextType={contextType}
      urgencyScore={urgencyScore}
      description={description}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <label style={{ fontWeight: '500', fontSize: '0.9rem' }}>
          {label}
          {required && <span style={{ color: 'red' }}> *</span>}
        </label>
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          required={required}
          style={{
            width: '20px',
            height: '20px',
            cursor: disabled ? 'not-allowed' : 'pointer'
          }}
        />
      </div>
    </LoggableField>
  );
};

export const LoggableSelect: React.FC<{
  fieldPath: string;
  trigger: 'update' | 'create' | 'delete';
  destinationModules: string[];
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  contextType?: string;
  urgencyScore?: number;
  description?: string;
}> = ({
  fieldPath,
  trigger,
  destinationModules,
  value,
  onChange,
  options,
  label,
  placeholder,
  required = false,
  disabled = false,
  contextType,
  urgencyScore,
  description
}) => {
  // Ensure value is always defined to prevent controlled/uncontrolled input warning
  const safeValue = value ?? '';
  
  return (
    <LoggableField
      fieldPath={fieldPath}
      trigger={trigger}
      destinationModules={destinationModules}
      value={safeValue}
      onChange={onChange}
      required={required}
      disabled={disabled}
      contextType={contextType}
      urgencyScore={urgencyScore}
      description={description}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {label && (
          <label style={{ fontWeight: '500', fontSize: '0.9rem' }}>
            {label}
            {required && <span style={{ color: 'red' }}> *</span>}
          </label>
        )}
        <select
          value={safeValue}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          required={required}
          style={{
            padding: '8px 12px',
            border: '1px solid #ddd',
            borderRadius: '4px',
            fontSize: '0.9rem',
            backgroundColor: disabled ? '#f5f5f5' : 'white'
          }}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </LoggableField>
  );
};

// Utility function to find all LoggableField components in the DOM
export const findAllLoggableFields = (): HTMLElement[] => {
  return Array.from(document.querySelectorAll('[data-ai-log="true"]'));
};

// Utility function to get field metadata from DOM element
export const getFieldMetadata = (element: HTMLElement): {
  fieldPath: string;
  trigger: string;
  destinations: string[];
  context: string;
  urgency: number;
  required: boolean;
  description: string;
} | null => {
  if (!element.hasAttribute('data-ai-log')) {
    return null;
  }

  return {
    fieldPath: element.getAttribute('data-log-field') || '',
    trigger: element.getAttribute('data-log-trigger') || '',
    destinations: element.getAttribute('data-log-destinations')?.split(',') || [],
    context: element.getAttribute('data-log-context') || 'general',
    urgency: parseInt(element.getAttribute('data-log-urgency') || '5'),
    required: element.getAttribute('data-log-required') === 'true',
    description: element.getAttribute('data-log-description') || ''
  };
};

// Utility function to simulate a change on a LoggableField
export const simulateFieldChange = async (
  element: HTMLElement, 
  newValue: any
): Promise<{ success: boolean; error?: string }> => {
  try {
    const metadata = getFieldMetadata(element);
    if (!metadata) {
      return { success: false, error: 'Element is not a LoggableField' };
    }

    // Find the input element within the LoggableField
    const input = element.querySelector('input, textarea, select') as HTMLInputElement;
    if (!input) {
      return { success: false, error: 'No input element found within LoggableField' };
    }

    // Simulate the change
    const event = new Event('change', { bubbles: true });
    Object.defineProperty(event, 'target', { value: input });
    
    if (input.type === 'checkbox') {
      input.checked = newValue;
    } else {
      input.value = newValue;
    }
    
    input.dispatchEvent(event);
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}; 