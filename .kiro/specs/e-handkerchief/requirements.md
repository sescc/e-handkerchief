# Requirements Document

## Introduction

e-Handkerchief is a mobile-first Progressive Web App (PWA) that lets users quickly capture location-aware knots — via voice recording, photo/video, or text — without needing to type on the go. Like a knot tied in a handkerchief, it serves as a fast, frictionless reminder tied to a specific place and time. Knots are saved immediately to local device storage, are browsable in the Knots list or on a monthly Calendar, and can be synced to Google Drive (once the user connects their account) or shared individually through the device's own share sheet. The app is designed to function fully offline once installed.

---

## Glossary

- **App**: The e-Handkerchief PWA running in a mobile browser or installed to the home screen.
- **Knot**: A single captured entry consisting of at minimum one media item (voice recording, photo/video, or text) combined with an automatically recorded timestamp and GPS coordinate.
- **Knots list**: The main view listing all saved Knots in reverse-chronological order.
- **Capture Screen**: The primary screen used to create a new Knot.
- **Calendar**: A monthly grid view showing how many Knots were tied each day (dots for up to 4 Knots, a count badge above that). Tapping a day that has Knots opens an inline panel listing that day's Knots, each navigable to its Knot Detail View.
- **Media Item**: Any one of the following attached to a Knot — a voice recording (audio file), a photo, a video, or a plain-text entry.
- **Location**: A WGS-84 GPS coordinate (latitude, longitude, and optional accuracy radius) automatically captured at the time of knot creation.
- **Timestamp**: The local date and time recorded at the moment of knot creation.
- **Local Storage**: The device-resident storage mechanism (IndexedDB) used to persist Knots without internet connectivity.
- **Transcription**: An automatically generated text representation of the audio content of a voice recording, produced by the Web Speech API (live, while recording) or a user-configured transcription server (deferred, on request), and attached to that specific voice recording.
- **Cloud Backup**: Automatic two-way synchronisation of Knot data with Google Drive — knots saved on this device are pushed to Drive, and knots saved on other devices under the same Google account are pulled down, with the most recently edited copy (by `updatedAt`) winning. Google Drive backup is always available on a deployed App; each user chooses whether to connect their own account.
- **Share**: Sending a single Knot to another app, contact, or destination through the platform's Web Share API (the device's own share sheet) — e.g. email, a messaging app, Bluetooth, or copy. Available from the Knot Detail View.
- **Daily Email Summary**: A planned, not-yet-implemented daily email digest of Knots sent to a pre-configured recipient address. The Settings screen retains the enable toggle and recipient address for when it ships; the App does not send any email today. See Requirement 8.6.
- **Service Worker**: The background script that enables offline functionality, caching, and background sync for the PWA.
- **Settings**: A user-accessible configuration screen where preferences such as recipient address and optional feature toggles are managed.
- **Notification Shortcut**: A persistent Android notification or iOS home-screen shortcut that allows the user to launch the Capture Screen directly without navigating through the browser.
- **Knot Detail View**: A dedicated screen for a single Knot, accessible via its unique hash-based URL (`#/knot/{id}`), that displays the full Knot content including all Media Items, and provides Share, Edit, and Delete controls.

---

## Requirements

### Requirement 1: Capture a Knot with Automatic Context

**User Story:** As a casual mobile user passing a location, I want to quickly create a knot with minimal interaction so that I can capture my reminder before I walk past.

#### Acceptance Criteria

