$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:RUNNER_TEMP 'checky-upgrade'
New-Item -ItemType Directory -Path $dir | Out-Null
$legacy = Join-Path $dir 'legacy.exe'
Invoke-WebRequest 'https://github.com/The-Vibe-Code-Dad/checky/releases/download/desktop-v1.0.8/checkys-list-1.0.8-x64.exe' -OutFile $legacy
if ((Get-FileHash $legacy).Hash -ne 'f4af7320f5c33a59b1fe7fd77a4a274790f7a4c75988c305d62f5922936e4824') { throw 'Legacy installer hash mismatch' }
$oldDir = Join-Path $dir 'old'
$setup = Start-Process $legacy -ArgumentList "/currentuser /S /D=$oldDir" -PassThru -Wait
if ($setup.ExitCode -ne 0) { throw 'Could not install Electron 1.0.8' }
$oldApp = Join-Path $oldDir "Checky's List.exe"
node checkys-base/scripts/download-desktop-release.cjs "$dir/feed"
if ($LASTEXITCODE -ne 0) { throw 'Invalid new release' }
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=localhost' -addext 'subjectAltName=IP:127.0.0.1' -keyout "$dir/key.pem" -out "$dir/cert.pem"
if ($LASTEXITCODE -ne 0) { throw 'Could not create the test certificate' }
node checkys-base/test/legacy-windows-upgrade.cjs $oldApp $dir
if ($LASTEXITCODE -ne 0) { throw 'Legacy app upgrade failed' }
$manifest = Get-Content -Raw "$dir/feed/latest.json" | ConvertFrom-Json
$installer = Join-Path $dir "old-profile/data/updates/$($manifest.fileName)"
$opened = Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($installer)) -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $installer }
if (!$opened) { throw 'Windows did not open the verified setup wizard' }
# Finish that exact installer unattended to exercise the installed binaries on the runner.
$opened | Stop-Process -Force
$opened | Wait-Process -Timeout 15 -ErrorAction SilentlyContinue
$newDir = Join-Path $dir 'new'
$setup = Start-Process $installer -ArgumentList "/S /D=$newDir" -PassThru -Wait
if ($setup.ExitCode -ne 0 -or !(Test-Path "$newDir/checky-desktop.exe")) { throw 'Rust desktop installation failed' }
Write-Host 'PASS Windows opened the installer and installed the Rust desktop from the old app download'
