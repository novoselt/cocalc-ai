[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$BundlePath,
  [Parameter(Mandatory = $true)][string]$ReleaseId,
  [string]$OutputDir = (Join-Path $PSScriptRoot "..\build\windows")
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if ($ReleaseId -notmatch '^[A-Za-z0-9._-]+$') {
  throw "Invalid CoCalc Plus release id: $ReleaseId"
}
$bundle = (Resolve-Path -LiteralPath $BundlePath).Path
if (-not (Test-Path -LiteralPath (Join-Path $bundle "bundle\index.js") -PathType Leaf)) {
  throw "CoCalc Plus bundle entrypoint is missing from $bundle"
}
if (-not (Test-Path -LiteralPath (Join-Path $bundle "static") -PathType Container)) {
  throw "CoCalc Plus static assets are missing from $bundle"
}

$node = (Get-Command node.exe -ErrorAction Stop).Source
$nodeMajor = [int]((& $node -p "process.versions.node.split('.')[0]").Trim())
if ($nodeMajor -ne 26) {
  throw "CoCalc Plus Windows packages require Node.js 26; got $(& $node --version) at $node"
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$packageName = "cocalc-plus-$ReleaseId-x86_64-windows"
$packageDir = Join-Path $OutputDir $packageName
$archive = "$packageDir.zip"
Remove-Item -LiteralPath $packageDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path (Join-Path $packageDir "runtime") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $packageDir "app") -Force | Out-Null
Copy-Item -LiteralPath $node -Destination (Join-Path $packageDir "runtime\node.exe")
Copy-Item -Path (Join-Path $bundle "*") -Destination (Join-Path $packageDir "app") -Recurse -Force

$cmd = @(
  "@echo off",
  "setlocal",
  "set COCALC_PLUS_VERSION=$ReleaseId",
  "set COCALC_PLUS_ARTIFACT_ID=$ReleaseId",
  '"%~dp0runtime\node.exe" "%~dp0app\bundle\index.js" %*'
) -join "`r`n"
Set-Content -LiteralPath (Join-Path $packageDir "cocalc-plus.cmd") -Value $cmd -Encoding ASCII

$metadata = [ordered]@{
  schema = "cocalc-plus-portable-v1"
  release_id = $ReleaseId
  os = "windows"
  arch = "amd64"
  node = (& $node --version).Trim()
  created_at = (Get-Date).ToUniversalTime().ToString("o")
}
$metadata | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $packageDir "artifact.json") -Encoding UTF8

$version = (& (Join-Path $packageDir "cocalc-plus.cmd") version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $version -ne $ReleaseId) {
  throw "Packaged CoCalc Plus version smoke test failed: $version"
}

Compress-Archive -LiteralPath $packageDir -DestinationPath $archive -CompressionLevel Optimal
$sha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$archive.sha256" -Value "$sha256  $([IO.Path]::GetFileName($archive))" -Encoding ASCII
Write-Output ([ordered]@{ archive = $archive; sha256 = $sha256; release_id = $ReleaseId } | ConvertTo-Json -Compress)
