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
$composition = Read-StrictUtf8 (Join-Path $siteRoot "files/desktop-composition-v2.html")
$playlistModule = Read-StrictUtf8 (Join-Path $siteRoot "files/playlist-player.js")

Assert-SiteCondition ($index.StartsWith("<!doctype html>")) "index.html must start with an HTML5 doctype."
Assert-SiteCondition ($index.Contains('<meta charset="utf-8">')) "index.html must declare UTF-8 before rendering interface text."
Assert-SiteCondition ($index.Contains('<meta name="viewport" content="width=device-width, initial-scale=1">')) "index.html must include a mobile viewport."
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

Assert-SiteCondition ($index.Contains('<button type="button" class="music-face music-front" aria-label="Reveal hidden playlist" aria-hidden="false">')) "The closed player front must be exposed to assistive technology."
Assert-SiteCondition ($index.Contains('<section class="music-face music-back" aria-label="Hidden signal playlist" inert aria-hidden="true">')) "The closed player back must be inert and hidden from assistive technology."

foreach ($controlClass in @("track-prev", "play-toggle", "track-next")) {
  $controlPattern = '<button\s+type="button"\s+class="' + $controlClass + '"[^>]*>.*?</button>'
  Assert-SiteCondition ($index -match $controlPattern) "The $controlClass playlist control must be a button."
}

Assert-SiteCondition ($index -match '<audio\s+class="playlist-audio"\s+preload="metadata"\s+hidden></audio>') "The playlist audio element must be hidden and preload metadata."

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
Assert-SiteCondition (-not ($index -match '<a href="#" onclick="event\.preventDefault\(\)">Open\b')) "index.html contains the obsolete placeholder Open link."

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
