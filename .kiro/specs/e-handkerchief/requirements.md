# Requirements Document

## Introduction

e-Handkerchief is a mobile-first Progressive Web App (PWA) that lets users quickly capture location-aware knots — via voice recording, photo/video, or text — without needing to type on the go. Like a knot tied in a handkerchief, it serves as a fast, frictionless reminder tied to a specific place and time. Knots are saved immediately to local device storage, are browsable in the Knots list or on a monthly Calendar, and can be synced to Google Drive (once the user connects their account) or shared — one or several at a time — through the device's own share sheet. A knot can be checked off once it has been dealt with, and a knot edited on two devices is reviewed by the user instead of being silently overwritten. The app is designed to function fully offline once installed.

---

## Glossary

- **App**: The e-Handkerchief PWA running in a mobile browser or installed to the home screen.
- **Knot**: A single captured entry consisting of at minimum one media item (voice recording, photo/video, or text) combined with an automatically recorded timestamp and GPS coordinate.
- **Knots list**: The main view listing all saved Knots in reverse-chronological order.
- **Capture Screen**: The primary screen used to create a new Knot.
- **Calendar**: A monthly grid view showing how many Knots were tied each day (dots for up to 4 Knots, a count badge above that). Tapping a day that has Knots opens an inline panel listing that day's Knots, each navigable to its Knot Detail View. Checked-off Knots are always included, shown faded.
- **Media Item**: Any one of the following attached to a Knot — a voice recording (audio file), a photo, a video, or a plain-text entry.
- **Location**: A WGS-84 GPS coordinate (latitude, longitude, and optional accuracy radius) automatically captured at the time of knot creation.
- **Timestamp**: The local date and time recorded at the moment of knot creation.
- **Local Storage**: The device-resident storage mechanism (IndexedDB) used to persist Knots without internet connectivity.
- **Transcription**: An automatically generated text representation of the audio content of a voice recording, produced by the Web Speech API (live, while recording) or a user-configured transcription server (deferred, on request), and attached to that specific voice recording.
- **Cloud Backup**: Automatic two-way synchronisation of Knot data with Google Drive — knots saved on this device are pushed to Drive, and knots saved on other devices under the same Google account are pulled down. Content is compared against a **base version**: a copy is replaced silently only when the other side has not changed since the two last agreed; when both changed, the user reviews the difference (see **Conflict**). Content is never resolved by "newest wins". Google Drive backup is always available on a deployed App; each user chooses whether to connect their own account.
- **Base version**: The Knot content version (`updatedAt`) that this device and Google Drive last agreed on, recorded locally per Knot. It is what lets a sync tell "only one side changed" from "both sides changed".
- **Conflict**: A Knot whose content was edited on this device and also changed in Google Drive since their base version. It is never overwritten on either side until the user reviews it (Requirement 17).
- **Checked off**: A Knot the user has marked as dealt with. Checking off is not a content edit: it does not change the Knot's content version, and it syncs on its own clock (Requirement 14). A checked-off Knot can be unchecked at any time.
- **New day starts at**: The user-configurable time of day (default 03:00, evaluated in the App's timezone setting) after which a checked-off Knot leaves the Knots list.
- **Share**: Sending one or several Knots to another app, contact, or destination through the platform's Web Share API (the device's own share sheet) — e.g. email, a messaging app, Bluetooth, or copy. A single Knot is shared from the Knot Detail View; several are shared from the Knots list's Select mode.
- **Daily Email Summary**: A planned, not-yet-implemented daily email digest of Knots sent to a pre-configured recipient address. The Settings screen retains the enable toggle and recipient address for when it ships; the App does not send any email today. See Requirement 8.6.
- **Service Worker**: The background script that enables offline functionality, caching, and background sync for the PWA.
- **Settings**: A user-accessible configuration screen where preferences such as recipient address and optional feature toggles are managed.
- **Notification Shortcut**: A quick-capture notification ("Tap to tie a knot") in the device's notification drawer, or a home-screen shortcut, that allows the user to launch the Capture Screen directly without navigating through the browser. A web app cannot pin a notification, so on Android the user can swipe it away; the App puts it back at the next launch and after every tap.
- **Knot Detail View**: A dedicated screen for a single Knot, accessible via its unique hash-based URL (`#/knot/{id}`), that displays the full Knot content including all Media Items, and provides Share, Edit and Delete controls and a check-off tick.
- **Conflict Review Screen**: The screen at `#/conflict/{id}` where the user compares a conflicted Knot's two versions and chooses which to keep (Requirement 17).

---

## Requirements

### Requirement 1: Capture a Knot with Automatic Context

**User Story:** As a casual mobile user passing a location, I want to quickly create a knot with minimal interaction so that I can capture my reminder before I walk past.

#### Acceptance Criteria

