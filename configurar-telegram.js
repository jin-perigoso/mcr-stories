#!/usr/bin/env node
// Liga o canal do Telegram, uma vez só. No PowerShell, dentro desta pasta:
//
//   node configurar-telegram.js
//
// Antes: criar o robô no @BotFather (/newbot) e copiar o token que ele devolve.
// O script confere o token, descobre o seu ID (você manda /start pro robô), confere se o robô é
// admin do canal, salva no .env, cadastra os secrets no GitHub e manda uma prévia no seu privado.

const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const { spawnSync } = require('child_process');

const RAIZ = __dirname;
const ARQ_ENV = path.join(RAIZ, '.env');
const REPO = 'jin-perigoso/mcr-stories';
const CANAL = '@mcrupinvest';
const ok = (t) => console.log(`  ✔ ${t}`);
const aviso = (t) => console.log(`  ! ${t}`);
const passo = (t) => console.log(`\n${t}`);
function parar(t) { console.error(`\n  ✖ ${t}\n`); process.exit(1); }

function lerEnv() {
  if (!fs.existsSync(ARQ_ENV)) return {};
  return Object.fromEntries(fs.readFileSync(ARQ_ENV, 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
}
function salvarEnv(valores) {
  const atual = { ...lerEnv(), ...valores };
  fs.writeFileSync(ARQ_ENV, Object.entries(atual).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  Object.assign(process.env, valores);
}

let TOKEN = '';
async function api(metodo, params = {}) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${metodo}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.description);
  return j.result;
}

function acharGh() {
  for (const c of ['gh', 'C:/Program Files/GitHub CLI/gh.exe']) if (spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0) return c;
  return null;
}

(async () => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const env = lerEnv();
  console.log('\nCanal da MCR no Telegram\n');

  passo('1/5  Token do robô');
  TOKEN = process.argv[2] || env.TELEGRAM_TOKEN || '';
  if (!TOKEN) TOKEN = (await rl.question('  Cole o token que o @BotFather mandou: ')).trim();
  let eu;
  try { eu = await api('getMe'); } catch (e) { parar(`token não aceito (${e.message}). Copie de novo no @BotFather: /mybots > o robô > API Token.`); }
  ok(`robô @${eu.username}`);
  salvarEnv({ TELEGRAM_TOKEN: TOKEN });
  await api('setMyDescription', { description: 'Robô de publicação do canal da MCR Up Invest (t.me/mcrupinvest). Só a equipe da MCR publica por aqui.' }).catch(() => {});
  await api('setMyShortDescription', { short_description: 'Publicação do canal MCR Up Invest' }).catch(() => {});
  await api('setMyCommands', { commands: [{ command: 'ajuda', description: 'Como mandar um aviso para o canal' }] }).catch(() => {});

  passo('2/5  Seu ID (para receber prévias e mandar alertas)');
  const ids = new Set(String(env.TELEGRAM_AUTORIZADOS || '').split(',').filter(Boolean));
  if (ids.size) ok(`já liberados: ${[...ids].join(', ')}`);
  console.log(`  Abra t.me/${eu.username} no seu Telegram e toque em Iniciar (ou mande /start).`);
  console.log('  Thomas e Pedro podem fazer o mesmo agora; espero 2 minutos e libero quem mandar.');
  let ultimo = 0;
  const fim = Date.now() + 120e3;
  while (Date.now() < fim) {
    const ups = await api('getUpdates', { offset: ultimo + 1, timeout: 20, allowed_updates: ['message'] }).catch(() => []);
    for (const u of ups) {
      ultimo = u.update_id;
      const m = u.message;
      if (m?.chat.type !== 'private' || ids.has(String(m.from.id))) continue;
      ids.add(String(m.from.id));
      ok(`${m.from.first_name}${m.from.last_name ? ` ${m.from.last_name}` : ''} (${m.from.id}) liberado`);
      await api('sendMessage', { chat_id: m.chat.id, text: 'Pronto, você está liberado. Mande aqui o que deve sair no canal e eu respondo com o botão para publicar.' }).catch(() => {});
    }
    if (ids.size && (await rl.question('  Mais alguém vai mandar /start? (Enter = não, s = esperar) ')).trim().toLowerCase() !== 's') break;
  }
  if (ultimo) await api('getUpdates', { offset: ultimo + 1, timeout: 0 }).catch(() => {}); // marca como lidos
  if (!ids.size) parar('ninguém mandou /start. Rode de novo e mande /start para o robô.');
  salvarEnv({ TELEGRAM_AUTORIZADOS: [...ids].join(',') });

  passo(`3/5  Robô como administrador de ${CANAL}`);
  let chat;
  for (;;) {
    try {
      chat = await api('getChat', { chat_id: CANAL });
      const membro = await api('getChatMember', { chat_id: chat.id, user_id: eu.id });
      if (membro.status === 'administrator' && membro.can_post_messages) {
        ok(`admin de "${chat.title}" com permissão de postar`);
        if (!membro.can_edit_messages) aviso('sem "Editar mensagens": não consigo fixar a mensagem de boas-vindas (dá pra fixar à mão)');
        if (!membro.can_change_info) aviso('sem "Alterar informações": a descrição do canal fica para fazer à mão');
        chat.permissoes = membro;
        break;
      }
      aviso(`o robô está no canal, mas ${membro.status === 'administrator' ? 'sem permissão de postar' : 'não é administrador'}`);
    } catch (e) { aviso(`ainda não acesso o canal (${e.message})`); }
    console.log(`  No Telegram: canal ${CANAL} > nome do canal > Administradores > Adicionar administrador >`);
    console.log(`  procure @${eu.username} > deixe ligado Publicar mensagens, Editar mensagens e Alterar informações.`);
    await rl.question('  Feito? Enter para conferir de novo. ');
  }
  salvarEnv({ TELEGRAM_CANAL: String(chat.id) });

  passo('4/5  Secrets no GitHub (para a nuvem publicar)');
  const gh = acharGh();
  if (!gh) aviso('GitHub CLI não encontrado: cadastre TELEGRAM_TOKEN, TELEGRAM_CANAL e TELEGRAM_AUTORIZADOS à mão em Settings > Secrets');
  else {
    for (const k of ['TELEGRAM_TOKEN', 'TELEGRAM_CANAL', 'TELEGRAM_AUTORIZADOS']) {
      const r = spawnSync(gh, ['secret', 'set', k, '-R', REPO, '--body', process.env[k]], { encoding: 'utf8' });
      if (r.status === 0) ok(k); else aviso(`${k}: ${(r.stderr || '').trim()}`);
    }
  }

  passo('5/5  Prévia e boas-vindas');
  const tg = require('./telegram');
  const primeiro = [...ids][0];
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  // prévia com o último pregão registrado (o fechamento de hoje só existe depois das 18h)
  const regs = fs.readdirSync(path.join(RAIZ, 'registro')).filter((f) => /-pregao\.json$/.test(f)).sort();
  const ultimoPregao = regs.length ? regs[regs.length - 1].slice(0, 10) : hoje;
  for (const [qual, data] of [['boasvindas', hoje], ['abertura', hoje], ['parcial', hoje], ['fechamento', ultimoPregao]]) {
    try { await tg.enviar(primeiro, await tg.POSTS[qual](data), data); ok(`prévia ${qual} no seu privado`); } catch (e) { aviso(`prévia ${qual}: ${e.message}`); }
  }
  if ((await rl.question(`\n  Publicar agora a mensagem de boas-vindas em ${CANAL} e fixar? (s/N) `)).trim().toLowerCase() === 's') {
    const [id] = await tg.enviar(chat.id, tg.POSTS.boasvindas(), hoje);
    ok('boas-vindas publicada');
    if (chat.permissoes.can_edit_messages) { await api('pinChatMessage', { chat_id: chat.id, message_id: id, disable_notification: true }); ok('fixada'); }
  }
  if (chat.permissoes.can_change_info && (await rl.question('  Trocar a descrição do canal? (s/N) ')).trim().toLowerCase() === 's') {
    await api('setChatDescription', { chat_id: chat.id, description: 'Resumo do mercado todo dia útil: agenda às 7h45, parcial às 13h e fechamento às 19h. MCR Up Invest, agentes de investimento EQI. Conteúdo informativo, não é recomendação.' });
    ok('descrição atualizada');
  }

  console.log(`\nPronto. A nuvem já publica no próximo horário (7h45, 13h e 19h nos dias de pregão; enquete na sexta às 10h).\nAlertas: mande a mensagem para @${eu.username} no privado.\n`);
  rl.close();
})().catch((e) => parar(e.message));
