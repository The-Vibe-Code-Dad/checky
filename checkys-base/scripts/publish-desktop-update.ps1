param(
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$ReleaseNotes = '',
  [string]$SigningKeyPath = $env:CHECKY_UPDATE_SIGNING_KEY
)
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'publish-desktop-update.cjs') $InstallerPath $Version $ReleaseNotes $SigningKeyPath
if ($LASTEXITCODE -ne 0) { throw 'Signed update publishing failed.' }
