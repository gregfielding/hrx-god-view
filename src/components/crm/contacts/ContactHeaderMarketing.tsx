import React, { useMemo } from 'react';
import {
  Box,
  Chip,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';

export type CrmContactIndustrySegment = 'healthcare' | 'hospitality' | 'industrial' | 'none';

const INDUSTRY_OPTIONS: { value: CrmContactIndustrySegment; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'hospitality', label: 'Hospitality' },
  { value: 'industrial', label: 'Industrial' },
];

export interface ContactHeaderMarketingProps {
  contact: {
    companyName?: string;
    jobTitle?: string;
    marketingTags?: string[];
    industrySegment?: CrmContactIndustrySegment;
    marketingEnabled?: boolean;
  };
  onUpdateMarketing: (update: {
    industrySegment?: CrmContactIndustrySegment;
    marketingTags?: string[];
    marketingEnabled?: boolean;
  }) => void | Promise<void>;
}

function getAutoMarketingTags(contact: { companyName?: string; jobTitle?: string }): string[] {
  const tags: string[] = [];
  if (contact.companyName) tags.push(`company:${contact.companyName}`);
  if (contact.jobTitle) tags.push(`role:${contact.jobTitle}`);
  return tags;
}

function formatTagLabel(tag: string): string {
  if (tag.startsWith('company:')) return tag.replace(/^company:/, '');
  if (tag.startsWith('role:')) return tag.replace(/^role:/, '');
  return tag;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const trimmed = (v || '').trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export const ContactHeaderMarketing: React.FC<ContactHeaderMarketingProps> = ({ contact, onUpdateMarketing }) => {
  const autoTags = useMemo(() => getAutoMarketingTags(contact), [contact.companyName, contact.jobTitle]);
  const allTags = contact.marketingTags || [];
  const manualTags = useMemo(
    () => allTags.filter((t) => !autoTags.includes(t)),
    [allTags, autoTags]
  );

  const industrySegment: CrmContactIndustrySegment = contact.industrySegment || 'none';

  const upsertTags = async (nextManualTags: string[]) => {
    const merged = uniqueStrings([...autoTags, ...nextManualTags]);
    await onUpdateMarketing({
      marketingTags: merged,
      // Default-on unless explicitly set false elsewhere
      marketingEnabled: contact.marketingEnabled ?? true,
    });
  };

  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      flexWrap="wrap"
      sx={{ mt: 1 }}
    >
      <Typography
        variant="subtitle2"
        sx={{ fontWeight: 700, color: 'rgba(0, 0, 0, 0.55)' }}
      >
        Marketing
      </Typography>

      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ minWidth: 0 }}>
        {autoTags.map((tag) => (
          <Chip
            key={tag}
            label={formatTagLabel(tag)}
            size="small"
            variant="outlined"
            sx={{ height: 26, borderRadius: 1 }}
          />
        ))}

        {manualTags.map((tag) => (
          <Chip
            key={tag}
            label={tag}
            size="small"
            color="primary"
            sx={{ height: 26, borderRadius: 1 }}
          />
        ))}
      </Stack>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minWidth: 0 }}>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

        <Typography variant="body2" sx={{ color: 'rgba(0, 0, 0, 0.55)', fontWeight: 500 }}>
          Segment:
        </Typography>

        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Segment</InputLabel>
          <Select
            value={industrySegment}
            label="Segment"
            onChange={(e) =>
              onUpdateMarketing({
                industrySegment: e.target.value as CrmContactIndustrySegment,
                marketingEnabled: contact.marketingEnabled ?? true,
              })
            }
            sx={{
              height: 32,
              borderRadius: 1,
              fontSize: '0.875rem',
            }}
          >
            {INDUSTRY_OPTIONS.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>
                {opt.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>
    </Stack>
  );
};


