#!/usr/bin/env node
// Relatório de uso para a MCR: o que foi publicado em cada canal e o custo da API do X.
//
//   node relatorio.js semana [AAAA-MM-DD]   semana de segunda a domingo que contém a data (padrão: a semana passada)
//   node relatorio.js mes [AAAA-MM]         mês fechado, com o custo em dólar e a estimativa em reais (padrão: o mês passado)
//
// Sai em relatorios/ (PDF + resumo.txt para o WhatsApp). Fica fora do Git porque o repositório é público.
// Na nuvem, o publicar.js chama automatico(): toda segunda às 8h (semana anterior) e no dia 1 às 8h
// (mês anterior). O PDF vai para o seu privado no Telegram e o aviso abre uma issue no GitHub.
//
// Custo do X: cada chamada paga fica em registro/x-uso/AAAA-MM.json (anotada pelo x.js) e é
// multiplicada pela tabela config.x.precos. Se o console do X mostrar outro total no mês, grave
// registro/x-cobranca.json = { "2026-11": 2.13 } e o relatório usa esse valor como oficial.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const T = require('./textos');

const RAIZ = __dirname;
const REG = path.join(RAIZ, 'registro');
const SAIDA = path.join(RAIZ, 'relatorios');
const config = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config.json'), 'utf8'));
const lerJSON = (f, padrao) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : padrao);
const dataSP = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: config.fuso }).format(ms);
const somaDias = (data, n) => new Date(Date.parse(`${data}T12:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
const usd = (v) => `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`;
const brl = (v) => `R$ ${T.num(v)}`;
const dm = (d) => `${d.slice(8)}/${d.slice(5, 7)}`;
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// ---------- dias de pregão (mesma regra do publicar.js) ----------
function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return Date.UTC(ano, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
}
function temPregao(data) {
  const ano = Number(data.slice(0, 4));
  const p = pascoa(ano);
  const desloc = (n) => new Date(p + n * 86400e3).toISOString().slice(0, 10);
  const feriados = [...['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-24', '12-25', '12-31'].map((md) => `${ano}-${md}`), desloc(-48), desloc(-47), desloc(-2), desloc(60), ...config.feriados];
  const semana = new Date(`${data}T12:00:00Z`).getUTCDay();
  return semana !== 0 && semana !== 6 && !feriados.includes(data);
}

// ---------- coleta ----------
function coletar(ini, fim) {
  const dias = [];
  for (let d = ini; d <= fim; d = somaDias(d, 1)) {
    const ig = lerJSON(path.join(REG, `${d}.json`), {});
    const tg = lerJSON(path.join(REG, `${d}-telegram.json`), {});
    const xd = lerJSON(path.join(REG, `${d}-x.json`), {});
    dias.push({
      data: d, pregao: temPregao(d),
      stories: Object.keys(ig).filter((k) => /^[1-6]$/.test(k)).length,
      telegram: Object.keys(tg).length, x: Object.keys(xd).length,
    });
  }
  const noPeriodo = (iso) => iso && dataSP(Date.parse(iso)) >= ini && dataSP(Date.parse(iso)) <= fim;
  const feedIG = Object.entries(lerJSON(path.join(REG, 'feed.json'), {})).filter(([, r]) => noPeriodo(r.publicadoEm)).map(([n]) => n);
  const estTG = lerJSON(path.join(REG, 'telegram.json'), {});
  const estX = lerJSON(path.join(REG, 'x.json'), {});
  const feedCanal = (est) => Object.values(est.feed || {}).filter((r) => noPeriodo(r.publicadoEm)).length;
  const enquetes = (est) => Object.keys(est.enquetes || {}).filter((d) => d >= ini && d <= fim).length;

  // uso pago do X
  const meses = new Set(dias.map((d) => d.data.slice(0, 7)));
  const uso = [...meses].flatMap((m) => lerJSON(path.join(REG, 'x-uso', `${m}.json`), [])).filter((u) => noPeriodo(u.em));
  const precos = config.x?.precos || {};
  const porTipo = {};
  for (const u of uso) porTipo[u.tipo] = (porTipo[u.tipo] || 0) + 1;
  const linhasCusto = Object.entries(porTipo).map(([tipo, qtd]) => ({ tipo, qtd, unit: precos[tipo] ?? 0, total: qtd * (precos[tipo] ?? 0) }));
  const custoX = linhasCusto.reduce((s, l) => s + l.total, 0);

  const pregoes = dias.filter((d) => d.pregao).length;
  // previsto só conta pregões que já aconteceram (o mês corrente não cobra dias futuros)
  const hoje = dataSP(Date.now());
  const pregoesAteHoje = dias.filter((d) => d.pregao && d.data <= hoje && d.data >= (config.inicioAutomacao || '')).length;
  const tgOff = !fs.existsSync(path.join(REG, 'telegram.json'));
  const xOff = !fs.existsSync(path.join(REG, 'x.json')) && !uso.length;
  return {
    ini, fim, dias, pregoes, feedIG, linhasCusto, custoX,
    canais: [
      { nome: 'Instagram · Stories', feito: dias.reduce((s, d) => s + d.stories, 0), previsto: pregoesAteHoje * config.horarios.length },
      { nome: 'Instagram · carrosséis e Reels', feito: feedIG.length, previsto: null },
      { nome: 'Telegram · posts do dia', feito: dias.reduce((s, d) => s + d.telegram, 0), previsto: pregoesAteHoje * Object.keys(config.telegram?.diarios || {}).length, desligado: tgOff },
      { nome: 'Telegram · feed e enquetes', feito: feedCanal(estTG) + enquetes(estTG), previsto: null, desligado: tgOff },
      { nome: 'X · posts do dia', feito: dias.reduce((s, d) => s + d.x, 0), previsto: pregoesAteHoje * Object.keys(config.x?.diarios || {}).length, desligado: xOff },
      { nome: 'X · feed e enquetes', feito: feedCanal(estX) + enquetes(estX), previsto: null, desligado: xOff },
    ],
  };
}

const NOMES_TIPO = { post: 'Post publicado', post_com_link: 'Post com link', leitura_post: 'Leitura de post', leitura_usuario: 'Consulta de perfil', midia: 'Envio de imagem ou vídeo' };

// dólar PTAX de venda do Banco Central no último dia útil até a data
async function ptax(ate) {
  for (let i = 0; i < 7; i++) {
    const d = somaDias(ate, -i);
    const [a, m, dd] = d.split('-');
    const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao=@dataCotacao)?@dataCotacao='${m}-${dd}-${a}'&$format=json`;
    try {
      const j = await (await fetch(url, { signal: AbortSignal.timeout(20000) })).json();
      if (j.value?.length) return { valor: j.value[j.value.length - 1].cotacaoVenda, data: d };
    } catch { /* tenta o dia anterior */ }
  }
  return null;
}

