const audio=document.getElementById('audio');
/* Definições usadas pelos cartões (carregadas antes do arranque) */
const PLAY_ICO='<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
const PAUSE_ICO='<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>';
function playBtn(a){
  if(!a||!a.id) return '';
  return `<button class="play-btn" type="button" data-play="${esc(a.id)}" aria-label="Ouvir pré-visualização de ${esc(a.title)}">${PLAY_ICO}</button>`;
}
function cardHTML(a,i=0){
  registry.set(a.id,a);
  const mine=findLib(a);
  return `<article class="card" style="animation-delay:${Math.min(i,12)*25}ms" data-open="${esc(a.id)}">${coverHTML(a)}${playBtn(a)}${mine?`<span class="badge-stars">${starsRead(mine.stars)}</span>`:''}<div class="meta"><h3>${esc(a.title)}</h3><p>${esc(a.artist)}${a.year?' · '+esc(a.year):''}</p></div></article>`;
}
function topItems(list){
  return list.map(x=>{ const id='top-'+x.artist+'|'+x.title; return {id,sourceId:id,artist:x.artist,title:x.title,type:'Album',genre:x.genre||'',year:null,cover:x.cover||'',tracks:0,rgid:null}; });
}

/* ===== Biblioteca: filtros por década e nota, estatísticas por género e década ===== */
function libDecade(a){ const y=+a.year; return y ? Math.floor(y/10)*10 : null; }
function renderLibFilters(){
  const dsel=document.getElementById('ldecade'); if(!dsel) return;
  const dv=dsel.value||'all';
  const ds=[...new Set(db.map(libDecade).filter(x=>x!==null))].sort((a,b)=>a-b);
  dsel.innerHTML='<option value="all">Todas as décadas</option>'+ds.map(d=>`<option value="${d}">${d}s</option>`).join('');
  dsel.value = (dv==='all' || ds.includes(+dv)) ? dv : 'all';
}
function renderBreakdown(){
  const el=document.getElementById('breakdown'); if(!el) return;
  const cnt=fn=>{ const c={}; db.forEach(a=>{ const k=fn(a); if(k) c[k]=(c[k]||0)+1; }); return Object.entries(c); };
  const bars=(title,items)=>{
    const top=[...items].sort((a,b)=>b[1]-a[1]).slice(0,8);
    const max=Math.max(1,...top.map(x=>x[1]));
    return `<div class="bd"><h3>${title}</h3>${top.length ? top.map(([k,v])=>`<div class="bd-row"><span title="${esc(k)}">${esc(k)}</span><div class="bd-bar"><i style="width:${(v/max*100).toFixed(0)}%"></i></div><b>${v}</b></div>`).join('') : '<p>Sem dados ainda.</p>'}</div>`;
  };
  const dec=cnt(a=>{ const d=libDecade(a); return d===null?null:d+'s'; }).sort((a,b)=>parseInt(a[0])-parseInt(b[0]));
  el.innerHTML = bars('Por género', cnt(a=>a.genre||'Sem género')) + bars('Por década', dec);
}

const KEY = 'album-critico-v3';
const OLD_KEY = 'album-critico-v2';
const SUGGESTIONS = ['Fado','Hip hop','Rock','Jazz','Pop','Música clássica','Eletrónica','Reggaeton','Kizomba','Samba','Metal','Sertanejo'];

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// fetch com tempo limite: evita que a interface fique presa com a rede lenta
const fetchT = (url, opts = {}, ms = 8000) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(t)); };
const uid = () => Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const fmt = n => Number(n).toFixed(1);
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));

/* ---------- Armazenamento ---------- */
function seed(){
  const now=Date.now();
  return [
    {id:uid(),sourceId:'',artist:'Radiohead',title:'OK Computer',year:'1997',genre:'Alternative',cover:'',tracks:0,fav:true,stars:4.5,createdAt:now-3000,
     review:'Um disco que parece um aviso sobre o futuro e continua a soar atual.'},
    {id:uid(),sourceId:'',artist:'Frank Ocean',title:'Blonde',year:'2016',genre:'R&B/Soul',cover:'',tracks:0,fav:false,stars:4,createdAt:now-2000,
     review:'Intimista e fragmentado, com produção minimalista que deixa espaço para a emoção.'}
  ];
}
function migrate(a){
  const v=Object.values(a.criteria||{}); const m=v.length?v.reduce((s,x)=>s+x,0)/v.length:0;
  const {criteria, ...rest}=a;
  return {...rest, stars: Math.round(m/2*2)/2};
}
/* ---------- Contas (locais, neste navegador) ---------- */
const ACC_KEY = 'album-critico-accounts';
// URL do servidor de contas (pasta backend/). Vazio = ainda não ligado.
var ACCOUNTS_API = '';
const SESS_KEY = 'album-critico-session';
function getAccounts(){ try{ return JSON.parse(localStorage.getItem(ACC_KEY))||{}; }catch(e){ return {}; } }
function setAccounts(acc){ try{ localStorage.setItem(ACC_KEY, JSON.stringify(acc)); }catch(e){} }
function currentUser(){ try{ return localStorage.getItem(SESS_KEY)||''; }catch(e){ return ''; } }
/* ---------- Conta no servidor (ativa quando ACCOUNTS_API estiver preenchido) ---------- */
const TOKEN_KEY = 'album-critico-token';
var acctUser = null;                        // { email, twoFactor } da sessão atual
const serverMode = () => !!ACCOUNTS_API;
function getToken(){ try{ return localStorage.getItem(TOKEN_KEY)||''; }catch(e){ return ''; } }
function setToken(t){ try{ if(t) localStorage.setItem(TOKEN_KEY,t); else localStorage.removeItem(TOKEN_KEY); }catch(e){} }
async function acctApi(path, o={}){
  const h={'content-type':'application/json'};
  if(o.auth && getToken()) h.Authorization='Bearer '+getToken();
  let r;
  try{ r = await fetchT(ACCOUNTS_API+path, {method:o.method||'GET', headers:h, body:o.body?JSON.stringify(o.body):undefined}, 10000); }
  catch(e){ return {ok:false, status:0, data:{error:'Sem ligação ao servidor. Tenta de novo.'}}; }
  let data={}; try{ data = await r.json() || {}; }catch(e){}
  return {ok:r.ok, status:r.status, data};
}
var syncTimer = null;
function scheduleSync(){
  if(!serverMode() || !getToken() || !currentUser()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(pushLibrary, 1500);
}
async function pushLibrary(){
  if(!getToken()) return;
  const r = await acctApi('/library', {method:'PUT', auth:true, body:{lib:db}});
  if(r.status===401) sessionEnded();
}
async function pullLibrary(){
  if(!getToken()) return;
  const r = await acctApi('/library', {auth:true});
  if(r.status===401){ sessionEnded(); return; }
  if(!r.ok) return;                         // sem rede: fica a biblioteca local
  if(Array.isArray(r.data.lib)){
    db = r.data.lib;
    try{ localStorage.setItem(libKey(), JSON.stringify(db)); }catch(e){}
    refreshAll();
  } else if(db.length){
    await pushLibrary();                    // primeira vez nesta conta: sobe a biblioteca local
  }
}
function sessionEnded(){
  setToken(''); acctUser = null;
  try{ localStorage.removeItem(SESS_KEY); }catch(e){}
  db = load(); refreshAccountButton(); refreshSpotifyButton(); refreshAll(); refreshAccountSection();
  toast('A sessão terminou. Inicia sessão de novo.');
}
async function restoreSession(){
  if(!serverMode() || !getToken()) return;
  const r = await acctApi('/auth/me', {auth:true});
  if(r.status===401){ sessionEnded(); return; }
  if(!r.ok) return;                         // sem rede: mantém a sessão local
  acctUser = r.data.user;
  try{ localStorage.setItem(SESS_KEY, acctUser.email); }catch(e){}
  db = load(); await pullLibrary();
  refreshAccountButton(); refreshSpotifyButton(); refreshAccountSection();
}
function libKey(){ const u=currentUser(); return u ? `${KEY}:${u}` : KEY; }
async function hashPw(pw, salt){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt+':'+pw));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function load(){
  const k=libKey();
  try{ const d=JSON.parse(localStorage.getItem(k)); if(Array.isArray(d)) return d; }catch(e){}
  if(k!==KEY) return [];
  try{ const o=JSON.parse(localStorage.getItem(OLD_KEY)); if(Array.isArray(o)) return o.map(migrate); }catch(e){}
  return seed();
}
let db = load();
function persist(){ try{ localStorage.setItem(libKey(), JSON.stringify(db)); }catch(e){} scheduleSync(); }

var playlists=[], libPl=null, queue=[], qIndex=-1, qAlbum=null, shuffleOn=false;
const registry = new Map();
const findLib = a => db.find(x => x.id===a.id || (a.sourceId && x.sourceId===a.sourceId));

/* ---------- Estrelas ---------- */
function starsRead(v, cls=''){
  let h=`<span class="stars ${cls}" aria-label="${fmt(v)} de 5">`;
  for(let i=1;i<=5;i++){ const p=clamp(v-(i-1),0,1)*100; h+=`<span class="g" style="--f:${p}%">★</span>`; }
  return h+'</span>';
}
function starsInput(){
  let h='<div class="rate-stars" id="rateStars">';
  for(let i=1;i<=5;i++){
    h+=`<span class="sw"><span class="g" style="--f:0%">★</span><button type="button" class="hit l" data-v="${i-0.5}" aria-label="${fmt(i-0.5)}"></button><button type="button" class="hit r" data-v="${i}" aria-label="${fmt(i)}"></button></span>`;
  }
  return h+'</div>';
}

/* ---------- Capas ---------- */
function coverHTML(a){
  const img = a.cover ? `<img loading="lazy" decoding="async" src="${esc(a.cover)}" alt="${esc(a.title)}" onerror="this.remove()">` : '';
  return `<div class="cover">${img}</div>`;
}

