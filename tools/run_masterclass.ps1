<#
.SYNOPSIS
    Transcrit une masterclass vers un dossier dédié, sans jamais écraser un corpus existant.

.DESCRIPTION
    Remplace `run.ps1`, qui écrit en dur dans transcripts/ et for_ai/ et détruit
    donc le corpus de Kirei si on le relance pour un autre contenu.

    Ici le nom de sortie est obligatoire, et le script refuse d'écrire dans un
    dossier déjà rempli sauf -Force explicite.

.EXAMPLE
    .\run_masterclass.ps1 -Source "D:\videos\coach_x" -Name coach_x

.EXAMPLE
    .\run_masterclass.ps1 -Source "D:\videos\coach_x" -Name coach_x -FixOnly
    Rejoue les corrections de vocabulaire sans repasser par le GPU.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, HelpMessage = "Dossier contenant les vidéos ou les audios")]
    [string]$Source,

    [Parameter(Mandatory = $true, HelpMessage = "Nom court du corpus, ex: kirei, coach_x")]
    [ValidatePattern('^[a-zA-Z0-9_-]+$')]
    [string]$Name,

    [string]$Language = "fr",
    [string]$Root = $PSScriptRoot,
    [switch]$FixOnly,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$python = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    throw "Interpréteur introuvable : $python`nLance ce script depuis le dossier lol-transcribe, ou passe -Root."
}
if (-not (Test-Path $Source)) {
    throw "Dossier source introuvable : $Source"
}

$transcripts = Join-Path $Root "transcripts_$Name"
$forAi       = Join-Path $Root "for_ai_$Name"

# Le garde-fou : on ne réécrit jamais par-dessus un corpus existant sans le dire.
foreach ($dir in @($transcripts, $forAi)) {
    if ((Test-Path $dir) -and -not $FixOnly -and -not $Force) {
        $count = @(Get-ChildItem $dir -File -ErrorAction SilentlyContinue).Count
        if ($count -gt 0) {
            throw @"
$dir contient déjà $count fichiers.

Les .raw.json sont la source de vérité et ne se régénèrent jamais à l'identique.
Choisis un autre -Name, ou relance avec -Force si tu veux vraiment écraser.
"@
        }
    }
}

if ($FixOnly) {
    Write-Host "`n== Correction seule (pas de GPU) ==" -ForegroundColor Cyan
    & $python (Join-Path $Root "transcribe.py") $Source --out $transcripts --fix-only
    if ($LASTEXITCODE -ne 0) { throw "transcribe.py --fix-only a échoué ($LASTEXITCODE)" }
}
else {
    Write-Host "`n== 1/2 Transcription ==" -ForegroundColor Cyan
    Write-Host "   $Source -> $transcripts (langue : $Language)"
    & $python (Join-Path $Root "transcribe.py") $Source --out $transcripts --language $Language
    if ($LASTEXITCODE -ne 0) { throw "transcribe.py a échoué ($LASTEXITCODE)" }

    Write-Host "`n== 2/2 Découpage pour l'IA ==" -ForegroundColor Cyan
    & $python (Join-Path $Root "chunk_for_ai.py") --transcripts $transcripts --out $forAi
    if ($LASTEXITCODE -ne 0) { throw "chunk_for_ai.py a échoué ($LASTEXITCODE)" }
}

$corrections = Join-Path $transcripts "_corrections.md"
Write-Host "`n== Terminé ==" -ForegroundColor Green
Write-Host "   transcripts : $transcripts"
Write-Host "   blocs IA    : $forAi"

if (Test-Path $corrections) {
    Write-Host "`n   Relis $corrections" -ForegroundColor Yellow
    Write-Host "   Correction juste -> overrides.json"
    Write-Host "   Nom de joueur ou d'équipe -> protected.json"
    Write-Host "   Puis : .\run_masterclass.ps1 -Source `"$Source`" -Name $Name -FixOnly"
}

Write-Host "`n   Pour fusionner avec les autres masterclass :"
Write-Host "   python -m hexa ingest `"$transcripts`" --coach `"<nom du coach>`"" -ForegroundColor Cyan
