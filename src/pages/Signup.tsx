import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/layout/AuthShell";
import { toast } from "sonner";

export default function Signup() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("A senha precisa ter pelo menos 6 caracteres");
      return;
    }
    setLoading(true);
    const { error } = await signUp(email.trim(), password, businessName.trim());
    setLoading(false);
    if (error) {
      toast.error("Não foi possível cadastrar: " + error);
      return;
    }
    toast.success("Conta criada!");
    navigate("/");
  };

  return (
    <AuthShell title="Criar conta" description="Comece a usar seu Midsam CRM">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="business">Nome do negócio</Label>
          <Input
            id="business"
            autoComplete="organization"
            required
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
          />
        </div>
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
        <div className="space-y-1.5">
          <Label htmlFor="password">Senha</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Mínimo de 6 caracteres.</p>
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="animate-spin" />}
          {loading ? "Criando..." : "Criar conta"}
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-muted-foreground">
        Já tem conta?{" "}
        <Link to="/login" className="font-medium text-primary hover:underline">
          Entrar
        </Link>
      </p>
    </AuthShell>
  );
}
