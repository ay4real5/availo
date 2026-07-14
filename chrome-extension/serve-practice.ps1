# Zero-install practice server for Availo.
#
# Serves the fake DVSA pages in .\dev-fixture on http://localhost:5555 so you can try
# the extension's Practice run on any Windows laptop - no Python, no Node, no admin,
# no installs. Every Windows PC already has PowerShell.
#
# Run it by double-clicking start-practice.cmd, or from a terminal:
#   powershell -ExecutionPolicy Bypass -File serve-practice.ps1
# Leave the window open while you test; close it when done.

$ErrorActionPreference = "Stop"
$port = 5555
$root = Join-Path $PSScriptRoot "dev-fixture"

if (-not (Test-Path $root)) {
  Write-Host "Could not find $root - run this from the chrome-extension folder." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

$types = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".png"  = "image/png"
  ".svg"  = "image/svg+xml"
  ".ico"  = "image/x-icon"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
try {
  $listener.Start()
} catch {
  Write-Host "Could not start on port $port. Close any other practice window and retry." -ForegroundColor Red
  Write-Host $_.Exception.Message
  Read-Host "Press Enter to close"
  exit 1
}

Write-Host ""
Write-Host "  Availo practice site is running." -ForegroundColor Green
Write-Host "  Keep this window OPEN while you test."
Write-Host "  In Chrome, click the Availo icon, then Practice run (safe rehearsal)."
Write-Host ("  Direct link if you need it: http://localhost:{0}/login.html" -f $port)
Write-Host "  Close this window when you are finished."
Write-Host ""

while ($listener.IsListening) {
  try {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    $rel = $request.Url.LocalPath.TrimStart("/")
    if ([string]::IsNullOrEmpty($rel)) { $rel = "login.html" }

    $full = Join-Path $root $rel
    $fullResolved = [System.IO.Path]::GetFullPath($full)
    $rootResolved = [System.IO.Path]::GetFullPath($root)

    if ($fullResolved.StartsWith($rootResolved) -and (Test-Path $fullResolved -PathType Leaf)) {
      $bytes = [System.IO.File]::ReadAllBytes($fullResolved)
      $ext = [System.IO.Path]::GetExtension($fullResolved).ToLower()
      if ($types.ContainsKey($ext)) { $response.ContentType = $types[$ext] }
      $response.StatusCode = 200
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
      Write-Host ("  served /{0}" -f $rel)
    } else {
      $response.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes("Not found: /$rel")
      $response.OutputStream.Write($msg, 0, $msg.Length)
    }
    $response.OutputStream.Close()
  } catch {
    # ignore one bad connection and keep serving
  }
}
