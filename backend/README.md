# Servidor de contas do Music Tracker

Guarda as contas (email e palavra-passe em forma de resumo), as sessões, a recuperação de palavra-passe por código no email, a verificação em duas etapas (código da app e código QR) e a biblioteca de cada conta. Corre no Cloudflare Workers, no plano gratuito.

Enquanto o servidor não estiver publicado, a app funciona como antes, com contas só neste navegador.

## 1. Criar a base de dados (KV)

1. Entra em https://dash.cloudflare.com e abre **Workers & Pages → KV**.
2. Cria um namespace chamado `musictracker-contas`.
3. Copia o **ID** que aparece.

## 2. Publicar o Worker

No terminal, dentro da pasta `backend/`:

```
npm install -g wrangler
wrangler login
```

Abre `wrangler.toml` e substitui `PREENCHER_COM_O_ID_DA_KV` pelo ID do passo anterior. Depois:

```
wrangler deploy
```

Anota o endereço que aparece, por exemplo `https://musictracker-contas.teu-nome.workers.dev`.

## 3. Definir os segredos

Nunca os ponhas no código. Corre cada comando e cola o valor quando pedir:

```
wrangler secret put ADMIN_TOKEN        # palavra longa e secreta para o painel de admin
wrangler secret put RESEND_API_KEY     # chave da Resend (ver passo 4)
wrangler secret put MAIL_FROM          # ex.: Music Tracker <contas@teu-dominio.pt>
```

## 4. Serviço de email (códigos de recuperação)

O código para repor a palavra-passe é enviado por email. Usamos a **Resend**:

1. Cria conta em https://resend.com e adiciona o teu domínio (confirma os registos DNS que pedem).
2. Cria uma API key e usa-a no passo `RESEND_API_KEY`.
3. O endereço em `MAIL_FROM` tem de ser de um domínio verificado na Resend.

Sem estes segredos, o pedido de recuperação responde com sucesso, mas nenhum email é enviado.

## 5. Ligar a app ao servidor

Em `avaliador-albuns-v2.html` (ou `js/app.js`), procura `var ACCOUNTS_API = '';` e mete o endereço do passo 2:

```
var ACCOUNTS_API = 'https://musictracker-contas.teu-nome.workers.dev';
```

Depois publica a app (bump de versão e push, como das outras vezes). A partir daí o ecrã de entrar passa a usar o servidor.

## Verificar

- Criar conta no site, iniciar sessão noutro navegador e confirmar que a biblioteca aparece.
- Ativar a verificação em duas etapas no Perfil, ler o QR com a app de autenticação e iniciar sessão de novo.
- Pedir "Esqueci a palavra-passe" e confirmar que o código chega ao email.
- Painel de admin: `GET /admin/accounts` com `Authorization: Bearer <ADMIN_TOKEN>` lista as contas com email, data, país e se têm 2 etapas.

## Notas

- Perfis e amigos usam o mesmo servidor, sem segredos novos. O perfil público mostra só o nº de álbuns avaliados, o artista favorito (o que tem mais álbuns avaliados) e o nº de amigos.

- Contas criadas só neste navegador antes deste servidor não passam automaticamente para o servidor: têm de ser criadas de novo.
- A palavra-passe é guardada com PBKDF2 (100 000 iterações). Os códigos de recuperação e as sessões também são guardados só em forma de resumo.
- Limite de tentativas: 10 falhas de palavra-passe bloqueiam a conta 15 minutos. Os códigos de recuperação aceitam 5 tentativas.
- A biblioteca guardada na conta tem o limite de 2 MB.
