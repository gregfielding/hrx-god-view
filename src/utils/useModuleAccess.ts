import { useState, useEffect } from 'react';

import { useAuth } from '../contexts/AuthContext';

import { isModuleEnabled, getModuleSettings, isModuleSettingEnabled, getEnabledModules } from './canAccessModule';

export const useModuleAccess = () => {
  const { tenantId } = useAuth();
  const [enabledModules, setEnabledModules] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadEnabledModules = async () => {
      if (!tenantId) {
        setEnabledModules([]);
        setLoading(false);
        return;
      }

      try {
        const modules = await getEnabledModules(tenantId);
        setEnabledModules(modules);
      } catch (error) {
        console.error('Error loading enabled modules:', error);
        setEnabledModules([]);
      } finally {
        setLoading(false);
      }
    };

    loadEnabledModules();
  }, [tenantId]);

  const checkModuleEnabled = async (moduleId: string): Promise<boolean> => {
    if (!tenantId) return false;
    return await isModuleEnabled(tenantId, moduleId);
  };

  const getModuleSettingsForModule = async (moduleId: string): Promise<any> => {
    if (!tenantId) return {};
    return await getModuleSettings(tenantId, moduleId);
  };

  const checkModuleSetting = async (moduleId: string, settingKey: string): Promise<boolean> => {
    if (!tenantId) return false;
    return await isModuleSettingEnabled(tenantId, moduleId, settingKey);
  };

  const isModuleInEnabledList = (moduleId: string): boolean => {
    return enabledModules.includes(moduleId);
  };

  return {
    enabledModules,
    loading,
    checkModuleEnabled,
    getModuleSettings: getModuleSettingsForModule,
    checkModuleSetting,
    isModuleInEnabledList,
  };
}; 