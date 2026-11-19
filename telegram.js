#!/usr/bin/env node
// Canal da MCR no Telegram (@mcrupinvest), pelo robô oficial (Bot API). Roda junto com os Stories:
// o publicar.js chama ciclo() a cada minuto, depois do Instagram, e um erro aqui nunca trava os Stories.
//
// O que sai sozinho (dias de pregão, nos horários dos Stories em config.json):
//   abertura   (horário do Story 1)  agenda 3 estrelas + o que acompanhar, com a arte do Story 1
//   parcial    (horário do Story 3)  texto com Brent, S&P 500, Nasdaq, BTC, VIX e ouro
//   fechamento (horário do Story 6)  álbum com fechamento, altas e baixas + resumo escrito
//   enquete    (sexta, config.telegram.enquete.hora)  próxima pergunta de dados-base/enquetes.json
//   feed       todo carrossel/Reels de feed/ que saiu no Instagram vai também ("telegram": false pula)
//
// Alertas: quem está em TELEGRAM_AUTORIZADOS manda texto, foto, vídeo ou enquete para o robô no
// privado; ele responde com os botões Publicar / Cancelar e, no Publicar, copia para o canal.
//
//   node telegram.js previa [abertura|parcial|fechamento|boasvindas] [data]
//        manda a prévia no SEU privado (o primeiro ID de TELEGRAM_AUTORIZADOS), não no canal
//   node telegram.js texto [qual] [data]   só mostra os textos aqui no terminal (não precisa do robô)
//   node telegram.js publicar <qual> [data]   força um post no canal agora
//
// Variáveis: TELEGRAM_TOKEN (do @BotFather), TELEGRAM_CANAL (ID numérico ou @mcrupinvest),
// TELEGRAM_AUTORIZADOS (IDs separados por vírgula). Sem TELEGRAM_TOKEN tudo aqui fica desligado.

const fs = require('fs');
const path = require('path');
const T = require('./textos');

const RAIZ = __dirname;
if (fs.existsSync(path.join(RAIZ, '.env'))) {
  for (const linha of fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/)) {
    const i = linha.indexOf('=');
    if (i > 0 && !process.env[linha.slice(0, i)]) process.env[linha.slice(0, i)] = linha.slice(i + 1);
  }
}
const config = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config.json'), 'utf8'));
const TG = config.telegram || {};
const lerJSON = (f, padrao) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : padrao);
const gravarJSON = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1) + '\n'); };
const ARQ_ESTADO = path.join(RAIZ, 'registro', 'telegram.json'); // offset do robô, enquetes, pendentes, feed
const arqDia = (data) => path.join(RAIZ, 'registro', `${data}-telegram.json`);
const autorizados = () => String(process.env.TELEGRAM_AUTORIZADOS || '').split(',').map((s) => s.trim()).filter(Boolean);
const canal = () => process.env.TELEGRAM_CANAL || TG.canal || '@mcrupinvest';
const hojeNoFuso = () => new Intl.DateTimeFormat('en-CA', { timeZone: config.fuso }).format(new Date());
const AVISO = '<i>Conteúdo informativo, não é recomendação de investimento.</i>';

// ---------- Bot API ----------
async function api(metodo, params = {}, arquivos = {}) {
  const token = process.env.TELEGRAM_TOKEN;
  if (!token) throw new Error('falta TELEGRAM_TOKEN');
  const url = `https://api.telegram.org/bot${token}/${metodo}`;
  let corpo;
  if (Object.keys(arquivos).length) {
    corpo = new FormData();
    for (const [k, v] of Object.entries(params)) corpo.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    for (const [k, f] of Object.entries(arquivos)) corpo.append(k, new Blob([fs.readFileSync(f)]), path.basename(f));
  }
  for (let tentativa = 1; ; tentativa++) {
    const r = await fetch(url, corpo
      ? { method: 'POST', body: corpo, signal: AbortSignal.timeout(120000) }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(60000) });
    const j = await r.json();
    if (j.ok) return j.result;
    // limite de envio: o Telegram diz quantos segundos esperar
    if (j.parameters?.retry_after && tentativa < 3) { await new Promise((ok) => setTimeout(ok, (j.parameters.retry_after + 1) * 1000)); continue; }
    throw new Error(`Telegram ${metodo}: ${j.description}`);
  }
}

