import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, LogIn, Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Company } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/layout/PageHeader";
import ModulesDialog from "@/components/companies/ModulesDialog";

interface CompanyRow extends Company {
  member_count: number;
}

// Em status != 2xx o invoke() devolve data null e uma mensagem genérica — o
// motivo real ("e-mail já em uso") só existe no corpo, pendurado no erro.
async function readFunctionError(error: unknown): Promise<string | null> {
  const res = (error as { context?: unknown } | null)?.context;
  if (!(res instanceof Response)) return null;
  try {
    const body = (await res.clone().json()) as { error?: string };
    return body?.error ?? null;
  } catch {
    return null;
  }
}

export default function Companies() {
  const { isSuperAdmin, company: activeCompany, enterCompany, leaveCompany } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ company_name: "", email: "", password: "", full_name: "" });
  const [editing, setEditing] = useState<CompanyRow | null>(null);
  const [modulesFor, setModulesFor] = useState<CompanyRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({ company_name: "", email: "", password: "" });
  // Remoção fica num estado próprio: o diálogo de editar não pode ser o mesmo
  // lugar de onde se apaga, senão um clique errado vira estrago.
  const [removing, setRemoving] = useState<CompanyRow | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState("");
  const [removeBusy, setRemoveBusy] = useState(false);

  const { data: companies = [], isPending } = useQuery({
    queryKey: ["all-companies"] as const,
    queryFn: async () => {
      const [companiesRes, membersRes] = await Promise.all([
        supabase.from("companies").select("*").order("created_at", { ascending: false }),
        supabase.from("company_members").select("company_id"),
      ]);
      if (companiesRes.error) throw companiesRes.error;
      const counts = new Map<string, number>();
      for (const m of (membersRes.data ?? []) as Array<{ company_id: string }>) {
        counts.set(m.company_id, (counts.get(m.company_id) ?? 0) + 1);
      }
      return ((companiesRes.data ?? []) as Company[]).map((c) => ({
        ...c,
        member_count: counts.get(c.id) ?? 0,
      })) as CompanyRow[];
    },
    enabled: isSuperAdmin,
    staleTime: 30_000,
  });

  // Nicho e consumo do mês, numa chamada só: uma por empresa multiplicaria o
  // tempo de abertura da tela pelo número de clientes.
  const { data: overview } = useQuery({
    queryKey: ["companies-overview"] as const,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("companies_overview");
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        company_id: string;
        niche_name: string | null;
        monthly_coins: number | null;
        used: number;
      }>;
      return new Map(rows.map((r) => [r.company_id, r]));
    },
    enabled: isSuperAdmin,
    staleTime: 30_000,
  });

  // E-mail de login de cada empresa: mora em auth.users, então vem por RPC
  // (company_owners só responde para super admin).
  const { data: owners } = useQuery({
    queryKey: ["company-owners"] as const,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("company_owners");
      if (error) throw error;
      const rows = (data ?? []) as Array<{ company_id: string; email: string | null }>;
      return new Map(rows.map((r) => [r.company_id, r.email ?? ""]));
    },
    enabled: isSuperAdmin,
    staleTime: 30_000,
  });

  if (!isSuperAdmin) {
    return <p className="py-12 text-center text-muted-foreground">Acesso restrito.</p>;
  }

  const handleCreate = async () => {
    if (!form.company_name.trim() || !form.email.trim() || form.password.length < 6) {
      toast.error("Preencha nome da empresa, e-mail e senha (mín. 6 caracteres).");
      return;
    }
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-create-company", {
        body: form,
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      toast.success(`Empresa "${form.company_name}" criada! Envie o login para o cliente.`);
      setCreateOpen(false);
      setForm({ company_name: "", email: "", password: "", full_name: "" });
      void queryClient.invalidateQueries({ queryKey: ["all-companies"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar empresa");
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (c: CompanyRow) => {
    setEditForm({ company_name: c.name, email: owners?.get(c.id) ?? "", password: "" });
    setEditing(c);
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    const name = editForm.company_name.trim();
    const email = editForm.email.trim();
    if (!name) {
      toast.error("O nome da empresa não pode ficar vazio.");
      return;
    }

    // Manda só o que mudou — assim um e-mail intocado não dispara troca no Auth.
    const currentEmail = owners?.get(editing.id) ?? "";
    const payload: {
      company_id: string;
      company_name?: string;
      email?: string;
      password?: string;
    } = {
      company_id: editing.id,
    };
    if (name !== editing.name) payload.company_name = name;
    if (email && email !== currentEmail) payload.email = email;
    // Campo em branco = não mexer na senha. Sem isso, salvar só o nome
    // redefiniria a senha do cliente para vazio sem ninguém pedir.
    if (editForm.password) {
      if (editForm.password.length < 8) {
        toast.error("A nova senha precisa ter pelo menos 8 caracteres.");
        return;
      }
      payload.password = editForm.password;
    }

    if (!payload.company_name && !payload.email && !payload.password) {
      setEditing(null);
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-update-company", {
        body: payload,
      });
      if (error || data?.error) {
        throw new Error((await readFunctionError(error)) || data?.error || error?.message);
      }

      // A empresa ativa fica no localStorage: sem isso o menu continuaria
      // mostrando o nome antigo até o próximo login.
      if (payload.company_name && activeCompany?.id === editing.id) {
        enterCompany({ ...activeCompany, name });
      }

      toast.success(payload.password ? "Empresa atualizada e senha trocada." : "Empresa atualizada.");
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ["all-companies"] });
      void queryClient.invalidateQueries({ queryKey: ["company-owners"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar empresa");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-delete-company", {
        body: { company_id: removing.id, confirm_name: removing.name },
      });
      if (error || data?.error) {
        throw new Error((await readFunctionError(error)) || data?.error || error?.message);
      }

      // Estava vendo o CRM dessa empresa? O id agora aponta para nada, e sem
      // soltar ele o app tentaria carregar uma empresa que não existe mais.
      if (activeCompany?.id === removing.id) leaveCompany();

      const apagados = Number(data?.deleted_users ?? 0);
      toast.success(
        apagados > 0
          ? `Empresa "${removing.name}" removida, junto de ${apagados} usuário(s).`
          : `Empresa "${removing.name}" removida.`,
      );
      setRemoving(null);
      setRemoveConfirm("");
      void queryClient.invalidateQueries({ queryKey: ["all-companies"] });
      void queryClient.invalidateQueries({ queryKey: ["company-owners"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover empresa");
    } finally {
      setRemoveBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        icon={Building2}
        title="Empresas"
        description={`${companies.length} ${companies.length === 1 ? "empresa cadastrada" : "empresas cadastradas"} na plataforma`}
        actions={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus />
                Nova empresa
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Nova empresa</DialogTitle>
                <DialogDescription>
                  Cria a empresa e o usuário admin dela. Envie o e-mail e a senha para o cliente.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Nome da empresa</Label>
                  <Input
                    value={form.company_name}
                    onChange={(e) => setForm((p) => ({ ...p, company_name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Nome do responsável (opcional)</Label>
                  <Input
                    value={form.full_name}
                    onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>E-mail de login</Label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Senha inicial</Label>
                  <Input
                    type="text"
                    value={form.password}
                    onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                  />
                </div>
                <Button className="w-full" onClick={handleCreate} disabled={creating}>
                  {creating ? "Criando..." : "Criar empresa"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="overflow-hidden rounded-xl border bg-card shadow-card">
        <div className="scrollbar-slim overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                <th className="whitespace-nowrap px-4 py-3 font-semibold">Empresa</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">E-mail de login</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">Nicho</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">Envios</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">Membros</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">Criada em</th>
                <th className="px-4 py-3 text-right font-semibold">Acesso</th>
              </tr>
            </thead>
            <tbody>
              {isPending ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    Carregando...
                  </td>
                </tr>
              ) : companies.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <Building2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
                    <p className="text-sm font-medium">Nenhuma empresa ainda</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Crie a primeira empresa e envie o login para o cliente.
                    </p>
                  </td>
                </tr>
              ) : (
                companies.map((c) => (
                  <tr key={c.id} className="border-t transition-colors hover:bg-accent/50">
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {c.name.trim().charAt(0).toUpperCase() || "?"}
                        </span>
                        <span className="whitespace-nowrap font-medium">{c.name}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {/* O e-mail é o campo mais largo e o menos consultado:
                          truncar aqui é o que deixa as ações caberem sem barra
                          de rolagem horizontal. */}
                      <span className="block max-w-[220px] truncate" title={owners?.get(c.id) || ""}>
                        {owners?.get(c.id) || "—"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {overview?.get(c.id)?.niche_name ? (
                        <Badge variant="secondary">{overview.get(c.id)!.niche_name}</Badge>
                      ) : (
                        <span className="text-muted-foreground">Sem nicho</span>
                      )}
                    </td>
                    <td className="tabular whitespace-nowrap px-4 py-3">
                      {(() => {
                        const linha = overview?.get(c.id);
                        if (!linha) return <span className="text-muted-foreground">—</span>;
                        const usado = Number(linha.used ?? 0);
                        // Sem cota, o número sozinho já diz o que interessa:
                        // quanto a empresa consumiu. Com cota, o que importa é
                        // a proporção.
                        if (linha.monthly_coins == null) {
                          return (
                            <span>
                              {usado.toLocaleString("pt-BR")}
                              <span className="text-muted-foreground/70"> livre</span>
                            </span>
                          );
                        }
                        const estourou = usado >= linha.monthly_coins;
                        return (
                          <span className={estourou ? "font-semibold text-destructive" : undefined}>
                            {usado.toLocaleString("pt-BR")}
                            <span className="text-muted-foreground">
                              {" "}/ {linha.monthly_coins.toLocaleString("pt-BR")}
                            </span>
                          </span>
                        );
                      })()}
                    </td>
                    <td className="tabular px-4 py-3">{c.member_count}</td>
                    <td className="tabular px-4 py-3 text-muted-foreground">
                      {new Date(c.created_at).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEdit(c)}
                          aria-label={`Editar ${c.name}`}
                        >
                          <Pencil />
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setModulesFor(c)}
                          aria-label={`Módulos de ${c.name}`}
                        >
                          <SlidersHorizontal />
                          Módulos
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setRemoveConfirm("");
                            setRemoving(c);
                          }}
                          aria-label={`Remover ${c.name}`}
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 />
                          Remover
                        </Button>
                        {activeCompany?.id === c.id ? (
                          <Badge variant="secondary">Em uso</Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              enterCompany({ id: c.id, name: c.name, role: "super_admin" });
                              toast.success(`Você está vendo o CRM de ${c.name}.`);
                              navigate("/");
                            }}
                          >
                            <LogIn />
                            Acessar
                          </Button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Editar empresa</DialogTitle>
            <DialogDescription>
              E-mail e senha são os do responsável pela empresa. Deixe a senha em branco para
              mantê-la como está.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nome da empresa</Label>
              <Input
                value={editForm.company_name}
                onChange={(e) => setEditForm((p) => ({ ...p, company_name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>E-mail de login</Label>
              <Input
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Nova senha</Label>
              <Input
                type="password"
                autoComplete="new-password"
                placeholder="Deixe em branco para não alterar"
                value={editForm.password}
                onChange={(e) => setEditForm((p) => ({ ...p, password: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Mínimo de 8 caracteres. O cliente não é avisado — combine a troca com ele.
              </p>
            </div>
            <Button className="w-full" onClick={handleSaveEdit} disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
            setRemoveConfirm("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remover {removing?.name}</DialogTitle>
            <DialogDescription>
              Isto não tem desfazer e não existe lixeira.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-muted-foreground">
              Some junto com a empresa: contatos, conversas e todo o histórico de mensagens,
              vendas, agendamentos, campanhas, pedidos e chamados. O usuário de login também é
              apagado — a não ser que ele ainda pertença a outra empresa.
            </div>
            <div className="space-y-1.5">
              <Label>
                Digite <span className="font-semibold text-foreground">{removing?.name}</span> para
                confirmar
              </Label>
              <Input
                value={removeConfirm}
                autoComplete="off"
                onChange={(e) => setRemoveConfirm(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setRemoving(null);
                  setRemoveConfirm("");
                }}
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                // O nome tem que bater exatamente. A function confere de novo no
                // servidor: esta trava é contra o clique errado, não a única.
                disabled={removeBusy || removeConfirm.trim() !== removing?.name.trim()}
                onClick={() => void handleRemove()}
              >
                <Trash2 />
                {removeBusy ? "Removendo..." : "Remover para sempre"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ModulesDialog
        company={modulesFor}
        open={!!modulesFor}
        onOpenChange={(open) => !open && setModulesFor(null)}
      />
    </div>
  );
}
