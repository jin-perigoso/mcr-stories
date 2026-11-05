#!/usr/bin/env node
// Gera os Stories da MCR a partir de dados ao vivo e do modelo aprovado (modelos/story.html).
//
//   node gerar.js <1-6|todos> [data]      gera em gerados/AAAA-MM-DD/n.jpg
//
// Textos manuais (opcional): fila/AAAA-MM-DD/textos.json
//   { "apoio": { "3": "frase" }, "acompanhar": [{ "t": "título", "d": "texto" }], "acompanharExtra": [...] }
// "acompanhar" substitui os itens automáticos; "acompanharExtra" entra antes deles.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const F = require('./fontes');
const T = require('./textos');

const RAIZ = __dirname;
const config = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config.json'), 'utf8'));
const FUSO = config.fuso;
const lerJSON = (f, padrao) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : padrao);
const NOMES = lerJSON(path.join(RAIZ, 'dados-base', 'nomes.json'), {});

const ATIVOS = [
  { nome: 'Petróleo Brent', cod: 'BRENT', chave: 'OIL', sym: 'BZ=F', pre: 'US$ ' },
  { nome: 'S&P 500', cod: 'SP500', sym: '^GSPC' },
  { nome: 'Nasdaq', cod: 'NASDAQ', sym: '^IXIC' },
  { nome: 'Bitcoin', cod: 'BTC', sym: 'BTC-USD', pre: 'US$ ', diaInteiro: true },
  { nome: 'VIX', cod: 'Volatilidade do S&P 500', chave: 'VIX', sym: '^VIX' },
  { nome: 'Ouro', cod: 'GOLD', sym: 'GC=F', pre: 'US$ ' },
];

function horaAgora() {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
}
const horaDoEvento = (ms) => new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
const subiuCaiu = (v) => (v > 0 ? 'subiu' : v < 0 ? 'caiu' : 'ficou estável');
const altaQueda = (v) => (v >= 0 ? 'alta' : 'queda');
const textosManuais = (data) => lerJSON(path.join(RAIZ, 'fila', data, 'textos.json'), {});

function salvarRegistro(nome, conteudo) {
  fs.mkdirSync(path.join(RAIZ, 'registro'), { recursive: true });
  fs.writeFileSync(path.join(RAIZ, 'registro', nome), JSON.stringify(conteudo, null, 1) + '\n');
}
// registro mais recente de um tipo antes da data (o último fechamento conhecido)
function ultimoRegistro(tipo, antesDe) {
  const pasta = path.join(RAIZ, 'registro');
  if (!fs.existsSync(pasta)) return null;
  const f = fs.readdirSync(pasta).filter((x) => x.endsWith(`-${tipo}.json`) && x.slice(0, 10) < antesDe).sort().pop();
  return f ? lerJSON(path.join(pasta, f)) : null;
}

// ---------- 1 · agenda ----------
async function agenda(data) {
  const ff = await F.calendarioSemana();
  const eventos = ff
    .filter((e) => e.impact === 'High' && config.paisesCalendario.includes(e.country))
    .map((e) => {
      const ms = new Date(e.date).getTime();
      const tr = T.traduzirEvento(e.title);
      const hhmm = horaDoEvento(ms);
      return {
        data: F.dataNoFuso(ms, FUSO), hhmm, diaTodo: tr.diaTodo || Number(hhmm.slice(3)) % 5 !== 0,
        pais: e.country, nome: tr.pt, desc: tr.desc, peso: tr.peso,
        anterior: T.valorBR(e.previous), projecao: T.valorBR(e.forecast),
      };
    });
  for (const b of lerJSON(path.join(RAIZ, 'dados-base', 'agenda-br.json'), { eventos: [] }).eventos) {
    eventos.push({ data: b.data, hhmm: b.hora, diaTodo: !b.hora, pais: 'BRL', nome: b.nome, desc: b.desc || '', peso: 9,
      anterior: b.anterior || '', projecao: b.projecao || '', fonte: b.fonte });
  }
  // vários indicadores no mesmo horário e país (payroll + desemprego + salários): fica o de maior peso
  const porHorario = new Map();
  for (const e of eventos) {
    const k = `${e.data} ${e.diaTodo ? 'dia' : e.hhmm} ${e.pais}`;
    if (!porHorario.has(k) || porHorario.get(k).peso < e.peso) porHorario.set(k, e);
  }
  const unicos = [...porHorario.values()];
  const ordem = (a, b) => (a.data + (a.diaTodo ? '00' : a.hhmm)).localeCompare(b.data + (b.diaTodo ? '00' : b.hhmm));
  const hoje = unicos.filter((e) => e.data === data).sort(ordem).slice(0, 4);
  // "ainda nesta semana": de amanhã até sábado (a agenda do Brasil tem datas de meses à frente)
  const d = new Date(`${data}T12:00:00Z`);
  const sabado = new Date(d.getTime() + (6 - d.getUTCDay()) * 86400e3).toISOString().slice(0, 10);
  const semana = unicos.filter((e) => e.data > data && e.data <= sabado).sort((a, b) => b.peso - a.peso).slice(0, 3).sort(ordem);
  return { hoje, semana, usouBR: [...hoje, ...semana].some((e) => e.pais === 'BRL') };
}

