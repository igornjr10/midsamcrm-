import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/layout/AuthShell";

/**
 * Pede o link de redefinição.
 *
 * A confirmação é a mesma com e-mail cadastrado ou não, de propósito: dizer
 * "esse e-mail não existe" entrega para quem tentar quais contas são reais.
 */
export default function ForgotPassword() {
  const { sendPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await sendPasswordReset(email.trim());
    setLoading(false);

    if (error) {
      toast.error("Não foi possível enviar o link: " + error);
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <AuthShell
        title="Link enviado"
        description="Se existir uma conta com esse e-mail, o link de redefinição já está a caminho."
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/40 p-3">
            <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              O link vale por tempo limitado e serve uma vez só. Não chegou em alguns minutos? Confira
              a caixa de spam ou peça de novo.
            </p>
          </div>
          <Button variant="outline" className="w-full" onClick={() => setSent(false)}>
            Enviar para outro e-mail
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
    <AuthShell
      title="Esqueci minha senha"
      description="Informe o e-mail da sua conta e enviamos um link para criar uma senha nova."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="animate-spin" />}
          {loading ? "Enviando..." : "Enviar link"}
        </Button>
      </form>
      <Link
        to="/login"
        className="mt-5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar para o login
      </Link>
    </AuthShell>
  );
}
