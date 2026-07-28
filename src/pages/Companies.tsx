import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, LogIn, Plus } from "lucide-react";
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

interface CompanyRow extends Company {
  member_count: number;
}

export default function Companies() {
  const { isSuperAdmin, company: activeCompany, enterCompany } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ company_name: "", email: "", password: "", full_name: "" });

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
                <th className="px-4 py-3 font-semibold">Empresa</th>
                <th className="px-4 py-3 font-semibold">Membros</th>
                <th className="px-4 py-3 font-semibold">Criada em</th>
                <th className="px-4 py-3 text-right font-semibold">Acesso</th>
              </tr>
            </thead>
            <tbody>
              {isPending ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">
                    Carregando...
                  </td>
                </tr>
              ) : companies.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center">
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
                        <span className="font-medium">{c.name}</span>
                      </span>
                    </td>
                    <td className="tabular px-4 py-3">{c.member_count}</td>
                    <td className="tabular px-4 py-3 text-muted-foreground">
                      {new Date(c.created_at).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-4 py-3 text-right">
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
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
