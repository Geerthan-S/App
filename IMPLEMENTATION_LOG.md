# Implementation Log

Running record of every change made to this app in this working session, in order. Each entry lists what was built and the exact files created/modified. This file is updated after every task from here on.

---

## 1. Bottom Navigation Shell

**Goal:** Replace the previous 4-tab (Duties/Applications/Shifts/Profile) bottom nav with a 5-tab shell: Home, Search, Add Post, Messages, Profile — pill-shaped, dark theme at the time, with a prominent raised Add Post button.

**What was built:**
- Custom `AppBottomNavBar` widget (floating rounded pill, blue active-item pill, muted gray inactive icons, raised circular Add Post button).
- `go_router` `StatefulShellRoute.indexedStack` restructured to 5 branches: `/home`, `/search`, `/add-post`, `/messages`, `/profile` (profile reused the existing `DoctorProfileScreen`).
- Old duty-marketplace screens (`/marketplace`, `/applications`, `/assignments`) were **not deleted** — moved to standalone top-level routes, still reachable directly, just no longer in the bottom nav.
- Login/onboarding "bypass" redirects repointed from `/marketplace` to `/home` so the new shell is reachable when running the app.

**Files created:**
- `lib/core/navigation/app_bottom_nav_bar.dart`
- `lib/features/home/presentation/home_screen.dart` (placeholder at the time)
- `lib/features/search/presentation/search_screen.dart` (placeholder)
- `lib/features/add_post/presentation/add_post_screen.dart` (placeholder)
- `lib/features/messages/presentation/messages_screen.dart` (placeholder)

**Files modified:**
- `lib/core/navigation/main_scaffold.dart`
- `lib/core/navigation/app_router.dart`
- `lib/features/auth/presentation/login_screen.dart`
- `lib/features/doctor_profile/presentation/doctor_onboarding_screen.dart`

---

## 2. Bottom Navigation Overflow Fix

**Goal:** Fix a `RenderFlex` "RIGHT OVERFLOWED BY 16 PIXELS" error on the active (labelled) nav pill.

**Root cause:** Every nav item sat in an equal-width `Expanded` column; the active item's icon+label `Row` had nothing constraining its width, so it could exceed its column.

**Fix:**
- Reserved a fixed-width slot for the center Add Post button instead of giving it an `Expanded` share.
- Gave the active item more `flex` than inactive items among the remaining columns.
- Wrapped each item's content in `FittedBox(fit: BoxFit.scaleDown)` as a hard guarantee against overflow on any screen width (scales down, never clips).

**Files modified:**
- `lib/core/navigation/app_bottom_nav_bar.dart`

---

## 3. Global Light Theme

**Goal:** Convert the entire app from the dark theme to a clean healthcare light theme (white/light backgrounds, blue accent, charcoal text, muted gray secondary text, subtle borders/shadows) — reusing the light palette that already existed in the design system but was unused.

**What was built:**
- Switched `MaterialApp.router`'s `theme` from `AppTheme.darkTheme` to `AppTheme.lightTheme`.
- Added the missing `dividerTheme` to `AppTheme.lightTheme` for parity with the dark theme.
- Mechanically replaced every hardcoded dark-variant color token (`bgDark`, `surfaceDark`, `surfaceElevatedDark`, `borderDark`, `textDarkPrimary/Secondary/Muted`) with its existing light-variant counterpart across ~26 files — no new colors invented.
- Softened the nav bar's shadow opacity (a dark-theme shadow was too heavy on white).

**Files modified:**
- `lib/main.dart`
- `lib/core/design_system/app_theme.dart`
- `lib/core/navigation/app_bottom_nav_bar.dart`, `lib/core/navigation/main_scaffold.dart`
- `lib/core/design_system/app_buttons.dart`, `app_cards.dart`, `app_inputs.dart`
- `lib/core/widgets/state_views.dart`, `language_selector_dialog.dart`
- All screens under `lib/features/**` that referenced dark tokens (home, search, add_post, messages, auth, doctor_profile, hospital, duty_marketplace, duty_details, applications, assignments, verification, notifications, settings, onboarding)

