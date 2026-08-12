[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Archive,
  [Parameter(Mandatory = $true)][string]$ReleaseId,
  [string]$Installer = (Join-Path $PSScriptRoot "..\install.ps1")
)

$ErrorActionPreference = "Stop"
$root = Join-Path ([IO.Path]::GetTempPath()) ("cocalc-plus-smoke-{0}" -f [Guid]::NewGuid())
$installRoot = Join-Path $root "install root"
$binDir = Join-Path $root "bin dir"
$workspace = Join-Path $root "workspace with spaces"
$data = Join-Path $root "data with spaces"
New-Item -ItemType Directory -Path $root -Force | Out-Null

try {
  $hash = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
  & $Installer -ArchivePath $Archive -Sha256 $hash -InstallRoot $installRoot -BinDir $binDir -NoPath
  $launcher = Join-Path $binDir "cocalc-plus.cmd"
  $version = (& $launcher version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $version -ne $ReleaseId) {
    throw "Installed CoCalc Plus version check failed: $version"
  }

  $oldWorkspace = $env:COCALC_PLUS_WORKSPACE
  $oldData = $env:COCALC_DATA_DIR
  $oldBrowser = $env:COCALC_OPEN_BROWSER
  $oldAcp = $env:COCALC_ACP_MODE
  $oldPort = $env:PORT
  try {
    $env:COCALC_PLUS_WORKSPACE = $workspace
    $env:COCALC_DATA_DIR = $data
    $env:COCALC_OPEN_BROWSER = "0"
    $env:COCALC_ACP_MODE = "mock"
    $output = (& $launcher --internal-windows-smoke 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { throw "CoCalc Plus runtime smoke failed: $output" }
    if ($output -notmatch '"http":true' -or $output -notmatch '"files":true' -or $output -notmatch '"powershell_terminal":true') {
      throw "CoCalc Plus runtime smoke did not report HTTP, file, and terminal success: $output"
    }

    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $env:PORT = [string]$listener.LocalEndpoint.Port
    $listener.Stop()
    $pidfile = Join-Path $root "daemon.pid"
    $log = Join-Path $root "daemon.log"
    try {
      & $launcher --daemon --pidfile $pidfile --log $log | Out-Host
      if ($LASTEXITCODE -ne 0) { throw "CoCalc Plus daemon start failed." }
      $ready = $false
      for ($i = 0; $i -lt 60; $i++) {
        try {
          $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://localhost:$env:PORT/static/app.html"
          if ($response.StatusCode -eq 200 -and $response.Content -match "CoCalc") {
            $ready = $true
            break
          }
        } catch {
          # The daemon may still be starting.
        }
        Start-Sleep -Milliseconds 500
      }
      if (-not $ready) {
        $details = Get-Content -LiteralPath $log -Raw -ErrorAction SilentlyContinue
        throw "CoCalc Plus daemon HTTP smoke failed: $details"
      }
      $status = (& $launcher --daemon-status --pidfile $pidfile 2>&1 | Out-String).Trim()
      if ($LASTEXITCODE -ne 0 -or $status -ne "running") {
        throw "CoCalc Plus daemon status smoke failed: $status"
      }
    } finally {
      if (Test-Path -LiteralPath $pidfile) {
        & $launcher --daemon-stop --pidfile $pidfile | Out-Host
        Start-Sleep -Seconds 1
      }
    }
  } finally {
    $env:COCALC_PLUS_WORKSPACE = $oldWorkspace
    $env:COCALC_DATA_DIR = $oldData
    $env:COCALC_OPEN_BROWSER = $oldBrowser
    $env:COCALC_ACP_MODE = $oldAcp
    $env:PORT = $oldPort
  }

  & $Installer -InstallRoot $installRoot -BinDir $binDir -NoPath -Uninstall
  if (Test-Path -LiteralPath $launcher) { throw "Uninstall left the launcher behind." }
  Write-Output "CoCalc Plus Windows installer/runtime smoke passed for $ReleaseId"
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
