// 🔄 Association Helpers for Backward Compatibility
// This file provides utilities to handle both string IDs and objects in associations

export interface AssociationObject {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  type?: 'primary' | 'secondary';
  // Allow for flexible property access from various entity types
  [key: string]: any;
}

/**
 * Normalizes an association item to object format
 * Handles both string IDs and objects
 */
export function normalizeAssociationItem(item: string | any, entityMap?: any[]): AssociationObject {
  if (typeof item === 'string') {
    // If it's a string ID, try to find the corresponding object
    if (entityMap) {
      const entity = entityMap.find(e => e.id === item);
      if (entity) {
        return {
          id: item,
          name: entity.fullName || entity.name || entity.displayName || 'Unknown',
          email: entity.email || '',
          phone: entity.phone || '',
          type: entity.type
        };
      }
    }
    // Fallback to basic object
    return {
      id: item,
      name: 'Unknown',
      email: '',
      phone: '',
      type: undefined
    };
  }
  
  // If it's already an object, ensure it has required fields
  if (item && typeof item === 'object') {
    return {
      id: item.id || item._id || 'unknown',
      name: item.name || item.fullName || item.companyName || item.title || 'Unknown',
      email: item.email || '',
      phone: item.phone || '',
      type: item.type
    };
  }
  
  // Fallback
  return {
    id: 'unknown',
    name: 'Unknown',
    email: '',
    phone: '',
    type: undefined
  };
}

/**
 * Converts an array of associations to normalized objects
 */
export function normalizeAssociationArray(
  array: (string | any)[] | undefined, 
  entityMap?: any[]
): AssociationObject[] {
  if (!Array.isArray(array)) return [];
  
  return array.map(item => normalizeAssociationItem(item, entityMap));
}

/**
 * Extracts IDs from an array of associations (handles both formats)
 */
export function extractIdsFromAssociations(array: (string | any)[] | undefined): string[] {
  if (!Array.isArray(array)) return [];
  
  return array.map(item => 
    typeof item === 'string' ? item : (item?.id || 'unknown')
  );
}

/**
 * Gets display name from an association item
 */
export function getAssociationDisplayName(
  item: string | any, 
  entityMap?: any[]
): string {
  if (typeof item === 'string') {
    if (entityMap) {
      const entity = entityMap.find(e => e.id === item);
      if (entity) {
        return entity.fullName || entity.name || entity.displayName || item;
      }
    }
    return item;
  }
  
  if (item && typeof item === 'object') {
    return item.name || item.fullName || item.companyName || item.title || item.id || 'Unknown';
  }
  
  return 'Unknown';
}

/**
 * Checks if an association array needs migration (contains string IDs)
 */
export function needsMigration(array: (string | any)[] | undefined): boolean {
  if (!Array.isArray(array)) return false;
  return array.some(item => typeof item === 'string');
}

/**
 * Converts associations to Select component value format (array of IDs)
 */
export function toSelectValue(associations: (string | any)[] | undefined): string[] {
  if (!Array.isArray(associations)) return [];
  return associations.map(item => 
    typeof item === 'string' ? item : (item?.id || 'unknown')
  );
}

/**
 * Merges existing associations with new selections
 */
export function mergeAssociations(
  existing: (string | any)[] | undefined,
  newSelections: string[],
  entityMap?: any[]
): AssociationObject[] {
  const normalizedExisting = normalizeAssociationArray(existing, entityMap);
  const existingIds = normalizedExisting.map(item => item.id);
  
  // Add new selections that aren't already present
  const newItems = newSelections
    .filter(id => !existingIds.includes(id))
    .map(id => normalizeAssociationItem(id, entityMap));
  
  return [...normalizedExisting, ...newItems];
}
