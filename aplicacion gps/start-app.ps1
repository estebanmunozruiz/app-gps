$python = "C:\Users\cuent\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
Write-Host "GPS Agricola disponible en http://127.0.0.1:5173/index.html"
Write-Host "Desde celular usa http://IP-DE-ESTE-PC:5173/index.html"
Write-Host "Deja esta ventana abierta mientras uses la app."
Write-Host ""
& $python -m http.server 5173 --bind 0.0.0.0
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "No se pudo iniciar el servidor. Presiona una tecla para cerrar."
  $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}
