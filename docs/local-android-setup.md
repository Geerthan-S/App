# Local Android development setup

Project: A:\App
Remote: https://github.com/Geerthan-S/App
Active branch: feature/error-pages-and-connectivity-v2 (4aa972d)
All fetched commits from main and feature/ui-redesign-and-verification-updates are already ancestors of this branch. No remote changes were pushed.

## Tool paths

- Android Studio: A:\Android Studio\bin\studio64.exe
- Android SDK: A:\DevTools\Android\Sdk
- Android virtual devices: A:\DevTools\Android\avd
- Flutter and Dart IDE plugins: A:\DevTools\AndroidStudioPlugins
- Android Studio cache and logs: A:\DevTools\AndroidStudioSystem and A:\DevTools\AndroidStudioLogs
- Dart packages: A:\DevTools\pub-cache
- Gradle cache: A:\DevTools\gradle
- Build temporary files: A:\DevTools\tmp (launch scripts set TEMP, TMP, and Java temp)
- Existing Flutter SDK reused: C:\src\flutter
- Existing Java 17 used for Gradle: C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot

User environment variables ANDROID_HOME, ANDROID_AVD_HOME, PUB_CACHE, and GRADLE_USER_HOME point to these A: locations. Existing C: SDK and caches were preserved.

When building from a new PowerShell shell, set `GRADLE_USER_HOME=A:\DevTools\gradle`, `PUB_CACHE=A:\DevTools\pub-cache`, `ANDROID_HOME=A:\DevTools\Android\Sdk`, `TEMP`/`TMP=A:\DevTools\tmp`, and `JAVA_TOOL_OPTIONS=-Djava.io.tmpdir=A:/DevTools/tmp` for that process. The host C: drive was full on 2026-10-02; a build that inherited the C: Gradle or npm cache failed with `ENOSPC`. The A: build subsequently succeeded. Use `npm_config_cache=A:\DevTools\npm-cache` for npm commands from a fresh shell.

## Launch

Open A:\App in Android Studio. Select the main.dart Flutter run configuration and the HealthForce_API36 emulator.
Alternatively launch launch_emulator.bat, then run_app.bat.

## Compatibility changes

Updated Gradle to 8.14.1, Android Gradle Plugin to 8.11.1, Kotlin to 2.2.20, google_fonts to the compatible 8.x series, and the Flutter theme data classes. Flutter refreshed its SDK-pinned lockfile dependencies and added its compatibility flags.

## Validation limitations

Static analysis reports no errors, but existing warnings and informational findings remain.
The repository's widget test still expects the Flutter starter counter and does not match HealthForce. Its result does not certify application behavior.
Live Firebase OTP, Play Integrity, and backend workflows must be verified separately with their real external configuration; local setup does not certify them.

## Verified result (2026-10-02)

Final APK built and installed on HealthForce_API36. MainActivity resumed and Firebase initialized. Emulator was updated to stable 37.2.12; its first boot had system ANR dialogs. Full authentication and backend workflows were not tested. The starter test also lacks Firebase initialization. Static analysis: 14 warnings, 162 informational findings, zero errors.


Emulator restart is configured with 4 GB RAM, four cores, and explicit DNS (8.8.8.8 and 1.1.1.1). DNS lookup and ping of fonts.gstatic.com succeeded after restart. System UI ANR dialogs were still seen during reboot; emulator stability remains unverified.


Android Studio's toolbar target is selected as HealthForce API36 (mobile). The main.dart Run button was invoked for this device.


Final Android Studio Run completed successfully. Its console confirms Firebase initialization, and the debug session exposes hot reload controls. HealthForce sign-in screen is visible. No repository changes were pushed.
