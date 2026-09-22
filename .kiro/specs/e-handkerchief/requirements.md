# Requirements Document

## Introduction

e-Handkerchief is a mobile-first Progressive Web App (PWA) that lets users quickly capture location-aware notes — via voice recording, photo/video, or text — without needing to type on the go. Like a knot on the little finger, it serves as a fast, frictionless reminder tied to a specific place and time. Notes are saved immediately to local device storage and can be synced to cloud storage (Google Drive, once the user connects their account) or emailed to a pre-configured address. The app is designed to function fully offline once installed.

---

## Glossary

- **App**: The e-Handkerchief PWA running in a mobile browser or installed to the home screen.
- **Note**: A single captured entry consisting of at minimum one media item (voice recording, photo/video, or text) combined with an automatically recorded timestamp and GPS coordinate.
- **Journal**: The main view listing all saved Notes in reverse-chronological order.
- **Capture Screen**: The primary screen used to create a new Note.
- **Media Item**: Any one of the following attached to a Note — a voice recording (audio file), a photo, a video, or a plain-text entry.
- **Location**: A WGS-84 GPS coordinate (latitude, longitude, and optional accuracy radius) automatically captured at the time of note creation.
- **Timestamp**: The local date and time recorded at the moment of note creation.
- **Local Storage**: The device-resident storage mechanism (IndexedDB or equivalent) used to persist Notes without internet connectivity.
- **Transcription**: An automatically generated text representation of the audio content of a voice recording, produced by the Web Speech API or equivalent.
- **Cloud Backup**: Synchronisation of Note data to an external service such as Google Drive or a Syncthing endpoint. Google Drive backup is always available on a deployed App; each user chooses whether to connect their own account.
- **Email Summary**: An optional outbound email containing the text and metadata of a Note, sent to a pre-configured recipient address.
- **Service Worker**: The background script that enables offline functionality, caching, and background sync for the PWA.
- **Settings**: A user-accessible configuration screen where preferences such as email address and optional feature toggles are managed.
- **Notification Shortcut**: A persistent Android notification or iOS home-screen shortcut that allows the user to launch the Capture Screen directly without navigating through the browser.
- **Note Detail View**: A dedicated screen for a single Note, accessible via its unique hash-based URL (`#/note/{id}`), that displays the full Note content including all Media Items.

---

## Requirements

### Requirement 1: Capture a Note with Automatic Context

**User Story:** As a casual mobile user passing a location, I want to quickly create a note with minimal interaction so that I can capture my reminder before I walk past.

#### Acceptance Criteria

1. THE App SHALL display the Capture Screen as the default landing view on every launch.
2. WHEN the user opens the Capture Screen, THE App SHALL automatically record the current Timestamp in the device's local date, time, and UTC offset.
3. WHEN the user opens the Capture Screen, THE App SHALL request GPS Location from the browser Geolocation API and display the result on the Capture Screen within 10 seconds.
4. IF the Geolocation API returns a permission-denied error, THEN THE App SHALL display a message indicating that location access is required and instructing the user to enable Location permissions in their device settings, and SHALL allow the Note to be saved without a Location.
5. IF the Geolocation API does not return a fix within 10 seconds, THEN THE App SHALL save the Note with the best available Location fix or mark Location as unavailable if no fix was received.
6. THE Capture Screen SHALL provide controls to add at least one of the following Media Items: a voice recording, a photo, a video, or a text entry of between 1 and 2000 characters.
7. IF the user attempts to save a Note without at least one Media Item, THEN THE App SHALL display a validation message indicating that at least one Media Item is required and SHALL NOT save the Note.
8. IF a Media Item capture operation fails (microphone, camera, or storage unavailable), THEN THE App SHALL display a message indicating which Media Item type could not be captured and SHALL return the user to the Capture Screen with any previously added Media Items preserved.

---

### Requirement 2: Voice Recording Input

**User Story:** As a user on the move, I want to record a voice note hands-free so that I don't have to type while walking.

#### Acceptance Criteria

