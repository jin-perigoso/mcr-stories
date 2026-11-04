#!/usr/bin/env node
// Ativação dos Stories automáticos, uma vez só. Rode no PowerShell, dentro desta pasta:
//
//   node configurar.js            ativação completa (Meta + GitHub + prévia na nuvem)
//   node configurar.js --testar   confere se o token salvo ainda publica
//
// O que você precisa ter em mãos (passo a passo no README, seção "Ativação"):
//   1. acesso de admin à Página do Facebook ligada ao @mcrupinvest
//   2. ID e chave secreta do app da Meta
//   3. um token de usuário gerado no Graph API Explorer com as permissões listadas no README

const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const { execFileSync, spawnSync } = require('child_process');

const RAIZ = __dirname;
const config = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config.json'), 'utf8'));
const GRAPH = `${config.graphHost}/${config.graphVersao}`;
const ARQ_ENV = path.join(RAIZ, '.env');
const PERMISSOES = ['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement', 'business_management'];

const ok = (t) => console.log(`  ✔ ${t}`);
const passo = (t) => console.log(`\n${t}`);
function parar(t) { console.error(`\n  ✖ ${t}\n`); process.exit(1); }

async function graph(caminho, params) {
  const r = await fetch(`${GRAPH}/${caminho}?${new URLSearchParams(params)}`);
  const j = await r.json();
  if (j.error) throw new Error(`${j.error.message} (código ${j.error.code})`);
  return j;
}

