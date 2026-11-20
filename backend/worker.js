// Servidor de contas do Music Tracker (Cloudflare Worker + KV "ACCOUNTS").
//
// Guarda: contas (email, palavra-passe como resumo PBKDF2, país), sessões (só o resumo do token),
// códigos de recuperação (só o resumo), segredos de verificação em duas etapas e a biblioteca de cada conta.
// Nunca guarda palavras-passe em texto nem códigos em texto.
//
// Segredos e ligações (definir no Cloudflare, ver backend/README.md):
//   ACCOUNTS (KV), ADMIN_TOKEN (texto secreto), RESEND_API_KEY (texto secreto), MAIL_FROM (ex.: "Music Tracker <contas@teu-dominio.pt>")

const ALLOWED_ORIGINS = ['https://santiagomartins400-ctrl.github.io'];
const PBKDF2_ITER = 100000;          // máximo permitido pelos Workers
const SESSION_TTL = 30 * 86400;      // 30 dias
const MFA_TTL = 300;                 // 5 minutos para o código de 2 etapas
const RESET_TTL = 900;               // código de recuperação válido 15 minutos
const RESET_COOLDOWN = 60;           // segundos entre pedidos de código
const MAX_TRIES = 5;                 // tentativas por código de recuperação
const MAX_FAILS = 10;                // falhas de palavra-passe até bloquear
const LOCK_MS = 15 * 60 * 1000;      // bloqueio de 15 minutos
const MAX_LIB_CHARS = 2_000_000;     // biblioteca: 2 MB

const enc = new TextEncoder();

function cors(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors(origin) },
  });
}

/* ---------- utilidades criptográficas ---------- */
function bytesToB64(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
function b64ToBytes(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }
function b64url(bytes) { return bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function randomBytes(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; }
function randomToken() { return b64url(randomBytes(32)); }

async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function pbkdf2(password, saltBytes) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITER, hash: 'SHA-256' }, key, 256);
  return bytesToB64(new Uint8Array(bits));
}

async function makePassword(password) {
  const salt = randomBytes(16);
  return { salt: bytesToB64(salt), hash: await pbkdf2(password, salt) };
}

async function checkPassword(password, rec) {
  if (!rec) { await pbkdf2(password, randomBytes(16)); return false; } // tempo parecido, mesmo sem conta
  const h = await pbkdf2(password, b64ToBytes(rec.salt));
  return timingSafeEq(h, rec.hash);
}

function timingSafeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* ---------- verificação em duas etapas (TOTP, RFC 6238) ---------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32encode(bytes) {
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.substr(i, 5).padEnd(5, '0'), 2)];
  return out;
}
function b32decode(s) {
  let bits = '';
  for (const ch of String(s).replace(/=+$/, '').toUpperCase()) {
    const v = B32.indexOf(ch);
    if (v < 0) return null;
    bits += v.toString(2).padStart(5, '0');
  }
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.substr(i * 8, 8), 2);
  return out;
}
async function totpAt(secretBytes, counter) {
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new ArrayBuffer(8);
  const dv = new DataView(msg);
  dv.setUint32(0, Math.floor(counter / 0x100000000));
  dv.setUint32(4, counter >>> 0);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = sig[sig.length - 1] & 0x0f;
  const code = (((sig[o] & 0x7f) << 24) | (sig[o + 1] << 16) | (sig[o + 2] << 8) | sig[o + 3]) % 1000000;
  return String(code).padStart(6, '0');
}
async function verifyTotp(secretB32, code) {
  const bytes = b32decode(secretB32);
  if (!bytes || !/^\d{6}$/.test(String(code || ''))) return false;
  const c = Math.floor(Date.now() / 30000);
  for (const d of [-1, 0, 1]) {            // aceita 30 s antes ou depois, por causa do relógio
    if (timingSafeEq(await totpAt(bytes, c + d), String(code))) return true;
  }
  return false;
}
function newTotpSecret() { return b32encode(randomBytes(20)); }
function otpauthUri(email, secret) {
  return `otpauth://totp/${encodeURIComponent('Music Tracker')}:${encodeURIComponent(email)}`
    + `?secret=${secret}&issuer=${encodeURIComponent('Music Tracker')}&algorithm=SHA1&digits=6&period=30`;
}

/* ---------- email (código de recuperação) ---------- */
async function sendMail(env, to, subject, text) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) throw new Error('mail-not-configured');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text }),
  });
  if (!r.ok) throw new Error('mail-failed ' + r.status);
}

/* ---------- contas e sessões ---------- */
function validEmail(e) { return typeof e === 'string' && e.length <= 254 && /^\S+@\S+\.\S+$/.test(e); }
function validPassword(p) { return typeof p === 'string' && p.length >= 8 && p.length <= 200; }
function normEmail(e) { return String(e || '').trim().toLowerCase(); }