1. WHEN the user activates the voice recording control, THE App SHALL request microphone access via the browser MediaRecorder API.
2. IF microphone permission is denied, THEN THE App SHALL display an error message indicating that microphone access is required, AND SHALL disable the voice recording control for the remainder of the session.
3. WHILE a voice recording is in progress, THE App SHALL display a visible recording indicator and an elapsed-time counter updated at most every 1 second.
4. WHEN the user stops a voice recording, THE App SHALL attach the resulting audio file to the current Note within 3 seconds of the recording stopping.
5. THE App SHALL support voice recordings of up to 10 minutes (600 seconds) in duration.
6. WHEN a voice recording reaches the 10-minute limit, THE App SHALL automatically stop the recording and attach the resulting audio file to the current Note.
7. IF the browser MediaRecorder API is unavailable or unsupported, THEN THE App SHALL display a message indicating that voice recording is not supported in the current browser, AND SHALL disable the voice recording control.

---

### Requirement 3: Photo and Video Input

**User Story:** As a user at a location, I want to attach a photo or short video to my note so that I have a visual reference alongside my reminder.

#### Acceptance Criteria

1. WHEN the user activates the camera control, THE App SHALL invoke the device camera using the HTML Media Capture API or an equivalent browser mechanism.
2. THE App SHALL allow the user to capture a new photo using the device camera, with a maximum resolution of 12 megapixels and a maximum file size of 100 MB.
3. THE App SHALL allow the user to capture a new video clip using the device camera, with a maximum duration of 60 seconds and a maximum file size of 100 MB.
4. THE App SHALL allow the user to select an existing photo or video from the device media library, accepting JPEG, PNG, GIF, WEBP, MP4, and MOV formats only.
5. WHEN a photo or video is successfully attached, THE App SHALL display a thumbnail preview of at least 80×80 pixels on the Capture Screen before saving.
6. IF the attached photo or video file exceeds 100 MB, THEN THE App SHALL display an error message indicating the file size limit, SHALL NOT attach the file, and SHALL preserve any previously entered note content.
7. IF the selected file format is not one of JPEG, PNG, GIF, WEBP, MP4, or MOV, THEN THE App SHALL display an error message indicating the unsupported format and SHALL NOT attach the file.

---

### Requirement 4: Text Input

**User Story:** As a user, I want the option to type a short text note so that I can add context that voice or photo alone cannot convey.

#### Acceptance Criteria

1. THE Capture Screen SHALL include a text input field that accepts free-form text of up to 2 000 characters and displays the remaining character count.
2. WHEN the user enters text exceeding 2 000 characters, THE App SHALL stop accepting additional characters and display a message indicating the character limit has been reached.
3. IF the user clears the text input field, THEN THE App SHALL reset the remaining character count to 2 000.
4. WHEN the user submits a capture that includes text, THE App SHALL preserve the exact text content as entered, including whitespace and line breaks, up to the 2 000-character limit.

---

### Requirement 5: Offline Note Saving

**User Story:** As a user in an area with no connectivity, I want my notes saved immediately to the device so that I never lose a capture because of missing internet access.

#### Acceptance Criteria

1. WHEN the user saves a Note, THE App SHALL store the Note in Local Storage within 1 second regardless of network connectivity, preserving all Note fields (media items, timestamp, and location).
2. IF Local Storage is unavailable or has insufficient space to store the Note, THEN THE App SHALL display an error message indicating the Note could not be saved and SHALL NOT discard any Note content the user has entered.
3. THE App SHALL be installable as a PWA and SHALL function fully — including capture and Journal browsing — without any internet connection after initial installation.
4. THE Service Worker SHALL cache all application assets required for offline operation at install time, completing the cache before the install event resolves.
5. IF a network request fails due to no connectivity, THEN THE App SHALL fall back to cached assets and SHALL NOT display a browser error page.

---

### Requirement 6: Journal View

**User Story:** As a user reviewing my past reminders, I want to see all my notes in a single scrollable list so that I can read them without tapping into each one individually.

#### Acceptance Criteria

