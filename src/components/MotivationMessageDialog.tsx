import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Box,
  Typography,
  Autocomplete,
  FormControlLabel,
  Switch,
  Alert,
} from '@mui/material';

interface MotivationMessage {
  id: string;
  text: string;
  quote?: string; // The actual quote
  author?: string; // Who said the quote
  category:
    | 'sales'
    | 'service'
    | 'general-labor'
    | 'healthcare'
    | 'logistics'
    | 'office'
    | 'general';
  tone: 'energizing' | 'calming' | 'reassuring' | 'reflective' | 'motivational';
  traits: string[];
  tags: string[];
  isActive: boolean;
  usageCount: number;
  averageRating: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

interface MotivationMessageDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (messageData: Partial<MotivationMessage>) => void;
  message?: MotivationMessage | null;
}

const categories = [
  { value: 'sales', label: 'Sales' },
  { value: 'service', label: 'Customer Service' },
  { value: 'general-labor', label: 'General Labor' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'logistics', label: 'Logistics' },
  { value: 'office', label: 'Office' },
  { value: 'general', label: 'General' },
];

const tones = [
  { value: 'energizing', label: 'Energizing' },
  { value: 'calming', label: 'Calming' },
  { value: 'reassuring', label: 'Reassuring' },
  { value: 'reflective', label: 'Reflective' },
  { value: 'motivational', label: 'Motivational' },
];

const availableTraits = [
  'confidence',
  'patience',
  'grit',
  'focus',
  'positivity',
  'resilience',
  'persistence',
  'optimism',
  'wisdom',
  'strength',
  'compassion',
  'empathy',
  'self-compassion',
  'determination',
  'courage',
  'humility',
  'gratitude',
];

