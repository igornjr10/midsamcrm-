import { useState } from "react";
import { Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MIN_PASSWORD_LENGTH, validateNewPassword } from "@/lib/password";

/**
 * Troca da senha da própria conta.
 *
 * Fica junto das configurações porque é o único lugar que a pessoa procura, e
 * só mexe na conta de quem está logado — nada aqui toca na empresa nem na
 * conexão do WhatsApp. A sessão continua valendo depois da troca: ninguém é
 * deslogado, nem aqui nem nas outras abas.
 */
export default function ChangePasswordCard() {
  const { user, updatePassword } = useAuth();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const problem = validateNewPassword(next, confirm);
    if (problem) {
      toast.error(problem);
      return;
    }
    if (next === current) {
      toast.error("A nova senha precisa ser diferente da atual.");
      return;
    }

    setSaving(true);
    const { error } = await updatePassword(current, next);
    setSaving(false);

    if (error) {
      toast.error(error);
      return;
    }

    setCurrent("");
    setNext("");
    setConfirm("");
    setVisible(false);
    toast.success("Senha alterada. Use a nova no próximo login.");
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          Senha de acesso
        </CardTitle>
        <CardDescription>
          Troca a senha de {user?.email ?? "sua conta"}. Você continua conectado depois de salvar — a
          senha nova só é pedida no próximo login.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="senha-atual">Senha atual</Label>
            <Input
              id="senha-atual"
              type={visible ? "text" : "password"}
              autoComplete="current-password"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="senha-nova">Nova senha</Label>
              <Input
                id="senha-nova"
                type={visible ? "text" : "password"}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                required
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
          </div>

          <p className="text-xs text-muted-foreground">Pelo menos {MIN_PASSWORD_LENGTH} caracteres.</p>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <KeyRound />}
              {saving ? "Salvando..." : "Alterar senha"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setVisible((v) => !v)}>
              {visible ? <EyeOff /> : <Eye />}
              {visible ? "Ocultar" : "Mostrar"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
