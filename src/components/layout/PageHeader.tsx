import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type PageHeaderProps = {
  /** Ícone da seção, exibido em um quadro colorido de 40px. */
  icon: LucideIcon;
  title: string;
  /** Linha de apoio explicando pra que serve a tela. */
  description?: string;
  /** Selos de status ao lado do título (ex: "SDR ativo"). */
  badges?: React.ReactNode;
  /** Botões de ação alinhados à direita. */
  actions?: React.ReactNode;
  className?: string;
};

export function PageHeader({
  icon: Icon,
  title,
  description,
  badges,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="flex min-w-0 items-center gap-3.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary ring-1 ring-inset ring-primary/15">
          <Icon className="h-5 w-5" strokeWidth={2.25} />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
            {badges}
          </div>
          {description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
