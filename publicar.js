#!/usr/bin/env node
// Publica os 6 Stories diários da MCR Up Invest pela API oficial do Instagram (Graph API).
//
//   node publicar.js agora [--simular]        publica os horários vencidos de hoje que ainda não saíram
//   node publicar.js slot <1-6> [data] [--simular]   força um Story específico
//   node publicar.js verificar [data]          confere a pasta do dia sem publicar nada
//
// Fila manual: fila/AAAA-MM-DD/1.jpg ... 6.mp4  (o número é a posição no dia, ligada a config.horarios)
// Sem arquivo manual, o Story é gerado na hora com dados ao vivo (gerar.js) em gerados/AAAA-MM-DD/n.jpg
// Registro do que já saiu: registro/AAAA-MM-DD.json (impede publicar duas vezes)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = __dirname;
const config = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config.json'), 'utf8'));
const EXT_IMAGEM = ['.jpg', '.jpeg'];
const EXT_VIDEO = ['.mp4', '.mov'];

// ---------- datas no fuso de Brasília ----------
function agoraNoFuso() {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: config.fuso, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((p) => [p.type, p.value])
  );
  return { data: `${partes.year}-${partes.month}-${partes.day}`, minutos: +partes.hour * 60 + +partes.minute };
}
const emMinutos = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

// ---------- fila e registro ----------
function horariosDoDia(data) {
  const especial = path.join(RAIZ, 'fila', data, 'horarios.json');
  return fs.existsSync(especial) ? JSON.parse(fs.readFileSync(especial, 'utf8')) : config.horarios;
}

function arquivoDoSlot(data, n, pastaBase = 'fila') {
  const pasta = path.join(RAIZ, pastaBase, data);
  if (!fs.existsSync(pasta)) return null;
  const nome = fs.readdirSync(pasta).find((f) => path.parse(f).name === String(n));
  return nome ? path.join(pasta, nome) : null;
}

function lerRegistro(data) {
  const f = path.join(RAIZ, 'registro', `${data}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
}
function salvarRegistro(data, reg) {
  fs.mkdirSync(path.join(RAIZ, 'registro'), { recursive: true });
  fs.writeFileSync(path.join(RAIZ, 'registro', `${data}.json`), JSON.stringify(reg, null, 2) + '\n');
}

// ---------- validação ----------
function dimensoesJpeg(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marcador = buf[i + 1];
    const tamanho = buf.readUInt16BE(i + 2);
    if (marcador >= 0xc0 && marcador <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marcador)) {
      return { altura: buf.readUInt16BE(i + 5), largura: buf.readUInt16BE(i + 7) };
    }
    i += 2 + tamanho;
  }
  return null;
}

function validar(arquivo) {
  const problemas = [];
  const avisos = [];
  const ext = path.extname(arquivo).toLowerCase();
  const mb = fs.statSync(arquivo).size / 1024 / 1024;
  if (EXT_IMAGEM.includes(ext)) {
    if (mb > 8) problemas.push(`imagem com ${mb.toFixed(1)} MB (máximo 8 MB)`);
    const d = dimensoesJpeg(fs.readFileSync(arquivo));
    if (!d) problemas.push('não consegui ler o JPEG');
    else if (Math.abs(d.largura / d.altura - 9 / 16) > 0.01) avisos.push(`${d.largura}x${d.altura} não é 9:16 (ideal 1080x1920)`);
  } else if (EXT_VIDEO.includes(ext)) {
    if (mb > 100) problemas.push(`vídeo com ${mb.toFixed(1)} MB (máximo 100 MB)`);
    avisos.push('vídeo: confira 9:16, entre 3 e 60 s, H.264 + AAC');
  } else {
    problemas.push(`formato ${ext} não aceito pela API (use JPG ou MP4; PNG precisa ser convertido)`);
  }
  return { problemas, avisos, tipo: EXT_VIDEO.includes(ext) ? 'video' : 'image' };
}

// ---------- hospedagem pública (a API só aceita URL) ----------
async function hospedar(arquivo, data, n, tipo) {
  const { CLOUDINARY_CLOUD, CLOUDINARY_KEY, CLOUDINARY_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD || !CLOUDINARY_KEY || !CLOUDINARY_SECRET) throw new Error('faltam CLOUDINARY_CLOUD, CLOUDINARY_KEY e CLOUDINARY_SECRET');
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { folder: config.pastaCloudinary, overwrite: 'true', public_id: `${data}-${n}`, timestamp };
  const assinar = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  const form = new FormData();
  for (const [k, v] of Object.entries(params)) form.append(k, String(v));
  form.append('api_key', CLOUDINARY_KEY);
  form.append('signature', crypto.createHash('sha1').update(assinar + CLOUDINARY_SECRET).digest('hex'));
  form.append('file', new Blob([fs.readFileSync(arquivo)]), path.basename(arquivo));
  const r = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/${tipo}/upload`, { method: 'POST', body: form });
  const j = await r.json();
  if (!r.ok) throw new Error(`Cloudinary: ${j.error?.message || r.status}`);
  return j.secure_url;
}

