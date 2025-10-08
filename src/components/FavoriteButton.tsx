import React from 'react';
import { IconButton, IconButtonProps, Tooltip } from '@mui/material';
import { Star, StarBorder } from '@mui/icons-material';
import { useFavorites, FavoriteType } from '../hooks/useFavorites';

interface FavoriteButtonProps extends Omit<IconButtonProps, 'onClick' | 'color' | 'type'> {
  itemId: string;
  favoriteType: FavoriteType;
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
  const { isFavorite, toggleFavorite } = useFavorites(favoriteType);
  
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
        '&:hover': {
          color: `${color}.main`,
          backgroundColor: `${color}.light`,
          opacity: 0.8
        },
        ...sx
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
