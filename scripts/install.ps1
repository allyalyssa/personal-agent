# Installs (or repairs) the workbench plugin at user scope. Safe to run more than once.
# Runs only the claude CLI already on your PATH; downloads nothing and installs no packages.
# Stops before changing anything if the plugin does not validate on your Claude Code.
param([switch]$SkipTests)

$ErrorActionPreference = 'Stop'
$market = Split-Path -Parent $PSScriptRoot
$plugin = Join-Path $market 'plugins\workbench'
$claudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }
$backupDir = Join-Path $claudeDir 'backups\workbench'
$brain = Join-Path $env:USERPROFILE 'repos\second-brain'
$tested = [version]'2.1.304'

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Write-Host 'The claude command is not on PATH. Install Claude Code (https://code.claude.com), open a new terminal, and run this again.'
    exit 1
}
$raw = (& claude --version | Out-String).Trim()
if ($raw -notmatch '(\d+\.\d+\.\d+)') {
    Write-Host "Could not read the Claude Code version from: $raw"
    exit 1
}
$version = [version]$Matches[1]
Write-Host "Claude Code $version (this plugin was built and tested on $tested)"
if ($version -lt $tested) {
    Write-Host "This Claude Code is older than $tested. Run 'claude update', then run this script again. Nothing was changed."
    exit 1
}
if ($version -gt $tested) {
    Write-Host 'Newer than the tested version: the validation below checks the plugin against this build.'
}

Write-Host ''
Write-Host 'Step 1 of 4: validating the plugin against this Claude Code (read-only)'
& claude plugin validate $market
if ($LASTEXITCODE -ne 0) { Write-Host 'Marketplace validation failed. Nothing was changed.'; exit 1 }
& claude plugin validate $plugin
if ($LASTEXITCODE -ne 0) { Write-Host 'Plugin validation failed. Nothing was changed.'; exit 1 }

if (-not $SkipTests) {
    Write-Host ''
    Write-Host "Step 2 of 4: running the plugin's own tests (sandboxed by Claude Code: no files, network or processes)"
    & claude plugin test $plugin
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Some tests failed on this machine. Nothing was changed. Send the output above to Claude, or rerun with -SkipTests to install anyway.'
        exit 1
    }
}

Write-Host ''
Write-Host 'Step 3 of 4: backing up the files the install changes'
New-Item -ItemType Directory -Force $backupDir | Out-Null
$targets = @(
    (Join-Path $claudeDir 'settings.json'),
    (Join-Path $claudeDir 'plugins\known_marketplaces.json'),
    (Join-Path $claudeDir 'plugins\installed_plugins.json')
)
$preInstall = Join-Path $backupDir 'pre-install'
if (-not (Test-Path $preInstall)) {
    New-Item -ItemType Directory -Force $preInstall | Out-Null
    foreach ($file in $targets) {
        if (Test-Path $file) { Copy-Item $file (Join-Path $preInstall (Split-Path -Leaf $file)) }
    }
    Write-Host "  Saved the pre-install state to $preInstall (kept for good; later runs don't overwrite it)"
}
$stamp = Join-Path $backupDir (Get-Date -Format 'yyyyMMdd-HHmmss')
New-Item -ItemType Directory -Force $stamp | Out-Null
foreach ($file in $targets) {
    if (Test-Path $file) { Copy-Item $file (Join-Path $stamp (Split-Path -Leaf $file)) }
}
Write-Host "  Saved this run's copy to $stamp"

Write-Host ''
Write-Host 'Step 4 of 4: registering the local marketplace and installing at user scope'
& claude plugin marketplace add $market
if ($LASTEXITCODE -ne 0) { Write-Host "Adding the marketplace failed. Restore from $stamp if anything looks wrong."; exit 1 }
& claude plugin install workbench@claude-workbench --scope user
if ($LASTEXITCODE -ne 0) { Write-Host "Installing the plugin failed. Restore from $stamp if anything looks wrong."; exit 1 }

if (-not (Test-Path $brain)) {
    New-Item -ItemType Directory -Force $brain | Out-Null
    Write-Host "Created an empty second brain at $brain"
}

Write-Host ''
Write-Host 'Installed. Start a NEW Claude Code session (terminal or the desktop Code tab), then run:'
Write-Host '  /system doctor'
Write-Host '  /system budget'