// ---------- Instagram Graph API ----------
async function graph(metodo, caminho, params) {
  const { IG_TOKEN } = process.env;
  const url = new URL(`${config.graphHost}/${config.graphVersao}/${caminho}`);
  const corpo = new URLSearchParams({ ...params, access_token: IG_TOKEN });
  const r = metodo === 'GET'
    ? await fetch(`${url}?${corpo}`)
    : await fetch(url, { method: 'POST', body: corpo });
  const j = await r.json();
  if (j.error) throw new Error(`Instagram: ${j.error.message} (código ${j.error.code})`);
  return j;
}

async function publicarStory(urlPublica, tipo) {
  const { IG_USER_ID, IG_TOKEN } = process.env;
  if (!IG_USER_ID || !IG_TOKEN) throw new Error('faltam IG_USER_ID e IG_TOKEN');
  const campo = tipo === 'video' ? 'video_url' : 'image_url';
  const { id: container } = await graph('POST', `${IG_USER_ID}/media`, { media_type: 'STORIES', [campo]: urlPublica });
  // o Instagram processa a mídia antes de liberar a publicação (vídeo pode levar alguns minutos)
  for (let tentativa = 0; tentativa < 60; tentativa++) {
    const { status_code } = await graph('GET', container, { fields: 'status_code' });
    if (status_code === 'FINISHED') break;
    if (status_code === 'ERROR' || status_code === 'EXPIRED') throw new Error(`processamento falhou (${status_code})`);
    await new Promise((ok) => setTimeout(ok, 5000));
  }
  const { id } = await graph('POST', `${IG_USER_ID}/media_publish`, { creation_id: container });
  return id;
}

// ---------- comandos ----------
async function publicarSlot(data, n, simular) {
  // arquivo manual na fila tem prioridade; sem ele, gera com dados ao vivo
  const arquivo = arquivoDoSlot(data, n) || (await require('./gerar').gerar(n, data));
  const { problemas, tipo } = validar(arquivo);
  if (problemas.length) throw new Error(`${path.basename(arquivo)}: ${problemas.join('; ')}`);
  if (simular) { console.log(`[simulação] publicaria ${data} #${n} (${path.basename(arquivo)})`); return; }
  const url = await hospedar(arquivo, data, n, tipo);
  const mediaId = await publicarStory(url, tipo);
  const reg = lerRegistro(data);
  reg[n] = { arquivo: path.basename(arquivo), mediaId, publicadoEm: new Date().toISOString() };
  salvarRegistro(data, reg);
  console.log(`ok ${data} #${n} publicado (media ${mediaId})`);
}

function diaSemPregao(data) {
  const semana = new Date(`${data}T12:00:00Z`).getUTCDay();
  return (config.diasUteis && (semana === 0 || semana === 6)) || config.feriados.includes(data);
}

async function agora(simular) {
  const { data, minutos } = agoraNoFuso();
  if (diaSemPregao(data) && !fs.existsSync(path.join(RAIZ, 'fila', data))) { console.log(`${data}: sem pregão, nada a publicar`); return; }
  // feriado ou fim de semana com pasta manual: publica só o que estiver na fila
  const horarios = horariosDoDia(data);
  const reg = lerRegistro(data);
  let falhas = 0;
  for (let i = 0; i < horarios.length; i++) {
    const n = i + 1;
    const atraso = minutos - emMinutos(horarios[i]);
    if (atraso < 0 || reg[n]) continue;
    if (atraso > config.toleranciaMinutos) { console.log(`pulado ${data} #${n}: passou ${atraso} min do horário`); continue; }
    try { await publicarSlot(data, n, simular); } catch (e) { falhas++; console.error(`ERRO ${data} #${n}: ${e.message}`); }
  }
  if (falhas) process.exit(1);
}

function verificar(data) {
  const horarios = horariosDoDia(data);
  const reg = lerRegistro(data);
  let erros = 0;
  console.log(`fila/${data}`);
  horarios.forEach((h, i) => {
    const n = i + 1;
    const arquivo = arquivoDoSlot(data, n);
    const pauta = (config.pautas[i] || '').padEnd(50);
    if (!arquivo) { console.log(`  ${n}  ${h}  ${pauta} ${(reg[n] ? 'publicado' : 'automático').padStart(10)}`); return; }
    const { problemas, avisos } = validar(arquivo);
    erros += problemas.length;
    const estado = reg[n] ? 'publicado' : problemas.length ? 'ERRO' : 'pronto';
    console.log(`  ${n}  ${h}  ${pauta} ${path.basename(arquivo).padEnd(10)} ${estado}`);
    [...problemas, ...avisos].forEach((p) => console.log(`        - ${p}`));
  });
  if (erros) process.exit(1);
}

const [cmd, ...args] = process.argv.slice(2);
const simular = args.includes('--simular');
const posicionais = args.filter((a) => !a.startsWith('--'));
(async () => {
  if (cmd === 'agora') await agora(simular);
  else if (cmd === 'slot') await publicarSlot(posicionais[1] || agoraNoFuso().data, Number(posicionais[0]), simular);
  else if (cmd === 'verificar') verificar(posicionais[0] || agoraNoFuso().data);
  else { console.log('uso: node publicar.js agora|slot <n> [data]|verificar [data] [--simular]'); process.exit(1); }
})().catch((e) => { console.error(`ERRO: ${e.message}`); process.exit(1); });
