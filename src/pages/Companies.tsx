import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Company } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

interface CompanyRow extends Company {
  member_count: number;
}

export default function Companies() {
  const { isSuperAdmin } = useAuth();
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
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Building2 className="h-6 w-6 text-primary" />
          <h2 className="text-2xl font-bold">Empresas</h2>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-1.5">
              <Plus className="h-4 w-4" />
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
      </div>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Empresa</th>
              <th className="px-4 py-3 font-medium">Membros</th>
              <th className="px-4 py-3 font-medium">Criada em</th>
            </tr>
          </thead>
          <tbody>
            {isPending ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                  Carregando...
                </td>
              </tr>
            ) : companies.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                  Nenhuma empresa ainda
                </td>
              </tr>
            ) : (
              companies.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3">{c.member_count}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(c.created_at).toLocaleDateString("pt-BR")}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
