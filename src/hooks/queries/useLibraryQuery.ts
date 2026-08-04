import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, SUPABASE_URL } from "@/integrations/supabase/client";
import type { LibraryItem, LibraryKind } from "@/lib/types";

export function libraryQueryKey(companyId: string | undefined) {
  return ["library", companyId] as const;
}

export function useLibraryQuery(companyId: string | undefined) {
  return useQuery({
    queryKey: libraryQueryKey(companyId),
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("library_items")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LibraryItem[];
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });
}

/** Imagem vai como imagem no WhatsApp; o resto vira documento. */
function mediaTypeOf(mimetype: string): LibraryItem["media_type"] {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  return "document";
}

export function useUploadLibraryItemMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      company_id: string;
      user_id: string;
      kind: LibraryKind;
      title: string;
      description?: string | null;
      file: File;
    }) => {
      const ext = input.file.name.split(".").pop()?.toLowerCase() || "bin";
      const path = `${input.company_id}/${crypto.randomUUID()}.${ext}`;
      const mimetype = input.file.type || "application/octet-stream";

      const { error: uploadError } = await supabase.storage
        .from("library")
        .upload(path, input.file, { contentType: mimetype, upsert: false });
      if (uploadError) throw uploadError;

      const { error } = await supabase.from("library_items").insert({
        company_id: input.company_id,
        user_id: input.user_id,
        kind: input.kind,
        title: input.title,
        description: input.description ?? null,
        file_path: path,
        file_url: `${SUPABASE_URL}/storage/v1/object/public/library/${path}`,
        mimetype,
        media_type: mediaTypeOf(mimetype),
        size_bytes: input.file.size,
      });
      // Sem a linha, o arquivo no bucket seria lixo invisível.
      if (error) {
        await supabase.storage.from("library").remove([path]);
        throw error;
      }
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: libraryQueryKey(company_id) });
    },
  });
}

export function useUpdateLibraryItemMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      company_id,
      ...patch
    }: { id: string; company_id: string } & Partial<LibraryItem>) => {
      const { error } = await supabase
        .from("library_items")
        .update(patch)
        .eq("id", id)
        .eq("company_id", company_id);
      if (error) throw error;
    },
    onSuccess: (_, { company_id }) => {
      void queryClient.invalidateQueries({ queryKey: libraryQueryKey(company_id) });
    },
  });
}

export function useDeleteLibraryItemMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (item: LibraryItem) => {
      const { error } = await supabase
        .from("library_items")
        .delete()
        .eq("id", item.id)
        .eq("company_id", item.company_id);
      if (error) throw error;
      await supabase.storage.from("library").remove([item.file_path]);
    },
    onSuccess: (_, item) => {
      void queryClient.invalidateQueries({ queryKey: libraryQueryKey(item.company_id) });
    },
  });
}
