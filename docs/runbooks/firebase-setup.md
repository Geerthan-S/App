# Firebase Project Setup & Console Configuration

## 1. Firebase Project Details
- **Project ID:** `doctor-c7c29`
- **Android Package:** `com.geerthan.healthcareworkforce`
- **Config File:** `android/app/google-services.json`

---

## 2. One-Time Firebase Console Steps (For Live Deployment)

### 2.1 Enable Authentication Providers
1. Open [Firebase Console](https://console.firebase.google.com/project/doctor-c7c29/authentication/providers).
2. Under **Sign-in method**, enable **Phone**.
3. Under **Phone numbers for testing**, add test numbers for automated testing (e.g. `+91 99999 11111` with OTP `123456`).

### 2.2 Enable Cloud Firestore
1. Navigate to **Firestore Database** $\rightarrow$ **Create Database**.
2. Select **Production Mode** and your primary region (e.g. `asia-south1` / Mumbai).

### 2.3 Enable Cloud Storage
1. Navigate to **Storage** $\rightarrow$ **Get Started**.
2. Select default bucket: `doctor-c7c29.firebasestorage.app`.

### 2.4 Configure Play Integrity (Android App Check)
1. In Android project settings, add the SHA-256 fingerprint from your keystore.
2. In App Check console, link the Android app to **Play Integrity**.
