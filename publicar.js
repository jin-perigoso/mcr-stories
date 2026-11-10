#!/usr/bin/env node
// Publica os 6 Stories diários da MCR Up Invest pela API oficial do Instagram (Graph API).
//
//   node publicar.js agora [--simular]        publica os horários vencidos de hoje que ainda não saíram
//   node publicar.js slot <1-6> [data] [--simular]   força um Story específico
//   node publicar.js verificar [data]          confere a pasta do dia sem publicar nada
//   node publicar.js renovar                   renova já o token do Instagram (normalmente é semanal e sozinho)
//
// Fila manual: fila/AAAA-MM-DD/1.jpg ... 6.mp4  (o número é a posição no dia, ligada a config.horarios)
// Sem arquivo manual, o Story é gerado na hora com dados ao vivo (gerar.js) em gerados/AAAA-MM-DD/n.jpg
// Registro do que já saiu: registro/AAAA-MM-DD.json (impede publicar duas vezes)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = __dirname;
// credenciais locais (criadas por configurar.js); no GitHub Actions elas vêm dos secrets
if (fs.existsSync(path.join(RAIZ, '.env'))) {
  for (const linha of fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/)) {
    const i = linha.indexOf('=');
    if (i > 0 && !process.env[linha.slice(0, i)]) process.env[linha.slice(0, i)] = linha.slice(i + 1);
  }
}
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
// Com Cloudinary configurado, usa o Cloudinary. Sem ele, publica a mídia no ramo "midia" do
// próprio repositório (precisa ser público) e usa o endereço raw.githubusercontent.com.
async function hospedar(arquivo, data, n, tipo) {
  const { CLOUDINARY_CLOUD, CLOUDINARY_KEY, CLOUDINARY_SECRET } = process.env;
  if (CLOUDINARY_CLOUD && CLOUDINARY_KEY && CLOUDINARY_SECRET) return hospedarCloudinary(arquivo, data, n, tipo);
  return hospedarGitHub(arquivo, data, n);
}

async function hospedarGitHub(arquivo, data, n) {
  const { execFileSync } = require('child_process');
  let { GITHUB_REPOSITORY, GITHUB_TOKEN } = process.env;
  // fora do GitHub Actions: usa o login do GitHub CLI deste computador e o remoto "origin"
  if (!GITHUB_TOKEN) {
    for (const gh of ['gh', 'C:/Program Files/GitHub CLI/gh.exe']) {
      try { GITHUB_TOKEN = execFileSync(gh, ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); break; } catch {}
    }
  }
  if (!GITHUB_REPOSITORY) {
    try {
      const origem = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: RAIZ, encoding: 'utf8' }).trim();
      GITHUB_REPOSITORY = origem.replace(/^.*github\.com[/:]/, '').replace(/\.git$/, '');
    } catch {}
  }
  if (!GITHUB_REPOSITORY || !GITHUB_TOKEN) throw new Error('sem hospedagem: configure o Cloudinary ou entre no GitHub CLI (gh auth login)');
  const os = require('os');
  const nome = `${data}-${n}-${Date.now()}${path.extname(arquivo).toLowerCase()}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'midia-'));
  const git = (...a) => execFileSync('git', a, { cwd: tmp, stdio: 'pipe' });
  fs.copyFileSync(arquivo, path.join(tmp, nome));
  git('init', '-q');
  git('-c', 'user.name=stories-bot', '-c', 'user.email=stories-bot@users.noreply.github.com', 'add', nome);
  git('-c', 'user.name=stories-bot', '-c', 'user.email=stories-bot@users.noreply.github.com', 'commit', '-q', '-m', `mídia ${data} #${n}`);
  // ramo sempre com um arquivo só: não acumula imagens no histórico
  git('push', '-q', '--force', `https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git`, 'HEAD:midia');
  fs.rmSync(tmp, { recursive: true, force: true });
  const url = `https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/midia/${nome}`;
  // confere se o endereço já responde antes de passar ao Instagram
  for (let i = 0; i < 12; i++) {
    const r = await fetch(url, { method: 'HEAD' }).catch(() => null);
    if (r && r.ok) return url;
    await new Promise((ok) => setTimeout(ok, 5000));
  }
  throw new Error(`a mídia não ficou acessível em ${url} (o repositório é público?)`);
}