1. THE App SHALL provide a Journal screen accessible from every screen via persistent navigation.
2. THE Journal SHALL display all saved Notes in reverse-chronological order (newest first), sorted by the Timestamp recorded at the moment of saving.
3. EACH Note entry in the Journal SHALL display the Timestamp in the format "Day Mon DD, YYYY HH:MM AM/PM", a human-readable address of up to 100 characters or the raw GPS coordinates in decimal-degrees format (±DD.DDDDD, ±DDD.DDDDD) if reverse-geocoding is unavailable, all attached text content up to its full stored length, inline audio playback controls for any voice recording, and inline image/video thumbnails at a minimum dimension of 80×80 points for any photo or video.
4. THE Journal SHALL display the full content of each Note without requiring the user to tap into a detail view.
5. WHEN the Journal contains no Notes, THE App SHALL display an empty-state message inviting the user to create the first Note.
6. IF reverse-geocoding fails or is unavailable when rendering a Note entry, THEN THE App SHALL display the raw GPS coordinates in decimal-degrees format (±DD.DDDDD, ±DDD.DDDDD) in place of the human-readable address without hiding or omitting the location field.
7. IF a voice recording, image, or video attached to a Note entry fails to load, THEN THE App SHALL display a placeholder indicating the media is unavailable in place of the inline control or thumbnail, without removing the rest of the Note entry from the Journal.

---

### Requirement 7: Optional Voice Transcription

**User Story:** As a user who prefers searchable text, I want my voice recordings automatically transcribed so that I can read or search my note content.

#### Acceptance Criteria

1. WHERE the Transcription feature is enabled in Settings, THE App SHALL attempt to transcribe each voice recording using the Web Speech API or an equivalent browser-native API, with each transcription attempt subject to a maximum timeout of 30 seconds.
2. WHERE the Transcription feature is enabled, WHEN a transcription is successfully produced, THE App SHALL attach the transcribed text to the Note as searchable text content alongside the original audio file.
3. WHERE the Transcription feature is enabled, IF transcription fails, times out after 30 seconds, or the speech recognition API is not supported by the browser, THEN THE App SHALL save the Note with the audio file only and display a non-blocking notice indicating transcription was unavailable; the notice SHALL dismiss automatically after 5 seconds or on user interaction.
4. WHERE the Transcription feature is disabled, THE App SHALL NOT attempt transcription.

---

### Requirement 8: Optional Email Summary

**User Story:** As a user who wants a remote record, I want the app to email me a summary of each note so that I have a copy outside the device.

#### Acceptance Criteria

1. THE Settings screen SHALL provide a text input field for the user to configure a recipient email address for Email Summary, accepting addresses up to 254 characters in length and conforming to standard email address format.
2. IF the user saves a recipient email address that does not conform to standard email address format, THEN THE App SHALL display an inline validation error indicating the address is invalid and SHALL NOT save the invalid address.
3. WHERE an Email Summary recipient address is configured and the Email Summary feature is enabled, WHEN the user saves a Note, THE App SHALL attempt to send an Email Summary containing the Note Timestamp, GPS coordinates or resolved address, all text content, transcription (if available), and links or attachments to any Media Items.
4. WHERE the Email Summary feature is enabled, IF no network connection is available when a Note is saved, THEN THE App SHALL queue the Email Summary and SHALL attempt delivery within 60 seconds of connectivity being restored.
5. WHERE the Email Summary feature is enabled, IF email delivery fails after three consecutive attempts, THEN THE App SHALL display a non-blocking notification informing the user of the delivery failure and SHALL retain the queued Email Summary for manual retry.
6. WHERE no recipient email address is configured, THE App SHALL NOT attempt to send any email.

---

### Requirement 9: Notification Shortcut for Quick Launch

**User Story:** As a user who needs to capture a note rapidly, I want a persistent shortcut on my device so that I can open the Capture Screen in one tap without unlocking and navigating the browser.

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
4. THE App SHALL NOT require a server-side component to save, view, or delete Notes.

---

### Requirement 11: Cloud Backup Integration

**User Story:** As a user who switches devices or reinstalls the app, I want my notes backed up to cloud storage so that I can restore them on a different device.

#### Acceptance Criteria