---

## 4. Home Screen

**Goal:** Build the real Home screen — greeting + recommended duty posts from existing mock data, opening into chat.

**What was built:**
- Greeting header: "Hello, {doctor name}" (no search bar — Search has its own tab).
- "Recommended For You" list of duty cards built from the existing mock duty dataset.
- Extracted the mock duty list out of `DutyMarketplaceScreen`'s private state into a new shared `MockData` class (single source of truth, avoids duplicating the dataset).
- Card tap originally opened Messages directly (later changed in step 8 below).

**Files created:**
- `lib/core/constants/mock_data.dart` (`currentDoctorName`, `duties`)

**Files modified:**
- `lib/features/home/presentation/home_screen.dart` (full rebuild)
- `lib/features/duty_marketplace/presentation/duty_marketplace_screen.dart` (now reads `MockData.duties`)
- `lib/features/doctor_profile/presentation/doctor_profile_screen.dart` (doctor name now reads `MockData.currentDoctorName`)

---

## 5. Search Screen

**Goal:** A real search bar over the same duty data, filtering live as you type.

**What was built:**
- Extracted the duty card UI (previously private to Home) into a shared `DutyPostCard` widget so Home and Search render identical cards without duplicating the UI code.
- Search bar with live filtering across facility/specialty/city/department/qualification, a clear (✕) button, an empty-query "Recommended For You" state, and a "No results found" state (reusing the existing `EmptyStateView`).

**Files created:**
- `lib/core/widgets/duty_post_card.dart`

**Files modified:**
- `lib/features/home/presentation/home_screen.dart` (now uses shared `DutyPostCard`)
- `lib/features/search/presentation/search_screen.dart` (full rebuild)

---

## 6. Add Post Screen

**Goal:** A real form for a doctor to create a new duty/job post, using the existing duty data model.

**What was built:**
- Full form: Hospital/Clinic, Specialty (dropdown), Department, Location (dropdown), Date + Start/End time (native pickers, handles overnight shifts), Compensation, Qualification/Requirements.
- Validation on all required fields.
- On submit: builds a duty map with the exact same keys as the rest of the app and inserts it into the shared mock dataset (`MockData.duties`), shows a success confirmation, and resets the form.
- Changed `MockData.duties` from `const` to `final` so it can be appended to at runtime (no separate backend or duplicate model introduced).

**Files created:**
- `lib/features/add_post/presentation/add_post_screen.dart` (full rebuild from placeholder)

**Files modified:**
- `lib/core/constants/mock_data.dart` (`duties` made mutable)
- `lib/features/home/presentation/home_screen.dart` (trivial `const`→`final` fix required by the above)

---

## 7. Profile Screen

**Goal:** A full doctor profile: avatar, name, professional info, hospital/clinic info, hospital & doctor reviews, settings, logout — using existing data plus clearly-labelled sample data where nothing existed yet.

**What was built:**
- Extended the existing `DoctorProfileScreen` (already wired to the Profile tab) rather than replacing it — kept its header, edit-profile sheet, verification card, bio, specialties, and work hubs untouched.
- Added: a Quick Stats row (Experience / Specialties / Rating), a Profile Strength progress indicator, a Hospital/Clinic card (→ Hospital Info), a Reviews section with Doctor Reviews and Hospital Reviews cards (→ a shared, generic Reviews screen used for both), and an Account section with Settings and Logout tiles.
- Logout reuses the exact same `context.go('/login')` pattern already used by the Settings screen's own sign-out button — no new auth logic.
- Added sample hospital-profile and review data to `MockData` (generic, clearly-placeholder reviewer names like "ICU Nurse Coordinator").