/* ---------- Catálogo (MusicBrainz: país de origem do artista) ---------- */
let catalog = [];
let catTab = 'Album';
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const MB = 'https://musicbrainz.org/ws/2';
async function mbGet(path){
  for(let t=0;t<2;t++){
    const r = await fetchT(MB + path);
    if(r.ok) return r.json();
    if((r.status===503 || r.status===429) && t===0){ await sleep(1600); continue; }
    throw new Error('MusicBrainz ' + r.status);
  }
}
function rgNormalize(g, fallback){
  const artist = (g['artist-credit']||[]).map(c=>c.name + (c.joinphrase||'')).join('') || fallback;
  return {
    id:'mb-'+g.id, sourceId:'mb-'+g.id, rgid:g.id,
    artist, title:g.title||'', year:(g['first-release-date']||'').slice(0,4),
    type:g['primary-type']||'Album', genre:'',
    cover:`https://coverartarchive.org/release-group/${g.id}/front-500`, tracks:0
  };
}
let catSuggest = false;
function mixByGenre(list){
  const buckets = new Map();
  list.forEach(x=>{ const g = x.genre || 'Outros'; if(!buckets.has(g)) buckets.set(g,[]); buckets.get(g).push(x); });
  const groups = [...buckets.values()], out = [];
  for(let i=0; out.length < list.length; i++) groups.forEach(gr=>{ if(i<gr.length) out.push(gr[i]); });
  return out;
}
let chartsReq = null;
function fetchCharts(){
  if(chartsData) return Promise.resolve(chartsData);
  if(!chartsReq) chartsReq = fetch('data/charts.json').then(r=>r.json()).then(d=>(chartsData=d)).catch(()=>{ chartsReq=null; return null; });
  return chartsReq;
}
function getCharts(){ return fetchCharts(); }
async function loadSuggestions(){
  setStatus('A carregar os álbuns mais populares…');
  $('#catGrid').innerHTML=skeletons(8);
  const d = await getCharts();
  const list = d?.global?.albums || [];
  if(!list.length){
    catalog=[]; renderCatalog();
    setStatus('Escreve um artista ou álbum para pesquisar.');
    return;
  }
  catSuggest = true;
  catalog = mixByGenre(list).map(x=>({
    id:'top-'+x.artist+'|'+x.title, sourceId:'top-'+x.artist+'|'+x.title,
    title:x.title, artist:x.artist, type:'Album', rgid:null,
    year:null, cover:x.cover, tracks:0
  }));
  catalog.forEach(x=>registry.set(x.id,x));
  renderCatalog();
  setStatus('Sugestões: os álbuns mais populares da semana · escreve acima para pesquisar');
}
const normTxt = x => (x||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
async function searchCatalog(term){
  const q=(term ?? $('#cq').value).trim().replace(/"/g,'');
  $('#cq').value=q;
  if(!q){ loadSuggestions(); return; }
  const cacheKey='music-tracker-search-v4:'+new Date().toISOString().slice(0,10)+':'+q.toLowerCase();
  let cached=null;
  try{ cached=JSON.parse(localStorage.getItem(cacheKey)||'null'); }catch(e){}
  if(cached){
    catSuggest=true; catalog=cached; cached.forEach(x=>registry.set(x.id,x));
    renderCatalog(); setStatus(`${cached.length} lançamentos para “${q}” · fonte: MusicBrainz`);
    return;
  }
  catSuggest=true; catalog=[]; renderCatalog();
  $('#catGrid').innerHTML=skeletons(8);
  setStatus(`A procurar “${q}”…`);
  try{
    // Um só pedido: artistas e títulos com o termo, só álbuns, EPs e singles (sem compilações, ao vivo, etc.).
    const query=`(artist:"${q}" OR releasegroup:"${q}") AND (primarytype:album OR primarytype:ep OR primarytype:single) AND NOT secondarytype:*`;
    const d=await mbGet(`/release-group/?query=${encodeURIComponent(query)}&limit=100&fmt=json`);
    const nq=normTxt(q), seen=new Map();
    (d['release-groups']||[]).forEach(g=>{
      const x=rgNormalize(g,'');
      // Só o que é mesmo do artista, ou um título igual ao que foi pesquisado
      const artistOk = normTxt(x.artist).includes(nq);
      const titleOk = normTxt(x.title) === nq;
      if(!artistOk && !titleOk) return;
      // Sem bootlegs nem promos (lançamentos não oficiais)
      const rel = g.releases || [];
      if(rel.length && rel.every(r=>r.status==='Bootleg' || r.status==='Promotion')) return;
      const key=(normTxt(x.artist)+'|'+normTxt(x.title)+'|'+x.type);
      const prev=seen.get(key);
      if(!prev || (x.year && (!prev.year || x.year<prev.year))) seen.set(key,x);
    });
    const all=[...seen.values()].sort((a,b)=>a.artist.localeCompare(b.artist,'pt')||((+a.year||9999)-(+b.year||9999))||(a.title||'').localeCompare(b.title||'','pt'));
    try{ localStorage.setItem(cacheKey, JSON.stringify(all)); }catch(e){}
    catalog=all; all.forEach(x=>registry.set(x.id,x));
    renderCatalog();
    setStatus(all.length ? `${all.length} lançamentos para “${q}” · fonte: MusicBrainz` : `Nenhum resultado para “${q}”. Experimenta outro termo.`);
  }catch(e){
    renderCatalog();
    setStatus(`Não foi possível obter resultados (${e.message || 'erro desconhecido'}). Tenta de novo daqui a um minuto.`);
  }
}
function renderCatalog(){
  const count=t=>catalog.filter(a=>a.type===t).length;
  ['Album','EP','Single'].forEach(t=>{ const el=$('#cnt-'+t); if(el) el.textContent=count(t)?`(${count(t)})`:''; });
  document.querySelectorAll('[data-ct]').forEach(b=>b.classList.toggle('on', b.dataset.ct===catTab));
  if(catTab==='Artist'||catTab==='Song'){ renderExtra(); return; }
  if(!catalog.length){
    $('#catGrid').innerHTML=`<div class="empty"><b>Pesquisa um artista ou álbum</b>Os resultados aparecem aqui.</div>`;
    return;
  }
  const list=catalog.filter(a=>a.type===catTab).sort((a,b)=>catSuggest ? 0 : (b.year||0)-(a.year||0)||(a.title||'').localeCompare(b.title||'','pt'));
  const label={Album:'álbuns',EP:'EPs',Single:'singles'}[catTab];
  if(!list.length){ $('#catGrid').innerHTML=`<div class="empty"><b>Sem ${label} nesta pesquisa</b>Experimenta outro separador.</div>`; return; }
  const card=(a,i)=>{
    registry.set(a.id,a);
    const mine=findLib(a);
    return `<article class="card" style="animation-delay:${Math.min(i,12)*25}ms" data-open="${esc(a.id)}">
      ${coverHTML(a)}${playBtn(a)}
      ${mine?`<span class="badge-stars">${starsRead(mine.stars)}</span>`:''}
      <div class="meta"><h3>${esc(a.title||'')}</h3><p>${esc(a.artist||'')}${a.year?' · '+esc(a.year):''}</p>
        <span class="tag">${({Album:'Álbum',EP:'EP',Single:'Single'})[a.type]||esc(a.type||'')}</span></div>
    </article>`;
  };
  if(catSuggest){ $('#catGrid').innerHTML=list.map(card).join(''); return; }
  // Pesquisa: agrupado por ano, do mais recente para o mais antigo; sem data no fim
  const groups=new Map();
  list.forEach(a=>{ const k=a.year?String(a.year):'Sem data'; if(!groups.has(k)) groups.set(k,[]); groups.get(k).push(a); });
  let idx=0;
  $('#catGrid').innerHTML=[...groups.entries()].map(([year,items])=>
    `<div class="grp-title">${esc(year)} <small>${items.length} ${items.length===1?({Album:'álbum',EP:'EP',Single:'single'})[catTab]:label}</small></div>`+items.map(a=>card(a,idx++)).join('')
  ).join('');
}
function setStatus(t){ $('#status').textContent=t; }
function skeletons(n){
  return Array.from({length:n},()=>`<div class="card"><div class="cover skel"></div><div class="meta"><h3>&nbsp;</h3><p>&nbsp;</p></div></div>`).join('');
}

/* ---------- Capas e artes (Cover Art Archive) ---------- */
async function findRgid(a){
  const j = await mbGet(`/release-group/?query=${encodeURIComponent(`artist:"${a.artist}" AND releasegroup:"${a.title}"`)}&fmt=json&limit=3`);
  return (j['release-groups']||[])[0]?.id || null;
}
async function loadCovers(a){
  const rgid = a.rgid || await findRgid(a);
  if(!rgid) return [];
  const r = await fetchT(`https://coverartarchive.org/release-group/${rgid}`);
  if(!r.ok) return [];
  const ca = await r.json();
  return (ca.images||[]).map(img=>({
    src: img.thumbnails?.large || img.image,
    page: img.image,
    title: (img.types||[]).join(' · ') || 'Capa'
  }));
}

/* ---------- Biblioteca ---------- */
function renderStats(){
  if(typeof renderLibFilters==='function') renderLibFilters();
  if(typeof renderBreakdown==='function') renderBreakdown();
  const n=db.length, rated=db.filter(a=>a.stars>0);
  const mean=rated.length?rated.reduce((s,a)=>s+a.stars,0)/rated.length:0;
  const best=rated.length?[...rated].sort((a,b)=>b.stars-a.stars)[0]:null;
  $('#stats').innerHTML=`
    <div class="stat"><small>Álbuns avaliados</small><b>${n}</b><span>${db.filter(a=>a.fav).length} favoritos</span></div>
    <div class="stat"><small>Média</small><b>${rated.length?fmt(mean):'—'} <span style="font-size:1rem;color:var(--muted)">/ 5</span></b><span>${rated.length?starsRead(mean):''}</span></div>
    <div class="stat"><small>Melhor avaliado</small><b title="${esc(best?.title)}">${best?esc(best.title):'—'}</b><span>${best?esc(best.artist)+' · '+fmt(best.stars)+' / 5':''}</span></div>
    <div class="stat"><small>Artista mais ouvido</small><b>${(()=>{const c={};db.forEach(a=>c[a.artist]=(c[a.artist]||0)+1);const t=Object.entries(c).sort((a,b)=>b[1]-a[1])[0];return t?esc(t[0]):'—';})()}</b><span></span></div>`;
}
function renderLibGenres(){
  const cur=$('#lgenre').value||'all';
  const gs=[...new Set(db.map(a=>a.genre).filter(Boolean))].sort();
  $('#lgenre').innerHTML=`<option value="all">Todos os géneros</option>`+gs.map(g=>`<option ${g===cur?'selected':''}>${esc(g)}</option>`).join('');
}
function renderLibrary(){
  loadPlaylists(); renderPlaylistBar();
  const q=$('#q').value.trim().toLowerCase(), g=$('#lgenre').value;
  const cmp={
    'stars-desc':(a,b)=>b.stars-a.stars,'stars-asc':(a,b)=>a.stars-b.stars,'recent':(a,b)=>b.createdAt-a.createdAt,
    'year-desc':(a,b)=>(+b.year||0)-(+a.year||0),'year-asc':(a,b)=>(+a.year||0)-(+b.year||0),
    'artist':(a,b)=>a.artist.localeCompare(b.artist,'pt'),'fav':(a,b)=>(b.fav-a.fav)||(b.stars-a.stars)
  }[$('#sort').value];
  const favOnly=$('#favOnly').checked;
  const dsel=document.getElementById('ldecade'), msel=document.getElementById('lmin');
  const dec=(dsel&&dsel.value)||'all', minS=+((msel&&msel.value)||0);
  const plIds=libPl?new Set(((playlists.find(x=>x.id===libPl))||{ids:[]}).ids):null;
  const list=db.filter(a=>(!plIds||plIds.has(a.id))&&(!favOnly||a.fav)&&(g==='all'||a.genre===g)&&(dec==='all'||libDecade(a)===+dec)&&(a.stars>=minS)&&(!q||[a.artist,a.title,a.genre,a.review].join(' ').toLowerCase().includes(q))).sort(cmp);
  if(!db.length){ $('#libGrid').innerHTML=`<div class="empty"><b>A biblioteca está vazia</b>Pesquisa no catálogo, escolhe um álbum e avalia-o com estrelas.</div>`; return; }
  if(!list.length){ $('#libGrid').innerHTML=`<div class="empty"><b>Nada encontrado</b>Experimenta outra pesquisa ou filtro.</div>`; return; }
  $('#libGrid').innerHTML=list.map((a,i)=>{
    registry.set(a.id,a);
    return `<article class="card" style="animation-delay:${Math.min(i,12)*25}ms" data-open="${esc(a.id)}">
      ${coverHTML(a)}${playBtn(a)}
      ${a.fav?'<span class="fav">★</span>':''}
      <span class="badge-stars">${a.stars?starsRead(a.stars)+' '+fmt(a.stars):'Por avaliar'}</span>
      <div class="meta"><h3>${esc(a.title)}</h3><p>${esc(a.artist)}${a.year?' · '+esc(a.year):''}</p>
        ${a.genre?`<span class="tag">${esc(a.genre)}</span>`:''}</div>
    </article>`;
  }).join('');
}
function renderAllLibrary(){ renderStats(); renderLibGenres(); renderLibrary(); }
function refreshAll(){ loadPlaylists(); renderPlaylistBar(); renderCatalog(); renderAllLibrary(); }

/* ---------- Modais ---------- */
function openModal(html){ $('#modal').classList.remove('auth-glow'); $('#modal').innerHTML=html; $('#overlay').classList.add('open'); }
function closeModal(){ if(window.authGate && !currentUser()) return; $('#overlay').classList.remove('open'); $('#modal').innerHTML=''; }

function openAlbum(id){
  const a=registry.get(id)||db.find(x=>x.id===id)||catalog.find(x=>x.id===id);
  if(!a) return;
  const mine=findLib(a);
  const extra = mine ? `
    <div class="big">${fmt(mine.stars)}<small> / 5</small></div>
    <div>${starsRead(mine.stars,'lg')}</div>` : '';
  const review = mine ? `<div class="review ${mine.review?'':'muted'}">${mine.review?esc(mine.review):'Sem review escrita.'}</div>` : '';
  const actions = mine
    ? `<button class="btn primary" data-rate="${esc(a.id)}">Editar avaliação</button>
       <button class="btn" data-fav="${mine.id}">${mine.fav?'★ Remover favorito':'☆ Favorito'}</button>
       <button class="btn danger" data-del="${mine.id}" style="margin-left:auto">Remover da biblioteca</button>`
    : `<button class="btn primary" data-rate="${esc(a.id)}">Avaliar e adicionar à biblioteca</button>`;
  openModal(`
    <div class="mhead"><h2>Álbum</h2><button class="x" data-close aria-label="Fechar">×</button></div>
    <div class="mbody">
      <div class="dlayout">
        <div class="dcover">${coverHTML(a)}</div>
        <div class="dinfo">
          <h2>${esc(a.title)}</h2>
          <div class="artist">${esc(a.artist)}</div>
          <div class="sub">${[a.year,a.genre].filter(Boolean).map(esc).join(' · ')}</div>
          ${extra}
        </div>
      </div>
      ${review}
      <div class="actions">${actions}${plSelectHTML(a)}</div>
      <div class="gal-title">Faixas <small>iTunes</small></div>
      <div class="trk-tools"><button class="btn primary" type="button" data-playall="1">▶ Tocar álbum</button><button class="btn ghost" type="button" data-shuffle="1">🔀 Aleatório</button></div>
      <div class="tracks" id="tracks" data-aid="${esc(a.id)}">${Array.from({length:5},()=>'<div class="skel trk-skel"></div>').join('')}</div>
      <div class="gal-title">Capas e artes <small>Cover Art Archive</small></div>
      <div class="gallery" id="gallery">${Array.from({length:6},()=>'<div class="skel"></div>').join('')}</div>
    </div>`);
  loadCovers(a).then(list=>{
    if(!list.length && a.cover) list=[{src:a.cover,page:a.cover,title:a.title}];
    const g=$('#gallery'); if(!g) return;
    g.innerHTML = list.length
      ? list.map(p=>`<a href="${esc(p.page)}" target="_blank" rel="noopener" title="${esc(p.title)}"><img loading="lazy" src="${esc(p.src)}" alt="${esc(p.title)}" onerror="this.parentElement.remove()"></a>`).join('')
      : `<div class="empty" style="grid-column:1/-1;padding:30px">Sem capas disponíveis para este álbum.</div>`;
  }).catch(()=>{
    const g=$('#gallery'); if(g) g.innerHTML=`<div class="empty" style="grid-column:1/-1;padding:30px">Não foi possível carregar as capas.</div>`;
  });
  loadTracks(a);
  document.getElementById('modal').style.setProperty('--hero', a.cover?`url("${String(a.cover).replace(/["\\)]/g,'')}")`:'none');
}

/* Confirmação dentro da app (substitui a caixa nativa do Windows) */
function askConfirm(o){
  document.querySelectorAll('.cf-overlay').forEach(x=>x.remove());
  const ov=document.createElement('div');
  ov.className='overlay cf-overlay open';
  ov.innerHTML=`<div class="cf-box" role="alertdialog" aria-modal="true" aria-labelledby="cfT">
    <div class="cf-ico${o.danger?' danger':''}" aria-hidden="true">${o.danger?'🗑':'?'}</div>
    <h3 id="cfT">${esc(o.title)}</h3>
    <p>${esc(o.text||'')}</p>
    <div class="cf-actions">
      <button class="btn" data-cf="no">Cancelar</button>
      <button class="btn ${o.danger?'danger':'primary'}" data-cf="yes">${esc(o.ok||'OK')}</button>
    </div></div>`;
  const close=()=>{ ov.remove(); document.removeEventListener('keydown',onKey,true); };
  const onKey=e=>{ if(e.key==='Escape'){ e.preventDefault(); e.stopImmediatePropagation(); close(); } };
  ov.addEventListener('click',e=>{
    if(e.target===ov || e.target.closest('[data-cf="no"]')) return close();
    if(e.target.closest('[data-cf="yes"]')){ close(); if(o.onOk) o.onOk(); }
  });
  document.addEventListener('keydown',onKey,true);
  document.body.appendChild(ov);
  setTimeout(()=>{ const b=ov.querySelector('[data-cf="yes"]'); if(b) b.focus(); },30);
}

/* Faixas do álbum (iTunes): só a edição cujo nome e artista batem com o álbum */
const trackCache=new Map();
const normT=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g,' ').replace(/[^a-z0-9]+/g,' ').trim();
const trkDur=ms=>{ if(!ms) return ''; const t=Math.round(ms/1000); return Math.floor(t/60)+':'+String(t%60).padStart(2,'0'); };
async function fetchTracks(a){
  const dk='music-tracker-tracks2:'+new Date().toISOString().slice(0,10)+':'+a.id;
  if(trackCache.has(a.id)) return trackCache.get(a.id);
  try{ const hit=JSON.parse(localStorage.getItem(dk)||'null'); if(hit){ trackCache.set(a.id,hit); return hit; } }catch(e){}
  const term=`${a.artist||''} ${a.title||''}`.trim();
  const want=normT(a.title), artist=normT(a.artist);
  const artistOk=n=>{ const x=normT(n); return !artist || x.includes(artist) || artist.includes(x); };
  const getJSON=async url=>{ const r=await fetchT(url); if(!r.ok) throw new Error('itunes '+r.status); return r.json(); };
  let list=[];
  // 1) encontrar a edição do álbum e pedir TODAS as faixas dessa edição
  const sj=await getJSON(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&limit=25&country=pt`);
  const albums=(sj.results||[]).filter(x=>x.wrapperType==='collection' && x.collectionName && artistOk(x.artistName) && normT(x.collectionName)===want);
  albums.sort((x,y)=>(y.trackCount||0)-(x.trackCount||0));
  if(albums.length){
    const lj=await getJSON(`https://itunes.apple.com/lookup?id=${albums[0].collectionId}&entity=song&country=pt`);
    list=(lj.results||[]).filter(x=>x.wrapperType==='track' && x.trackName);
  }
  // 2) reserva: pesquisa de músicas, filtrada pelo nome do álbum
  if(!list.length){
    const sg=await getJSON(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=200&country=pt`);
    const pool=(sg.results||[]).filter(x=>x.wrapperType==='track' && x.collectionName && artistOk(x.artistName));
    const match=pool.filter(x=>normT(x.collectionName)===want);
    const counts={}; match.forEach(x=>{ counts[x.collectionId]=(counts[x.collectionId]||0)+1; });
    const best=Object.keys(counts).sort((p,q)=>counts[q]-counts[p])[0];
    list=best ? match.filter(x=>String(x.collectionId)===best) : [];
  }
  // ordenar e remover duplicados (versões explícitas/limpas)
  const seen=new Set();
  list=list.sort((p,q)=>((p.discNumber||1)-(q.discNumber||1)) || ((p.trackNumber||0)-(q.trackNumber||0)))
    .filter(x=>{ if(!x.trackNumber) return true; const k=(x.discNumber||1)+'-'+x.trackNumber; if(seen.has(k)) return false; seen.add(k); return true; });
  trackCache.set(a.id,list);
  try{ localStorage.setItem(dk, JSON.stringify(list)); }catch(e){}
  return list;
}
function renderTracks(a,list){
  const box=$('#tracks'); if(!box || box.dataset.aid!==String(a.id)) return;
  if(!list.length){ box.innerHTML='<div class="empty" style="padding:26px">Não encontrámos a lista de faixas deste álbum.</div>'; return; }
  box.innerHTML=list.map((t,i)=>`
    <div class="trk">
      <span class="trk-n">${t.trackNumber||i+1}</span>
      <button class="trk-play" data-track="${i}" ${t.previewUrl?'':'disabled'} aria-label="Reproduzir ${esc(t.trackName)}">${t.previewUrl?PLAY_ICO:'—'}</button>
      <span class="trk-name">${esc(t.trackName)}</span>
      <span class="trk-dur">${trkDur(t.trackTimeMillis)}</span>
    </div>`).join('');
  box._album=a; box._list=list;
}
function loadTracks(a){
  fetchTracks(a).then(list=>renderTracks(a,list)).catch(()=>{
    const box=$('#tracks'); if(box && box.dataset.aid===String(a.id)) box.innerHTML='<div class="empty" style="padding:26px">Não foi possível carregar as faixas agora.</div>';
  });
}
function playTrack(a,t){
  if(!a||!t||!t.previewUrl) return;
  nowItem=null;
  const item={title:t.trackName, artist:a.artist, cover:a.cover};
  showPlayer(item,'A carregar pré-visualização…'); setPlaying(false);
  audio.src=t.previewUrl;
  audio.play().then(()=>showPlayer(item,'Pré-visualização · '+t.trackName)).catch(()=>showPlayer(item,'Não foi possível tocar agora.'));
}

/* ===== v9: reprodução em fila, playlists próprias, cor da app ===== */
function setShuffle(on){ shuffleOn=!!on; const b=$('#pShuf'); if(b){ b.setAttribute('aria-pressed', shuffleOn?'true':'false'); b.classList.toggle('on', shuffleOn); } }
function setQueue(a, list, start){
  qAlbum=a; queue=list.filter(t=>t.previewUrl);
  if(!queue.length){ showPlayer(a,'Sem pré-visualizações para este álbum.'); return; }
  const idx=queue.indexOf(list[start]); playQueueAt(idx>=0?idx:0);
}
function playQueueAt(i){
  if(i<0||i>=queue.length) return;
  qIndex=i; const t=queue[i];
  const item={title:t.trackName, artist:qAlbum?qAlbum.artist:'', cover:qAlbum?qAlbum.cover:''};
  nowItem=null; showPlayer(item, `Faixa ${i+1} de ${queue.length} · pré-visualização`);
  setPlaying(false); audio.src=t.previewUrl;
  audio.play().catch(()=>showPlayer(item,'Não foi possível tocar agora.'));
}
function nextTrack(){
  if(!queue.length) return;
  if(shuffleOn && queue.length>1){ let n; do{ n=Math.floor(Math.random()*queue.length); }while(n===qIndex); return playQueueAt(n); }
  if(qIndex+1>=queue.length){ setPlaying(false); return; }
  playQueueAt(qIndex+1);
}
function prevTrack(){ if(!queue.length) return; if(audio.currentTime>3){ audio.currentTime=0; return; } playQueueAt(Math.max(0,qIndex-1)); }
audio.addEventListener('ended', ()=>{ if(queue.length) nextTrack(); });
$('#pPrev').addEventListener('click', prevTrack);
$('#pNext').addEventListener('click', nextTrack);
$('#pShuf').addEventListener('click', ()=>setShuffle(!shuffleOn));

function plKey(){ const u=currentUser(); return u?`album-critico-playlists:${u}`:'album-critico-playlists'; }
function loadPlaylists(){ try{ playlists=JSON.parse(localStorage.getItem(plKey())||'[]'); }catch(e){ playlists=[]; } if(libPl && !playlists.some(p=>p.id===libPl)) libPl=null; }
function savePlaylists(){ try{ localStorage.setItem(plKey(), JSON.stringify(playlists)); }catch(e){} }
function renderPlaylistBar(){
  const bar=$('#plBar'); if(!bar) return;
  bar.innerHTML = playlists.map(p=>`<button class="plc${libPl===p.id?' on':''}" type="button" data-plc="${esc(p.id)}"><b>♪ ${esc(p.name)}</b><small>${p.ids.length} ${p.ids.length===1?'álbum':'álbuns'}</small></button>`).join('')
    + `<button class="plc plc-new" type="button" data-plnew="1">+ Nova playlist</button>`
    + (libPl ? `<button class="plc plc-del" type="button" data-pldel="${esc(libPl)}">Apagar esta playlist</button>` : '');
}
function newPlaylist(){
  openModal(`<div class="mhead"><h2>Nova playlist</h2><button class="x" type="button" data-close aria-label="Fechar">✕</button></div>
    <form class="mbody" id="plForm" autocomplete="off"><label class="pl-label">Nome<input id="plName" maxlength="40" required placeholder="Ex.: Para o treino"></label>
    <div class="actions"><button class="btn primary" type="submit">Criar</button></div></form>`);
  $('#plName').focus();
  $('#plForm').addEventListener('submit', e=>{
    e.preventDefault(); const n=$('#plName').value.trim(); if(!n) return;
    playlists.push({id:'pl'+Date.now().toString(36), name:n, ids:[]}); savePlaylists(); closeModal(); renderPlaylistBar(); toast('Playlist criada');
  });
}
function plSelectHTML(a){
  if(!playlists.length) return '';
  const inList = !!libPl && (playlists.find(p=>p.id===libPl)||{ids:[]}).ids.includes(a.id);
  return `<select class="pl-add" data-pladd="${esc(a.id)}" aria-label="Adicionar a playlist"><option value="">+ Playlist</option>${playlists.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}${p.ids.includes(a.id)?' ✓':''}</option>`).join('')}</select>`
    + (inList ? `<button class="btn ghost" type="button" data-plrm="${esc(libPl)}" data-plrmid="${esc(a.id)}">Tirar desta playlist</button>` : '');
}
function removeFromPl(plId, albumId){
  const p=playlists.find(x=>x.id===plId); if(!p) return;
  p.ids=p.ids.filter(x=>x!==albumId); savePlaylists(); closeModal(); renderPlaylistBar(); renderLibrary(); toast('Removido da playlist');
}
$('#overlay').addEventListener('change', e=>{
  const sel=e.target.closest('.pl-add'); if(!sel||!sel.value) return;
  const p=playlists.find(x=>x.id===sel.value); const id=sel.dataset.pladd;
  if(p && !p.ids.includes(id)){ p.ids.push(id); savePlaylists(); toast(`Adicionado a “${p.name}”`); }
  else if(p) toast('Já está nesta playlist');
  sel.value='';
});
$('#plBar').addEventListener('click', e=>{
  if(e.target.closest('[data-plnew]')) return newPlaylist();
  const c=e.target.closest('[data-plc]');
  if(c){ libPl = libPl===c.dataset.plc ? null : c.dataset.plc; renderPlaylistBar(); renderLibrary(); return; }
  const d=e.target.closest('[data-pldel]');
  if(d) askConfirm({title:'Apagar playlist', text:'A playlist é apagada. Os álbuns continuam na biblioteca.', ok:'Apagar', danger:true, onOk:()=>{ playlists=playlists.filter(p=>p.id!==d.dataset.pldel); libPl=null; savePlaylists(); renderPlaylistBar(); renderLibrary(); toast('Playlist apagada'); }});
});

const THEMES={azul:['#0071e3','#2997ff'], violeta:['#8b5cf6','#ec4899'], oceano:['#06b6d4','#3b82f6'], sol:['#f97316','#ef4444'], menta:['#10b981','#84cc16']};
function applyTheme(name){
  const t=THEMES[name]||THEMES.azul;
  document.documentElement.style.setProperty('--accent',t[0]);
  document.documentElement.style.setProperty('--accent2',t[1]);
  document.querySelectorAll('[data-theme]').forEach(b=>b.setAttribute('aria-pressed', b.dataset.theme===(THEMES[name]?name:'azul')?'true':'false'));
  try{ localStorage.setItem('music-tracker-theme', THEMES[name]?name:'azul'); }catch(e){}
}
$('#themes').addEventListener('click', e=>{ const b=e.target.closest('[data-theme]'); if(b) applyTheme(b.dataset.theme); });
try{ applyTheme(localStorage.getItem('music-tracker-theme')||'azul'); }catch(e){ applyTheme('azul'); }
function applyMode(m){
  const mode=m==='dark'?'dark':'light';
  document.documentElement.dataset.mode=mode;
  document.querySelectorAll('[data-mode-set]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.modeSet===mode?'true':'false'));
  try{ localStorage.setItem('music-tracker-mode',mode); }catch(e){}
}
document.querySelectorAll('[data-mode-set]').forEach(b=>b.addEventListener('click',()=>applyMode(b.dataset.modeSet)));
applyMode(document.documentElement.dataset.mode);

/* Avaliação: só classificação, review e favorito. Os detalhes do álbum não são editáveis. */
let rate={value:0,preview:null};
function paintStars(){
  const v = rate.preview ?? rate.value;
  document.querySelectorAll('#rateStars .sw').forEach((sw,idx)=>{
    const p=clamp(v-idx,0,1)*100;
    sw.querySelector('.g').style.setProperty('--f', p+'%');
  });
  $('#rateOut').textContent = v ? `${fmt(v)} / 5` : 'Sem classificação';
}
function openRate(src){
  const existing=findLib(src);
  rate={value: existing ? existing.stars : 0, preview:null};
  openModal(`
    <div class="mhead"><h2>${existing?'Editar avaliação':'Avaliar álbum'}</h2><button class="x" data-close aria-label="Fechar">×</button></div>
    <div class="mbody">
      <div class="rate-head">
        <div class="rate-cover">${coverHTML(src)}</div>
        <div>
          <h2>${esc(src.title)}</h2>
          <div class="artist">${esc(src.artist)}</div>
          <div class="sub">${[src.year,src.genre].filter(Boolean).map(esc).join(' · ')}</div>
        </div>
      </div>
      <div class="rate-box">
        <div class="rate-label">A tua classificação</div>
        ${starsInput()}
        <output id="rateOut" class="rate-out"></output>
      </div>
      <div class="field"><label for="rev">Review</label><textarea id="rev" placeholder="O que achaste deste álbum?">${esc(existing?existing.review:'')}</textarea></div>
      <label class="check"><input type="checkbox" id="favChk" ${existing&&existing.fav?'checked':''}> Marcar como favorito</label>
      <div class="form-actions">
        <button type="button" class="btn ghost" data-close>Cancelar</button>
        <button type="button" class="btn primary" id="saveRate">${existing?'Guardar':'Adicionar à biblioteca'}</button>
      </div>
    </div>`);
  paintStars();
  const wrap=$('#rateStars');
  wrap.addEventListener('mouseover',e=>{ const b=e.target.closest('.hit'); if(b){ rate.preview=+b.dataset.v; paintStars(); } });
  wrap.addEventListener('mouseleave',()=>{ rate.preview=null; paintStars(); });
  wrap.addEventListener('click',e=>{ const b=e.target.closest('.hit'); if(b){ rate.value=+b.dataset.v; rate.preview=null; paintStars(); } });
  $('#saveRate').onclick=()=>saveRate(src,existing);
}
function saveRate(src,existing){
  const v=rate.value;
  if(!v){ toast('Escolhe uma classificação de 0,5 a 5'); return; }
  const review=$('#rev').value.trim(), fav=$('#favChk').checked;
  if(existing){
    Object.assign(existing,{stars:v,review,fav});
    toast('Avaliação guardada');
  }else{
    db.unshift({
      id:uid(), sourceId:src.sourceId||src.id, artist:src.artist, title:src.title, year:src.year,
      genre:src.genre, cover:src.cover, tracks:src.tracks||0, stars:v, review, fav, createdAt:Date.now()
    });
    toast('Adicionado à biblioteca');
  }
  persist(); closeModal(); refreshAll();
}

/* ---------- Toast ---------- */
let tt;
function toast(msg,ms=2200){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(tt); tt=setTimeout(()=>t.classList.remove('show'),ms); }

/* ---------- Separadores ---------- */
function setTab(name){
  document.querySelectorAll('header .tab').forEach(x=>x.classList.toggle('on',x.dataset.tab===name));
  $('#view-catalog').classList.toggle('hidden',name!=='catalog');
  $('#view-library').classList.toggle('hidden',name!=='library');
  $('#view-charts').classList.toggle('hidden',name!=='charts');
  $('#view-vip').classList.toggle('hidden',name!=='vip');
  $('#view-home').classList.toggle('hidden',name!=='home');
  $('#view-profile').classList.toggle('hidden',name!=='profile');
  if(name==='home') renderHome();
  if(name==='profile') renderProfile();
  if(name==='charts') loadCharts();
  if(name==='library') renderAllLibrary();
  if(name==='catalog') renderCatalog();
}
document.querySelectorAll('header .tab').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));

/* ---------- Eventos ---------- */
$('#searchForm').addEventListener('submit',e=>{ e.preventDefault(); searchCatalog(); });
document.querySelectorAll('[data-ct]').forEach(b=>b.addEventListener('click',()=>{ catTab=b.dataset.ct; renderCatalog(); }));

$('#q').addEventListener('input',renderLibrary);
$('#lgenre').addEventListener('change',renderLibrary);
$('#sort').addEventListener('change',renderLibrary);

document.addEventListener('click',e=>{
  if(e.target.closest('[data-play]')) return;
  const card=e.target.closest('[data-open]');
  if(card && (card.closest('#catGrid')||card.closest('#libGrid')||card.closest('.rail'))) openAlbum(card.dataset.open);
});

$('#overlay').addEventListener('click',e=>{
  if(e.target.id==='overlay'||e.target.closest('[data-close]')) return closeModal();
  const pa=e.target.closest('[data-playall],[data-shuffle]');
  if(pa){ const box=$('#tracks'); if(box&&box._list&&box._list.length){ const sh=pa.hasAttribute('data-shuffle'); setShuffle(sh); setQueue(box._album, box._list, sh?Math.floor(Math.random()*box._list.length):0); } return; }
  const pr=e.target.closest('[data-plrm]'); if(pr){ removeFromPl(pr.dataset.plrm, pr.dataset.plrmid); return; }
  const tk=e.target.closest('[data-track]'); if(tk){ const box=$('#tracks'); if(box&&box._list) setQueue(box._album, box._list, +tk.dataset.track); return; }
  const rateBtn=e.target.closest('[data-rate]'), fv=e.target.closest('[data-fav]'), dl=e.target.closest('[data-del]');
  if(rateBtn){
    const a=registry.get(rateBtn.dataset.rate)||db.find(x=>x.id===rateBtn.dataset.rate)||catalog.find(x=>x.id===rateBtn.dataset.rate);
    if(a) openRate(a);
  }
  if(fv){ const a=db.find(x=>x.id===fv.dataset.fav); a.fav=!a.fav; persist(); refreshAll(); openAlbum(a.id); }
  if(dl){
    const a=db.find(x=>x.id===dl.dataset.del);
    if(a) askConfirm({title:'Remover da biblioteca', text:`“${a.title}” sai da tua biblioteca. Podes voltar a adicioná-lo depois.`, ok:'Remover', danger:true, onOk:()=>{ db=db.filter(x=>x.id!==a.id); persist(); refreshAll(); closeModal(); toast('Removido da biblioteca'); }});
  }
});
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeModal(); });

