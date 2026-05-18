@echo off
title TABARA COMMUNITY
echo ============================================
echo   TABARA COMMUNITY
echo   Planifica - Organizeaza - Distreaza-te!
echo ============================================
echo Pornesc serverul...
cd /d %~dp0
npm install
node server.js
pause
