param(
  [string]$AccountId
)
$ErrorActionPreference = "Stop"

if (!$AccountId) {
  for ($i = 0; $i -lt $args.Count; $i++) {
    if ($args[$i] -eq "--account" -and ($i + 1) -lt $args.Count) {
      $AccountId = $args[$i + 1]
    }
  }
} elseif ($AccountId -eq "--account" -and $args.Count -gt 0) {
  $AccountId = $args[0]
}

$workspace = Resolve-Path (Join-Path $PSScriptRoot "..")
$orbiterDir = Join-Path $workspace ".orbiter"
$configPath = Join-Path $orbiterDir "email-config.json"
$secretPath = Join-Path $orbiterDir "email-secrets.json"

if (!(Test-Path $configPath)) {
  throw "Missing .orbiter/email-config.json. Run: npm run email:setup -- --address `"your.address@gmail.com`""
}

$config = Get-Content $configPath -Raw | ConvertFrom-Json
$selectedAccount = if ($AccountId) {
  $config.accounts | Where-Object { $_.id -eq $AccountId -or $_.address -eq $AccountId } | Select-Object -First 1
} else {
  $config.accounts | Select-Object -First 1
}
if (!$selectedAccount -or !$selectedAccount.address) {
  throw "Email config has no matching account. Run: npm run email:list"
}

Write-Host "Store Gmail app password for $($selectedAccount.address)"
Write-Host "This is encrypted with the current Windows user profile and saved in .orbiter/email-secrets.json."
Write-Host "Do not use your normal Google password."

$secure = Read-Host "Gmail app password" -AsSecureString
$encrypted = ConvertFrom-SecureString $secure

if (!(Test-Path $orbiterDir)) {
  New-Item -ItemType Directory -Path $orbiterDir | Out-Null
}

$existing = if (Test-Path $secretPath) {
  Get-Content $secretPath -Raw | ConvertFrom-Json
} else {
  [pscustomobject]@{ version = 1; accounts = @() }
}

$accounts = @($existing.accounts | Where-Object { $_.id -ne $selectedAccount.id -and $_.address -ne $selectedAccount.address })
$accounts += [ordered]@{
  id = $selectedAccount.id
  address = $selectedAccount.address
  provider = $selectedAccount.provider
  credential = [ordered]@{
    type = "windows-dpapi-secure-string"
    encrypted = $encrypted
    created = (Get-Date).ToUniversalTime().ToString("o")
  }
}

$payload = [ordered]@{
  version = 1
  accounts = $accounts
}

$payload | ConvertTo-Json -Depth 8 | Set-Content -Path $secretPath -Encoding UTF8
Write-Host "Stored encrypted Gmail app password at .orbiter/email-secrets.json"