async function hospedarCloudinary(arquivo, data, n, tipo) {
  const { CLOUDINARY_CLOUD, CLOUDINARY_KEY, CLOUDINARY_SECRET } = process.env;
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
// Dois tipos de token: o da API do Instagram com login do Instagram (começa com "IG", sem Página
// do Facebook, vale 60 dias e é renovado aqui toda semana) e o de Página do Facebook (começa com
// "EA", não expira). O host certo sai do próprio token.
const ARQ_TOKEN = path.join(RAIZ, 'registro', 'token.enc');
const hostDoToken = (t) => (t.startsWith('IG') ? config.instagramHost : config.graphHost);
const chaveCifra = () => crypto.createHash('sha256').update(process.env.IG_CHAVE).digest();

// o token renovado fica cifrado no repositório (AES-256-GCM, chave no secret IG_CHAVE)
function lerTokenSalvo() {
  if (!process.env.IG_CHAVE || !fs.existsSync(ARQ_TOKEN)) return null;
  const j = JSON.parse(fs.readFileSync(ARQ_TOKEN, 'utf8'));
  const d = crypto.createDecipheriv('aes-256-gcm', chaveCifra(), Buffer.from(j.iv, 'base64'));
  d.setAuthTag(Buffer.from(j.tag, 'base64'));
  return { ...j, token: Buffer.concat([d.update(Buffer.from(j.dados, 'base64')), d.final()]).toString('utf8') };
}
function salvarToken(token, expiraEm) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chaveCifra(), iv);
  const dados = Buffer.concat([c.update(token, 'utf8'), c.final()]);
  fs.mkdirSync(path.dirname(ARQ_TOKEN), { recursive: true });
  fs.writeFileSync(ARQ_TOKEN, JSON.stringify({
    renovadoEm: new Date().toISOString(), expiraEm, iv: iv.toString('base64'),
    tag: c.getAuthTag().toString('base64'), dados: dados.toString('base64'),
  }, null, 2) + '\n');
}
function tokenAtual() {
  try { const s = lerTokenSalvo(); if (s) return s.token; } catch (e) { console.error(`aviso: token salvo ilegível (${e.message}), usando IG_TOKEN`); }
  return process.env.IG_TOKEN || '';
}

// renova o token do Instagram uma vez por semana (ele vale 60 dias e só renova depois de 24 h)
async function renovarToken(forcar = false) {
  const token = tokenAtual();
  if (!token.startsWith('IG') || !process.env.IG_CHAVE) return;
  let salvo = null;
  try { salvo = lerTokenSalvo(); } catch {}
  if (!forcar && salvo && Date.now() - Date.parse(salvo.renovadoEm) < 7 * 86400e3) return;
  try {
    const r = await fetch(`${config.instagramHost}/refresh_access_token?${new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token })}`);
    const j = await r.json();
    if (j.error || !j.access_token) throw new Error(j.error?.message || `HTTP ${r.status}`);
    salvarToken(j.access_token, new Date(Date.now() + j.expires_in * 1000).toISOString());
    console.log(`token do Instagram renovado (vale até ${new Date(Date.now() + j.expires_in * 1000).toLocaleDateString('pt-BR')})`);
  } catch (e) {
    console.error(`aviso: não renovei o token do Instagram (${e.message}); tento de novo na próxima execução`);
  }
}

async function graph(metodo, caminho, params) {
  const token = tokenAtual();
  const url = new URL(`${hostDoToken(token)}/${config.graphVersao}/${caminho}`);
  const corpo = new URLSearchParams({ ...params, access_token: token });
  const r = metodo === 'GET'
    ? await fetch(`${url}?${corpo}`)
    : await fetch(url, { method: 'POST', body: corpo });
  const j = await r.json();
  if (j.error) throw new Error(`Instagram: ${j.error.message} (código ${j.error.code})`);
  return j;
}

