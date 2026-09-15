@echo off
title Run Healthcare Workforce App
cd /d "C:\Users\Shaalini S\Desktop\App"
echo ====================================================
echo Connecting to Android Emulator...
echo ====================================================
"C:\Android\Sdk\platform-tools\adb.exe" wait-for-device
echo Device connected! Launching app on emulator...
"C:\src\flutter\bin\flutter.bat" run -d android
pause
