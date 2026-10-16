@echo off
cd /d "%~dp0"
set "PUB_CACHE=A:\DevTools\pub-cache"
set "GRADLE_USER_HOME=A:\DevTools\gradle"
set "ANDROID_HOME=A:\DevTools\Android\Sdk"
set "ANDROID_AVD_HOME=A:\DevTools\Android\avd"
if not exist "A:\DevTools\tmp" mkdir "A:\DevTools\tmp"
set "TEMP=A:\DevTools\tmp"
set "TMP=A:\DevTools\tmp"
set "JAVA_TOOL_OPTIONS=%JAVA_TOOL_OPTIONS% -Djava.io.tmpdir=A:/DevTools/tmp"
call "C:\src\flutter\bin\flutter.bat" run -d emulator-5554 --dart-define=LOCAL_TEST_LOGIN=true
pause
