/**
 * Settings > Smart Groups: manage custom metros.
 * Add metros from guideline-backed templates; areas and cities populate automatically.
 */

import React, { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  List,
  ListItem,
  ListItemText,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Alert,
  CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { METRO_OPTIONS, getMergedMetroOptions, formatGeoLabel } from '../../data/metroSubareaSchema';
import { useSmartGroupSettings } from '../../hooks/useSmartGroupSettings';
import type { CustomMetro } from '../../hooks/useSmartGroupSettings';
import metroTemplatesData from '../../data/metroTemplates.json';

// Template shape matches metroTemplates.json
interface MetroTemplate {
  metroKey: string;
  label: string;
  subareas: Array<{ subareaKey: string; label: string; cityKeys: string[] }>;
}

const metroTemplates: MetroTemplate[] = metroTemplatesData as MetroTemplate[];

function toCustomMetro(t: MetroTemplate): CustomMetro {
  return {
    label: t.label,
    subareas: t.subareas.map((s) => ({
      subareaKey: s.subareaKey,
      label: s.label,
      cityKeys: s.cityKeys ?? [],
    })),
  };
}

const SmartGroupsSettings: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const { customMetros, loading, error, addCustomMetro, removeCustomMetro } = useSmartGroupSettings(tenantId);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string>('');

  const allMetroKeys = getMergedMetroOptions(customMetros);
  const builtInSet = new Set(METRO_OPTIONS);
  const customSet = new Set(Object.keys(customMetros));
  const availableTemplates = metroTemplates.filter(
    (t) => !builtInSet.has(t.metroKey) && !customSet.has(t.metroKey)
  );

  const handleAdd = async () => {
    if (!selectedTemplateKey) return;
    const template = metroTemplates.find((t) => t.metroKey === selectedTemplateKey);
    if (!template) return;
    await addCustomMetro(template.metroKey, toCustomMetro(template));
    setAddOpen(false);
    setSelectedTemplateKey('');
  };

  const handleRemove = async (metroKey: string) => {
    if (builtInSet.has(metroKey)) return;
    await removeCustomMetro(metroKey);
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ px: { xs: 2, md: 3 }, py: 2, maxWidth: 720 }}>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
        Metros define the geographic hierarchy (Metro → Area → City) used in Smart Groups filters. Built-in metros
        are always available. Metros are also auto-generated when company worksite locations are added (city/state
        from new locations); you can edit or remove them here. Add more by choosing a template below; areas and
        cities are filled from the guideline-backed templates.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => {}}>
          {error.message}
        </Alert>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          Current metros
        </Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<AddIcon />}
          onClick={() => setAddOpen(true)}
          disabled={availableTemplates.length === 0}
        >
          Add metro
        </Button>
      </Box>

      <List dense sx={{ bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
        {allMetroKeys.map((metroKey) => {
          const isBuiltIn = builtInSet.has(metroKey);
          const label = isBuiltIn ? formatGeoLabel(metroKey) : (customMetros[metroKey]?.label ?? formatGeoLabel(metroKey));
          return (
            <ListItem
              key={metroKey}
              secondaryAction={
                !isBuiltIn ? (
                  <IconButton edge="end" size="small" onClick={() => handleRemove(metroKey)} aria-label={`Remove ${label}`}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                ) : null
              }
            >
              <ListItemText
                primary={label}
                secondary={isBuiltIn ? 'Built-in' : 'Custom'}
              />
              {isBuiltIn && (
                <Chip label="Built-in" size="small" sx={{ ml: 1 }} variant="outlined" />
              )}
            </ListItem>
          );
        })}
      </List>

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add metro from template</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Choose a metro template. Areas and cities will be populated automatically from the guidelines.
          </Typography>
          <FormControl fullWidth size="small" sx={{ mt: 1 }}>
            <InputLabel id="smart-metro-template-label">Metro template</InputLabel>
            <Select
              labelId="smart-metro-template-label"
              label="Metro template"
              value={selectedTemplateKey}
              onChange={(e) => setSelectedTemplateKey(e.target.value as string)}
            >
              {metroTemplates.map((t) => {
                const alreadyAdded = builtInSet.has(t.metroKey) || customSet.has(t.metroKey);
                return (
                  <MenuItem key={t.metroKey} value={t.metroKey} disabled={alreadyAdded}>
                    {t.label}
                    {alreadyAdded && ' (already added)'}
                  </MenuItem>
                );
              })}
            </Select>
          </FormControl>
          {selectedTemplateKey && (() => {
            const t = metroTemplates.find((x) => x.metroKey === selectedTemplateKey);
            if (!t) return null;
            const areaCount = t.subareas.length;
            const cityCount = t.subareas.reduce((sum, s) => sum + (s.cityKeys?.length ?? 0), 0);
            return (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                This template adds {areaCount} area{areaCount !== 1 ? 's' : ''} and {cityCount} cit{cityCount === 1 ? 'y' : 'ies'}.
              </Typography>
            );
          })()}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleAdd} disabled={!selectedTemplateKey}>
            Add metro
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SmartGroupsSettings;
