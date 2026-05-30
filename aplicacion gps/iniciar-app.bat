@echo off
cd /d "%~dp0"
echo GPS Agricola disponible en este computador:
echo http://127.0.0.1:5173/index.html
echo.
echo Para abrir desde celular usa la IP WiFi de este PC:
echo http://IP-DE-ESTE-PC:5173/index.html
echo Deja esta ventana abierta mientras uses la app.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& 'C:\Users\cuent\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m http.server 5173 --bind 0.0.0.0"
echo.
echo El servidor se cerro. Presiona una tecla para salir.
pause > nul
