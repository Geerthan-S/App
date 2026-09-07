# Local Development & Emulator Runbook

## 1. Prerequisites
- **Node.js**: v20.x or v22.x LTS
- **Java Runtime**: JRE 11+ or 17+ (for Firebase Local Emulator Suite)
- **Flutter SDK**: 3.22.x+ (with Dart 3.4+)
- **Firebase CLI**: `firebase-tools` (`npm install -g firebase-tools` or `npx firebase-tools`)

---

## 2. Starting the Firebase Local Emulator Suite

The emulator suite runs Auth, Firestore, Functions, Storage, and Hosting locally without connecting to production:

```powershell
# From project root
npx firebase-tools emulators:start --only auth,firestore,functions,storage,hosting
```

### Emulator Ports:
- **Emulator UI:** `http://localhost:4000`
- **Authentication:** `http://localhost:9099`
- **Cloud Firestore:** `http://localhost:8080`
- **Cloud Functions:** `http://localhost:5001`
- **Cloud Storage:** `http://localhost:9199`
- **Admin Hosting:** `http://localhost:5000`

---

## 3. Connecting the Flutter Client to Local Emulators

In `lib/main.dart`, pass `--dart-define=USE_FIREBASE_EMULATOR=true` to automatically point the client to local emulator ports:

```powershell
flutter run -d android --dart-define=USE_FIREBASE_EMULATOR=true
```

---

## 4. Seeding Synthetic Test Data

To populate the local emulator with realistic synthetic doctors, verified hospitals, facilities, and published duties:

```powershell
npm --prefix functions run seed
```
