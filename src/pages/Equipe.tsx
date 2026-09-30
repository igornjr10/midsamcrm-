import { useState } from "react";
import { Pencil, Plus, Trash2, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  useCompanyTeamQuery, useCreateTeamMemberMutation, useRemoveTeamMemberMutation,
  useUpdateTeamMemberMutation,
} from "@/hooks/queries";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { TEAM_ROLE_LABEL, teamLabel, type CompanyTeamMember, type TeamRole } from "@/lib/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ROLE_HELP: Record<TeamRole, string> = {
  admin: "Acesso total, inclusive Configurações e Equipe.",
  member: "Usa o CRM no dia a dia: leads, chat, vendas e agenda. Não vê Configurações nem Equipe.",
};

type FormState = { fullName: string; email: string; password: string; role: TeamRole };
const EMPTY_FORM: FormState = { fullName: "", email: "", password: "", role: "member" };

function asRole(role: string): TeamRole {
  return role === "admin" ? "admin" : "member";
}

export default function Equipe() {
  const { user, company, isCompanyAdmin } = useAuth();
  const companyId = company?.id;
  const { data: team = [], isPending } = useCompanyTeamQuery(companyId);
  const createMember = useCreateTeamMemberMutation();
  const updateMember = useUpdateTeamMemberMutation();
  const removeMember = useRemoveTeamMemberMutation();

  // null = fechado; "new" = cadastro; membro = edição daquele membro.
  const [editing, setEditing] = useState<CompanyTeamMember | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [removing, setRemoving] = useState<CompanyTeamMember | null>(null);

  if (!isCompanyAdmin) {
    return <p className="py-12 text-center text-muted-foreground">Só o admin da empresa gerencia a equipe.</p>;
  }

  const isNew = editing === "new";
  const saving = createMember.isPending || updateMember.isPending;

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditing("new");
  };

  const openEdit = (member: CompanyTeamMember) => {
    setForm({ fullName: member.full_name ?? "", email: member.email, password: "", role: asRole(member.role) });
    setEditing(member);
  };

  const handleSave = async () => {
    if (!companyId || !editing) return;
    const fullName = form.fullName.trim();
    if (!fullName) {
      toast.error("Informe o nome.");
      return;
    }

    try {
      if (editing === "new") {
        if (!form.email.trim()) {
          toast.error("Informe o e-mail.");
          return;
        }
        if (form.password.length < MIN_PASSWORD_LENGTH) {
          toast.error(`A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
          return;
        }
        await createMember.mutateAsync({
          companyId,
          fullName,
          email: form.email.trim(),
          password: form.password,
          role: form.role,
        });
        toast.success(`${fullName} entrou na equipe. Envie o e-mail e a senha para a pessoa.`);
      } else {
        // Campo de senha em branco = não mexer. Manda só o que mudou.
        if (form.password && form.password.length < MIN_PASSWORD_LENGTH) {
          toast.error(`A nova senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
          return;
        }
        const roleChanged = form.role !== asRole(editing.role);
        const nameChanged = fullName !== (editing.full_name ?? "");
        if (!roleChanged && !nameChanged && !form.password) {
          setEditing(null);
          return;
        }
        await updateMember.mutateAsync({
          companyId,
          userId: editing.user_id,
          ...(roleChanged ? { role: form.role } : {}),
          ...(nameChanged ? { fullName } : {}),
          ...(form.password ? { password: form.password } : {}),
        });
        toast.success(form.password ? "Membro atualizado e senha trocada." : "Membro atualizado.");
      }
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    }
  };

  const handleRemove = async () => {
    if (!companyId || !removing) return;
    try {
      await removeMember.mutateAsync({ companyId, userId: removing.user_id });
      toast.success(`${teamLabel(removing)} saiu da equipe e não consegue mais entrar no CRM.`);
      setRemoving(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover");
    }
  };

  return (
    <div className="max-w-4xl">
      <PageHeader
        icon={UsersRound}
        title="Equipe"
        description="Quem usa o CRM da empresa. Cada pessoa entra com o próprio e-mail e senha."
        actions={
          <Button onClick={openCreate}>
            <Plus />
            Adicionar membro
          </Button>
        }
      />

      <div className="overflow-hidden rounded-xl border bg-card shadow-card">
        <div className="scrollbar-slim overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                <th className="whitespace-nowrap px-4 py-3 font-semibold">Nome</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">E-mail de login</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">Papel</th>
                <th className="px-4 py-3 text-right font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isPending ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">
                    Carregando...
                  </td>
                </tr>
              ) : (
                team.map((member) => {
                  const isMe = member.user_id === user?.id;
                  const role = asRole(member.role);
                  return (
                    <tr key={member.user_id} className="border-t transition-colors hover:bg-accent/50">
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                            {teamLabel(member).charAt(0).toUpperCase() || "?"}
                          </span>
                          <span className="whitespace-nowrap font-medium">
                            {member.full_name?.trim() || teamLabel(member)}
                            {isMe && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(você)</span>}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <span className="block max-w-[260px] truncate" title={member.email}>
                          {member.email}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Badge variant={role === "admin" ? "default" : "secondary"}>{TEAM_ROLE_LABEL[role]}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEdit(member)}
                            aria-label={`Editar ${teamLabel(member)}`}
                          >
                            <Pencil />
                            Editar
                          </Button>
                          {!isMe && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setRemoving(member)}
                              aria-label={`Remover ${teamLabel(member)}`}
                              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            >
                              <Trash2 />
                              Remover
                            </Button>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!isPending && team.length <= 1 && (
        <p className="mt-4 text-sm text-muted-foreground">
          Só você por enquanto. Adicione vendedores para distribuir os leads: cada conversa pode ter um
          responsável no Chat, e as vendas ficam no nome de quem vendeu.
        </p>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{isNew ? "Adicionar membro" : "Editar membro"}</DialogTitle>
            <DialogDescription>
              {isNew
                ? "Crie o login da pessoa. Depois envie o e-mail e a senha para ela entrar."
                : "Deixe a senha em branco para não alterar."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="member-name">Nome</Label>
              <Input
                id="member-name"
                value={form.fullName}
                onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="member-email">E-mail de login</Label>
              <Input
                id="member-email"
                type="email"
                autoComplete="off"
                disabled={!isNew}
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="member-password">{isNew ? "Senha inicial" : "Nova senha"}</Label>
              <PasswordInput
                id="member-password"
                autoComplete="new-password"
                placeholder={isNew ? `Mínimo ${MIN_PASSWORD_LENGTH} caracteres` : "Deixe em branco para não alterar"}
                value={form.password}
                onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Papel</Label>
              <Select value={form.role} onValueChange={(value) => setForm((p) => ({ ...p, role: asRole(value) }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">{TEAM_ROLE_LABEL.member}</SelectItem>
                  <SelectItem value="admin">{TEAM_ROLE_LABEL.admin}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{ROLE_HELP[form.role]}</p>
            </div>
          </div>
          <DialogFooter>
            <Button className="w-full" onClick={handleSave} disabled={saving}>
              {saving ? "Salvando..." : isNew ? "Adicionar" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remover {removing ? teamLabel(removing) : ""}?</DialogTitle>
            <DialogDescription>
              A pessoa perde o acesso ao CRM na hora. Os leads, conversas e vendas dela continuam na
              empresa.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleRemove} disabled={removeMember.isPending}>
              {removeMember.isPending ? "Removendo..." : "Remover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