1. THE Settings screen SHALL provide an option to connect the App to a supported cloud backup provider (minimum: Google Drive). Google Drive SHALL always be offered on a deployed App; it SHALL NOT depend on configuration supplied by the user. Each user connects their own Google account.
2. WHERE a cloud backup provider is connected, WHEN a Note is saved and a network connection is available, THE App SHALL upload the Note to the configured cloud backup provider within 30 seconds.
3. WHERE a cloud backup provider is connected, IF a network connection is unavailable when a Note is saved, THEN THE App SHALL queue the upload and SHALL attempt it when connectivity is restored, retrying up to 3 times before marking the upload as failed.
4. WHERE a cloud backup provider is connected, IF a queued upload fails after 3 retry attempts, THEN THE App SHALL display an error message indicating that the Note could not be uploaded, and SHALL retain the Note in the upload queue for the next manual or automatic retry.
5. THE Settings screen SHALL provide an Import function that downloads and restores Notes from the connected cloud backup provider into Local Storage.
6. WHERE a cloud backup provider is connected, IF the Import function encounters a Note whose title and creation timestamp match an existing Local Storage Note, THEN THE App SHALL retain the existing Local Storage copy and SHALL NOT overwrite it with the downloaded copy.
7. WHERE a cloud backup provider is connected, THE App SHALL NOT delete Local Storage copies of Notes when cloud upload succeeds.
8. WHERE a cloud backup provider is connected, WHEN the provider's access authorisation expires, THE App SHALL renew it automatically without user interaction. IF the provider refuses renewal, THEN THE App SHALL mark the provider as disconnected and SHALL display a message prompting the user to reconnect.

---

### Requirement 12: Settings Management

**User Story:** As a user, I want a settings screen to configure optional features so that I can tailor the app's behaviour to my preferences.

#### Acceptance Criteria

1. THE App SHALL provide a Settings screen accessible from every screen via a persistent navigation element visible at all times.
2. THE Settings screen SHALL include a toggle to enable or disable Voice Transcription, defaulting to disabled when no prior setting has been persisted.
3. THE Settings screen SHALL include a toggle to enable or disable Email Summary, defaulting to disabled when no prior setting has been persisted.
4. THE Settings screen SHALL include a text field for the Email Summary recipient address, accepting values that conform to standard email address format (local-part@domain), with a maximum length of 254 characters.
5. IF the Email Summary toggle is disabled, THEN THE Settings screen SHALL disable the Email Summary recipient address text field, preventing input.
6. THE Settings screen SHALL include controls to connect or disconnect Cloud Backup providers, displaying the current connection status (connected or disconnected) for each provider.
7. IF a Cloud Backup provider connection attempt fails, THEN THE App SHALL display an error message indicating the connection could not be established and leave the provider's status as disconnected.
8. WHEN the user saves a change in Settings, THE App SHALL persist the change to Local Storage within 500 milliseconds and reflect the updated value immediately in the Settings screen without requiring a restart.
9. IF persisting a Settings change to Local Storage fails, THEN THE App SHALL display an error message indicating the setting could not be saved and revert the control to its previous value.
10. WHEN the App is launched, THE App SHALL load all Settings from Local Storage before rendering any screen, applying defaults for any settings not found in Local Storage.

---

### Requirement 13: Individual Note View

**User Story:** As a user reviewing a specific reminder, I want each note to have its own unique URL so that I can bookmark it, navigate directly to it, or share it on the same device without scrolling through the Journal.

#### Acceptance Criteria

1. EACH saved Note SHALL have a unique, persistent hash-based URL in the format `#/note/{id}`, where `{id}` is the Note's UUID.
2. WHEN the user navigates to `#/note/{id}`, THE App SHALL load the Note from Local Storage and display the Note Detail View showing the full Timestamp, Location, all Media Items, and Transcription (if present).
3. THE Note Detail View SHALL display audio Media Items using an inline audio player, photo Media Items at full displayable resolution, video Media Items using an inline video player with controls, and text Media Items in full preserving whitespace and line breaks.
4. IF a Media Item in the Note Detail View fails to load, THEN THE App SHALL display a placeholder indicating the media is unavailable in place of that item, without hiding the rest of the Note content.
5. WHEN the Journal displays a Note entry, THE App SHALL render a navigable link on each entry that navigates the user to that Note's `#/note/{id}` URL.
6. THE Note Detail View SHALL provide a back-navigation control that returns the user to the Journal (`#/journal`).
7. IF the user navigates directly to `#/note/{id}` and no Note with that `{id}` exists in Local Storage, THEN THE App SHALL display a "Note not found" message and SHALL provide a control to navigate to the Journal.
8. THE Note Detail View SHALL be fully accessible offline; the App SHALL load the Note from Local Storage without requiring a network request.