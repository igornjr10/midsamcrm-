import { Moon, Sun } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTheme } from "@/hooks/useTheme";

type AuthShellProps = {
  title: string;
  description: string;
  children: React.ReactNode;
};

/** Moldura compartilhada por Login e Cadastro, para as duas telas não divergirem. */
export function AuthShell({ title, description, children }: AuthShellProps) {
  const { resolved, toggleTheme } = useTheme();

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      {/* Fundo: grade pontilhada que some para as bordas + brilho da cor primária.
          Só enfeite, não recebe clique. */}
      <div
        aria-hidden
        className="bg-dot-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[520px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-3xl dark:bg-primary/15"
      />

      <button
        onClick={toggleTheme}
        title={resolved === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
        aria-label={resolved === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {resolved === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
      </button>

      <div className="relative w-full max-w-sm animate-fade-in-up">
        <div className="mb-8 flex justify-center">
          <Logo className="scale-110" />
        </div>
        <Card className="rounded-2xl border-border/60 shadow-modal">
          <CardHeader className="p-6 pb-4">
            <CardTitle className="text-xl">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent className="p-6 pt-0">{children}</CardContent>
        </Card>
        <p className="mt-6 text-center text-xs text-muted-foreground/70">
          Midsam CRM · vendas, atendimento e relacionamento num só lugar
        </p>
      </div>
    </div>
  );
}
