#!/usr/bin/env node
// Perfil da MCR no X, pela API oficial (pago por uso, ~US$ 0,015 por post; link no post custa bem
// mais, por isso os posts automáticos não levam link: o link fica na bio).
// O publicar.js chama ciclo() a cada minuto, depois do Instagram; erro aqui não trava nada.
//
// O que sai sozinho (dias de pregão, nos horários dos Stories em config.json > x.diarios):
//   abertura   agenda 3 estrelas + Ibovespa/dólar da véspera, com a arte do Story 1
//   parcial    Brent, S&P 500, Nasdaq, BTC, VIX e ouro em texto
//   fechamento Ibovespa, dólar, maiores altas e baixas, com as artes 6, 4 e 5
//   enquete    sexta (config.x.enquete), mesma lista do Telegram (dados-base/enquetes.json)
//   feed       carrossel vira fio (4 imagens por post); Reels vai como vídeo ("x": false pula)
//
//   node x.js texto [abertura|parcial|fechamento] [data]   mostra os textos (não precisa de chave)
//   node x.js publicar <qual> [data]                       força um post agora
//
// Chaves (OAuth 1.0a do app no developer.x.com, com permissão Read and Write):
// X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET. Sem elas tudo aqui fica desligado.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const T = require('./textos');

const RAIZ = __dirname;
if (fs.existsSync(path.join(RAIZ, '.env'))) {
  for (const linha of fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/)) {
    const i = linha.indexOf('=');
    if (i > 0 && !process.env[linha.slice(0, i)]) process.env[linha.slice(0, i)] = linha.slice(i + 1);
  }
}
const config = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config.json'), 'utf8'));
const CX = config.x || {};
const API = 'https://api.x.com/2';
const lerJSON = (f, padrao) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : padrao);
const gravarJSON = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1) + '\n'); };
const ARQ_ESTADO = path.join(RAIZ, 'registro', 'x.json');
const arqDia = (data) => path.join(RAIZ, 'registro', `${data}-x.json`);
const hojeNoFuso = () => new Intl.DateTimeFormat('en-CA', { timeZone: config.fuso }).format(new Date());
const temChaves = () => ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'].every((k) => process.env[k]);

// ---------- OAuth 1.0a ----------
const pct = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
function assinatura(metodo, url, query = {}) {
  const o = {
    oauth_consumer_key: process.env.X_API_KEY, oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: process.env.X_ACCESS_TOKEN, oauth_version: '1.0',
  };
  // corpo JSON ou multipart não entra na assinatura; só a query e os campos oauth
  const params = Object.entries({ ...query, ...o }).map(([k, v]) => [pct(k), pct(String(v))]).sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1));
  const base = [metodo, pct(url), pct(params.map(([k, v]) => `${k}=${v}`).join('&'))].join('&');
  const chave = `${pct(process.env.X_API_SECRET)}&${pct(process.env.X_ACCESS_SECRET)}`;
  o.oauth_signature = crypto.createHmac('sha1', chave).update(base).digest('base64');
  return 'OAuth ' + Object.entries(o).map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(', ');
}

async function x(metodo, caminho, { json, form, query } = {}) {
  const url = `${API}/${caminho}`;
  const qs = query ? `?${new URLSearchParams(query)}` : '';
  const headers = { Authorization: assinatura(metodo, url, query) };
  let body;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) { body = new FormData(); for (const [k, v] of Object.entries(form)) body.append(k, v); }
  const r = await fetch(url + qs, { method: metodo, headers, body, signal: AbortSignal.timeout(120000) });
  const texto = await r.text();
  const j = texto ? JSON.parse(texto) : {};
  if (!r.ok || (j.errors && !j.data)) throw new Error(`X ${caminho}: HTTP ${r.status} ${j.detail || j.title || JSON.stringify(j.errors || j).slice(0, 200)}`);
  anotarUso(metodo, caminho, json, j);
  return j;
}

// Cada chamada que o X cobra fica anotada em registro/x-uso/AAAA-MM.json: é a base do relatório
// semanal e do custo do mês (relatorio.js). Preços em config.x.precos (conferir no console.x.com).
function anotarUso(metodo, caminho, json, resposta) {
  let tipo = null;
  if (metodo === 'POST' && caminho === 'tweets') tipo = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|br|net|io)\b/i.test(json?.text || '') ? 'post_com_link' : 'post';
  else if (metodo === 'GET' && caminho.startsWith('users/')) tipo = 'leitura_usuario';
  else if (metodo === 'GET' && caminho.startsWith('tweets')) tipo = 'leitura_post';
  else if (caminho === 'media/upload' && metodo === 'POST') tipo = 'midia';
  else if (caminho.endsWith('/finalize')) tipo = 'midia';
  if (!tipo) return;
  const agora = new Date();
  const mes = new Intl.DateTimeFormat('en-CA', { timeZone: config.fuso, year: 'numeric', month: '2-digit' }).format(agora);
  const arq = path.join(RAIZ, 'registro', 'x-uso', `${mes}.json`);
  const lista = lerJSON(arq, []);
  lista.push({ em: agora.toISOString(), tipo, id: resposta?.data?.id || null });
  gravarJSON(arq, lista);
}

