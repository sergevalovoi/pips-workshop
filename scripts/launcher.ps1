# Bay Office alpha launcher (Windows). Actions: start | stop | check. No admin rights, no global changes.
# Instance identity: /health must report app=bay-office-alpha AND the instanceId stored in <data>\instance.json.
param([Parameter(Position = 0)][string]$Action = 'start', [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$data = if ($env:BAY_DATA_DIR) { $env:BAY_DATA_DIR } else { Join-Path $root 'data' }
$port = if ($env:BAY_PORT) { $env:BAY_PORT } else { '8194' }
if ($port -notmatch '^\d{4,5}$') { Write-Host "Invalid BAY_PORT '$port' (use 1024-65535)."; exit 1 }
$healthUrl = "http://127.0.0.1:$port/health"

function Say($m) { Write-Host $m }
function Get-MyId {
  $f = Join-Path $data 'instance.json'
  if (Test-Path -LiteralPath $f) { try { return (Get-Content -LiteralPath $f -Raw | ConvertFrom-Json).instanceId } catch { return $null } }
  return $null
}
# returns: 'free' | 'mine' | 'foreign'
function Get-PortState {
  $h = $null
  try { $h = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2 -UseBasicParsing } catch {
    if ($_.Exception.Response) { return 'foreign' }   # something answered HTTP, but not our health
    return 'free'
  }
  $id = Get-MyId
  if ($h -and $h.app -eq 'bay-office-alpha' -and $id -and $h.instanceId -eq $id) { return 'mine' }
  return 'foreign'
}
function Test-Node {
  $n = Get-Command node -ErrorAction SilentlyContinue
  if (-not $n) {
    Say 'Node.js is not installed (or not on PATH).'
    Say 'Next step: install the LTS version from https://nodejs.org/ , then run START again.'
    return $null
  }
  $v = (& $n.Source -p 'process.versions.node').Trim()
  if ([int]($v.Split('.')[0]) -lt 20) {
    Say "Node.js $v is too old; Bay Office needs 20 or newer."
    Say 'Next step: install the LTS version from https://nodejs.org/ , then run START again.'
    return $null
  }
  return $n.Source
}

switch ($Action) {
  'check' {
    $node = Test-Node; if (-not $node) { exit 1 }
    & $node (Join-Path $PSScriptRoot 'preflight.js'); exit $LASTEXITCODE
  }
  'start' {
    $node = Test-Node; if (-not $node) { exit 1 }
    if (-not (Test-Path -LiteralPath (Join-Path $root 'server.js'))) { Say 'server.js is missing. Re-extract the ZIP into a fresh folder.'; exit 1 }
    $state = Get-PortState
    if ($state -eq 'foreign') {
      Say "Port $port is used by something that is NOT this Bay Office instance (another program or another copy)."
      Say 'Nothing was changed and nothing was stopped. Choose another port, e.g. in PowerShell:  $env:BAY_PORT=8195  and run START again.'
      exit 1
    }
    if ($state -eq 'free') {
      New-Item -ItemType Directory -Force -Path $data | Out-Null
      $out = Join-Path $data 'server.out.log'; $err = Join-Path $data 'server.err.log'
      $argLine = '"' + (Join-Path $root 'server.js') + '"'
      $env:BAY_PORT = $port
      Start-Process -FilePath $node -ArgumentList $argLine -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null
      $up = $false
      for ($i = 0; $i -lt 40 -and -not $up; $i++) { Start-Sleep -Milliseconds 500; if ((Get-PortState) -eq 'mine') { $up = $true } }
      if (-not $up) {
        Say 'Bay Office did not start. The reason reported by the server:'
        if (Test-Path -LiteralPath $err) { Get-Content -LiteralPath $err -Tail 6 | ForEach-Object { Say ('  ' + $_) } }
        exit 1
      }
      Say 'Bay Office started (hidden background process).'
    } else { Say 'Bay Office is already running.' }
    $linkFile = Join-Path $data 'launch-url.txt'
    if (-not $NoBrowser -and (Test-Path -LiteralPath $linkFile)) { Start-Process ((Get-Content -LiteralPath $linkFile -Raw).Trim()) }
    if ($NoBrowser) { Say 'The private launch link is stored in the data folder (not printed here); the browser was not opened.' } else { Say 'The private launch link is stored in the data folder and was opened in your browser (it is not printed here).' }
    Say 'Tip: run CHECK to see whether Claude Code is installed and signed in.'
    exit 0
  }
  'stop' {
    $state = Get-PortState
    if ($state -eq 'free') { Say 'Bay Office is not running on this port.'; exit 0 }
    if ($state -eq 'foreign') { Say "Port $port belongs to something that is not this instance. Not touching it."; exit 1 }
    $pidFile = Join-Path $data 'server.pid'
    if (-not (Test-Path -LiteralPath $pidFile)) { Say 'Instance identity matched but server.pid is missing; not stopping anything.'; exit 1 }
    $procId = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if (-not $p -or $p.ProcessName -notmatch '^node') { Say 'The recorded process is not a node process; not stopping anything.'; exit 1 }
    # Identity verified above: terminate this owned node process AND its own child tree (an in-flight Claude CLI). Other instances are separate trees.
    & taskkill.exe /PID $procId /T /F | Out-Null
    Start-Sleep -Milliseconds 500
    foreach ($f in 'server.pid', 'runtime.lock', 'launch-url.txt', 'server.port') { Remove-Item -LiteralPath (Join-Path $data $f) -Force -ErrorAction SilentlyContinue }
    Say 'Bay Office stopped. Your data folder is untouched.'
    exit 0
  }
  default { Say 'Usage: launcher.ps1 start|stop|check'; exit 1 }
}
