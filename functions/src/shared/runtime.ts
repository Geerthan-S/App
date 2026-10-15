/** The Functions emulator runs local development only; production checks that need console setup are relaxed there. */
export const isEmulator = (): boolean => process.env.FUNCTIONS_EMULATOR === 'true';
