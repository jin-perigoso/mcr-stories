// Nomes em português dos eventos do Forex Factory, com uma explicação curta e um peso
// (o peso decide qual evento representa um horário quando vários saem juntos).
// Evento que não está aqui aparece com o nome original em inglês: vale acrescentar.

const EVENTOS = [
  { re: /^Non-Farm Employment Change$/, pt: 'Payroll de emprego', desc: 'O principal dado de emprego dos EUA pesa nas apostas sobre os juros do Fed.', peso: 10 },
  { re: /^Federal Funds Rate$/, pt: 'Fed decide os juros', desc: 'A decisão do banco central americano mexe com dólar, bolsa e juros no mundo todo.', peso: 10 },
  { re: /Elections$/, pt: 'Eleições nos EUA', desc: 'O resultado pode mexer com o dólar e com os juros americanos.', peso: 10, diaTodo: true },
  { re: /^Core CPI m\/m$/, pt: 'Núcleo da inflação ao consumidor (CPI)', desc: 'A inflação sem alimentos e energia é a medida que o Fed mais acompanha no CPI.', peso: 9 },
  { re: /^CPI m\/m$/, pt: 'Inflação ao consumidor (CPI)', desc: 'Inflação mais alta que o esperado reduz a chance de corte de juros.', peso: 9 },
  { re: /^CPI y\/y$/, pt: 'Inflação ao consumidor em 12 meses', desc: 'Inflação mais alta que o esperado reduz a chance de corte de juros.', peso: 8 },
  { re: /^Main Refinancing Rate$/, pt: 'BCE decide os juros', desc: 'A decisão do Banco Central Europeu mexe com o euro e com os mercados globais.', peso: 9 },
  { re: /^(Advance|Prelim|Final) GDP q\/q$/, pt: 'PIB dos EUA', desc: 'O ritmo da economia americana no trimestre, anualizado.', peso: 8 },
  { re: /^Core PCE Price Index m\/m$/, pt: 'Inflação PCE (núcleo)', desc: 'É a medida de inflação preferida do Fed.', peso: 8 },
  { re: /^FOMC Statement$/, pt: 'Comunicado do Fed', desc: 'O texto que acompanha a decisão indica os próximos passos dos juros.', peso: 8 },
  { re: /^FOMC Press Conference$/, pt: 'Entrevista do presidente do Fed', desc: 'Depois da decisão de juros, o mercado reage a cada sinal sobre o futuro.', peso: 7 },
  { re: /^FOMC Meeting Minutes$/, pt: 'Ata do Fed', desc: 'Mostra como os diretores do Fed discutiram a última decisão.', peso: 7 },
  { re: /^Fed Chair .* (Speaks|Testifies)$/, pt: 'Presidente do Fed fala', desc: 'Qualquer sinal sobre os juros americanos mexe com os mercados.', peso: 6 },
  { re: /^ECB Press Conference$/, pt: 'Entrevista coletiva do BCE', desc: 'O mercado busca sinais sobre os próximos passos dos juros na Europa.', peso: 7 },
  { re: /^(Flash )?CPI Flash Estimate y\/y$|^Flash CPI y\/y$/, pt: 'Prévia da inflação na zona do euro', desc: 'Orienta as próximas decisões do Banco Central Europeu.', peso: 6 },
  { re: /^GDP q\/y$/, pt: 'PIB da China', desc: 'A China é a maior compradora de minério e outras commodities do Brasil.', peso: 7 },
  { re: /^Manufacturing PMI$/, pt: 'Atividade industrial (PMI)', desc: 'Acima de 50 indica expansão da indústria.', peso: 5 },
  { re: /^ISM Manufacturing PMI$/, pt: 'ISM industrial dos EUA', desc: 'Acima de 50 indica expansão da indústria americana.', peso: 6 },
  { re: /^ISM Services PMI$/, pt: 'ISM de serviços dos EUA', desc: 'Serviços são a maior parte da economia americana.', peso: 6 },
  { re: /^Retail Sales m\/m$/, pt: 'Vendas no varejo dos EUA', desc: 'Mostra a força do consumo americano.', peso: 6 },
  { re: /^Core Retail Sales m\/m$/, pt: 'Vendas no varejo (núcleo)', desc: 'O consumo americano sem automóveis.', peso: 5 },
  { re: /^Unemployment Rate$/, pt: 'Taxa de desemprego', desc: 'Desemprego subindo aumenta a chance de corte de juros.', peso: 6 },
  { re: /^Average Hourly Earnings m\/m$/, pt: 'Salário médio por hora', desc: 'Salários subindo rápido pressionam a inflação.', peso: 5 },
  { re: /^(Core )?PPI m\/m$/, pt: 'Inflação ao produtor (PPI)', desc: 'Preços no atacado costumam chegar depois ao consumidor.', peso: 5 },
  { re: /^JOLTS Job Openings$/, pt: 'JOLTS, vagas de emprego em aberto', desc: 'Mostra o aquecimento do mercado de trabalho americano.', peso: 5 },
  { re: /^ADP Non-Farm Employment Change$/, pt: 'ADP, emprego no setor privado', desc: 'É a prévia do payroll, que sai na sexta.', peso: 5 },
  { re: /^Unemployment Claims$/, pt: 'Pedidos de seguro-desemprego', desc: 'O dado semanal mais rápido do mercado de trabalho americano.', peso: 4 },
  { re: /^CB Consumer Confidence$/, pt: 'Confiança do consumidor', desc: 'Indica a disposição dos americanos para gastar.', peso: 4 },
  { re: /^(Prelim )?UoM Consumer Sentiment$/, pt: 'Sentimento do consumidor (Michigan)', desc: 'Indica a disposição dos americanos para gastar.', peso: 4 },
];

