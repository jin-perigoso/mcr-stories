// Fontes de dados dos Stories: cotações (Yahoo Finance), calendário econômico (Forex Factory),
// carteira teórica do Ibovespa (B3). Tudo público, sem chave de API.

const fs = require('fs');
const path = require('path');

const RAIZ = __dirname;
const UA = { 'User-Agent': 'Mozilla/5.0 (mcr-stories)' };

async function buscar(url, tentativas = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= tentativas) throw new Error(`${url.split('?')[0]}: ${e.message}`);
      await new Promise((ok) => setTimeout(ok, 1500 * i));
    }
  }
}

// data AAAA-MM-DD de um instante num fuso
const dataNoFuso = (ms, fuso) => new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);

// ---------- cotações ----------
// Devolve preço atual, fechamento anterior, variação e a data da última negociação na bolsa de origem.
async function cotacao(simbolo) {
  const j = await buscar(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(simbolo)}?range=1d&interval=5m`);
  const m = j.chart?.result?.[0]?.meta;
  if (!m || m.regularMarketPrice == null) throw new Error(`sem cotação para ${simbolo}`);
  const anterior = m.chartPreviousClose ?? m.previousClose;
  return {
    simbolo,
    preco: m.regularMarketPrice,
    anterior,
    var: anterior ? (m.regularMarketPrice / anterior - 1) * 100 : null,
    negociadoEm: dataNoFuso(m.regularMarketTime * 1000, m.exchangeTimezoneName || 'UTC'),
    horario: m.regularMarketTime * 1000,
  };
}

async function emLotes(itens, tamanho, fn) {
  const saida = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    const lote = await Promise.allSettled(itens.slice(i, i + tamanho).map(fn));
    saida.push(...lote);
  }
  return saida;
}

// ---------- carteira do Ibovespa (B3), guardada por 7 dias ----------
async function carteiraIbov() {
  const cache = path.join(RAIZ, 'dados-base', 'ibov-carteira.json');
  if (fs.existsSync(cache)) {
    const c = JSON.parse(fs.readFileSync(cache, 'utf8'));
    if (Date.now() - c.atualizadoEm < 7 * 86400e3) return c.ativos;
  }
  try {
    const p = Buffer.from(JSON.stringify({ language: 'pt-br', pageNumber: 1, pageSize: 150, index: 'IBOV', segment: '1' })).toString('base64');
    const j = await buscar(`https://sistemaswebb3-listados.b3.com.br/indexProxy/indexCall/GetPortfolioDay/${p}`);
    const ativos = j.results.map((r) => ({ cod: r.cod.trim(), nomeB3: r.asset.trim() }));
    if (ativos.length < 50) throw new Error(`carteira com só ${ativos.length} ativos`);
    fs.writeFileSync(cache, JSON.stringify({ atualizadoEm: Date.now(), ativos }, null, 1) + '\n');
    return ativos;
  } catch (e) {
    if (fs.existsSync(cache)) { console.warn(`aviso: B3 fora do ar, usando carteira guardada (${e.message})`); return JSON.parse(fs.readFileSync(cache, 'utf8')).ativos; }
    throw e;
  }
}

// ---------- calendário econômico (Forex Factory, semana corrente) ----------
// O feed limita acessos repetidos (HTTP 429): a cópia vale 3 horas.
async function calendarioSemana() {
  const cache = path.join(RAIZ, 'dados-base', 'calendario-semana.json');
  const guardado = fs.existsSync(cache) ? JSON.parse(fs.readFileSync(cache, 'utf8')) : null;
  const eventosGuardados = guardado && (Array.isArray(guardado) ? guardado : guardado.eventos);
  if (guardado && !Array.isArray(guardado) && Date.now() - guardado.atualizadoEm < 3 * 3600e3) return eventosGuardados;
  try {
    const eventos = await buscar('https://nfs.faireconomy.media/ff_calendar_thisweek.json');
    fs.writeFileSync(cache, JSON.stringify({ atualizadoEm: Date.now(), eventos }) + '\n');
    return eventos;
  } catch (e) {
    if (eventosGuardados) { console.warn(`aviso: calendário fora do ar, usando cópia guardada (${e.message})`); return eventosGuardados; }
    throw e;
  }
}

module.exports = { cotacao, emLotes, carteiraIbov, calendarioSemana, dataNoFuso };
