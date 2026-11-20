# Serveur de secours pour Windows, quand Python n'est pas installe.
# Utilise seulement PowerShell (present sur tous les Windows 10/11), sans droits administrateur.
param([int]$Port = 8317, [switch]$NoBrowser)

$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path))
if (-not $root.EndsWith('\')) { $root += '\' }
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript'; '.mjs' = 'text/javascript'
  '.json' = 'application/json'; '.css' = 'text/css'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'
  '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'; '.wasm' = 'application/wasm'
}

# Deja lance ? On ouvre juste le jeu.
try {
  $page = (New-Object System.Net.WebClient).DownloadString("http://127.0.0.1:$Port/index.html")
  if ($page -match 'AIR GAME') {
    if (-not $NoBrowser) { Start-Process "http://localhost:$Port/" }
    exit 0
  }
} catch { }

$listener = $null
for ($p = $Port; $p -lt $Port + 20; $p++) {
  try {
    $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $p)
    $l.ExclusiveAddressUse = $true
    $l.Start()
    $listener = $l; $Port = $p; break
  } catch { }
}
if (-not $listener) { Write-Host "Aucun port libre trouve."; exit 1 }

$url = "http://localhost:$Port/"
Write-Host "Air Game tourne sur $url"
Write-Host "Laisse cette fenetre ouverte pendant que tu joues (ferme-la pour arreter)."
if (-not $NoBrowser) { Start-Process $url }

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $client.ReceiveTimeout = 3000
    $client.SendTimeout = 5000
    $stream = $client.GetStream()
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 8192, $true)
    $line = $reader.ReadLine()
    while ($true) { $h = $reader.ReadLine(); if ([string]::IsNullOrEmpty($h)) { break } }
    if ($line -and $line -match '^(GET|HEAD) (\S+)') {
      $method = $Matches[1]
      $path = [Uri]::UnescapeDataString(($Matches[2] -split '\?')[0])
      if ($path.EndsWith('/')) { $path += 'index.html' }
      $rel = $path.TrimStart('/').Replace('/', '\')
      $full = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($root, $rel))
      if ($full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and [System.IO.File]::Exists($full)) {
        $body = [System.IO.File]::ReadAllBytes($full)
        $type = $types[[System.IO.Path]::GetExtension($full).ToLower()]
        if (-not $type) { $type = 'application/octet-stream' }
        $status = '200 OK'
      } else {
        $body = [System.Text.Encoding]::ASCII.GetBytes('Introuvable')
        $type = 'text/plain'; $status = '404 Not Found'
      }
      $head = "HTTP/1.1 $status`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
      $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
      $stream.Write($hb, 0, $hb.Length)
      if ($method -eq 'GET') { $stream.Write($body, 0, $body.Length) }
      $stream.Flush()
    }
  } catch { } finally { $client.Close() }
}
