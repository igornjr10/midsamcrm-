import { useState } from "react";
import { Plus, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useContactTagsQuery } from "@/hooks/queries";
import { getToneClasses } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Props = {
  value: string[];
  onChange: (tags: string[]) => void;
  /** Compacto: só os selos e o "+" (painel do Chat). */
  compact?: boolean;
  className?: string;
};

/** Selo de uma etiqueta com a cor do catálogo. Fora do catálogo, cinza. */
export function TagBadge({
  name,
  tone,
  onRemove,
  className,
}: {
  name: string;
  tone?: string;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn("gap-1 pr-1.5", getToneClasses(tone ?? "").badge, className)}>
      {name}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remover etiqueta ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 rounded-full p-0.5 opacity-60 transition-opacity hover:opacity-100"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </Badge>
  );
}

/**
 * Etiquetas do contato. Escolhe do catálogo da empresa; o catálogo em si se
 * edita em Contatos → Etiquetas, para não misturar "marcar" com "criar".
 */
export default function TagPicker({ value, onChange, compact, className }: Props) {
  const { company } = useAuth();
  const { data: catalog = [] } = useContactTagsQuery(company?.id);
  const [open, setOpen] = useState(false);

  const toneOf = (name: string) => catalog.find((t) => t.name === name)?.tone;
  const available = catalog.filter((t) => !value.includes(t.name));

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {value.map((name) => (
        <TagBadge
          key={name}
          name={name}
          tone={toneOf(name)}
          onRemove={() => onChange(value.filter((t) => t !== name))}
        />
      ))}
      {value.length === 0 && !compact && (
        <span className="text-xs text-muted-foreground">Nenhuma etiqueta</span>
      )}
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Adicionar etiqueta"
            className="inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-border px-2 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            <Plus className="h-3 w-3" />
            {!compact && "Etiqueta"}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {available.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              {catalog.length === 0
                ? "Crie etiquetas em Contatos → Etiquetas."
                : "Todas as etiquetas já estão marcadas."}
            </p>
          ) : (
            available.map((tag) => (
              <DropdownMenuItem key={tag.id} onSelect={() => onChange([...value, tag.name])}>
                <span className={cn("h-2 w-2 rounded-full", getToneClasses(tag.tone).dot)} />
                {tag.name}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
