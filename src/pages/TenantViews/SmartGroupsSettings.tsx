/**
 * Settings > Smart Groups: view built-in metros (Metro → Area → City).
 * Source of truth is metroMaster.json. Click a metro to see subareas; click a subarea to see cities.
 * Search for a city to see its metro → area hierarchy.
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  Box,
  List,
  ListItem,
  ListItemText,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  InputAdornment,
  Paper,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import PlaceIcon from '@mui/icons-material/Place';

import {
  getMergedMetroOptions,
  getMergedSubareaOptionsForMetro,
  getMergedCityOptionsForSubarea,
  formatGeoLabel,
  type CustomMetroInput,
} from '../../data/metroSubareaSchema';
import { getMetroTemplateByKey, getMetroDisplayLabel } from '../../data/metroMaster';

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
  const template = getMetroTemplateByKey(metroKey);
  const subareaKeys = getMergedSubareaOptionsForMetro(metroKey, customMetros);
  return subareaKeys.map((subareaKey) => {
    const templateSub = template?.subareas?.find((s) => s.subareaKey === subareaKey);
    const label = templateSub?.label ?? formatGeoLabel(subareaKey);
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
    const metroLabel = getMetroTemplateByKey(metroKey)?.label ?? formatGeoLabel(metroKey);
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

const EMPTY_CUSTOM_METROS: Record<string, CustomMetroInput> = {};

const SmartGroupsSettings: React.FC<{ tenantId: string }> = ({ tenantId: _tenantId }) => {
  const [selectedMetroKey, setSelectedMetroKey] = useState<string | null>(null);
  const [selectedSubareaKey, setSelectedSubareaKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSearchCityKey, setSelectedSearchCityKey] = useState<string | null>(null);
  const [citySearchIndex, setCitySearchIndex] = useState<CitySearchHit[] | null>(null);

  // Defer building the search index to avoid blocking initial render (metroMaster is 7MB+)
  useEffect(() => {
    let cancelled = false;
    const build = () => {
      const index = buildCitySearchIndex(EMPTY_CUSTOM_METROS);
      if (!cancelled) setCitySearchIndex(index);
    };
    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(build, { timeout: 3000 });
      return () => {
        cancelled = true;
        cancelIdleCallback(id);
      };
    }
    const t = setTimeout(build, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || !citySearchIndex) return [];
    const filtered = citySearchIndex.filter(
      (hit) => formatGeoLabel(hit.cityKey).toLowerCase().includes(q)
    );
    // Rank: prefer metros whose label contains the query (e.g. "Houston" → Houston, TX first)
    // then cities that start with the query, then rest
    return filtered.sort((a, b) => {
      const metroA = a.metroLabel.toLowerCase();
      const metroB = b.metroLabel.toLowerCase();
      const cityA = formatGeoLabel(a.cityKey).toLowerCase();
      const cityB = formatGeoLabel(b.cityKey).toLowerCase();
      const metroMatchA = metroA.includes(q) ? 1 : 0;
      const metroMatchB = metroB.includes(q) ? 1 : 0;
      if (metroMatchA !== metroMatchB) return metroMatchB - metroMatchA; // metro matches first
      const cityStartsA = cityA.startsWith(q) ? 1 : 0;
      const cityStartsB = cityB.startsWith(q) ? 1 : 0;
      if (cityStartsA !== cityStartsB) return cityStartsB - cityStartsA; // city-starts matches next
      return metroA.localeCompare(metroB);
    });
  }, [citySearchIndex, searchQuery]);

  const searchIndexReady = citySearchIndex !== null;

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
      : getMetroDisplayLabel(selectedMetroKey);
  const subareasForSelected = useMemo(
    () => (selectedMetroKey == null ? [] : getSubareasWithCities(selectedMetroKey, EMPTY_CUSTOM_METROS)),
    [selectedMetroKey]
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

  // When user selects a city from search, sync to the metro/area panels below
  useEffect(() => {
    if (searchSelection) {
      setSelectedMetroKey(searchSelection.metroKey);
      setSelectedSubareaKey(searchSelection.subareaKey);
    }
  }, [searchSelection?.cityKey, searchSelection?.metroKey, searchSelection?.subareaKey]);

  return (
    <Box sx={{ px: { xs: 2, md: 3 }, py: 2, maxWidth: 960 }}>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
        Metros define the geographic hierarchy (Metro → Area → City) used in Smart Groups filters. The list is
        read-only and comes from the central metro data (metroMaster.json).
      </Typography>

      {/* City search: type a city name to see Metro → Area → City */}
      <TextField
        fullWidth
        size="small"
        placeholder={searchIndexReady ? "Search for a city (e.g. Houston, Joliet)" : "Loading search index…"}
        value={searchQuery}
        onChange={(e) => {
          setSearchQuery(e.target.value);
          setSelectedSearchCityKey(null);
        }}
        disabled={!searchIndexReady}
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
                <strong>{getMetroDisplayLabel(searchSelection.metroKey)}</strong>
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

      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
        Metro hierarchy
      </Typography>

      <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
        {/* Left: selected metro (from search) */}
        <Paper
          variant="outlined"
          sx={{
            flex: { md: '0 0 220px' },
            minHeight: 200,
            p: 2,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Metro
          </Typography>
          {selectedMetroKey == null ? (
            <Typography variant="body2" color="text.secondary">
              Search above and select a city to load its metro, areas, and cities.
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <PlaceIcon color="primary" fontSize="small" />
              <Typography variant="subtitle1" fontWeight={600}>
                {selectedMetroLabel}
              </Typography>
            </Box>
          )}
        </Paper>

        {/* Middle: areas for selected metro */}
        <Paper
          variant="outlined"
          sx={{
            flex: { md: '0 0 280px' },
            minHeight: 200,
            p: 2,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'auto',
          }}
        >
          {selectedMetroKey == null ? (
            <Typography variant="body2" color="text.secondary">
              Search and select a city to see its areas.
            </Typography>
          ) : (
            <>
              <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
                {selectedMetroLabel}
              </Typography>
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
              Search and select a city to see its cities.
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
    </Box>
  );
};

export default SmartGroupsSettings;
