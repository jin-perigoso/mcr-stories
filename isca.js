#!/usr/bin/env node
// Isca de captação: quem comenta a palavra-chave num post do feed recebe o material no direct.
//
// No post.json do feed:  "isca": { "palavra": "GUIA", "link": "https://...", "dias": 7, "mensagem": "isca-dm.txt" }
// "mensagem" é um arquivo na pasta do post; {link} vira o link. Sem ele, usa um texto padrão.
//
// A cada 3 minutos (só na nuvem): lê os comentários dos posts com isca publicados há até "dias" dias,
// manda uma resposta privada (Private Replies da Meta: uma por comentário, até 7 dias) e responde
// o comentário em público. registro/isca.json guarda só contagens e IDs cifrados (o repositório é público).
//
//   node isca.js testar <pasta-do-feed>   lista os comentários que seriam atendidos, sem enviar nada

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = __dirname;
const config = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config.json'), 'utf8'));
const GRAPH = `https://graph.facebook.com/${config.graphVersao || 'v23.0'}`;
const ARQ = path.join(RAIZ, 'registro', 'isca.json');
const lerJSON = (f, p) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : p);
const gravar = (v) => { fs.mkdirSync(path.dirname(ARQ), { recursive: true }); fs.writeFileSync(ARQ, JSON.stringify(v, null, 1) + '\n'); };
const cifra = (id) => crypto.createHash('sha256').update(`mcr:${id}`).digest('hex').slice(0, 16);
const normal = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function graph(metodo, caminho, params, token) {
  const url = new URL(`${GRAPH}/${caminho}`);
  const opcoes = { method: metodo, signal: AbortSignal.timeout(30000) };
  if (metodo === 'GET') for (const [k, v] of Object.entries({ ...params, access_token: token })) url.searchParams.set(k, v);
  else { url.searchParams.set('access_token', token); opcoes.headers = { 'Content-Type': 'application/json' }; opcoes.body = JSON.stringify(params); }
  const j = await (await fetch(url, opcoes)).json();
  if (j.error) throw new Error(`${j.error.message} (código ${j.error.code}${j.error.error_subcode ? `/${j.error.error_subcode}` : ''})`);
  return j;
}

// token da Página ligada ao Instagram (Private Replies saem pela Página)
let pagina = null;
async function tokenPagina() {
  if (pagina) return pagina;
  const contas = await graph('GET', 'me/accounts', { fields: 'id,access_token,instagram_business_account' }, process.env.IG_TOKEN);
  const p = (contas.data || []).find((c) => c.instagram_business_account?.id === process.env.IG_USER_ID);
  if (!p) throw new Error('nenhuma Página ligada ao Instagram da MCR neste token');
  pagina = { id: p.id, token: p.access_token };
  return pagina;
}

async function comentarios(mediaId) {
  const lista = [];
  let depois = null;
  for (let i = 0; i < 20; i++) {
    const j = await graph('GET', `${mediaId}/comments`, { fields: 'id,text,timestamp,from', limit: '50', ...(depois ? { after: depois } : {}) }, process.env.IG_TOKEN);
    lista.push(...(j.data || []));
    depois = j.paging?.cursors?.after;
    if (!j.paging?.next) break;
  }
  return lista;
}

const PADRAO = 'Oi! Aqui está o material que você pediu: {link}\n\nSe quiser, um assessor da MCR faz a conta com os seus números, sem custo. É só responder esta mensagem.';

async function atender({ simular = false } = {}) {
  if (!process.env.IG_TOKEN || !process.env.IG_USER_ID) return;
  const regFeed = lerJSON(path.join(RAIZ, 'registro', 'feed.json'), {});
  const estado = lerJSON(ARQ, {});
  if (!simular && estado._ultima && Date.now() - Date.parse(estado._ultima) < 3 * 60e3) return;
  const dir = path.join(RAIZ, 'feed');
  for (const nome of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const p = lerJSON(path.join(dir, nome, 'post.json'));
    const r = regFeed[nome];
    if (!p?.isca || !r?.mediaId) continue;
    if (Date.now() - Date.parse(r.publicadoEm) > (p.isca.dias || 7) * 86400e3) continue;
    const st = estado[nome] || (estado[nome] = { palavra: p.isca.palavra, pedidos: 0, enviados: 0, falhas: 0, feitos: {} });
    const chave = normal(p.isca.palavra);
    const msgArq = p.isca.mensagem && path.join(dir, nome, p.isca.mensagem);
    const texto = (msgArq && fs.existsSync(msgArq) ? fs.readFileSync(msgArq, 'utf8').trim() : PADRAO).replace('{link}', p.isca.link);
    for (const c of await comentarios(r.mediaId)) {
      const h = cifra(c.id);
      if (st.feitos[h]) continue;
      if (c.from?.id === process.env.IG_USER_ID) continue; // resposta da própria MCR
      if (!new RegExp(`(^|[^a-z])${chave}([^a-z]|$)`).test(normal(c.text))) continue;
      if (simular) { console.log(`atenderia: "${c.text}" (${c.timestamp})`); continue; }
      st.pedidos++;
      try {
        const pg = await tokenPagina();
        await graph('POST', `${pg.id}/messages`, { recipient: { comment_id: c.id }, message: { text: texto } }, pg.token);
        st.enviados++;
        st.feitos[h] = { em: new Date().toISOString(), ok: true };
        // resposta pública curta, para quem vê o post saber que funciona
        await graph('POST', `${c.id}/replies`, { message: 'Enviado no seu direct!' }, process.env.IG_TOKEN).catch((e) => console.error(`isca: resposta pública falhou (${e.message})`));
        console.log(`isca ${nome}: guia enviado no direct`);
      } catch (e) {
        st.falhas++;
        st.feitos[h] = { em: new Date().toISOString(), ok: false, erro: e.message.slice(0, 120) };
        console.error(`isca ${nome}: falhou (${e.message})`);
      }
      gravar({ ...estado, _ultima: new Date().toISOString() });
    }
  }
  if (!simular) gravar({ ...estado, _ultima: new Date().toISOString() });
}

module.exports = { atender };

if (require.main === module) {
  if (fs.existsSync(path.join(RAIZ, '.env'))) {
    for (const l of fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0 && !process.env[l.slice(0, i)]) process.env[l.slice(0, i)] = l.slice(i + 1); }
  }
  const [cmd] = process.argv.slice(2);
  if (cmd === 'testar') atender({ simular: true }).then(() => tokenPagina()).then((p) => console.log(`Página ${p.id}: token ok`)).catch((e) => { console.error(e.message); process.exit(1); });
  else console.log('uso: node isca.js testar');
}