// ---------- HTML ----------
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
function pagina({ titulo, subtitulo, r, mensal }) {
  const fonte = (f) => pathToFileURL(path.join(RAIZ, 'modelos', f)).href;
  const totalFeito = r.canais.reduce((s, c) => s + c.feito, 0);
  const falhas = r.canais.filter((c) => c.previsto && !c.desligado && c.feito < c.previsto);
  const custo = mensal?.oficial ?? r.custoX;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
@font-face{font-family:Raleway;src:url('${fonte('fonts/Raleway-latin.woff2')}') format('woff2');font-weight:100 900}
@font-face{font-family:Raleway;src:url('${fonte('fonts/Raleway-latin-ext.woff2')}') format('woff2');font-weight:100 900;unicode-range:U+0100-024F}
@page{size:A4;margin:0}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Raleway,sans-serif;color:#03172c;font-feature-settings:'lnum','tnum';width:210mm;padding:16mm 16mm 14mm}
header{display:flex;justify-content:space-between;align-items:center}
header .mcr{height:12mm} header .eqi{height:10mm}
h1{margin-top:12mm;font-size:30pt;font-weight:800;line-height:1;letter-spacing:-.02em}
h1 span{display:block;color:#f46a25}
.sub{margin-top:4mm;font-size:11pt;color:#4b6178}
.numeros{display:flex;gap:14mm;margin-top:10mm}
.numeros div{font-size:9.5pt;color:#4b6178}
.numeros b{display:block;font-size:24pt;font-weight:800;color:#03172c;margin-bottom:1mm}
h2{margin-top:10mm;font-size:13pt;font-weight:800}
table{width:100%;border-collapse:collapse;margin-top:3mm;font-size:9.5pt}
th{text-align:left;font-weight:700;color:#4b6178;padding:2mm 3mm}
td{padding:2.2mm 3mm}
tr:nth-child(even) td{background:rgba(3,23,44,.055)}
.n{text-align:right;white-space:nowrap}
.ok{color:#14894e;font-weight:700}.falta{color:#c2410c;font-weight:700}.cinza{color:#8396aa}
.total td{font-weight:800;background:#03172c!important;color:#fff}
.nota{margin-top:3mm;font-size:8.5pt;line-height:1.45;color:#4b6178}
.dias td,.dias th{text-align:center}.dias td:first-child,.dias th:first-child{text-align:left}
footer{margin-top:10mm;font-size:8pt;color:#8396aa}
</style></head><body>
<header><img class="mcr" src="${fonte('logo-mcrup-escuro.png')}"><img class="eqi" src="${fonte('logo-eqi-escuro.png')}"></header>
<h1>${esc(titulo)}<span>${esc(subtitulo)}</span></h1>
<p class="sub">${dm(r.ini)} a ${dm(r.fim)}/${r.fim.slice(0, 4)} · ${r.pregoes} dias de pregão</p>
<div class="numeros">
  <div><b>${totalFeito}</b>publicações nos três canais</div>
  <div><b>${usd(custo)}</b>custo da API do X${mensal?.oficial != null ? ' (valor do console)' : ''}</div>
  <div><b>${falhas.length ? falhas.length : 'Nenhuma'}</b>${falhas.length ? 'rotina abaixo do previsto' : 'falha nas rotinas diárias'}</div>
</div>
<h2>Publicações por canal</h2>
<table><tr><th>Canal</th><th class="n">Publicado</th><th class="n">Previsto</th></tr>
${r.canais.map((c) => `<tr><td>${esc(c.nome)}</td><td class="n">${c.desligado ? '<span class="cinza">ainda não ativo</span>' : c.feito}</td><td class="n">${c.desligado || c.previsto == null ? '<span class="cinza">conforme pauta</span>' : `<span class="${c.feito >= c.previsto ? 'ok' : 'falta'}">${c.previsto}</span>`}</td></tr>`).join('')}
</table>
${r.feedIG.length ? `<p class="nota">Conteúdos de feed no período: ${r.feedIG.map((n) => esc(n.replace(/^\d{4}-\d\d-\d\d-/, '').replace(/-/g, ' '))).join(', ')}.</p>` : ''}
<h2>Uso da API do X</h2>
<table><tr><th>Tipo de uso</th><th class="n">Quantidade</th><th class="n">Preço unitário</th><th class="n">Total</th></tr>
${r.linhasCusto.length ? r.linhasCusto.map((l) => `<tr><td>${esc(NOMES_TIPO[l.tipo] || l.tipo)}</td><td class="n">${l.qtd}</td><td class="n">${usd(l.unit)}</td><td class="n">${usd(l.total)}</td></tr>`).join('') : '<tr><td colspan="4" class="cinza">Nenhuma chamada paga no período.</td></tr>'}
<tr class="total"><td>Total calculado</td><td></td><td></td><td class="n">${usd(r.custoX)}</td></tr>
</table>
${mensal ? `
<h2>Custo do mês em reais</h2>
<table>
<tr><td>Custo da API do X${mensal.oficial != null ? ' (valor informado no console do X)' : ''}</td><td class="n">${usd(custo)}</td></tr>
<tr><td>Dólar PTAX de venda do Banco Central${mensal.ptax ? ` em ${dm(mensal.ptax.data)}` : ''}</td><td class="n">${mensal.ptax ? brl(mensal.ptax.valor) : 'indisponível'}</td></tr>
<tr><td>IOF de compra internacional no cartão</td><td class="n">${(config.x?.iof * 100).toLocaleString('pt-BR')}%</td></tr>
<tr class="total"><td>Estimativa em reais</td><td class="n">${mensal.reais != null ? brl(mensal.reais) : '-'}</td></tr>
</table>
<p class="nota">O valor exato em reais é o da fatura do cartão de vocês, que usa o câmbio do dia da cobrança. O X desconta o uso de créditos comprados antes; a compra de créditos pode cair na fatura em outra data.</p>` : ''}
<h2>Dia a dia</h2>
<table class="dias"><tr><th>Dia</th><th>Stories</th><th>Telegram</th><th>X</th></tr>
${r.dias.map((d) => `<tr><td>${T.diaSemana(d.data)}, ${dm(d.data)}</td>${d.pregao ? `<td>${d.stories}/${config.horarios.length}</td><td>${d.telegram || '<span class="cinza">0</span>'}</td><td>${d.x || '<span class="cinza">0</span>'}</td>` : '<td colspan="3" class="cinza">sem pregão</td>'}</tr>`).join('')}
</table>
<p class="nota">Preços do X pela tabela de uso pago (${Object.entries(config.x?.precos || {}).filter(([, v]) => v).map(([k, v]) => `${(NOMES_TIPO[k] || k).toLowerCase()} ${usd(v)}`).join(', ')}). Os posts automáticos não levam link, que custa mais.</p>
<footer>Gerado automaticamente em ${new Date().toLocaleString('pt-BR', { timeZone: config.fuso })} · Otávio "JIN" Fernandes para MCR UP Invest</footer>
</body></html>`;
}

const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'google-chrome');
function pdf(html, nome) {
  fs.mkdirSync(SAIDA, { recursive: true });
  const arqHtml = path.join(SAIDA, `${nome}.html`);
  const arqPdf = path.join(SAIDA, `${nome}.pdf`);
  fs.writeFileSync(arqHtml, html);
  const args = ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--virtual-time-budget=3000', `--print-to-pdf=${arqPdf}`, pathToFileURL(arqHtml).href];
  if (process.platform !== 'win32') args.unshift('--no-sandbox');
  try { execFileSync(CHROME, args, { stdio: 'ignore', timeout: 60000 }); } catch { /* o Chrome às vezes sai com erro mesmo salvando */ }
  if (!fs.existsSync(arqPdf)) throw new Error('o Chrome não gerou o PDF');
  return arqPdf;
}

// ---------- relatórios ----------
function segundaDa(data) { const s = new Date(`${data}T12:00:00Z`).getUTCDay(); return somaDias(data, -((s + 6) % 7)); }

async function semana(dataRef) {
  const ini = segundaDa(dataRef || somaDias(dataSP(Date.now()), -7));
  const fim = somaDias(ini, 6);
  const r = coletar(ini, fim);
  const arq = pdf(pagina({ titulo: 'Relatório semanal', subtitulo: `${dm(ini)} a ${dm(fim)}`, r }), `semana-${ini}`);
  const resumo = [
    `Relatório semanal da MCR (${dm(ini)} a ${dm(fim)})`, '',
    ...r.canais.filter((c) => !c.desligado).map((c) => `• *${c.nome}:* ${c.feito}${c.previsto ? ` de ${c.previsto}` : ''}`),
    `• *Custo da API do X:* ${usd(r.custoX)}`,
  ].join('\n');
  fs.writeFileSync(arq.replace(/\.pdf$/, '-resumo.txt'), resumo + '\n');
  return { arq, resumo };
}

async function mes(ref) {
  const hoje = dataSP(Date.now());
  const m = ref || somaDias(`${hoje.slice(0, 7)}-01`, -1).slice(0, 7);
  const ini = `${m}-01`;
  const fim = somaDias(`${somaDias(ini, 32).slice(0, 7)}-01`, -1);
  const r = coletar(ini, fim);
  const oficial = lerJSON(path.join(REG, 'x-cobranca.json'), {})[m] ?? null;
  const custo = oficial ?? r.custoX;
  const cot = await ptax(fim < hoje ? fim : hoje);
  const reais = cot ? custo * cot.valor * (1 + (config.x?.iof ?? 0)) : null;
  const nomeMes = `${MESES[Number(m.slice(5)) - 1]} de ${m.slice(0, 4)}`;
  const arq = pdf(pagina({ titulo: 'Relatório do mês', subtitulo: nomeMes[0].toUpperCase() + nomeMes.slice(1), r, mensal: { oficial, ptax: cot, reais } }), `mes-${m}`);
  const resumo = [
    `Relatório de ${nomeMes} da MCR`, '',
    ...r.canais.filter((c) => !c.desligado).map((c) => `• *${c.nome}:* ${c.feito}${c.previsto ? ` de ${c.previsto}` : ''}`), '',
    `• *Custo da API do X:* ${usd(custo)}${oficial != null ? ' (valor do console do X)' : ''}`,
    reais != null ? `• *Em reais:* cerca de ${brl(reais)} (dólar PTAX ${brl(cot.valor)} + IOF ${(config.x.iof * 100).toLocaleString('pt-BR')}%). O valor exato é o da fatura do cartão.` : '',
  ].filter(Boolean).join('\n');
  fs.writeFileSync(arq.replace(/\.pdf$/, '-resumo.txt'), resumo + '\n');
  return { arq, resumo };
}

// ---------- chamado pelo publicar.js (só na nuvem) ----------
async function automatico() {
  if (process.env.RESERVA_MIN_ATRASO) return;
  const agora = new Intl.DateTimeFormat('en-CA', { timeZone: config.fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const p = Object.fromEntries(agora.map((x) => [x.type, x.value]));
  const hoje = `${p.year}-${p.month}-${p.day}`;
  if (Number(p.hour) < 8) return;
  const arqReg = path.join(REG, 'relatorios.json');
  const feitos = lerJSON(arqReg, {});
  const tarefas = [];
  if (new Date(`${hoje}T12:00:00Z`).getUTCDay() === 1) tarefas.push([`semana-${segundaDa(somaDias(hoje, -7))}`, () => semana()]);
  if (p.day === '01') tarefas.push([`mes-${somaDias(hoje, -1).slice(0, 7)}`, () => mes()]);
  for (const [chave, gerar] of tarefas) {
    if (feitos[chave]) continue;
    const { arq, resumo } = await gerar();
    feitos[chave] = { geradoEm: new Date().toISOString(), arquivo: path.basename(arq) };
    fs.writeFileSync(arqReg, JSON.stringify(feitos, null, 1) + '\n');
    let entregue = 'disponível em Actions > Stories MCR > a execução de hoje > Artifacts';
    // arquiva no painel (Uso e custos > Relatórios fechados), com botão de baixar para a MCR
    if (process.env.PAINEL_SEGREDO) {
      try {
        const url = `${process.env.PAINEL_URL || 'https://mcrup-content.netlify.app'}/api/webhook/relatorio?nome=${encodeURIComponent(path.basename(arq))}`;
        const r = await fetch(url, { method: 'POST', headers: { 'x-sinc': process.env.PAINEL_SEGREDO, 'Content-Type': 'application/pdf' }, body: fs.readFileSync(arq), signal: AbortSignal.timeout(60000) });
        if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
        entregue = 'arquivado no painel (Uso e custos)';
      } catch (e) { console.error(`relatório: painel falhou (${e.message})`); }
    }
    // vai para o privado do Otávio no Telegram, pronto para repassar
    const eu = String(process.env.TELEGRAM_AUTORIZADOS || '').split(',')[0];
    if (process.env.TELEGRAM_TOKEN && eu) {
      try {
        await require('./telegram').api('sendDocument', { chat_id: eu, caption: resumo.replace(/\*/g, '').slice(0, 1000) }, { document: arq });
        entregue += ' e enviado no seu privado do Telegram';
      } catch (e) { console.error(`relatório: Telegram falhou (${e.message})`); }
    }
    fs.appendFileSync(path.join(RAIZ, 'alerta.txt'), JSON.stringify({ titulo: `Relatório pronto: ${chave}`, corpo: `PDF ${entregue}.\n\nO resumo com os números vai junto do PDF; não fica aqui porque o repositório é público.` }) + '\n');
    console.log(`relatório ${chave}: gerado (${entregue})`);
  }
}

module.exports = { automatico, semana, mes };

if (require.main === module) {
  const [cmd, ref] = process.argv.slice(2);
  const f = { semana, mes }[cmd];
  if (!f) { console.log('uso: node relatorio.js semana [AAAA-MM-DD] | mes [AAAA-MM]'); process.exit(1); }
  f(ref).then(({ arq, resumo }) => console.log(`${arq}\n\n${resumo}`)).catch((e) => { console.error(e.message); process.exit(1); });
}
