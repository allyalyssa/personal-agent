# Removes the workbench plugin and its marketplace entry through the claude CLI.
# Deletes no files of yours: the plugin folder, your notes and every backup stay where they are.
$market = 'claude-workbench'

& claude plugin uninstall "workbench@$market" --scope user
if ($LASTEXITCODE -ne 0) { Write-Host 'Uninstall reported an error (it may not have been installed). Continuing.' }
& claude plugin marketplace remove $market
if ($LASTEXITCODE -ne 0) { Write-Host 'Removing the marketplace reported an error (it may already be gone).' }

$claudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }
$preInstall = Join-Path $claudeDir 'backups\workbench\pre-install'
Write-Host ''
Write-Host 'Uninstalled. Left in place:'
Write-Host "  $env:USERPROFILE\repos\claude-workbench   (the plugin source)"
Write-Host "  $env:USERPROFILE\repos\second-brain       (your notes)"
Write-Host "  $claudeDir\plugins\store\workbench_*.json  (dashboard preferences and ledger history; safe to delete)"
Write-Host "  $claudeDir\plugins\cache\claude-workbench  (an inert cached copy; safe to delete)"
if (Test-Path (Join-Path $preInstall 'settings.json')) {
    Write-Host ''
    Write-Host 'To put settings.json back exactly as it was before the first install:'
    Write-Host "  Copy-Item '$preInstall\settings.json' '$claudeDir\settings.json'"
}
