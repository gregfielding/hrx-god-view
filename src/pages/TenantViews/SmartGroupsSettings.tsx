/**
 * Settings > Smart Groups: manage custom metros.
 * Add metros from guideline-backed templates; areas and cities populate automatically.
 * Click a metro to see subareas; click a subarea to see cities. Search for a city to see its metro → area hierarchy.
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  Box,
  Button,
  List,
  ListItem,
  ListItemText,
  Typography,
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
  TextField,
  InputAdornment,
  Paper,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import SearchIcon from '@mui/icons-material/Search';
import RefreshIcon from '@mui/icons-material/Refresh';
import PlaceIcon from '@mui/icons-material/Place';

import {
  METRO_OPTIONS,
  getMergedMetroOptions,
  getMergedSubareaOptionsForMetro,
  getMergedCityOptionsForSubarea,
  formatGeoLabel,
  type CustomMetroInput,
} from '../../data/metroSubareaSchema';
import { useSmartGroupSettings } from '../../hooks/useSmartGroupSettings';
import type { CustomMetro } from '../../hooks/useSmartGroupSettings';
import { METRO_TEMPLATES, getMetroTemplateByKey, type MetroTemplateCompat } from '../../data/metroMaster';

/** One subarea with label and city keys (built-in + custom merged). */
export interface SubareaWithCities {
  subareaKey: string;
  label: string;
  cityKeys: string[];
}

function getSubareasWithCities(
  metroKey: string,
  customMetros: Record<string, CustomMetroInput>
): SubareaWithCities[] {
  const custom = customMetros[metroKey];
  const template = getMetroTemplateByKey(metroKey);
  const subareaKeys = getMergedSubareaOptionsForMetro(metroKey, customMetros);
  return subareaKeys.map((subareaKey) => {
    const customSub = custom?.subareas?.find((s) => s.subareaKey === subareaKey);
    const templateSub = template?.subareas?.find((s) => s.subareaKey === subareaKey);
    const label = customSub?.label ?? templateSub?.label ?? formatGeoLabel(subareaKey);
    const cityKeys = getMergedCityOptionsForSubarea(metroKey, subareaKey, customMetros);
    return { subareaKey, label, cityKeys };
  });
}

/** Search result: a city key and its metro → subarea hierarchy. */
interface CitySearchHit {
  cityKey: string;
  metroKey: string;
  metroLabel: string;
  subareaKey: string;
  subareaLabel: string;
}

function buildCitySearchIndex(
  customMetros: Record<string, CustomMetroInput>
): CitySearchHit[] {
  const hits: CitySearchHit[] = [];
  const metroKeys = getMergedMetroOptions(customMetros);
  for (const metroKey of metroKeys) {
    const metroLabel =
      customMetros[metroKey]?.label ?? getMetroTemplateByKey(metroKey)?.label ?? formatGeoLabel(metroKey);
    const subareas = getSubareasWithCities(metroKey, customMetros);
    for (const sub of subareas) {
      for (const cityKey of sub.cityKeys) {
        hits.push({
          cityKey,
          metroKey,
          metroLabel,
          subareaKey: sub.subareaKey,
          subareaLabel: sub.label,
        });
      }
    }
  }
  return hits;
}