1. THE App SHALL display the Capture Screen as the default landing view on every launch.
2. WHEN the user opens the Capture Screen, THE App SHALL automatically record the current Timestamp in the device's local date, time, and UTC offset.
3. WHEN the user opens the Capture Screen, THE App SHALL request GPS Location from the browser Geolocation API and display the result on the Capture Screen within 10 seconds.
4. IF the Geolocation API returns a permission-denied error, THEN THE App SHALL show, in place of the location, a tappable message "Location blocked for this site — allow it in browser settings, then tap to retry", and SHALL allow the Knot to be saved without a Location.
5. IF the Geolocation API does not return a fix within 10 seconds, or cannot determine a position, THEN THE App SHALL show a tappable message "Location unavailable — tap to retry" and SHALL save the Knot with the best available Location fix, or without a Location if none was received.
6. THE Capture Screen SHALL provide controls to add at least one of the following Media Items: a voice recording, a photo, a video, or a text entry of between 1 and 2000 characters.
7. IF the user attempts to save a Knot without at least one Media Item, THEN THE App SHALL display a validation message indicating that at least one Media Item is required and SHALL NOT save the Knot.
8. IF a Media Item capture operation fails (microphone, camera, or storage unavailable), THEN THE App SHALL display a message indicating which Media Item type could not be captured and SHALL return the user to the Capture Screen with any previously added Media Items preserved.
9. WHEN the user taps either location message, THE App SHALL show "Getting location…" with a progress indicator and request the Location again. WHILE a request is in progress, THE App SHALL ignore further taps; only the most recent request SHALL be able to set the Location, and nothing SHALL be shown for a request that finishes after the user has left the Capture Screen. THE Knot SHALL be saved with whatever Location is known at the moment of saving.

---

### Requirement 2: Voice Recording Input

**User Story:** As a user on the move, I want to record a voice reminder hands-free so that I don't have to type while walking.

#### Acceptance Criteria

1. WHEN the user activates the voice recording control, THE App SHALL request microphone access via the browser MediaRecorder API.
2. IF microphone permission is denied, THEN THE App SHALL display an error message indicating that microphone access is required, AND SHALL disable the voice recording control for the remainder of the session.
3. WHILE a voice recording is in progress, THE App SHALL display a visible recording indicator and an elapsed-time counter updated at most every 1 second.
4. WHEN the user stops a voice recording, THE App SHALL attach the resulting audio file to the current Knot within 3 seconds of the recording stopping.
5. THE App SHALL support voice recordings of up to 10 minutes (600 seconds) in duration.
6. WHEN a voice recording reaches the 10-minute limit, THE App SHALL automatically stop the recording and attach the resulting audio file to the current Knot.
7. IF the browser MediaRecorder API is unavailable or unsupported, THEN THE App SHALL display a message indicating that voice recording is not supported in the current browser, AND SHALL disable the voice recording control.

---

### Requirement 3: Photo and Video Input

**User Story:** As a user at a location, I want to attach a photo or short video to my knot so that I have a visual reference alongside my reminder.

#### Acceptance Criteria

1. WHEN the user activates the camera control, THE App SHALL invoke the device camera using the HTML Media Capture API or an equivalent browser mechanism.
2. THE App SHALL allow the user to capture a new photo using the device camera, with a maximum resolution of 12 megapixels and a maximum file size of 100 MB.
3. THE App SHALL allow the user to capture a new video clip using the device camera, with a maximum duration of 60 seconds and a maximum file size of 100 MB.
4. THE App SHALL allow the user to select an existing photo or video from the device media library, accepting JPEG, PNG, GIF, WEBP, MP4, and MOV formats only.
5. WHEN a photo or video is successfully attached, THE App SHALL display a thumbnail preview of at least 80×80 pixels on the Capture Screen before saving.
6. IF the attached photo or video file exceeds 100 MB, THEN THE App SHALL display an error message indicating the file size limit, SHALL NOT attach the file, and SHALL preserve any previously entered knot content.
7. IF the selected file format is not one of JPEG, PNG, GIF, WEBP, MP4, or MOV, THEN THE App SHALL display an error message indicating the unsupported format and SHALL NOT attach the file.

---

### Requirement 4: Text Input

**User Story:** As a user, I want the option to type a short text entry so that I can add context that voice or photo alone cannot convey.

#### Acceptance Criteria

1. THE Capture Screen SHALL include a text input field that accepts free-form text of up to 2 000 characters and displays the remaining character count.
2. WHEN the user enters text exceeding 2 000 characters, THE App SHALL stop accepting additional characters and display a message indicating the character limit has been reached.
3. IF the user clears the text input field, THEN THE App SHALL reset the remaining character count to 2 000.
4. WHEN the user submits a capture that includes text, THE App SHALL preserve the exact text content as entered, including whitespace and line breaks, up to the 2 000-character limit.

---

### Requirement 5: Offline Knot Saving

**User Story:** As a user in an area with no connectivity, I want my knots saved immediately to the device so that I never lose a capture because of missing internet access.