**Files created:**
- `lib/features/doctor_profile/presentation/hospital_info_screen.dart`
- `lib/features/doctor_profile/presentation/reviews_screen.dart` (generic — reused for both doctor and hospital reviews)

**Files modified:**
- `lib/core/constants/mock_data.dart` (`hospitalProfile`, `doctorReviews`, `hospitalReviews`)
- `lib/core/navigation/app_router.dart` (`/hospital-info`, `/reviews` routes)
- `lib/features/doctor_profile/presentation/doctor_profile_screen.dart` (new sections appended)

---

## 8. Home/Search → Duty Details → Chat Flow

**Goal:** Change tapping a recommendation from "straight to chat" into "Home/Search → Duty Details → Chat".

**What was built:**
- New `DutyPostDetailsScreen`: shows every relevant field from the existing duty map (hospital, location, date, start/end time, compensation, description, requirements) with a back button and a primary "Interested / Chat" action.
- Changed `DutyPostCard`'s tap target from going straight to Messages to pushing this new details screen — since Home and Search share this one card widget, both were updated by a single change.
- Left the pre-existing, unrelated hospital-marketplace `DutyDetailsScreen` (a job-application flow) completely untouched — a new screen was built instead of repurposing it, since its "Apply with credential snapshot" flow serves a different actor/purpose.

**Files created:**
- `lib/features/duty_post_details/presentation/duty_post_details_screen.dart`

**Files modified:**
- `lib/core/widgets/duty_post_card.dart` (tap target changed)
- `lib/core/navigation/app_router.dart` (`/post-details` route)

---

## 9. Messages & Chat

**Goal:** Real Messages (conversation list) and Chat screens, wired into both entry points: Duty Details → Chat, and Messages → Conversation → Chat.

**What was built:**
- Added mock conversation + message-thread data to `MockData`: one conversation per seeded duty, including a full realistic negotiation script (opening offer → counter-offer → agreed price) for the Chennai duty, a pending/unread negotiation for the Bengaluru duty (to demo the unread badge), and a simple confirmed booking for the Hyderabad duty.
- Added `MockData.conversationForDuty(duty)`: returns the existing conversation for a duty, or creates a new one on the fly (seeded with an opening message from the hospital) — used when a doctor taps "Interested / Chat" on a post that has no scripted conversation yet (e.g. one they created themselves via Add Post).
- **Messages screen**: real conversation list — avatar, hospital name, last message, timestamp, bold text + numeric badge for unread conversations. Tapping a row opens Chat and refreshes the list on return (so read/last-message state stays current).
- **Chat screen**: header with the hospital's name; a compact pinned card showing the duty being discussed (specialty, shift, timing, compensation); a scrollable message thread with left/right bubbles (gray for hospital, blue for doctor) and per-message timestamps; a bottom input bar with a text field and a circular send button. Sending a message appends it to the shared mock thread locally and auto-scrolls to the bottom. Opening a conversation marks it read (clears its unread badge).
- Updated `DutyPostDetailsScreen`'s "Interested / Chat" button to open this new Chat screen directly (via `MockData.conversationForDuty`) instead of just switching to the Messages tab.
- Added a new top-level `/chat` route (a sibling of the shell, like `/post-details`) so Chat opens as a full-screen view with the bottom nav hidden, consistently whether it's reached from Duty Details or from the Messages list.

**Files created:**
- `lib/features/messages/presentation/chat_screen.dart`

**Files modified:**
- `lib/core/constants/mock_data.dart` (`conversations`, `chatMessages`, `conversationForDuty()`)
- `lib/features/messages/presentation/messages_screen.dart` (full rebuild from placeholder)
- `lib/features/duty_post_details/presentation/duty_post_details_screen.dart` (chat button now opens `/chat`)
- `lib/core/navigation/app_router.dart` (`/chat` route)

---

## 10. Doctor-Initiated Conversation Example