$('#btnExport').onclick=()=>{
  const blob=new Blob([JSON.stringify(db,null,2)],{type:'application/json'});
  const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(blob),download:'biblioteca-album-critico.json'});
  a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); toast('Exportado');
};
$('#fileImport').onchange=async e=>{
  const file=e.target.files[0]; if(!file) return;
  try{
    const data=JSON.parse(await file.text()); if(!Array.isArray(data)) throw new Error();
    const ids=new Set(db.map(a=>a.id)); data.forEach(a=>{ if(!ids.has(a.id)) db.push(a); });
    persist(); refreshAll(); toast(`${data.length} álbuns importados`);
  }catch{ toast('Ficheiro inválido'); }
  e.target.value='';
};

/* ---------- Spotify (ligação por conta e importação dos álbuns guardados) ---------- */
const SPOTIFY_CLIENT_ID = 'a8dec1fd7eaf4ea58dead64851bcbe3d';
const SPOTIFY_REDIRECT = 'https://santiagomartins400-ctrl.github.io/musictracker/avaliador-albuns-v2.html';
const spKey = () => 'album-critico-spotify:device';
const spConnected = () => !!localStorage.getItem(spKey());
function b64url(bytes){ return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function spotifyLogout(){
  try{ localStorage.removeItem(spKey()); }catch(e){}
  refreshSpotifyButton();
  toast('Sessão do Spotify terminada nesta app. Para trocar de conta, sai também em spotify.com.', 6000);
}
document.getElementById('btnSpotifyOut').addEventListener('click', spotifyLogout);
function refreshSpotifyButton(){
  const b=document.getElementById('btnSpotify'); if(b) b.textContent = spConnected() ? 'Importar do Spotify' : 'Ligar Spotify';
  const o=document.getElementById('btnSpotifyOut'); if(o) o.hidden = !spConnected();
}
async function spotifyConnect(){
  if(SPOTIFY_CLIENT_ID.startsWith('COLOCAR')){ toast('Falta o SPOTIFY_CLIENT_ID no ficheiro'); return; }
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  sessionStorage.setItem('sp_verifier', verifier);
  sessionStorage.setItem('sp_account', currentUser());
  const p = new URLSearchParams({client_id:SPOTIFY_CLIENT_ID, response_type:'code', redirect_uri:SPOTIFY_REDIRECT,
    scope:'user-library-read', code_challenge_method:'S256', code_challenge:challenge});
  location.href = 'https://accounts.spotify.com/authorize?' + p.toString();
}
async function spotifyHandleRedirect(){
  const code = new URLSearchParams(location.search).get('code');
  if(!code) return;
  history.replaceState({}, '', location.pathname);
  const verifier = sessionStorage.getItem('sp_verifier');
  if(!verifier) return;
  const r = await fetch('https://accounts.spotify.com/api/token', {method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:SPOTIFY_CLIENT_ID, grant_type:'authorization_code', code, redirect_uri:SPOTIFY_REDIRECT, code_verifier:verifier})});
  sessionStorage.removeItem('sp_verifier');
  if(!r.ok){ toast('Não foi possível ligar ao Spotify'); return; }
  const t = await r.json();
  localStorage.setItem(spKey(), JSON.stringify({access:t.access_token, refresh:t.refresh_token, exp:Date.now()+t.expires_in*1000, scope:t.scope||''}));
  refreshSpotifyButton();
  toast('Spotify ligado');
  await spotifyImport();
}
async function spotifyToken(){
  let st; try{ st = JSON.parse(localStorage.getItem(spKey())); }catch(e){}
  if(!st) return null;
  if(Date.now() < st.exp - 60000) return st.access;
  const r = await fetch('https://accounts.spotify.com/api/token', {method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:SPOTIFY_CLIENT_ID, grant_type:'refresh_token', refresh_token:st.refresh})});
  if(!r.ok) return null;
  const t = await r.json();
  const n = {access:t.access_token, refresh:t.refresh_token||st.refresh, exp:Date.now()+t.expires_in*1000};
  localStorage.setItem(spKey(), JSON.stringify(n));
  return n.access;
}
async function spotifyImport(){
  const tok = await spotifyToken();
  if(!tok){ toast('Liga primeiro o Spotify'); refreshSpotifyButton(); return; }
  let who = '', meErr = '', scope = '';
  try{ scope = JSON.parse(localStorage.getItem(spKey())||'{}').scope || '(vazio)'; }catch(e){}
  try{
    const r0 = await fetch('https://api.spotify.com/v1/me', {headers:{Authorization:'Bearer '+tok}});
    const txt0 = await r0.text();
    let me = {}; try{ me = JSON.parse(txt0); }catch(e){}
    if(!r0.ok) meErr = 'perfil '+r0.status+': '+(me.error?.message || txt0.slice(0,120) || '(sem texto)');
    who = me.display_name || me.id || '';
  }catch(e){ meErr = 'perfil: falha de rede ('+(e.message||e)+')'; }
  let url = 'https://api.spotify.com/v1/me/albums?limit=50';
  let added = 0, existing = 0, found = 0, failed = '';
  try{
    while(url){
      const r = await fetch(url, {headers:{Authorization:'Bearer '+tok}});
      if(!r.ok){
        const txt = await r.text();
        let body = {}; try{ body = JSON.parse(txt); }catch(e){}
        failed = 'biblioteca '+r.status+': '+(body.error?.message || txt.slice(0,120) || '(sem texto)');
        break;
      }
      const j = await r.json();
      (j.items||[]).forEach(it=>{
        found++;
        const al = it.album; const sid = 'spotify-'+al.id;
        if(db.some(x=>x.sourceId===sid)){ existing++; return; }
        db.unshift({id:uid(), sourceId:sid, artist:al.artists.map(x=>x.name).join(', '), title:al.name,
          year:(al.release_date||'').slice(0,4), genre:'', cover:al.images?.[0]?.url||'', tracks:al.total_tracks||0,
          stars:0, review:'', fav:false, createdAt:Date.now()});
        added++;
      });
      url = j.next;
    }
  }catch(e){ failed = 'Sem ligação ao Spotify'; }
  persist(); refreshAll();
  const errs = [meErr, failed].filter(Boolean).join(' · ');
  toast(`Conta ${who||'desconhecida'}: ${found} álbuns, ${added} novos, ${existing} já existiam · permissões: ${scope}${errs ? ' — ERRO ' + errs : ''}`, errs ? 12000 : 2200);
}
document.getElementById('btnSpotify').addEventListener('click', ()=>{
  if(spConnected()) spotifyImport(); else spotifyConnect();
});

