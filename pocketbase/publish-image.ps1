param(
  [Parameter(Mandatory = $true)]
  [string]$ImageName,

  [string]$Version = "0.41.1"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$normalizedImageName = $ImageName.ToLowerInvariant()

docker buildx build `
  --platform linux/amd64 `
  --build-arg "PB_VERSION=$Version" `
  -t "${normalizedImageName}:$Version" `
  -t "${normalizedImageName}:latest" `
  --push `
  $scriptDir
