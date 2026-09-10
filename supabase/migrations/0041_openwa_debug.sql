-- TEMPORÁRIA. Captura o evento cru do OpenWA para descobrir onde vem o telefone
-- de verdade.
--
-- O WhatsApp passou a entregar o chat como @lid (um id que não é telefone) em
-- vez de @c.us. O parser gravou o lid como se fosse número, então os contatos
-- nasceram chamados "217750614110306" e a IA respondia para um número que não
-- existe — daí o silêncio dela.
--
-- O adapter da UAZAPI já convive com isso ("sender_pn é o telefone de verdade;
-- sender costuma ser um @lid"), mas o campo equivalente do OpenWA não dá para
-- adivinhar: a doc é uma SPA e /contacts do painel estoura o tempo. Um evento
-- real resolve em trinta segundos o que meia hora de palpite não resolve.
--
-- Esta tabela sai na migration seguinte, assim que o parser estiver corrigido.
create table public.openwa_debug (
  id bigint generated always as identity primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

-- RLS sem policy: só a function (service role) escreve, só quem tem service key
-- lê. O payload traz conteúdo de conversa de cliente.
alter table public.openwa_debug enable row level security;

notify pgrst, 'reload schema';
