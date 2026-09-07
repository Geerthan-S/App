# Healthcare Workforce Platform (Flutter Android + Firebase)

A secure, verified, and auditable healthcare workforce marketplace connecting verified doctors with verified hospitals and clinics.

**Android Package:** `com.geerthan.healthcareworkforce`  
**Firebase Project ID:** `doctor-c7c29`  
**Authoritative Blueprint:** `Healthcare_Workforce_Platform_Phase1_Phase2_Developer_Architecture_v1.0.pdf`

---

## Architecture Summary
- **Mobile Client:** Flutter Android (Riverpod, Clean Architecture, GoRouter, Firebase SDK).
- **Backend Services:** Cloud Functions v2 (TypeScript), Cloud Firestore, Cloud Storage, Firebase Cloud Messaging, Firebase App Check, Remote Config.
- **Admin Portal:** Modular, responsive Browser Web Portal with Firebase Auth and custom claims.
- **Security & Integrity:** Deny-by-default Security Rules, atomic selection transactions, date-scoped double-booking protection, leased transactional notification outbox, and step-up admin MFA.

---

## Quick Start Guide

### 1. Local Firebase Emulator Suite
```powershell
# Run local emulators for Auth, Firestore, Functions, Storage, and Hosting
npx firebase-tools emulators:start
```

### 2. Run Cloud Functions Tests
```powershell
cd functions
npm install
npm test
```

### 3. Run Flutter Android Client
```powershell
flutter pub get
flutter run -d android --dart-define=USE_FIREBASE_EMULATOR=true
```

---

## Governance & Architecture Documentation
- [CONSTITUTION.md](file:///a:/Doctor_Workforce/CONSTITUTION.md): Non-negotiable engineering laws.
- [AGENTS.md](file:///a:/Doctor_Workforce/AGENTS.md): Agent guidelines.
- [IMPLEMENTATION_STATUS.md](file:///a:/Doctor_Workforce/IMPLEMENTATION_STATUS.md): Milestone progress tracker.
- [ADR-001](file:///a:/Doctor_Workforce/docs/adr/001-firebase-migration-and-concurrency.md): Firebase migration & concurrency strategy.
- [State Machines](file:///a:/Doctor_Workforce/docs/architecture/state-machines.md): Detailed lifecycle state machines.
- [Firestore Model](file:///a:/Doctor_Workforce/docs/architecture/firestore-model.md): Schema & dictionary.
- [Security Threat Model](file:///a:/Doctor_Workforce/docs/security/threat-model.md): Attack vectors & defenses.
- [Firestore Rules Matrix](file:///a:/Doctor_Workforce/docs/security/firebase-rule-matrix.md): Access control matrix.