// ---------- formatação ----------
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sinal = (v) => (v == null ? 'sem pregão' : `${v > 0 ? '▲' : v < 0 ? '▼' : '='} ${v > 0 ? '+' : v < 0 ? '−' : ''}${T.pct(v)}`);
const preco = (a) => `${a.pre || ''}${T.num(a.preco, a.preco >= 10000 ? 0 : 2)}`;
// tabela alinhada em fonte fixa (no celular cabe ~32 colunas)
function tabela(ativos) {
  const nomes = { 'Petróleo Brent': 'Brent' };
  const linhas = ativos.map((a) => [nomes[a.nome] || a.nome, preco(a), sinal(a.var)]);
  const w0 = Math.max(...linhas.map((l) => l[0].length));
  const w1 = Math.max(...linhas.map((l) => l[1].length));
  return `<pre>${linhas.map(([n, p, v]) => `${n.padEnd(w0)}  ${p.padStart(w1)}  ${v}`).map(esc).join('\n')}</pre>`;
}
const tamanhoVisivel = (html) => html.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt);/g, '_').length;

// ---------- os posts ----------
async function abertura(data) {
  const { montar } = require('./gerar');
  const [{ calendario: c }, { acompanhar: a }] = [await montar(1, data), await montar(2, data)];
  const p = [`<b>Bom dia! ${esc(T.dataLonga(data))}</b>`, ''];
  if (c.eventos.length) {
    p.push('<b>Agenda de hoje</b> (3 estrelas)');
    for (const e of c.eventos) {
      p.push(`${esc(e.hora)} · ${esc(e.pais)} · ${esc(e.nome)}`);
      if (e.anterior) p.push(`<i>Anterior ${esc(e.anterior)}${e.projecao ? `, projeção ${esc(e.projecao)}` : ''}</i>`);
    }
  } else p.push('Nenhum evento de 3 estrelas na agenda de hoje.');
  p.push('', '<b>O que acompanhar</b>');
  for (const i of a.itens) p.push(`• <b>${esc(i.t)}:</b> ${esc(i.d)}`);
  if (c.radar.length) p.push('', `<b>Ainda nesta semana:</b> ${c.radar.map((r) => `${esc(r.nome)} (${esc(r.quando.toLowerCase())})`).join('; ')}`);
  p.push('', AVISO);
  return { texto: p.join('\n'), imagens: [1], cartao: 'abertura' };
}

async function parcial(data) {
  const { montar } = require('./gerar');
  const { parcial: p } = await montar(3, data);
  return { texto: [`<b>Parcial das ${esc(p.hora)}</b> · ${esc(T.dataLonga(data))}`, '', tabela(p.ativos), esc(p.apoio.split('. ').slice(1).join('. ')), '', `<i>${esc(p.nota)}</i>`].join('\n'), imagens: [], cartao: 'parcial' };
}

async function fechamento(data) {
  const { montar } = require('./gerar');
  const registro = async (tipo, n) => {
    const f = path.join(RAIZ, 'registro', `${data}-${tipo}.json`);
    if (!fs.existsSync(f)) {
      if (data !== hojeNoFuso()) throw new Error(`sem registro de ${tipo} em ${data}`);
      await montar(n, data);
    }
    return lerJSON(f);
  };
  const fech = await registro('fechamento', 6);
  const preg = await registro('pregao', 4);
  const lista = (xs) => xs.slice(0, 3).map((x) => `${esc(x.nome)} ${x.var > 0 ? '+' : '−'}${T.pct(x.var)}`).join(', ');
  const ib = preg.ibov;
  const p = [
    `<b>Fechamento</b> · ${esc(T.dataLonga(data))}`, '',
    `<b>Ibovespa</b> ${T.num(ib.pontos, 0)} pontos, ${ib.var === 0 ? 'estável' : `${ib.var > 0 ? 'alta' : 'queda'} de ${T.pct(ib.var)}`}`,
    `<b>Dólar</b> R$ ${T.num(preg.dolar.preco)} (${preg.dolar.var > 0 ? '+' : preg.dolar.var < 0 ? '−' : ''}${T.pct(preg.dolar.var)})`, '',
  ];
  if (preg.altas.length) p.push(`<b>Maiores altas:</b> ${lista(preg.altas)}`);
  if (preg.baixas.length) p.push(`<b>Maiores baixas:</b> ${lista(preg.baixas)}`);
  p.push('', '<b>Lá fora</b>', tabela(fech.ativos), AVISO);
  return { texto: p.join('\n'), imagens: [6, 4, 5], cartao: 'fechamento' };
}

