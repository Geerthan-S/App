@echo off
title Android Emulator - Pixel API 34
echo ====================================================
echo Starting Android Virtual Device (Pixel API 34)...
echo Rendering with SwiftShader (fixes white screen / GPU glitch).
echo A resizable, movable phone window will appear.
echo ====================================================
"C:\Android\Sdk\emulator\emulator.exe" -avd Pixel_API_34 -gpu swiftshader_indirect
pause
