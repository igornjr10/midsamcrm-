import { cn } from "@/lib/utils";

/**
 * Sombra do conteúdo que está chegando.
 *
 * Um spinner diz "espere"; um esqueleto diz "aqui vai ter um formulário" — e a
 * mesma espera parece mais curta porque a tela já tem forma. Use quando você
 * sabe o formato do que vem; para ação sem forma conhecida (salvar, enviar), o
 * spinner continua certo.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

/** Linhas de texto de larguras diferentes — parece parágrafo, não tabela. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  const larguras = ["w-full", "w-11/12", "w-4/5", "w-2/3"];
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3", larguras[i % larguras.length])} />
      ))}
    </div>
  );
}

/** O esqueleto de um formulário: rótulo curto + campo. */
export function SkeletonForm({ fields = 3 }: { fields?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  );
}

/** Linhas de uma tabela, para a lista não pular quando os dados chegam. */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-20 shrink-0" />
        </div>
      ))}
    </div>
  );
}
