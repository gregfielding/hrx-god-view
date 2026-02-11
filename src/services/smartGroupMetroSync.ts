/**
 * Smart Groups metro sync: when company worksite locations are created/updated in Firestore,
 * ensure the city is represented in the tenant's Smart Groups metro config.
 * No-op: Smart Groups now use only built-in metros (metroMaster.json). Call sites remain so this can be re-enabled if needed.
 */

/**
 * Ensure a worksite city is represented in the tenant's Smart Groups metros.
 * No-op: Smart Groups now use only built-in metros (metroMaster.json). Custom metros are no longer written.
 * Call sites are left in place so this can be re-enabled if needed.
 */
export async function ensureCityInSmartGroups(
  _tenantId: string,
  _city: string,
  _state: string
): Promise<void> {
  return;
}
