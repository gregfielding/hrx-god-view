/**
 * Infer card background category from job/role title for worker dashboard.
 * Hospitality, Warehouse, Events, Cleaning, Healthcare, default.
 */

import type { JobCategory } from '../components/worker/dashboard/cards/types';

const HOSPITALITY_KEYWORDS = ['hospitality', 'server', 'dishwasher', 'dish', 'cater', 'food', 'kitchen', 'bartender', 'waiter', 'waitress', 'host'];
const WAREHOUSE_KEYWORDS = ['warehouse', 'fulfillment', 'stock', 'inventory', 'distribution', 'picker', 'packer', 'loader'];
const EVENTS_KEYWORDS = ['event', 'events', 'concert', 'festival', 'conference', 'catering', 'venue'];
const CLEANING_KEYWORDS = ['clean', 'cleaning', 'janitor', 'custodial', 'housekeeping', 'sanitation'];
const HEALTHCARE_KEYWORDS = ['healthcare', 'health', 'care', 'nurse', 'medical', 'clinical'];
const ADMIN_CLERICAL_KEYWORDS = ['admin', 'administrative', 'clerical', 'office', 'reception', 'data entry', 'secretary'];

export function getCategoryForTitle(title: string | undefined): JobCategory {
  if (!title || typeof title !== 'string') return 'default';
  const lower = title.toLowerCase();
  if (HOSPITALITY_KEYWORDS.some((k) => lower.includes(k))) return 'hospitality';
  if (WAREHOUSE_KEYWORDS.some((k) => lower.includes(k))) return 'warehouse';
  if (EVENTS_KEYWORDS.some((k) => lower.includes(k))) return 'events';
  if (CLEANING_KEYWORDS.some((k) => lower.includes(k))) return 'cleaning';
  if (HEALTHCARE_KEYWORDS.some((k) => lower.includes(k))) return 'healthcare';
  if (ADMIN_CLERICAL_KEYWORDS.some((k) => lower.includes(k))) return 'admin';
  return 'default';
}
