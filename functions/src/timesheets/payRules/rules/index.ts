/**
 * Pay rule registry — maps a state code (case-insensitive,
 * trim-tolerant) to the right `PayRuleSet`. Single source of truth
 * for "what rules apply to a worksite in this state".
 *
 * **Fallback semantics:** unknown / null / malformed state codes
 * resolve to `defaultRules` (federal FLSA only). The engine MUST
 * NOT throw on bad input — payroll has to compute even when a
 * worksite's address is incomplete; we'd rather pay federal-correct
 * than fail the whole pay period.
 */

import {PayRuleSet, StateCode} from "../types";
import {caRules} from "./ca";
import {defaultRules} from "./default";
import {maRules} from "./ma";
import {nyRules} from "./ny";
import {txRules} from "./tx";

const REGISTRY: Record<string, PayRuleSet> = {
  CA: caRules,
  NY: nyRules,
  TX: txRules,
  MA: maRules,
  DEFAULT: defaultRules,
};

/**
 * Resolve a state code to a `PayRuleSet`. Trim-tolerant and case-
 * insensitive; falls through to DEFAULT for unknowns.
 *
 *   getPayRuleSetForState('CA')      → caRules
 *   getPayRuleSetForState(' ca ')    → caRules
 *   getPayRuleSetForState('California') → defaultRules (we expect 2-letter codes)
 *   getPayRuleSetForState(null)      → defaultRules
 *   getPayRuleSetForState('')        → defaultRules
 *   getPayRuleSetForState('ZZ')      → defaultRules
 */
export function getPayRuleSetForState(
  stateCode: StateCode | null | undefined,
): PayRuleSet {
  if (typeof stateCode !== "string") return defaultRules;
  const key = stateCode.trim().toUpperCase();
  if (!key) return defaultRules;
  return REGISTRY[key] ?? defaultRules;
}

/** All registered rule sets — useful for tests and admin tooling. */
export function listPayRuleSets(): ReadonlyArray<PayRuleSet> {
  return Object.values(REGISTRY);
}

export {caRules, defaultRules, maRules, nyRules, txRules};
