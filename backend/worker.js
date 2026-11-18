// Contas (Music Tracker): regista o email e o país de cada conta criada e mostra a lista ao admin.
// NÃO guarda palavras-passe. O país vem do cabeçalho que a Cloudflare envia (request.cf.country).
// Segredos e ligações (definir no Cloudflare): ADMIN_TOKEN (texto secreto) e a KV "ACCOUNTS".

const ALLOWED_ORIGINS = ['https://santiagomartins400-ctrl.github.io'];

function cors(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

function validEmail(e) {
  return typeof e === 'string' && e.length <= 254 && /^\S+@\S+\.\S+$/.test(e);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    // Registo de uma conta nova (chamado pela app ao criar conta)
    if (request.method === 'POST' && url.pathname === '/register') {
      if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'Origem não permitida.' }, 403, origin);
      let body;
      try { body = await request.json(); } catch (e) { return json({ error: 'JSON inválido.' }, 400, origin); }
      const email = String(body.email || '').trim().toLowerCase();
      if (!validEmail(email)) return json({ error: 'Email inválido.' }, 400, origin);
      const key = 'acc:' + email;
      const existing = await env.ACCOUNTS.get(key);
      if (!existing) {
        const record = {
          email,
          createdAt: new Date().toISOString(),
          country: request.cf && request.cf.country ? request.cf.country : 'desconhecido',
        };
        await env.ACCOUNTS.put(key, JSON.stringify(record));
      }
      return json({ ok: true }, 200, origin);
    }

    // Lista de contas para o admin
    if (request.method === 'GET' && url.pathname === '/admin/accounts') {
      const auth = request.headers.get('Authorization') || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return json({ error: 'Não autorizado.' }, 401, origin);
      const accounts = [];
      let cursor;
      do {
        const page = await env.ACCOUNTS.list({ prefix: 'acc:', cursor });
        for (const k of page.keys) {
          const v = await env.ACCOUNTS.get(k.name);
          if (v) accounts.push(JSON.parse(v));
        }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      accounts.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return json({ total: accounts.length, accounts }, 200, origin);
    }

    return json({ error: 'Não encontrado.' }, 404, origin);
  },
};