/* ---------- Aviso de conduta (primeira entrada, em inglês) ---------- */
function showTermsIfNeeded(){
  let ok=false; try{ ok = localStorage.getItem('music-tracker-terms')==='1'; }catch(e){}
  if(ok){ if(!currentUser()) openAuth('login', true); return; }
  window.authGate = true;
  openModal(`
    <div class="mhead"><h2>Welcome to Music Tracker</h2></div>
    <div class="mbody">
      <p style="line-height:1.7;color:#d6d4e6">Please behave respectfully. Harassment, hate speech, threats, spam and offensive content are not allowed in reviews or comments. Content that breaks these rules may be removed, and accounts may be restricted.</p>
      <label class="check" style="margin:18px 0"><input type="checkbox" id="termsChk"> I accept and I understand.</label>
      <div class="form-actions"><button type="button" class="btn primary" id="termsOk" disabled>Accept and continue</button></div>
    </div>`);
  const chk=document.getElementById('termsChk'), btn=document.getElementById('termsOk');
  chk.addEventListener('change', ()=>{ btn.disabled = !chk.checked; });
  btn.addEventListener('click', ()=>{
    try{ localStorage.setItem('music-tracker-terms','1'); }catch(e){}
    window.authGate = false;
    closeModal();
    if(!currentUser()) openAuth('login', true);
  });
}
showTermsIfNeeded();

