/**
 * ABA routing-number checksum (3-7-1 weighting). Mirrors the server-side
 * validation in `functions/src/integrations/everee/evereeService.ts`
 * (`isValidAbaRoutingNumber`) — catch typos before bank digits ever leave
 * the browser; a bad routing number that reaches Everee becomes a failed
 * payment weeks later.
 */
export function isValidAbaRoutingNumber(routingNumber: string): boolean {
  if (!/^\d{9}$/.test(routingNumber)) return false;
  const d = routingNumber.split('').map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0 && sum > 0;
}