#### Acceptance Criteria

1. WHEN the user saves a Knot, THE App SHALL store the Knot in Local Storage within 1 second regardless of network connectivity, preserving all Knot fields (media items, timestamp, and location).
2. IF Local Storage is unavailable or has insufficient space to store the Knot, THEN THE App SHALL display an error message indicating the Knot could not be saved and SHALL NOT discard any Knot content the user has entered.
3. THE App SHALL be installable as a PWA and SHALL function fully — including capture, the Knots list, and the Calendar — without any internet connection after initial installation.
4. THE Service Worker SHALL cache all application assets required for offline operation at install time, completing the cache before the install event resolves.
5. IF a network request fails due to no connectivity, THEN THE App SHALL fall back to cached assets and SHALL NOT display a browser error page.

---

### Requirement 6: Knots List View

**User Story:** As a user reviewing my past reminders, I want to see all my knots in a single scrollable list so that I can read them without tapping into each one individually.

#### Acceptance Criteria

1. THE App SHALL provide a Knots list screen accessible from every screen via persistent navigation.
2. THE Knots list SHALL display all saved Knots in reverse-chronological order (newest first), sorted by the Timestamp recorded at the moment of saving, except that a checked-off Knot is hidden from the list once the next "New day starts at" time has passed (Requirement 14).
3. EACH Knot entry in the Knots list SHALL display the Timestamp formatted according to the user's configured Date Format and Time Format Settings (Requirement 12), a human-readable address of up to 100 characters, a manually-entered location label, or the raw GPS coordinates in decimal-degrees format (±DD.DDDDD, ±DDD.DDDDD) if none of those is available, all attached text content up to its full stored length, inline audio playback controls for any voice recording, and inline image/video thumbnails at a minimum dimension of 80×80 points for any photo or video.
4. THE Knots list SHALL display the full content of each Knot without requiring the user to tap into a detail view.
5. WHEN the Knots list contains no Knots, THE App SHALL display an empty-state message inviting the user to tie the first Knot.
6. IF reverse-geocoding fails or is unavailable when rendering a Knot entry, THEN THE App SHALL display the raw GPS coordinates in decimal-degrees format (±DD.DDDDD, ±DDD.DDDDD) in place of the human-readable address without hiding or omitting the location field.
7. IF a voice recording, image, or video attached to a Knot entry fails to load, THEN THE App SHALL display a placeholder indicating the media is unavailable in place of the inline control or thumbnail, without removing the rest of the Knot entry from the Knots list.
8. EACH Knot entry in the Knots list SHALL provide a check-off control (Requirement 14), and a Select mode for sharing several Knots at once (Requirement 16).
9. WHILE a Knot is in conflict (Requirement 17), ITS entry in the Knots list SHALL display the badge "⚠ Also edited on another device".

---

### Requirement 7: Optional Voice Transcription

**User Story:** As a user who prefers searchable text, I want my voice recordings automatically transcribed so that I can read or search my knot content.

#### Acceptance Criteria

1. WHERE the Transcription feature is enabled in Settings, THE App SHALL transcribe each voice recording live while it records, using the Web Speech API or an equivalent browser-native API, continuing across pauses until the recording stops. WHEN the recording stops, THE App SHALL finish transcription within 3 seconds even if the speech engine does not respond, keeping any text already recognised.
2. WHERE the Transcription feature is enabled, WHEN a transcription is successfully produced, THE App SHALL attach the transcribed text to that voice recording's Media Item as searchable text content alongside the original audio file.
3. WHERE the Transcription feature is enabled, IF no transcript is produced for a voice recording (recognition fails, produces no text, the speech recognition API is not supported by the browser, or the device is offline), THEN THE App SHALL save the Knot with the audio file and mark that recording as pending transcription, so it can be transcribed later from the Knot Detail View when a transcription server is configured in Settings. After saving, THE App SHALL display a non-blocking notice indicating transcription was unavailable, giving the reason where it is known; the notice SHALL dismiss automatically after 5 seconds or on user interaction.
4. WHERE the Transcription feature is disabled, THE App SHALL NOT attempt transcription.

---

### Requirement 8: Share a Knot

**User Story:** As a user who wants to send a specific reminder somewhere else, I want to share a single knot through my device's normal share options so that I can email it, message it, or hand it to another app without leaving e-Handkerchief.

#### Acceptance Criteria

