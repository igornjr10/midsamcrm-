import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { MIN_PASSWORD_LENGTH, passwordErrorMessage, validateNewPassword } from "@/lib/password";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/layout/AuthShell";

/** Quanto esperar o supabase-js ler o token do endereço antes de desistir. */
const SESSION_TIMEOUT_MS = 5000;

/**
 * O motivo cru do Supabase, só quando ele acrescenta alguma coisa.
 *
 * O caso comum — "Email link is invalid or has expired" — é palavra por palavra
 * o que o título já diz, e em inglês: repetir numa caixa cinza só polui. O que
 * sobra é motivo inesperado, e aí ver o texto original ajuda a entender.
 */
function unexpectedReason(raw: string): string | null {
  const text = raw.trim();
  if (/invalid or has expired|otp_expired|access[_ ]denied/i.test(text)) return null;
  return text;
}

type Status = "checking" | "ready" | "invalid";

/**
 * Onde o link do e-mail cai: define a senha nova.
 *
 * O supabase-js lê o token do fragmento da URL sozinho (`detectSessionInUrl`) e
 * abre uma sessão de recuperação — por isso esta tela não pede senha atual:
 * quem chegou aqui provou o acesso pelo e-mail. A leitura é assíncrona, então a
 * tela espera o evento em vez de decidir na primeira renderização, senão um
 * link válido apareceria como expirado.
 */
export default function ResetPassword() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("checking");
  const [reason, setReason] = useState<string | null>(null);

  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Link expirado ou já usado volta com o motivo no fragmento, sem sessão.
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const urlError = hash.get("error_description") ?? hash.get("error");
    if (urlError) {
      setReason(unexpectedReason(urlError));
      setStatus("invalid");
      return;
    }

    let settled = false;
    const accept = () => {
      if (settled) return;
      settled = true;
      setStatus("ready");
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) accept();
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) accept();
    });

    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        setStatus("invalid");
      }
    }, SESSION_TIMEOUT_MS);

    return () => {
      subscription.unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const problem = validateNewPassword(next, confirm);
    if (problem) {
      toast.error(problem);
      return;
    }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: next });
    setSaving(false);

    if (error) {
      toast.error(passwordErrorMessage(error.message));
      return;
    }

    // A sessão de recuperação já é uma sessão válida: a pessoa entra direto,
    // sem ter que digitar de novo a senha que acabou de criar.
    toast.success("Senha criada. Bem-vindo de volta!");
    navigate("/", { replace: true });
  };

  if (status === "checking") {
    return (
      <AuthShell title="Redefinir senha" description="Conferindo o link do e-mail...">
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </AuthShell>
    );
  }

  if (status === "invalid") {
    return (
      <AuthShell
        title="Link inválido ou expirado"
        description="Este link já foi usado ou passou da validade. Peça um novo para continuar."
      >
        <div className="space-y-4">
          {reason && (
            <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">{reason}</p>
          )}
          <Button className="w-full" onClick={() => navigate("/esqueci-senha", { replace: true })}>
            Pedir um link novo
          </Button>
          <Link
            to="/login"
            className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar para o login
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Criar nova senha" description="Escolha a senha que você vai usar a partir de agora.">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="senha-nova">Nova senha</Label>
          <Input
            id="senha-nova"
            type={visible ? "text" : "password"}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            autoFocus
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="senha-confirma">Repetir a nova senha</Label>
          <Input
            id="senha-confirma"
            type={visible ? "text" : "password"}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Pelo menos {MIN_PASSWORD_LENGTH} caracteres.</p>
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {visible ? "Ocultar" : "Mostrar"}
          </button>
        </div>

        <Button type="submit" className="w-full" disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <KeyRound />}
          {saving ? "Salvando..." : "Salvar e entrar"}
        </Button>
      </form>
    </AuthShell>
  );
}
