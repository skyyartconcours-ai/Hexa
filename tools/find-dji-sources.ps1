#Requires -Version 5.1
<#
.SYNOPSIS
    Retrouve les fichiers sources d'origine (rushes DJI) utilises pour fabriquer
    un master video monte dans Adobe Premiere Pro.

.DESCRIPTION
    Le script croise quatre pistes d'indices, de la plus fiable a la moins fiable :

      1. .prproj  : les chemins medias references par un projet Premiere
                    (le .prproj est un XML gzippe, on le decompresse et on lit
                    les noeuds ActualMediaFilePath / FilePath).
      2. XMP      : les metadonnees de provenance ecrites par Premiere Pro et
                    Media Encoder dans le fichier exporte
                    (xmpMM:Ingredients, xmpMM:DerivedFrom, stRef:filePath).
                    C'est la piste la plus directe quand le master est un export.
      3. Atomes   : les noms de fichiers DJI_* encore presents en clair dans les
                    atomes du MP4 (cas d'un fichier simplement renomme ou
                    concatene sans reencodage).
      4. Disque   : un balayage des fichiers DJI_* dont la date encadre celle du
                    master, avec somme des durees comparee a celle du master.

    Le script ne modifie rien : il lit et rapporte.

.PARAMETER Project
    Chemin du .prproj a inspecter. Peut etre passe plusieurs fois.
    Astuce : passe aussi les AUTRES .prproj du dossier — si le master a ete
    exporte depuis un projet "derush", c'est celui-la qui contient la liste des
    rushes DJI.

.PARAMETER Master
    Chemin du fichier master dont on cherche les sources.

.PARAMETER SearchRoot
    Racine(s) a balayer pour retrouver les rushes DJI sur le disque.

.PARAMETER DaysAround
    Fenetre, en jours avant la date du master, dans laquelle un rush est
    considere comme candidat plausible.

.PARAMETER Report
    Chemin du CSV recapitulatif des rushes trouves.

.EXAMPLE
    .\find-dji-sources.ps1

.EXAMPLE
    .\find-dji-sources.ps1 -Project 'F:\VIDEO STOCKING\MARAKCH45AS.prproj' `
                           -Master  'F:\VIDEO STOCKING\MARRAKECH FINALE DERUSH.mp4' `
                           -SearchRoot 'F:\'

.EXAMPLE
    # Inspecter tous les projets du dossier d'un coup
    .\find-dji-sources.ps1 -Project (Get-ChildItem 'F:\VIDEO STOCKING\*.prproj').FullName