1. THE Knot Detail View SHALL provide a Share control that, when activated, invokes the platform's own share sheet via the Web Share API (`navigator.share`).
2. WHEN the Share control is activated, THE App SHALL build the shared text from the Knot's Timestamp, its place (a human-readable address or GPS coordinates, together with a Google Maps link, or a manually-entered location label) if any location information is present, every text Media Item's content, every available transcript, and a count of the Knot's attached photo, video, and voice-recording Media Items, followed by the attribution footer when it is enabled (Requirement 15).
3. WHERE the browser reports that it can share files (`navigator.canShare`) AND the combined size of the Knot's photo, video, and audio Media Items is 50 MB or less, THE App SHALL include those Media Items as files in the share; otherwise THE App SHALL share the text only.
4. IF the Web Share API is not available in the browser, THEN THE App SHALL copy the shared text to the clipboard and display a confirmation message, instead of failing silently or showing an error.
5. IF the user cancels the platform share sheet, THEN THE App SHALL take no further action and SHALL NOT display an error message.
6. THE Daily Email Summary (Requirement 12) IS deferred and not yet implemented. THE Settings screen SHALL retain the recipient address setting for when it ships, and THE App SHALL NOT send any email.
7. The attribution footer is specified in Requirement 15, and sharing several Knots at once in Requirement 16.

---

### Requirement 9: Notification Shortcut for Quick Launch

**User Story:** As a user who needs to capture a knot rapidly, I want a persistent shortcut on my device so that I can open the Capture Screen in one tap without unlocking and navigating the browser.

#### Acceptance Criteria

1. WHERE the device platform supports Web App Manifest shortcuts, THE App SHALL declare at least 1 shortcut entry in its Web App Manifest that targets the Capture Screen as its destination URL.
2. THE Settings screen SHALL provide a "Quick-capture notification" toggle, defaulting to on, with the hint "Keeps a 'Tap to tie a knot' notification in your notification drawer. On Android you can still swipe it away; it comes back the next time you open the app." THE App SHALL request notification permission only when the user taps the "Allow notifications" control that stands in for this toggle while permission has not been asked yet (a browser prompt needs a user gesture), and SHALL NOT request it at startup. *(Amended 2026-09-29: previously the permission was requested on first launch.)*
3. THE control SHALL reflect the browser's permission state: WHEN permission is granted, it SHALL be a toggle showing on or off according to the setting; WHEN permission has not been asked yet, it SHALL be an "Allow notifications" button; WHEN permission is denied, it SHALL show "Blocked in browser settings"; WHEN the browser has no Notification API, THE Settings screen SHALL hide the section. The stored setting SHALL default to on but SHALL only take effect once permission is granted.
4. WHERE the setting is on and permission is granted, WHEN the App is launched, THE App SHALL (re-)post the notification, replacing any earlier one rather than stacking a second. WHEN the user turns the toggle off, THE App SHALL close the notification. *(Amended 2026-09-29: a web app cannot make a notification undismissable, so this replaces the earlier guarantee that it remains until the user dismisses it.)*
5. WHEN the user taps the notification, THE App SHALL open the Capture Screen under the App's own path (including a GitHub Pages sub-path), focusing an already-open window where there is one, and THE Service Worker SHALL then re-post the notification so it stays available.
6. THE notification SHALL remain swipe-away on Android; the App SHALL NOT claim otherwise, and SHALL bring it back at the next launch and after each tap.
7. IF the user denies notification permission, THEN THE App SHALL continue to function without the notification and SHALL NOT prompt again; the Settings toggle SHALL show "Blocked in browser settings" (Acceptance Criterion 3).

---

### Requirement 10: Offline-First Architecture

**User Story:** As a user in areas with intermittent connectivity, I want the entire app to work without internet after the first load so that connectivity issues never block me.

#### Acceptance Criteria

1. IF the network is unavailable, THEN the Service Worker SHALL serve all asset and API requests from the local cache.
2. IF the network is unavailable and a requested asset or API response is not present in the local cache, THEN the Service Worker SHALL return an error response indicating the resource is unavailable offline.
3. WHEN a new version of the App is deployed, THE Service Worker SHALL begin downloading the updated assets in the background without interrupting the current session, and SHALL display a visible notification prompting the user to reload to apply the update.
4. THE App SHALL NOT require a server-side component to save, view, or delete Knots.

---

### Requirement 11: Cloud Backup and Sync (Google Drive)

**User Story:** As a user who uses e-Handkerchief on more than one device, I want my knots backed up to Google Drive and kept in sync so that every device ends up with the same knots.

#### Acceptance Criteria

