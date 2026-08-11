[CmdletBinding()]
param(
  [ValidateSet("dev", "candidate", "stable", "latest")]
  [string]$Channel = $(if ($env:COCALC_CLI_CHANNEL) { $env:COCALC_CLI_CHANNEL } else { "stable" }),
  [string]$BaseUrl = $(if ($env:COCALC_CLI_BASE_URL) { $env:COCALC_CLI_BASE_URL } else { "https://software.cocalc.ai" }),
  [string]$InstallRoot = $(Join-Path $env:LOCALAPPDATA "CoCalc\CLI"),
  [string]$BinDir = $(Join-Path $env:LOCALAPPDATA "CoCalc\bin"),
  [switch]$AddToPath,
  [switch]$NoPath,
  [switch]$RequireSignature,
  [switch]$Rollback,
  [switch]$Uninstall,
  [switch]$RemoveFromPath,
  [string]$ManifestPath,
  [string]$ArtifactPath
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$StatePath = Join-Path $InstallRoot "install-state.json"
$Launcher = Join-Path $BinDir "cocalc.cmd"

function Get-UserPathEntries {
  $value = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not $value) { return @() }
  return @($value.Split(";", [StringSplitOptions]::RemoveEmptyEntries))
}

function Set-UserPathEntry([string]$Path, [bool]$Present) {
  $entries = @(Get-UserPathEntries)
  $filtered = @($entries | Where-Object {
    -not [String]::Equals($_.TrimEnd("\"), $Path.TrimEnd("\"), [StringComparison]::OrdinalIgnoreCase)
  })
  if ($Present) { $filtered += $Path }
  [Environment]::SetEnvironmentVariable("Path", ($filtered -join ";"), "User")
}

function Stop-InstalledDaemon {
  if (-not (Test-Path -LiteralPath $Launcher -PathType Leaf)) { return }
  try {
    & $Launcher daemon stop --json *> $null
  } catch {
    Write-Verbose "Existing CoCalc CLI daemon did not stop cleanly: $_"
  }
  Start-Sleep -Milliseconds 250
}

function Write-Launcher([string]$Version) {
  $versionBinary = Join-Path $InstallRoot ("versions\{0}\cocalc.exe" -f $Version)
  $content = @(
    "@echo off",
    "set COCALC_CLI_ARTIFACT_ID=$Version",
    "set COCALC_CLI_VERSION=$Version",
    ('"{0}" %*' -f $versionBinary)
  ) -join "`r`n"
  $staging = "$Launcher.new"
  Set-Content -LiteralPath $staging -Value $content -Encoding ASCII
  Remove-Item -LiteralPath $Launcher -Force -ErrorAction SilentlyContinue
  Move-Item -LiteralPath $staging -Destination $Launcher -Force
}

function Read-InstallState {
  if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) { return $null }
  return Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
}

if ($Uninstall) {
  Stop-InstalledDaemon
  Remove-Item -LiteralPath $InstallRoot -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $Launcher -Force -ErrorAction SilentlyContinue
  if ($RemoveFromPath) { Set-UserPathEntry $BinDir $false }
  Write-Output "CoCalc CLI uninstalled."
  exit 0
}

if ($Rollback) {
  $state = Read-InstallState
  if (-not $state -or -not $state.previous) {
    throw "No previous CoCalc CLI version is available for rollback."
  }
  $previousBinary = Join-Path $InstallRoot ("versions\{0}\cocalc.exe" -f $state.previous)
  if (-not (Test-Path -LiteralPath $previousBinary -PathType Leaf)) {
    throw "Previous CoCalc CLI binary is missing: $previousBinary"
  }
  Stop-InstalledDaemon
  New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
  Write-Launcher $state.previous
  $nextState = [ordered]@{
    current = $state.previous
    previous = $state.current
    installed_at = (Get-Date).ToUniversalTime().ToString("o")
  }
  $nextState | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
  Write-Output "Rolled back CoCalc CLI to $($state.previous)."
  exit 0
}

if ($ManifestPath) {
  $manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
} else {
  $manifestUrl = "{0}/software/cocalc/{1}-windows-amd64.json" -f $BaseUrl.TrimEnd("/"), $Channel
  Write-Output "Downloading CoCalc CLI manifest from $manifestUrl"
  $manifest = Invoke-RestMethod -Uri $manifestUrl -UseBasicParsing
}

if ($manifest.schema -ne "cocalc-software-release-channel-v1") {
  throw "Invalid CoCalc CLI release manifest schema."
}
if ($manifest.component -ne "cli" -or $manifest.os -ne "windows" -or $manifest.arch -ne "amd64") {
  throw "Manifest platform mismatch: expected cli windows/amd64."
}
if (-not $manifest.artifact_id -or -not $manifest.sha256) {
  throw "Manifest is missing artifact_id or sha256."
}
if ([string]$manifest.artifact_id -notmatch '^[A-Za-z0-9._-]+$' -or [string]$manifest.artifact_id -eq "latest") {
  throw "Manifest contains an invalid artifact_id."
}

$tempDir = Join-Path ([IO.Path]::GetTempPath()) ("cocalc-cli-install-{0}" -f [Guid]::NewGuid())
$tempBinary = Join-Path $tempDir "cocalc.exe"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
try {
  if ($ArtifactPath) {
    Copy-Item -LiteralPath $ArtifactPath -Destination $tempBinary
  } else {
    Write-Output "Downloading CoCalc CLI $($manifest.artifact_id)"
    Invoke-WebRequest -Uri $manifest.url -OutFile $tempBinary -UseBasicParsing
  }

  $actualHash = (Get-FileHash -LiteralPath $tempBinary -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne ([string]$manifest.sha256).ToLowerInvariant()) {
    throw "SHA-256 mismatch for downloaded CoCalc CLI: expected $($manifest.sha256), got $actualHash"
  }

  $signature = Get-AuthenticodeSignature -LiteralPath $tempBinary
  $signatureRequired = $RequireSignature -or $Channel -in @("stable", "latest")
  if ($signatureRequired -and $signature.Status -ne "Valid") {
    throw "A valid Authenticode signature is required: $($signature.Status) $($signature.StatusMessage)"
  }
  if (-not $signatureRequired -and $signature.Status -notin @("Valid", "NotSigned")) {
    throw "Invalid Authenticode signature: $($signature.Status) $($signature.StatusMessage)"
  }

  $versionOutput = (& $tempBinary --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Downloaded CoCalc CLI failed its version smoke test: $versionOutput"
  }

  $state = Read-InstallState
  $versionDir = Join-Path $InstallRoot ("versions\{0}" -f $manifest.artifact_id)
  New-Item -ItemType Directory -Path $versionDir -Force | Out-Null
  New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
  Copy-Item -LiteralPath $tempBinary -Destination (Join-Path $versionDir "cocalc.exe") -Force
  Stop-InstalledDaemon
  Write-Launcher $manifest.artifact_id

  $previous = if ($state -and $state.current -ne $manifest.artifact_id) { $state.current } else { $state.previous }
  $nextState = [ordered]@{
    current = $manifest.artifact_id
    previous = $previous
    installed_at = (Get-Date).ToUniversalTime().ToString("o")
    channel = $Channel
    sha256 = $actualHash
  }
  $nextState | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8

  $shouldAddPath = $AddToPath -or $env:COCALC_CLI_ADD_TO_PATH -eq "1"
  if ($shouldAddPath -and -not $NoPath) {
    Set-UserPathEntry $BinDir $true
    Write-Output "Added $BinDir to your user PATH. Open a new terminal to use it."
  } elseif (-not $NoPath) {
    Write-Output "PATH was not changed. Re-run with -AddToPath to add $BinDir explicitly."
  }
  Write-Output "CoCalc CLI $($manifest.artifact_id) installed at $Launcher"
} finally {
  Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
