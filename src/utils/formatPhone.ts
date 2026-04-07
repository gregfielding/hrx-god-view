export const formatPhoneNumber = (phone: string) => {
  if (!phone) return '';
  
  const cleaned = ('' + phone).replace(/\D/g, '');

  if (cleaned.length === 10) {
    const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
    if (match) {
      return `(${match[1]})${match[2]}-${match[3]}`;
    }
  } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
    // Handle 11-digit numbers starting with 1 (US country code)
    const match = cleaned.match(/^1(\d{3})(\d{3})(\d{4})$/);
    if (match) {
      return `(${match[1]})${match[2]}-${match[3]}`;
    }
  }

  return phone;
};

/**
 * US phone while typing or pasting — builds toward `(###)###-####` (same final shape as `formatPhoneNumber`).
 */
export function formatUsPhoneProgressive(input: string): string {
  let digits = ('' + input).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1);
  }
  digits = digits.slice(0, 10);
  if (digits.length === 0) return '';
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)})${digits.slice(3)}`;
  return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
}
