# Google Agenda

A Agenda do CRM e o Google Calendar da empresa passam a ser o mesmo calendário:
o que a equipe marca aqui aparece no celular de quem estiver na conta Google
conectada, e o que for marcado por lá entra na Agenda — e, com isso, no que o
SDR IA enxerga quando o lead pergunta se um horário está livre.

Uma conexão por empresa. Quem conecta é quem tem acesso às **Configurações**
daquela empresa, e o e-mail conectado aparece lá.

## O que sincroniza

| Aqui | Lá |
| --- | --- |
| Compromisso `scheduled` ou `done` | Evento no calendário conectado |
| Compromisso `pending` ("a confirmar", do SDR IA) | **não vai** — só depois de confirmado |
| Compromisso cancelado ou apagado | Evento apagado |
| Compromisso importado do Google | Entra como reunião, com título, local e descrição |
| Evento apagado no Google | Compromisso marcado como cancelado (não some do histórico) |

O primeiro sync traz os últimos 30 dias em diante. Série recorrente entra como
uma ocorrência por vez — a Agenda desenha datas, não regras de repetição.

## Configurar (uma vez, para todas as empresas)

As credenciais são do aplicativo, não do cliente: cada empresa só passa pela
tela de consentimento do Google e autoriza a própria conta.

### 1. Google Cloud

1. <https://console.cloud.google.com> → **New project** (ou use um existente).
2. **APIs & Services → Library** → habilite a **Google Calendar API**.
3. **APIs & Services → OAuth consent screen**: tipo *External*, preencha nome do
   app, e-mail de suporte e e-mail do desenvolvedor. Em *Scopes*, adicione
   `.../auth/calendar`. Enquanto o app estiver em **Testing**, só os e-mails
   listados em *Test users* conseguem conectar (e o refresh token vence em 7
   dias) — publique o app (*Publish app*) antes de colocar cliente nele.
4. **Credentials → Create credentials → OAuth client ID → Web application**.
   Em *Authorized redirect URIs*, cole exatamente:

   ```
   https://<ref>.supabase.co/functions/v1/google-calendar/callback
   ```

   Guarde o **Client ID** e o **Client secret**.

### 2. Secrets da edge function

```bash
supabase secrets set \
  GOOGLE_CLIENT_ID="<client id>" \
  GOOGLE_CLIENT_SECRET="<client secret>" \
  APP_URL="https://seu-crm.vercel.app"
```

- `APP_URL` (opcional) é para onde o cliente volta depois de autorizar. Sem ela,
  vale a origem do navegador que iniciou a conexão — o que já funciona em
  produção e em `localhost` ao mesmo tempo. Com ela, a volta é sempre para esse
  endereço.
- `GOOGLE_REDIRECT_URI` (opcional) sobrescreve a URL de callback, para quando as
  functions estiverem atrás de domínio próprio. Precisa ser a mesma cadastrada
  no Google.

### 3. Migration e deploy

```bash
supabase db push
supabase functions deploy google-calendar
```

### 4. Sincronização automática (opcional)

A Agenda sincroniza sozinha sempre que é aberta, no máximo uma vez a cada 2
minutos. Um cron encurta a distância entre marcar algo no celular e aquilo
aparecer aqui, mesmo com o CRM fechado — no SQL Editor do projeto:

```sql
select cron.schedule('google-calendar-sync', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/google-calendar?action=sync-all',
    headers := '{"Content-Type":"application/json","x-cron-secret":"<CRON_SECRET>"}'::jsonb,
    body := '{}'::jsonb
  ) $$);
```

`CRON_SECRET` é o mesmo secret que o `sdr-followup` já usa.

## Conectar (cada empresa)

**Configurações → Google Agenda → Conectar Google Agenda**. O cliente escolhe a
conta, autoriza e volta para a mesma tela já sincronizado.

Trocar de conta é só conectar de novo. **Desconectar** revoga o acesso no
Google, apaga os tokens e solta os compromissos daqui — eles continuam na
Agenda, sem par do outro lado.

## Como funciona por dentro

- `google_calendar_configs` guarda o refresh token de cada empresa. A tabela tem
  RLS **sem policy nenhuma**: nem o dono da empresa lê isso do browser. Quem lê
  é a edge function, com service role. O status que a tela mostra vem da própria
  function (`action=status`).
- Escrever em `appointments` (pela tela, pelo SDR IA ou por qualquer outra
  coisa) enfileira o compromisso em `google_calendar_outbox`, por trigger. O
  sync esvazia essa fila e depois lê do Google o que mudou.
- `appointments.google_synced_at` é o carimbo de "esta escrita veio do Google" —
  é o que impede a mesma mudança de ficar indo e voltando para sempre. Só o sync
  toca nessa coluna.

## Quando alguma coisa não sincroniza

- **"Reconectar" nas Configurações**: o Google recusou o refresh token — quase
  sempre porque a permissão foi removida em <https://myaccount.google.com/permissions>.
  Conectar de novo resolve.
- **O Google não devolveu o refresh token**: acontece quando a conta já tinha
  autorizado o app antes. O fluxo daqui força a tela de consentimento
  (`prompt=consent`) justamente para evitar isso; se aparecer, remova o acesso
  nas permissões da conta Google e conecte de novo.
- **Erro no último sync**: fica registrado em `google_calendar_configs.last_error`
  e aparece no card das Configurações. Itens que falham cinco vezes saem da fila
  para não travar os outros — o `last_error` deles fica em
  `google_calendar_outbox`.
