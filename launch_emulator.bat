@echo off
set "ANDROID_HOME=A:\DevTools\Android\Sdk"
set "ANDROID_AVD_HOME=A:\DevTools\Android\avd"
"A:\DevTools\Android\Sdk\emulator\emulator.exe" -avd HealthForce_API36 -gpu swiftshader_indirect -feature -Vulkan -memory 4096 -cores 4 -dns-server 8.8.8.8,1.1.1.1
pause
