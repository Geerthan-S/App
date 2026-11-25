@echo off
cd /d "%~dp0"
set "JAVA_HOME=A:\Android Studio\jbr"
set "PATH=%JAVA_HOME%\bin;%PATH%"
call firebase emulators:start --only auth,firestore,storage --project demo-healthforce
pause