**Goal:** All 3 seeded conversations started with the hospital's message — add an example where the doctor messages a hospital first.

**What was built:**
- Added a 4th mock duty (`CarePlus Multispecialty Clinic`, Pune, Anesthesiology) to `MockData.duties` and a matching conversation/message thread to `MockData.conversations` / `chatMessages`, scripted so the **doctor's** message is first, followed by the hospital's reply and a short negotiation ending in a confirmed booking — mirroring the structure of the existing scripts but with the roles/order reversed.

**Files modified:**
- `lib/core/constants/mock_data.dart` (new duty entry, new conversation entry, new message thread — no schema changes, no new files)

---

## 11. Notifications Feed

**Goal:** Build out the previously-unused Notifications screen and connect it to a live entry point, since it had a bell icon (on the legacy marketplace screen) that led to a screen with hardcoded, non-interactive content.

**What was built:**
- Moved the notifications list into `MockData.notifications` (mutable, same pattern as duties/conversations) with 4 realistic items: a hospital counter-offer, a duty confirmation, a new-duty-matching-specialty alert, and a verification-status update — 3 unread, 1 read — plus `MockData.unreadNotificationCount`.
- Rebuilt `NotificationsScreen`: type-specific icons, an unread dot + highlighted border, and tapping a notification marks it read and deep-links into the relevant screen — `conversationId` → that Chat, `dutyId` → that Duty Details.
- Added a notification bell with a live unread-count badge to the Home screen header (Home didn't have one before), which was the missing entry point into this feed from the app's actual current flow.

**Files created:** none

**Files modified:**
- `lib/core/constants/mock_data.dart` (`notifications`, `unreadNotificationCount`)
- `lib/features/notifications/presentation/notifications_screen.dart` (full rebuild from hardcoded/static to data-driven + interactive)
- `lib/features/home/presentation/home_screen.dart` (notification bell + badge, refreshes on return from the feed)

---

## 12. "My Duties" on Profile

**Goal:** Show the duties the doctor is actively engaged with directly on their Profile.

**What was built:**
- Added a `dutyStatus` field (`confirmed` / `negotiating` / `pending`) to each `MockData.conversations` entry — the doctor's personal status for that duty, distinct from the duty listing's own public `status` (`published`).
- Added `MockData.myDuties`, a getter that pairs each conversation with its full duty record (reuses `duties` + `conversations`, no new model).
- Added a "My Duties" section to `DoctorProfileScreen` (between Preferred Work Hubs and Hospital/Clinic): one tile per engaged duty — facility, specialty/date, and a `StatusBadge` (green "CONFIRMED", blue "NEGOTIATING"). Tapping a tile opens that duty's existing Chat directly.

**Files modified:**
- `lib/core/constants/mock_data.dart` (`dutyStatus` field, `myDuties` getter)
- `lib/features/doctor_profile/presentation/doctor_profile_screen.dart` ("My Duties" section + tile builder)

---

## 13. Release APK Export

**Goal:** Produce an installable APK to share/sideload, rather than only running via `flutter run` on the emulator.

**What was done:**
- Ran `flutter build apk --release` — succeeded (signed with the project's debug keystore, since no separate release signing config exists in `android/app/build.gradle`). Output was 57.5 MB, over the 30 MB file-delivery limit for this conversation.
- Re-built with `flutter build apk --release --split-per-abi` to produce one APK per CPU architecture instead of one universal APK bundling all of them — `app-arm64-v8a-release.apk` (~26 MB), `app-armeabi-v7a-release.apk` (~24 MB), `app-x86_64-release.apk` (~27 MB), each under the limit.
- Delivered `app-arm64-v8a-release.apk` (covers essentially all modern Android phones); the armeabi-v7a (older 32-bit devices) and x86_64 (emulators) builds also exist in `build/app/outputs/flutter-apk/` if needed.

**Files created/modified:** none (build artifacts only, not source-controlled)

---