function boasvindas() {
  return { texto: fs.readFileSync(path.join(RAIZ, 'dados-base', 'telegram-boasvindas.html'), 'utf8').trim(), imagens: [] };
}

const POSTS = { abertura, parcial, fechamento, boasvindas };

// arte do Story: a que já saiu hoje (gerados/ ou fila/) ou gera agora
async function arte(data, n) {
  for (const base of ['fila', 'gerados']) {
    const f = path.join(RAIZ, base, data, `${n}.jpg`);
    if (fs.existsSync(f)) return f;
  }
  // só gera arte do dia de hoje: gerar uma data passada buscaria cotação de agora e sobrescreveria o registro
  if (data !== hojeNoFuso()) throw new Error('arte não guardada e a data não é hoje');
  return require('./gerar').gerar(n, data);
}

// envia texto + imagens para um chat; devolve os IDs das mensagens
async function enviar(chat, { texto, imagens, cartao }, data) {
  const html = { parse_mode: 'HTML' };
  const arqs = [];
  // config.telegram.imagens: "cartao" = uma arte 16:9 por post (cartao.js); false = só texto; sem a chave = artes 9:16 dos Stories
  if (TG.imagens === 'cartao' && cartao) arqs.push(await require('./cartao').gerarCartao(cartao, data).catch((e) => { console.error(`telegram: sem cartão ${cartao}: ${e.message}`); return null; }));
  else for (const n of (TG.imagens === false || TG.imagens === 'cartao' ? [] : imagens)) arqs.push(await arte(data, n).catch((e) => { console.error(`telegram: sem arte ${n}: ${e.message}`); return null; }));
  const fotos = arqs.filter(Boolean);
  const cabe = tamanhoVisivel(texto) <= 1024;
  const ids = [];
  if (fotos.length === 1) {
    const m = await api('sendPhoto', { chat_id: chat, ...(cabe ? { caption: texto, ...html } : {}) }, { photo: fotos[0] });
    ids.push(m.message_id);
  } else if (fotos.length > 1) {
    const media = fotos.map((f, i) => ({ type: 'photo', media: `attach://f${i}`, ...(i === 0 && cabe ? { caption: texto, ...html } : {}) }));
    const ms = await api('sendMediaGroup', { chat_id: chat, media }, Object.fromEntries(fotos.map((f, i) => [`f${i}`, f])));
    ids.push(...ms.map((m) => m.message_id));
  }
  if (!fotos.length || !cabe) {
    const m = await api('sendMessage', { chat_id: chat, text: texto, ...html, link_preview_options: { is_disabled: true } });
    ids.push(m.message_id);
  }
  return ids;
}

// ---------- agenda do dia ----------
const emMinutos = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

async function diarios(data, minutos, horarios) {
  const reg = lerJSON(arqDia(data), {});
  const slots = Object.values(TG.diarios || {}).sort((a, b) => a - b);
  for (const [qual, slot] of Object.entries(TG.diarios || {})) {
    const atraso = minutos - emMinutos(horarios[slot - 1]);
    if (atraso < 0 || reg[qual]) continue;
    // atrasado ainda sai, até a hora do próximo post do dia (o fechamento vale até o fim do dia)
    const prox = slots.find((s) => s > slot);
    if (minutos >= (prox ? emMinutos(horarios[prox - 1]) : 24 * 60)) continue;
    try {
      const ids = await enviar(canal(), await POSTS[qual](data), data);
      reg[qual] = { ids, publicadoEm: new Date().toISOString() };
      gravarJSON(arqDia(data), reg);
      console.log(`telegram ${qual}: publicado`);
    } catch (e) { console.error(`telegram ${qual}: ${e.message}`); }
  }
}

async function enquete(data, minutos, estado) {
  const cfg = TG.enquete;
  if (!cfg) return;
  const semana = new Date(`${data}T12:00:00Z`).getUTCDay();
  if (semana !== cfg.diaSemana || minutos < emMinutos(cfg.hora) || estado.enquetes?.[data]) return;
  if (minutos - emMinutos(cfg.hora) > (config.toleranciaMinutos ?? 90)) return;
  const lista = lerJSON(path.join(RAIZ, 'dados-base', 'enquetes.json'), []);
  if (!lista.length) return;
  const usadas = Object.keys(estado.enquetes || {}).length;
  const q = lista[usadas % lista.length];
  const m = await api('sendPoll', { chat_id: canal(), question: q.pergunta, options: q.opcoes.map((text) => ({ text })), is_anonymous: true });
  estado.enquetes = { ...(estado.enquetes || {}), [data]: { id: m.message_id, pergunta: q.pergunta } };
  console.log(`telegram enquete: ${q.pergunta}`);
}

