export interface WorkHistoryRow {
  id: string;
  employer: string;
  title: string;
  startDate?: string; // ISO
  endDate?: string;   // ISO or 'Present'
}

export function mapParsedExperienceToRows(parsed: any): WorkHistoryRow[] {
  const exp: any[] = parsed?.experience || [];
  return exp
    .filter((e) => e && (e.company || e.jobTitle))
    .map((e, idx) => ({
      id: `${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 7)}`,
      employer: String(e.company || '').trim(),
      title: String(e.jobTitle || '').trim(),
      startDate: e.startDate ? normalizeDate(e.startDate) : undefined,
      endDate: e.current ? 'Present' : (e.endDate ? normalizeDate(e.endDate) : undefined),
    }));
}

function normalizeDate(input: string): string {
  const s = String(input).trim();
  // Accept formats like MM/YYYY, YYYY, Month YYYY; keep as-is if already recognizable
  return s;
}


