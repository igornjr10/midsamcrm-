import { useMemo, useState } from "react";
import { History, Loader2, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { followupLogsQueryKey, useFollowupLogsQuery } from "@/hooks/queries";
import type { FollowupKind, FollowupLogStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

function statusClass(status: FollowupLogStatus): string {
  if (status === "sent") return "border-green-500/40 text-green-600";
  if (status === "failed") return "border-destructive/40 text-destructive";
  return "border-amber-500/40 text-amber-600";
}

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

  if (isPending) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

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
          className="gap-1.5"
          disabled={isFetching}
          onClick={() =>
            void queryClient.invalidateQueries({ queryKey: followupLogsQueryKey(company?.id) })
          }
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Últimos {logs.length} registros · {totals.sent} enviados · {totals.failed} falhas ·{" "}
        {totals.skipped} pulados
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <History className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-medium">
            {logs.length === 0 ? "Nenhum follow-up enviado ainda" : "Nenhum registro com esses filtros"}
          </p>
          {logs.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Assim que a cadência rodar, cada envio aparece aqui com o texto e o resultado.
            </p>
          )}
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {filtered.map((log) => (
            <div key={log.id} className="space-y-1.5 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{log.contacts?.name ?? "Contato removido"}</span>
                {log.contacts?.phone && (
                  <span className="text-xs text-muted-foreground">{log.contacts.phone}</span>
                )}
                <Badge variant="outline">Passo {log.step_order}</Badge>
                <Badge variant="outline">{KIND_LABELS[log.kind] ?? log.kind}</Badge>
                <Badge variant="outline" className={statusClass(log.status)}>
                  {STATUS_LABELS[log.status] ?? log.status}
                </Badge>
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(log.created_at).toLocaleString("pt-BR")}
                </span>
              </div>
              {log.content && <p className="whitespace-pre-wrap text-sm">{log.content}</p>}
              {log.error && <p className="text-xs text-destructive">{log.error}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
