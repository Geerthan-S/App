# Local test login

Start `start_test_services.bat`, then `run_test_app.bat`. In this debug build,
press **Get Verification OTP** with the number field empty to sign into the
local tester account and open Home. No SMS is sent. Firebase Authentication
actually authenticates the account against the local Auth emulator.

The compile-time `LOCAL_TEST_LOGIN=true` flag is effective only in debug builds.
The debug Android manifest disables native Firebase auto-initialization so
Flutter can choose the demo project before clients start. Debug HTTP access is
limited to localhost, 127.0.0.1, and Android's host bridge 10.0.2.2.
The default build and all release builds retain the normal phone OTP flow.
All Firebase services use `demo-healthforce` and local emulator endpoints in
test mode; there is no fallback to the live project if services are unavailable.
Cloud Functions are intentionally not started by the test service script:
features requiring them report connection failures until they are separately
implemented, reviewed, and run locally. This login does not grant verifier or
administrator claims and does not certify end-to-end backend features.

The local account is disposable and may be recreated after service restart.
Do not put real patient or identity documents into these local tests.