async function getUser(env, email) { return env.ACCOUNTS.get('u:' + email, 'json'); }
async function putUser(env, user) { await env.ACCOUNTS.put('u:' + user.email, JSON.stringify(user)); }

async function issueSession(env, user) {
  const tok = randomToken();
  await env.ACCOUNTS.put('s:' + await sha256hex(tok),
    JSON.stringify({ email: user.email, sv: user.sv || 1, exp: Date.now() + SESSION_TTL * 1000 }),
    { expirationTtl: SESSION_TTL });
  return tok;
}

async function sessionFor(request, env) {
  const h = request.headers.get('Authorization') || '';
  if (!h.startsWith('Bearer ')) return null;
  const tok = h.slice(7);
  const s = await env.ACCOUNTS.get('s:' + await sha256hex(tok), 'json');
  if (!s || s.exp < Date.now()) return null;
  const user = await getUser(env, s.email);
  if (!user || (user.sv || 1) !== s.sv) return null;   // sessão terminada (ex.: palavra-passe mudou)
  return { user, tok };
}

function publicUser(u) { return { email: u.email, twoFactor: !!(u.totp && u.totp.enabled) }; }

async function lockState(env, email) {
  const l = await env.ACCOUNTS.get('lock:' + email, 'json');
  if (l && l.until && l.until > Date.now()) return l;
  return null;
}
async function recordFail(env, email) {
  const l = (await env.ACCOUNTS.get('lock:' + email, 'json')) || { n: 0 };
  l.n = (l.n || 0) + 1;
  if (l.n >= MAX_FAILS) { l.until = Date.now() + LOCK_MS; l.n = 0; }
  await env.ACCOUNTS.put('lock:' + email, JSON.stringify(l), { expirationTtl: 3600 });
}
async function clearFails(env, email) { await env.ACCOUNTS.delete('lock:' + email); }

async function readBody(request) {
  try { return await request.json(); } catch (e) { return null; }
}

