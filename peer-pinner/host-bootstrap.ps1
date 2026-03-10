[CmdletBinding()]
param(
  [string]$RepoSlug = "Aux0x7F/nostr-site",
  [string]$Branch = "main",
  [string]$InstallRoot = "",
  [string]$TaskName = "NostrSitePeerPinner",
  [string]$RootAdminPubkey = "",
  [string]$SiteDomain = "",
  [string]$AppTag = "",
  [string]$ProtocolPrefix = "",
  [string]$Relays = "",
  [switch]$PublishBootstrap,
  [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"

if (-not $InstallRoot) {
  $InstallRoot = Join-Path $env:LOCALAPPDATA "nostr-site-pinner"
}

$installRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$peerPinnerDir = Join-Path $installRoot "peer-pinner"
$runnerScript = Join-Path $peerPinnerDir "service-runner.ps1"

Ensure-Winget
Ensure-CommandInstalled -CommandName "node" -WingetId "OpenJS.NodeJS.LTS"
Ensure-CommandInstalled -CommandName "gh" -WingetId "GitHub.cli"
Ensure-CommandInstalled -CommandName "git" -WingetId "Git.Git"
Ensure-GitHubAuth

Stop-PeerPinnerTask -TaskName $TaskName
Sync-NostrSiteRepo -RepoSlug $RepoSlug -Branch $Branch -InstallRoot $installRoot
Install-NodeDependencies -InstallRoot $installRoot
Run-SetupWizard `
  -PeerPinnerDir $peerPinnerDir `
  -RepoSlug $RepoSlug `
  -Branch $Branch `
  -InstallRoot $installRoot `
  -RootAdminPubkey $RootAdminPubkey `
  -SiteDomain $SiteDomain `
  -AppTag $AppTag `
  -ProtocolPrefix $ProtocolPrefix `
  -Relays $Relays `
  -PublishBootstrap:$PublishBootstrap `
  -NonInteractive:$NonInteractive
Register-PeerPinnerTask -TaskName $TaskName -PeerPinnerDir $peerPinnerDir
Start-PeerPinnerTask -TaskName $TaskName

Write-Host "Peer pinner host bootstrap complete"
Write-Host "- install root: $installRoot"
Write-Host "- task name: $TaskName"
Write-Host "- runner: $runnerScript"

function Ensure-Winget {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    return
  }
  throw "winget is required for the host bootstrap script."
}

function Ensure-CommandInstalled {
  param(
    [Parameter(Mandatory = $true)][string]$CommandName,
    [Parameter(Mandatory = $true)][string]$WingetId
  )

  if (Get-Command $CommandName -ErrorAction SilentlyContinue) {
    return
  }

  Write-Host "Installing $CommandName via winget ($WingetId)"
  & winget install --id $WingetId --exact --accept-package-agreements --accept-source-agreements --silent
  Refresh-Path
  if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    throw "$CommandName was installed but is still not available in PATH."
  }
}

function Refresh-Path {
  $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = ($machinePath, $userPath -ne $null ? $userPath : "") -join ";"
}

function Ensure-GitHubAuth {
  $status = Run-External -FilePath "gh" -ArgumentList @("auth", "status", "-h", "github.com") -AllowFailure
  if ($status.ExitCode -ne 0) {
    Write-Host "GitHub CLI is not authenticated. Launching gh auth login."
    & gh auth login --web --git-protocol https --scopes repo,workflow
    return
  }

  $scopeProbe = Run-External -FilePath "gh" -ArgumentList @("api", "-i", "user") -AllowFailure
  if ($scopeProbe.ExitCode -eq 0 -and $scopeProbe.StdOut -match "x-oauth-scopes:\s*(.+)") {
    $scopes = $Matches[1]
    if ($scopes -notmatch "(^|,\s*)repo(,|$)") {
      Write-Host "GitHub auth is present. Ensure the token has Contents write and Pull requests write for the target repo."
    }
  }
}

function Sync-NostrSiteRepo {
  param(
    [string]$RepoSlug,
    [string]$Branch,
    [string]$InstallRoot
  )

  if (Test-Path (Join-Path $InstallRoot ".git")) {
    Write-Host "Updating existing nostr-site checkout at $InstallRoot"
    & git -C $InstallRoot fetch origin $Branch
    & git -C $InstallRoot checkout $Branch
    & git -C $InstallRoot pull --ff-only origin $Branch
    return
  }

  if (Test-Path $InstallRoot) {
    $entries = Get-ChildItem -Force -Path $InstallRoot -ErrorAction SilentlyContinue
    if ($entries) {
      throw "Install root $InstallRoot exists but is not a nostr-site git checkout."
    }
    Remove-Item -Force -Path $InstallRoot
  } else {
    $parent = Split-Path -Parent $InstallRoot
    if ($parent) {
      New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
  }

  Write-Host "Cloning $RepoSlug into $InstallRoot"
  & gh repo clone $RepoSlug $InstallRoot -- --branch $Branch --single-branch
}

function Install-NodeDependencies {
  param([string]$InstallRoot)

  Write-Host "Installing node dependencies"
  Push-Location $InstallRoot
  try {
    & npm ci
    & npm --prefix peer-pinner ci
    & npm run build:all
  } finally {
    Pop-Location
  }
}

function Run-SetupWizard {
  param(
    [string]$PeerPinnerDir,
    [string]$RepoSlug,
    [string]$Branch,
    [string]$InstallRoot,
    [string]$RootAdminPubkey,
    [string]$SiteDomain,
    [string]$AppTag,
    [string]$ProtocolPrefix,
    [string]$Relays,
    [switch]$PublishBootstrap,
    [switch]$NonInteractive
  )

  $wizardArgs = @(
    (Join-Path $PeerPinnerDir "setup-wizard.js"),
    "--repo=$RepoSlug",
    "--repo-dir=$InstallRoot",
    "--base-branch=$Branch"
  )
  if ($RootAdminPubkey) { $wizardArgs += "--root-admin-pubkey=$RootAdminPubkey" }
  if ($SiteDomain) { $wizardArgs += "--site-domain=$SiteDomain" }
  if ($AppTag) { $wizardArgs += "--app-tag=$AppTag" }
  if ($ProtocolPrefix) { $wizardArgs += "--protocol-prefix=$ProtocolPrefix" }
  if ($Relays) { $wizardArgs += "--relays=$Relays" }
  if ($PublishBootstrap) { $wizardArgs += "--publish-bootstrap" }
  if ($NonInteractive) { $wizardArgs += "--non-interactive" }

  Write-Host "Running pinner setup wizard"
  & node @wizardArgs
}

function Register-PeerPinnerTask {
  param(
    [string]$TaskName,
    [string]$PeerPinnerDir
  )

  $powerShellExe = Resolve-PowerShellExe
  $runner = Join-Path $PeerPinnerDir "service-runner.ps1"
  $action = New-ScheduledTaskAction -Execute $powerShellExe -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -PeerPinnerDir `"$PeerPinnerDir`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew

  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
}

function Resolve-PowerShellExe {
  $pwsh = Get-Command pwsh.exe -ErrorAction SilentlyContinue
  if ($pwsh) { return $pwsh.Source }
  $windowsPowerShell = Get-Command powershell.exe -ErrorAction SilentlyContinue
  if ($windowsPowerShell) { return $windowsPowerShell.Source }
  throw "Could not find pwsh.exe or powershell.exe."
}

function Stop-PeerPinnerTask {
  param([string]$TaskName)

  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $task) { return }
  try {
    Stop-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 2
  } catch {
    Write-Host "Task $TaskName was not running."
  }
}

function Start-PeerPinnerTask {
  param([string]$TaskName)

  Start-ScheduledTask -TaskName $TaskName
}

function Run-External {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [switch]$AllowFailure
  )

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $FilePath
  foreach ($arg in $ArgumentList) {
    [void]$psi.ArgumentList.Add($arg)
  }
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $psi
  [void]$process.Start()
  $stdOut = $process.StandardOutput.ReadToEnd()
  $stdErr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  if (-not $AllowFailure -and $process.ExitCode -ne 0) {
    throw ($stdOut + $stdErr).Trim()
  }
  return [pscustomobject]@{
    ExitCode = $process.ExitCode
    StdOut = $stdOut.Trim()
    StdErr = $stdErr.Trim()
  }
}
