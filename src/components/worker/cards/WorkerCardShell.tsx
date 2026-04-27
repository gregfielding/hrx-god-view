/**
 * WorkerCardShell — shared card layout for worker surfaces.
 * Pattern: category/context label → title → subtitle → metadata row(s) → status → primary CTA, optional secondary CTA.
 * Uses subtle tinted background (no images). Consistent spacing, radius, typography.
 */

import React from 'react';
import { Card, CardContent, Typography, Stack, Button } from '@mui/material';

export interface WorkerCardShellTheme {
  bg: string;
  contrast: string;
}

export interface WorkerCardShellProps {
  /** Category or context label (e.g. "Your Next Shift", "Application Update") */
  label: string;
  /** Main title */
  title: string;
  /** Optional subtitle (e.g. company name) */
  subtitle?: string;
  /** Metadata lines shown below subtitle */
  metadata?: string[];
  /** Status or support text */
  status?: string;
  /** Primary CTA label and handler */
  primaryCta: { label: string; onClick: (e: React.MouseEvent) => void };
  /** Optional secondary CTA */
  secondaryCta?: { label: string; onClick: (e: React.MouseEvent) => void };
  /** Optional tertiary CTA (e.g. Get Directions) */
  tertiaryCta?: { label: string; onClick: (e: React.MouseEvent) => void };
  /** Theme colors */
  theme: WorkerCardShellTheme;
  /** Click on card body (e.g. expand / view details) */
  onCardClick?: () => void;
  /** Min height for consistent card sizing */
  minHeight?: number;
  /** Extra content below metadata, above CTAs */
  children?: React.ReactNode;
}

const WorkerCardShell: React.FC<WorkerCardShellProps> = ({
  label,
  title,
  subtitle,
  metadata = [],
  status,
  primaryCta,
  secondaryCta,
  tertiaryCta,
  theme,
  onCardClick,
  minHeight = 240,
  children,
}) => {
  const { bg, contrast } = theme;

  return (
    <Card
      variant="outlined"
      onClick={onCardClick}
      sx={{
        width: '100%',
        minHeight,
        borderRadius: 3,
        border: 'none',
        boxShadow: 2,
        backgroundColor: bg,
        color: contrast,
        cursor: onCardClick ? 'pointer' : 'default',
      }}
    >
      <CardContent sx={{ p: 2.5, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Typography variant="overline" sx={{ color: contrast, opacity: 0.9, fontWeight: 600 }}>
          {label}
        </Typography>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, color: contrast, mt: 0.5 }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" sx={{ color: contrast, opacity: 0.85 }}>
            {subtitle}
          </Typography>
        )}
        {metadata.map((line, i) => (
          <Typography key={i} variant="body2" sx={{ color: contrast, opacity: 0.9 }}>
            {line}
          </Typography>
        ))}
        {status && (
          <Typography variant="caption" sx={{ color: contrast, opacity: 0.8, display: 'block', mt: 0.5 }}>
            {status}
          </Typography>
        )}
        {children}
        <Stack
          direction="row"
          spacing={1}
          sx={{ mt: 2 }}
          flexWrap="wrap"
          useFlexGap
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="contained"
            size="medium"
            onClick={primaryCta.onClick}
            sx={{ bgcolor: contrast, color: bg, '&:hover': { bgcolor: contrast, opacity: 0.9 } }}
          >
            {primaryCta.label}
          </Button>
          {secondaryCta && (
            <Button
              variant="outlined"
              size="medium"
              onClick={secondaryCta.onClick}
              sx={{ borderColor: contrast, color: contrast }}
            >
              {secondaryCta.label}
            </Button>
          )}
          {tertiaryCta && (
            <Button
              variant="outlined"
              size="medium"
              onClick={tertiaryCta.onClick}
              sx={{ borderColor: contrast, color: contrast }}
            >
              {tertiaryCta.label}
            </Button>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
};

export default WorkerCardShell;
