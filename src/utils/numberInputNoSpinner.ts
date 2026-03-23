import type { SxProps, Theme } from '@mui/material/styles';

/**
 * MUI `sx` fragment to hide browser up/down spinners on `TextField type="number"`.
 * Keeps numeric keyboard behavior without the fiddly stepper UI.
 */
export const numberInputNoSpinnerSx: SxProps<Theme> = {
  '& input[type=number]': {
    MozAppearance: 'textfield',
  },
  '& input[type=number]::-webkit-outer-spin-button, & input[type=number]::-webkit-inner-spin-button': {
    WebkitAppearance: 'none',
    margin: 0,
  },
};
