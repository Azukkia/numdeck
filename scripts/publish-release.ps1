# Publie la release GitHub avec les 3 fichiers de mise a jour.
# Utilise le jeton GitHub stocke par Git Credential Manager (jamais affiche).
param(
    [string]$Version = "1.2.0",
    [string]$Owner = "Azukkia",
    [string]$Repo = "numdeck"
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# --- Jeton via git credential (stocke lors du push) ---
$tmpReq = Join-Path $env:TEMP 'ghcred-req.txt'
[System.IO.File]::WriteAllText($tmpReq, "protocol=https`nhost=github.com`n`n")
$credOutput = cmd /c "git credential fill < `"$tmpReq`""
Remove-Item $tmpReq -Force
$token = ($credOutput | Where-Object { $_ -like 'password=*' }) -replace '^password=', ''
if (-not $token) { Write-Host "ECHEC: aucun jeton GitHub trouve"; exit 1 }

$headers = @{ Authorization = "token $token"; Accept = "application/vnd.github+json"; 'User-Agent' = 'NumDeck-release' }
$api = "https://api.github.com/repos/$Owner/$Repo"

# --- Supprimer les brouillons existants (release bloquee dans le navigateur) ---
$releases = Invoke-RestMethod -Uri "$api/releases" -Headers $headers
foreach ($r in $releases) {
    if ($r.draft) {
        Write-Host ("Suppression du brouillon : " + $r.name)
        Invoke-RestMethod -Method Delete -Uri "$api/releases/$($r.id)" -Headers $headers | Out-Null
    }
}

# --- Creer la release publiee ---
$body = @{
    tag_name = "v$Version"
    target_commitish = "main"
    name = "NumDeck $Version"
    body = "Transformez votre pave numerique en Stream Deck. Presets, gestes (simple/double/long), overlay, affichages en direct, integration OBS, mises a jour automatiques."
} | ConvertTo-Json
$release = Invoke-RestMethod -Method Post -Uri "$api/releases" -Headers $headers -Body $body -ContentType "application/json"
Write-Host ("Release creee : " + $release.html_url)

# --- Joindre les 3 fichiers ---
$dist = Join-Path (Split-Path -Parent $PSScriptRoot) 'dist'
$files = @("latest.yml", "NumDeck-Setup-$Version.exe.blockmap", "NumDeck-Setup-$Version.exe")
foreach ($f in $files) {
    $path = Join-Path $dist $f
    $sizeMb = [math]::Round((Get-Item $path).Length / 1MB, 1)
    Write-Host ("Upload de $f ($sizeMb Mo)...")
    $uploadUrl = "https://uploads.github.com/repos/$Owner/$Repo/releases/$($release.id)/assets?name=$f"
    Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $headers -InFile $path -ContentType "application/octet-stream" -TimeoutSec 1800 | Out-Null
    Write-Host ("  OK : $f")
}

Write-Host "TERMINE - release publiee avec les 3 fichiers."
