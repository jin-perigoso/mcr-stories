#!/usr/bin/env node
// Liga o perfil do X, uma vez só. No PowerShell, dentro desta pasta:   node configurar-x.js
//
// Antes, em console.x.com (logado com a conta da MCR no X):
//   1. criar o app; em "User authentication settings": permissão Read and Write,
//      tipo "Web App, Automated App or Bot", callback http://localhost, site https://mcrupinvest.com.br
//   2. em "Keys and tokens": copiar API Key e Secret; gerar Access Token e Secret (depois do passo 1)
//   3. em "Billing": cadastrar cartão e comprar créditos (o volume da MCR fica em ~US$ 2 por mês)

const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const { spawnSync } = require('child_process');

const RAIZ = __dirname;
const ARQ_ENV = path.join(RAIZ, '.env');
const REPO = 'jin-perigoso/mcr-stories';
const CHAVES = [
  ['X_API_KEY', 'API Key (Consumer Key)'], ['X_API_SECRET', 'API Key Secret'],
  ['X_ACCESS_TOKEN', 'Access Token'], ['X_ACCESS_SECRET', 'Access Token Secret'],
];
const ok = (t) => console.log(`  ✔ ${t}`);
const aviso = (t) => console.log(`  ! ${t}`);
function parar(t) { console.error(`\n  ✖ ${t}\n`); process.exit(1); }

function lerEnv() {
  if (!fs.existsSync(ARQ_ENV)) return {};
  return Object.fromEntries(fs.readFileSync(ARQ_ENV, 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
}
function salvarEnv(v) {
  fs.writeFileSync(ARQ_ENV, Object.entries({ ...lerEnv(), ...v }).map(([k, x]) => `${k}=${x}`).join('\n') + '\n');
  Object.assign(process.env, v);
}

(async () => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('\nPerfil da MCR no X\n\n1/3  Chaves do app (console.x.com > o app > Keys and tokens)');
  const env = lerEnv();
  const novos = {};
  for (const [k, rotulo] of CHAVES) {
    const atual = env[k];
    const v = (await rl.question(`  ${rotulo}${atual ? ' (Enter mantém a salva)' : ''}: `)).trim();
    novos[k] = v || atual || parar(`falta ${rotulo}`);
  }
  salvarEnv(novos);

  const { x, postar } = require('./x');
  let eu;
  try { eu = (await x('GET', 'users/me')).data; } catch (e) {
    parar(`o X recusou as chaves (${e.message}).\n    Confira se a permissão é Read and Write e se o Access Token foi gerado DEPOIS de trocar a permissão.\n    HTTP 402 = falta comprar créditos em Billing.`);
  }
  ok(`conectado como @${eu.username}`);

  console.log('\n2/3  Secrets no GitHub');
  const gh = ['gh', 'C:/Program Files/GitHub CLI/gh.exe'].find((c) => spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0);
  if (!gh) aviso('GitHub CLI não encontrado: cadastre X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN e X_ACCESS_SECRET à mão');
  else for (const [k] of CHAVES) {
    const r = spawnSync(gh, ['secret', 'set', k, '-R', REPO, '--body', process.env[k]], { encoding: 'utf8' });
    if (r.status === 0) ok(k); else aviso(`${k}: ${(r.stderr || '').trim()}`);
  }

  console.log('\n3/3  Post de boas-vindas (fica público; fixe pelo app depois)');
  if ((await rl.question('  Publicar agora? (s/N) ')).trim().toLowerCase() === 's') {
    const texto = fs.readFileSync(path.join(RAIZ, 'dados-base', 'x-boasvindas.txt'), 'utf8').trim();
    const id = await postar(texto);
    ok(`publicado: https://x.com/${eu.username}/status/${id}`);
  }
  console.log('\nPronto. A nuvem posta no X a partir do próximo horário (7h45, 13h e 19h; enquete na sexta às 10h).\n');
  rl.close();
})().catch((e) => parar(e.message));