1. THE App SHALL display the Capture Screen as the default landing view on every launch.
2. WHEN the user opens the Capture Screen, THE App SHALL automatically record the current Timestamp in the device's local date, time, and UTC offset.
3. WHEN the user opens the Capture Screen, THE App SHALL request GPS Location from the browser Geolocation API and display the result on the Capture Screen within 10 seconds.
4. IF the Geolocation API returns a permission-denied error, THEN THE App SHALL display a message indicating that location access is required and instructing the user to enable Location permissions in their device settings, and SHALL allow the Knot to be saved without a Location.
5. IF the Geolocation API does not return a fix within 10 seconds, THEN THE App SHALL save the Knot with the best available Location fix or mark Location as unavailable if no fix was received.
6. THE Capture Screen SHALL provide controls to add at least one of the following Media Items: a voice recording, a photo, a video, or a text entry of between 1 and 2000 characters.
7. IF the user attempts to save a Knot without at least one Media Item, THEN THE App SHALL display a validation message indicating that at least one Media Item is required and SHALL NOT save the Knot.
8. IF a Media Item capture operation fails (microphone, camera, or storage unavailable), THEN THE App SHALL display a message indicating which Media Item type could not be captured and SHALL return the user to the Capture Screen with any previously added Media Items preserved.

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
2. THE Knots list SHALL display all saved Knots in reverse-chronological order (newest first), sorted by the Timestamp recorded at the moment of saving.
3. EACH Knot entry in the Knots list SHALL display the Timestamp formatted according to the user's configured Date Format and Time Format Settings (Requirement 12), a human-readable address of up to 100 characters, a manually-entered location label, or the raw GPS coordinates in decimal-degrees format (±DD.DDDDD, ±DDD.DDDDD) if none of those is available, all attached text content up to its full stored length, inline audio playback controls for any voice recording, and inline image/video thumbnails at a minimum dimension of 80×80 points for any photo or video.
4. THE Knots list SHALL display the full content of each Knot without requiring the user to tap into a detail view.
5. WHEN the Knots list contains no Knots, THE App SHALL display an empty-state message inviting the user to tie the first Knot.
6. IF reverse-geocoding fails or is unavailable when rendering a Knot entry, THEN THE App SHALL display the raw GPS coordinates in decimal-degrees format (±DD.DDDDD, ±DDD.DDDDD) in place of the human-readable address without hiding or omitting the location field.
7. IF a voice recording, image, or video attached to a Knot entry fails to load, THEN THE App SHALL display a placeholder indicating the media is unavailable in place of the inline control or thumbnail, without removing the rest of the Knot entry from the Knots list.

---

### Requirement 7: Optional Voice Transcription

**User Story:** As a user who prefers searchable text, I want my voice recordings automatically transcribed so that I can read or search my knot content.

#### Acceptance Criteria

1. WHERE the Transcription feature is enabled in Settings, THE App SHALL attempt to transcribe each voice recording using the Web Speech API or an equivalent browser-native API, with each transcription attempt subject to a maximum timeout of 30 seconds.
2. WHERE the Transcription feature is enabled, WHEN a transcription is successfully produced, THE App SHALL attach the transcribed text to that voice recording's Media Item as searchable text content alongside the original audio file.
3. WHERE the Transcription feature is enabled, IF transcription fails, times out after 30 seconds, or the speech recognition API is not supported by the browser, THEN THE App SHALL save the Knot with the audio file only and display a non-blocking notice indicating transcription was unavailable; the notice SHALL dismiss automatically after 5 seconds or on user interaction.
4. WHERE the Transcription feature is disabled, THE App SHALL NOT attempt transcription.

---

### Requirement 8: Share a Knot

**User Story:** As a user who wants to send a specific reminder somewhere else, I want to share a single knot through my device's normal share options so that I can email it, message it, or hand it to another app without leaving e-Handkerchief.

#### Acceptance Criteria

1. THE Knot Detail View SHALL provide a Share control that, when activated, invokes the platform's own share sheet via the Web Share API (`navigator.share`).
2. WHEN the Share control is activated, THE App SHALL build the shared text from the Knot's Timestamp, its place (a human-readable address or GPS coordinates, together with a Google Maps link, or a manually-entered location label) if any location information is present, every text Media Item's content, every available transcript, and a count of the Knot's attached photo, video, and voice-recording Media Items.
3. WHERE the browser reports that it can share files (`navigator.canShare`) AND the combined size of the Knot's photo, video, and audio Media Items is 50 MB or less, THE App SHALL include those Media Items as files in the share; otherwise THE App SHALL share the text only.
4. IF the Web Share API is not available in the browser, THEN THE App SHALL copy the shared text to the clipboard and display a confirmation message, instead of failing silently or showing an error.
5. IF the user cancels the platform share sheet, THEN THE App SHALL take no further action and SHALL NOT display an error message.
6. THE Daily Email Summary (Requirement 12) IS deferred and not yet implemented. THE Settings screen SHALL retain the recipient address setting for when it ships, and THE App SHALL NOT send any email.

---

### Requirement 9: Notification Shortcut for Quick Launch

**User Story:** As a user who needs to capture a knot rapidly, I want a persistent shortcut on my device so that I can open the Capture Screen in one tap without unlocking and navigating the browser.

#### Acceptance Criteria

