@echo off
REM Starts the Auth, Functions and Firestore emulators for load testing under
REM the demo-healthforce project, which never reaches real Firebase services.
REM firebase-tools needs Java 21+; the system default JDK is left untouched.

set "JDK21=C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot"
if exist "%JDK21%\bin\java.exe" (
  set "JAVA_HOME=%JDK21%"
  set "PATH=%JDK21%\bin;%PATH%"
)

cd /d "%~dp0.."
call npm --prefix functions run build || exit /b 1
firebase emulators:start --only auth,functions,firestore --project demo-healthforce
