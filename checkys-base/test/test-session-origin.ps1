param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$baseRoot = Split-Path $PSScriptRoot -Parent
$imageName = 'checky-security-regression:local'
$previousUrl = $env:CHECKY_TEST_URL
$previousOrigin = $env:CHECKY_TEST_PUBLIC_ORIGIN
$previousInvalid = $env:CHECKY_TEST_INVALID_ORIGIN
if (-not $SkipBuild) {
  & docker build -t $imageName (Join-Path $baseRoot 'pocketbase')
  if ($LASTEXITCODE -ne 0) { throw 'PocketBase image build failed.' }
}
try {
  foreach ($origin in @('', 'https://checky.example.com', 'https://CHECKY.EXAMPLE.COM:443/', 'http://checky.example.com:17760', 'https://checky.example.com/invalid')) {
    $containerName = 'checky-origin-' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
    try {
      & docker run --detach --name $containerName --publish '127.0.0.1::8080' --tmpfs '/pb/pb_data:rw,size=268435456' --memory 512m --cpus 2 --env "CHECKY_PUBLIC_ORIGIN=$origin" $imageName
      if ($LASTEXITCODE -ne 0) { throw 'Could not start isolated backend.' }
      $binding = & docker port $containerName '8080/tcp'
      $env:CHECKY_TEST_URL = 'http://' + $binding.Trim()
      $env:CHECKY_TEST_PUBLIC_ORIGIN = $origin
      $env:CHECKY_TEST_INVALID_ORIGIN = if ($origin.EndsWith('/invalid')) { 'true' } else { 'false' }
      $ready = $false
      for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try { $null = Invoke-RestMethod ($env:CHECKY_TEST_URL + '/api/health'); $ready = $true; break } catch { Start-Sleep -Seconds 1 }
      }
      if (-not $ready) { & docker logs $containerName; throw 'Disposable backend did not become healthy.' }
      & node (Join-Path $PSScriptRoot 'session-origin.cjs')
      if ($LASTEXITCODE -ne 0) { & docker logs --tail 25 $containerName; throw 'Session origin regressions failed.' }
    } finally {
      & docker rm --force $containerName 2>$null | Out-Null
    }
  }
} finally {
  $env:CHECKY_TEST_URL = $previousUrl
  $env:CHECKY_TEST_PUBLIC_ORIGIN = $previousOrigin
  $env:CHECKY_TEST_INVALID_ORIGIN = $previousInvalid
}
