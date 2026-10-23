/** The Functions emulator runs local development only; production checks that need console setup are relaxed there. */
export const isEmulator = (): boolean => process.env.FUNCTIONS_EMULATOR === 'true';

/**
 * Enforcement switches, read from the per-project env file (functions/.env.<projectId>).
 * Both default to ON: they are only turned off, explicitly, while the console
 * setup they depend on is pending (docs/runbooks/admin-v2-security-setup.md).
 */
const enabled = (name: string): boolean => process.env[name] !== 'false';

/** Staff callables require a TOTP second factor. Needs Identity Platform with TOTP enabled. */
export const staffMfaRequired = (): boolean => !isEmulator() && enabled('REQUIRE_STAFF_MFA');

/** App callables require an App Check token. Needs the Android app registered with Play Integrity. */
export const appCheckEnforced = (): boolean => !isEmulator() && enabled('ENFORCE_APP_CHECK');

/**
 * Approval requires uploaded, malware-scanned evidence. Turned off only for the
 * client-review testing period (no scanner is provisioned yet): approvals then
 * rest on the recorded official-registry check alone, and both the app and the
 * admin portal show a "Testing mode" notice. Turn back on after the review.
 */
export const verificationEvidenceRequired = (): boolean => enabled('REQUIRE_VERIFICATION_EVIDENCE');

/** Shown to users and staff whenever a production safeguard is relaxed for testing. */
export const testingModeNotice = (): string | null => (verificationEvidenceRequired()
  ? null
  : 'Testing mode: licence and certificate uploads are optional while the client review is running. Approval relies on the admin\'s official-registry check.');
