import { useMemo, useState } from "react";
import { History, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { followupLogsQueryKey, useFollowupLogsQuery } from "@/hooks/queries";
import type { FollowupKind, FollowupLogStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, LoadingState } from "@/components/ui/empty-state";

const STATUS_LABELS: Record<FollowupLogStatus, string> = {
  sent: "Enviado",
  failed: "Falhou",
  skipped: "Pulado",
};

const KIND_LABELS: Record<FollowupKind, string> = {
  text: "Mensagem pronta",
  ai: "Escrita pela IA",
  template: "Template",
};

const STATUS_VARIANTS: Record<FollowupLogStatus, React.ComponentProps<typeof Badge>["variant"]> = {
  sent: "success",
  failed: "destructive",
  skipped: "warning",
};

export default function FollowupHistory() {
  const { company } = useAuth();
  const queryClient = useQueryClient();
  const { data: logs = [], isPending, isFetching } = useFollowupLogsQuery(company?.id);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return logs.filter((log) => {
      if (statusFilter !== "all" && log.status !== statusFilter) return false;
      if (!term) return true;
      return (
        (log.contacts?.name ?? "").toLowerCase().includes(term) ||
        (log.contacts?.phone ?? "").includes(term) ||
        (log.content ?? "").toLowerCase().includes(term)
      );
    });
  }, [logs, search, statusFilter]);

  const totals = useMemo(
    () => ({
      sent: logs.filter((l) => l.status === "sent").length,
      failed: logs.filter((l) => l.status === "failed").length,
      skipped: logs.filter((l) => l.status === "skipped").length,
    }),
    [logs],
  );

  if (isPending) return <LoadingState label="Carregando histórico..." />;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          className="flex-1"
          placeholder="Buscar por contato, telefone ou texto"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="sent">Enviados</SelectItem>
            <SelectItem value="failed">Falhas</SelectItem>
            <SelectItem value="skipped">Pulados</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          disabled={isFetching}
          onClick={() =>
            void queryClient.invalidateQueries({ queryKey: followupLogsQueryKey(company?.id) })
          }
        >
          <RefreshCw className={isFetching ? "animate-spin" : ""} />
          Atualizar
        </Button>
      </div>

      <div className="tabular flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Últimos {logs.length} registros</span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          {totals.sent} enviados
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
          {totals.failed} falhas
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-warning" />
          {totals.skipped} pulados
        </span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={History}
          title={
            logs.length === 0 ? "Nenhum follow-up enviado ainda" : "Nenhum registro com esses filtros"
          }
          description={
            logs.length === 0
              ? "Assim que a cadência rodar, cada envio aparece aqui com o texto e o resultado."
              : undefined
          }
        />
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border bg-card shadow-card">
          {filtered.map((log) => (
            <div key={log.id} className="space-y-2 p-3.5 transition-colors hover:bg-accent/40">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{log.contacts?.name ?? "Contato removido"}</span>
                {log.contacts?.phone && (
                  <span className="tabular text-xs text-muted-foreground">{log.contacts.phone}</span>
                )}
                <Badge variant="secondary">Passo {log.step_order}</Badge>
                <Badge variant="outline">{KIND_LABELS[log.kind] ?? log.kind}</Badge>
                <Badge variant={STATUS_VARIANTS[log.status] ?? "outline"}>
                  {STATUS_LABELS[log.status] ?? log.status}
                </Badge>
                <span className="tabular ml-auto text-xs text-muted-foreground">
                  {new Date(log.created_at).toLocaleString("pt-BR")}
                </span>
              </div>
              {log.content && (
                <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-2.5 text-sm leading-relaxed">
                  {log.content}
                </p>
              )}
              {log.error && (
                <p className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive">{log.error}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