// ---------- mídia ----------
async function subirImagem(arquivo) {
  const blob = new Blob([fs.readFileSync(arquivo)], { type: 'image/jpeg' });
  const j = await x('POST', 'media/upload', { form: { media: blob, media_category: 'tweet_image' } });
  return j.data.id;
}

async function subirVideo(arquivo) {
  const buf = fs.readFileSync(arquivo);
  const ini = await x('POST', 'media/upload/initialize', { json: { media_type: 'video/mp4', total_bytes: buf.length, media_category: 'tweet_video' } });
  const id = ini.data.id;
  const PEDACO = 4 * 1024 * 1024;
  for (let i = 0; i * PEDACO < buf.length; i++) {
    await x('POST', `media/upload/${id}/append`, { form: { media: new Blob([buf.subarray(i * PEDACO, (i + 1) * PEDACO)]), segment_index: String(i) } });
  }
  let st = (await x('POST', `media/upload/${id}/finalize`)).data?.processing_info;
  // o X processa o vídeo antes de aceitar no post
  for (let t = 0; st && st.state !== 'succeeded' && t < 60; t++) {
    if (st.state === 'failed') throw new Error(`vídeo recusado pelo X: ${st.error?.message || ''}`);
    await new Promise((ok) => setTimeout(ok, (st.check_after_secs || 5) * 1000));
    st = (await x('GET', 'media/upload', { query: { command: 'STATUS', media_id: id } })).data?.processing_info;
  }
  return id;
}

async function postar(texto, { midias = [], respondeA, enquete } = {}) {
  const json = { text: texto };
  if (midias.length) json.media = { media_ids: midias };
  if (respondeA) json.reply = { in_reply_to_tweet_id: respondeA };
  if (enquete) json.poll = enquete;
  return (await x('POST', 'tweets', { json })).data.id;
}