async function publicarStory(urlPublica, tipo) {
  const { IG_USER_ID } = process.env;
  if (!IG_USER_ID || !tokenAtual()) throw new Error('faltam IG_USER_ID e IG_TOKEN');
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

// ---------- posts de feed agendados (Reels ou carrossel) ----------
// feed/<pasta>/post.json = { "quando": "2026-11-06T14:00:00-03:00", "video": "video.mp4", "capa": "capa.jpg",
// "legenda": "legenda.txt" } ou, para carrossel, "imagens": ["1.jpg", ...] (JPEG). Os arquivos vão no próprio repositório (público), então o endereço raw
// do GitHub serve de hospedagem. Publica uma vez, até 90 min depois do horário.
const ARQ_FEED = path.join(RAIZ, 'registro', 'feed.json');

async function feed(simular) {
  // só a nuvem posta no feed: a reserva local nunca disputa o mesmo post
  if (process.env.RESERVA_MIN_ATRASO) return;
  const dir = path.join(RAIZ, 'feed');
  if (!fs.existsSync(dir)) return;
  const reg = fs.existsSync(ARQ_FEED) ? JSON.parse(fs.readFileSync(ARQ_FEED, 'utf8')) : {};
  const { IG_USER_ID, GITHUB_REPOSITORY } = process.env;
  const repo = GITHUB_REPOSITORY || 'jin-perigoso/mcr-stories';
  for (const nome of fs.readdirSync(dir).sort()) {
    const arq = path.join(dir, nome, 'post.json');
    if (!fs.existsSync(arq) || reg[nome]) continue;
    const p = JSON.parse(fs.readFileSync(arq, 'utf8'));
    const atraso = (Date.now() - Date.parse(p.quando)) / 60e3;
    if (!(atraso >= 0)) continue; // ainda não é a hora (ou data inválida)
    if (atraso > (config.toleranciaMinutos ?? 90)) { console.log(`feed ${nome}: passou da tolerância, não publico`); continue; }
    const legenda = fs.readFileSync(path.join(dir, nome, p.legenda), 'utf8').trim();
    // já no ar? (registro que não chegou ao repositório, por exemplo)
    const recentes = await graph('GET', `${IG_USER_ID}/media`, { fields: 'id,caption,timestamp', limit: '10' });
    const ja = recentes.data.find((m) => Date.parse(m.timestamp) >= Date.parse(p.quando) - 5 * 60e3 && (m.caption || '').slice(0, 60) === legenda.slice(0, 60));
    if (ja) { reg[nome] = { mediaId: ja.id, publicadoEm: ja.timestamp, detectadoNoInstagram: true }; }
    else {
      const raw = (f) => `https://raw.githubusercontent.com/${repo}/master/feed/${encodeURIComponent(nome)}/${encodeURIComponent(f)}`;
      if (simular) { console.log(`feed ${nome}: publicaria ${(p.imagens || [p.video]).map(raw).join(', ')}`); continue; }
      let container;
      if (p.imagens) {
        // carrossel: um contêiner por imagem (JPEG), depois o contêiner CAROUSEL com os filhos na ordem
        const filhos = [];
        for (const img of p.imagens) {
          const { id: filho } = await graph('POST', `${IG_USER_ID}/media`, { image_url: raw(img), is_carousel_item: 'true' });
          filhos.push(filho);
        }
        ({ id: container } = await graph('POST', `${IG_USER_ID}/media`, { media_type: 'CAROUSEL', children: filhos.join(','), caption: legenda }));
      } else {
        const params = { media_type: 'REELS', video_url: raw(p.video), caption: legenda, share_to_feed: 'true' };
        if (p.capa) params.cover_url = raw(p.capa);
        ({ id: container } = await graph('POST', `${IG_USER_ID}/media`, params));
      }
      let status = '';
      for (let i = 0; i < 30 && status !== 'FINISHED'; i++) {
        ({ status_code: status } = await graph('GET', container, { fields: 'status_code' }));
        if (status === 'ERROR' || status === 'EXPIRED') throw new Error(`feed ${nome}: processamento da mídia falhou (${status})`);
        if (status !== 'FINISHED') await new Promise((ok) => setTimeout(ok, 10000));
      }
      if (status !== 'FINISHED') throw new Error(`feed ${nome}: mídia ainda processando, tento no próximo minuto`);
      const { id } = await graph('POST', `${IG_USER_ID}/media_publish`, { creation_id: container });
      reg[nome] = { mediaId: id, publicadoEm: new Date().toISOString() };
      console.log(`feed ${nome}: publicado (${id})`);
    }
    fs.mkdirSync(path.dirname(ARQ_FEED), { recursive: true });
    fs.writeFileSync(ARQ_FEED, JSON.stringify(reg, null, 2) + '\n');
  }
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

// Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher)
function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return Date.UTC(ano, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
}

// Feriados sem pregão na B3: nacionais, os móveis da Páscoa, 24/12 e 31/12.
// config.feriados acrescenta exceções (pregão suspenso por decisão da B3, por exemplo).
function feriadosB3(ano) {
  const p = pascoa(ano);
  const desloc = (dias) => new Date(p + dias * 86400e3).toISOString().slice(0, 10);
  const fixos = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-24', '12-25', '12-31'];
  return [...fixos.map((md) => `${ano}-${md}`), desloc(-48), desloc(-47), desloc(-2), desloc(60)];
}

function diaSemPregao(data) {
  const semana = new Date(`${data}T12:00:00Z`).getUTCDay();
  if (config.diasUteis && (semana === 0 || semana === 6)) return true;
  return feriadosB3(Number(data.slice(0, 4))).includes(data) || config.feriados.includes(data);
}

async function agora(simular) {
  const { data, minutos } = agoraNoFuso();
  if (!simular) await renovarToken();
  if (diaSemPregao(data) && !fs.existsSync(path.join(RAIZ, 'fila', data))) { console.log(`${data}: sem pregão, nada a publicar`); return; }
  // feriado ou fim de semana com pasta manual: publica só o que estiver na fila
  const horarios = horariosDoDia(data);
  const reg = lerRegistro(data);
  let falhas = 0;
  for (let i = 0; i < horarios.length; i++) {
    const n = i + 1;
    // começa 1 min antes: gerar, hospedar e o Instagram processar leva ~1 min, e o Story cai no horário
    const atraso = minutos - emMinutos(horarios[i]) + (config.antecipacaoMinutos ?? 0);
    if (atraso < 0 || reg[n]) continue;
    // a reserva do computador só entra se a nuvem estiver atrasada (evita publicar duas vezes)
    if (atraso < Number(process.env.RESERVA_MIN_ATRASO || 0)) continue;
    if (atraso > config.toleranciaMinutos) { console.log(`pulado ${data} #${n}: passou ${atraso} min do horário`); continue; }
    // trava contra Story duplicado: se o Instagram já tem um Story desse horário, só registra
    const existente = simular ? null : await jaNoAr(data, horarios, i, reg).catch(() => null);
    if (existente) {
      reg[n] = { arquivo: null, mediaId: existente.id, publicadoEm: existente.timestamp, detectadoNoInstagram: true };
      salvarRegistro(data, reg);
      console.log(`${data} #${n} já está no Instagram (media ${existente.id}); não publico de novo`);
      continue;
    }
    try { await publicarSlot(data, n, simular); } catch (e) {
      falhas++;
      console.error(`ERRO ${data} #${n}: ${e.message}`);
      // 15 min de atraso sem conseguir: avisa uma vez (o workflow abre um alerta no GitHub)
      if (atraso >= 15 && !simular) alertar(data, n, horarios[i], e.message);
    }
  }
  if (falhas) process.exit(1);
}

// Story no ar publicado dentro da janela deste horário (de 2 min antes dele até 2 min antes do
// próximo) e que não pertence a outro horário do registro.
let storiesNoAr = null;
async function jaNoAr(data, horarios, i, reg) {
  if (!storiesNoAr) storiesNoAr = (await graph('GET', `${process.env.IG_USER_ID}/stories`, { fields: 'id,timestamp' })).data || [];
  const instante = (hhmm) => Date.parse(`${data}T${hhmm}:00-03:00`);
  const inicio = instante(horarios[i]) - 2 * 60e3;
  const fim = horarios[i + 1] ? instante(horarios[i + 1]) - 2 * 60e3 : instante('23:59');
  const usados = new Set(Object.values(reg).map((r) => r?.mediaId));
  return storiesNoAr.find((s) => !usados.has(s.id) && Date.parse(s.timestamp.replace(/(\d\d)(\d\d)$/, '$1:$2')) >= inicio && Date.parse(s.timestamp.replace(/(\d\d)(\d\d)$/, '$1:$2')) < fim) || null;
}

// Alerta para o workflow transformar em issue (o GitHub manda e-mail). Um por Story por dia.
function alertar(data, n, horario, erro) {
  const marca = path.join(RAIZ, 'registro', `${data}-alertas.json`);
  const ja = fs.existsSync(marca) ? JSON.parse(fs.readFileSync(marca, 'utf8')) : {};
  if (ja[n]) return;
  ja[n] = new Date().toISOString();
  fs.writeFileSync(marca, JSON.stringify(ja, null, 2) + '\n');
  const titulo = `Story ${n} de ${data.split('-').reverse().join('/')} (${horario}) ainda não saiu`;
  const corpo = `${config.pautas[n - 1] || ''}\n\nO sistema segue tentando a cada minuto até ${config.toleranciaMinutos} min depois do horário.\n\nÚltimo erro:\n\n    ${erro}\n\nPara publicar à mão: Actions > Stories MCR > Run workflow > slot ${n}.`;
  fs.appendFileSync(path.join(RAIZ, 'alerta.txt'), JSON.stringify({ titulo, corpo }) + '\n');
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
  if (cmd === 'agora') {
    // posts de feed agendados rodam junto, sem atrapalhar os Stories se falharem
    let erroFeed = null;
    try { await feed(simular); } catch (e) { erroFeed = e; console.error(`aviso: ${e.message}`); }
    await agora(simular);
    if (erroFeed) throw erroFeed;
  }
  else if (cmd === 'slot') await publicarSlot(posicionais[1] || agoraNoFuso().data, Number(posicionais[0]), simular);
  else if (cmd === 'renovar') await renovarToken(true);
  else if (cmd === 'feed') await feed(simular);
  else if (cmd === 'verificar') verificar(posicionais[0] || agoraNoFuso().data);
  else { console.log('uso: node publicar.js agora|slot <n> [data]|verificar [data]|renovar [--simular]'); process.exit(1); }
})().catch((e) => { console.error(`ERRO: ${e.message}`); process.exit(1); });
