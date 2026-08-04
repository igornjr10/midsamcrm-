import type { PostgrestError } from "@supabase/supabase-js";

/**
 * O PostgREST corta toda resposta em `max-rows` (1000 no Supabase), então um
 * `.limit(2000)` devolve 1000 em silêncio. Para listas que podem passar disso,
 * buscamos em páginas até vir uma incompleta.
 *
 * O `select` precisa vir com uma ordenação estável (inclua o `id` como critério
 * de desempate): sem isso o banco pode devolver a mesma linha em duas páginas e
 * omitir outra na virada.
 */
export const PAGE_SIZE = 1000;

type PageResult<T> = { data: T[] | null; error: PostgrestError | null };

export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let index = 0; ; index += 1) {
    const from = index * PAGE_SIZE;
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}
