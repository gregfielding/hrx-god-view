import { doc, getDoc } from 'firebase/firestore';

import { db } from '../firebase';

export const canAccessModule = (moduleName: string, userModules: string[]): boolean => {
  return userModules.includes('*') || userModules.includes(moduleName);
};

// New function to check if a module is enabled for a tenant
export const isModuleEnabled = async (tenantId: string, moduleId: string): Promise<boolean> => {
  try {
    const modulesRef = doc(db, 'tenants', tenantId, 'aiSettings', 'modules');
    const modulesSnap = await getDoc(modulesRef);
    
    if (modulesSnap.exists()) {
      const modules = modulesSnap.data().modules || [];
      const module = modules.find((m: any) => m.id === moduleId);
      return module ? module.isEnabled : false;
    }
    return false;
  } catch (error) {
    console.error('Error checking module status:', error);
    return false;
  }
};

// New function to get module settings for a tenant
export const getModuleSettings = async (tenantId: string, moduleId: string): Promise<any> => {
  try {
    const modulesRef = doc(db, 'tenants', tenantId, 'aiSettings', 'modules');
    const modulesSnap = await getDoc(modulesRef);
    
    if (modulesSnap.exists()) {
      const modules = modulesSnap.data().modules || [];
      const module = modules.find((m: any) => m.id === moduleId);
      return module ? module.settings || {} : {};
    }
    return {};
  } catch (error) {
    console.error('Error getting module settings:', error);
    return {};
  }
};

// New function to check if a specific setting is enabled
export const isModuleSettingEnabled = async (
  tenantId: string, 
  moduleId: string, 
  settingKey: string
): Promise<boolean> => {
  try {
    const settings = await getModuleSettings(tenantId, moduleId);
    return settings[settingKey] === true;
  } catch (error) {
    console.error('Error checking module setting:', error);
    return false;
  }
};

// New function to get all enabled modules for a tenant
export const getEnabledModules = async (tenantId: string): Promise<string[]> => {
  try {
    const modulesRef = doc(db, 'tenants', tenantId, 'aiSettings', 'modules');
    const modulesSnap = await getDoc(modulesRef);
    
    if (modulesSnap.exists()) {
      const modules = modulesSnap.data().modules || [];
      return modules
        .filter((m: any) => m.isEnabled)
        .map((m: any) => m.id);
    }
    return [];
  } catch (error) {
    console.error('Error getting enabled modules:', error);
    return [];
  }
};
