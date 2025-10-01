// Phase 3 M1 — Deal Stage Adapter
// Read/write values by registry fieldId while preserving current stageData structure

type Deal = any;

const aliases: Record<string, Array<{ stage?: string; path: string }>> = {
  jobTitle: [
    { stage: 'discovery', path: 'jobTitles.0' },
  ],
  experienceLevel: [
    { stage: 'qualification', path: 'experienceLevel' },
  ],
  startDate: [
    { stage: 'qualification', path: 'expectedStartDate' },
  ],
  payRate: [
    { stage: 'qualification', path: 'expectedAveragePayRate' },
  ],
  shiftType: [
    { stage: 'discovery', path: 'shiftType' },
  ],
  onsiteSupervisionRequired: [
    { stage: 'discovery', path: 'onsiteSupervisionRequired' },
  ],
  currentStaffCount: [
    { stage: 'discovery', path: 'currentStaffCount' },
  ],
  currentAgencyCount: [
    { stage: 'discovery', path: 'currentAgencyCount' },
  ],
  employmentType: [
    { stage: 'discovery', path: 'employmentType' },
  ],
  hasUsedAgenciesBefore: [
    { stage: 'discovery', path: 'hasUsedAgenciesBefore' },
  ],
  workersNeeded: [
    { stage: 'qualification', path: 'staffPlacementTimeline.starting' },
  ],
  notes: [
    { path: 'notes' },
  ],
  priority: [
    { path: 'priority' },
  ],
};

function get(obj: any, path: string): any {
  if (!obj) return undefined;
  const parts = path.split('.');
  let cur = obj;
  for (const part of parts) {
    const isIndex = /^\d+$/.test(part);
    if (isIndex) {
      const idx = parseInt(part, 10);
      if (!Array.isArray(cur)) return undefined;
      cur = cur[idx];
    } else {
      cur = cur?.[part];
    }
    if (cur === undefined) return undefined;
  }
  return cur;
}

function set(obj: any, path: string, value: any): void {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isIndex = /^\d+$/.test(part);
    const last = i === parts.length - 1;
    const next = parts[i + 1];
    const nextIsIndex = next !== undefined && /^\d+$/.test(next);

    if (last) {
      if (isIndex) {
        const idx = parseInt(part, 10);
        if (!Array.isArray(cur)) {
          // if current container isn't an array, create it
          // Note: this happens when parent created an object; replace with array if safe
          // For adapter writes we assume safe to promote empty object to array
          if (cur && typeof cur === 'object') {
            // cannot replace reference cleanly here; rely on earlier branch to ensure arrays
          }
        }
        if (Array.isArray(cur)) {
          if (cur.length <= idx) cur.length = idx + 1;
          cur[idx] = value;
        }
      } else {
        cur[part] = value;
      }
    } else {
      if (isIndex) {
        const idx = parseInt(part, 10);
        if (!Array.isArray(cur)) {
          // cannot index into non-array; initialize as array when possible
          return;
        }
        if (cur[idx] === undefined) {
          cur[idx] = nextIsIndex ? [] : {};
        }
        cur = cur[idx];
      } else {
        if (cur[part] === undefined) {
          cur[part] = nextIsIndex ? [] : {};
        }
        cur = cur[part];
      }
    }
  }
}

export function getValue(fieldId: string, deal: Deal): any {
  const rules = aliases[fieldId] || [];
  for (const r of rules) {
    if (r.stage) {
      const v = get(deal?.stageData?.[r.stage], r.path);
      if (v !== undefined) return v;
    } else {
      const v = get(deal, r.path);
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

export function setValue(fieldId: string, value: any, dealDraft: Deal): void {
  const rules = aliases[fieldId] || [];
  if (rules.length === 0) return;
  const r = rules[0];
  if (r.stage) {
    dealDraft.stageData = dealDraft.stageData || {};
    dealDraft.stageData[r.stage] = dealDraft.stageData[r.stage] || {};
    set(dealDraft.stageData[r.stage], r.path, value);
  } else {
    set(dealDraft, r.path, value);
  }
}

// Helpers for entity associations
export function getPrimaryCompanyId(deal: Deal): string | undefined {
  return deal.companyId || deal.associations?.companies?.[0]?.id || deal.associations?.companies?.[0];
}

export function getPrimaryLocation(deal: Deal): { id?: string; name?: string } {
  const loc = Array.isArray(deal.associations?.locations) ? deal.associations.locations[0] : undefined;
  if (!loc) return {};
  return typeof loc === 'string' ? { id: loc } : { id: loc.id, name: loc?.snapshot?.name || loc.name };
}


