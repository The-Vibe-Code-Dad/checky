param(
  [switch]$SkipBackup,
  [switch]$NoPull,
  [string]$DataVolumeName = "",
  [ValidateRange(30, 900)]
  [int]$HealthTimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$baseDir = Split-Path -Parent $PSScriptRoot
$dataVolumeName = "checkys-base_pocketbase_data"

function Invoke-Docker {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,
    [string]$FailureMessage = "Docker command failed."
  )

  & docker @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw $FailureMessage
  }
}

function Test-VolumeHasDatabase {
  param([Parameter(Mandatory = $true)][string]$VolumeName)

  & docker run --rm --mount "type=volume,src=$VolumeName,dst=/source,readonly" alpine:3.24.3 test -s /source/data.db *> $null
  $probeExitCode = $LASTEXITCODE
  if ($probeExitCode -eq 0) {
    return $true
  }
  if ($probeExitCode -eq 1) {
    return $false
  }
  throw "Could not inspect PocketBase volume '$VolumeName' (Docker exit code $probeExitCode). The update was cancelled instead of risking an empty database."
}

function Get-ServiceHealth {
  param([Parameter(Mandatory = $true)][string]$Service)

  $containerId = (@(& docker compose ps -q $Service) -join "").Trim()
  if ($LASTEXITCODE -ne 0 -or -not $containerId) {
    return "missing"
  }

  $health = (@(& docker inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}" $containerId) -join "").Trim()
  if ($LASTEXITCODE -ne 0 -or -not $health) {
    return "unknown"
  }
  return $health
}

$previousDataVolumeEnvironment = $env:POCKETBASE_DATA_VOLUME
Push-Location $baseDir

try {
  Invoke-Docker -Arguments @("info", "--format", "{{.ServerVersion}}") -FailureMessage "Docker is not running."

  $requestedVolumeName = $DataVolumeName.Trim()
  if ($requestedVolumeName) {
    & docker volume inspect $requestedVolumeName *> $null
    if ($LASTEXITCODE -ne 0) {
      throw "The requested PocketBase data volume '$requestedVolumeName' does not exist."
    }
    if (-not (Test-VolumeHasDatabase -VolumeName $requestedVolumeName)) {
      throw "The requested PocketBase data volume '$requestedVolumeName' does not contain a non-empty data.db file."
    }
    $dataVolumeName = $requestedVolumeName
  }
  else {
    $candidateVolumes = @(& docker volume ls --filter "label=com.docker.compose.volume=pocketbase_data" --format "{{.Name}}") | Where-Object { $_ } | Select-Object -Unique
    $dataBearingVolumes = @($candidateVolumes | Where-Object { Test-VolumeHasDatabase -VolumeName $_ })
    if ($dataBearingVolumes.Count -eq 1) {
      $dataVolumeName = $dataBearingVolumes[0]
    }
    elseif ($dataBearingVolumes.Count -gt 1) {
      throw "Multiple PocketBase data volumes were found: $($dataBearingVolumes -join ', '). Re-run with -DataVolumeName and the correct volume."
    }
  }

  $env:POCKETBASE_DATA_VOLUME = $dataVolumeName
  Write-Output "Using PocketBase data volume: $dataVolumeName"
  Invoke-Docker -Arguments @("compose", "config", "--quiet") -FailureMessage "The Checky Base Compose configuration is invalid."

  & docker volume inspect $dataVolumeName *> $null
  $dataVolumeExists = $LASTEXITCODE -eq 0

  if ($dataVolumeExists -and -not $SkipBackup) {
    $backupName = "pre-update-{0}.tar.gz" -f (Get-Date -Format "yyyyMMdd-HHmmss")
    & (Join-Path $PSScriptRoot "backup-pocketbase.ps1") -Name $backupName
    if ($LASTEXITCODE -ne 0) {
      throw "The pre-update database backup failed. The update was cancelled."
    }
  }
  elseif ($dataVolumeExists -and $SkipBackup) {
    Write-Warning "Proceeding without a pre-update database backup."
  }
  else {
    Write-Output "No existing Checky Base data volume was found; this will be treated as a first installation."
  }

  $buildArguments = @("compose", "build")
  if (-not $NoPull) {
    $buildArguments += "--pull"
  }
  Invoke-Docker -Arguments $buildArguments -FailureMessage "The new Checky Base images could not be built. Existing containers and data were left in place."

  Invoke-Docker `
    -Arguments @("compose", "up", "-d", "--no-build", "--remove-orphans") `
    -FailureMessage "The updated Checky Base containers could not be started. The database volume was not deleted."

  $deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
  do {
    $pocketbaseHealth = Get-ServiceHealth -Service "pocketbase"
    $webHealth = Get-ServiceHealth -Service "web"
    Write-Output "PocketBase: $pocketbaseHealth; Web: $webHealth"

    if ($pocketbaseHealth -eq "healthy" -and $webHealth -eq "healthy") {
      Write-Output "Checky Base update completed successfully."
      return
    }

    if ($pocketbaseHealth -in @("unhealthy", "exited", "dead") -or $webHealth -in @("unhealthy", "exited", "dead")) {
      break
    }

    Start-Sleep -Seconds 3
  } while ((Get-Date) -lt $deadline)

  & docker compose logs --no-color --tail 50 pocketbase web
  throw "The updated Checky Base stack did not become healthy. The named database volume and pre-update backup were preserved."
}
finally {
  if ($null -eq $previousDataVolumeEnvironment) {
    Remove-Item Env:POCKETBASE_DATA_VOLUME -ErrorAction SilentlyContinue
  }
  else {
    $env:POCKETBASE_DATA_VOLUME = $previousDataVolumeEnvironment
  }
  Pop-Location
}



