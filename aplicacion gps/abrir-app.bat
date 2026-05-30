@echo off
cd /d "%~dp0"
echo Iniciando GPS Agricola...
echo.
start "" http://127.0.0.1:5173/index.html
"C:\Users\cuent\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -m http.server 5173 --bind 0.0.0.0
echo.
echo El servidor se cerro. Presiona una tecla para salir.
pause > nul