1. THE Settings screen SHALL provide an option to connect the App to Google Drive. Google Drive SHALL always be offered on a deployed App; it SHALL NOT depend on configuration supplied by the user. Each user connects their own Google account.
2. WHERE Google Drive is connected, WHEN a Knot is saved (created, edited, or transcribed) and a network connection is available, THE App SHALL upload that Knot's backup file to the Drive app-data folder, updating (upserting) the Knot's existing backup file if one already exists rather than creating a new one — unless the existing backup was changed by another device since this device's base version, in which case THE App SHALL NOT overwrite it, SHALL record a conflict instead (Requirement 17), and SHALL NOT queue a retry job for that upload. Every content write SHALL record a short label of the writing device (e.g. "Android", "Windows") so a review can say where an edit came from.
3. WHERE Google Drive is connected, IF a network connection is unavailable or the upload fails when a Knot is saved, THEN THE App SHALL queue the upload as a retry job and SHALL attempt it when connectivity is restored, retrying up to 3 times before marking the job failed. THE App SHALL NOT queue a second job for the same Knot while one is already pending.
4. WHERE Google Drive is connected, IF a queued upload job reaches 3 failed attempts, THEN THE App SHALL display a message identifying the affected Knot (or, when more than one Knot failed in the same retry pass, their count) with a tap-to-retry action, and SHALL retain the job for the next manual or automatic retry.
5. THE App SHALL automatically run a full two-way sync: at app startup when already connected and online, when the device regains network connectivity, immediately after connecting Google Drive, and when the user activates "Merge with Cloud" in Settings.
6. WHEN a sync runs, THE App SHALL compare each Knot on this device against its Drive backup (if any) by `updatedAt`, relative to the Knot's base version. THE App SHALL push the local copy to Drive when only the local copy changed since the base, SHALL pull the Drive copy into Local Storage when only the Drive copy changed, and SHALL do neither when the two are equal (recording that value as the new base). WHEN both changed since the base, or the state is otherwise inconsistent, THE App SHALL neither push nor pull, and SHALL record a conflict for the user to review (Requirement 17). WHERE no base has been recorded for a Knot (it predates base tracking), THE App SHALL pull the Drive copy only when it is newer AND this device has no pending or failed upload for that Knot (the local copy is then simply stale); otherwise THE App SHALL record a conflict. *(Amended 2026-09-29: supersedes the earlier rule that the newest `updatedAt` wins, which the user rejected because it could silently discard an edit.)*
7. WHEN a sync runs and Drive holds more than one backup file for the same Knot, THE App SHALL keep only the file with the newest `updatedAt` and SHALL delete the others.
8. WHEN the user deletes a Knot from this device (from the Knots list or its Knot Detail View), THE App SHALL remove the Knot from Local Storage only, SHALL NOT delete its Drive backup, and SHALL record a local marker so that no later sync pulls that Knot back onto this device.
9. THE Settings screen SHALL provide a "Manage backups" control that lists every backup file in the Drive app-data folder — showing a preview of its content, whether a matching Knot exists on this device, and a "Checked off" badge for a checked-off Knot (Requirement 14) — and lets the user delete an individual backup.
10. WHEN the user deletes a backup via "Manage backups", THE App SHALL delete the Drive file and SHALL record a cloud marker so that no device re-uploads a backup for that Knot until the Knot is next edited on that device; Knot copies already present on any device SHALL NOT be deleted.
11. THE Settings screen SHALL explain, in plain language, both kinds of delete: that deleting a Knot from the Knots list or its detail page removes it from this device only (its cloud backup is kept and other devices keep their copies), and that deleting a backup via "Manage backups" deletes the Knot's cloud backup only (copies already on devices are kept and won't be backed up again unless edited).
12. WHERE Google Drive is connected, WHEN the provider's access authorisation expires, THE App SHALL renew it automatically without user interaction. IF the provider refuses renewal, THEN THE App SHALL mark the provider as disconnected and SHALL display a message prompting the user to reconnect.
13. IF the user cancels or denies Google's consent screen (Google redirects back with an `error` parameter such as `access_denied`), THEN THE App SHALL remove the OAuth parameters from the URL, SHALL leave the connection status and any stored authorisation unchanged, and SHALL display the notice "Google Drive connection cancelled" (for any other error, "Could not connect to Google Drive").

---

### Requirement 12: Settings Management

**User Story:** As a user, I want a settings screen to configure optional features so that I can tailor the app's behaviour to my preferences.

#### Acceptance Criteria

