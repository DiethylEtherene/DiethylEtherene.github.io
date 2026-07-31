$ErrorActionPreference = "Stop"

$siteRoot = [System.IO.Path]::GetFullPath(
  (Join-Path $PSScriptRoot "..\site")
)

function Assert-SiteCondition {
  param(
    [Parameter(Mandatory)]
    [bool] $Condition,

    [Parameter(Mandatory)]
    [string] $Message
  )

  if (-not $Condition) {
    throw $Message
  }
}

function Read-StrictUtf8 {
  param(
    [Parameter(Mandatory)]
    [string] $Path
  )

  $utf8 = [System.Text.UTF8Encoding]::new($false, $true)
  return $utf8.GetString([System.IO.File]::ReadAllBytes($Path))
}

$requiredFiles = @(
  "index.html",
  "files/ascii-portrait-renderer.js",
  "files/ascii-portrait-data.js",
  "files/nautical-creature-data.js",
  "files/three.module.min.js",
  "files/three.core.min.js",
  "files/STLLoader.js",
  "files/asu-desk-tidy.stl",
  "files/playlist-player.js",
  "files/audio/track-01.mp3",
  "files/audio/track-02.mp3",
  "files/audio/track-03.mp3"
)

foreach ($relativePath in $requiredFiles) {
  $fullPath = Join-Path $siteRoot $relativePath
  Assert-SiteCondition (Test-Path -LiteralPath $fullPath -PathType Leaf) "Missing site asset: $relativePath"
}

$index = Read-StrictUtf8 (Join-Path $siteRoot "index.html")
$playlistModule = Read-StrictUtf8 (Join-Path $siteRoot "files/playlist-player.js")

Assert-SiteCondition ($index.StartsWith("<!doctype html>")) "index.html must start with an HTML5 doctype."
Assert-SiteCondition ($index.Contains('<meta charset="utf-8">')) "index.html must declare UTF-8 before rendering interface text."
Assert-SiteCondition ($index.Contains('<meta name="viewport" content="width=device-width, initial-scale=1">')) "index.html must include a mobile viewport."
$expectedTitle = "<title>Asteria Wang $([char]0x2014) Design Engineering</title>"
Assert-SiteCondition ($index.Contains($expectedTitle)) "index.html must include the public-facing page title."

# Desk-tidy model and ASCII artwork are loaded as ES modules from ./files.
foreach ($requiredMarkup in @(
  'import("./files/ascii-portrait-renderer.js")',
  'import("./files/three.module.min.js")',
  'import("./files/STLLoader.js")',
  './files/asu-desk-tidy.stl',
  'aria-live="polite"'
)) {
  Assert-SiteCondition ($index.Contains($requiredMarkup)) "index.html is missing required markup: $requiredMarkup"
}
# playlist-player.js is imported with an optional cache-busting ?v= suffix.
Assert-SiteCondition ($index -match [regex]::Escape('import("./files/playlist-player.js') + '(\?v=\d+)?"\)') "index.html must import playlist-player.js."

# Hidden-signal player accessibility: closed front exposed, closed back inert.
$frontPattern = '(?is)<button\b(?=[^>]*\btype\s*=\s*"button")(?=[^>]*\bclass\s*=\s*"[^"]*\bmusic-front\b[^"]*")(?=[^>]*\baria-label\s*=\s*"Reveal hidden playlist")[^>]*>'
Assert-SiteCondition ($index -match $frontPattern) "The closed player front must be a labeled button."

$backPattern = '(?is)<section\b(?=[^>]*\bclass\s*=\s*"[^"]*\bmusic-back\b[^"]*")(?=[^>]*\baria-label\s*=\s*"Hidden signal playlist")(?=[^>]*\sinert(?=\s|=|>))(?=[^>]*\baria-hidden\s*=\s*"true")[^>]*>'
Assert-SiteCondition ($index -match $backPattern) "The closed player back must be inert and hidden from assistive technology."

foreach ($controlSpec in @(
  @{ Class = "track-prev"; Label = "Previous track" },
  @{ Class = "play-toggle"; Label = "Play" },
  @{ Class = "track-next"; Label = "Next track" }
)) {
  $controlPattern = '(?is)<button\b(?=[^>]*\btype\s*=\s*"button")(?=[^>]*\bclass\s*=\s*"[^"]*\b' + $controlSpec.Class + '\b[^"]*")(?=[^>]*\baria-label\s*=\s*"' + [regex]::Escape($controlSpec.Label) + '")[^>]*>.*?</button>'
  Assert-SiteCondition ($index -match $controlPattern) "The $($controlSpec.Class) playlist control must be a labeled button."
}

$audioPattern = '(?is)<audio\b(?=[^>]*\bclass\s*=\s*"[^"]*\bplaylist-audio\b[^"]*")(?=[^>]*\bpreload\s*=\s*"metadata")(?=[^>]*\shidden(?=\s|=|>))[^>]*>\s*</audio>'
Assert-SiteCondition ($index -match $audioPattern) "The playlist audio element must be hidden and preload metadata."

foreach ($track in @(
  '{ title: "Track 01", artist: "Ether", src: "./files/audio/track-01.mp3" }',
  '{ title: "Track 02", artist: "Ether", src: "./files/audio/track-02.mp3" }',
  '{ title: "Track 03", artist: "Ether", src: "./files/audio/track-03.mp3" }'
)) {
  Assert-SiteCondition ($index.Contains($track)) "index.html is missing the exact playlist record: $track"
}
Assert-SiteCondition ([regex]::Matches($index, 'artist: "Ether"').Count -eq 3) "The playlist must contain exactly three Ether artist records."

Assert-SiteCondition ($playlistModule.Contains("export function createPlaylistPlayer")) "playlist-player.js must export createPlaylistPlayer."

foreach ($audioSpec in @(
  @{ File = "track-01.mp3"; Length = 2882504; Hash = "793EF78631C44F3DCAE95B05DD0D8E91EAFB44C548DA4839BBD60FA8C95FB082" },
  @{ File = "track-02.mp3"; Length = 3717871; Hash = "404D9F6D7A92E18E339F862FB74068BB43E3F764191483C32ECD42FDAF4149AF" },
  @{ File = "track-03.mp3"; Length = 2761837; Hash = "84300AB0F8FD03CCF631CBA2287E5AB78D3EFD04757074DBC032B5066A7292D8" }
)) {
  $audioFile = $audioSpec.File
  $audioPath = Join-Path $siteRoot ("files/audio/" + $audioFile)
  $audioBytes = [System.IO.File]::ReadAllBytes($audioPath)
  Assert-SiteCondition ($audioBytes.Length -gt 100000) "$audioFile is unexpectedly small."
  Assert-SiteCondition ($audioBytes.Length -eq $audioSpec.Length) "$audioFile has an unexpected byte length."
  $header = [System.Text.Encoding]::ASCII.GetString($audioBytes, 0, 3)
  Assert-SiteCondition ($header -eq "ID3") "$audioFile must begin with an ID3 header."
  $actualHash = (Get-FileHash -LiteralPath $audioPath -Algorithm SHA256).Hash
  Assert-SiteCondition ($actualHash -eq $audioSpec.Hash) "$audioFile has an unexpected SHA-256 hash."
}

Write-Host "PASS: portfolio site structure, playlist assets, and production shell verified."
