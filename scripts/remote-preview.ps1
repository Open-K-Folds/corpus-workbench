param(
    [Parameter(Position=0)][ValidateSet('Start','Status','Stop','Supervise')][string]$Action = 'Status',
    [string]$EnvFile,
    [switch]$AtLogon
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path $repo '.runtime\remote-preview'
$stateFile = Join-Path $runtime 'watchers.json'
$stopFile = Join-Path $runtime 'stop'
$savedConfig = Join-Path $runtime 'env-file.txt'
$shellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$hash = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($repo.ToLowerInvariant()))
$entryName = 'CorpusWorkbenchPreview-' + [BitConverter]::ToString($hash,0,6).Replace('-','')
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$startup = '"{0}" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File "{1}" Start' -f $shellExe,$PSCommandPath

function Read-State {
    if (Test-Path -LiteralPath $stateFile) { [IO.File]::ReadAllText($stateFile) | ConvertFrom-Json }
}
function Identity($process,$executable) {
    @{id=$process.Id; started=$process.StartTime.ToUniversalTime().Ticks.ToString(); path=$executable}
}
function Find-Process($entry) {
    if (!$entry) { return }
    $p = Get-Process -Id $entry.id -ErrorAction SilentlyContinue
    if ($p -and $p.Path -eq $entry.path -and $p.StartTime.ToUniversalTime().Ticks.ToString() -eq $entry.started) { $p }
}
function Stop-Tree($entry) {
    $p = Find-Process $entry
    if ($p) {
        # Hold a process handle throughout PID verification and tree termination.
        $null = $p.Handle
        if (!$p.HasExited) { & "$env:SystemRoot\System32\taskkill.exe" /PID $p.Id /T /F *> $null }
    }
}
function Write-State($state) {
    $temp = Join-Path $runtime 'watchers.next.json'
    [IO.File]::WriteAllText($temp, ($state | ConvertTo-Json -Depth 3))
    if ([IO.File]::Exists($stateFile)) { [IO.File]::Replace($temp,$stateFile,($stateFile + '.last')) }
    else { [IO.File]::Move($temp,$stateFile) }
}
function Start-Hidden($label, $exe, $commandArgs, $workingDirectory) {
    # Start-Process joins arguments on Windows. Quote each path for the native executable.
    $commandLine = ($commandArgs | ForEach-Object { '"{0}"' -f $_ }) -join ' '
    Start-Process -FilePath $exe -ArgumentList $commandLine -WorkingDirectory $workingDirectory -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $runtime "$label.log") -RedirectStandardError (Join-Path $runtime "$label.error.log")
}
function Startup-Command {
    if (Test-Path -LiteralPath $runKey) { (Get-Item -LiteralPath $runKey).GetValue($entryName) }
}
function Show-Status {
    $s = Read-State
    [pscustomobject]@{
        Supervisor = [bool](Find-Process $s.supervisor)
        Frontend = [bool](Find-Process $s.frontend)
        Backend = [bool](Find-Process $s.backend)
        AtLogon = ((Startup-Command) -eq $startup)
        EnvFile = $s.config
        Logs = $runtime
    }
}
if ($Action -eq 'Status') { Show-Status; return }

