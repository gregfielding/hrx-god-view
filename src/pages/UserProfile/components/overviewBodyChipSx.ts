import type { SxProps, Theme } from '@mui/material/styles';

/**
 * Skill chips in Overview Qualifications — small, regular weight, secondary text (subtle vs section headings).
 * Shared with scoring card “signal strip” chips for visual consistency.
 */
export const overviewBodyChipSx: SxProps<Theme> = {
  height: 'auto',
  fontWeight: 400,
  color: 'text.secondary',
  bgcolor: 'transparent',
  borderColor: 'divider',
  py: 0.2,
  fontSize: '0.65rem',
  lineHeight: 1.35,
  '& .MuiChip-label': {
    px: 0.55,
    py: 0.1,
    fontWeight: 400,
    fontSize: '0.65rem',
    lineHeight: 1.35,
    whiteSpace: 'normal',
    color: 'text.secondary',
  },
};
