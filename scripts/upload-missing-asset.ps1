# Joint un fichier manquant a une release existante.
param(
    [string]$Tag = "v1.2.1",
    [string]$File = "NumDeck-Setup-1.2.1.exe"
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$tmpReq = Join-Path $env:TEMP 'ghcred-req.txt'
[System.IO.File]::WriteAllText($tmpReq, "protocol=https`nhost=github.com`n`n")
$credOutput = cmd /c "git credential fill < `"$tmpReq`""
Remove-Item $tmpReq -Force
$token = ($credOutput | Where-Object { $_ -like 'password=*' }) -replace '^password=', ''
if (-not $token) { Write-Host "ECHEC: aucun jeton"; exit 1 }

$headers = @{ Authorization = "token $token"; Accept = "application/vnd.github+json"; 'User-Agent' = 'NumDeck-release' }
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/Azukkia/numdeck/releases/tags/$Tag" -Headers $headers
$path = Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) 'dist') $File
Write-Host ("Upload de $File (" + [math]::Round((Get-Item $path).Length/1MB,1) + " Mo)...")
$uploadUrl = "https://uploads.github.com/repos/Azukkia/numdeck/releases/$($release.id)/assets?name=$File"
Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $headers -InFile $path -ContentType "application/octet-stream" -TimeoutSec 1800 | Out-Null
Write-Host "OK - fichier joint a la release $Tag"
