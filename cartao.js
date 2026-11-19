#!/usr/bin/env node
// Arte horizontal 16:9 (1600x900) para Telegram e X, com os mesmos dados dos Stories.
//
//   node cartao.js <abertura|parcial|fechamento> [data]   gera em gerados/AAAA-MM-DD/cartao-<tipo>.jpg

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const RAIZ = __dirname;
const config = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config.json'), 'utf8'));
const lerJSON = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const hojeNoFuso = () => new Intl.DateTimeFormat('en-CA', { timeZone: config.fuso }).format(new Date());
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'google-chrome');

async function dados(tipo, data) {
  const { montar } = require('./gerar');
  if (tipo === 'abertura') {
    const [{ calendario }, { acompanhar }] = [await montar(1, data), await montar(2, data)];
    return { calendario, acompanhar };
  }
  if (tipo === 'parcial') return { parcial: (await montar(3, data)).parcial };
  if (tipo === 'fechamento') {
    // registros gravados pelos Stories 4/5/6; só busca de novo se for hoje (data passada daria cotação de agora)
    const reg = async (nome, n) => {
      const f = path.join(RAIZ, 'registro', `${data}-${nome}.json`);
      if (!fs.existsSync(f)) {
        if (data !== hojeNoFuso()) throw new Error(`sem registro de ${nome} em ${data}`);
        await montar(n, data);
      }
      return lerJSON(f);
    };
    const [d, m] = [data.slice(8), data.slice(5, 7)];
    return { pregao: await reg('pregao', 4), fechamento: await reg('fechamento', 6), dataCurta: `${d}/${m}` };
  }
  throw new Error(`cartão desconhecido: ${tipo}`);
}

async function gerarCartao(tipo, data) {
  const modelos = path.join(RAIZ, 'modelos');
  const conteudo = { tipo, data, ...(await dados(tipo, data)) };
  fs.writeFileSync(path.join(modelos, 'dados-cartao.js'), `window.CARTAO = ${JSON.stringify(conteudo)};\n`);
  const saida = path.join(RAIZ, 'gerados', data, `cartao-${tipo}.jpg`);
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1600,900',
    '--virtual-time-budget=5000', `--screenshot=${saida}`, pathToFileURL(path.join(modelos, 'cartao.html')).href];
  if (process.platform !== 'win32') args.unshift('--no-sandbox');
  for (let i = 0; i < 2; i++) {
    if (fs.existsSync(saida)) fs.unlinkSync(saida);
    try { execFileSync(CHROME, args, { stdio: 'ignore', timeout: 60000 }); } catch { /* o Chrome às vezes sai com erro mesmo salvando */ }
    if (fs.existsSync(saida) && fs.statSync(saida).size > 20000) return saida;
  }
  throw new Error(`o Chrome não gerou o cartão ${tipo}`);
}

module.exports = { gerarCartao };

if (require.main === module) {
  const [tipo, data] = process.argv.slice(2);
  gerarCartao(tipo, data || hojeNoFuso()).then((f) => console.log(f)).catch((e) => { console.error(e.message); process.exit(1); });
}
