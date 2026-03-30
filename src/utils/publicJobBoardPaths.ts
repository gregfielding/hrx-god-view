/**
 * Paths where staff (securityLevel ≥ 5) may browse like workers: public tenant job board + job detail.
 * Excludes recruiter routes under /jobs/ (e.g. /jobs/jobs-board/edit/...).
 */
export function isStaffAllowedPublicJobBoardPath(pathname: string): boolean {
  if (pathname.startsWith('/c1/jobs-board') || /^\/c1\/jobs\/[^/]+$/.test(pathname)) {
    return true;
  }
  if (pathname.startsWith('/jobs/')) {
    return false;
  }
  if (/^\/[^/]+\/jobs-board(\/[^/]+)?$/.test(pathname)) {
    return true;
  }
  if (/^\/[^/]+\/jobs\/[^/]+$/.test(pathname)) {
    return true;
  }
  return false;
}
