-- Remove a captura temporária do OpenWA (0041).
--
-- Ela existiu para uma pergunta específica — de onde vem o telefone quando o
-- chat é @lid — e respondeu: não vem. O evento traz só o lid, e a tradução
-- passou a ser feita pelo endpoint por contato do painel.
--
-- Cumprido o papel, sai: a tabela guardava o payload inteiro de cada mensagem
-- recebida, ou seja, conteúdo de conversa de cliente crescendo sem limite e sem
-- ninguém para ler.
drop table if exists public.openwa_debug;

notify pgrst, 'reload schema';
