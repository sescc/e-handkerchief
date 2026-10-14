# Capturing knots

The Capture screen (the **+** tab) is where you tie a knot. A knot holds one or more items (text, photos, videos, voice recordings), a timestamp and, usually, a location.

## Location

On opening, Capture asks the browser for your GPS position (up to 10 seconds online) and shows it, with a street address when one can be looked up. You can save the knot at any time with whatever location is known by then (none if it never arrived).

If it fails, the location line becomes a tappable message. Tap it to try again ("Getting location…").

| Message | Meaning |
| ------- | ------- |
| Location is off — turn it on, then tap to retry | The site is allowed, but your phone's own Location setting is off. |
| Location unavailable — tap to retry | Anything else: no fix arrived in time, the position couldn't be worked out, or the browser refused for a reason it can't identify. |

There is deliberately no "blocked for this site" message. Android Chrome reports a blocked site, a phone with Location switched off, and Chrome lacking Android's location permission in the same way, so the app can't tell them apart. If the generic message keeps appearing, check your phone's Location switch, Chrome's Android location permission, and the site's permission in Chrome. A blocked site fails immediately on every retry until you allow it in your browser's site settings.

### Offline

With no internet there is no assisted GPS, so a first fix can take much longer. The app then waits up to **2 minutes** ("Getting location (no internet — GPS can take a minute or two)…") instead of 10 seconds.

The coordinates are saved with the knot. The street address needs internet, so it is filled in automatically the next time this device is online (at app start, or when the connection returns), and the knot is backed up again with it. Only the device that tied the knot does this. A knot with a manual location label, or one you've already deleted, is skipped.

Addresses come from OpenStreetMap's Nominatim service, at most about one lookup per second and ten knots per run.

## Photo, Video and Library

- **📷 Photo** and **🎬 Video** add a photo or video. They accept photos (JPEG, PNG, GIF, WEBP) and videos (MP4, MOV) only.
- **🖼️ Library** opens a small menu under the buttons:
  - **🖼️ Photo or video** opens your phone's photo picker (the same formats).
  - **🎵 Audio file** opens a file picker for audio, for example a recording made with your phone's recorder app.

The menu closes when you tap Library again, press Escape, pick a file, or use another button.

**File size:** a single file can be at most 100 MB ("File exceeds the 100 MB size limit. Please choose a smaller file.").

**Pick-time read:** a picked file is read into memory straight away. On phones, files from cloud-backed galleries (for example a photo that hasn't finished downloading) can be unreadable at that moment, so the app tells you right away ("Couldn't read that file — it may still be downloading to your phone. Wait a moment, then pick it again.") instead of failing later when you save.

**Save failures:** if saving ever fails because of an attached file, the message says so ("Could not tie knot — a photo, video or audio file couldn't be saved. Remove it and pick it again." on Capture; "Could not save changes — …" on Edit). Your form and attachments are kept, so you can remove that item and save again. On the Edit screen, Save shows "Saving…" and ignores extra taps while it works.

## Audio files

An audio file picked through **Library › Audio file** becomes a voice recording on the knot. You can play it, and transcribe it later with **🎧 Transcribe voice** on the knot's page (this needs your transcription Worker; see below).

Supported formats are the ones the transcription service understands: **MP3, M4A, WAV, OGG (including Opus), FLAC and WEBM audio**. Raw AAC, WMA and AMR aren't supported ("Unsupported file format. …").

Very large files such as long WAV or FLAC recordings can exceed the transcription provider's size limit (25 MB on Groq's free tier). The audio is still saved and playable, but **Transcribe voice** reports an error.

## Voice: Mic, Dictate and transcription

There are three sources of spoken content, and they behave differently.

| Source | What it does | Needs internet? |
| ------ | ------------ | --------------- |
| **🎤 Mic** | Records audio and saves it as a voice recording. With **Voice Transcription** on (Settings) and a browser that supports it (Chrome on Android), it is also transcribed live while you record. | Live transcription needs internet; the recording itself doesn't. |
| **🗣 Dictate** | Live speech-to-text into the knot's text, no audio saved. | See below. |
| **🎵 Audio file** (Library) | Attaches an existing recording. Transcribed later. | Transcribing needs internet and your Worker. |

### Mic

- **Online:** the recording is transcribed live through the browser's Web Speech API as you speak, and the audio is saved too. When the browser revises or re-delivers words, which Android does with fast speech and after a restart following a pause, the app merges them so text isn't repeated or lost. Rare known limits exist: for example, a deliberate repeat of two or more words across a pause can collapse into one (the known limits are listed in `.kiro/specs/e-handkerchief/design.md`).
- **Offline, or live transcription unavailable:** the audio is saved and marked "transcription pending". Later, when online, open the knot and tap **🎧 Transcribe voice** to transcribe it through your transcription Worker; the transcript is added to that recording.
- Mic recordings are made without call-style processing (echo cancellation, noise suppression and automatic gain control are off), which keeps them clean. If a phone records too quietly, that is a one-line change in `src/mediaService.ts`.
- Mic decides **at the start** whether to transcribe live, by checking whether the device is online.

### Dictate

- Dictate is live speech-to-text into the knot's text. **Dictate also works offline on devices with offline speech recognition.**
- Unlike Mic, Dictate does not check connectivity itself. It relies on the browser's own speech recogniser, so it works wherever that recogniser can run on-device (for example Android with the offline speech language installed). Where the recogniser needs the cloud, dictating offline shows "Speech recognition needs internet (it runs in the cloud on this browser)."
- You can't record with Mic and dictate at the same time ("Stop dictation before recording." / "Stop the voice recording before dictating.").

### Setting up deferred transcription (optional)

Transcribing saved audio later needs a small backend that holds a Groq API key; the key must never live in the app. See [Self-hosting](self-hosting.md#transcription-worker-optional) to deploy the `transcribe-worker/`, then paste its URL into **Settings → Voice Transcription → Transcription server URL**. Live transcription does **not** need this server.

If something goes wrong, [Troubleshooting](troubleshooting.md) lists every message.
