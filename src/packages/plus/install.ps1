[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, ParameterSetName = "Install")][string]$ArchivePath,
  [Parameter(ParameterSetName = "Install")][string]$Sha256,
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "CoCalc\Plus"),
  [string]$BinDir = (Join-Path $env:LOCALAPPDATA "CoCalc\bin"),
  [switch]$AddToPath,
  [switch]$NoPath,
  [Parameter(Mandatory = $true, ParameterSetName = "Rollback")][switch]$Rollback,
  [Parameter(Mandatory = $true, ParameterSetName = "Uninstall")][switch]$Uninstall,
  [switch]$RemoveFromPath
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$statePath = Join-Path $InstallRoot "install-state.json"
$launcher = Join-Path $BinDir "cocalc-plus.cmd"

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

function Read-InstallState {
  if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { return $null }
  return Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
}

function Write-Launcher([string]$Version) {
  $target = Join-Path $InstallRoot "versions\$Version\cocalc-plus.cmd"
  $content = @("@echo off", ('"{0}" %*' -f $target)) -join "`r`n"
  New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
  Set-Content -LiteralPath "$launcher.new" -Value $content -Encoding ASCII
  Move-Item -LiteralPath "$launcher.new" -Destination $launcher -Force
}

if ($Uninstall) {
  Remove-Item -LiteralPath $InstallRoot -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $launcher -Force -ErrorAction SilentlyContinue
  if ($RemoveFromPath) { Set-UserPathEntry $BinDir $false }
  Write-Output "CoCalc Plus uninstalled. Workspace files were not removed."
  exit 0
}

if ($Rollback) {
  $state = Read-InstallState
  if (-not $state -or -not $state.previous) {
    throw "No previous CoCalc Plus version is available for rollback."
  }
  $previousLauncher = Join-Path $InstallRoot "versions\$($state.previous)\cocalc-plus.cmd"
  if (-not (Test-Path -LiteralPath $previousLauncher -PathType Leaf)) {
    throw "Previous CoCalc Plus version is missing: $previousLauncher"
  }
  Write-Launcher $state.previous
  [ordered]@{
    current = $state.previous
    previous = $state.current
    installed_at = (Get-Date).ToUniversalTime().ToString("o")
  } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
  Write-Output "Rolled back CoCalc Plus to $($state.previous)."
  exit 0
}

$archive = (Resolve-Path -LiteralPath $ArchivePath).Path
if ($Sha256) {
  $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $Sha256.ToLowerInvariant()) {
    throw "SHA-256 mismatch for CoCalc Plus: expected $Sha256, got $actual"
  }
}

$temp = Join-Path ([IO.Path]::GetTempPath()) ("cocalc-plus-install-{0}" -f [Guid]::NewGuid())
New-Item -ItemType Directory -Path $temp -Force | Out-Null
try {
  Expand-Archive -LiteralPath $archive -DestinationPath $temp
  $roots = @(Get-ChildItem -LiteralPath $temp -Directory)
  if ($roots.Count -ne 1) { throw "CoCalc Plus archive must contain exactly one root directory." }
  $source = $roots[0].FullName
  $metadataPath = Join-Path $source "artifact.json"
  if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) {
    throw "CoCalc Plus artifact metadata is missing."
  }
  $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
  if ($metadata.schema -ne "cocalc-plus-portable-v1" -or $metadata.os -ne "windows" -or $metadata.arch -ne "amd64") {
    throw "CoCalc Plus artifact metadata is invalid or targets another platform."
  }
  $version = [string]$metadata.release_id
  if ($version -notmatch '^[A-Za-z0-9._-]+$') { throw "Invalid CoCalc Plus release id: $version" }
  $versionDir = Join-Path $InstallRoot "versions\$version"
  New-Item -ItemType Directory -Path (Split-Path $versionDir -Parent) -Force | Out-Null
  Remove-Item -LiteralPath $versionDir -Recurse -Force -ErrorAction SilentlyContinue
  Copy-Item -LiteralPath $source -Destination $versionDir -Recurse

  $versionOutput = (& (Join-Path $versionDir "cocalc-plus.cmd") version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $versionOutput -ne $version) {
    throw "Installed CoCalc Plus version smoke test failed: $versionOutput"
  }
  $state = Read-InstallState
  Write-Launcher $version
  $previous = if ($state -and $state.current -ne $version) { $state.current } else { $state.previous }
  [ordered]@{
    current = $version
    previous = $previous
    installed_at = (Get-Date).ToUniversalTime().ToString("o")
    sha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8

  if ($AddToPath -and -not $NoPath) {
    Set-UserPathEntry $BinDir $true
    Write-Output "Added $BinDir to your user PATH. Open a new terminal to use it."
  } elseif (-not $NoPath) {
    Write-Output "PATH was not changed. Re-run with -AddToPath to add it explicitly."
  }
  Write-Output "CoCalc Plus $version installed at $launcher"
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