const MotivationMessageDialog: React.FC<MotivationMessageDialogProps> = ({
  open,
  onClose,
  onSave,
  message,
}) => {
  const [formData, setFormData] = useState<Partial<MotivationMessage>>({
    text: '',
    quote: '',
    author: '',
    category: 'general',
    tone: 'motivational',
    traits: [],
    tags: [],
    isActive: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (message) {
      setFormData({
        text: message.text,
        quote: message.quote || '',
        author: message.author || '',
        category: message.category,
        tone: message.tone,
        traits: message.traits,
        tags: message.tags,
        isActive: message.isActive,
      });
    } else {
      setFormData({
        text: '',
        quote: '',
        author: '',
        category: 'general',
        tone: 'motivational',
        traits: [],
        tags: [],
        isActive: true,
      });
    }
    setErrors({});
  }, [message, open]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.text?.trim()) {
      newErrors.text = 'Message text is required';
    } else if (formData.text.length < 10) {
      newErrors.text = 'Message must be at least 10 characters long';
    } else if (formData.text.length > 200) {
      newErrors.text = 'Message must be less than 200 characters';
    }

    if (!formData.category) {
      newErrors.category = 'Category is required';
    }

    if (!formData.tone) {
      newErrors.tone = 'Tone is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (validateForm()) {
      onSave(formData);
    }
  };

  const handleTextChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const text = event.target.value;
    setFormData((prev) => ({ ...prev, text }));

    // Auto-generate tags based on content
    const autoTags: string[] = [];
    if (text.toLowerCase().includes('sales') || text.toLowerCase().includes('sell'))
      autoTags.push('sales');
    if (text.toLowerCase().includes('customer') || text.toLowerCase().includes('service'))
      autoTags.push('service');
    if (text.toLowerCase().includes('health') || text.toLowerCase().includes('care'))
      autoTags.push('healthcare');
    if (text.toLowerCase().includes('patience') || text.toLowerCase().includes('wait'))
      autoTags.push('patience');
    if (text.toLowerCase().includes('confidence') || text.toLowerCase().includes('believe'))
      autoTags.push('confidence');
    if (text.toLowerCase().includes('persistence') || text.toLowerCase().includes('keep'))
      autoTags.push('persistence');

    setFormData((prev) => ({
      ...prev,
      text,
      tags: [...new Set([...autoTags, ...(prev.traits || [])])],
    }));
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {message ? 'Edit Motivation Message' : 'Add New Motivation Message'}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 2 }}>
          <TextField
            fullWidth
            multiline
            rows={3}
            label="Message Text"
            value={formData.text}
            onChange={handleTextChange}
            error={!!errors.text}
            helperText={errors.text || `${formData.text?.length || 0}/200 characters`}
            placeholder="Enter a motivational message..."
            sx={{ mb: 3 }}
          />

          <Box display="flex" gap={2} sx={{ mb: 3 }}>
            <TextField
              fullWidth
              label="Quote (Optional)"
              value={formData.quote || ''}
              onChange={(e) => setFormData((prev) => ({ ...prev, quote: e.target.value }))}
              placeholder="Enter the original quote if this is based on a famous quote..."
              helperText="If this message is based on a famous quote, enter the original quote here. Leave blank for original/company messages."
            />
            <Box width="100%">
              <TextField
                fullWidth
                label="Author (Optional)"
                value={formData.author || ''}
                onChange={(e) => setFormData((prev) => ({ ...prev, author: e.target.value }))}
                placeholder="Who said the quote..."
                helperText="Enter the person or source who said the quote. Leave blank if unknown or not applicable."
              />
              {formData.quote && !formData.author && (
                <Typography variant="caption" color="warning.main" sx={{ mt: 0.5, display: 'block' }}>
                  Consider adding an author for attribution if this is a famous quote.
                </Typography>
              )}
            </Box>
          </Box>

          <Box display="flex" gap={2} sx={{ mb: 3 }}>
            <FormControl fullWidth error={!!errors.category}>
              <InputLabel>Category</InputLabel>
              <Select
                value={formData.category}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, category: e.target.value as any }))
                }
              >
                {categories.map((cat) => (
                  <MenuItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </MenuItem>
                ))}
              </Select>
              {errors.category && (
                <Typography variant="caption" color="error">
                  {errors.category}
                </Typography>
              )}
            </FormControl>

            <FormControl fullWidth error={!!errors.tone}>
              <InputLabel>Tone</InputLabel>
              <Select
                value={formData.tone}
                onChange={(e) => setFormData((prev) => ({ ...prev, tone: e.target.value as any }))}
              >
                {tones.map((tone) => (
                  <MenuItem key={tone.value} value={tone.value}>
                    {tone.label}
                  </MenuItem>
                ))}
              </Select>
              {errors.tone && (
                <Typography variant="caption" color="error">
                  {errors.tone}
                </Typography>
              )}
            </FormControl>
          </Box>

          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" gutterBottom>
              Traits (Select relevant behavioral traits)
            </Typography>
            <Autocomplete
              multiple
              options={availableTraits}
              value={formData.traits || []}
              onChange={(_, newValue) =>
                setFormData((prev) => ({
                  ...prev,
                  traits: newValue,
                  tags: [...new Set([...(prev.tags || []), ...newValue])],
                }))
              }
              renderInput={(params) => (
                <TextField {...params} variant="outlined" placeholder="Select traits..." />
              )}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => {
                  const { key, ...chipProps } = getTagProps({ index });
                  return <Chip key={key} label={option} size="small" {...chipProps} />;
                })
              }
            />
          </Box>

          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle2" gutterBottom>
              Tags (Auto-generated + manual)
            </Typography>
            <Autocomplete
              multiple
              freeSolo
              options={[]}
              value={formData.tags || []}
              onChange={(_, newValue) => setFormData((prev) => ({ ...prev, tags: newValue }))}
              renderInput={(params) => (
                <TextField {...params} variant="outlined" placeholder="Add tags..." />
              )}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => {
                  const { key, ...chipProps } = getTagProps({ index });
                  return (
                    <Chip
                      key={key}
                      label={option}
                      size="small"
                      color="primary"
                      variant="outlined"
                      {...chipProps}
                    />
                  );
                })
              }
            />
          </Box>

          <FormControlLabel
            control={
              <Switch
                checked={formData.isActive}
                onChange={(e) => setFormData((prev) => ({ ...prev, isActive: e.target.checked }))}
              />
            }
            label="Message Active"
          />

          {message && (
            <Box sx={{ mt: 2 }}>
              <Alert severity="info">
                <Typography variant="body2">
                  Usage: {message.usageCount} times | Rating: {message.averageRating.toFixed(1)}/5.0
                </Typography>
              </Alert>
            </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} variant="contained">
          {message ? 'Update Message' : 'Add Message'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default MotivationMessageDialog;