/* ---------- rotas ---------- */
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);
    const m = request.method;
    const p = url.pathname;

    if (m === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (!ALLOWED_ORIGINS.includes(origin) && p !== '/admin/accounts') {
      return json({ error: 'Origem não permitida.' }, 403, origin);
    }

    try {
      /* Criar conta */
      if (m === 'POST' && p === '/auth/register') {
        const body = await readBody(request);
        if (!body) return json({ error: 'JSON inválido.' }, 400, origin);
        const email = normEmail(body.email);
        if (!validEmail(email)) return json({ error: 'Email inválido.' }, 400, origin);
        if (!validPassword(body.password)) return json({ error: 'A palavra-passe deve ter entre 8 e 200 caracteres.' }, 400, origin);
        if (await getUser(env, email)) return json({ error: 'Já existe uma conta com este email.' }, 409, origin);
        const user = {
          email,
          createdAt: new Date().toISOString(),
          country: request.cf && request.cf.country ? request.cf.country : 'desconhecido',
          pw: await makePassword(body.password),
          sv: 1,
          totp: null,
        };
        await putUser(env, user);
        const token = await issueSession(env, user);
        return json({ token, user: publicUser(user) }, 201, origin);
      }

      /* Iniciar sessão (1.ª etapa) */
      if (m === 'POST' && p === '/auth/login') {
        const body = await readBody(request);
        if (!body) return json({ error: 'JSON inválido.' }, 400, origin);
        const email = normEmail(body.email);
        const lock = await lockState(env, email);
        if (lock) return json({ error: 'Demasiadas tentativas. Tenta daqui a 15 minutos.' }, 429, origin);
        const user = validEmail(email) ? await getUser(env, email) : null;
        const ok = await checkPassword(String(body.password || ''), user && user.pw);
        if (!user || !ok) {
          if (email) await recordFail(env, email);
          return json({ error: 'Email ou palavra-passe incorretos.' }, 401, origin);
        }
        await clearFails(env, email);
        if (user.totp && user.totp.enabled) {
          const mfaToken = randomToken();
          await env.ACCOUNTS.put('m:' + await sha256hex(mfaToken), JSON.stringify({ email, exp: Date.now() + MFA_TTL * 1000 }), { expirationTtl: MFA_TTL });
          return json({ mfa: true, mfaToken }, 200, origin);
        }
        const token = await issueSession(env, user);
        return json({ token, user: publicUser(user) }, 200, origin);
      }

      /* Iniciar sessão (2.ª etapa, código da app) */
      if (m === 'POST' && p === '/auth/login/2fa') {
        const body = await readBody(request);
        if (!body || typeof body.mfaToken !== 'string') return json({ error: 'Pedido inválido.' }, 400, origin);
        const key = 'm:' + await sha256hex(body.mfaToken);
        const pending = await env.ACCOUNTS.get(key, 'json');
        if (!pending || pending.exp < Date.now()) return json({ error: 'A sessão de verificação expirou. Inicia sessão de novo.' }, 401, origin);
        const user = await getUser(env, pending.email);
        if (!user || !user.totp || !user.totp.enabled) return json({ error: 'Pedido inválido.' }, 400, origin);
        if (await lockState(env, pending.email)) return json({ error: 'Demasiadas tentativas. Tenta daqui a 15 minutos.' }, 429, origin);
        if (!(await verifyTotp(user.totp.secret, body.code))) {
          await recordFail(env, pending.email);
          return json({ error: 'Código incorreto.' }, 401, origin);
        }
        await env.ACCOUNTS.delete(key);
        await clearFails(env, pending.email);
        const token = await issueSession(env, user);
        return json({ token, user: publicUser(user) }, 200, origin);
      }

      /* Sessão atual */
      if (m === 'GET' && p === '/auth/me') {
        const s = await sessionFor(request, env);
        if (!s) return json({ error: 'Sessão inválida.' }, 401, origin);
        return json({ user: publicUser(s.user) }, 200, origin);
      }

      if (m === 'POST' && p === '/auth/logout') {
        const s = await sessionFor(request, env);
        if (s) await env.ACCOUNTS.delete('s:' + await sha256hex(s.tok));
        return json({ ok: true }, 200, origin);
      }

      /* Terminar sessão em todos os dispositivos */
      if (m === 'POST' && p === '/auth/logout-all') {
        const s = await sessionFor(request, env);
        if (!s) return json({ error: 'Sessão inválida.' }, 401, origin);
        s.user.sv = (s.user.sv || 1) + 1;
        await putUser(env, s.user);
        return json({ ok: true }, 200, origin);
      }

      /* Verificação em duas etapas: preparar, ativar, desativar */
      if (m === 'POST' && p === '/auth/2fa/setup') {
        const s = await sessionFor(request, env);
        if (!s) return json({ error: 'Sessão inválida.' }, 401, origin);
        if (s.user.totp && s.user.totp.enabled) return json({ error: 'A verificação já está ativa.' }, 409, origin);
        const secret = newTotpSecret();
        s.user.totp = { secret, enabled: false };
        await putUser(env, s.user);
        return json({ secret, otpauth: otpauthUri(s.user.email, secret) }, 200, origin);
      }

      if (m === 'POST' && p === '/auth/2fa/enable') {
        const s = await sessionFor(request, env);
        if (!s) return json({ error: 'Sessão inválida.' }, 401, origin);
        const body = (await readBody(request)) || {};
        if (!s.user.totp || !s.user.totp.secret) return json({ error: 'Começa por preparar a verificação.' }, 400, origin);
        if (!(await verifyTotp(s.user.totp.secret, body.code))) return json({ error: 'Código incorreto.' }, 400, origin);
        s.user.totp.enabled = true;
        await putUser(env, s.user);
        return json({ user: publicUser(s.user) }, 200, origin);
      }

      if (m === 'POST' && p === '/auth/2fa/disable') {
        const s = await sessionFor(request, env);
        if (!s) return json({ error: 'Sessão inválida.' }, 401, origin);
        const body = (await readBody(request)) || {};
        if (!s.user.totp || !s.user.totp.enabled) return json({ error: 'A verificação não está ativa.' }, 400, origin);
        if (!(await checkPassword(String(body.password || ''), s.user.pw))) return json({ error: 'Palavra-passe incorreta.' }, 401, origin);
        if (!(await verifyTotp(s.user.totp.secret, body.code))) return json({ error: 'Código incorreto.' }, 401, origin);
        s.user.totp = null;
        await putUser(env, s.user);
        return json({ user: publicUser(s.user) }, 200, origin);
      }

      /* Recuperar palavra-passe: pedir código por email */
      if (m === 'POST' && p === '/auth/reset/request') {
        const body = (await readBody(request)) || {};
        const email = normEmail(body.email);
        // Responde sempre igual, para não revelar que emails têm conta.
        if (validEmail(email) && !(await env.ACCOUNTS.get('rl:' + email))) {
          const user = await getUser(env, email);
          if (user) {
            await env.ACCOUNTS.put('rl:' + email, '1', { expirationTtl: RESET_COOLDOWN });
            const code = String(100000 + (randomBytes(4).reduce((a, b) => a * 256 + b, 0) % 900000));
            await env.ACCOUNTS.put('r:' + email, JSON.stringify({ h: await sha256hex(email + ':' + code), tries: 0, exp: Date.now() + RESET_TTL * 1000 }), { expirationTtl: RESET_TTL });
            try {
              await sendMail(env, email, 'Código para recuperar a palavra-passe',
                `O teu código do Music Tracker é ${code}.\n\nExpira em 15 minutos. Se não pediste este código, ignora este email.`);
            } catch (e) {
              console.log('reset mail error', e.message);
            }
          }
        }
        return json({ ok: true }, 200, origin);
      }

      /* Recuperar palavra-passe: confirmar código e definir nova */
      if (m === 'POST' && p === '/auth/reset/confirm') {
        const body = (await readBody(request)) || {};
        const email = normEmail(body.email);
        if (!validPassword(body.newPassword)) return json({ error: 'A palavra-passe deve ter entre 8 e 200 caracteres.' }, 400, origin);
        const user = validEmail(email) ? await getUser(env, email) : null;
        const r = await env.ACCOUNTS.get('r:' + email, 'json');
        if (!user || !r || r.exp < Date.now()) return json({ error: 'Código inválido ou expirado. Pede um novo.' }, 400, origin);
        if (r.tries >= MAX_TRIES) {
          await env.ACCOUNTS.delete('r:' + email);
          return json({ error: 'Demasiadas tentativas. Pede um novo código.' }, 429, origin);
        }
        const code = String(body.code || '');
        if (!timingSafeEq(await sha256hex(email + ':' + code), r.h)) {
          r.tries += 1;
          await env.ACCOUNTS.put('r:' + email, JSON.stringify(r), { expirationTtl: RESET_TTL });
          return json({ error: 'Código incorreto.' }, 400, origin);
        }
        if (user.totp && user.totp.enabled) {
          if (!body.totp) return json({ error: 'Falta o código da app de verificação.', needsTotp: true }, 400, origin);
          if (!(await verifyTotp(user.totp.secret, body.totp))) return json({ error: 'Código da app incorreto.', needsTotp: true }, 400, origin);
        }
        await env.ACCOUNTS.delete('r:' + email);
        user.pw = await makePassword(body.newPassword);
        user.sv = (user.sv || 1) + 1;     // termina as sessões antigas
        await putUser(env, user);
        await clearFails(env, email);
        return json({ ok: true }, 200, origin);
      }

      /* Biblioteca sincronizada */
      if (p === '/library' && (m === 'GET' || m === 'PUT')) {
        const s = await sessionFor(request, env);
        if (!s) return json({ error: 'Sessão inválida.' }, 401, origin);
        const key = 'lib:' + s.user.email;
        if (m === 'GET') {
          const raw = await env.ACCOUNTS.get(key);
          return json({ lib: raw ? JSON.parse(raw) : null }, 200, origin);
        }
        const body = await readBody(request);
        if (!body || !Array.isArray(body.lib)) return json({ error: 'Biblioteca inválida.' }, 400, origin);
        const raw = JSON.stringify(body.lib);
        if (raw.length > MAX_LIB_CHARS) return json({ error: 'Biblioteca demasiado grande.' }, 413, origin);
        await env.ACCOUNTS.put(key, raw);
        return json({ ok: true }, 200, origin);
      }

      /* Lista de contas para o admin */
      if (m === 'GET' && p === '/admin/accounts') {
        const auth = request.headers.get('Authorization') || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        if (!env.ADMIN_TOKEN || !timingSafeEq(token, env.ADMIN_TOKEN)) return json({ error: 'Não autorizado.' }, 401, origin);
        const byEmail = new Map();
        for (const prefix of ['acc:', 'u:']) {       // "acc:" são contas antigas; "u:" são as atuais (prevalecem)
          let cursor;
          do {
            const page = await env.ACCOUNTS.list({ prefix, cursor });
            for (const k of page.keys) {
              const v = await env.ACCOUNTS.get(k.name, 'json');
              if (!v) continue;
              const email = v.email;
              if (prefix === 'u:' || !byEmail.has(email)) {
                byEmail.set(email, { email, createdAt: v.createdAt, country: v.country || 'desconhecido', twoFactor: !!(v.totp && v.totp.enabled) });
              }
            }
            cursor = page.list_complete ? undefined : page.cursor;
          } while (cursor);
        }
        const accounts = [...byEmail.values()].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        return json({ total: accounts.length, accounts }, 200, origin);
      }

      return json({ error: 'Não encontrado.' }, 404, origin);
    } catch (e) {
      console.log('erro', e && e.message);
      return json({ error: 'Erro no servidor. Tenta de novo.' }, 500, origin);
    }
  },
};
