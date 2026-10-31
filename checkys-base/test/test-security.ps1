param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$baseRoot = Split-Path $PSScriptRoot -Parent
$containerName = 'checky-regression-' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
$imageName = 'checky-security-regression:local'
$previousUrl = $env:CHECKY_TEST_URL
$previousMail = $env:CHECKY_TEST_MAIL
try {
  if (-not $SkipBuild) {
    & docker build -t $imageName (Join-Path $baseRoot 'pocketbase')
    if ($LASTEXITCODE -ne 0) { throw 'PocketBase image build failed.' }
  }
  $mailFixture = Join-Path $PSScriptRoot 'fixtures/mail.pb.js'
  & docker run --detach --name $containerName --publish '127.0.0.1::8080' --tmpfs '/pb/pb_data:rw,size=268435456' --memory 512m --cpus 2 --env CHECKY_TRUST_PROXY=true --env CHECKY_TEST_MAIL=true --mount "type=bind,source=$mailFixture,target=/pb/pb_hooks/test-mail.pb.js,readonly" $imageName
  if ($LASTEXITCODE -ne 0) { throw 'Could not start isolated backend.' }
  $binding = & docker port $containerName '8080/tcp'
  $env:CHECKY_TEST_URL = 'http://' + $binding.Trim()
  $env:CHECKY_TEST_MAIL = 'true'
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try { $null = Invoke-RestMethod ($env:CHECKY_TEST_URL + '/api/health'); $ready = $true; break } catch { Start-Sleep -Seconds 1 }
  }
  if (-not $ready) { & docker logs $containerName; throw 'Disposable backend did not become healthy.' }
  & node (Join-Path $PSScriptRoot 'security-integration.cjs')
  if ($LASTEXITCODE -ne 0) { throw 'Backend security regressions failed.' }
  & node (Join-Path $PSScriptRoot 'client-sync.cjs')
  if ($LASTEXITCODE -ne 0) { throw 'Base/desktop client sync regressions failed.' }
} finally {
  & docker rm --force $containerName 2>$null | Out-Null
  $env:CHECKY_TEST_URL = $previousUrl
  $env:CHECKY_TEST_MAIL = $previousMail
}
