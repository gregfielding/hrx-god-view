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
