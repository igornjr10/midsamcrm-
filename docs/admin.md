# Administração da conta

Como transferir acesso, trocar o e-mail principal e promover alguém a super
admin. Tudo aqui é operação de banco/Auth — nenhuma dessas telas existe no CRM.

## Quem é super admin

A flag é `profiles.is_super_admin`. Quem a tem:

- enxerga todas as empresas (a RLS abre com `public.is_super_admin()`);
- acessa a página **Empresas**;
- pode operar a conta de um cliente — as edge functions respeitam o
  `company_id` que o front manda (`resolveCompanyId` em `_shared/company.ts`).

Promover alguém, pelo SQL Editor do Supabase:

```sql
update public.profiles p
set is_super_admin = true
from auth.users u
where u.id = p.user_id and lower(u.email) = lower('pessoa@exemplo.com');
```

Tirar o acesso é o mesmo com `false`. Vale conferir antes de remover o seu:

```sql
select u.email, p.is_super_admin
from public.profiles p
join auth.users u on u.id = p.user_id
where p.is_super_admin;
```

## Trocar o e-mail principal da conta

O que identifica o usuário no banco é o `user_id` (uuid), **não** o e-mail. Por
isso trocar o e-mail não afeta empresas, contatos, conversas nem permissões —
tudo continua apontando para o mesmo id.

Dois caminhos:

**1. Pelo Dashboard** (mais direto)
Authentication → Users → clique no usuário → *Edit user* → altere o e-mail.
Marque *Auto Confirm User* se não quiser esperar a confirmação por e-mail.

**2. Pelo próprio app**, logado como o usuário:

```ts
await supabase.auth.updateUser({ email: "novo@exemplo.com" });
```

Aqui o Supabase manda um link de confirmação para o **novo** endereço, e a troca
só vale depois do clique. Se o e-mail antigo ainda funcionar, ele também recebe
um aviso de segurança.

Depois de trocar, o login passa a ser com o novo e-mail. A senha não muda.

## Transferir a conta para outra pessoa

Se a ideia é passar o CRM adiante, prefira **criar um usuário novo** e promovê-lo
a super admin, em vez de trocar o e-mail do seu:

1. A pessoa se cadastra (ou você cria em Authentication → Add user);
2. Rode o `update` de super admin acima com o e-mail dela;
3. Ligue-a às empresas que deve acessar:

```sql
insert into public.company_members (company_id, user_id, role)
select c.id, u.id, 'admin'
from public.companies c, auth.users u
where c.name = 'Midsam Comercial' and u.email = 'pessoa@exemplo.com'
on conflict (company_id, user_id) do nothing;
```

4. Só então remova o seu acesso, se for o caso.

Fazer nessa ordem evita o cenário em que ninguém tem super admin — situação que
só se resolve por SQL, porque a própria tela de Empresas fica inacessível.

## Cuidado: o banco é compartilhado

Este projeto Supabase hospeda também um app de delivery (`delivery_zones`,
`orders`, `couriers`). Super admin do CRM **não** é dono daquelas tabelas, mas a
service role key ignora RLS de tudo — inclusive delas. Evite usar essa chave
fora das edge functions.
