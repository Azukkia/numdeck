# Génère assets/icon.ico, assets/icon.png et assets/tray.png
# Design : plaque sombre arrondie + grille 2x2 de touches, deux touches en dégradé.

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root 'assets'
if (-not (Test-Path $assets)) { New-Item -ItemType Directory -Path $assets | Out-Null }

function New-RoundRectPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$radius) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

function Draw-NumDeckIcon([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    # Plaque
    $m = [float]($size * 0.03)
    $pw = [float]($size - 2 * $m)
    $plate = New-RoundRectPath $m $m $pw $pw ([float]($size * 0.21))
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.PointF(0, 0)),
        (New-Object System.Drawing.PointF($size, $size)),
        [System.Drawing.Color]::FromArgb(255, 30, 36, 52),
        [System.Drawing.Color]::FromArgb(255, 10, 12, 19))
    $g.FillPath($bgBrush, $plate)

    # Liseré
    $penW = [Math]::Max(1.0, $size * 0.008)
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(60, 255, 255, 255), $penW)
    $g.DrawPath($pen, $plate)

    # Grille 2x2 de touches
    $pad = [float]($size * 0.17)
    $gap = [float]($size * 0.06)
    $ks = [float](($size - 2 * $pad - $gap) / 2)
    $kr = [float]($ks * 0.32)

    $cells = @(
        @{ x = $pad;             y = $pad;             c1 = @(34, 211, 238);  c2 = @(124, 92, 255); grad = $true },
        @{ x = $pad + $ks + $gap; y = $pad;             c1 = @(58, 65, 84);    c2 = @(58, 65, 84);   grad = $false },
        @{ x = $pad;             y = $pad + $ks + $gap; c1 = @(58, 65, 84);    c2 = @(58, 65, 84);   grad = $false },
        @{ x = $pad + $ks + $gap; y = $pad + $ks + $gap; c1 = @(124, 92, 255); c2 = @(244, 114, 182); grad = $true }
    )

    foreach ($cell in $cells) {
        $keyPath = New-RoundRectPath ([float]$cell.x) ([float]$cell.y) $ks $ks $kr
        $col1 = [System.Drawing.Color]::FromArgb(255, $cell.c1[0], $cell.c1[1], $cell.c1[2])
        $col2 = [System.Drawing.Color]::FromArgb(255, $cell.c2[0], $cell.c2[1], $cell.c2[2])
        if ($cell.grad) {
            $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
                (New-Object System.Drawing.PointF([float]$cell.x, [float]$cell.y)),
                (New-Object System.Drawing.PointF([float]($cell.x + $ks), [float]($cell.y + $ks))),
                $col1, $col2)
        } else {
            $brush = New-Object System.Drawing.SolidBrush($col1)
        }
        $g.FillPath($brush, $keyPath)

        # Reflet "verre" sur la moitié haute de la touche
        $glassPath = New-RoundRectPath ([float]$cell.x) ([float]$cell.y) $ks ([float]($ks * 0.52)) $kr
        $glass = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
            (New-Object System.Drawing.PointF([float]$cell.x, [float]$cell.y)),
            (New-Object System.Drawing.PointF([float]$cell.x, [float]($cell.y + $ks * 0.52))),
            [System.Drawing.Color]::FromArgb(70, 255, 255, 255),
            [System.Drawing.Color]::FromArgb(0, 255, 255, 255))
        $g.FillPath($glass, $glassPath)
        $brush.Dispose(); $glass.Dispose(); $keyPath.Dispose(); $glassPath.Dispose()
    }

    $g.Dispose(); $bgBrush.Dispose(); $pen.Dispose(); $plate.Dispose()
    return $bmp
}

function Get-PngBytes([System.Drawing.Bitmap]$bmp) {
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $ms.ToArray()
    $ms.Dispose()
    return , $bytes   # virgule : empêche PowerShell de dérouler le tableau
}

# Entrée ICO au format DIB/BMP classique (requis par NSIS, qui ne lit pas
# les .ico composés uniquement d'entrées PNG)
function Get-DibBytes([System.Drawing.Bitmap]$bmp) {
    $w = $bmp.Width; $h = $bmp.Height
    $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
    $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $pixels = New-Object byte[] ($data.Stride * $h)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $pixels, 0, $pixels.Length)
    $bmp.UnlockBits($data)

    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($ms)
    # BITMAPINFOHEADER (hauteur doublée : masques XOR + AND)
    $bw.Write([UInt32]40); $bw.Write([Int32]$w); $bw.Write([Int32]($h * 2))
    $bw.Write([UInt16]1); $bw.Write([UInt16]32); $bw.Write([UInt32]0)
    $bw.Write([UInt32]($w * $h * 4)); $bw.Write([Int32]0); $bw.Write([Int32]0)
    $bw.Write([UInt32]0); $bw.Write([UInt32]0)
    # Pixels BGRA de bas en haut
    for ($y = $h - 1; $y -ge 0; $y--) { $bw.Write($pixels, $y * $data.Stride, $w * 4) }
    # Masque AND vide (l'alpha 32 bits fait foi)
    $maskRowBytes = [Math]::Ceiling($w / 32.0) * 4
    $bw.Write((New-Object byte[] ($maskRowBytes * $h)))
    $bw.Flush()
    $bytes = $ms.ToArray()
    $bw.Close(); $ms.Dispose()
    return , $bytes   # virgule : empêche PowerShell de dérouler le tableau
}

# --- PNG principal (512) et icône de zone de notification (32) ---
$big = Draw-NumDeckIcon 512
$big.Save((Join-Path $assets 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$big.Dispose()

$tray = Draw-NumDeckIcon 32
$tray.Save((Join-Path $assets 'tray.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$tray.Dispose()

# --- .ico multi-tailles (entrées DIB/BMP, lisibles par NSIS) ---
$sizes = @(256, 128, 64, 48, 32, 24, 16)
$images = @()
foreach ($s in $sizes) {
    $bmp = Draw-NumDeckIcon $s
    $images += , @{ size = $s; bytes = (Get-DibBytes $bmp) }
    $bmp.Dispose()
}

$icoPath = Join-Path $assets 'icon.ico'
$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)

# ICONDIR
$bw.Write([UInt16]0)               # réservé
$bw.Write([UInt16]1)               # type icône
$bw.Write([UInt16]$images.Count)   # nombre d'images

# ICONDIRENTRY
$offset = 6 + 16 * $images.Count
foreach ($img in $images) {
    $dim = if ($img.size -ge 256) { 0 } else { $img.size }
    $bw.Write([Byte]$dim)              # largeur (0 = 256)
    $bw.Write([Byte]$dim)              # hauteur
    $bw.Write([Byte]0)                 # palette
    $bw.Write([Byte]0)                 # réservé
    $bw.Write([UInt16]1)               # plans
    $bw.Write([UInt16]32)              # bits/pixel
    $bw.Write([UInt32]$img.bytes.Length)
    $bw.Write([UInt32]$offset)
    $offset += $img.bytes.Length
}
foreach ($img in $images) { $bw.Write([byte[]]$img.bytes) }

$bw.Close(); $fs.Close()

Write-Host "OK : icon.png (512), tray.png (32), icon.ico ($($sizes -join ', '))"
