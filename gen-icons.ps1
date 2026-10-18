# One-off icon generator (not part of the plugin runtime). Produces
# images/icon.png; output is checked in as a normal asset.
Add-Type -AssemblyName System.Drawing

$size = 144
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::FromArgb(255, 30, 45, 70))

$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 90, 160, 240))

# Play triangle + skip-next bar
$tri = @(
    New-Object System.Drawing.Point (40, 36)
    New-Object System.Drawing.Point (96, 72)
    New-Object System.Drawing.Point (40, 108)
)
$g.FillPolygon($brush, $tri)
$g.FillRectangle($brush, 102, 36, 12, 72)

$imagesDir = Join-Path $PSScriptRoot 'com.soomfonmultimedia.sdPlugin\images'
$bmp.Save((Join-Path $imagesDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $brush.Dispose()
Write-Output "Icon written to $imagesDir"