// espelho do feed: posts que o Instagram publicou nas últimas 3 h
async function feed(estado) {
  const regIG = lerJSON(path.join(RAIZ, 'registro', 'feed.json'), {});
  estado.feed = estado.feed || {};
  for (const [nome, r] of Object.entries(regIG)) {
    if (estado.feed[nome] || Date.now() - Date.parse(r.publicadoEm) > 3 * 3600e3) continue;
    const dir = path.join(RAIZ, 'feed', nome);
    const p = lerJSON(path.join(dir, 'post.json'));
    if (!p || p.telegram === false) { estado.feed[nome] = { pulado: true }; continue; }
    const legenda = esc(fs.readFileSync(path.join(dir, p.legenda), 'utf8').trim());
    const cabe = legenda.length <= 1024;
    const ids = [];
    if (p.imagens) {
      const fotos = p.imagens.slice(0, 10);
      const media = fotos.map((f, i) => ({ type: 'photo', media: `attach://f${i}`, ...(i === 0 && cabe ? { caption: legenda, parse_mode: 'HTML' } : {}) }));
      ids.push(...(await api('sendMediaGroup', { chat_id: canal(), media }, Object.fromEntries(fotos.map((f, i) => [`f${i}`, path.join(dir, f)])))).map((m) => m.message_id));
    } else {
      const arqs = { video: path.join(dir, p.video) };
      if (p.capa) arqs.cover = path.join(dir, p.capa);
      const params = { chat_id: canal(), supports_streaming: true, ...(cabe ? { caption: legenda, parse_mode: 'HTML' } : {}), ...(p.capa ? { cover: 'attach://cover' } : {}) };
      ids.push((await api('sendVideo', params, arqs)).message_id);
    }
    if (!cabe) ids.push((await api('sendMessage', { chat_id: canal(), text: legenda, parse_mode: 'HTML', link_preview_options: { is_disabled: true } })).message_id);
    estado.feed[nome] = { ids, publicadoEm: new Date().toISOString() };
    console.log(`telegram feed ${nome}: publicado`);
  }
}

// ---------- robô de alertas ----------
const BOTOES = (chave) => ({ inline_keyboard: [[{ text: 'Publicar no canal', callback_data: `pub:${chave}` }, { text: 'Cancelar', callback_data: `nao:${chave}` }]] });

async function robo(estado) {
  const updates = await api('getUpdates', { offset: (estado.offset || 0) + 1, timeout: 0, allowed_updates: ['message', 'callback_query'] });
  estado.pendentes = estado.pendentes || {};
  const ok = new Set(autorizados());
  for (const u of updates) {
    estado.offset = u.update_id;
    const m = u.message;
    if (m && m.chat.type === 'private') {
      const de = String(m.from.id);
      if (!ok.has(de)) {
        await api('sendMessage', { chat_id: m.chat.id, text: `Este robô publica no canal da MCR Up Invest.\nSeu ID é ${de}. Para liberar o envio, passe esse número para o Otávio.` });
        continue;
      }
      if (m.text === '/start' || m.text === '/ajuda') {
        await api('sendMessage', { chat_id: m.chat.id, text: 'Mande aqui o texto, foto, vídeo ou enquete que deve sair no canal. Eu respondo com uma prévia e o botão para publicar.\n\nÁlbum de fotos: mande junto, numa mensagem só.' });
        continue;
      }
      // álbum chega como várias mensagens com o mesmo media_group_id: um pedido só
      const grupo = m.media_group_id;
      const existente = grupo && Object.entries(estado.pendentes).find(([, p]) => p.grupo === grupo);
      if (existente) { existente[1].ids.push(m.message_id); continue; }
      const chave = `${m.chat.id}-${m.message_id}`.slice(-40);
      estado.pendentes[chave] = { chat: m.chat.id, ids: [m.message_id], grupo, em: Date.now() };
      await api('sendMessage', { chat_id: m.chat.id, text: 'Publico isso no canal @mcrupinvest?', reply_parameters: { message_id: m.message_id }, reply_markup: BOTOES(chave) });
    }
    const cb = u.callback_query;
    if (cb) {
      const [acao, chave] = cb.data.split(':');
      const p = estado.pendentes[chave];
      let resposta = 'Esse pedido já foi resolvido.';
      if (p && ok.has(String(cb.from.id))) {
        if (acao === 'pub') {
          await api('copyMessages', { chat_id: canal(), from_chat_id: p.chat, message_ids: p.ids.sort((a, b) => a - b) });
          resposta = 'Publicado no canal.';
        } else resposta = 'Cancelado, nada foi publicado.';
        delete estado.pendentes[chave];
      }
      await api('answerCallbackQuery', { callback_query_id: cb.id, text: resposta }).catch(() => {});
      if (cb.message) await api('editMessageText', { chat_id: cb.message.chat.id, message_id: cb.message.message_id, text: resposta }).catch(() => {});
    }
  }
  // pedido esquecido some depois de 2 dias
  for (const [k, p] of Object.entries(estado.pendentes)) if (Date.now() - p.em > 2 * 86400e3) delete estado.pendentes[k];
}

