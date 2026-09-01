import React from 'react';
import { IconButton, Tooltip, type IconButtonProps } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';
import {
  recordHeaderActionIconButtonSx,
  recordHeaderTooltipComponentsProps,
} from './recordHeaderStyles';

export type RecordHeaderActionIconProps = IconButtonProps & {
  tooltip: string;
  /**
   * Internal route to navigate to. When set, renders as a real
   * React Router `<Link>` (via IconButton's `component` prop) instead of
   * an `onClick`-only button, so right-click/middle-click ("open in new
   * tab", "copy link") work — a plain onClick+navigate() has no real href
   * for the browser to see. Takes precedence over `onClick`/`href` when
   * both are passed.
   */
  to?: string;
} & Pick<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target' | 'rel'>;

/**
 * Consistent header action icon: bordered shell, compact icon, shared tooltip styling.
 */
const RecordHeaderActionIcon = React.forwardRef<HTMLButtonElement, RecordHeaderActionIconProps>(
  function RecordHeaderActionIcon({ tooltip, children, sx, to, ...rest }, ref) {
    const mergedSx: SxProps<Theme> = sx
      ? ([recordHeaderActionIconButtonSx, sx] as SxProps<Theme>)
      : recordHeaderActionIconButtonSx;
    const linkProps = to ? { component: RouterLink, to } : {};
    return (
      <Tooltip
        title={tooltip}
        arrow
        placement="top"
        enterDelay={280}
        componentsProps={recordHeaderTooltipComponentsProps}
      >
        <IconButton ref={ref} size="small" sx={mergedSx} {...linkProps} {...rest}>
          {children}
        </IconButton>
      </Tooltip>
    );
  }
);

export default RecordHeaderActionIcon;
