@echo off
rem Reserva local do GitHub Actions: sincroniza o registro, publica o que a nuvem nao publicou
rem e devolve o registro ao repositorio.
cd /d "%~dp0"
set PATH=%PATH%;C:\Program Files\GitHub CLI
git pull -q --rebase --autostash origin master
"C:\Program Files\nodejs\node.exe" publicar.js agora
git add registro dados-base
git diff --cached --quiet || (git commit -q -m "registro: publicado pela reserva local" && git push -q origin master)
