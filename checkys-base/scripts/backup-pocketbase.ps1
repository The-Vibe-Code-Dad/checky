param(
  [string]$Name = ""
)

$ErrorActionPreference = "Stop"
$baseDir = Split-Path -Parent $PSScriptRoot
$backupDir = Join-Path $baseDir "backups"

if (-not $Name) {
  $Name = "checkys-base-pb-data-{0}.tar.gz" -f (Get-Date -Format "yyyyMMdd-HHmmss")
}

if ($Name -notmatch '^[a-zA-Z0-9._-]+\.tar\.gz$') {
  throw "Backup name must contain only letters, numbers, dots, underscores, and dashes, and end in .tar.gz."
}

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
Push-Location $baseDir

$pocketbaseContainerId = (@(& docker compose ps -q pocketbase) -join "").Trim()
if ($LASTEXITCODE -ne 0) {
  Pop-Location
  throw "Could not inspect the PocketBase container."
}

$wasRunning = $false
if ($pocketbaseContainerId) {
  $runningState = (@(& docker inspect --format "{{.State.Running}}" $pocketbaseContainerId) -join "").Trim()
  $wasRunning = ($runningState -eq "true")
  if ($LASTEXITCODE -ne 0) {
    Pop-Location
    throw "Could not inspect the PocketBase container state."
  }
}

try {
  if ($wasRunning) {
    & docker compose stop pocketbase
    if ($LASTEXITCODE -ne 0) {
      throw "Could not stop PocketBase safely."
    }
  }

  $env:BACKUP_NAME = $Name
  & docker compose --profile tools run --rm backup
  if ($LASTEXITCODE -ne 0) {
    throw "The PocketBase data-volume backup failed."
  }
}
finally {
  Remove-Item Env:BACKUP_NAME -ErrorAction SilentlyContinue
  if ($wasRunning) {
    & docker compose start pocketbase
  }
  Pop-Location
}

$backupPath = Join-Path $backupDir $Name
if (-not (Test-Path -LiteralPath $backupPath)) {
  throw "The backup container finished without creating $backupPath."
}

Write-Output "Backup created: $backupPath"
