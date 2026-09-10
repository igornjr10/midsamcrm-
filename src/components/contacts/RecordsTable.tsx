import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useContactRecordsQuery, useContactsQuery } from "@/hooks/queries";
import type { Contact, RecordType } from "@/lib/types";
import { contactLabel } from "@/lib/types";
import { dateHint, formatFieldValue } from "@/lib/fields";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Todos os registros de um tipo, ordenados pela data principal: a carteira de
 * apólices por vencimento, os pacotes por validade, as unidades por
 * condomínio. Clicar abre o contato dono.
 */
export default function RecordsTable({
  type,
  onOpenContact,
}: {
  type: RecordType;
  onOpenContact: (contact: Contact) => void;
}) {
  const { company } = useAuth();
  const { data: records = [] } = useContactRecordsQuery(company?.id);
  const { data: contacts = [] } = useContactsQuery(company?.id);
  const [search, setSearch] = useState("");

  const byId = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  // Até quatro colunas de campo; o resto fica no detalhe.
  const columns = type.fields.slice(0, 4);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return records
      .filter((r) => r.type_key === type.key)
      .map((r) => ({ record: r, contact: byId.get(r.contact_id) }))
      .filter(({ record, contact }) => {
        if (!term) return true;
        const owner = contact ? contactLabel(contact).toLowerCase() : "";
        return record.title.toLowerCase().includes(term) || owner.includes(term);
      });
  }, [records, type.key, byId, search]);

  return (
    <div>
      <div className="relative mb-4 sm:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={`Buscar ${type.label_plural.toLowerCase()} ou contato`}
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-card">
        <div className="scrollbar-slim overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-semibold">{type.label}</th>
                <th className="px-4 py-3 font-semibold">Contato</th>
                {columns.map((f) => (
                  <th key={f.key} className="px-4 py-3 font-semibold">{f.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={2 + columns.length} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    {search
                      ? "Nada encontrado."
                      : `Nenhum registro de ${type.label.toLowerCase()} ainda. Abra um contato para adicionar.`}
                  </td>
                </tr>
              ) : (
                rows.map(({ record, contact }) => (
                  <tr
                    key={record.id}
                    className={cn("border-t transition-colors", contact && "cursor-pointer hover:bg-accent/50")}
                    onClick={() => contact && onOpenContact(contact)}
                  >
                    <td className="px-4 py-3 font-medium">{record.title}</td>
                    <td className="px-4 py-3">{contact ? contactLabel(contact) : "—"}</td>
                    {columns.map((f) => {
                      const text = formatFieldValue(f, record.fields[f.key]);
                      const urgent =
                        f.type === "date" && f.key === type.date_field_key && record.main_date
                          ? dateHint(record.main_date).urgent
                          : false;
                      return (
                        <td
                          key={f.key}
                          className={cn("tabular px-4 py-3", urgent ? "font-medium text-warning" : "text-muted-foreground")}
                        >
                          {text ?? "—"}
                        </td>
                      );
                    })}
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
