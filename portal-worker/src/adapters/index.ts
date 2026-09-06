import type { PortalProvider } from '../../../shared/portalActions.ts';
import { FieldglassAdapter } from './fieldglass.ts';
import { IndeedFlexAdapter } from './indeedFlex.ts';
import type { PortalAdapter } from './types.ts';

export function buildAdapters(providers: PortalProvider[]): Map<PortalProvider, PortalAdapter> {
  const all: Record<PortalProvider, () => PortalAdapter> = {
    indeed_flex: () => new IndeedFlexAdapter(),
    fieldglass: () => new FieldglassAdapter(),
  };
  const map = new Map<PortalProvider, PortalAdapter>();
  for (const p of providers) map.set(p, all[p]());
  return map;
}

export type { PortalAdapter, AdapterContext } from './types.ts';