function toCustomMetro(t: MetroTemplateCompat): CustomMetro {
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
  const [selectedMetroKey, setSelectedMetroKey] = useState<string | null>(null);
  const [selectedSubareaKey, setSelectedSubareaKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSearchCityKey, setSelectedSearchCityKey] = useState<string | null>(null);
  const [deletingMetroKey, setDeletingMetroKey] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const allMetroKeys = getMergedMetroOptions(customMetros);
  const builtInSet = new Set(METRO_OPTIONS);
  const customSet = new Set(Object.keys(customMetros));
  const availableTemplates = METRO_TEMPLATES.filter(
    (t) => !builtInSet.has(t.metroKey) && !customSet.has(t.metroKey)
  );

  const citySearchIndex = useMemo(() => buildCitySearchIndex(customMetros), [customMetros]);
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return citySearchIndex.filter(
      (hit) => formatGeoLabel(hit.cityKey).toLowerCase().includes(q)
    );
  }, [citySearchIndex, searchQuery]);

  useEffect(() => {
    if (searchResults.length > 0) {
      const inResults = selectedSearchCityKey && searchResults.some((r) => r.cityKey === selectedSearchCityKey);
      if (!inResults) setSelectedSearchCityKey(searchResults[0].cityKey);
    } else {
      setSelectedSearchCityKey(null);
    }
  }, [searchResults, selectedSearchCityKey]);

  const selectedByCityKey = selectedSearchCityKey
    ? searchResults.find((r) => r.cityKey === selectedSearchCityKey) ?? null
    : null;
  const searchSelection =
    selectedByCityKey ??
    (searchResults.length === 1
      ? searchResults[0]
      : searchResults.length > 1 && selectedSearchCityKey
        ? searchResults.find((r) => r.cityKey === selectedSearchCityKey) ?? null
        : null);

  const selectedMetroLabel =
    selectedMetroKey == null
      ? null
      : builtInSet.has(selectedMetroKey)
        ? formatGeoLabel(selectedMetroKey)
        : customMetros[selectedMetroKey]?.label ?? formatGeoLabel(selectedMetroKey);
  const subareasForSelected = useMemo(
    () => (selectedMetroKey == null ? [] : getSubareasWithCities(selectedMetroKey, customMetros)),
    [selectedMetroKey, customMetros]
  );
  const selectedSubarea =
    selectedSubareaKey == null ? null : subareasForSelected.find((s) => s.subareaKey === selectedSubareaKey) ?? null;

  useEffect(() => {
    if (!selectedMetroKey || subareasForSelected.length === 0) {
      setSelectedSubareaKey(null);
      return;
    }
    if (!selectedSubarea || !subareasForSelected.some((s) => s.subareaKey === selectedSubarea.subareaKey)) {
      setSelectedSubareaKey(subareasForSelected[0].subareaKey);
    }
  }, [selectedMetroKey, subareasForSelected, selectedSubarea]);

  const handleAdd = async () => {
    if (!selectedTemplateKey) return;
    const template = getMetroTemplateByKey(selectedTemplateKey);
    if (!template) return;
    await addCustomMetro(template.metroKey, toCustomMetro(template));
    setAddOpen(false);
    setSelectedTemplateKey('');
  };

  const handleRemove = async (metroKey: string) => {
    if (builtInSet.has(metroKey)) return;
    setDeleteError(null);
    setDeletingMetroKey(metroKey);
    try {
      await removeCustomMetro(metroKey);
      if (selectedMetroKey === metroKey) setSelectedMetroKey(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setDeleteError(`Could not remove metro: ${message}`);
    } finally {
      setDeletingMetroKey(null);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ px: { xs: 2, md: 3 }, py: 2, maxWidth: 960 }}>
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
      {deleteError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setDeleteError(null)}>
          {deleteError}
        </Alert>
      )}

      {/* City search: type a city name to see Metro → Area → City */}
      <TextField
        fullWidth
        size="small"
        placeholder="Search for a city (e.g. Joliet, Webster)"
        value={searchQuery}
        onChange={(e) => {
          setSearchQuery(e.target.value);
          setSelectedSearchCityKey(null);
        }}
        sx={{ mb: 2 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon color="action" />
            </InputAdornment>
          ),
        }}
      />
      {searchResults.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            {searchResults.length === 1
              ? 'City in hierarchy'
              : `Multiple matches (${searchResults.length}) — pick one`}
          </Typography>
          {searchResults.length > 1 ? (
            <FormControl size="small" fullWidth sx={{ mb: 2 }}>
              <InputLabel id="search-city-select-label">City</InputLabel>
              <Select
                labelId="search-city-select-label"
                label="City"
                value={selectedSearchCityKey ?? ''}
                onChange={(e) => setSelectedSearchCityKey(e.target.value || null)}
              >
                {searchResults.map((hit) => (
                  <MenuItem key={hit.cityKey} value={hit.cityKey}>
                    {formatGeoLabel(hit.cityKey)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : null}
          {searchSelection && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <PlaceIcon color="primary" fontSize="small" />
              <Typography variant="body2">
                <strong>{formatGeoLabel(searchSelection.cityKey)}</strong>
                {' is in '}
                <strong>{searchSelection.metroLabel}</strong>
                {' → '}
                <strong>{searchSelection.subareaLabel}</strong>
              </Typography>
            </Box>
          )}
        </Paper>
      )}
      {searchQuery.trim() && searchResults.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          No city matching &quot;{searchQuery}&quot; in current metros.
        </Typography>
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

      <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
        {/* Left: metro list */}
        <List
          dense
          sx={{
            flex: { md: '0 0 280px' },
            bgcolor: 'background.paper',
            borderRadius: 1,
            border: '1px solid',
            borderColor: 'divider',
            maxHeight: { md: 420 },
            overflow: 'auto',
          }}
        >
          {allMetroKeys.map((metroKey) => {
            const isBuiltIn = builtInSet.has(metroKey);
            const label = isBuiltIn ? formatGeoLabel(metroKey) : (customMetros[metroKey]?.label ?? formatGeoLabel(metroKey));
            const selected = selectedMetroKey === metroKey;
            return (
              <ListItem
                key={metroKey}
                selected={selected}
                onClick={() => {
                  setSelectedMetroKey(metroKey);
                  setSelectedSubareaKey(null);
                }}
                secondaryAction={
                  !isBuiltIn ? (
                    <IconButton
                      edge="end"
                      size="small"
                      disabled={deletingMetroKey === metroKey}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemove(metroKey);
                      }}
                      aria-label={`Remove ${label}`}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  ) : null
                }
                sx={{
                  cursor: 'pointer',
                  borderRadius: 1,
                  mb: 0.5,
                  bgcolor: selected ? 'action.selected' : 'transparent',
                  '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
                }}
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

        {/* Middle: areas for selected metro */}
        <Paper
          variant="outlined"
          sx={{
            flex: { md: '0 0 320px' },
            minHeight: 200,
            p: 2,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'auto',
          }}
        >
          {selectedMetroKey == null ? (
            <Typography variant="body2" color="text.secondary">
              Click a metro on the left to see its areas and cities.
            </Typography>
          ) : (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 1 }}>
                <Typography variant="subtitle1" fontWeight={600}>
                  {selectedMetroLabel}
                </Typography>
                {selectedMetroKey && !builtInSet.has(selectedMetroKey) && !!getMetroTemplateByKey(selectedMetroKey) && (
                  <Button
                    size="small"
                    startIcon={<RefreshIcon />}
                    onClick={async () => {
                      const template = getMetroTemplateByKey(selectedMetroKey);
                      if (template) await addCustomMetro(selectedMetroKey, toCustomMetro(template));
                    }}
                  >
                    Update to latest template
                  </Button>
                )}
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Areas
              </Typography>
              <List dense disablePadding sx={{ mb: 2 }}>
                {subareasForSelected.map((sub) => {
                  const subSelected = selectedSubareaKey === sub.subareaKey;
                  return (
                    <ListItem
                      key={sub.subareaKey}
                      dense
                      onClick={() => setSelectedSubareaKey(sub.subareaKey)}
                      selected={subSelected}
                      sx={{
                        cursor: 'pointer',
                        borderRadius: 1,
                        mb: 0.5,
                        bgcolor: subSelected ? 'action.selected' : 'transparent',
                        '&:hover': { bgcolor: subSelected ? 'action.selected' : 'action.hover' },
                      }}
                    >
                      <ListItemText
                        primary={sub.label}
                        secondary={`${sub.cityKeys.length} cit${sub.cityKeys.length === 1 ? 'y' : 'ies'}`}
                      />
                    </ListItem>
                  );
                })}
              </List>
            </>
          )}
        </Paper>

        {/* Right: cities for selected area */}
        <Paper
          variant="outlined"
          sx={{
            flex: 1,
            minHeight: 200,
            p: 2,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'auto',
          }}
        >
          {selectedMetroKey == null ? (
            <Typography variant="body2" color="text.secondary">
              Select a metro and area to view cities.
            </Typography>
          ) : selectedSubarea == null ? (
            <Typography variant="body2" color="text.secondary">
              Select an area to view cities.
            </Typography>
          ) : (
            <>
              <Typography variant="subtitle1" fontWeight={600}>
                Cities in {selectedSubarea.label}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                {selectedSubarea.cityKeys.length} cit{selectedSubarea.cityKeys.length === 1 ? 'y' : 'ies'}
              </Typography>
              <List dense disablePadding>
                {selectedSubarea.cityKeys.map((cityKey) => (
                  <ListItem key={cityKey} sx={{ py: 0.5 }}>
                    <ListItemText primary={formatGeoLabel(cityKey)} />
                  </ListItem>
                ))}
              </List>
            </>
          )}
        </Paper>
      </Box>

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
              {METRO_TEMPLATES.map((t) => {
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
            const t = getMetroTemplateByKey(selectedTemplateKey);
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
