# Troubleshooting

Every message the app can show, grouped by where you meet it, and what to do about it.

## Location

| Message | What to do |
| ------- | ---------- |
| Getting location… / Getting location (no internet — GPS can take a minute or two)… | Wait. Online it gives up after 10 seconds; offline it waits up to 2 minutes. You can save the knot at any time. |
| Location is off — turn it on, then tap to retry | Turn on your phone's Location switch, then tap the line. |
| Location unavailable — tap to retry | Tap to try again. If it keeps happening, check your phone's Location switch, Chrome's Android location permission, and the site's permission in Chrome. See [Capturing knots](capturing.md#location). |

## Saving and attaching files

| Message | What to do |
| ------- | ---------- |
| Please add at least one item before saving. | A knot needs text or a media item. |
| A knot must have at least one item. Add some text or keep a media item. | Same, on the Edit screen. |
| File exceeds the 100 MB size limit. Please choose a smaller file. | Pick a smaller file. |
| Unsupported file format. Please use JPEG, PNG, GIF, WEBP, MP4, MOV, or an audio file (MP3, M4A, WAV, OGG, FLAC, WEBM). | Convert the file. AAC, WMA and AMR audio aren't supported. Audio goes through **Library › Audio file**, not Photo or Video. |
| Couldn't read that file — it may still be downloading to your phone. Wait a moment, then pick it again. | The file isn't fully on the phone yet (often a cloud-gallery item). Wait, then pick it again. |
| Could not tie knot — a photo, video or audio file couldn't be saved. Remove it and pick it again. (Edit: "Could not save changes — …") | Remove the attachment, pick it again, and save. Your form is kept. |
| Could not tie knot: … / Could not save changes: … (with a detail) | Some other save error, for example storage is full. Free space and retry. |
| Media capture is not supported in this browser. / Voice recording is not supported in this browser. | Use a browser that supports it (Chrome on Android is best supported). |
| Microphone access required. Please allow microphone permissions. | Allow the microphone for the site in browser settings. |
| Could not capture media: … | The browser reported a problem capturing; retry or use Library. |
| Media unavailable | A media file could not be read from storage. |
| Could not load knots / Could not save — please try again / Could not undo — please try again | A local storage operation failed. Try again; reload the app if it persists. |
| This knot isn't on this device. | The link points to a knot that was deleted or lives only on another device. Go back to Knots. |

## Voice: Mic, Dictate, transcription

