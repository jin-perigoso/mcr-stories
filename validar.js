// Confere os dados de cada Story antes de virar imagem. Se algo não fecha, o Story não é gerado:
// o publicar.js tenta de novo no minuto seguinte (até a tolerância do horário) e, persistindo,
// a execução falha e o GitHub avisa por e-mail. Nada é publicado com dado suspeito.

const F = require('./fontes');

// variação diária máxima plausível por ativo (acima disso é erro de fonte, não mercado)
const LIMITE_VAR = { OIL: 15, SP500: 8, NASDAQ: 10, BTC: 20, VIX: 60, GOLD: 8 };
const pertoDe = (a, b, tol) => Math.abs(a / b - 1) * 100 <= tol;
const diaUtilEUA = (data) => ![0, 6].includes(new Date(`${data}T12:00:00Z`).getUTCDay());

async function validarGlobais(rotulo, bloco, data) {
  const erros = [];
  for (const a of bloco.ativos) {
    if (!(a.preco > 0) || !Number.isFinite(a.preco)) erros.push(`${a.nome}: preço inválido (${a.preco})`);
    if (a.var !== null && Math.abs(a.var) > (LIMITE_VAR[a.chave] ?? 15)) erros.push(`${a.nome}: variação de ${a.var}% fora do plausível`);
    const c = a.conf || {};
    // futuros: a barra diária e o preço intradiário têm de bater (pega série parada ou trocada)
    if (c.intradiario && !pertoDe(a.preco, c.intradiario, 1.5)) erros.push(`${a.nome}: barra diária ${a.preco} e intradiário ${c.intradiario} não batem`);
  }
  // em dia útil nos EUA, as bolsas de lá precisam ter negociado hoje
  if (diaUtilEUA(data)) {
    for (const a of bloco.ativos.filter((x) => ['SP500', 'NASDAQ'].includes(x.chave))) {
      if (a.conf?.negociadoEm !== data) erros.push(`${a.nome}: último negócio em ${a.conf?.negociadoEm}, não hoje`);
    }
  }
  // cotação velha: na parcial, nada com mais de 40 min (exceto o que não abriu hoje)
  if (rotulo === 'parcial') {
    for (const a of bloco.ativos) {
      if (a.var !== null && a.conf?.horario && Date.now() - a.conf.horario > 40 * 60e3) erros.push(`${a.nome}: cotação de ${Math.round((Date.now() - a.conf.horario) / 60e3)} min atrás`);
    }
  }
  // segunda fonte para o bitcoin
  const btc = bloco.ativos.find((x) => x.chave === 'BTC');
  const ref = await F.bitcoinCoinGecko().catch(() => null);
  if (btc && ref && !pertoDe(btc.preco, ref, 2)) erros.push(`Bitcoin: Yahoo ${btc.preco} x CoinGecko ${ref}`);
  return erros;
}

async function validarPregao(p, data) {
  const erros = [];
  const c = p.conf || {};
  if (c.ibovData !== data) erros.push(`Ibovespa com último negócio em ${c.ibovData}, não hoje`);
  if (!c.fimPregao || p.geradoEm < c.fimPregao) erros.push('foto do pregão tirada antes do fechamento da B3');
  if (c.carteira && c.acoes < c.carteira * 0.8) erros.push(`só ${c.acoes} de ${c.carteira} ações do índice com cotação de hoje`);
  for (const a of [...p.altas, ...p.baixas]) {
    if (!(a.preco > 0) || Math.abs(a.var) > 40) erros.push(`${a.cod}: preço ${a.preco} / variação ${a.var}% suspeitos`);
  }
  if (p.altas.some((a) => a.var <= 0) || p.baixas.some((a) => a.var >= 0)) erros.push('sinal trocado entre altas e baixas');
  if (Math.abs(p.ibov.var) > 12) erros.push(`Ibovespa com variação de ${p.ibov.var}%`);
  const dolar = await F.dolarAwesome().catch(() => null);
  if (dolar && !pertoDe(p.dolar.preco, dolar, 1)) erros.push(`dólar: Yahoo ${p.dolar.preco} x AwesomeAPI ${dolar}`);
  return erros;
}

function validarAgenda(dados, data) {
  const erros = [];
  const cal = dados.calendario;
  if (cal && !cal.titulo?.includes(` ${Number(data.slice(8))} de `)) erros.push(`título do calendário sem a data de hoje (${cal.titulo})`);
  if (cal?.conf && !(cal.conf.de <= data && data <= cal.conf.ate)) erros.push(`calendário cobre ${cal.conf.de} a ${cal.conf.ate}, não hoje`);
  const ac = dados.acompanhar;
  if (ac && !(ac.itens?.length >= 2)) erros.push('"O que acompanhar" com menos de 2 itens');
  return erros;
}

async function validar(n, dados) {
  const data = dados.data;
  let erros = [];
  if (n === 1 || n === 2) erros = validarAgenda(dados, data);
  if (n === 3) erros = await validarGlobais('parcial', dados.parcial, data);
  if (n === 6) erros = await validarGlobais('fechamento', dados.fechamento, data);
  if (n === 4 || n === 5) erros = await validarPregao(dados.pregao, data);
  if (erros.length) throw new Error(`Story ${n} reprovado na conferência: ${erros.join('; ')}`);
}

module.exports = { validar };