1. THE App SHALL provide a Settings screen accessible from every screen via a persistent navigation element visible at all times.
2. THE Settings screen SHALL include a toggle to enable or disable Voice Transcription, defaulting to disabled when no prior setting has been persisted.
3. THE Settings screen SHALL include a toggle, labelled as the Daily Email Summary (coming soon), to enable or disable it, defaulting to disabled when no prior setting has been persisted.
4. THE Settings screen SHALL include a text field for the Daily Email Summary recipient address, accepting values that conform to standard email address format (local-part@domain), with a maximum length of 254 characters.
5. IF the user saves a recipient email address that does not conform to standard email address format, THEN THE App SHALL display an inline validation error indicating the address is invalid and SHALL NOT save the invalid address.
6. IF the Daily Email Summary toggle is disabled, THEN THE Settings screen SHALL disable the recipient address text field, preventing input.
7. THE Settings screen SHALL include controls to connect or disconnect Google Drive, displaying the current connection status (connected or disconnected); when connected, THE Settings screen SHALL show the connected Google account's email address (e.g. "Connected as someone@gmail.com") once it has been fetched.
8. IF a Google Drive connection attempt fails, THEN THE App SHALL display an error message indicating the connection could not be established and leave the status as disconnected.
9. THE Settings screen SHALL include a "Merge with Cloud" control that runs a full Cloud Backup sync on demand, and SHALL display the time of the most recently completed sync ("Last merged") or an indication that no sync has occurred yet ("Not merged yet"). The result message is specified in Requirement 18. THE control's description SHALL read "Sends new and edited knots from this device to Google Drive, and brings in new and edited knots from your other devices. Data is never deleted during a merge. If a knot was edited on two devices, you'll be asked which version to keep."
10. THE Settings screen SHALL include the "Manage backups" control described in Requirement 11.9.
11. IF Google Drive is not connected OR the device is offline, THEN THE Settings screen SHALL disable the "Merge with Cloud" and "Manage backups" controls and SHALL display a hint explaining that connecting and going online is required to use them.
12. WHEN the user saves a change in Settings, THE App SHALL persist the change to Local Storage within 500 milliseconds and reflect the updated value immediately in the Settings screen without requiring a restart.
13. IF persisting a Settings change to Local Storage fails, THEN THE App SHALL display an error message indicating the setting could not be saved and revert the control to its previous value.
14. WHEN the App is launched, THE App SHALL load all Settings from Local Storage before rendering any screen, applying defaults for any settings not found in Local Storage.
15. THE Settings screen SHALL include a "New day starts at" time field, defaulting to 03:00 when no prior setting has been persisted, with the hint "Checked-off knots stay visible (faded) until this time, then leave the Knots list. They stay in Calendar." (Requirement 14).
16. THE Settings screen SHALL include a Sharing section with a toggle labelled "Add 'Shared from e-Handkerchief' to shared knots", defaulting to on when no prior setting has been persisted (Requirement 15).
17. THE Settings screen SHALL include the "Quick-capture notification" toggle described in Requirement 9.2 and 9.3, defaulting to on when no prior setting has been persisted.

---

### Requirement 13: Individual Knot View

**User Story:** As a user reviewing a specific reminder, I want each knot to have its own unique URL so that I can bookmark it, navigate directly to it, or open it to share it, without scrolling through the Knots list.

#### Acceptance Criteria

1. EACH saved Knot SHALL have a unique, persistent hash-based URL in the format `#/knot/{id}`, where `{id}` is the Knot's UUID.
2. WHEN the user navigates to `#/knot/{id}`, THE App SHALL load the Knot from Local Storage and display the Knot Detail View showing the full Timestamp, Location, all Media Items, and any available Transcription.
3. THE Knot Detail View SHALL display audio Media Items using an inline audio player, photo Media Items at full displayable resolution, video Media Items using an inline video player with controls, and text Media Items in full preserving whitespace and line breaks.
4. IF a Media Item in the Knot Detail View fails to load, THEN THE App SHALL display a placeholder indicating the media is unavailable in place of that item, without hiding the rest of the Knot content.
5. WHEN the Knots list or the Calendar's day-detail panel displays a Knot entry, THE App SHALL render a navigable link or row on that entry that navigates the user to that Knot's `#/knot/{id}` URL.
6. THE Knot Detail View SHALL provide a back-navigation control that returns the user to the Knots list (`#/knots`).
7. IF the user navigates directly to `#/knot/{id}` and no Knot with that `{id}` exists in Local Storage, THEN THE App SHALL display a message indicating the Knot could not be found on this device and SHALL provide a control to navigate to the Knots list.
8. THE Knot Detail View SHALL be fully accessible offline; the App SHALL load the Knot from Local Storage without requiring a network request.
9. THE Knot Detail View SHALL provide the same per-knot check-off control as the Knots list (Requirement 14; accessible names "Check off knot" / "Uncheck knot"), shown beside the Knot's timestamp, and WHILE the Knot is in conflict SHALL display a banner with a "Review" button that opens the Conflict Review Screen (Requirement 17).
10. WHILE a Knot is checked off, THE Knot Detail View SHALL show a "Checked off" indicator reading "✓ Checked off · " followed by the time it was checked off, formatted in the user's chosen time zone and date/time format, on its own line under the timestamp. THE Knot Detail View SHALL NOT fade or strike through the Knot's content because it is checked off.
11. THE App's persistent navigation SHALL mark exactly one tab as current: Knots while the Knots list, a Knot Detail View, or the Conflict Review Screen is shown; Calendar, Settings, and Capture on their own screens. WHILE the Capture Screen is current, THE centre "+" navigation control SHALL be visually distinguished from its normal state.

---

### Requirement 14: Check Off a Knot

**User Story:** As a user who has dealt with a reminder, I want to check it off so that it fades and then leaves my Knots list, without deleting it or losing it from my calendar.

#### Acceptance Criteria

