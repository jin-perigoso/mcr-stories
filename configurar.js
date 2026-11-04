#!/usr/bin/env node
// Ativação dos Stories automáticos, uma vez só. Rode no PowerShell, dentro desta pasta:
//
//   node configurar.js            ativação completa (Meta + GitHub + prévia na nuvem)
//   node configurar.js --testar   confere se o token salvo ainda publica
//
// Dois caminhos (passo a passo no README, seção "Ativação"):
//   Instagram (padrão, a MCR não tem Facebook): app da Meta no seu Facebook + token gerado
//     com o login do Instagram da MCR. O token vale 60 dias e o publicar.js renova sozinho.
//   Página do Facebook: ID e chave do app + token do Graph API Explorer. Token sem validade.

const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const { execFileSync, spawnSync } = require('child_process');

const RAIZ = __dirname;
const config = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config.json'), 'utf8'));
const GRAPH = `${config.graphHost}/${config.graphVersao}`;
const GRAPH_IG = `${config.instagramHost}/${config.graphVersao}`;
const ARQ_ENV = path.join(RAIZ, '.env');
const PERMISSOES = ['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement', 'business_management'];

const ok = (t) => console.log(`  ✔ ${t}`);
const passo = (t) => console.log(`\n${t}`);
function parar(t) { console.error(`\n  ✖ ${t}\n`); process.exit(1); }

