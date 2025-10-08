import React from 'react';
import { Button, ButtonProps } from '@mui/material';
import { Star, StarBorder } from '@mui/icons-material';
import { useFavorites, FavoriteType } from '../hooks/useFavorites';

interface FavoritesFilterProps extends Omit<ButtonProps, 'onClick' | 'variant' | 'type'> {
  favoriteType: FavoriteType;
  showFavoritesOnly: boolean;
  onToggle: (showFavoritesOnly: boolean) => void;
  showText?: boolean;
  size?: 'small' | 'medium' | 'large';
}

const FavoritesFilter: React.FC<FavoritesFilterProps> = ({
  favoriteType,
  showFavoritesOnly,
  onToggle,
  showText = true,
  size = 'small',
  sx,
  ...props
}) => {
  const { favoritesCount } = useFavorites(favoriteType);

  const handleClick = () => {
    onToggle(!showFavoritesOnly);
  };

  return (
    <Button
      {...props}
      variant={showFavoritesOnly ? "contained" : "text"}
      size={size}
      onClick={handleClick}
      startIcon={showFavoritesOnly ? <Star /> : <StarBorder />}
      sx={{ 
        minWidth: 'auto',
        p: 0.5,
        '& .MuiButton-startIcon': {
          margin: showText ? '0 4px 0 -4px' : 0
        },
        ...sx
      }}
    >
      {showText && showFavoritesOnly ? 'Favorites' : ''}
      {showText && favoritesCount > 0 && !showFavoritesOnly && (
        <span style={{ marginLeft: 4, fontSize: '0.75rem', opacity: 0.7 }}>
          ({favoritesCount})
        </span>
      )}
    </Button>
  );
};

export default FavoritesFilter;