/* ---------- Top semanal (data/charts.json, atualizado por tarefa semanal) ---------- */
let chartsData = null, chKind = 'albums';
async function loadCharts(){
  await fetchCharts();
  renderCharts();
}
function renderCharts(){
  const data = chartsData?.global;
  $('#chStatus').textContent = chartsData?.updated
    ? `Atualizado em ${new Date(chartsData.updated).toLocaleDateString('pt-PT')}`
    : 'O top semanal ainda não está disponível.';
  if(!data){ $('#chGrid').innerHTML = `<div class="empty"><b>Top ainda não disponível</b>Volta mais tarde.</div>`; return; }
  let list;
  if(chKind==='albums') list = data.albums;
  else if(chKind==='songs') list = data.songs;
  else if(data.artists) {
    list = data.artists.map(x => ({
      rank: x.rank, title: x.name,
      artist: `${x.albums} ${x.albums===1?'álbum':'álbuns'} no top`,
      cover: x.photo || x.cover || ''
    }));
  } else {
    const c = {};
    data.albums.forEach(a => { c[a.artist] = (c[a.artist]||0)+1; });
    list = Object.entries(c).sort((a,b)=>b[1]-a[1]).slice(0,50).map(([name,n],i)=>({
      rank:i+1, title:name, artist:`${n} ${n===1?'álbum':'álbuns'} no top`,
      cover: data.albums.find(a=>a.artist===name)?.cover || ''
    }));
  }
  list.forEach((x,i)=>{ if(!x.id) x.id='ch-'+chKind+'-'+i; registry.set(x.id,x); });
  $('#chGrid').innerHTML = list.map(x => `
    <article class="card">
      <div class="cover">${x.cover ? `<img loading="lazy" src="${esc(x.cover)}" alt="">` : ''}</div>
      ${chKind==='artists'?'':playBtn(x)}
      <span class="badge-stars">#${x.rank}</span>
      <div class="meta"><h3>${esc(x.title)}</h3><p>${esc(x.artist)}</p></div>
    </article>`).join('');
}
$('#favOnly').addEventListener('change', renderLibrary);
document.querySelectorAll('[data-chk]').forEach(b => b.addEventListener('click', () => {
  chKind = b.dataset.chk;
  document.querySelectorAll('[data-chk]').forEach(x => x.classList.toggle('on', x===b));
  renderCharts();
}));