1. THE Knots list SHALL provide a per-knot check-off control (accessible name "Check off knot" when the Knot is not checked off, "Uncheck knot" when it is), and THE Knot Detail View SHALL provide the same control (same accessible names), shown beside the Knot's timestamp, and, while the Knot is checked off, a "Checked off" indicator showing when (Requirement 13.10).
2. WHEN the user checks off a Knot, THE App SHALL record the time as the Knot's `checkedOffAt` and as its `checkOffChangedAt`, and SHALL display the toast "Checked off · Undo". WHEN the user unchecks a Knot, THE App SHALL clear `checkedOffAt`, set `checkOffChangedAt` to the current time, and SHALL display "Unchecked · Undo". Activating "Undo" in either toast SHALL reverse that action.
3. Checking off or unchecking a Knot SHALL NOT change the Knot's `updatedAt`, its media, or any other content, and SHALL NOT be treated as an edit for the purposes of sync or conflict detection.
4. WHILE a Knot is checked off and the next "New day starts at" time after `checkedOffAt` has not yet passed, THE Knots list SHALL keep the Knot visible, faded and struck through. THE "New day starts at" time defaults to 03:00, is configurable in Settings (Requirement 12.15), and SHALL be evaluated in the App's timezone setting ("auto" meaning the device's own timezone).
5. WHEN that time has passed, THE Knots list SHALL hide the Knot. THE Knot SHALL remain in the Calendar (shown faded) and on its Knot Detail View, where it can be unchecked.
6. WHERE at least one Knot is hidden by Acceptance Criterion 5, THE Knots list SHALL provide a toggle "Show N checked-off knots" that reveals them and reads "Hide checked-off knots" while they are shown.
7. THE App SHALL derive visibility when the list is rendered (nothing is stored and there is no persistent background job), and SHALL re-evaluate it when the App returns to the foreground and, while the Knots list is open, when the earliest upcoming cutoff among the visible checked-off Knots passes (re-checked at least every 24 hours).
   WHEN every Knot is hidden by Acceptance Criterion 5, THE Knots list SHALL show "All your knots are checked off." instead of the first-run empty state.
8. WHERE Google Drive is connected, WHEN a Knot is checked off or unchecked, THE App SHALL write the state to the Knot's Drive backup as a metadata-only update, without uploading the Knot's content. IF the Knot has no backup file yet, or its backup has been deleted via "Manage backups" and not edited since, THEN THE App SHALL do nothing — a check-off SHALL NOT create or restore a deleted backup. A failed update SHALL NOT be queued for retry; the next full sync reconciles it.
9. THE check-off state SHALL sync between devices on its own last-write-wins clock: the greater `checkOffChangedAt` wins, independently of the Knot's content version. A content upload to an existing backup SHALL NOT include the check-off state, so a stale local value can never overwrite a newer check-off made on another device. A Knot pulled from Drive SHALL take its check-off state from the backup file's metadata (or keep the local state if that is newer), never from the file's content.
10. THE Manage backups list SHALL show a "Checked off" badge on the backup of a checked-off Knot, so the user can tell which backups are safe to delete.

---

### Requirement 15: Share Attribution

**User Story:** As a user who shares knots with other people, I want shared text to say where it came from by default, and to be able to turn that off, so that sharing helps others find the app without forcing it on me.

#### Acceptance Criteria

1. WHILE the attribution setting is on (the default), THE App SHALL end every shared text with the line "— Shared from e-Handkerchief" followed on the next line by the App's own link (the address of the deployed App, including any sub-path).
2. THE footer SHALL appear exactly once per share, at the end of the text, however many Knots are shared.
3. THE Settings screen SHALL provide the toggle described in Requirement 12.16, in a Sharing section.
4. WHILE the setting is off, THE App SHALL share the Knot text without the footer.

---

### Requirement 16: Share Several Knots

**User Story:** As a user who wants to send more than one reminder, I want to select several knots and share them together in one go.

#### Acceptance Criteria

1. THE Knots list SHALL provide a "Select" control that turns the entries into selectable rows and shows a bar with "Cancel" and "Share (N)", where N is the number of selected Knots. WHILE in Select mode, tapping anywhere on an entry, including its location link, SHALL toggle its selection rather than open the Knot or Google Maps. THE App SHALL NOT use long-press for selection, because it conflicts with the media controls.
2. WHEN the user activates "Share (N)", THE App SHALL build one combined text: a header line ("N knots from e-Handkerchief" while attribution is on, or "N knots" while it is off), each Knot's summary as in Requirement 8.2 separated by a line consisting of `———`, and the attribution footer once at the end while it is on.
3. WHERE the browser can share files AND the combined size of every selected Knot's photo, video, and audio Media Items is 50 MB or less, THE App SHALL attach them as files, named uniquely across Knots (for example `knot2-photo-1.jpg`); otherwise THE App SHALL share the text only.
4. THE App SHALL make exactly one `navigator.share` call per activation, built synchronously from the Knots in memory, because a retry after a rejection would run outside the user gesture.
5. Requirement 8.4 and 8.5 apply unchanged: IF the Web Share API is unavailable, THEN THE App SHALL copy the combined text to the clipboard ("Knots copied to clipboard"), and IF the user cancels the share sheet, THEN THE App SHALL take no further action.

