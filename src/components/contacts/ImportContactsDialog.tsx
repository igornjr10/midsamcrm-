import { useMemo, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { contactsQueryKey, useContactsQuery, usePipelineStagesQuery } from "@/hooks/queries";
import { parseCsv } from "@/lib/retail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Target = "name" | "phone" | "email" | "tags" | "notes";

const TARGETS: Array<{ key: Target; label: string; required?: boolean }> = [
  { key: "name", label: "Nome" },
  { key: "phone", label: "Telefone / WhatsApp", required: true },
  { key: "email", label: "E-mail" },
  { key: "tags", label: "Etiquetas" },
  { key: "notes", label: "Observações" },
];

// Cabeçalhos que costumam aparecer em planilha e no export do Google Contatos.
const GUESS: Record<Target, RegExp> = {
  name: /^(nome|name|first name|cliente|contato|nome completo)/i,
  phone: /(telefone|celular|whats|fone|phone|mobile|numero|número)/i,
  email: /(e-?mail)/i,
  tags: /(etiqueta|tag|label|grupo)/i,
  notes: /(obs|nota|note|coment)/i,
};

const NONE = "__none__";
const BATCH = 500;

/** Só dígitos; número brasileiro sem DDI ganha o 55. */
function cleanPhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

// Mesma regra do find_contact_by_phone no banco: os 8 últimos dígitos bastam
// para reconhecer o número com ou sem 55 e com ou sem o 9 extra.
const phoneKey = (digits: string) => digits.slice(-8);

/**
 * Importa contatos de uma planilha CSV (Excel "Salvar como CSV", Google
 * Planilhas, export do Google Contatos). Telefone repetido — na planilha ou já
 * cadastrado — é pulado, nunca duplicado nem sobrescrito.
 */
export default function ImportContactsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user, company } = useAuth();
  const queryClient = useQueryClient();
  const { data: contacts = [] } = useContactsQuery(company?.id);
  const { data: stages = [] } = usePipelineStagesQuery(company?.id);

  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<Target, string>>({
    name: NONE, phone: NONE, email: NONE, tags: NONE, notes: NONE,
  });
  const [stage, setStage] = useState("");
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);

  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const openStages = stages.filter((s) => s.kind === "open");
  const stageKey = stage || openStages[0]?.key || "new";

  const reset = () => {
    setFileName("");
    setRows([]);
    setMapping({ name: NONE, phone: NONE, email: NONE, tags: NONE, notes: NONE });
    setTag("");
    setStage("");
  };

  const handleFile = async (file: File) => {
    if (!/\.(csv|txt)$/i.test(file.name)) {
      toast.error("Use um arquivo .csv. No Excel: Arquivo › Salvar como › CSV.");
      return;
    }
    // Excel no Brasil salva em Windows-1252; UTF-8 inválido vira "�".
    const buffer = await file.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(buffer);
    if (text.includes("�")) text = new TextDecoder("windows-1252").decode(buffer);
    text = text.replace(/^﻿/, "");

    const parsed = parseCsv(text);
    if (parsed.length < 2) {
      toast.error("A planilha precisa de uma linha de títulos e pelo menos um contato.");
      return;
    }
    const cols = parsed[0].map((c) => c.trim());
    const guessed = { name: NONE, phone: NONE, email: NONE, tags: NONE, notes: NONE } as Record<Target, string>;
    for (const t of TARGETS) {
      const index = cols.findIndex(
        (c, i) => GUESS[t.key].test(c) && !Object.values(guessed).includes(String(i)),
      );
      if (index >= 0) guessed[t.key] = String(index);
    }
    setFileName(file.name);
    setRows(parsed);
    setMapping(guessed);
  };

  const cell = (row: string[], target: Target) =>
    mapping[target] === NONE ? "" : (row[Number(mapping[target])] ?? "").trim();

  // Prévia do que vai acontecer, antes de gravar.
  const plan = useMemo(() => {
    const existing = new Set(
      contacts.map((c) => (c.normalized_phone ?? c.phone ?? "").replace(/\D/g, "")).filter(Boolean).map(phoneKey),
    );
    const seen = new Set<string>();
    const toInsert: Array<{ name: string; phone: string; email: string; tags: string[]; notes: string }> = [];
    let invalid = 0;
    let duplicated = 0;
    if (mapping.phone === NONE) return { toInsert, invalid, duplicated };

    for (const row of body) {
      const phone = cleanPhone(cell(row, "phone"));
      if (!phone) {
        invalid++;
        continue;
      }
      const key = phoneKey(phone);
      if (existing.has(key) || seen.has(key)) {
        duplicated++;
        continue;
      }
      seen.add(key);
      const tags = cell(row, "tags").split(/[,;|]/).map((t) => t.trim()).filter(Boolean);
      toInsert.push({
        name: cell(row, "name") || phone,
        phone,
        email: cell(row, "email"),
        tags,
        notes: cell(row, "notes"),
      });
    }
    return { toInsert, invalid, duplicated };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, mapping, contacts]);

  const handleImport = async () => {
    if (!user || !company || plan.toInsert.length === 0) return;
    setBusy(true);
    let done = 0;
    try {
      const extraTag = tag.trim();
      for (let i = 0; i < plan.toInsert.length; i += BATCH) {
        const chunk = plan.toInsert.slice(i, i + BATCH).map((c) => ({
          user_id: user.id,
          company_id: company.id,
          name: c.name,
          phone: c.phone,
          email: c.email || null,
          notes: c.notes || null,
          stage: stageKey,
          tags: [...new Set([...c.tags, ...(extraTag ? [extraTag] : [])])],
          source: "importacao",
          source_detail: fileName || null,
        }));
        const { error } = await supabase.from("contacts").insert(chunk);
        if (error) throw error;
        done += chunk.length;
      }
      toast.success(
        `${done} ${done === 1 ? "contato importado" : "contatos importados"}` +
          (plan.duplicated ? ` · ${plan.duplicated} já existiam` : "") +
          (plan.invalid ? ` · ${plan.invalid} sem telefone válido` : ""),
      );
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(
        `${done > 0 ? `${done} importados, depois parou: ` : ""}${err instanceof Error ? err.message : "erro ao importar"}`,
      );
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: contactsQueryKey(company.id) });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (busy) return;
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Importar contatos</DialogTitle>
          <DialogDescription>
            Planilha em CSV com uma linha de títulos. No Excel: Arquivo › Salvar como › CSV. Telefones que
            já estão no CRM são pulados.
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors hover:bg-accent/40">
            <FileUp className="h-8 w-8 text-muted-foreground" />
            <span className="text-sm font-medium">Escolher arquivo .csv</span>
            <span className="text-xs text-muted-foreground">Colunas como Nome, Telefone, E-mail, Etiquetas</span>
            <input
              type="file"
              accept=".csv,text/csv,.txt"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleFile(file);
              }}
            />
          </label>
        ) : (
          <div className="space-y-4">
            <p className="text-sm">
              <span className="font-medium">{fileName}</span>
              <span className="text-muted-foreground"> · {body.length} linhas</span>
              <button type="button" className="ml-2 text-xs text-primary hover:underline" onClick={reset}>
                trocar arquivo
              </button>
            </p>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Qual coluna é o quê
              </p>
              {TARGETS.map((t) => (
                <div key={t.key} className="grid grid-cols-[9rem_1fr] items-center gap-3">
                  <Label className="text-sm">
                    {t.label}
                    {t.required && <span className="text-destructive"> *</span>}
                  </Label>
                  <Select value={mapping[t.key]} onValueChange={(v) => setMapping((m) => ({ ...m, [t.key]: v }))}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Não importar</SelectItem>
                      {header.map((h, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {h || `Coluna ${i + 1}`}
                          {body[0]?.[i] ? ` · ex: ${body[0][i].slice(0, 24)}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Etapa do funil</Label>
                <Select value={stageKey} onValueChange={setStage}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {openStages.map((s) => (
                      <SelectItem key={s.id} value={s.key}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="import-tag">Etiqueta para todos (opcional)</Label>
                <Input
                  id="import-tag"
                  placeholder="Ex: Lista feira 2026"
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                />
              </div>
            </div>

            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              {mapping.phone === NONE ? (
                <p className="text-destructive">Escolha a coluna do telefone para continuar.</p>
              ) : (
                <>
                  <p>
                    <span className="font-semibold">{plan.toInsert.length}</span> contatos novos serão importados.
                  </p>
                  {(plan.duplicated > 0 || plan.invalid > 0) && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {plan.duplicated > 0 && `${plan.duplicated} já existem no CRM ou se repetem na planilha. `}
                      {plan.invalid > 0 && `${plan.invalid} sem telefone válido.`}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            className="w-full"
            onClick={() => void handleImport()}
            disabled={busy || rows.length === 0 || plan.toInsert.length === 0}
          >
            {busy ? <Loader2 className="animate-spin" /> : <FileUp />}
            {busy ? "Importando..." : `Importar ${plan.toInsert.length || ""} contatos`.replace("  ", " ")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
