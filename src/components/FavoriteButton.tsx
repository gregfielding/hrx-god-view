import React from 'react';
import { IconButton, IconButtonProps, Tooltip } from '@mui/material';
import { Star, StarBorder } from '@mui/icons-material';
import { FavoriteType } from '../hooks/useFavorites';

interface FavoriteButtonProps extends Omit<IconButtonProps, 'onClick' | 'color' | 'type'> {
  itemId: string;
  favoriteType: FavoriteType;
  isFavorite: (itemId: string) => boolean;
  toggleFavorite: (itemId: string) => string[];
  size?: 'small' | 'medium' | 'large';
  showTooltip?: boolean;
  tooltipText?: {
    favorited: string;
    notFavorited: string;
  };
  color?: 'default' | 'primary' | 'secondary' | 'warning';
  onToggle?: (isFavorited: boolean) => void;
}

const FavoriteButton: React.FC<FavoriteButtonProps> = ({
  itemId,
  favoriteType,
  isFavorite,
  toggleFavorite,
  size = 'small',
  showTooltip = true,
  tooltipText = {
    favorited: 'Remove from favorites',
    notFavorited: 'Add to favorites'
  },
  color = 'warning',
  onToggle,
  sx,
  ...props
}) => {
  const favorited = isFavorite(itemId);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation(); // Prevent parent click events
    const newFavorites = toggleFavorite(itemId);
    const isNowFavorited = newFavorites.includes(itemId);
    onToggle?.(isNowFavorited);
  };

  const button = (
    <IconButton
      {...props}
      size={size}
      onClick={handleClick}
      sx={{
        color: favorited ? `${color}.main` : 'text.secondary',
        // Globally lock the star glyph at 1.2rem so favorite stars read
        // as a compact inline marker across every table / card / toolbar
        // — without this the icon defaults to 1.5rem and dwarfs the
        // 12px table cell text.
        '& .MuiSvgIcon-root': {
          fontSize: '1.2rem',
        },
        '&:hover': {
          color: `${color}.main`,
          backgroundColor: `${color}.light`,
          opacity: 0.8,
        },
        ...sx,
      }}
    >
      {favorited ? <Star /> : <StarBorder />}
    </IconButton>
  );

  if (showTooltip) {
    return (
      <Tooltip title={favorited ? tooltipText.favorited : tooltipText.notFavorited}>
        {button}
      </Tooltip>
    );
  }

  return button;
};

export default FavoriteButton;
