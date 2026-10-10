/** Bahamian local numbers and NANP numbers use an explicit international prefix. */
export function phoneHref(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (phone.trim().startsWith('+')) return `tel:+${digits}`;
  if (digits.length === 7) return `tel:+1242${digits}`;
  if (digits.length === 10 && digits.startsWith('242')) return `tel:+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `tel:+${digits}`;
  return `tel:${digits}`;
}
