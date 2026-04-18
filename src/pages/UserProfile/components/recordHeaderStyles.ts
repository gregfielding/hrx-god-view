import type { SxProps, Theme } from '@mui/material/styles';

/** Compact utility-strip icon shells — lighter than primary buttons, still tappable. */
export const recordHeaderActionIconButtonSx: SxProps<Theme> = (theme) => ({
  p: 0.3125,
  width: 26,
  height: 26,
  boxSizing: 'border-box',
  color: 'text.secondary',
  bgcolor: theme.palette.mode === 'dark' ? 'action.hover' : 'rgba(0, 0, 0, 0.035)',
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: 1,
  '&:hover': {
    color: 'primary.main',
    bgcolor: theme.palette.action.hover,
    borderColor: theme.palette.divider,
  },
  '& .MuiSvgIcon-root': { fontSize: 15 },
  transition: 'background-color 120ms ease, border-color 120ms ease, color 120ms ease',
});

/** MUI v5 Tooltip — compact, executive; used across record header + action icons. */
export const recordHeaderTooltipComponentsProps = {
  tooltip: {
    sx: {
      fontSize: '0.7rem',
      fontWeight: 500,
      lineHeight: 1.35,
      py: 0.35,
      px: 0.75,
      maxWidth: 220,
    },
  },
  arrow: {
    sx: { fontSize: 18 },
  },
} as const;
