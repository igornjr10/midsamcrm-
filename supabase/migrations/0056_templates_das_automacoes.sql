-- Templates para as automações: falar fora da janela de 24 horas.
--
-- A Cloud API só aceita texto livre nas 24h seguintes à última mensagem que o
-- cliente mandou. Fora disso, só template aprovado. Tudo que o CRM envia
-- sozinho — giftback da venda, cupom de boas-vindas, aniversário, reativação,
-- NPS, lembrete de horário, aviso de pedido — fala justamente com quem está em
-- silêncio, e por isso era recusado com o erro 131047.
--
-- Aqui cada automação ganha um template aprovado. Na hora do envio a regra é:
-- dentro da janela, texto livre (mais natural e sem custo de template); fora
-- dela, o template mapeado. Sem template mapeado, a falha passa a dizer o que
-- fazer em vez de devolver o erro cru da Meta.
--
-- Só a Meta tem template. Evolution, UAZAPI e OpenWA mandam texto livre sempre,
-- e para eles nada muda.

create table public.crm_automation_templates (
  company_id uuid not null references public.companies(id) on delete cascade,
  /** Qual automação: giftback, boas_vindas, aniversario, agenda... */
  purpose text not null,
  template_name text not null,
  template_language text not null default 'pt_BR',
  /**
   * Mesmo formato das campanhas: { body: [{source}], header: [...] }.
   * Além das fontes do contato, aceita { source: 'context', key: 'codigo' } —
   * resolvido na hora do envio com os dados daquele evento (o código do
   * giftback, o número do pedido, a hora do compromisso).
   */
  variable_map jsonb not null default '{}'::jsonb,
  /** Corpo do template, copiado na hora de escolher: serve de prévia e de histórico. */
  body_preview text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, purpose)
);

alter table public.crm_automation_templates enable row level security;

create policy "company automation templates" on public.crm_automation_templates for all
  using (company_id in (select public.my_company_ids()) or public.is_super_admin())
  with check (company_id in (select public.my_company_ids()) or public.is_super_admin());

create trigger update_crm_automation_templates_updated_at
  before update on public.crm_automation_templates
  for each row execute function public.update_updated_at_column();

notify pgrst, 'reload schema';
