-- Compromisso pedido pelo lead, ainda não confirmado pela equipe.
--
-- O SDR IA já sabia falar de data (consultar_data/consultar_agenda) e o prompt
-- mandava dizer "vou confirmar com a equipe" — mas isso não produzia nada: a
-- intenção do lead ficava só no texto da conversa. Se ninguém abrisse aquele
-- chat, o pedido morria ali.
--
-- Agora a IA grava o pedido na agenda com status 'pending'. Ela continua sem
-- marcar nada de fato: 'pending' não é compromisso, é uma pendência para um
-- humano confirmar (vira 'scheduled') ou recusar (vira 'canceled').
--
-- Fica na mesma tabela em vez de uma tabela nova porque a pergunta que importa
-- — "o que tem no dia 9?" — precisa das duas coisas na mesma consulta, e
-- appointments é onde a Agenda já olha.

alter table public.appointments
  drop constraint if exists appointments_status_check;

alter table public.appointments
  add constraint appointments_status_check
  check (status in ('pending', 'scheduled', 'done', 'canceled'));

comment on column public.appointments.status is
  'pending = pedido do lead aguardando confirmação da equipe (criado pelo SDR IA); scheduled = confirmado.';

notify pgrst, 'reload schema';