#>
[CmdletBinding()]
param(
    [string[]]$Project    = @('F:\VIDEO STOCKING\MARAKCH45AS.prproj'),
    [string]  $Master     = 'F:\VIDEO STOCKING\MARRAKECH FINALE DERUSH.mp4',
    [string[]]$SearchRoot = @('F:\'),
    [int]     $DaysAround = 60,
    [string]  $Report     = (Join-Path (Get-Location) 'dji-sources-report.csv'),
    [int]     $ChunkMB    = 48
)

$ErrorActionPreference = 'Continue'
$script:shellApp = $null
$script:durIndex = $null
$script:ffprobe  = Get-Command ffprobe -ErrorAction SilentlyContinue

# ---------------------------------------------------------------- affichage --

function Write-Section {
    param([string]$Title)
    Write-Host ''
    Write-Host ('=' * 78) -ForegroundColor DarkCyan
    Write-Host "  $Title" -ForegroundColor Cyan
    Write-Host ('=' * 78) -ForegroundColor DarkCyan
}

function Format-Duration {
    param($Seconds)
    if ($null -eq $Seconds) { return 'n/a' }
    return [TimeSpan]::FromSeconds([double]$Seconds).ToString('hh\:mm\:ss')
}

function Format-Size {
    param([long]$Bytes)
    return '{0:N2} Go' -f ($Bytes / 1GB)
}

# ------------------------------------------------------------------ durees ---

function Get-ShellDurationIndex {
    param($Folder)
    if ($null -ne $script:durIndex) { return $script:durIndex }
    $labels = @('Length', 'Durée', 'Duree', 'Dauer', 'Duración', 'Durata')
    for ($i = 0; $i -lt 350; $i++) {
        $header = $Folder.GetDetailsOf($null, $i)
        if ($labels -contains $header) { $script:durIndex = $i; return $i }
    }
    $script:durIndex = -1
    return -1
}

function Get-ShellDuration {
    param([string]$Path)
    try {
        $dir  = Split-Path -Parent $Path
        $name = Split-Path -Leaf   $Path
        if (-not $script:shellApp) { $script:shellApp = New-Object -ComObject Shell.Application }
        $folder = $script:shellApp.Namespace($dir)
        if (-not $folder) { return $null }
        $idx = Get-ShellDurationIndex -Folder $folder
        if ($idx -lt 0) { return $null }
        $item = $folder.ParseName($name)
        if (-not $item) { return $null }
        # GetDetailsOf glisse parfois des marques Unicode invisibles dans la chaine.
        $txt = ($folder.GetDetailsOf($item, $idx) -replace '[^\d:]', '')
        if (-not $txt) { return $null }
        $ts = [TimeSpan]::Zero
        if ([TimeSpan]::TryParse($txt, [ref]$ts)) { return $ts.TotalSeconds }
    } catch { }
    return $null
}

function Get-MediaDuration {
    param([string]$Path)
    if ($script:ffprobe) {
        try {
            $out = & $script:ffprobe.Source -v error -show_entries format=duration -of csv=p=0 -i "$Path" 2>$null
            if ($out) {
                # ffprobe sort toujours un point decimal, quelle que soit la locale.
                return [double]::Parse(($out | Select-Object -First 1).Trim(),
                                       [System.Globalization.CultureInfo]::InvariantCulture)
            }
        } catch { }
    }
    return (Get-ShellDuration -Path $Path)
}

# ------------------------------------------------------------------ .prproj --

function Read-PremiereProject {
    param([string]$Path)
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -ge 2 -and $bytes[0] -eq 0x1F -and $bytes[1] -eq 0x8B) {
        # .prproj classique : XML gzippe.
        $ms = New-Object System.IO.MemoryStream(, $bytes)
        $gz = New-Object System.IO.Compression.GZipStream($ms, [System.IO.Compression.CompressionMode]::Decompress)
        $sr = New-Object System.IO.StreamReader($gz, [System.Text.Encoding]::UTF8)
        try { return $sr.ReadToEnd() } finally { $sr.Dispose(); $gz.Dispose(); $ms.Dispose() }
    }
    # Projet enregistre en "non compresse".
    return [System.Text.Encoding]::UTF8.GetString($bytes)
}