async function tela1(data) {
  const { hoje, semana, usouBR } = await agenda(data);
  const paises = [...new Set(hoje.map((e) => e.pais))];
  let apoio;
  if (!hoje.length) apoio = 'Nenhum evento de 3 estrelas na agenda de hoje.';
  else if (hoje.length === 1) apoio = `Um evento de 3 estrelas hoje, ${T.NOS[paises[0]] || ''}.`.replace(' ,', ',').replace(', .', '.');
  else apoio = paises.length === 1 ? `Os ${hoje.length} eventos de maior peso hoje são ${T.NOS[paises[0]]}.` : `${hoje.length} eventos de maior peso na agenda de hoje.`;
  return {
    calendario: {
      titulo: T.dataLonga(data), apoio,
      eventos: hoje.map((e) => ({ hora: e.diaTodo ? 'Dia todo' : T.horaBR(e.hhmm), pais: T.PAISES[e.pais] || e.pais, nome: e.nome, anterior: e.anterior, projecao: e.projecao })),
      radar: semana.map((e) => ({ quando: `${T.diaSemana(e.data)}${e.diaTodo ? '' : `, ${T.horaBR(e.hhmm)}`}`, nome: `${e.nome}${e.pais !== 'BRL' && e.pais !== 'USD' ? ` (${T.PAISES[e.pais]})` : ''}` })),
      fonte: usouBR ? 'Forex Factory e Banco Central' : 'Forex Factory',
      conf: await semanaDoCalendario(),
    },
  };
}

// período coberto pelo feed do Forex Factory (para conferir que não é a semana passada)
async function semanaDoCalendario() {
  const datas = (await F.calendarioSemana()).map((e) => F.dataNoFuso(new Date(e.date).getTime(), FUSO)).sort();
  return { de: datas[0], ate: datas[datas.length - 1] };
}

// ---------- 3 e 6 · parcial e fechamento ----------
async function globais(tipo, data) {
  const cot = await F.emLotes(ATIVOS, 6, (a) => F.cotacao(a.sym));
  const fechados = [];
  const ativos = ATIVOS.map((a, i) => {
    const c = cot[i].status === 'fulfilled' ? cot[i].value : null;
    if (!c) throw new Error(`sem cotação de ${a.nome}: ${cot[i].reason?.message}`);
    const negociouHoje = a.diaInteiro || c.negociadoEm === data;
    if (!negociouHoje) fechados.push(a.nome);
    return { nome: a.nome, cod: a.cod, chave: a.chave || a.cod, preco: c.preco, var: negociouHoje ? Number(c.var.toFixed(2)) : null, pre: a.pre,
      conf: { sym: a.sym, negociadoEm: c.negociadoEm, horario: c.horario, intradiario: c.intradiario } };
  });
  const comVariacao = ativos.filter((a) => a.var !== null && a.chave !== 'VIX');
  const maior = comVariacao.sort((x, y) => Math.abs(y.var) - Math.abs(x.var))[0];
  return { ativos, maior, fechados };
}

async function tela3(data) {
  const { ativos, maior, fechados } = await globais('parcial', data);
  const hora = horaAgora().replace(':', 'h');
  const apoio = maior
    ? `${T.dataLonga(data)}, ${hora}. ${T.ARTIGO[maior.chave]} ${maior.var >= 0 ? 'sobe' : 'cai'} ${T.pct(maior.var)}, o maior movimento até agora.`
    : `${T.dataLonga(data)}, ${hora}.`;
  const nota = `Cotações das ${hora}, com atraso de até 15 minutos.${fechados.length ? ` Sem negociação hoje: ${fechados.join(', ')}.` : ''}`;
  return { parcial: { hora, apoio, nota, ativos, fonte: 'Yahoo Finance' } };
}

async function tela6(data) {
  const { ativos, maior, fechados } = await globais('fechamento', data);
  salvarRegistro(`${data}-fechamento.json`, { data, ativos });
  const apoio = maior
    ? `${T.dataLonga(data)}. ${T.ARTIGO[maior.chave]} teve o maior movimento do dia, com ${altaQueda(maior.var)} de ${T.pct(maior.var)}.`
    : `${T.dataLonga(data)}.`;
  const nota = `Petróleo e ouro pelos contratos futuros. Bitcoin desde a meia-noite (UTC).${fechados.length ? ` Sem negociação hoje: ${fechados.join(', ')}.` : ''}`;
  return { fechamento: { apoio, nota, ativos, fonte: 'Yahoo Finance, ICE e CME' } };
}

