param(
  [Parameter(Mandatory = $true)][string]$Artifact,
  [Parameter(Mandatory = $true)][string]$ReleaseId,
  [string]$Installer
)

$ErrorActionPreference = "Stop"
if (-not $Installer) { $Installer = Join-Path $PSScriptRoot "..\install.ps1" }
$root = Join-Path ([IO.Path]::GetTempPath()) ("cocalc-cli-installer-smoke-{0}" -f [Guid]::NewGuid())
$installRoot = Join-Path $root "install root"
$binDir = Join-Path $root "bin dir"
$manifestPath = Join-Path $root "manifest.json"
New-Item -ItemType Directory -Path $root -Force | Out-Null

function Write-TestManifest([string]$Path, [string]$ArtifactId, [string]$Sha256) {
  [ordered]@{
    schema = "cocalc-software-release-channel-v1"
    product = "cocalc"
    component = "cli"
    channel = "dev"
    artifact_id = $ArtifactId
    os = "windows"
    arch = "amd64"
    sha256 = $Sha256
    url = "https://invalid.example/cocalc.exe"
  } | ConvertTo-Json | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Assert-InstallerFails([string]$Description, [scriptblock]$Action) {
  try {
    & $Action
  } catch {
    Write-Verbose "$Description rejected as expected: $_"
    return
  }
  throw "$Description was unexpectedly accepted"
}

try {
  $hash = (Get-FileHash -LiteralPath $Artifact -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-TestManifest $manifestPath $ReleaseId $hash

  & $Installer -Channel dev -InstallRoot $installRoot -BinDir $binDir -NoPath -ManifestPath $manifestPath -ArtifactPath $Artifact
  if ($LASTEXITCODE -ne 0) { throw "PowerShell installer exited with $LASTEXITCODE" }
  $installed = Join-Path $binDir "cocalc.cmd"
  $version = (& $installed --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $version -notlike "*$ReleaseId*") {
    throw "Installed CoCalc CLI version check failed: $version"
  }

  Write-TestManifest $manifestPath "invalid&release" $hash
  Assert-InstallerFails "unsafe release id" {
    & $Installer -Channel dev -InstallRoot $installRoot -BinDir $binDir -NoPath -ManifestPath $manifestPath -ArtifactPath $Artifact
  }

  Write-TestManifest $manifestPath $ReleaseId ("0" * 64)
  Assert-InstallerFails "checksum mismatch" {
    & $Installer -Channel dev -InstallRoot $installRoot -BinDir $binDir -NoPath -ManifestPath $manifestPath -ArtifactPath $Artifact
  }

  $nextReleaseId = "$ReleaseId-next"
  Write-TestManifest $manifestPath $nextReleaseId $hash
  & $Installer -Channel dev -InstallRoot $installRoot -BinDir $binDir -NoPath -ManifestPath $manifestPath -ArtifactPath $Artifact
  $nextVersion = (& $installed --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $nextVersion -notlike "*$nextReleaseId*") {
    throw "CoCalc CLI upgrade check failed: $nextVersion"
  }
  & $Installer -InstallRoot $installRoot -BinDir $binDir -NoPath -Rollback
  $rolledBackVersion = (& $installed --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $rolledBackVersion -notlike "*$ReleaseId*") {
    throw "CoCalc CLI rollback check failed: $rolledBackVersion"
  }

  $signature = Get-AuthenticodeSignature -LiteralPath $Artifact
  Write-TestManifest $manifestPath $ReleaseId $hash
  if ($signature.Status -eq "Valid") {
    & $Installer -Channel dev -RequireSignature -InstallRoot $installRoot -BinDir $binDir -NoPath -ManifestPath $manifestPath -ArtifactPath $Artifact
  } else {
    Assert-InstallerFails "unsigned release with RequireSignature" {
      & $Installer -Channel dev -RequireSignature -InstallRoot $installRoot -BinDir $binDir -NoPath -ManifestPath $manifestPath -ArtifactPath $Artifact
    }
  }

  & $Installer -InstallRoot $installRoot -BinDir $binDir -NoPath -Uninstall
  if (Test-Path -LiteralPath $installed) {
    throw "PowerShell installer uninstall left the stable binary behind"
  }
  Write-Output "Windows installer smoke test passed for $ReleaseId"
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
