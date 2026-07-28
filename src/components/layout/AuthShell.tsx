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
      {/* Brilho decorativo atrás do card — só enfeite, não recebe clique */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[460px] w-[860px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-primary/15 blur-3xl"
      />

      <button
        onClick={toggleTheme}
        title={resolved === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
        aria-label={resolved === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {resolved === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
      </button>

      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo className="scale-110" />
        </div>
        <Card className="shadow-card-hover">
          <CardHeader>
            <CardTitle className="text-xl">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
      </div>
    </div>
  );
}