1. WHERE the device platform supports Web App Manifest shortcuts, THE App SHALL declare at least 1 shortcut entry in its Web App Manifest that targets the Capture Screen as its destination URL.
2. WHERE the device is Android and the App is installed as a PWA, WHEN the user launches the App for the first time after installation, THE App SHALL request notification permission and, if granted, display a persistent notification containing a launch action that opens the Capture Screen directly.
3. IF the user denies notification permission, THEN THE App SHALL continue to function without the persistent notification and SHALL NOT request notification permission again within the same installation.
4. WHEN the App is running in the foreground and a persistent notification is active, THE App SHALL ensure the notification remains visible in the device notification drawer until the user explicitly dismisses it or uninstalls the App.

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
2. WHERE Google Drive is connected, WHEN a Knot is saved (created, edited, or transcribed) and a network connection is available, THE App SHALL upload that Knot's backup file to the Drive app-data folder, updating (upserting) the Knot's existing backup file if one already exists rather than creating a new one.
3. WHERE Google Drive is connected, IF a network connection is unavailable or the upload fails when a Knot is saved, THEN THE App SHALL queue the upload as a retry job and SHALL attempt it when connectivity is restored, retrying up to 3 times before marking the job failed. THE App SHALL NOT queue a second job for the same Knot while one is already pending.
4. WHERE Google Drive is connected, IF a queued upload job reaches 3 failed attempts, THEN THE App SHALL display a message identifying the affected Knot (or, when more than one Knot failed in the same retry pass, their count) with a tap-to-retry action, and SHALL retain the job for the next manual or automatic retry.
5. THE App SHALL automatically run a full two-way sync: at app startup when already connected and online, when the device regains network connectivity, immediately after connecting Google Drive, and when the user activates "Merge with Cloud" in Settings.
6. WHEN a sync runs, THE App SHALL compare each Knot on this device against its Drive backup (if any) by `updatedAt`, SHALL push the local copy to Drive when it is newer, SHALL pull the Drive copy into Local Storage when it is newer, and SHALL do neither when the two are equal.
7. WHEN a sync runs and Drive holds more than one backup file for the same Knot, THE App SHALL keep only the file with the newest `updatedAt` and SHALL delete the others.
8. WHEN the user deletes a Knot from this device (from the Knots list or its Knot Detail View), THE App SHALL remove the Knot from Local Storage only, SHALL NOT delete its Drive backup, and SHALL record a local marker so that no later sync pulls that Knot back onto this device.
9. THE Settings screen SHALL provide a "Manage backups" control that lists every backup file in the Drive app-data folder — showing a preview of its content and whether a matching Knot exists on this device — and lets the user delete an individual backup.
10. WHEN the user deletes a backup via "Manage backups", THE App SHALL delete the Drive file and SHALL record a cloud marker so that no device re-uploads a backup for that Knot until the Knot is next edited on that device; Knot copies already present on any device SHALL NOT be deleted.
11. THE Settings screen SHALL explain, in plain language, both kinds of delete: that deleting a Knot from the Knots list or its detail page removes it from this device only (its cloud backup is kept and other devices keep their copies), and that deleting a backup via "Manage backups" deletes the Knot's cloud backup only (copies already on devices are kept and won't be backed up again unless edited).
12. WHERE Google Drive is connected, WHEN the provider's access authorisation expires, THE App SHALL renew it automatically without user interaction. IF the provider refuses renewal, THEN THE App SHALL mark the provider as disconnected and SHALL display a message prompting the user to reconnect.

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
9. THE Settings screen SHALL include a "Merge with Cloud" control that runs a full Cloud Backup sync on demand, and SHALL display the time of the most recently completed sync ("Last merged") or an indication that no sync has occurred yet ("Not merged yet").
10. THE Settings screen SHALL include the "Manage backups" control described in Requirement 11.9.
11. IF Google Drive is not connected OR the device is offline, THEN THE Settings screen SHALL disable the "Merge with Cloud" and "Manage backups" controls and SHALL display a hint explaining that connecting and going online is required to use them.
12. WHEN the user saves a change in Settings, THE App SHALL persist the change to Local Storage within 500 milliseconds and reflect the updated value immediately in the Settings screen without requiring a restart.
13. IF persisting a Settings change to Local Storage fails, THEN THE App SHALL display an error message indicating the setting could not be saved and revert the control to its previous value.
14. WHEN the App is launched, THE App SHALL load all Settings from Local Storage before rendering any screen, applying defaults for any settings not found in Local Storage.

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
