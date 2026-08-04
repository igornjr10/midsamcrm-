import { useMemo, useRef, useState } from "react";
import { FileText, Library, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  useLibraryQuery,
  useUploadLibraryItemMutation,
  useUpdateLibraryItemMutation,
  useDeleteLibraryItemMutation,
} from "@/hooks/queries";
import { LIBRARY_KINDS, type LibraryItem, type LibraryKind } from "@/lib/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, LoadingState } from "@/components/ui/empty-state";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const MAX_MB = 16; // Teto de mídia do WhatsApp Cloud API.

function sizeLabel(bytes: number | null): string {
  if (!bytes) return "";
  const mb = bytes / 1_048_576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export default function Biblioteca() {
  const { user, company } = useAuth();
  const { data: items = [], isPending } = useLibraryQuery(company?.id);
  const upload = useUploadLibraryItemMutation();
  const updateItem = useUpdateLibraryItemMutation();
  const deleteItem = useDeleteLibraryItemMutation();

  const [tab, setTab] = useState<LibraryKind>("cardapio");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "" });
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const byKind = useMemo(() => {
    const map = new Map<LibraryKind, LibraryItem[]>();
    for (const kind of LIBRARY_KINDS) map.set(kind.id, []);
    for (const item of items) map.get(item.kind)?.push(item);
    return map;
  }, [items]);

  const openUpload = () => {
    setForm({ title: "", description: "" });
    setFile(null);
    setUploadOpen(true);
  };

  const handleUpload = async () => {
    if (!user || !company || !file) {
      toast.error("Escolha um arquivo");
      return;
    }
    if (file.size > MAX_MB * 1_048_576) {
      toast.error(`O WhatsApp não aceita arquivo acima de ${MAX_MB} MB`);
      return;
    }
    try {
      await upload.mutateAsync({
        company_id: company.id,
        user_id: user.id,
        kind: tab,
        title: form.title.trim() || file.name,
        description: form.description.trim() || null,
        file,
      });
      toast.success("Arquivo adicionado");
      setUploadOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar arquivo");
    }
  };

  const toggleActive = (item: LibraryItem) => {
    if (!company) return;
    void updateItem.mutateAsync({ id: item.id, company_id: company.id, active: !item.active });
  };

  const remove = (item: LibraryItem) => {
    if (!window.confirm(`Excluir "${item.title}"? O arquivo sai do bucket também.`)) return;
    void deleteItem.mutateAsync(item);
  };

  return (
    <div>
      <PageHeader
        icon={Library}
        title="Biblioteca"
        description="Cardápios, orçamentos e material de apoio que a IA e a equipe enviam pelo WhatsApp"
        actions={
          <Button onClick={openUpload}>
            <Upload />
            Adicionar arquivo
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as LibraryKind)}>
        <TabsList>
          {LIBRARY_KINDS.map((kind) => (
            <TabsTrigger key={kind.id} value={kind.id}>
              {kind.label}
              <span className="ml-1.5 text-xs text-muted-foreground">
                {byKind.get(kind.id)?.length ?? 0}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

        {LIBRARY_KINDS.map((kind) => {
          const list = byKind.get(kind.id) ?? [];
          return (
            <TabsContent key={kind.id} value={kind.id} className="mt-4">
              {isPending ? (
                <LoadingState label="Carregando biblioteca..." />
              ) : list.length === 0 ? (
                <EmptyState
                  icon={Library}
                  title={`Nenhum arquivo em ${kind.label.toLowerCase()}`}
                  description={`${kind.hint}. O que estiver aqui a IA pode enviar quando o lead pedir.`}
                  action={
                    <Button onClick={openUpload}>
                      <Upload />
                      Adicionar arquivo
                    </Button>
                  }
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        "group flex flex-col overflow-hidden rounded-xl border bg-card shadow-card transition-shadow hover:shadow-card-hover",
                        !item.active && "opacity-60",
                      )}
                    >
                      <a
                        href={item.file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex h-36 items-center justify-center border-b bg-muted/40"
                      >
                        {item.media_type === "image" ? (
                          <img src={item.file_url} alt={item.title} className="h-full w-full object-cover" />
                        ) : (
                          <FileText className="h-10 w-10 text-muted-foreground" />
                        )}
                      </a>
                      <div className="flex flex-1 flex-col gap-1.5 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium leading-tight">{item.title}</p>
                          {!item.active && <Badge variant="outline">Desligado</Badge>}
                        </div>
                        {item.description && (
                          <p className="text-xs text-muted-foreground">{item.description}</p>
                        )}
                        <p className="tabular mt-auto pt-1 text-xs text-muted-foreground">
                          {item.media_type === "image" ? "Imagem" : "Documento"}
                          {item.size_bytes ? ` · ${sizeLabel(item.size_bytes)}` : ""}
                        </p>
                        <div className="flex items-center gap-2 pt-1">
                          <Button size="sm" variant="outline" onClick={() => toggleActive(item)}>
                            {item.active ? "Desligar" : "Ligar"}
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Excluir arquivo"
                            className="ml-auto text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => remove(item)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Adicionar em {LIBRARY_KINDS.find((k) => k.id === tab)?.label.toLowerCase()}
            </DialogTitle>
            <DialogDescription>
              Imagem ou PDF de até {MAX_MB} MB, que é o teto do WhatsApp.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Arquivo</Label>
              <Input
                ref={fileInput}
                type="file"
                accept="image/*,application/pdf,video/mp4"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file && (
                <p className="text-xs text-muted-foreground">
                  {file.name} · {sizeLabel(file.size)}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Título</Label>
              <Input
                placeholder={file?.name ?? "Cardápio de festas 2026"}
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Quando enviar este arquivo</Label>
              <Textarea
                rows={2}
                placeholder="Ex: cardápio completo de festas e eventos, com preços por pessoa"
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                É por esta descrição que a IA escolhe o arquivo certo quando o lead pede.
              </p>
            </div>
            <Button className="w-full" onClick={handleUpload} disabled={!file || upload.isPending}>
              {upload.isPending ? "Enviando..." : "Adicionar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
