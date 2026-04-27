import React from 'react';
import { IconButton, Tooltip, type IconButtonProps } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import {
  recordHeaderActionIconButtonSx,
  recordHeaderTooltipComponentsProps,
} from './recordHeaderStyles';

export type RecordHeaderActionIconProps = IconButtonProps & {
  tooltip: string;
} & Pick<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target' | 'rel'>;

/**
 * Consistent header action icon: bordered shell, compact icon, shared tooltip styling.
 */
const RecordHeaderActionIcon = React.forwardRef<HTMLButtonElement, RecordHeaderActionIconProps>(
  function RecordHeaderActionIcon({ tooltip, children, sx, ...rest }, ref) {
    const mergedSx: SxProps<Theme> = sx
      ? ([recordHeaderActionIconButtonSx, sx] as SxProps<Theme>)
      : recordHeaderActionIconButtonSx;
    return (
      <Tooltip
        title={tooltip}
        arrow
        placement="top"
        enterDelay={280}
        componentsProps={recordHeaderTooltipComponentsProps}
      >
        <IconButton ref={ref} size="small" sx={mergedSx} {...rest}>
          {children}
        </IconButton>
      </Tooltip>
    );
  }
);

export default RecordHeaderActionIcon;
