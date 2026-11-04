# Liga a publicação automática neste computador (alternativa ao GitHub Actions).
# Cria a tarefa "MCR Stories" no Agendador do Windows: a cada 10 min, das 07:47 às 19:47 (7 min depois da nuvem),
# roda rodar-local.cmd: sincroniza o registro com o repositório e publica só o que a nuvem não publicou.
# Fim de semana e feriado da B3 o próprio publicar.js ignora. O computador precisa estar ligado.
# Para desligar: Unregister-ScheduledTask -TaskName "MCR Stories" -Confirm:$false

$pasta = $PSScriptRoot
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
$log = Join-Path $pasta 'registro\publicar.log'

$acao = New-ScheduledTaskAction -Execute 'cmd.exe' `
  -Argument "/c `"`"$pasta\rodar-local.cmd`" >> `"$log`" 2>&1`"" -WorkingDirectory $pasta
$gatilho = New-ScheduledTaskTrigger -Daily -At '07:47'
$gatilho.Repetition = (New-ScheduledTaskTrigger -Once -At '07:47' `
  -RepetitionInterval (New-TimeSpan -Minutes 10) -RepetitionDuration (New-TimeSpan -Hours 12)).Repetition
$cfg = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName 'MCR Stories' -Action $acao -Trigger $gatilho -Settings $cfg `
  -Description 'Publica os 6 Stories diários da MCR Up Invest' -Force | Out-Null

Write-Host 'Tarefa "MCR Stories" criada: a cada 10 min, das 07:47 às 19:47.'
