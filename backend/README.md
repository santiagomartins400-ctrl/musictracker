# Contas e painel de admin (Music Tracker)

Guarda o email e o país de cada conta criada. Não guarda palavras-passe.

## Publicar (uma vez)
1. Cria uma conta gratuita em https://dash.cloudflare.com.
2. Instala o Wrangler (`npm i -g wrangler`) e faz `wrangler login`.
3. Cria a base de dados: `wrangler kv namespace create ACCOUNTS` e copia o `id` para `wrangler.toml`.
4. Define o token de admin (escolhe uma frase longa): `wrangler secret put ADMIN_TOKEN`.
5. Publica: `wrangler deploy`. Fica um URL do tipo `https://musictracker-contas.<conta>.workers.dev`.
6. Em `avaliador-albuns-v2.html`, preenche `ACCOUNTS_API` com esse URL e publica uma nova versão.

## Painel
Perfil → Administração → "Abrir painel", com o token de admin. O painel mostra email, data de criação e país.

## Limitações
- Só aparecem contas criadas depois de a app ligar ao servidor. As contas antigas continuam só no navegador de cada um.
- Guardar emails e países implica informar os utilizadores na política de privacidade (RGPD).
