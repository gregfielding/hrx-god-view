// Universal Favorites Service
// Supports different types of favorites: jobPosts, users, jobOrders, etc.

export type FavoriteType = 'jobPosts' | 'users' | 'jobOrders' | 'companies' | 'worksites';

export interface FavoritesData {
  [key: string]: string[]; // tenantId -> array of favorite IDs
}

class FavoritesService {
  private static instance: FavoritesService;
  
  public static getInstance(): FavoritesService {
    if (!FavoritesService.instance) {
      FavoritesService.instance = new FavoritesService();
    }
    return FavoritesService.instance;
  }

  // Get favorites for a specific type and tenant
  getFavorites(tenantId: string, type: FavoriteType): string[] {
    try {
      const key = this.getStorageKey(tenantId, type);
      const favorites = localStorage.getItem(key);
      return favorites ? JSON.parse(favorites) : [];
    } catch (error) {
      console.warn(`Failed to load favorites for ${type}:`, error);
      return [];
    }
  }

  // Set favorites for a specific type and tenant
  setFavorites(tenantId: string, type: FavoriteType, favoriteIds: string[]): void {
    try {
      const key = this.getStorageKey(tenantId, type);
      localStorage.setItem(key, JSON.stringify(favoriteIds));
    } catch (error) {
      console.warn(`Failed to save favorites for ${type}:`, error);
    }
  }

  // Toggle a favorite (add if not present, remove if present)
  toggleFavorite(tenantId: string, type: FavoriteType, itemId: string): string[] {
    const favorites = this.getFavorites(tenantId, type);
    const newFavorites = favorites.includes(itemId)
      ? favorites.filter(id => id !== itemId)
      : [...favorites, itemId];
    
    this.setFavorites(tenantId, type, newFavorites);
    return newFavorites;
  }

  // Add a favorite (if not already present)
  addFavorite(tenantId: string, type: FavoriteType, itemId: string): string[] {
    const favorites = this.getFavorites(tenantId, type);
    if (!favorites.includes(itemId)) {
      const newFavorites = [...favorites, itemId];
      this.setFavorites(tenantId, type, newFavorites);
      return newFavorites;
    }
    return favorites;
  }

  // Remove a favorite
  removeFavorite(tenantId: string, type: FavoriteType, itemId: string): string[] {
    const favorites = this.getFavorites(tenantId, type);
    const newFavorites = favorites.filter(id => id !== itemId);
    this.setFavorites(tenantId, type, newFavorites);
    return newFavorites;
  }

  // Check if an item is favorited
  isFavorite(tenantId: string, type: FavoriteType, itemId: string): boolean {
    const favorites = this.getFavorites(tenantId, type);
    return favorites.includes(itemId);
  }

  // Get count of favorites for a type
  getFavoritesCount(tenantId: string, type: FavoriteType): number {
    const favorites = this.getFavorites(tenantId, type);
    return favorites.length;
  }

  // Clear all favorites for a type
  clearFavorites(tenantId: string, type: FavoriteType): void {
    const key = this.getStorageKey(tenantId, type);
    localStorage.removeItem(key);
  }

  // Get storage key for a specific tenant and type
  private getStorageKey(tenantId: string, type: FavoriteType): string {
    return `favorites_${tenantId}_${type}`;
  }

  // Get all favorites data for a tenant (useful for debugging or migration)
  getAllFavorites(tenantId: string): Record<FavoriteType, string[]> {
    const result: Record<string, string[]> = {};
    const types: FavoriteType[] = ['jobPosts', 'users', 'jobOrders', 'companies', 'worksites'];
    
    types.forEach(type => {
      result[type] = this.getFavorites(tenantId, type);
    });
    
    return result as Record<FavoriteType, string[]>;
  }

  // Export favorites data (for backup or migration)
  exportFavorites(tenantId: string): string {
    const allFavorites = this.getAllFavorites(tenantId);
    return JSON.stringify({
      tenantId,
      timestamp: new Date().toISOString(),
      favorites: allFavorites
    }, null, 2);
  }

  // Import favorites data (for restore or migration)
  importFavorites(tenantId: string, jsonData: string): boolean {
    try {
      const data = JSON.parse(jsonData);
      if (data.tenantId !== tenantId) {
        console.warn('Tenant ID mismatch in imported favorites data');
        return false;
      }
      
      const types: FavoriteType[] = ['jobPosts', 'users', 'jobOrders', 'companies', 'worksites'];
      types.forEach(type => {
        if (data.favorites[type] && Array.isArray(data.favorites[type])) {
          this.setFavorites(tenantId, type, data.favorites[type]);
        }
      });
      
      return true;
    } catch (error) {
      console.warn('Failed to import favorites data:', error);
      return false;
    }
  }
}

export default FavoritesService;