[IO.Directory]::CreateDirectory($runtime) | Out-Null
if ($Action -eq 'Supervise') {
    $lock = [IO.File]::Open((Join-Path $runtime 'supervisor.lock'),'OpenOrCreate','ReadWrite','None')
    try {
        $previous = Read-State
        Stop-Tree $previous.frontend
        Stop-Tree $previous.backend
        $node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
        $docker = (Get-Command docker.exe -CommandType Application | Select-Object -First 1).Source
        $ui = Join-Path $repo 'ui'
        $vite = Join-Path $ui 'node_modules\vite\bin\vite.js'
        if (!(Test-Path -LiteralPath $vite -PathType Leaf)) { throw 'Install the ui dependencies with npm ci --prefix ui.' }
        $defaults = Join-Path $runtime 'defaults.env'
        @('WB_PROJECT=asr-word-aligned','WB_STORE=/data/authority/workspace','WB_PUBLIC_ORIGIN=https://workbench.openkfolds.org') |
            Set-Content -LiteralPath $defaults -Encoding Ascii
        $compose = @('compose','--env-file',$defaults)
        $config = [IO.File]::ReadAllText($savedConfig)
        if ($config) {
            if (!(Test-Path -LiteralPath $config -PathType Leaf)) { throw 'The configured preview env file is missing.' }
            $compose += @('--env-file',$config)
        }
        $compose += @('-f',(Join-Path $repo 'compose.yaml'),'-f',(Join-Path $repo 'compose.preview.yaml'))
        # The selected env file owns the project, authority, port and network across logins.
        foreach ($name in @('WB_PROJECT','WB_STORE','WB_PUBLIC_ORIGIN','WB_PORT','WB_EDGE_NETWORK','WB_PREVIEW_IMAGE','COMPOSE_PROJECT_NAME')) {
            [Environment]::SetEnvironmentVariable($name,$null,'Process')
        }
        & $docker @compose config --quiet
        if ($LASTEXITCODE -ne 0) { throw 'Invalid preview Compose configuration.' }
        $env:VITE_WB_REMOTE_PREVIEW = '1'
        $output = Join-Path $runtime 'ui'
        [IO.Directory]::CreateDirectory($output) | Out-Null
        $state = @{supervisor=(Identity (Get-Process -Id $PID) $shellExe); config=$config; frontend=$null; backend=$null}
        $changed = $true
        while (!(Test-Path -LiteralPath $stopFile)) {
            foreach ($label in @('frontend','backend')) {
                if (Find-Process $state[$label]) { continue }
                try {
                    if ($label -eq 'frontend') { $exe = $node; $child = Start-Hidden $label $exe @($vite,'build','--watch','--outDir',$output,'--emptyOutDir') $ui }
                    else { $exe = $docker; $child = Start-Hidden $label $exe ($compose + @('watch','--no-up','--prune=false','authoring','login')) $repo }
                    if (!$child.HasExited) { $state[$label] = Identity $child $exe; $changed = $true }
                } catch { Write-Warning "$label could not start. Retrying in three seconds." }
            }
            if ($changed) { Write-State $state; $changed = $false }
            Start-Sleep -Seconds 3
        }
    } finally {
        if ($state) { Stop-Tree $state.frontend; Stop-Tree $state.backend }
        $lock.Dispose()
    }
    return
}

$control = [IO.File]::Open((Join-Path $runtime 'control.lock'),'OpenOrCreate','ReadWrite','None')
try {
    $state = Read-State
    $supervisor = Find-Process $state.supervisor
    if ($Action -eq 'Stop') {
        if ((Startup-Command) -eq $startup) { Remove-ItemProperty -LiteralPath $runKey -Name $entryName }
        [IO.File]::WriteAllText($stopFile,'')
        if ($supervisor -and !$supervisor.WaitForExit(10000)) { Stop-Tree $state.supervisor }
        $state = Read-State
        Stop-Tree $state.frontend
        Stop-Tree $state.backend
        Show-Status
        return
    }
    if ($EnvFile) { $config = (Resolve-Path -LiteralPath $EnvFile).Path }
    elseif (Test-Path -LiteralPath $savedConfig) { $config = [IO.File]::ReadAllText($savedConfig) }
    else {
        $config = @((Join-Path $repo '.env.preview'),(Join-Path $env:LOCALAPPDATA 'CorpusWorkbench\remote-preview\compose.env')) |
            Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    }
    if ($config -and !(Test-Path -LiteralPath $config -PathType Leaf)) { throw 'The configured preview env file is missing. Use -EnvFile to select its replacement.' }
    if ($supervisor -and $config -ne $state.config) { throw 'Stop the running watchers before changing their env file.' }
    if (!$supervisor) {
        [IO.File]::WriteAllText($savedConfig,[string]$config)
        if (Test-Path -LiteralPath $stopFile) { Remove-Item -LiteralPath $stopFile }
        $supervisor = Start-Hidden 'supervisor' $shellExe @('-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-File',$PSCommandPath,'Supervise') $repo
        $deadline = (Get-Date).AddSeconds(15)
        do {
            Start-Sleep -Milliseconds 250
            if ($supervisor.HasExited) { throw "Preview supervisor exited. See $runtime\supervisor.error.log" }
            $state = Read-State
        } until ((Find-Process $state.supervisor) -or (Get-Date) -ge $deadline)
        if (!(Find-Process $state.supervisor)) { throw "Supervisor is still starting. Check Status and $runtime\supervisor.error.log." }
    }
    if ($AtLogon) {
        $existing = Startup-Command
        if ($null -ne $existing -and $existing -ne $startup) { throw 'A different per-user startup command already occupies the preview entry.' }
        if ($null -eq $existing) {
            if (!(Test-Path -LiteralPath $runKey)) { New-Item -Path $runKey | Out-Null }
            New-ItemProperty -LiteralPath $runKey -Name $entryName -PropertyType String -Value $startup | Out-Null
        }
    }
    Show-Status
} finally { $control.Dispose() }