// ---------- chamado pelo publicar.js a cada minuto ----------
// inscritos do canal, de hora em hora (o painel lê daqui; a Bot API não cobra)
async function inscritos(estado) {
  if (estado.inscritos && Date.now() - Date.parse(estado.inscritos.em) < 3600e3) return;
  const n = await api('getChatMemberCount', { chat_id: canal() });
  const hist = (estado.inscritosHistorico || []).filter((h) => h.dia !== hojeNoFuso());
  estado.inscritos = { n, em: new Date().toISOString() };
  estado.inscritosHistorico = [...hist, { dia: hojeNoFuso(), n }].slice(-120);
}

async function ciclo({ data, minutos, horarios, pregao }) {
  if (!process.env.TELEGRAM_TOKEN || TG.ativo === false) return;
  if (process.env.RESERVA_MIN_ATRASO) return; // só a nuvem fala com o Telegram (o robô não aceita dois leitores)
  const estado = lerJSON(ARQ_ESTADO, {});
  const etapas = [['robô', () => robo(estado)], ['feed', () => feed(estado)], ['inscritos', () => inscritos(estado)]];
  if (pregao) etapas.push(['diários', () => diarios(data, minutos, horarios)], ['enquete', () => enquete(data, minutos, estado)]);
  for (const [nome, f] of etapas) {
    try { await f(); } catch (e) { console.error(`telegram ${nome}: ${e.message}`); }
    gravarJSON(ARQ_ESTADO, estado);
  }
}

module.exports = { ciclo, POSTS, enviar, api };

if (require.main === module) {
  const [cmd, qualArg, dataArg] = process.argv.slice(2);
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: config.fuso }).format(new Date());
  const data = dataArg || hoje;
  const quais = qualArg && POSTS[qualArg] ? [qualArg] : ['boasvindas', 'abertura', 'parcial', 'fechamento'];
  (async () => {
    if (cmd === 'texto') {
      for (const q of quais) {
        const p = await POSTS[q](data);
        console.log(`\n===== ${q} (${tamanhoVisivel(p.texto)} caracteres${p.imagens.length ? `, artes ${p.imagens.join(', ')}` : ''}) =====\n${p.texto}`);
      }
    } else if (cmd === 'previa') {
      const eu = autorizados()[0];
      if (!eu) throw new Error('falta TELEGRAM_AUTORIZADOS (rode node configurar-telegram.js)');
      for (const q of quais) { await enviar(eu, await POSTS[q](data), data); console.log(`prévia ${q}: enviada no seu privado`); }
    } else if (cmd === 'publicar' && POSTS[qualArg]) {
      const ids = await enviar(canal(), await POSTS[qualArg](data), data);
      if (qualArg !== 'boasvindas') { const reg = lerJSON(arqDia(data), {}); reg[qualArg] = { ids, publicadoEm: new Date().toISOString(), manual: true }; gravarJSON(arqDia(data), reg); }
      console.log(`publicado no canal: ${qualArg} (${ids.join(', ')})`);
      return ids;
    } else {
      console.log('uso: node telegram.js texto|previa [abertura|parcial|fechamento|boasvindas] [data]\n     node telegram.js publicar <qual> [data]');
    }
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
