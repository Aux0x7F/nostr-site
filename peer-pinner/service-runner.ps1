$ErrorActionPreference = "Stop"

param(
  [string]$PeerPinnerDir = $PSScriptRoot,
  [int]$RestartDelaySeconds = 5
)

$peerPinnerDir = [System.IO.Path]::GetFullPath($PeerPinnerDir)
$entrypoint = Join-Path $peerPinnerDir "dist\\peer-pinner.js"
$logDir = Join-Path $peerPinnerDir "data\\service-logs"
$nodeCommand = Get-Command node -ErrorAction Stop

if (-not (Test-Path $entrypoint)) {
  throw "Peer pinner entrypoint not found at $entrypoint"
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

while ($true) {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $logFile = Join-Path $logDir ("peer-pinner-" + (Get-Date -Format "yyyyMMdd") + ".log")
  Add-Content -Path $logFile -Value "[$timestamp] starting peer pinner"
  Push-Location $peerPinnerDir
  try {
    & $nodeCommand.Source $entrypoint *>> $logFile
    $exitCode = $LASTEXITCODE
  } catch {
    Add-Content -Path $logFile -Value ("[" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "] runner error: " + $_.Exception.Message)
    $exitCode = 1
  } finally {
    Pop-Location
  }
  Add-Content -Path $logFile -Value ("[" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "] peer pinner exited with code " + $exitCode)
  Start-Sleep -Seconds ([Math]::Max(2, $RestartDelaySeconds))
}
