/**
 * Settings → APIs & Services → &lt;integration&gt; — detail content (main pane).
 */

import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Link, Typography, Chip, Stack } from '@mui/material';
import { API_SERVICE_CATEGORY_LABELS, type ApiServiceCatalogEntry } from '../../../config/apisAndServicesCatalog';
import { findNavItemLabel } from '../../../config/settingsNavigation';
import type { SettingsTab } from '../../../config/settingsNavigation';

export interface ApiServiceDetailContentProps {
  entry: ApiServiceCatalogEntry;
}

const ApiServiceDetailContent: React.FC<ApiServiceDetailContentProps> = ({ entry }) => {
  const relatedTab = entry.relatedSettingsTab;

  return (
    <Box sx={{ px: { xs: 2, md: 3 }, py: 2, maxWidth: 900 }}>
      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
        {entry.name}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {entry.summary}
      </Typography>

      <Chip size="small" label={API_SERVICE_CATEGORY_LABELS[entry.categoryId]} sx={{ mb: 2 }} />

      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
        What it does for HRX
      </Typography>
      <Box component="ul" sx={{ pl: 2.25, m: 0, mb: 2 }}>
        {entry.whatItDoes.map((line, i) => (
          <Typography key={`w-${i}`} component="li" variant="body2" sx={{ mb: 0.5 }}>
            {line}
          </Typography>
        ))}
      </Box>

      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
        Where it shows up
      </Typography>
      <Box component="ul" sx={{ pl: 2.25, m: 0, mb: 2 }}>
        {entry.surfaces.map((line, i) => (
          <Typography key={`s-${i}`} component="li" variant="body2" sx={{ mb: 0.5 }}>
            {line}
          </Typography>
        ))}
      </Box>

      {entry.technicalNotes?.length ? (
        <>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Technical notes
          </Typography>
          <Box component="ul" sx={{ pl: 2.25, m: 0, mb: 2 }}>
            {entry.technicalNotes.map((line, i) => (
              <Typography key={`t-${i}`} component="li" variant="body2" sx={{ mb: 0.5 }}>
                {line}
              </Typography>
            ))}
          </Box>
        </>
      ) : null}

      {(relatedTab || entry.internalDocPath) && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Related
          </Typography>
          <Stack spacing={1}>
            {relatedTab ? (
              <Link
                component={RouterLink}
                to={`/settings?tab=${encodeURIComponent(relatedTab)}`}
                variant="body2"
              >
                Open related settings ({findNavItemLabel(relatedTab as SettingsTab)})
              </Link>
            ) : null}
            {entry.internalDocPath ? (
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', display: 'block' }}>
                Doc: {entry.internalDocPath}
              </Typography>
            ) : null}
          </Stack>
        </Box>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3 }}>
        Catalog:{' '}
        <Box component="span" sx={{ fontFamily: 'monospace' }}>
          src/config/apisAndServicesCatalog.ts
        </Box>
      </Typography>
    </Box>
  );
};

export default ApiServiceDetailContent;
