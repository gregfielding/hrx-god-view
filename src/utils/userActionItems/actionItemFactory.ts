import { ACTION_ITEMS_RULES_VERSION, type ActionItem, type ActionItemType } from '../../types/actionItems';

export function makeActionItem(
  partial: Omit<ActionItem, 'id' | 'rulesVersion'> & { type: ActionItemType },
): ActionItem {
  return {
    ...partial,
    id: `${partial.dedupeKey}__${partial.type}`,
    rulesVersion: ACTION_ITEMS_RULES_VERSION,
  };
}
