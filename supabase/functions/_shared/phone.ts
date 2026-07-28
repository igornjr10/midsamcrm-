/** Só dígitos, com DDI 55 assumido para números brasileiros sem prefixo. */
export function normalizePhone(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (!digits.startsWith("55") && digits.length <= 11) {
    digits = "55" + digits;
  }
  return digits;
}
