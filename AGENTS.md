# Agent Operating Guidelines & Rules

All AI agents, subagents, and automated developer tools operating within this repository MUST adhere to the following protocol.

---

## 1. Primary Directives

1. **Read `CONSTITUTION.md` First**: Before making any architectural modifications, reading or writing code, or running build commands, review [CONSTITUTION.md](file:///a:/Doctor_Workforce/CONSTITUTION.md).
2. **Review `IMPLEMENTATION_STATUS.md`**: Check the current status of all milestones and features in [IMPLEMENTATION_STATUS.md](file:///a:/Doctor_Workforce/IMPLEMENTATION_STATUS.md) before implementing changes. Update this file as milestones and features are completed and tested.
3. **Preserve Architectural Invariants**:
   - Backend: Cloud Firestore, Firebase Authentication, Cloud Functions v2 (TypeScript), Cloud Storage, FCM, Remote Config.
   - Client: Flutter Android (`com.geerthan.healthcareworkforce`) with Riverpod state management and Clean Architecture.
   - Admin: Modular browser-based admin portal with Firebase Auth and custom claims.
   - Security: Deny-by-default Firestore and Storage security rules. Zero public download URLs for private verification evidence.
   - Concurrency: Contested writes (selection, double-booking prevention) execute strictly inside server-side Firestore transactions.
4. **Follow the 104-Page Blueprint**: Use `Healthcare_Workforce_Platform_Phase1_Phase2_Developer_Architecture_v1.0.pdf` as the authoritative functional and domain specification.
5. **No Fake Behavior**: If an external configuration (e.g. Firebase Console Phone Auth setup or Play Integrity) is not yet configured, record it as `BLOCKED_EXTERNAL` and implement robust architectural stubs and error handlers with documented instructions.

---

## 2. Code Conventions

- **Languages & Frameworks**:
  - Flutter / Dart for Android mobile client.
  - TypeScript (strict mode) for Cloud Functions.
  - ES Modules & Vanilla CSS for the Admin Web Portal.
- **Naming Standard**:
  - Use **`camelCase`** for all Firestore document fields, Cloud Function request/response payloads, and Dart model properties.
  - Use **`SCREAMING_SNAKE_CASE`** for canonical enums and constants (e.g. `DutyStatus.inProgress`, serialized as `'in_progress'`).
- **File Hierarchy**: Follow clean domain separation: `core/`, `features/`, `functions/src/`, `admin/`, `docs/`, `test/`.
