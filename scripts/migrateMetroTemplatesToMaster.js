#!/usr/bin/env node
/**
 * One-time migration: convert metroTemplates.json to metroMaster.json.
 * Adds per-city metadata including coordinates placeholders.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMPLATES_PATH = path.join(REPO_ROOT, 'src/data/metroTemplates.json');
const MASTER_PATH = path.join(REPO_ROOT, 'src/data/metroMaster.json');

function toTitleCase(text) {
  return String(text || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function parseCityKey(cityKey) {
  const parts = String(cityKey || '').split('_');
  if (parts.length < 2) {
    return {
      cityKey,
      city: toTitleCase(cityKey.replace(/_/g, ' ')),
      state: '',
    };
  }
  const state = parts[parts.length - 1].toUpperCase();
  const city = toTitleCase(parts.slice(0, -1).join(' '));
  return { cityKey, city, state };
}

function run() {
  const templates = JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf8'));
  if (!Array.isArray(templates)) {
    throw new Error('Expected metroTemplates.json to be an array');
  }

  const master = templates.map((metro) => ({
    metroKey: metro.metroKey,
    label: metro.label,
    subareas: (metro.subareas || []).map((subarea) => ({
      subareaKey: subarea.subareaKey,
      label: subarea.label,
      cities: (subarea.cityKeys || []).map((cityKey) => {
        const parsed = parseCityKey(cityKey);
        return {
          cityKey: parsed.cityKey,
          city: parsed.city,
          state: parsed.state,
          coordinates: {
            lat: null,
            lng: null,
          },
        };
      }),
    })),
  }));

  fs.writeFileSync(MASTER_PATH, JSON.stringify(master, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${master.length} metros to ${path.relative(REPO_ROOT, MASTER_PATH)}`);
}

run();
