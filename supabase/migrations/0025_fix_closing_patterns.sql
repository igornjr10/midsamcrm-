-- Conserta e amplia os padrões de fechamento.
--
-- Bug: os padrões usavam \b para limite de palavra, sintaxe de PCRE. Na regex
-- do Postgres (ARE), \b é o caractere backspace — então "pix\b" exigia um
-- backspace depois de "pix" e não casava com nada. O limite de palavra é \y.
--
-- Junto, cobertura para como as pessoas escrevem de verdade: "fiz o pix",
-- "paguei", "ta pago", "ja fiz o pagamento", "transferi" — todas passavam
-- batido.
--
-- Os padrões rodam sobre o texto minúsculo e sem acento (normalize_text).

delete from public.closing_patterns where company_id is null;

insert into public.closing_patterns (label, pattern, signal_type) values
  -- ── Dinheiro que já saiu ──────────────────────────────────────────────────
  ('Comprovante',    'comprovante', 'pagamento'),
  ('Pix',            '(fiz|faco|mandei|enviei|passei|realizei|efetuei)\s+(o\s+|um\s+|a\s+)?pix', 'pagamento'),
  ('Pix',            'pix\s+(feito|enviado|realizado|pago|efetuado|concluido)', 'pagamento'),
  -- "nao paguei" e "ainda nao paguei" ficam de fora.
  ('Paguei',         '(?<!nao )(?<!nao ja )\ypaguei\y', 'pagamento'),
  ('Paguei',         'acabei de pagar|ja paguei|paguei agora', 'pagamento'),
  ('Pagamento feito', 'fiz\s+o\s+pagamento|pagamento\s+(ja\s+)?(foi\s+)?(feito|realizado|confirmado|recebido|efetuado|concluido)', 'pagamento'),
  ('Está pago',      '(ta|esta|foi)\s+pago\y|pagamento\s+ok', 'pagamento'),
  ('Transferência',  '\ytransferi\y|transferencia\s+(feita|realizada|enviada|efetuada)|fiz\s+a\s+transferencia', 'pagamento'),
  ('Depósito',       '\ydepositei\y|deposito\s+(feito|realizado|efetuado)', 'pagamento'),
  ('Boleto pago',    'boleto\s+(pago|quitado)', 'pagamento'),
  ('Valor pago',     'valor\s+(ja\s+)?(foi\s+)?(pago|depositado|transferido)', 'pagamento'),
  -- "entrada" e "sinal" sozinhos pegariam "entrada do salão" e "sinal de
  -- internet": só contam com contexto de pagamento.
  ('Entrada paga',   '(paguei|pagamos|fiz|dei|mandei)\s+(a|o)?\s*(valor\s+d[ao]\s+)?entrada|entrada\s+(paga|feita|realizada)', 'pagamento'),
  ('Sinal pago',     '(paguei|pagamos|dei|mandei)\s+(o\s+)?sinal|sinal\s+(pago|feito|realizado)', 'pagamento'),

  -- ── Intenção: vale acompanhar, mas não é venda ────────────────────────────
  ('Autorizou emitir', 'pode\s+(emitir|gerar|fazer|mandar)\s+(a|o)?\s*(nota|nf|contrato|pedido|ordem|cobranca)', 'intencao'),
  ('Fechou',         '(vou|quero|pode|bora|vamos)\s+fechar|fechamos\y|ta\s+fechado\y|negocio\s+fechado', 'intencao'),
  ('Aprovado',       '(orcamento|proposta)\s+aprovad[oa]|foi\s+aprovad[oa]|aprovamos\y', 'intencao'),
  ('Confirmou',      '(confirmo|confirmado)\s+(a\s+)?(data|reserva|contratacao)|pode\s+reservar', 'intencao');

notify pgrst, 'reload schema';
