export function isMeaningfulChange(before: any, after: any, ignore: string[] = ['updatedAt', 'lastUpdated']) {
  if (!before || !after) return true;
  const sanitize = (obj: any) => {
    if (!obj || typeof obj !== 'object') return obj;
    const clone: any = Array.isArray(obj) ? [...obj] : { ...obj };
    for (const f of ignore) delete clone[f];
    return clone;
  };
  const b = sanitize(before);
  const a = sanitize(after);
  return JSON.stringify(b) !== JSON.stringify(a);
}