/* ---------- Conta: criar conta e iniciar sessão ---------- */
function refreshAccountButton(){
  document.getElementById('btnAccount').textContent = currentUser() || 'Entrar';
}
function loginAs(email){
  try{ localStorage.setItem(SESS_KEY, email); }catch(e){}
  db = load();
  refreshAccountButton();
  refreshSpotifyButton();
  refreshAll();
  refreshAccountSection();
}
function logout(){
  if(serverMode() && getToken()) acctApi('/auth/logout', {method:'POST', auth:true});
  setToken(''); acctUser = null; clearTimeout(syncTimer);
  try{ localStorage.removeItem(SESS_KEY); }catch(e){}
  db = load();
  refreshAccountSection();
  refreshAccountButton();
  refreshSpotifyButton();
  refreshAll();
  toast('Sessão terminada');
  openAuth('login', true);
}
function openAuth(start='login', gate=false){
  if(serverMode()) return openAuthServer(start, gate);
  let mode=start;
  window.authGate = gate;
  openModal(`
    <div class="mhead"><h2 id="authTitle"></h2>${gate?'':'<button class="x" data-close aria-label="Fechar">×</button>'}</div>
    <form class="mbody" id="authForm">
      <div class="live" id="live"><div class="pv-label">Email</div><div class="pv-email" id="pvEmail"></div><div class="pv-label" style="margin-top:12px">Palavra-passe</div><div class="pv-stars" id="pvStars"></div></div>
      <div class="field"><label for="aEmail">Email</label><input id="aEmail" type="email" required autocomplete="email"></div>
      <div class="field"><label for="aPass">Palavra-passe</label><input id="aPass" type="password" required minlength="6" autocomplete="current-password"></div>
      <p id="authErr" style="color:#ff6b8a;min-height:20px;margin:0 0 10px"></p>
      <div class="form-actions"><button type="submit" class="btn primary" id="aSubmit"></button></div>
      <p style="text-align:center;margin-top:18px;color:var(--muted)"><span id="aSwitchTxt"></span>
        <button type="button" class="btn ghost" id="aSwitch" style="padding:4px 8px"></button></p>
    </form>`);
  const err = m => { document.getElementById('authErr').textContent = m; };
  const paint = () => {
    const login = mode==='login';
    document.getElementById('authTitle').textContent = login ? 'Entrar' : 'Criar conta';
    document.getElementById('aSubmit').textContent = login ? 'Entrar' : 'Criar conta';
    document.getElementById('aSwitchTxt').textContent = login ? 'Ainda não tens conta?' : 'Já tens conta?';
    document.getElementById('aSwitch').textContent = login ? 'Criar conta' : 'Entrar';
    document.getElementById('aPass').setAttribute('autocomplete', login ? 'current-password' : 'new-password');
    document.getElementById('live').style.display = 'block';
    err('');
  };
  paint();
  const inE=document.getElementById('aEmail'), inP=document.getElementById('aPass');
  const pvE=document.getElementById('pvEmail'), pvS=document.getElementById('pvStars');
  pvE.textContent = inE.value;
  inE.addEventListener('input', ()=>{ pvE.textContent = inE.value; });
  inP.addEventListener('input', ()=>{
    const n=inP.value.length;
    while(pvS.children.length > n) pvS.lastElementChild.remove();
    for(let i=pvS.children.length;i<n;i++){ const sp=document.createElement('span'); sp.textContent='★'; pvS.appendChild(sp); }
  });
  document.getElementById('modal').classList.add('auth-glow');
  document.getElementById('aSwitch').onclick = () => { mode = mode==='login' ? 'signup' : 'login'; paint(); };
  document.getElementById('authForm').onsubmit = async ev => {
    ev.preventDefault();
    const email = document.getElementById('aEmail').value.trim().toLowerCase();
    const pw = document.getElementById('aPass').value;
    if (!/^\S+@\S+\.\S+$/.test(email)) { err('Email inválido.'); return; }
    if (pw.length < 6) { err('A palavra-passe deve ter pelo menos 6 caracteres.'); return; }
    try {
      const acc = getAccounts();
      if (mode==='signup') {
        if (acc[email]) { err('Já existe uma conta com este email.'); return; }
        const salt = uid();
        acc[email] = { salt, hash: await hashPw(pw, salt) };
        setAccounts(acc);
      } else {
        const a = acc[email];
        if (!a || (await hashPw(pw, a.salt)) !== a.hash) { err('Email ou palavra-passe incorretos.'); return; }
      }
      loginAs(email);
      closeModal();
      toast(mode==='signup' ? 'Conta criada' : 'Sessão iniciada');
    } catch (e) {
      err('Não foi possível concluir. Tenta de novo.');
    }
  };
}
function fEmail(v){ return `<div class="field"><label for="aEmail">Email</label><input id="aEmail" type="email" required autocomplete="email" value="${esc(v||'')}"></div>`; }
function fPass(label, ac){ return `<div class="field"><label for="aPass">${label}</label><input id="aPass" type="password" required minlength="8" autocomplete="${ac}"></div>`; }
function fCode(id, label){ return `<div class="field"><label for="${id}">${label}</label><input id="${id}" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required></div>`; }
function openAuthServer(start='login', gate=false){
  let step = start==='signup' ? 'signup' : 'login';
  let mfaToken = '', resetEmail = '';
  window.authGate = gate;
  openModal(`
    <div class="mhead"><h2 id="authTitle"></h2>${gate?'':'<button class="x" data-close aria-label="Fechar">×</button>'}</div>
    <form class="mbody" id="authForm" novalidate>
      <div id="stepBody"></div>
      <p id="authErr" role="alert" style="color:#ff6b8a;min-height:20px;margin:0 0 10px"></p>
      <div class="form-actions"><button type="submit" class="btn primary" id="aSubmit"></button></div>
      <p class="auth-links" id="authLinks" style="text-align:center;margin-top:14px"></p>
    </form>`);
  const err = m => { document.getElementById('authErr').textContent = m || ''; };
  const $$ = id => document.getElementById(id);
  const link = (id, txt) => `<button type="button" class="btn ghost" id="${id}" style="padding:4px 8px">${txt}</button>`;
  function paint(){
    const T = {
      login:  { t:'Entrar', b: fEmail(resetEmail) + fPass('Palavra-passe','current-password'), s:'Entrar', l: link('aSwitch','Criar conta') + ' · ' + link('aForgot','Esqueci a palavra-passe') },
      signup: { t:'Criar conta', b: fEmail() + fPass('Palavra-passe (mínimo 8 caracteres)','new-password'), s:'Criar conta', l: link('aSwitch','Já tenho conta') },
      mfa:    { t:'Verificação em duas etapas', b:'<p class="adm-hint">Escreve o código de 6 dígitos da tua app de autenticação.</p>' + fCode('aCode','Código'), s:'Confirmar', l: link('aBack','Voltar') },
      forgot: { t:'Recuperar palavra-passe', b:'<p class="adm-hint">Enviamos um código de 6 dígitos para o teu email.</p>' + fEmail(resetEmail), s:'Enviar código', l: link('aBack','Voltar') },
      reset:  { t:'Nova palavra-passe', b:'<p class="adm-hint">Escreve o código que recebeste por email e a nova palavra-passe.</p>' + fCode('aCode','Código do email') + fPass('Nova palavra-passe','new-password') + `<div class="field" id="totpWrap" hidden>${fCode('aTotp','Código da app de verificação')}</div>`, s:'Repor palavra-passe', l: link('aBack','Voltar') },
    }[step];
    $$('authTitle').textContent = T.t;
    $$('stepBody').innerHTML = T.b;
    $$('aSubmit').textContent = T.s;
    $$('authLinks').innerHTML = T.l;
    err('');
    const sw = $$('aSwitch'); if(sw) sw.onclick = () => { step = step==='login' ? 'signup' : 'login'; paint(); };
    const fg = $$('aForgot'); if(fg) fg.onclick = () => { step = 'forgot'; paint(); };
    const bk = $$('aBack'); if(bk) bk.onclick = () => { step = 'login'; paint(); };
    const pe = $$('aEmail'); if(pe) pe.addEventListener('input', () => { resetEmail = pe.value; });
    document.getElementById('modal').classList.add('auth-glow');
  }
  function done(token, user){
    setToken(token);
    loginAs(user.email);
    acctUser = user;
    pullLibrary().then(() => { closeModal(); toast(step==='signup' ? 'Conta criada' : 'Sessão iniciada'); refreshAccountSection(); });
  }
  paint();
  document.getElementById('authForm').onsubmit = async ev => {
    ev.preventDefault();
    const email = ($$('aEmail')?.value || '').trim().toLowerCase();
    const pw = $$('aPass')?.value || '';
    const btn = $$('aSubmit'); btn.disabled = true;
    try{
      if(step==='login' || step==='signup'){
        if(!/^\S+@\S+\.\S+$/.test(email)) return err('Email inválido.');
        if(step==='signup' && pw.length < 8) return err('A palavra-passe deve ter pelo menos 8 caracteres.');
        if(step==='login' && !pw) return err('Escreve a palavra-passe.');
        const r = await acctApi(step==='login' ? '/auth/login' : '/auth/register', {method:'POST', body:{email, password:pw}});
        if(!r.ok) return err(r.data.error || 'Não foi possível concluir. Tenta de novo.');
        if(r.data.mfa){ mfaToken = r.data.mfaToken; step = 'mfa'; paint(); return; }
        return done(r.data.token, r.data.user);
      }
      if(step==='mfa'){
        const code = $$('aCode')?.value.trim() || '';
        const r = await acctApi('/auth/login/2fa', {method:'POST', body:{mfaToken, code}});
        if(!r.ok){ if(r.status===401 && /expirou/.test(r.data.error||'')){ step='login'; paint(); } return err(r.data.error || 'Código incorreto.'); }
        return done(r.data.token, r.data.user);
      }
      if(step==='forgot'){
        if(!/^\S+@\S+\.\S+$/.test(email)) return err('Email inválido.');
        resetEmail = email;
        await acctApi('/auth/reset/request', {method:'POST', body:{email}});
        step = 'reset'; paint();
        toast('Se o email tiver conta, recebes um código.', 3500);
        return;
      }
      if(step==='reset'){
        const code = $$('aCode')?.value.trim() || '';
        const totp = $$('aTotp')?.value.trim() || '';
        const r = await acctApi('/auth/reset/confirm', {method:'POST', body:{email:resetEmail, code, newPassword:pw, totp: totp || undefined}});
        if(!r.ok){
          if(r.data.needsTotp){ $$('totpWrap').hidden = false; }
          return err(r.data.error || 'Não foi possível repor a palavra-passe.');
        }
        step = 'login'; paint();
        $$('aEmail').value = resetEmail;
        toast('Palavra-passe alterada. Inicia sessão.', 3500);
      }
    } finally { btn.disabled = false; }
  };
}

/* Verificação em duas etapas e sessões (secção "Conta e segurança" no Perfil) */
function refreshAccountSection(){
  const sec = document.getElementById('secAcc'); if(!sec) return;
  const on = serverMode() && !!currentUser() && !!getToken();
  sec.hidden = !on;
  if(!on) return;
  const tf = !!(acctUser && acctUser.twoFactor);
  document.getElementById('secStatus').textContent = tf
    ? 'Verificação em duas etapas ativa. Ao iniciar sessão pedimos também o código da app.'
    : 'Verificação em duas etapas desativada. Recomendamos ativar para proteger a conta.';
  document.getElementById('btn2fa').textContent = tf ? 'Desativar verificação em duas etapas' : 'Ativar verificação em duas etapas';
}
function loadScriptOnce(src){
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
}
async function openSetup2FA(){
  const r = await acctApi('/auth/2fa/setup', {method:'POST', auth:true});
  if(r.status===401){ sessionEnded(); return; }
  if(!r.ok){ toast(r.data.error || 'Não foi possível preparar a verificação.'); return; }
  openModal(`
    <div class="mhead"><h2>Ativar verificação em duas etapas</h2><button class="x" data-close aria-label="Fechar">×</button></div>
    <div class="mbody">
      <p>1. Abre uma app de autenticação (Google Authenticator, Microsoft Authenticator, Authy…) e lê este código QR.</p>
      <div class="qr" id="qrBox" role="img" aria-label="Código QR para a app de autenticação"></div>
      <p class="adm-hint">Não consegues ler o QR? Escreve esta chave na app:</p>
      <p><code class="secret">${esc(r.data.secret)}</code></p>
      <form id="fx2fa" novalidate>
        <p>2. Escreve o código de 6 dígitos que a app mostra.</p>
        ${fCode('setCode','Código')}
        <p id="setErr" role="alert" style="color:#ff6b8a;min-height:20px"></p>
        <div class="form-actions"><button class="btn primary" type="submit">Ativar</button></div>
      </form>
    </div>`);
  try{
    if(!window.qrcode) await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js');
    const q = qrcode(0, 'M'); q.addData(r.data.otpauth); q.make();
    document.getElementById('qrBox').innerHTML = q.createSvgTag({cellSize:4, margin:2});
  }catch(e){
    document.getElementById('qrBox').textContent = 'Não foi possível mostrar o QR. Usa a chave abaixo.';
  }
  document.getElementById('fx2fa').onsubmit = async ev => {
    ev.preventDefault();
    const code = document.getElementById('setCode').value.trim();
    const e = await acctApi('/auth/2fa/enable', {method:'POST', auth:true, body:{code}});
    if(!e.ok){ document.getElementById('setErr').textContent = e.data.error || 'Código incorreto.'; return; }
    acctUser = e.data.user; closeModal(); toast('Verificação em duas etapas ativa'); refreshAccountSection();
  };
}
function openDisable2FA(){
  openModal(`
    <div class="mhead"><h2>Desativar verificação em duas etapas</h2><button class="x" data-close aria-label="Fechar">×</button></div>
    <form class="mbody" id="fx2faOff" novalidate>
      <p class="adm-hint">Para desativar, confirma a palavra-passe e escreve o código da app.</p>
      ${fPass('Palavra-passe','current-password')}
      ${fCode('offCode','Código da app')}
      <p id="offErr" role="alert" style="color:#ff6b8a;min-height:20px"></p>
      <div class="form-actions"><button class="btn primary" type="submit">Desativar</button></div>
    </form>`);
  document.getElementById('fx2faOff').onsubmit = async ev => {
    ev.preventDefault();
    const password = document.getElementById('aPass').value;
    const code = document.getElementById('offCode').value.trim();
    const r = await acctApi('/auth/2fa/disable', {method:'POST', auth:true, body:{password, code}});
    if(!r.ok){ document.getElementById('offErr').textContent = r.data.error || 'Não foi possível desativar.'; return; }
    acctUser = r.data.user; closeModal(); toast('Verificação em duas etapas desativada'); refreshAccountSection();
  };
}
document.getElementById('btn2fa').addEventListener('click', () => {
  if(acctUser && acctUser.twoFactor) openDisable2FA(); else openSetup2FA();
});
document.getElementById('btnLogoutAll').addEventListener('click', () => {
  askConfirm({title:'Terminar sessões', text:'Termina a sessão em todos os dispositivos, incluindo este.', ok:'Terminar', onOk: async () => {
    await acctApi('/auth/logout-all', {method:'POST', auth:true});
    setToken(''); acctUser = null; clearTimeout(syncTimer);
    try{ localStorage.removeItem(SESS_KEY); }catch(e){}
    db = load(); refreshAccountButton(); refreshSpotifyButton(); refreshAll(); refreshAccountSection();
    toast('Sessões terminadas'); openAuth('login', true);
  }});
});

