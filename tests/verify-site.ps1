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
  "files/responsive-layout.css",
  "files/desktop-composition-v2.html",
  "files/ascii-portrait-renderer.js",
  "files/ascii-portrait-data.js",
  "files/nautical-creature-data.js",
  "files/three.module.min.js",
  "files/three.core.min.js",
  "files/STLLoader.js",
  "files/asu-desk-tidy.stl",
  "files/playlist-player.js",
  "files/audio/track-01.mp3",
  "files/audio/track-02.mp3"
)

foreach ($relativePath in $requiredFiles) {
  $fullPath = Join-Path $siteRoot $relativePath
  Assert-SiteCondition (Test-Path -LiteralPath $fullPath -PathType Leaf) "Missing site asset: $relativePath"
}

$index = Read-StrictUtf8 (Join-Path $siteRoot "index.html")
$responsiveCss = Read-StrictUtf8 (Join-Path $siteRoot "files/responsive-layout.css")
$composition = Read-StrictUtf8 (Join-Path $siteRoot "files/desktop-composition-v2.html")
$playlistModule = Read-StrictUtf8 (Join-Path $siteRoot "files/playlist-player.js")

Assert-SiteCondition ($index.StartsWith("<!doctype html>")) "index.html must start with an HTML5 doctype."
Assert-SiteCondition ($index.Contains('<meta charset="utf-8">')) "index.html must declare UTF-8 before rendering interface text."
Assert-SiteCondition ($index.Contains('<meta name="viewport" content="width=device-width, initial-scale=1">')) "index.html must include a mobile viewport."
Assert-SiteCondition ($index.Contains('<link rel="stylesheet" href="/files/responsive-layout.css">')) "index.html must link the responsive layout stylesheet."
Assert-SiteCondition ($responsiveCss -match 'grid-template-areas:\s*"intro artifact folders"') "responsive-layout.css must define the desktop grid areas."
Assert-SiteCondition ($responsiveCss -match '@media\s*\(max-width:\s*1023px\)') "responsive-layout.css must define the tablet flow breakpoint."
Assert-SiteCondition ($responsiveCss -match '@media\s*\(max-width:\s*479px\)') "responsive-layout.css must define the phone flow breakpoint."
Assert-SiteCondition (-not ($index -match '(?is)\.music-player-open\s+\.intro-column\s*\{[^}]*\btransform\s*:\s*[^;}]*translateY\s*\(')) "The playlist-open state must not translate the intro column."
$expectedTitle = "<title>Asteria $([char]0x2014) Portfolio</title>"
Assert-SiteCondition ($index.Contains($expectedTitle)) "index.html must include the public-facing page title."
Assert-SiteCondition (-not $composition.Contains("Homepage composition:")) "The public page must not render the internal prototype heading."
Assert-SiteCondition (-not $composition.Contains('<p class="subtitle">')) "The public page must not render prototype explanatory copy."

foreach ($requiredMarkup in @(
  'aria-live="polite"',
  'await import("/files/playlist-player.js")'
)) {
  Assert-SiteCondition ($index.Contains($requiredMarkup)) "index.html is missing playlist markup: $requiredMarkup"
}

$frontPattern = '(?is)<button\b(?=[^>]*\btype\s*=\s*"button")(?=[^>]*\bclass\s*=\s*"[^"]*\bmusic-face\b[^"]*")(?=[^>]*\bclass\s*=\s*"[^"]*\bmusic-front\b[^"]*")(?=[^>]*\baria-label\s*=\s*"Reveal hidden playlist")(?=[^>]*\baria-hidden\s*=\s*"false")[^>]*>'
Assert-SiteCondition ($index -match $frontPattern) "The closed player front must be exposed to assistive technology."

$backPattern = '(?is)<section\b(?=[^>]*\bclass\s*=\s*"[^"]*\bmusic-face\b[^"]*")(?=[^>]*\bclass\s*=\s*"[^"]*\bmusic-back\b[^"]*")(?=[^>]*\baria-label\s*=\s*"Hidden signal playlist")(?=[^>]*\sinert(?=\s|=|>))(?=[^>]*\baria-hidden\s*=\s*"true")[^>]*>'
Assert-SiteCondition ($index -match $backPattern) "The closed player back must be inert and hidden from assistive technology."

foreach ($controlSpec in @(
  @{ Class = "track-prev"; Label = "Previous track" },
  @{ Class = "play-toggle"; Label = "Play Track 01" },
  @{ Class = "track-next"; Label = "Next track" }
)) {
  $controlPattern = '(?is)<button\b(?=[^>]*\btype\s*=\s*"button")(?=[^>]*\bclass\s*=\s*"[^"]*\b' + $controlSpec.Class + '\b[^"]*")(?=[^>]*\baria-label\s*=\s*"' + [regex]::Escape($controlSpec.Label) + '")[^>]*>.*?</button>'
  Assert-SiteCondition ($index -match $controlPattern) "The $($controlSpec.Class) playlist control must be a labeled button."
}

$audioPattern = '(?is)<audio\b(?=[^>]*\bclass\s*=\s*"[^"]*\bplaylist-audio\b[^"]*")(?=[^>]*\bpreload\s*=\s*"metadata")(?=[^>]*\shidden(?=\s|=|>))[^>]*>\s*</audio>'
Assert-SiteCondition ($index -match $audioPattern) "The playlist audio element must be hidden and preload metadata."

foreach ($track in @(
  '{ title: "Track 01", artist: "Ether", src: "/files/audio/track-01.mp3" }',
  '{ title: "Track 02", artist: "Ether", src: "/files/audio/track-02.mp3" }'
)) {
  Assert-SiteCondition ($index.Contains($track)) "index.html is missing the exact playlist record: $track"
}
Assert-SiteCondition ([regex]::Matches($index, 'artist: "Ether"').Count -eq 2) "The playlist must contain exactly two Ether artist records."

Assert-SiteCondition ($playlistModule.Contains("export function createPlaylistPlayer")) "playlist-player.js must export createPlaylistPlayer."

foreach ($forbiddenMarkup in @("YOUR SONG", "03:24", "finalFakeProgress")) {
  Assert-SiteCondition (-not $index.Contains($forbiddenMarkup)) "index.html contains stale fake-player content: $forbiddenMarkup"
}
$placeholderLinkPattern = '(?is)<a\b(?=[^>]*\bhref\s*=\s*"#")(?=[^>]*\bonclick\s*=\s*"[^"]*event\.preventDefault\(\)[^"]*")[^>]*>\s*Open\b.*?</a>'
Assert-SiteCondition (-not ($index -match $placeholderLinkPattern)) "index.html contains the obsolete placeholder Open link."

foreach ($audioSpec in @(
  @{ File = "track-01.mp3"; Length = 2882504; Hash = "793EF78631C44F3DCAE95B05DD0D8E91EAFB44C548DA4839BBD60FA8C95FB082" },
  @{ File = "track-02.mp3"; Length = 3717871; Hash = "404D9F6D7A92E18E339F862FB74068BB43E3F764191483C32ECD42FDAF4149AF" }
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
