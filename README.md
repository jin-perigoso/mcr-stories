# Stories automáticos da MCR Up Invest

Todo dia útil, no horário de cada Story, o sistema busca os dados do momento, escreve as frases,
gera a imagem no modelo aprovado (`modelos/story.html`) e publica no @mcrupinvest pela API oficial
do Instagram. Roda no GitHub Actions (nuvem, de graça, não depende do PC ligado).
Sábado, domingo e feriado da B3 não publica.

| # | Horário | Story | De onde vêm os dados |
|---|---|---|---|
| 1 | 07:45 | Agenda do dia (eventos de 3 estrelas) | Forex Factory (impacto alto: EUA, zona do euro, China) + `dados-base/agenda-br.json` |
| 2 | 08:45 | O que acompanhar hoje | agenda do dia, último fechamento e último pregão (gravados em `registro/`) |
| 3 | 13:00 | Parcial | Yahoo Finance, cotação do momento |
| 4 | 18:30 | Maiores altas do Ibovespa | carteira teórica da B3 + Yahoo Finance |
| 5 | 18:40 | Maiores baixas do Ibovespa | mesmos dados do 4 |
| 6 | 19:00 | Fechamento | Yahoo Finance e CME |

## O que fazer no dia a dia

Nada, se o automático estiver bom. Para interferir:

- **Agenda do Brasil (toda semana):** o Forex Factory não cobre o Brasil. Copom, IPCA, PIB e outros
  eventos de 3 estrelas daqui entram em `dados-base/agenda-br.json`.
- **Escrever o "O que acompanhar hoje" (ou uma frase de apoio):** criar `fila/AAAA-MM-DD/textos.json`:
  ```json
  {
    "acompanhar": [
      { "t": "Petróleo em queda", "d": "O WTI caiu 7,36% ontem com sinais de negociação do Irã." }
    ],
    "apoio": { "6": "Segunda, 2 de novembro. O petróleo despencou com o Irã." }
  }
  ```
  `acompanhar` substitui os itens automáticos; `acompanharExtra` entra antes deles.
  `apoio` troca a frase abaixo do título do Story indicado (1, 3, 4, 5 ou 6).
- **Substituir um Story inteiro:** colocar a imagem pronta em `fila/AAAA-MM-DD/n.jpg` (1080x1920, JPG
  até 8 MB, ou MP4 9:16 de 3 a 60 s). Arquivo na fila tem prioridade sobre o gerado.
- **Ver antes de sair:** Actions > Stories MCR > Run workflow > marcar "previa". Gera os 6 com os
  dados daquele momento, sem publicar, e deixa as imagens em Artifacts.

Horário diferente num dia específico: `fila/AAAA-MM-DD/horarios.json` com `["08:00","11:00",...]`
(os horários precisam cair perto das execuções do workflow; ver abaixo).
Feriados da B3: `config.json > feriados` (conferir o calendário oficial da B3 a cada ano).

## O que a API não faz

Story publicado por API sai **sem figurinhas**: nada de link clicável, enquete, caixinha de perguntas,
contagem regressiva, música ou menção clicável. Texto e marcações desenhados na arte funcionam normalmente.
Stories interativos precisam ser postados à mão pelo app.

## Ativação (uma vez, uns 15 minutos)

Tudo o que não depende de acesso já está pronto: geração, publicação, horários, feriados da B3
(calculados sozinhos, inclusive Carnaval e Corpus Christi), agenda do Copom até dez/2027 e do IPCA
até jan/2027, hospedagem das imagens e o GitHub CLI instalado neste computador.

### 1. Acesso à Página (com a MCR)
- O @mcrupinvest precisa ser **conta profissional** ligada a uma **Página do Facebook**.
- A MCR adiciona você na Página pelo Meta Business Suite: Configurações > Pessoas > Adicionar,
  com **acesso total** à Página e ao Instagram. Login e senha não são necessários.

### 2. App da Meta (no seu login do Facebook)
1. developers.facebook.com > Meus apps > Criar app. Tipo **Empresa** e, se pedir caso de uso,
   o de gerenciar conteúdo do Instagram com login do Facebook.
2. Em Configurações do app > Básico, copie o **ID do app** e a **Chave secreta**.
3. Abra o Graph API Explorer (developers.facebook.com/tools/explorer), escolha o app, clique em
   **Gerar token de acesso** e marque: `instagram_basic`, `instagram_content_publish`,
   `pages_show_list`, `pages_read_engagement`, `business_management`. Autorize a Página da MCR.
4. Copie o token gerado.

O app pode ficar em modo desenvolvimento: como você é admin do app e da Página, publica sem revisão da Meta.

### 3. Rodar o assistente
No PowerShell, nesta pasta:
```
node configurar.js
```
Ele pede o ID do app, a chave secreta e o token, e faz o resto:
- troca o token por um permanente e confere as permissões;
- encontra a Página ligada ao @mcrupinvest e testa o acesso;
- abre o navegador para você entrar no GitHub (um clique);
- cria o repositório, envia o código e cadastra os secrets;
- dispara uma prévia na nuvem (gera os 6 Stories sem publicar).

Se a prévia estiver certa, acabou: no próximo dia útil os Stories saem sozinhos.
Para conferir o token depois: `node configurar.js --testar`.

**Público ou privado?** Sem Cloudinary, o repositório precisa ser **público**, porque o próprio GitHub
hospeda a imagem por alguns minutos até o Instagram buscá-la (ramo `midia`, sempre com um arquivo só).
O token não fica no código: fica nos secrets do GitHub, que ninguém vê. Para repositório privado, o
assistente pede uma conta grátis do Cloudinary (Cloud name, API key e API secret).

| Secret | O que é | Quem cadastra |
|---|---|---|
| `IG_USER_ID` | ID da conta do Instagram | o assistente |
| `IG_TOKEN` | token permanente da Página | o assistente |
| `CLOUDINARY_*` | só no repositório privado | o assistente |

## Como funciona

- O workflow roda em cada horário e tem execuções de reforço logo depois (o GitHub às vezes atrasa ou pula execuções).
- Cada execução publica os horários de hoje que já venceram e ainda não saíram.
  Se passou mais de 90 min do horário, pula.
- O que saiu fica em `registro/AAAA-MM-DD.json`, o que impede publicar duas vezes.
- Falhou: o GitHub manda e-mail e o erro aparece na aba Actions. Para republicar à mão: Run workflow > slot `n`.
- Sábado, domingo e feriados da B3 não rodam. Uma pasta manual em `fila/` num feriado publica só o que estiver nela.
- Mudou `config.json > horarios`? Ajustar também os `cron` em `.github/workflows/stories.yml` (UTC = Brasília + 3 h).

## Comandos locais

```
node gerar.js todos [data]                 gera os 6 em gerados/AAAA-MM-DD/ (sem publicar)
node gerar.js 4 [data]                     gera só um
node publicar.js verificar [data]          mostra o que sai de cada horário (manual ou automático)
node publicar.js agora --simular           gera e mostra o que seria publicado agora
node publicar.js slot 3 [data] --simular   simula um Story específico
```
Sem `--simular` publica de verdade (precisa das variáveis de ambiente acima).
