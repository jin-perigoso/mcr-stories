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

## Configuração (uma vez)

### 1. Conta do Instagram
- @mcrupinvest como **conta profissional** (Empresa) ligada a uma **Página do Facebook**.
- Quem configura precisa ser admin dessa Página.

### 2. App da Meta e token
1. developers.facebook.com > Criar app > tipo **Empresa**.
2. Adicionar o produto **Instagram** (API com login do Facebook).
3. No Graph API Explorer, gerar token de usuário com as permissões
   `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `business_management`.
4. Trocar por token de longa duração e pegar o **token da Página** (não expira enquanto a senha e o acesso não mudarem):
   `GET /me/accounts` com o token longo > campo `access_token` da Página da MCR.
5. ID da conta do Instagram: `GET /{id-da-pagina}?fields=instagram_business_account`.

O app pode ficar em modo desenvolvimento: quem é admin do app e da Página consegue publicar sem revisão da Meta.

### 3. Cloudinary (hospedagem da imagem)
A API do Instagram só aceita mídia por URL pública. Conta grátis em cloudinary.com > Dashboard:
Cloud name, API Key, API Secret.

### 4. Repositório no GitHub
Repositório **privado** com esta pasta. Em Settings > Secrets and variables > Actions, criar:

| Secret | Valor |
|---|---|
| `IG_USER_ID` | ID da conta do Instagram (passo 2.5) |
| `IG_TOKEN` | token da Página (passo 2.4) |
| `CLOUDINARY_CLOUD` | cloud name |
| `CLOUDINARY_KEY` | API key |
| `CLOUDINARY_SECRET` | API secret |

Teste: Actions > Stories MCR > Run workflow > slot `1`.

## Como funciona

- O workflow roda em cada horário e tem execuções de reforço logo depois (o GitHub às vezes atrasa ou pula execuções).
- Cada execução publica os horários de hoje que já venceram e ainda não saíram.
  Se passou mais de 90 min do horário, pula.
- O que saiu fica em `registro/AAAA-MM-DD.json`, o que impede publicar duas vezes.
- Falhou: o GitHub manda e-mail e o erro aparece na aba Actions. Para republicar à mão: Run workflow > slot `n`.
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
