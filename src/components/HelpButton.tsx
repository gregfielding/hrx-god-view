import React, { useState } from 'react';
import { IconButton, Badge } from '@mui/material';
import { Help as HelpIcon } from '@mui/icons-material';

import HelpDrawer from './HelpDrawer';

interface HelpButtonProps {
  componentId: string;
  title?: string;
  showBadge?: boolean;
  badgeContent?: number;
  size?: 'small' | 'medium' | 'large';
  color?: 'primary' | 'secondary' | 'default';
  sx?: any;
}

const HelpButton: React.FC<HelpButtonProps> = ({
  componentId,
  title = 'Help',
  showBadge = false,
  badgeContent = 0,
  size = 'medium',
  color = 'primary',
  sx = {},
}) => {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleClick = () => {
    setDrawerOpen(true);
  };

  const handleClose = () => {
    setDrawerOpen(false);
  };

  const button = (
    <IconButton
      onClick={handleClick}
      size={size}
      color={color}
      sx={{
        position: 'fixed',
        top: 100,
        right: 24,
        zIndex: 1000,
        backgroundColor: 'background.paper',
        boxShadow: 2,
        '&:hover': {
          backgroundColor: 'action.hover',
          transform: 'scale(1.1)',
        },
        transition: 'all 0.2s ease-in-out',
        ...sx,
      }}
    >
      <HelpIcon />
    </IconButton>
  );

  return (
    <>
      {showBadge ? (
        <Badge badgeContent={badgeContent} color="error">
          {button}
        </Badge>
      ) : (
        button
      )}

      <HelpDrawer open={drawerOpen} onClose={handleClose} componentId={componentId} title={title} />
    </>
  );
};

export default HelpButton;