document.getElementById('btnAccount').addEventListener('click', () => {
  if (currentUser()) askConfirm({title:'Terminar sessão', text:'Queres terminar a sessão nesta app?', ok:'Terminar', onOk:()=>logout()});
  else openAuth('login');
});
refreshAccountButton();
refreshSpotifyButton();
refreshAccountSection();
restoreSession();
spotifyHandleRedirect();
(()=>{ const qp=new URLSearchParams(location.search).get('u'); if(qp && serverMode()) setTimeout(()=>openPublicProfile(qp), 900); })();
showTermsIfNeeded();

loadSuggestions();
renderAllLibrary();

/* ===== Redesenho: início, perfil, leitor e pesquisa por artistas/músicas ===== */
async function renderHome(){
  const rated=db.filter(a=>a.stars>0), avg=rated.length?(rated.reduce((t,a)=>t+a.stars,0)/rated.length).toFixed(1):'–';
  const favN=db.filter(a=>a.fav).length;
  const todoL=db.filter(a=>!a.stars).sort((a,b)=>b.createdAt-a.createdAt).slice(0,14);
  $('#homeTodo').innerHTML = todoL.length ? todoL.map((a,i)=>cardHTML(a,i)).join('') : '<div class="empty"><b>Tudo avaliado</b>Não tens álbuns por avaliar.</div>';
  $('#homeChips').innerHTML=[
    `<span class="stat-pill"><b>${db.length}</b> ${db.length===1?'álbum':'álbuns'} na biblioteca</span>`,
    `<span class="stat-pill"><b>${avg}</b> média ★</span>`,
    `<span class="stat-pill"><b>${favN}</b> ${favN===1?'favorito':'favoritos'}</span>`
  ].join('');
  const u=(currentUser()||'').split('@')[0];
  $('#homeHello').textContent = u ? `Olá, ${u}` : 'Olá';
  const fav=db.filter(a=>a.fav).length, best=db.filter(a=>a.stars>=4).length, todo=db.filter(a=>!a.stars).length;
  $('#plFavN').textContent = `${fav} ${fav===1?'álbum':'álbuns'}`;
  $('#plBestN').textContent = `${best} com 4★ ou mais`;
  $('#plTodoN').textContent = `${todo} ${todo===1?'álbum':'álbuns'} sem avaliação`;
  const recent=[...db].sort((a,b)=>b.createdAt-a.createdAt).slice(0,14);
  $('#homeRecent').innerHTML = recent.length
    ? recent.map((a,i)=>cardHTML(a,i)).join('')
    : `<div class="empty"><b>Ainda sem álbuns</b>Pesquisa e avalia o primeiro.</div>`;
  const d = await getCharts();
  const top = topItems(d?.global?.albums||[]).slice(0,14);
  $('#homeRec').innerHTML = top.length
    ? top.map((a,i)=>cardHTML(a,i)).join('')
    : `<div class="empty"><b>Top ainda não disponível</b>Volta mais tarde.</div>`;
}

function openPlaylist(k){
  setTab('library');
  libPl=null; renderPlaylistBar();
  $('#favOnly').checked = k==='fav';
  $('#sort').value = k==='fav' ? 'fav' : (k==='best' ? 'stars-desc' : 'stars-asc');
  renderLibrary();
}

function renderProfile(){
  renderSocial();
  const u=currentUser();
  $('#accText').textContent = u ? 'Sessão iniciada como ' + u + '. As tuas avaliações ficam guardadas nesta conta.' : 'Entra ou cria uma conta para guardar as tuas avaliações.';
  $('#accIn').hidden = !!u;
  $('#accOut').hidden = !u;
  refreshSpotifyButton();
  $('#profName').textContent = u ? u.split('@')[0] : 'Visitante';
  $('#profSub').textContent = u ? 'Sessão iniciada. As tuas avaliações ficam guardadas nesta conta.' : 'Entra para guardar a tua conta e as tuas avaliações.';
}

/* ---------- Perfil e amigos (precisa do servidor de contas) ---------- */
let meSocial = null;
const socialOn = () => serverMode() && !!currentUser() && !!getToken();
async function loadSocial(){
  if(!socialOn()) return null;
  const r = await acctApi('/me/social', {auth:true});
  if(r.status===401){ sessionEnded(); return null; }
  if(!r.ok) return null;
  meSocial = r.data;
  return meSocial;
}
const hasName = (list, name) => (list||[]).some(x => x.username === name);
const pStat = (k, v) => `<div class="stat"><small>${esc(k)}</small><b>${esc(v)}</b></div>`;
async function renderSocial(){
  const box = $('#social'); if(!box) return;
  box.hidden = !socialOn();
  if(box.hidden) return;
  const d = await loadSocial();
  if(!d){ $('#profStats').innerHTML=''; return; }
  $('#profStats').innerHTML = pStat('Álbuns avaliados', d.ratedCount) + pStat('Artista favorito', d.favArtist || '—') + pStat('Amigos', d.friends.length);

  const ub = $('#unameBox');
  if(!d.username){
    ub.innerHTML = `<h3 id="unameTitle">Nome de utilizador</h3>
      <p class="adm-hint">Escolhe um nome público para os teus amigos te encontrarem. Entre 3 e 20 letras, números, pontos ou _.</p>
      <form class="soc-form" id="unameForm"><input id="unameIn" autocomplete="off" maxlength="20" aria-label="Nome de utilizador" placeholder="ex.: ana.music"><button class="btn primary" type="submit">Guardar</button></form>
      <p class="soc-msg" id="unameMsg" role="status"></p>`;
    $('#unameForm').onsubmit = async ev => {
      ev.preventDefault();
      const name = $('#unameIn').value.trim();
      const r = await acctApi('/profile/username', {method:'POST', auth:true, body:{username:name}});
      if(!r.ok){ $('#unameMsg').textContent = r.data.error || 'Não foi possível guardar.'; return; }
      toast('Nome guardado'); renderSocial();
    };
  }else{
    ub.innerHTML = `<h3 id="unameTitle">O teu perfil público</h3>
      <p class="adm-hint">Quem tiver este link vê o número de álbuns avaliados, o artista favorito e o número de amigos.</p>
      <div class="soc-form"><input readonly value="@${esc(d.username)}" aria-label="Nome de utilizador"><button class="btn ghost" type="button" id="copyProfile">Copiar link</button></div>`;
    $('#copyProfile').onclick = async () => {
      const link = `${location.origin}${location.pathname}?u=${encodeURIComponent(d.username)}`;
      try{ await navigator.clipboard.writeText(link); toast('Link copiado'); }catch(e){ toast(link, 5000); }
    };
  }

  const fb = $('#friendsBox');
  if(!d.username){ fb.innerHTML = `<h3 id="friendsTitle">Amigos</h3><p class="adm-hint">Escolhe primeiro o nome de utilizador para adicionar amigos.</p>`; return; }
  const row = (name, sub, acts) => `<div class="soc-row"><div><b>@${esc(name)}</b>${sub?`<small>${esc(sub)}</small>`:''}</div><div class="acts">${acts}</div></div>`;
  const btn = (act, name, label, cls='ghost') => `<button class="btn ${cls}" type="button" data-act="${act}" data-u="${esc(name)}">${label}</button>`;
  fb.innerHTML = `<h3 id="friendsTitle">Amigos</h3>
    <form class="soc-form" id="addFriendForm"><input id="addFriendIn" autocomplete="off" maxlength="20" aria-label="Nome de utilizador do amigo" placeholder="Nome de utilizador exato, ex.: bea.x"><button class="btn primary" type="submit">Adicionar</button></form>
    ${d.incoming.length ? `<p class="soc-h">Pedidos recebidos</p><div class="soc-list">${d.incoming.map(x=>row(x.username,'Quer ser teu amigo', btn('accept',x.username,'Aceitar','primary')+btn('decline',x.username,'Recusar'))).join('')}</div>`:''}
    ${d.outgoing.length ? `<p class="soc-h">Pedidos enviados</p><div class="soc-list">${d.outgoing.map(x=>row(x.username,'Pendente', btn('decline',x.username,'Cancelar'))).join('')}</div>`:''}
    <p class="soc-h">Amigos (${d.friends.length})</p>
    ${d.friends.length ? `<div class="soc-list">${d.friends.map(x=>row(x.username,'', btn('view',x.username,'Ver perfil')+btn('remove',x.username,'Remover'))).join('')}</div>` : '<p class="soc-msg">Ainda não tens amigos. Procura um nome de utilizador acima.</p>'}`;

  $('#addFriendForm').onsubmit = async ev => {
    ev.preventDefault();
    const name = $('#addFriendIn').value.trim().toLowerCase();
    if(!name) return;
    const r = await acctApi('/friends/request', {method:'POST', auth:true, body:{username:name}});
    if(!r.ok){ toast(r.data.error || 'Não foi possível enviar o pedido.'); return; }
    toast('Pedido enviado'); renderSocial();
  };
}
document.getElementById('friendsBox').addEventListener('click', async ev => {
  const b = ev.target.closest('[data-act]'); if(!b) return;
  const name = b.dataset.u, act = b.dataset.act;
  if(act==='view'){ openPublicProfile(name); return; }
  if(act==='remove'){
    askConfirm({title:'Remover amigo', text:`Queres remover @${name} da tua lista de amigos?`, ok:'Remover', onOk: async () => {
      await acctApi('/friends/remove', {method:'POST', auth:true, body:{username:name}}); renderSocial();
    }});
    return;
  }
  const r = await acctApi('/friends/'+act, {method:'POST', auth:true, body:{username:name}});
  if(!r.ok){ toast(r.data.error || 'Não foi possível concluir.'); return; }
  if(act==='accept') toast(`Agora és amigo de @${name}`);
  renderSocial();
});
/* Perfil público de outra pessoa (também abre com ?u=nome no link) */
async function openPublicProfile(name){
  const r = await acctApi('/profile/'+encodeURIComponent(name));
  if(!r.ok){ toast(r.data.error || 'Perfil não encontrado.'); return; }
  const p = r.data, me = await (meSocial ? Promise.resolve(meSocial) : loadSocial());
  const isMe = !!(me && me.username === p.username);
  let action = '';
  if(me && !isMe){
    if(hasName(me.friends, p.username)) action = `<button class="btn ghost" type="button" data-pact="remove">Remover amigo</button>`;
    else if(hasName(me.incoming, p.username)) action = `<button class="btn primary" type="button" data-pact="accept">Aceitar pedido</button>`;
    else if(hasName(me.outgoing, p.username)) action = `<button class="btn ghost" type="button" data-pact="decline">Cancelar pedido</button>`;
    else action = `<button class="btn primary" type="button" data-pact="request">Adicionar amigo</button>`;
  }
  openModal(`
    <div class="mhead"><h2>@${esc(p.username)}</h2><button class="x" data-close aria-label="Fechar">×</button></div>
    <div class="mbody">
      <div class="pp-stats">
        ${pStat('Álbuns avaliados', p.ratedCount)}
        ${pStat('Artista favorito', p.favArtist || '—')}
        ${pStat('Amigos', p.friendsCount)}
      </div>
      ${isMe ? '<p class="adm-hint">É o teu perfil.</p>' : ''}
      ${!me ? '<p class="adm-hint">Entra para adicionar esta pessoa como amiga.</p>' : ''}
      <div class="form-actions">${action}</div>
    </div>`);
  const mb = document.getElementById('modal');
  mb.onclick = async ev => {
    const b = ev.target.closest('[data-pact]'); if(!b) return;
    const act = b.dataset.pact;
    const path = act==='request' ? '/friends/request' : act==='accept' ? '/friends/accept' : act==='decline' ? '/friends/decline' : '/friends/remove';
    const x = await acctApi(path, {method:'POST', auth:true, body:{username:p.username}});
    if(!x.ok){ toast(x.data.error || 'Não foi possível concluir.'); return; }
    closeModal(); toast('Feito'); renderSocial();
  };
}

