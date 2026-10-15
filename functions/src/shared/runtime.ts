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
