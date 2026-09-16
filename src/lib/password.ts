/**
 * Regras da senha, num lugar só.
 *
 * Trocar a senha logado e redefinir por e-mail validam exatamente a mesma
 * coisa — separar as regras faria as duas telas divergirem com o tempo.
 */

/** Abaixo disso o Supabase recusa; pedir 8 evita a viagem até o servidor. */
export const MIN_PASSWORD_LENGTH = 8;

/** O que está errado no par nova/confirmação, ou null se está tudo certo. */
export function validateNewPassword(next: string, confirm: string): string | null {
  if (next.length < MIN_PASSWORD_LENGTH) {
    return `A nova senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (next !== confirm) return "A confirmação não bate com a nova senha.";
  return null;
}

/**
 * Traduz as recusas do Supabase que o usuário realmente encontra.
 *
 * O resto passa direto: uma mensagem em inglês ainda diz mais do que um
 * "erro ao salvar" genérico que esconde a causa.
 */
export function passwordErrorMessage(raw: string): string {
  const message = raw.toLowerCase();
  if (message.includes("should be at least") || message.includes("password should")) {
    return "A nova senha é curta demais para as regras do servidor.";
  }
  if (message.includes("different from the old")) {
    return "A nova senha precisa ser diferente da atual.";
  }
  if (message.includes("same password")) {
    return "A nova senha precisa ser diferente da atual.";
  }
  return raw;
}