async function graph(caminho, params) {
  // token do login pelo Instagram começa com "IG" e usa outro host
  const base = String(params.access_token || '').startsWith('IG') ? GRAPH_IG : GRAPH;
  const r = await fetch(`${base}/${caminho}?${new URLSearchParams(params)}`);
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
function abrir(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  spawnSync(cmd[0], cmd[1], { stdio: 'ignore' });
}

async function configurarMeta(rl) {
  passo('1/3  Meta (Facebook e Instagram)');
  console.log('  Vou abrir no navegador: criar o app, as chaves do app e o Graph API Explorer.');
  console.log(`  No Explorer, clique em "Gerar token de acesso" e marque: ${PERMISSOES.join(', ')}.`);
  if ((await rl.question('  Abrir agora? [S/n] ')).trim().toLowerCase() !== 'n') {
    abrir('https://developers.facebook.com/apps/creation/');
    abrir('https://developers.facebook.com/apps/');
    abrir(`https://developers.facebook.com/tools/explorer/?method=GET&path=me%2Faccounts&version=${config.graphVersao}`);
  }
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

// ---------- Business Suite: token de usuário do sistema (não expira) ----------
async function configurarSistema(rl) {
  passo('1/3  Token do usuário do sistema (Business Suite)');
  console.log('  Business Suite > Configurações > Usuários do sistema > MCRUP API > Gerar token:');
  console.log('  app MCRUP Plataforma, validade "Nunca", permissões instagram_basic, instagram_content_publish,');
  console.log('  pages_show_list, pages_read_engagement e business_management.');
  const token = (await rl.question('  Token: ')).trim();
  if (!token) parar('cole o token gerado.');
  const paginas = await graph('me/accounts', { access_token: token, fields: 'name,instagram_business_account{username,id}', limit: '100' })
    .catch((e) => parar(`token recusado: ${e.message}`));
  const alvo = config.instagramUsuario;
  const pagina = paginas.data.find((p) => p.instagram_business_account?.username?.toLowerCase() === alvo);
  if (!pagina) parar(`o usuário do sistema não enxerga a Página ligada ao @${alvo}. Atribua a Página MCR UP e o Instagram a ele.`);
  const igId = pagina.instagram_business_account.id;
  const conta = await graph(igId, { access_token: token, fields: 'username,media_count' });
  ok(`@${conta.username} pela Página "${pagina.name}" (${conta.media_count} publicações)`);
  const limite = await graph(`${igId}/content_publishing_limit`, { access_token: token, fields: 'quota_usage' }).catch(() => null);
  if (!limite) parar('o token não tem permissão de publicar. Gere de novo marcando instagram_content_publish.');
  ok('permissão de publicação confirmada; token de usuário do sistema não expira');
  salvarEnv({ IG_USER_ID: igId, IG_TOKEN: token });
  ok('credenciais salvas em .env (fica só neste computador)');
  return { IG_USER_ID: igId, IG_TOKEN: token };
}

// ---------- Instagram: login pelo Instagram, sem Página do Facebook ----------
async function configurarInstagram(rl) {
  passo('1/3  Instagram (login do Instagram da MCR)');
  console.log('  No seu Facebook, em developers.facebook.com:');
  console.log('   a) Criar app > caso de uso "Gerenciar mensagens e conteúdo no Instagram" (API do Instagram).');
  console.log('   b) Funções do app > Funções > Adicionar pessoas > Testador do Instagram > mcrupinvest.');
  console.log('      Aceite o convite no Instagram da MCR: instagram.com/accounts/manage_access > Convites de testador.');
  console.log('   c) No caso de uso, "Configuração da API com login do Instagram" > Gerar tokens de acesso >');
  console.log('      Adicionar conta > entre com o Instagram da MCR > copie o token (começa com IG).');
  if ((await rl.question('  Abrir agora? [S/n] ')).trim().toLowerCase() !== 'n') {
    abrir('https://developers.facebook.com/apps/creation/');
    abrir('https://www.instagram.com/accounts/manage_access/');
  }
  const token = (await rl.question('  Token do Instagram: ')).trim();
  if (!token.startsWith('IG')) parar('esse não é um token do login pelo Instagram (ele começa com IG).');

  const conta = await graph('me', { access_token: token, fields: 'user_id,username,account_type,media_count' })
    .catch((e) => parar(`token recusado: ${e.message}`));
  const alvo = config.instagramUsuario;
  if (conta.username?.toLowerCase() !== alvo) parar(`o token é do @${conta.username}, não do @${alvo}. Gere de novo entrando com o Instagram da MCR.`);
  if (conta.account_type === 'PERSONAL') parar('o @' + alvo + ' é conta pessoal. No app do Instagram: Configurações > Tipo de conta > Mudar para conta profissional.');
  ok(`conta @${conta.username} (${conta.account_type}, ${conta.media_count} publicações)`);

  const limite = await graph(`${conta.user_id}/content_publishing_limit`, { access_token: token, fields: 'quota_usage,config' }).catch(() => null);
  if (!limite) parar('o token não tem permissão de publicar. Gere de novo com instagram_business_content_publish marcado.');
  ok('permissão de publicação confirmada');

  // chave que cifra o token renovado guardado no repositório (registro/token.enc)
  const chave = lerEnv().IG_CHAVE || require('crypto').randomBytes(32).toString('hex');
  salvarEnv({ IG_USER_ID: String(conta.user_id), IG_TOKEN: token, IG_CHAVE: chave });
  ok('credenciais salvas em .env (fica só neste computador); o token se renova sozinho toda semana');
  return { IG_USER_ID: String(conta.user_id), IG_TOKEN: token, IG_CHAVE: chave };
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
    console.log('
Como vai ser a ligação com o Instagram?');
    console.log('  1  token do usuário do sistema do Business Suite (recomendado, não expira)');
    console.log('  2  login pelo Instagram (sem Página; token renovado toda semana)');
    console.log('  3  token do Graph API Explorer de um admin da Página');
    const modo = (await rl.question('Escolha [1]: ')).trim() || '1';
    const segredos = modo === '3' ? await configurarMeta(rl) : modo === '2' ? await configurarInstagram(rl) : await configurarSistema(rl);
    const run = await configurarGitHub(rl, segredos);
    await rodarPrevia(run);
  } finally {
    leitor.close();
  }
})().catch((e) => parar(e.message));
