export const canAccessModule = (moduleName: string, userModules: string[]): boolean => {
  return userModules.includes('*') || userModules.includes(moduleName);
};