// ---------- 4 e 5 · maiores altas e baixas do Ibovespa ----------
async function pregao(data) {
  // reaproveita a foto do pregão só se ela foi tirada depois do fechamento da B3
  const guardado = lerJSON(path.join(RAIZ, 'registro', `${data}-pregao.json`));
  if (guardado && Date.now() - guardado.geradoEm < 60 * 60e3 && guardado.conf?.fimPregao && guardado.geradoEm >= guardado.conf.fimPregao) return guardado;

  const carteira = await F.carteiraIbov();
  const cot = await F.emLotes(carteira, 8, (a) => F.cotacao(`${a.cod}.SA`));
  const validas = [];
  carteira.forEach((a, i) => {
    const c = cot[i].status === 'fulfilled' ? cot[i].value : null;
    if (c && c.negociadoEm === data && c.var !== null) validas.push({ cod: a.cod, nome: NOMES[a.cod] || a.nomeB3, preco: c.preco, var: Number(c.var.toFixed(2)) });
  });
  if (validas.length < carteira.length * 0.6) throw new Error(`só ${validas.length} de ${carteira.length} ações com pregão hoje; a B3 abriu?`);
  // a mesma empresa com duas classes (PETR3 e PETR4) aparece uma vez só
  const umaPorEmpresa = (lista) => lista.filter((a, i) => lista.findIndex((b) => b.nome === a.nome) === i);
  const ordenadas = [...validas].sort((x, y) => y.var - x.var);
  const altas = umaPorEmpresa(ordenadas.filter((a) => a.var > 0)).slice(0, 5);
  const baixas = umaPorEmpresa([...ordenadas].reverse().filter((a) => a.var < 0)).slice(0, 5);
  const [ibov, dolar] = await Promise.all([F.cotacao('^BVSP'), F.cotacao('BRL=X')]);
  const p = {
    data, geradoEm: Date.now(), altas, baixas,
    ibov: { pontos: ibov.preco, var: Number(ibov.var.toFixed(2)) },
    dolar: { preco: dolar.preco, var: Number(dolar.var.toFixed(2)) },
    conf: { fimPregao: ibov.fimPregao, ibovHorario: ibov.horario, ibovData: ibov.negociadoEm, acoes: validas.length, carteira: carteira.length },
  };
  salvarRegistro(`${data}-pregao.json`, p);
  return p;
}

async function tela45(data) {
  const p = await pregao(data);
  const ibovFrase = p.ibov.var === 0 ? 'O Ibovespa ficou estável.' : `O Ibovespa ${subiuCaiu(p.ibov.var)} ${T.pct(p.ibov.var)}.`;
  const a = p.altas[0];
  const b = p.baixas[0];
  return {
    pregao: {
      apoioAltas: a ? `${T.dataLonga(data)}. ${a.nome} liderou, com alta de ${T.pct(a.var)}. ${ibovFrase}` : `${T.dataLonga(data)}. Nenhuma ação do índice subiu. ${ibovFrase}`,
      apoioBaixas: b ? `${T.dataLonga(data)}. ${b.nome} teve a maior queda, de ${T.pct(b.var)}. ${ibovFrase}` : `${T.dataLonga(data)}. Nenhuma ação do índice caiu. ${ibovFrase}`,
      ibov: p.ibov, dolar: p.dolar, altas: p.altas, baixas: p.baixas, fonte: 'B3 e Yahoo Finance', conf: p.conf, geradoEm: p.geradoEm,
    },
  };
}

