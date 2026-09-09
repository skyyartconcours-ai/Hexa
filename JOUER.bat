@echo off
setlocal
REM ===================================================================
REM  Spyfall — mise en ligne immediate, sans compte ni serveur a payer.
REM  Double-cliquez ce fichier. Il lance le jeu sur ce PC et ouvre un
REM  tunnel public HTTPS : vos amis se connectent depuis leur telephone,
REM  ou qu'ils soient. Fermez la fenetre pour tout arreter.
REM ===================================================================
cd /d "%~dp0"

set "PORT=3210"
if "%SPYFALL_PASSWORD%"=="" set "SPYFALL_PASSWORD=spy"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] Node.js n'est pas installe. Telechargez-le sur https://nodejs.org
  pause
  exit /b 1
)

REM --- cloudflared : telecharge une seule fois, a cote de ce script ---
if not exist "%~dp0cloudflared.exe" (
  echo Telechargement de cloudflared ^(une seule fois, ~20 Mo^)...
  powershell -NoProfile -Command ^
    "$ErrorActionPreference='Stop'; Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%~dp0cloudflared.exe'"
  if errorlevel 1 (
    echo [ERREUR] Telechargement impossible. Verifiez votre connexion.
    pause
    exit /b 1
  )
)

REM TRUST_PROXY=1 : le rate-limit du mot de passe lit la vraie IP transmise par
REM le tunnel, au lieu de voir tous les joueurs comme un seul visiteur.
REM Avec TRUST_PROXY=1 le serveur n'ecoute que sur 127.0.0.1 : rien n'est
REM expose sur votre reseau local, seul le tunnel donne acces au jeu.
set "TRUST_PROXY=1"

echo.
echo === Demarrage du jeu (mot de passe : %SPYFALL_PASSWORD%) ===
start "Spyfall - serveur" /min cmd /c "node server.js"

REM Laisse le serveur se lever avant d'ouvrir le tunnel.
timeout /t 3 /nobreak >nul

echo.
echo ============================================================
echo   L'adresse a partager s'affiche ci-dessous, sur la ligne
echo   qui se termine par .trycloudflare.com
echo   Mot de passe du jeu : %SPYFALL_PASSWORD%
echo ============================================================
echo.
"%~dp0cloudflared.exe" tunnel --url http://localhost:%PORT%

echo.
echo Tunnel arrete. Fermeture du serveur...
taskkill /fi "WINDOWTITLE eq Spyfall - serveur*" /f >nul 2>&1
pause
