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
  "files/asu-desk-tidy.stl"
)

foreach ($relativePath in $requiredFiles) {
  $fullPath = Join-Path $siteRoot $relativePath
  Assert-SiteCondition (Test-Path -LiteralPath $fullPath -PathType Leaf) "Missing site asset: $relativePath"
}

$index = Read-StrictUtf8 (Join-Path $siteRoot "index.html")
$composition = Read-StrictUtf8 (Join-Path $siteRoot "files/desktop-composition-v2.html")

Assert-SiteCondition ($index.StartsWith("<!doctype html>")) "index.html must start with an HTML5 doctype."
Assert-SiteCondition ($index.Contains('<meta charset="utf-8">')) "index.html must declare UTF-8 before rendering interface text."
Assert-SiteCondition ($index.Contains('<meta name="viewport" content="width=device-width, initial-scale=1">')) "index.html must include a mobile viewport."
$expectedTitle = "<title>Asteria $([char]0x2014) Portfolio</title>"
Assert-SiteCondition ($index.Contains($expectedTitle)) "index.html must include the public-facing page title."
Assert-SiteCondition (-not $composition.Contains("Homepage composition:")) "The public page must not render the internal prototype heading."
Assert-SiteCondition (-not $composition.Contains('<p class="subtitle">')) "The public page must not render prototype explanatory copy."

Write-Host "PASS: portfolio site structure and production shell verified."