const PAISES = { USD: 'Estados Unidos', EUR: 'Zona do euro', CNY: 'China', GBP: 'Reino Unido', JPY: 'Japão', BRL: 'Brasil' };
const NOS = { USD: 'nos Estados Unidos', EUR: 'na zona do euro', CNY: 'na China', GBP: 'no Reino Unido', JPY: 'no Japão', BRL: 'no Brasil' };

function traduzirEvento(titulo) {
  const e = EVENTOS.find((x) => x.re.test(titulo));
  return e ? { pt: e.pt, desc: e.desc, peso: e.peso, diaTodo: !!e.diaTodo } : { pt: titulo, desc: '', peso: 1, diaTodo: false };
}

// "7.13M" -> "7,13 mi"; "65K" -> "65 mil"; "-0.2%" -> "−0,2%"
function valorBR(v) {
  if (!v) return '';
  let s = String(v).trim().replace(/^-/, '−').replace('.', ',');
  s = s.replace(/K$/, ' mil').replace(/M$/, ' mi').replace(/B$/, ' bi').replace(/T$/, ' tri');
  return s;
}

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const diaSemana = (data) => DIAS[new Date(`${data}T12:00:00Z`).getUTCDay()];
const dataLonga = (data) => { const [, m, d] = data.split('-').map(Number); return `${diaSemana(data)}, ${d} de ${MESES[m - 1]}`; };
const horaBR = (hhmm) => { const [h, m] = hhmm.split(':'); return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`; };

// "ontem", "na sexta", "em 30/10"
function quando(data, hoje) {
  const dias = Math.round((new Date(`${hoje}T12:00:00Z`) - new Date(`${data}T12:00:00Z`)) / 86400e3);
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 7) { const d = diaSemana(data).toLowerCase(); return d === 'sábado' || d === 'domingo' ? `no ${d}` : `na ${d}`; }
  const [, m, d] = data.split('-');
  return `em ${d}/${m}`;
}

// em relação a hoje: "hoje", "amanhã", "na quarta"
function proximo(data, hoje) {
  const dias = Math.round((new Date(`${data}T12:00:00Z`) - new Date(`${hoje}T12:00:00Z`)) / 86400e3);
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'amanhã';
  const d = diaSemana(data).toLowerCase();
  return d === 'sábado' || d === 'domingo' ? `no ${d}` : `na ${d}`;
}

// artigo + nome do ativo para frases ("O petróleo WTI caiu...")
const ARTIGO = { OIL: 'O petróleo Brent', SP500: 'O S&P 500', NASDAQ: 'A Nasdaq', BTC: 'O bitcoin', VIX: 'O VIX', GOLD: 'O ouro' };

const pct = (v) => Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
const num = (v, casas = 2) => v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

module.exports = { traduzirEvento, valorBR, PAISES, NOS, diaSemana, dataLonga, horaBR, quando, proximo, ARTIGO, pct, num };