---

### Requirement 17: Edit Conflicts Are Reviewed, Never Silently Overwritten

**User Story:** As a user who edits on more than one device, I want the app to ask me when the same knot was edited on two devices, so that I never lose an edit without knowing.

#### Acceptance Criteria

1. IF a Knot was edited on this device and its Drive backup has also changed since their base version, THEN THE App SHALL NOT overwrite either copy, and SHALL record a conflict for that Knot. This applies both to a full sync (Requirement 11.6) and to the upload made when a Knot is saved (Requirement 11.2).
2. WHILE a Knot is in conflict, THE App SHALL skip pushing and pulling its content, so the conflict persists until the user resolves it (or the two copies become equal).
3. THE App SHALL keep exactly one persistent toast that reflects the number of Knots in conflict: it SHALL read "1 knot also has edits from another device — tap to review" (or "N knots also have edits …"), SHALL be dismissed when the count reaches 0, SHALL be shown again when the count changes, and SHALL NOT reappear after a tap while the count stays the same. Tapping it SHALL open the Conflict Review Screen for exactly one conflict, or the Knots list when there are several. At startup the App SHALL seed the toast from the recorded conflicts. THE Knots list SHALL show the badge "⚠ Also edited on another device" on the entry (Requirement 6.9), and THE Knot Detail View SHALL show a banner with a "Review" button (Requirement 13.9).
4. THE Conflict Review Screen (`#/conflict/{id}`) SHALL download the latest cloud version on demand and show the differences between "On this device · <time>" and "Latest in the cloud · Edited on <device> · <time>": text items (with changed text shown line by line), added and removed photos, videos, and voice recordings, changed transcripts, and changed location or location label. Check-off state is not part of the comparison. WHERE an old backup carries no device label, THE App SHALL say "another device".
5. IF the device is offline or the cloud version cannot be fetched, THEN THE Conflict Review Screen SHALL show "Connect to the internet to review this knot" and SHALL NOT offer a choice.
6. THE Conflict Review Screen SHALL offer three choices:
   - "Keep this device's version": THE App SHALL save this device's copy with a fresh `updatedAt` (strictly later than the cloud copy's), upload it over the cloud copy, and record it as the new base.
   - "Keep the cloud version": THE App SHALL replace this device's copy with the cloud copy and record it as the new base.
   - "Keep both": THE App SHALL keep this device's version as in the first choice, and SHALL also save the cloud version as a new Knot (a new id, created and updated now, with its original timestamp, location, and media, and with no check-off state), and back it up.
7. WHEN a choice is applied, THE App SHALL clear the conflict, refresh the Knots list, Calendar, and detail view, confirm with a toast ("Kept this device's version", "Kept the cloud version", or "Kept both versions"), and leave the review screen. IF applying the choice fails, THEN THE App SHALL show "Couldn't finish — please try again. Nothing was deleted." and keep the review open. IF the review is opened for a Knot that is not on this device or is not in conflict, THEN THE App SHALL go to the Knots list.
8. IF the cloud version changed again while the review was open, THEN THE App SHALL NOT overwrite anything, SHALL show the newest cloud version, and SHALL tell the user "This knot changed again on another device — please review the latest version".
9. WITH three or more devices, a conflict SHALL always be between this device's version and the latest cloud version, whichever device wrote it. THE review therefore happens only on a device that holds an unsynced edit, and a device that made no edit simply pulls the result.
10. THE App SHALL NOT resolve a conflict by last-write-wins, and SHALL NOT treat a check-off or uncheck as a content edit (Requirement 14.3).
11. IF a Knot that is in conflict is deleted from this device, or its backup no longer exists in Drive (for example it was deleted via "Manage backups"), THEN THE App SHALL drop the conflict record (immediately for a local delete, at the next sync otherwise).

---

### Requirement 18: Merge Result Message

**User Story:** As a user who taps "Merge with Cloud", I want a message that tells me what actually happened, so that I know whether anything changed.

#### Acceptance Criteria

1. WHEN a merge finishes and nothing was brought in, backed up, or waiting for review, THE App SHALL display "Already up to date — nothing to merge".
2. OTHERWISE THE App SHALL display "Merged — " followed by the non-zero parts, in this order and separated by ", ": "N knot(s) brought in" (singular "1 knot brought in"), "N backed up", and "N need(s) review" ("1 needs review", "2 need review"). Zero parts SHALL be omitted, so a merge that only left conflicts reads "Merged — 1 needs review".
3. THE count "backed up" SHALL include queued uploads that were flushed at the start of the merge, as well as knots pushed by the merge itself.
4. THE count "need(s) review" SHALL be the number of Knots in conflict after the merge (Requirement 17).
5. IF the merge fails, THEN THE App SHALL display "Merge failed — check your connection".