| Message | What to do |
| ------- | ---------- |
| Stop dictation before recording. / Stop the voice recording before dictating. | Mic and Dictate can't run together; stop one first. |
| Speech recognition isn't supported in this browser. | Use Chrome on Android, or type instead. |
| Microphone permission denied for dictation. | Allow the microphone for the site. |
| No speech detected — try speaking, then tap Stop. / No speech detected. | Speak, then tap Stop. |
| Speech recognition needs internet (it runs in the cloud on this browser). | Go online. Dictate works offline only where the device supports offline speech recognition ([Capturing knots](capturing.md#dictate)). |
| No microphone available for dictation. | Check that a microphone is connected and not in use. |
| Recognition ended without capturing speech. Tap Dictate again and speak, or check mic permissions. | Tap Dictate again and speak. |
| Dictation error: … | A recogniser error code; retry. |
| Live transcript unavailable right now — your audio is still recording and can be transcribed after saving. / Live transcription isn't producing text on this device. … | The audio is safe. After saving, open the knot and tap **🎧 Transcribe voice**. |
| Saved. Live transcription was blocked (mic permission). You can transcribe later from the knot. | Allow the mic, or transcribe later. |
| Saved. No speech detected for live transcription. | Transcribe later if you expected speech. |
| Saved. Live transcription isn't supported in this browser. | Transcribe later from the knot. |
| Saved. Offline — transcribe later from the knot when online. | Go online, open the knot, tap **🎧 Transcribe voice**. |
| Saved. Live transcription didn't work on this device — open the knot and tap 'Transcribe voice' to transcribe it via your server. | Needs your transcription Worker. |
| Saved. Voice transcription was unavailable — you can transcribe later from the knot. | Same. |
| Saved. To transcribe the audio file, open the knot and tap 'Transcribe voice'. | Imported audio is never live-transcribed. Open the knot to transcribe it. |
| Voice not yet transcribed. / Last transcription attempt failed. | Tap **🎧 Transcribe voice** (or retry). |
| Set a transcription server URL in Settings first. | Deploy `transcribe-worker/` and set the URL ([Self-hosting](self-hosting.md#transcription-worker-optional)). |
| No internet connection — try again later. / No internet connection. | Go online and retry. |
| Transcription server URL must start with https:// | Fix the URL in Settings. |
| No transcription server configured in Settings. | Set the URL in Settings → Voice Transcription. |
| Invalid email address | The Daily Email Summary recipient isn't a valid address (the feature is not live yet). |
| Could not reach the transcription server: … | Check the Worker URL and that the Worker is deployed; check its `ALLOWED_ORIGIN` includes your site's origin. |
| Server error (…) / Unexpected server response. | The Worker or Groq returned an error; check the Worker, the Groq key and Groq's file-size limit (25 MB on the free tier). |
| Transcription added / Re-transcribed / Transcript saved | Success messages. |

## Notifications

| Message | What to do |
| ------- | ---------- |
| Blocked in browser settings | Allow notifications for the site in your browser's site settings. |
| Couldn't show the notification (…). Switch this off and on to try again. | The reason in brackets says why (for example "service worker not ready"). Switch the toggle off and on; reload the app once online so the service worker installs. |

## Sharing

| Message | What to do |
| ------- | ---------- |
| Knot copied to clipboard / Knots copied to clipboard | The browser has no share sheet, so the text was copied. |
| Couldn't share — knot copied to clipboard (or "knots") | Sharing failed; the text was copied instead. |
| Couldn't share this knot / Couldn't share these knots | Neither sharing nor copying worked. Try again. |
| Sharing isn't supported in this browser | Neither the share sheet nor the clipboard is available. |

## Google Drive and sync

| Message | What to do |
| ------- | ---------- |
| Google Drive client ID not configured | You're running a local or otherwise unconfigured copy: the Google client ID was never injected (a normal deploy fails without it, and a `DRIVE_BACKUP=off` deploy hides the section). See [Self-hosting](self-hosting.md#google-drive-backup). |
| Could not connect to Google Drive | The sign-in or token exchange failed. Retry; operators should check the OAuth Worker, its secrets and `ALLOWED_ORIGIN`, and the OAuth client's redirect URI. |
| Google Drive connection cancelled | You cancelled the Google consent screen. Tap Connect to try again. |
| Google Drive session expired — please reconnect | Google revoked or expired the refresh token. Tap Connect again. If it happens about weekly on a self-hosted copy, the Google OAuth consent screen is probably still in *Testing* status, where refresh tokens last 7 days ([Self-hosting](self-hosting.md#1-create-the-google-oauth-client)). |
| Old-format backup … / Old format | Leftover files from very early app versions; never imported. Safe to delete in Manage backups. |
| Merge failed — check your connection | Go online and retry Merge with Cloud. |
| Already up to date — nothing to merge | Nothing to do. |
| Merged — N knots brought in, N backed up, N need review | Success. Knots that "need review" are explained below. |
| Backup failed after 3 attempts — knot … not backed up. Tap to retry. / N knots not backed up. Tap to retry. | Tap the message to retry; check your connection and that you're still connected. |
| N knot(s) also has/have edits from another device — tap to review | Tap to open **Review changes** ([Cloud backup](cloud-backup.md#when-the-same-knot-is-edited-on-two-devices)). |
| Connect to the internet to review this knot | Review needs a connection. |
| This knot changed again on another device — please review the latest version | The cloud copy changed while you were reviewing. Nothing was overwritten; review the newer version. |
| Couldn't finish — please try again. Nothing was deleted. | Retry the choice. |
| Kept this device's version / Kept the cloud version / Kept both versions | Success. |
| Could not load backups — check your connection / Could not delete backup — check your connection | Go online and retry. |
| No backups in Google Drive yet. | Nothing is backed up yet. |
| Backup deleted | The cloud backup was removed; the knot stays on your devices. |
| ☁ Not backed up / ☁ Backup deleted | See [Cloud backup](cloud-backup.md#badges-for-knots-that-are-not-in-drive). |
| ⚠ Also edited on another device | The knot needs a conflict review. |
| Could not save setting | Settings couldn't be written to local storage; retry. |

## Updates and offline

| Message | What to do |
| ------- | ---------- |
| New version available — tap to reload | Tap it to load the latest version. |

If the app won't start offline, open it once while online so the service worker can cache it, then fully close and reopen it. If a problem persists, report it with the exact message.