function ConvertTo-LocalPath {
    param([string]$Raw)
    $p = [System.Net.WebUtility]::HtmlDecode($Raw).Trim()
    if ($p -match '^file://') {
        $p = $p -replace '^file://(localhost)?/?', ''
        $p = [System.Uri]::UnescapeDataString($p)
    }
    return ($p -replace '/', '\')
}

function Get-ProjectMedia {
    param([string]$Path)
    $xml  = Read-PremiereProject -Path $Path
    $seen = New-Object System.Collections.Generic.HashSet[string]
    foreach ($tag in @('ActualMediaFilePath', 'MediaFilePath', 'FilePath', 'RelativePath')) {
        foreach ($m in [regex]::Matches($xml, "<$tag>([^<]+)</$tag>")) {
            $p = ConvertTo-LocalPath -Raw $m.Groups[1].Value
            if ($p -match '\.\w{2,5}$') { [void]$seen.Add($p) }
        }
    }
    return @($seen)
}

# --------------------------------------------------------- lecture par bloc --

function Get-FileChunkText {
    param([string]$Path, [long]$Offset, [int]$Length)
    $fs = [System.IO.File]::OpenRead($Path)
    try {
        if ($Offset -lt 0) { $Offset = [Math]::Max(0L, $fs.Length + $Offset) }
        if ($Offset -ge $fs.Length) { return '' }
        $count = [int][Math]::Min([long]$Length, $fs.Length - $Offset)
        $buf   = New-Object byte[] $count
        [void]$fs.Seek($Offset, [System.IO.SeekOrigin]::Begin)
        $read  = $fs.Read($buf, 0, $count)
        # Latin-1 : conserve chaque octet tel quel, pratique pour grepper du binaire.
        return [System.Text.Encoding]::GetEncoding(28591).GetString($buf, 0, $read)
    } finally { $fs.Dispose() }
}

function Get-MasterProbeText {
    param([string]$Path, [int]$Mb)
    $len  = (Get-Item -LiteralPath $Path).Length
    $size = $Mb * 1MB
    $text = Get-FileChunkText -Path $Path -Offset 0 -Length $size
    if ($len -gt $size) {
        $text += "`n" + (Get-FileChunkText -Path $Path -Offset (-1 * [long]$size) -Length $size)
    }
    return $text
}

function Get-XmpReferences {
    param([string]$Text)
    $refs = New-Object System.Collections.Generic.HashSet[string]
    foreach ($pattern in @(
            'stRef:filePath\s*=\s*"([^"]+)"',
            '<stRef:filePath>([^<]+)</stRef:filePath>',
            'xmpMM:DerivedFrom\s*=\s*"([^"]+)"',
            '<premierePrivateProjectMetaData:Column\.Intrinsic\.MediaFilePath>([^<]+)<')) {
        foreach ($m in [regex]::Matches($Text, $pattern)) {
            [void]$refs.Add((ConvertTo-LocalPath -Raw $m.Groups[1].Value))
        }
    }
    return @($refs)
}

function Get-DjiNameTraces {
    param([string]$Text)
    $names = New-Object System.Collections.Generic.HashSet[string]
    foreach ($m in [regex]::Matches($Text, '(?i)DJI[_\-][A-Za-z0-9_\-]{2,60}\.(?:MP4|MOV|LRF)')) {
        [void]$names.Add($m.Value)
    }
    return @($names)
}

function Get-DjiStamp {
    param([string]$Name)
    if ($Name -match 'DJI[_\-](\d{8})[_\-]?(\d{6})') {
        try {
            return [datetime]::ParseExact(($Matches[1] + $Matches[2]), 'yyyyMMddHHmmss',
                                          [System.Globalization.CultureInfo]::InvariantCulture)
        } catch { }
    }
    return $null
}

# =============================================================================
#  1. Le master
# =============================================================================

Write-Section '1. Fichier master'

$masterItem     = $null
$masterDuration = $null
if (Test-Path -LiteralPath $Master) {
    $masterItem     = Get-Item -LiteralPath $Master
    $masterDuration = Get-MediaDuration -Path $Master
    [PSCustomObject]@{
        Fichier    = $masterItem.FullName
        Taille     = Format-Size $masterItem.Length
        Duree      = Format-Duration $masterDuration
        Cree       = $masterItem.CreationTime
        Modifie    = $masterItem.LastWriteTime
    } | Format-List
    if (-not $script:ffprobe) {
        Write-Host 'ffprobe introuvable : durees lues via les proprietes Windows (moins fiable).' -ForegroundColor DarkYellow
    }
} else {
    Write-Host "Master introuvable : $Master" -ForegroundColor Yellow
    Write-Host 'Passe le bon chemin avec -Master. Les autres etapes continuent.' -ForegroundColor DarkYellow
}

# =============================================================================
#  2. Medias references par le(s) projet(s) Premiere
# =============================================================================

Write-Section '2. Medias references par le(s) projet(s) Premiere'

$projectMedia = @()
foreach ($proj in $Project) {
    if (-not (Test-Path -LiteralPath $proj)) {
        Write-Host "Projet introuvable : $proj" -ForegroundColor Yellow
        continue
    }
    Write-Host ''
    Write-Host "--- $proj" -ForegroundColor White
    try {
        $media = Get-ProjectMedia -Path $proj
    } catch {
        Write-Host "  Lecture impossible : $($_.Exception.Message)" -ForegroundColor Red
        continue
    }
    if (-not $media) {
        Write-Host '  Aucun chemin media trouve dans ce projet.' -ForegroundColor DarkYellow
        continue
    }
    $projectMedia += $media
    foreach ($m in ($media | Sort-Object)) {
        $isDji = (Split-Path -Leaf $m) -match '^(?i)DJI[_\-]'
        $color = if ($isDji) { 'Green' } else { 'Gray' }
        $tag   = if ($isDji) { '[DJI] ' } else { '      ' }
        Write-Host "  $tag$m" -ForegroundColor $color
    }
}

$djiInProjects = @($projectMedia | Where-Object { (Split-Path -Leaf $_) -match '^(?i)DJI[_\-]' } | Sort-Object -Unique)
if ($djiInProjects) {
    Write-Host ''
    Write-Host "=> $($djiInProjects.Count) rush(es) DJI reference(s) directement par un projet." -ForegroundColor Green
} else {
    Write-Host ''
    Write-Host '=> Aucun nom DJI dans les projets inspectes : le master a probablement ete' -ForegroundColor DarkYellow
    Write-Host '   fabrique ailleurs. Relance en passant TOUS les .prproj du dossier :' -ForegroundColor DarkYellow
    Write-Host "   .\find-dji-sources.ps1 -Project (Get-ChildItem 'F:\VIDEO STOCKING\*.prproj').FullName" -ForegroundColor DarkYellow
}

# =============================================================================
#  3. Provenance XMP + traces de noms dans le master
# =============================================================================

Write-Section '3. Provenance inscrite dans le master (XMP + atomes)'

$xmpRefs   = @()
$djiTraces = @()
if ($masterItem) {
    Write-Host "Lecture des $ChunkMB premiers et derniers Mo du fichier..." -ForegroundColor DarkGray
    try {
        $probe     = Get-MasterProbeText -Path $Master -Mb $ChunkMB
        $xmpRefs   = Get-XmpReferences  -Text $probe
        $djiTraces = Get-DjiNameTraces  -Text $probe

        $hasXmp = [regex]::IsMatch($probe, '<x:xmpmeta')
        Write-Host ("Paquet XMP present : " + $(if ($hasXmp) { 'oui' } else { 'non' })) -ForegroundColor DarkGray

        foreach ($tag in @('Osmo Action', 'Osmo Pocket', 'Pocket 3', 'Mavic', 'Air 3', 'Mini 4', 'Ronin', 'DJI')) {
            if ($probe -like "*$tag*") { Write-Host "Signature camera reperee : $tag" -ForegroundColor DarkGray; break }
        }
    } catch {
        Write-Host "Lecture du master impossible : $($_.Exception.Message)" -ForegroundColor Red
    }

    if ($xmpRefs) {
        Write-Host ''
        Write-Host 'Ingredients XMP (fichiers ayant servi a produire ce master) :' -ForegroundColor Green
        $xmpRefs | Sort-Object | ForEach-Object { Write-Host "  $_" -ForegroundColor Green }
    } else {
        Write-Host ''
        Write-Host 'Aucun ingredient XMP : export sans metadonnees de provenance, ou' -ForegroundColor DarkYellow
        Write-Host 'fichier produit hors Adobe (concatenation, DaVinci, appli DJI...).' -ForegroundColor DarkYellow
    }

    if ($djiTraces) {
        Write-Host ''
        Write-Host 'Noms DJI encore lisibles dans les atomes du MP4 :' -ForegroundColor Green
        $djiTraces | Sort-Object | ForEach-Object { Write-Host "  $_" -ForegroundColor Green }
    }
}

# =============================================================================
#  4. Balayage disque des rushes DJI
# =============================================================================

Write-Section '4. Rushes DJI presents sur le disque'

$rushes = @()
foreach ($root in $SearchRoot) {
    if (-not (Test-Path -LiteralPath $root)) {
        Write-Host "Racine introuvable : $root" -ForegroundColor Yellow
        continue
    }
    Write-Host "Balayage de $root ..." -ForegroundColor DarkGray
    $rushes += Get-ChildItem -LiteralPath $root -Recurse -File -Filter 'DJI_*' -ErrorAction SilentlyContinue |
               Where-Object { $_.Extension -match '^(?i)\.(mp4|mov)$' }
}

if (-not $rushes) {
    Write-Host 'Aucun fichier DJI_* trouve. Les rushes ont peut-etre ete renommes ou' -ForegroundColor Yellow
    Write-Host 'sont sur un autre disque : relance avec -SearchRoot.' -ForegroundColor Yellow
} else {
    $refDate = if ($masterItem) { $masterItem.LastWriteTime } else { Get-Date }
    $rows = foreach ($r in $rushes) {
        $stamp = Get-DjiStamp -Name $r.Name
        if (-not $stamp) { $stamp = $r.LastWriteTime }
        $delta = ($refDate - $stamp).TotalDays
        [PSCustomObject]@{
            Nom          = $r.Name
            Dossier      = $r.DirectoryName
            Tournage     = $stamp
            JoursAvant   = [Math]::Round($delta, 1)
            Candidat     = ($delta -ge -1 -and $delta -le $DaysAround)
            TailleOctets = $r.Length
            Taille       = Format-Size $r.Length
            DureeSec     = (Get-MediaDuration -Path $r.FullName)
            Chemin       = $r.FullName
        }
    }
    $rows = @($rows | Sort-Object Tournage)

    $rows | Select-Object Nom, Tournage, Taille,
                          @{ n = 'Duree'; e = { Format-Duration $_.DureeSec } },
                          Candidat, Dossier |
            Format-Table -AutoSize

    $candidats = @($rows | Where-Object Candidat)
    Write-Host "$($rows.Count) rush(es) DJI au total, dont $($candidats.Count) dans la fenetre de $DaysAround jours avant le master." -ForegroundColor Cyan

    if ($candidats -and $masterDuration) {
        $sum = ($candidats | Where-Object { $null -ne $_.DureeSec } | Measure-Object DureeSec -Sum).Sum
        if ($sum) {
            $ratio = $sum / $masterDuration
            Write-Host ("Duree cumulee des candidats : {0}  |  master : {1}  |  ratio : {2:N2}x" -f `
                        (Format-Duration $sum), (Format-Duration $masterDuration), $ratio) -ForegroundColor Cyan
            if ($ratio -ge 0.95 -and $ratio -le 1.10) {
                Write-Host '=> Le cumul colle a la duree du master : ce lot est tres probablement la source.' -ForegroundColor Green
            } elseif ($ratio -lt 0.95) {
                Write-Host '=> Le cumul est plus court que le master : il manque des rushes.' -ForegroundColor Yellow
            } else {
                Write-Host '=> Le cumul depasse le master : le lot contient des rushes non retenus au derush.' -ForegroundColor Yellow
            }
        }
    }

    try {
        $rows | Select-Object Nom, Tournage, Taille, TailleOctets,
                              @{ n = 'Duree'; e = { Format-Duration $_.DureeSec } },
                              DureeSec, Candidat, Chemin |
                Export-Csv -LiteralPath $Report -NoTypeInformation -Encoding UTF8
        Write-Host ''
        Write-Host "Rapport CSV ecrit : $Report" -ForegroundColor Cyan
    } catch {
        Write-Host "Ecriture du CSV impossible : $($_.Exception.Message)" -ForegroundColor Red
    }
}

# =============================================================================
#  Synthese
# =============================================================================

Write-Section 'Synthese'

if ($xmpRefs) {
    Write-Host 'Reponse la plus fiable : les ingredients XMP de la section 3.' -ForegroundColor Green
    Write-Host 'Ce sont les fichiers reellement consommes pour produire le master.' -ForegroundColor Green
} elseif ($djiInProjects) {
    Write-Host 'Reponse la plus fiable : les rushes DJI de la section 2 (references par un projet).' -ForegroundColor Green
} elseif ($djiTraces) {
    Write-Host 'Piste serieuse : les noms DJI encore inscrits dans le MP4 (section 3).' -ForegroundColor Green
} else {
    Write-Host 'Aucune provenance inscrite dans les fichiers. Il reste la correlation par' -ForegroundColor Yellow
    Write-Host 'date et duree de la section 4, et ces deux verifications manuelles :' -ForegroundColor Yellow
    Write-Host "  - dans Premiere, clic droit sur le clip dans le chutier > Propriétés," -ForegroundColor Yellow
    Write-Host "    puis > Faire apparaître dans l'Explorateur ;" -ForegroundColor Yellow
    Write-Host '  - ouvrir les autres .prproj du dossier : celui qui a servi au derush' -ForegroundColor Yellow
    Write-Host '    contient la liste complete des rushes.' -ForegroundColor Yellow
}
Write-Host ''