// ---------- textos (até 280 caracteres; o X conta acento como 1) ----------
const LIMITE = 280;
const sinal = (v) => (v == null ? 'sem pregão' : `${v > 0 ? '▲' : v < 0 ? '▼' : '='} ${T.pct(v)}`);
const preco = (a) => `${a.pre || ''}${T.num(a.preco, a.preco >= 10000 ? 0 : 2)}`;
const diaCurto = (data) => { const [, m, d] = data.split('-'); return `${T.diaSemana(data).slice(0, 3).toLowerCase()} ${d}/${m}`; };
// junta blocos até o limite; o que não couber fica de fora
function caber(blocos) {
  let out = '';
  for (const b of blocos) {
    const tent = out ? `${out}\n${b}` : b;
    if ([...tent].length <= LIMITE) out = tent;
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

async function abertura(data) {
  const { montar } = require('./gerar');
  const { calendario: c } = await montar(1, data);
  const b = [`Agenda de hoje, ${diaCurto(data)}`, ''];
  if (c.eventos.length) for (const e of c.eventos) b.push(`${e.hora} ${e.pais === 'Estados Unidos' ? 'EUA' : e.pais}: ${e.nome}${e.projecao ? ` (proj. ${e.projecao})` : ''}`);
  else b.push('Nenhum evento de 3 estrelas na agenda.');
  const preg = ultimoRegistro('pregao', data);
  if (preg) b.push('', `Ibovespa fechou ${T.quando(preg.data, data)} em ${T.num(preg.ibov.pontos, 0)} pts (${preg.ibov.var > 0 ? '+' : '−'}${T.pct(preg.ibov.var)}). Dólar a R$ ${T.num(preg.dolar.preco)}.`);
  if (c.radar.length) b.push('', `Na semana: ${c.radar.map((r) => `${r.nome} (${r.quando.toLowerCase()})`).join('; ')}`);
  return { texto: caber(b), imagens: [1], cartao: 'abertura' };
}

async function parcial(data) {
  const { montar } = require('./gerar');
  const { parcial: p } = await montar(3, data);
  const nomes = { 'Petróleo Brent': 'Brent' };
  return { texto: caber([`Parcial das ${p.hora}`, '', ...p.ativos.map((a) => `${nomes[a.nome] || a.nome} ${preco(a)} ${sinal(a.var)}`), '', 'Atraso de até 15 min.']), imagens: [], cartao: 'parcial' };
}

async function fechamento(data) {
  const reg = async (tipo, n) => {
    const f = path.join(RAIZ, 'registro', `${data}-${tipo}.json`);
    if (!fs.existsSync(f)) {
      if (data !== hojeNoFuso()) throw new Error(`sem registro de ${tipo} em ${data}`);
      await require('./gerar').montar(n, data);
    }
    return lerJSON(f);
  };
  const preg = await reg('pregao', 4);
  const lista = (xs) => xs.slice(0, 3).map((a) => `${a.cod} ${a.var > 0 ? '+' : '−'}${T.pct(a.var)}`).join(', ');
  const ib = preg.ibov;
  return {
    texto: caber([
      `Fechamento, ${diaCurto(data)}`, '',
      `Ibovespa ${T.num(ib.pontos, 0)} pts (${ib.var > 0 ? '+' : ib.var < 0 ? '−' : ''}${T.pct(ib.var)})`,
      `Dólar R$ ${T.num(preg.dolar.preco)} (${preg.dolar.var > 0 ? '+' : preg.dolar.var < 0 ? '−' : ''}${T.pct(preg.dolar.var)})`, '',
      preg.altas.length ? `Altas: ${lista(preg.altas)}` : '',
      preg.baixas.length ? `Baixas: ${lista(preg.baixas)}` : '',
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '')),
    imagens: [6, 4, 5], cartao: 'fechamento',
  };
}

const POSTS = { abertura, parcial, fechamento };

function ultimoRegistro(tipo, antesDe) {
  const pasta = path.join(RAIZ, 'registro');
  const f = fs.readdirSync(pasta).filter((n) => n.endsWith(`-${tipo}.json`) && n.slice(0, 10) < antesDe).sort().pop();
  return f ? lerJSON(path.join(pasta, f)) : null;
}

async function arte(data, n) {
  for (const base of ['fila', 'gerados']) {
    const f = path.join(RAIZ, base, data, `${n}.jpg`);
    if (fs.existsSync(f)) return f;
  }
  if (data !== hojeNoFuso()) throw new Error('arte não guardada e a data não é hoje');
  return require('./gerar').gerar(n, data);
}

async function enviar({ texto, imagens, cartao }, data) {
  const midias = [];
  // config.x.imagens: "cartao" = uma arte 16:9 por post; false = só texto; sem a chave = artes 9:16 dos Stories
  if (CX.imagens === 'cartao' && cartao) {
    try { midias.push(await subirImagem(await require('./cartao').gerarCartao(cartao, data))); } catch (e) { console.error(`x: sem cartão ${cartao}: ${e.message}`); }
    return [await postar(texto, { midias })];
  }
  for (const n of (CX.imagens === false || CX.imagens === 'cartao' ? [] : imagens.slice(0, 4))) {
    try { midias.push(await subirImagem(await arte(data, n))); } catch (e) { console.error(`x: sem arte ${n}: ${e.message}`); }
  }
  return [await postar(texto, { midias })];
}

// ---------- agenda ----------
const emMinutos = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

async function diarios(data, minutos, horarios) {
  const reg = lerJSON(arqDia(data), {});
  for (const [qual, slot] of Object.entries(CX.diarios || {})) {
    const atraso = minutos - emMinutos(horarios[slot - 1]);
    if (atraso < 0 || reg[qual] || atraso > (config.toleranciaMinutos ?? 90)) continue;
    try {
      reg[qual] = { ids: await enviar(await POSTS[qual](data), data), publicadoEm: new Date().toISOString() };
      gravarJSON(arqDia(data), reg);
      console.log(`x ${qual}: publicado`);
    } catch (e) { console.error(`x ${qual}: ${e.message}`); }
  }
}

async function enquete(data, minutos, estado) {
  const cfg = CX.enquete;
  if (!cfg || new Date(`${data}T12:00:00Z`).getUTCDay() !== cfg.diaSemana || estado.enquetes?.[data]) return;
  const atraso = minutos - emMinutos(cfg.hora);
  if (atraso < 0 || atraso > (config.toleranciaMinutos ?? 90)) return;
  const lista = lerJSON(path.join(RAIZ, 'dados-base', 'enquetes.json'), []);
  if (!lista.length) return;
  const q = lista[Object.keys(estado.enquetes || {}).length % lista.length];
  const id = await postar(q.pergunta, { enquete: { options: q.opcoes.slice(0, 4), duration_minutes: 1440 } });
  estado.enquetes = { ...(estado.enquetes || {}), [data]: { id, pergunta: q.pergunta } };
  console.log(`x enquete: ${q.pergunta}`);
}

// carrossel/Reels que o Instagram publicou nas últimas 3 h
async function feed(estado) {
  const regIG = lerJSON(path.join(RAIZ, 'registro', 'feed.json'), {});
  estado.feed = estado.feed || {};
  for (const [nome, r] of Object.entries(regIG)) {
    if (estado.feed[nome] || Date.now() - Date.parse(r.publicadoEm) > 3 * 3600e3) continue;
    const dir = path.join(RAIZ, 'feed', nome);
    const p = lerJSON(path.join(dir, 'post.json'));
    if (!p || p.x === false) { estado.feed[nome] = { pulado: true }; continue; }
    // texto do X: arquivo x.txt na pasta do post ou o primeiro parágrafo da legenda
    const proprio = path.join(dir, 'x.txt');
    const legenda = fs.readFileSync(path.join(dir, p.legenda), 'utf8').trim();
    let texto = fs.existsSync(proprio) ? fs.readFileSync(proprio, 'utf8').trim() : legenda.split(/\n\s*\n/)[0];
    if ([...texto].length > LIMITE) texto = [...texto].slice(0, LIMITE - 1).join('').replace(/\s+\S*$/, '') + '…';
    const ids = [];
    if (p.imagens) {
      // fio: 4 imagens por post, na ordem do carrossel
      for (let i = 0; i < p.imagens.length; i += 4) {
        const midias = [];
        for (const f of p.imagens.slice(i, i + 4)) midias.push(await subirImagem(path.join(dir, f)));
        ids.push(await postar(i === 0 ? texto : `${i / 4 + 1}/${Math.ceil(p.imagens.length / 4)}`, { midias, respondeA: ids[ids.length - 1] }));
      }
    } else ids.push(await postar(texto, { midias: [await subirVideo(path.join(dir, p.video))] }));
    estado.feed[nome] = { ids, publicadoEm: new Date().toISOString() };
    console.log(`x feed ${nome}: publicado`);
  }
}

// seguidores do perfil, uma vez por dia (consulta de perfil é paga: ~US$ 0,01; entra no relatório de custos)
async function seguidores(estado) {
  if (estado.perfil && estado.perfil.dia === hojeNoFuso()) return;
  const u = (await x('GET', 'users/me', { query: { 'user.fields': 'public_metrics' } })).data;
  const hist = (estado.seguidoresHistorico || []).filter((h) => h.dia !== hojeNoFuso());
  estado.perfil = { dia: hojeNoFuso(), usuario: u.username, seguidores: u.public_metrics?.followers_count ?? null, posts: u.public_metrics?.tweet_count ?? null, em: new Date().toISOString() };
  estado.seguidoresHistorico = [...hist, { dia: hojeNoFuso(), n: estado.perfil.seguidores }].slice(-120);
}

async function ciclo({ data, minutos, horarios, pregao }) {
  if (!temChaves() || CX.ativo === false || process.env.RESERVA_MIN_ATRASO) return;
  const estado = lerJSON(ARQ_ESTADO, {});
  const etapas = [['feed', () => feed(estado)], ['seguidores', () => seguidores(estado)]];
  if (pregao) etapas.push(['diários', () => diarios(data, minutos, horarios)], ['enquete', () => enquete(data, minutos, estado)]);
  for (const [nome, f] of etapas) {
    try { await f(); } catch (e) { console.error(`x ${nome}: ${e.message}`); }
    gravarJSON(ARQ_ESTADO, estado);
  }
}

module.exports = { ciclo, POSTS, x, postar };

if (require.main === module) {
  const [cmd, qual, dataArg] = process.argv.slice(2);
  const data = dataArg || hojeNoFuso();
  (async () => {
    if (cmd === 'texto') {
      for (const q of POSTS[qual] ? [qual] : Object.keys(POSTS)) {
        const p = await POSTS[q](data);
        console.log(`\n===== ${q} (${[...p.texto].length}/280${p.imagens.length ? `, artes ${p.imagens.join(', ')}` : ''}) =====\n${p.texto}`);
      }
    } else if (cmd === 'publicar' && POSTS[qual]) {
      const ids = await enviar(await POSTS[qual](data), data);
      const reg = lerJSON(arqDia(data), {}); reg[qual] = { ids, publicadoEm: new Date().toISOString(), manual: true }; gravarJSON(arqDia(data), reg);
      console.log(`publicado no X: ${qual} (${ids.join(', ')})`);
    } else console.log('uso: node x.js texto [abertura|parcial|fechamento] [data]\n     node x.js publicar <qual> [data]');
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
