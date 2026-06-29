# Registers a weekly Windows Task Scheduler job that runs update_rates.py
# every Monday at 09:00. Run this once (as the current user, no elevation needed).
#
# Usage:
#   .\scripts\schedule_rates.ps1
#
# To remove:
#   Unregister-ScheduledTask -TaskName "ChinaTickets-UpdateRates" -Confirm:$false

$TaskName   = "ChinaTickets-UpdateRates"
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot   = Split-Path -Parent $ScriptDir
$Script     = Join-Path $ScriptDir "update_rates.py"
$LogDir     = Join-Path $RepoRoot "logs"
$LogFile    = Join-Path $LogDir   "update_rates.log"

# Ensure log dir exists
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory $LogDir | Out-Null }

# Find python
$Python = (Get-Command python -ErrorAction SilentlyContinue)?.Source
if (-not $Python) {
    Write-Error "python not found in PATH. Install Python and retry."
    exit 1
}

# The action: run python and append output to a log file
$Action = New-ScheduledTaskAction `
    -Execute $Python `
    -Argument "`"$Script`" >> `"$LogFile`" 2>&1" `
    -WorkingDirectory $RepoRoot

# Weekly on Monday at 09:00
$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At "09:00"

# Run whether or not user is logged in, using the current user account
$Settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable

$Principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Limited

# Remove existing task if present
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed existing task."
}

Register-ScheduledTask `
    -TaskName   $TaskName `
    -Action     $Action `
    -Trigger    $Trigger `
    -Settings   $Settings `
    -Principal  $Principal `
    -Description "Weekly USD exchange rate update for china-ticket-sites locale pages" `
    | Out-Null

Write-Host "Scheduled task '$TaskName' registered."
Write-Host "  Runs: every Monday at 09:00"
Write-Host "  Script: $Script"
Write-Host "  Log: $LogFile"
Write-Host ""
Write-Host "Test it now with:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Get-ScheduledTaskInfo -TaskName '$TaskName'"
