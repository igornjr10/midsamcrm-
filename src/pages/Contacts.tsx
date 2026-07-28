import { useMemo, useState } from "react";
import { Plus, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useContactsQuery, useCreateContactMutation } from "@/hooks/queries";
import { PIPELINE_STAGES, getStageLabel, getStageTone, type Contact } from "@/lib/types";
import ContactDetailModal from "@/components/contacts/ContactDetailModal";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export default function Contacts() {
  const { user, company } = useAuth();
  const { data: contacts = [], isPending } = useContactsQuery(company?.id);
  const createContact = useCreateContactMutation();

  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [selected, setSelected] = useState<Contact | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "" });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (stageFilter !== "all" && c.stage !== stageFilter) return false;
      if (!term) return true;
      return (
        c.name.toLowerCase().includes(term) ||
        c.phone?.includes(term) ||
        c.email?.toLowerCase().includes(term)
      );
    });
  }, [contacts, search, stageFilter]);

  const handleCreate = async () => {
    if (!user || !company || !form.name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    try {
      await createContact.mutateAsync({
        user_id: user.id,
        company_id: company.id,
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
      });
      toast.success("Contato criado");
      setCreateOpen(false);
      setForm({ name: "", phone: "", email: "" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar contato");
    }
  };

  return (
    <div>
      <PageHeader
        icon={Users}
        title="Contatos"
        description={
          filtered.length === contacts.length
            ? `${contacts.length} ${contacts.length === 1 ? "contato cadastrado" : "contatos cadastrados"}`
            : `${filtered.length} de ${contacts.length} contatos`
        }
        actions={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus />
                Novo contato
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Novo contato</DialogTitle>
                <DialogDescription>Cadastre um contato manualmente.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Nome</Label>
                  <Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Telefone</Label>
                  <Input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>E-mail</Label>
                  <Input type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
                </div>
                <Button className="w-full" onClick={handleCreate} disabled={createContact.isPending}>
                  {createContact.isPending ? "Criando..." : "Criar"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, telefone ou e-mail"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as etapas</SelectItem>
            {PIPELINE_STAGES.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-card">
        <div className="scrollbar-slim overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Nome</th>
                <th className="px-4 py-3 font-semibold">Telefone</th>
                <th className="px-4 py-3 font-semibold">E-mail</th>
                <th className="px-4 py-3 font-semibold">Etapa</th>
                <th className="px-4 py-3 font-semibold">Criado em</th>
              </tr>
            </thead>
            <tbody>
              {isPending ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                    Carregando...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center">
                    <Users className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
                    <p className="text-sm font-medium">Nenhum contato encontrado</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {contacts.length === 0
                        ? "Cadastre o primeiro contato ou conecte o WhatsApp para importar."
                        : "Tente ajustar a busca ou o filtro de etapa."}
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((contact) => (
                  <tr
                    key={contact.id}
                    className="cursor-pointer border-t transition-colors hover:bg-accent/50"
                    onClick={() => setSelected(contact)}
                  >
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {contact.name.trim().charAt(0).toUpperCase() || "?"}
                        </span>
                        <span className="font-medium">{contact.name}</span>
                      </span>
                    </td>
                    <td className="tabular px-4 py-3">{contact.phone ?? "—"}</td>
                    <td className="px-4 py-3">{contact.email ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={cn(getStageTone(contact.stage).badge)}>
                        {getStageLabel(contact.stage)}
                      </Badge>
                    </td>
                    <td className="tabular px-4 py-3 text-muted-foreground">
                      {new Date(contact.created_at).toLocaleDateString("pt-BR")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ContactDetailModal contact={selected} open={!!selected} onClose={() => setSelected(null)} />
    </div>
  );
}