// ---------- 2 · o que acompanhar ----------
async function tela2(data) {
  const manual = textosManuais(data);
  let itens = [...(manual.acompanharExtra || [])];
  if (manual.acompanhar) itens = manual.acompanhar;
  else {
    const { hoje, semana } = await agenda(data);
    for (const e of hoje.slice(0, 2)) {
      const valores = e.anterior ? ` Anterior ${e.anterior}${e.projecao ? `, projeção ${e.projecao}` : ''}.` : '';
      itens.push({ t: e.diaTodo ? `${e.nome} hoje` : `${e.nome} às ${T.horaBR(e.hhmm)}`, d: `${e.desc}${valores}`.trim() || 'Evento de 3 estrelas na agenda de hoje.' });
    }
    // último fechamento dos ativos globais (gravado pelo Story 6) ou, sem ele, a cotação de agora
    const fech = ultimoRegistro('fechamento', data);
    if (fech) {
      const m = fech.ativos.filter((x) => x.var !== null && x.chave !== 'VIX').sort((x, y) => Math.abs(y.var) - Math.abs(x.var))[0];
      if (m) itens.push({ t: `${m.nome} em ${altaQueda(m.var)}`, d: `${T.ARTIGO[m.chave]} ${subiuCaiu(m.var)} ${T.pct(m.var)} ${T.quando(fech.data, data)}, a ${m.pre || ''}${T.num(m.preco, m.preco >= 10000 ? 0 : 2)}.` });
    }
    const preg = ultimoRegistro('pregao', data);
    let ibov = preg && { ...preg.ibov, dolar: preg.dolar.preco, data: preg.data };
    if (!ibov) {
      const [i, d] = await Promise.all([F.cotacao('^BVSP'), F.cotacao('BRL=X')]);
      ibov = { pontos: i.preco, var: i.var, dolar: d.preco, data: i.negociadoEm };
    }
    itens.push({ t: 'Ibovespa', d: `Fechou ${T.quando(ibov.data, data)} em ${T.num(ibov.pontos, 0)} pontos, ${altaQueda(ibov.var)} de ${T.pct(ibov.var)}. O dólar terminou a R$ ${T.num(ibov.dolar)}.` });
    for (const e of semana) {
      if (itens.length >= 5) break;
      const q = T.proximo(e.data, data);
      itens.push({ t: `${e.nome} ${q}`, d: `${e.desc ? `${e.desc} ` : ''}Sai ${q}${e.diaTodo ? '' : `, às ${T.horaBR(e.hhmm)}`}.` });
    }
  }
  return { acompanhar: { titulo: T.dataLonga(data), itens: itens.slice(0, 5), fonte: 'Forex Factory, B3 e Yahoo Finance' } };
}

// ---------- montar e renderizar ----------
const TELAS = { 1: tela1, 2: tela2, 3: tela3, 4: tela45, 5: tela45, 6: tela6 };

async function montar(n, data) {
  const dados = { data, ...(await TELAS[n](data)) };
  const apoio = textosManuais(data).apoio?.[n];
  if (apoio) {
    if (n === 1) dados.calendario.apoio = apoio;
    if (n === 3) dados.parcial.apoio = apoio;
    if (n === 4) dados.pregao.apoioAltas = apoio;
    if (n === 5) dados.pregao.apoioBaixas = apoio;
    if (n === 6) dados.fechamento.apoio = apoio;
  }
  return dados;
}

const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'google-chrome');

function renderizar(n, dados, saida) {
  const modelos = path.join(RAIZ, 'modelos');
  fs.writeFileSync(path.join(modelos, 'dados.js'), `// gerado por gerar.js em ${new Date().toISOString()}\nwindow.DADOS = ${JSON.stringify(dados, null, 1)};\n`);
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1080,1920',
    '--virtual-time-budget=5000', `--screenshot=${saida}`, `${pathToFileURL(path.join(modelos, 'story.html')).href}?n=${n}`];
  if (process.platform !== 'win32') args.unshift('--no-sandbox');
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    if (fs.existsSync(saida)) fs.unlinkSync(saida);
    try { execFileSync(CHROME, args, { stdio: 'ignore', timeout: 60000 }); } catch { /* o Chrome às vezes sai com erro mesmo salvando */ }
    if (fs.existsSync(saida) && fs.statSync(saida).size > 20000) return saida;
  }
  throw new Error(`o Chrome não gerou a imagem do Story ${n}`);
}

async function gerar(n, data) {
  const dados = await montar(n, data);
  // conferência: com SEM_CONFERENCIA=1 (prévias) só avisa, sem barrar
  await require('./validar').validar(n, dados).catch((e) => {
    if (!process.env.SEM_CONFERENCIA) throw e;
    console.warn(`aviso: ${e.message}`);
  });
  return renderizar(n, dados, path.join(RAIZ, 'gerados', data, `${n}.jpg`));
}

module.exports = { gerar, montar };

if (require.main === module) {
  const [qual, dataArg] = process.argv.slice(2);
  const data = dataArg || F.dataNoFuso(Date.now(), FUSO);
  const lista = qual === 'todos' ? [1, 2, 3, 4, 5, 6] : [Number(qual)];
  if (!lista.every((n) => n >= 1 && n <= 6)) { console.log('uso: node gerar.js <1-6|todos> [AAAA-MM-DD]'); process.exit(1); }
  (async () => {
    let falhas = 0;
    for (const n of lista) {
      try { console.log(`ok ${n}: ${await gerar(n, data)}`); } catch (e) { falhas++; console.error(`ERRO ${n}: ${e.message}`); }
    }
    process.exit(falhas ? 1 : 0);
  })();
}
