import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import FavoritesService, { FavoriteType } from '../services/favoritesService';

export type { FavoriteType };

interface UseFavoritesReturn {
  favorites: string[];
  isFavorite: (itemId: string) => boolean;
  toggleFavorite: (itemId: string) => string[];
  addFavorite: (itemId: string) => string[];
  removeFavorite: (itemId: string) => string[];
  favoritesCount: number;
  loading: boolean;
}

export const useFavorites = (type: FavoriteType): UseFavoritesReturn => {
  const { tenantId } = useAuth();
  const [favorites, setFavorites] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Load favorites from localStorage when component mounts or tenantId changes
  useEffect(() => {
    if (!tenantId) {
      setFavorites([]);
      setLoading(false);
      return;
    }

    try {
      const favoritesService = FavoritesService.getInstance();
      const savedFavorites = favoritesService.getFavorites(tenantId, type);
      setFavorites(savedFavorites);
    } catch (error) {
      console.warn(`Failed to load favorites for ${type}:`, error);
      setFavorites([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId, type]);

  // Toggle favorite status
  const toggleFavorite = useCallback((itemId: string): string[] => {
    if (!tenantId) return favorites;

    const favoritesService = FavoritesService.getInstance();
    const newFavorites = favoritesService.toggleFavorite(tenantId, type, itemId);
    setFavorites(newFavorites);
    return newFavorites;
  }, [tenantId, type, favorites]);

  // Add favorite
  const addFavorite = useCallback((itemId: string): string[] => {
    if (!tenantId) return favorites;

    const favoritesService = FavoritesService.getInstance();
    const newFavorites = favoritesService.addFavorite(tenantId, type, itemId);
    setFavorites(newFavorites);
    return newFavorites;
  }, [tenantId, type, favorites]);

  // Remove favorite
  const removeFavorite = useCallback((itemId: string): string[] => {
    if (!tenantId) return favorites;

    const favoritesService = FavoritesService.getInstance();
    const newFavorites = favoritesService.removeFavorite(tenantId, type, itemId);
    setFavorites(newFavorites);
    return newFavorites;
  }, [tenantId, type, favorites]);

  // Check if item is favorited
  const isFavorite = useCallback((itemId: string): boolean => {
    return favorites.includes(itemId);
  }, [favorites]);

  // Get favorites count
  const favoritesCount = favorites.length;

  return {
    favorites,
    isFavorite,
    toggleFavorite,
    addFavorite,
    removeFavorite,
    favoritesCount,
    loading
  };
};

// Hook for filtering items by favorites
export const useFavoritesFilter = <T extends { id: string }>(
  type: FavoriteType,
  items: T[],
  showFavoritesOnly = false
): T[] => {
  const { favorites } = useFavorites(type);

  if (!showFavoritesOnly) {
    return items;
  }

  return items.filter(item => favorites.includes(item.id));
};
