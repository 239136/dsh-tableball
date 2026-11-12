param([string]$Archive)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$zip = [System.IO.Compression.ZipFile]::OpenRead($Archive)
try {
 foreach ($entry in $zip.Entries) {
  if ($entry.FullName.EndsWith('/')) { continue }
  $stream = $entry.Open(); $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try { $digest = ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
  finally { $stream.Dispose(); $algorithm.Dispose() }
  [Console]::WriteLine($entry.FullName + [char]9 + $digest + [char]9 + $entry.Length)
 }
} finally { $zip.Dispose() }