/* Pesquisa: artistas agrupados e músicas do top semanal */
function renderExtra(){
  const pane=$('#catGrid');
  if(catTab==='Artist'){
    const map=new Map();
    catalog.forEach(a=>{ const c=map.get(a.artist)||{artist:a.artist,n:0,cover:a.cover}; c.n++; if(!c.cover) c.cover=a.cover; map.set(a.artist,c); });
    const arts=[...map.values()].sort((x,y)=>y.n-x.n);
    if(!arts.length){ pane.innerHTML=`<div class="empty"><b>Sem artistas nesta pesquisa</b>Pesquisa um artista para ver os seus lançamentos.</div>`; return; }
    pane.innerHTML=arts.map((x,i)=>`<article class="card artist-card" style="animation-delay:${Math.min(i,12)*25}ms" data-search="${esc(x.artist)}" tabindex="0" role="button" aria-label="Ver lançamentos de ${esc(x.artist)}">
      <div class="cover round">${x.cover?`<img loading="lazy" src="${esc(x.cover)}" alt="">`:''}</div>
      <div class="meta"><h3>${esc(x.artist)}</h3><p>${x.n} ${x.n===1?'lançamento':'lançamentos'}</p></div></article>`).join('');
    return;
  }
  const q=normTxt($('#cq').value.trim());
  const songs=(chartsData?.global?.songs||[]).filter(s=>!q||normTxt(s.artist+s.title).includes(q));
  if(!songs.length){ pane.innerHTML=`<div class="empty"><b>Sem músicas no top semanal para esta pesquisa</b>Pesquisa um artista ou álbum.</div>`; return; }
  pane.innerHTML=songs.map((s,i)=>cardHTML({id:'song-'+i+'-'+s.title,sourceId:'',artist:s.artist,title:s.title,type:'Single',cover:s.cover||'',tracks:0,rgid:null},i)).join('');
}

/* Leitor: pré-visualizações de 30 segundos (iTunes) */
let nowItem=null;
const mmss=s=>{ s=Math.max(0,Math.floor(s||0)); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); };
function setPlaying(on){ const b=$('#pBtn'); b.innerHTML=on?PAUSE_ICO:PLAY_ICO; b.setAttribute('aria-label',on?'Pausa':'Reproduzir'); $('#player').classList.toggle('is-playing', !!on); }
function showPlayer(a,note){
  $('#player').hidden=false;
  $('#pTitle').textContent=a.title;
  $('#pArtist').textContent=a.artist||'';
  $('#pCover').innerHTML=a.cover?`<img src="${esc(a.cover)}" alt="">`:'';
  $('#pNote').textContent=note||'';
}
async function previewFor(a){
  const r=await fetchT(`https://itunes.apple.com/search?term=${encodeURIComponent(a.artist+' '+a.title)}&entity=song&limit=10&country=pt`);
  if(!r.ok) throw new Error('itunes '+r.status);
  const j=await r.json();
  const nt=normTxt(a.title), res=(j.results||[]).filter(x=>x.previewUrl);
  const hit=res.find(x=>normTxt(x.collectionName||'').includes(nt))||res[0];
  return hit?{url:hit.previewUrl,track:hit.trackName||a.title}:null;
}
async function playItem(a){
  if(!a) return;
  if(nowItem && nowItem.id===a.id && audio.src){ if(audio.paused) audio.play(); else audio.pause(); return; }
  nowItem=a; showPlayer(a,'A carregar pré-visualização…'); setPlaying(false);
  try{
    const p=await previewFor(a);
    if(!p){ showPlayer(a,'Sem pré-visualização para este título.'); return; }
    audio.src=p.url;
    showPlayer(a,`Pré-visualização · ${p.track}`);
    await audio.play();
  }catch(e){ showPlayer(a,'Não foi possível tocar agora.'); }
}
audio.addEventListener('play',()=>setPlaying(true));
audio.addEventListener('pause',()=>setPlaying(false));
audio.addEventListener('ended',()=>setPlaying(false));
audio.addEventListener('loadedmetadata',()=>{ $('#pDur').textContent=mmss(audio.duration); });
audio.addEventListener('timeupdate',()=>{ const d=audio.duration||0; const pct=d?(audio.currentTime/d*100):0; $('#pBar').value=pct; $('#pBar').style.setProperty('--p',pct+'%'); $('#pCur').textContent=mmss(audio.currentTime); });
$('#pBtn').addEventListener('click',()=>{
  if(!nowItem && !queue.length) return;
  if(audio.paused){ if(audio.src) audio.play(); else playItem(nowItem); } else audio.pause();
});
$('#pBar').addEventListener('input',e=>{ e.target.style.setProperty('--p',e.target.value+'%'); if(audio.duration) audio.currentTime=audio.duration*e.target.value/100; });
setPlaying(false);

/* Cliques de navegação e ações */
document.addEventListener('click',e=>{
  const pb=e.target.closest('[data-play]');
  if(pb){ e.preventDefault(); playItem(registry.get(pb.dataset.play)); return; }
  const go=e.target.closest('[data-go]');
  if(go){ setTab(go.dataset.go); if(go.dataset.go==='catalog' && !$('#cq').value.trim()) loadSuggestions(); return; }
  const s=e.target.closest('[data-search]');
  if(s){ setTab('catalog'); catTab='Album'; renderCatalog(); searchCatalog(s.dataset.search); return; }
  const pl=e.target.closest('[data-pl]');
  if(pl){ openPlaylist(pl.dataset.pl); return; }
  if(e.target.closest('[data-account]')){ document.getElementById('btnAccount').click(); return; }
  if(e.target.closest('[data-logout]')){ logout(); renderProfile(); toast('Sessão terminada.'); return; }
});
document.addEventListener('keydown',e=>{
  if((e.key==='Enter'||e.key===' ') && e.target.matches && e.target.matches('[data-search]')){ e.preventDefault(); e.target.click(); }
});

$('#ldecade').addEventListener('change',renderLibrary);
$('#lmin').addEventListener('change',renderLibrary);
setTab('home');

/* Instalar como app: iPhone (Safari, Adicionar ao ecrã principal) e Android (botão de instalar) */
(function(){
  const card=document.getElementById('instCard'), btn=document.getElementById('instBtn'), text=document.getElementById('instText');
  if(!card) return;
  const standalone=window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone===true;
  if(standalone) return;
  const ua=navigator.userAgent;
  const ios=/iPhone|iPad|iPod/.test(ua) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
  const safari=ios && !/CriOS|FxiOS|EdgiOS/.test(ua);
  let deferred=null;
  window.addEventListener('beforeinstallprompt', e=>{ e.preventDefault(); deferred=e; btn.hidden=false; card.hidden=false; });
  btn.addEventListener('click', async ()=>{ if(!deferred) return; deferred.prompt(); await deferred.userChoice.catch(()=>{}); deferred=null; btn.hidden=true; card.hidden=true; });
  window.addEventListener('appinstalled', ()=>{ card.hidden=true; });
  if(ios){
    card.hidden=false;
    text.textContent = safari
      ? 'Abre esta página no Safari, carrega em Partilhar e escolhe "Adicionar ao ecrã principal".'
      : 'Para instalar no iPhone, abre esta página no Safari (no Chrome não é possível) e escolhe "Adicionar ao ecrã principal".';
  }
})();

/* Atualização: avisa quando existe uma versão nova do site */
(function(){
  const bar=document.getElementById('updBar'), btn=document.getElementById('updBtn');
  if(!bar) return;
  let shown=false;
  async function check(){
    if(shown || document.visibilityState==='hidden') return;
    try{
      const r=await fetch('version.json?t='+Date.now(),{cache:'no-store'});
      if(!r.ok) return;
      const v=(await r.json()).version;
      if(v && v!==APP_VERSION){ shown=true; bar.hidden=false; }
    }catch(e){}
  }
  btn.addEventListener('click', async ()=>{
    btn.disabled=true; btn.textContent='A atualizar…';
    try{
      if('serviceWorker' in navigator){ const regs=await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r=>r.update().catch(()=>{}))); }
    }catch(e){}
    location.reload();
  });
  setTimeout(check, 4000);
  setInterval(check, 10*60*1000);
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') check(); });
})();

/* Painel de admin: lista de contas e país (dados do servidor de contas) */
(function(){
  const btn=document.getElementById('admOpen'), tok=document.getElementById('admTok'), out=document.getElementById('admOut');
  if(!btn) return;
  function msg(t){ out.textContent=t; }
  btn.addEventListener('click', async ()=>{
    const t=tok.value.trim();
    if(!t){ msg('Escreve o token de admin.'); return; }
    if(!ACCOUNTS_API){ msg('O servidor de contas ainda não está ligado.'); return; }
    msg('A carregar…');
    try{
      const r=await fetch(ACCOUNTS_API+'/admin/accounts',{headers:{Authorization:'Bearer '+t}});
      if(r.status===401){ msg('Token incorreto.'); return; }
      if(!r.ok) throw new Error('HTTP '+r.status);
      const data=await r.json();
      out.textContent='';
      const head=document.createElement('p'); head.textContent='Total de contas: '+data.total; out.appendChild(head);
      const wrap=document.createElement('div'); wrap.className='wrap';
      const table=document.createElement('table');
      table.innerHTML='<thead><tr><th scope="col">Email</th><th scope="col">Criada</th><th scope="col">País</th></tr></thead>';
      const tb=document.createElement('tbody');
      data.accounts.forEach(a=>{
        const tr=document.createElement('tr');
        [a.email, (a.createdAt||'').slice(0,10), a.country||'—'].forEach(v=>{ const td=document.createElement('td'); td.textContent=v; tr.appendChild(td); });
        tb.appendChild(tr);
      });
      table.appendChild(tb); wrap.appendChild(table); out.appendChild(wrap);
    }catch(e){ msg('Não foi possível carregar a lista. '+(e.message||'')); }
  });
})();