function lerEnv() {
  if (!fs.existsSync(ARQ_ENV)) return {};
  return Object.fromEntries(fs.readFileSync(ARQ_ENV, 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
}
function salvarEnv(valores) {
  const atual = { ...lerEnv(), ...valores };
  fs.writeFileSync(ARQ_ENV, Object.entries(atual).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
}

function acharGh() {
  for (const c of ['gh', 'C:/Program Files/GitHub CLI/gh.exe']) {
    if (spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0) return c;
  }
  return null;
}

// ---------- Meta: token permanente da Página + conta do Instagram ----------
async function configurarMeta(rl) {
  passo('1/3  Meta (Facebook e Instagram)');
  const appId = (await rl.question('  ID do app da Meta: ')).trim();
  const appSecret = (await rl.question('  Chave secreta do app: ')).trim();
  const tokenCurto = (await rl.question('  Token do Graph API Explorer: ')).trim();
  if (!appId || !appSecret || !tokenCurto) parar('os três campos são obrigatórios.');

  const longo = await graph('oauth/access_token', { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: tokenCurto })
    .catch((e) => parar(`não consegui trocar o token: ${e.message}`));
  ok('token de usuário trocado por um de longa duração');

  const perms = await graph('me/permissions', { access_token: longo.access_token });
  const concedidas = perms.data.filter((p) => p.status === 'granted').map((p) => p.permission);
  const faltando = PERMISSOES.filter((p) => !concedidas.includes(p));
  if (faltando.length) parar(`o token não tem: ${faltando.join(', ')}. Gere outro no Graph API Explorer marcando essas permissões.`);
  ok('permissões de publicação concedidas');

  const paginas = await graph('me/accounts', { access_token: longo.access_token, fields: 'name,access_token,instagram_business_account{username,id}', limit: '100' });
  const alvo = config.instagramUsuario;
  const pagina = paginas.data.find((p) => p.instagram_business_account?.username?.toLowerCase() === alvo);
  if (!pagina) {
    const vistas = paginas.data.map((p) => `${p.name}${p.instagram_business_account ? ` (@${p.instagram_business_account.username})` : ' (sem Instagram ligado)'}`);
    parar(`não achei a Página ligada ao @${alvo}. Páginas que este login administra: ${vistas.join('; ') || 'nenhuma'}.\n    Confira se você é admin da Página e se o Instagram está ligado a ela como conta profissional.`);
  }
  ok(`Página "${pagina.name}" ligada ao @${pagina.instagram_business_account.username}`);

  // o token de Página obtido a partir de um token de usuário de longa duração não expira
  const debug = await graph('debug_token', { input_token: pagina.access_token, access_token: `${appId}|${appSecret}` });
  const expira = debug.data?.expires_at;
  ok(expira ? `token da Página expira em ${new Date(expira * 1000).toLocaleDateString('pt-BR')}` : 'token da Página sem data de expiração');

  const igId = pagina.instagram_business_account.id;
  const conta = await graph(igId, { access_token: pagina.access_token, fields: 'username,media_count' });
  ok(`acesso de leitura ao Instagram confirmado (@${conta.username}, ${conta.media_count} publicações)`);

  salvarEnv({ IG_USER_ID: igId, IG_TOKEN: pagina.access_token });
  ok('credenciais salvas em .env (fica só neste computador)');
  return { IG_USER_ID: igId, IG_TOKEN: pagina.access_token };
}

// ---------- GitHub: repositório, secrets e prévia ----------
async function configurarGitHub(rl, segredos) {
  passo('2/3  GitHub');
  const gh = acharGh();
  if (!gh) parar('instale o GitHub CLI: winget install GitHub.cli');
  const run = (args, opts = {}) => execFileSync(gh, args, { cwd: RAIZ, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });

  if (spawnSync(gh, ['auth', 'status'], { stdio: 'ignore' }).status !== 0) {
    console.log('  Vai abrir o navegador para você entrar no GitHub. Copie o código que aparecer aqui.');
    const login = spawnSync(gh, ['auth', 'login', '--web', '--git-protocol', 'https', '--hostname', 'github.com', '--scopes', 'workflow'], { stdio: 'inherit' });
    if (login.status !== 0) parar('login no GitHub não concluído.');
  }
  run(['auth', 'setup-git']);
  ok(`conectado ao GitHub como ${run(['api', 'user', '--jq', '.login']).trim()}`);

  const temOrigem = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: RAIZ, stdio: 'ignore' }).status === 0;
  if (!temOrigem) {
    const resp = (await rl.question('  Repositório público? Sem Cloudinary, ele precisa ser público para hospedar as imagens. [S/n] ')).trim().toLowerCase();
    const publico = resp !== 'n';
    if (!publico) {
      console.log('  Repositório privado: precisa do Cloudinary (conta grátis em cloudinary.com > Dashboard).');
      segredos.CLOUDINARY_CLOUD = (await rl.question('  Cloud name: ')).trim();
      segredos.CLOUDINARY_KEY = (await rl.question('  API key: ')).trim();
      segredos.CLOUDINARY_SECRET = (await rl.question('  API secret: ')).trim();
      salvarEnv({ CLOUDINARY_CLOUD: segredos.CLOUDINARY_CLOUD, CLOUDINARY_KEY: segredos.CLOUDINARY_KEY, CLOUDINARY_SECRET: segredos.CLOUDINARY_SECRET });
    }
    const nome = (await rl.question('  Nome do repositório [mcr-stories]: ')).trim() || 'mcr-stories';
    run(['repo', 'create', nome, publico ? '--public' : '--private', '--source', '.', '--remote', 'origin', '--push',
      '--description', 'Stories diários de mercado da MCR Up Invest, gerados e publicados automaticamente']);
    ok(`repositório ${publico ? 'público' : 'privado'} "${nome}" criado e código enviado`);
  } else {
    spawnSync('git', ['push', '-u', 'origin', 'HEAD'], { cwd: RAIZ, stdio: 'inherit' });
    ok('código atualizado no repositório existente');
  }

  for (const [k, v] of Object.entries(segredos)) {
    if (v) { run(['secret', 'set', k], { input: v }); ok(`secret ${k} cadastrado`); }
  }
  return run;
}

async function rodarPrevia(run) {
  passo('3/3  Prévia na nuvem');
  // o GitHub leva alguns segundos para registrar o workflow de um repositório novo
  let disparou = false;
  for (let i = 0; i < 10 && !disparou; i++) {
    try { run(['workflow', 'run', 'stories.yml', '-f', 'previa=true']); disparou = true; } catch { await new Promise((r) => setTimeout(r, 6000)); }
  }
  if (!disparou) parar('não consegui disparar a prévia. Abra a aba Actions do repositório e rode "Stories MCR" com a opção previa.');
  ok('prévia disparada: gera os 6 Stories na nuvem sem publicar');
  console.log(`  Acompanhe em: ${run(['repo', 'view', '--json', 'url', '--jq', '.url']).trim()}/actions`);
  console.log('  Quando terminar, as imagens ficam em Artifacts. Se estiverem certas, não precisa fazer mais nada:');
  console.log('  a partir do próximo dia útil os Stories saem sozinhos nos horários.\n');
}

// ---------- teste do token salvo ----------
async function testar() {
  const env = { ...lerEnv(), ...process.env };
  if (!env.IG_USER_ID || !env.IG_TOKEN) parar('não há IG_USER_ID e IG_TOKEN em .env. Rode node configurar.js primeiro.');
  const conta = await graph(env.IG_USER_ID, { access_token: env.IG_TOKEN, fields: 'username' }).catch((e) => parar(`token inválido: ${e.message}`));
  const limite = await graph(`${env.IG_USER_ID}/content_publishing_limit`, { access_token: env.IG_TOKEN, fields: 'quota_usage,config' }).catch(() => null);
  ok(`token válido para @${conta.username}`);
  if (limite?.data?.[0]) ok(`publicações por API nas últimas 24 h: ${limite.data[0].quota_usage} de ${limite.data[0].config?.quota_total ?? '?'}`);
}

(async () => {
  if (process.argv.includes('--testar')) return testar();
  console.log('\nAtivação dos Stories automáticos da MCR Up Invest');
  const leitor = readline.createInterface({ input: process.stdin, output: process.stdout });
  const linhas = leitor[Symbol.asyncIterator]();
  // pergunta lendo linha a linha: funciona no terminal e com respostas enviadas por pipe
  const rl = { question: async (q) => { process.stdout.write(q); const { value } = await linhas.next(); return value ?? ''; } };
  try {
    const segredos = await configurarMeta(rl);
    const run = await configurarGitHub(rl, segredos);
    await rodarPrevia(run);
  } finally {
    leitor.close();
  }
})().catch((e) => parar(e.message));
