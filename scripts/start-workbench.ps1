param([int]$Port = 18910, [string]$Binary = 'target\debug\corpus-workbench.exe')
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$Owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
foreach ($Path in @('.private', '.runtime')) {
    if (!(Test-Path $Path)) { New-Item -ItemType Directory $Path | Out-Null }
    & icacls $Path /inheritance:r /grant:r "${Owner}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not protect local demo storage.' }
}
if (!(Test-Path '.private\demo-package')) {
    & python scripts\prepare-synthetic.py --out .private\demo-package
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic fixture preparation failed.' }
}
if (!(Test-Path '.private\demo-authority')) {
    & $Binary import --store .private\demo-authority --project synthetic --package .private\demo-package
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic import failed.' }
}
& $Binary serve --store .private\demo-authority --project synthetic --ui ui\dist --port $Port
exit $LASTEXITCODE
