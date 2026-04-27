/**
 * Derive assignment-level screening requirements for HRX Readiness V1.
 * Job orders often store AccuSource / checklist selections (`backgroundCheckPackages`, `drugScreeningPanels`)
 * while assignment docs may omit denormalized flags — merge assignment + job order like `AssignmentDetails.tsx`.
 */

function hasNonEmptyArray(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0;
}

function complianceField(jobOrder: Record<string, unknown>, key: string): unknown {
  const c = jobOrder.compliance;
  if (!c || typeof c !== 'object') return undefined;
  return (c as Record<string, unknown>)[key];
}

/**
 * Whether this assignment should show background / drug readiness rows (before checking worker completion).
 */
export function mergeAssignmentScreeningFromJobOrder(
  assignment: Record<string, unknown>,
  jobOrder: Record<string, unknown> | null | undefined,
): {
  showBackgroundChecks: boolean;
  backgroundCheckRequired: boolean;
  drugScreenRequired: boolean;
  showDrugScreening: boolean;
} {
  const jo = jobOrder ?? ({} as Record<string, unknown>);

  const joBg =
    Boolean(jo.backgroundCheckRequired ?? jo.showBackgroundChecks) ||
    hasNonEmptyArray(jo.backgroundCheckPackages) ||
    hasNonEmptyArray(complianceField(jo, 'backgroundCheckPackages'));

  const joDrug =
    Boolean(jo.drugScreenRequired ?? jo.showDrugScreening) ||
    hasNonEmptyArray(jo.drugScreeningPanels) ||
    hasNonEmptyArray(complianceField(jo, 'drugScreeningPanels'));

  const assignBg = Boolean(assignment.showBackgroundChecks ?? assignment.backgroundCheckRequired);
  const assignDrug = Boolean(assignment.drugScreenRequired ?? assignment.showDrugScreening);

  const bg = assignBg || joBg;
  const drug = assignDrug || joDrug;

  return {
    showBackgroundChecks: bg,
    backgroundCheckRequired: bg,
    drugScreenRequired: drug,
    showDrugScreening: drug,
  };
}
