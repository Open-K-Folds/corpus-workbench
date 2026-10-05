param(
    [string]$Launcher = (Join-Path (Split-Path $PSScriptRoot -Parent) '.runtime\Open-Workbench.html'),
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Run this inside the Windows desktop hosting the preview, reached through your existing private remote connection.' }
$File = Resolve-Path -LiteralPath $Launcher
$Html = Get-Content -LiteralPath $File.ProviderPath -Raw
$Link = [regex]::Match($Html, 'href="(http://127\.0\.0\.1:[0-9]+/#session=[a-f0-9]+)"')
if (!$Link.Success) { throw 'Expected a protected loopback workbench launcher.' }
$Address = [Uri]$Link.Groups[1].Value
$Ready = Invoke-WebRequest -UseBasicParsing -Uri ($Address.GetLeftPart([UriPartial]::Authority) + '/health/ready') -TimeoutSec 5
if ($Ready.StatusCode -ne 200) { throw 'The local preview is not ready; this launcher does not restart services.' }
if ($CheckOnly) { Write-Output 'Protected local preview is ready. Session code was not displayed.'; exit 0 }
Start-Process -FilePath $File.ProviderPath
