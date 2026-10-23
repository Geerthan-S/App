module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    // firebase-admin 14 depends on jose, which ships ES modules only. Node 22 loads
    // it natively in production; Jest's CommonJS runtime needs it transpiled.
    '^.+/node_modules/jose/.+\\.js$': ['ts-jest', { tsconfig: { allowJs: true, module: 'commonjs' }, diagnostics: false }],
  },
  transformIgnorePatterns: ['/node_modules/(?!jose/)'],
};
