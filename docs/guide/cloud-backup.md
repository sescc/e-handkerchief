# Cloud backup (Google Drive)

Google Drive backup is optional and per user. Until you tap **Connect** in **Settings → Cloud Backup**, your knots stay only on this device. (On a copy of the app deployed with `DRIVE_BACKUP=off`, the Cloud Backup section is hidden and the app never contacts Google; see [Self-hosting](self-hosting.md#opting-out-of-drive-backup-forks).)

The app uses OAuth2 with PKCE and the Drive **app-data folder** scope, so it can only read and write its own backup files, never the rest of your Drive. Once connected, Settings shows which account it syncs to ("Connected as …"). **Disconnect** revokes the app's access.

## How sync works

Once connected, sync is **automatic and two-way**. A knot tied on one device shows up on another signed in to the same Google account, with no pairing step and no per-device setup beyond tapping Connect on each one. A sync runs:

- when the app starts (if connected and online),
- whenever the device comes back online,
- right after you connect,
- whenever you tap **Merge with Cloud**.

Each time you save a knot, it is also uploaded straight away (queued and retried if you're offline or the upload fails; after three failed attempts you're shown "Backup failed after 3 attempts … Tap to retry").

For each knot, if only one side changed since the two last agreed, the other side is updated to match. If **both** were edited, nothing is overwritten: you're asked to review it (see below). Checking a knot off syncs separately and never counts as an edit.

## Merge with Cloud

**Settings → Cloud Backup → Merge with Cloud** (greyed out, with a hint, when disconnected or offline) runs a sync on demand and tells you what happened: how many knots were brought in, how many were backed up (including any that were waiting to upload), and how many need your review, or "Already up to date — nothing to merge". Data is never deleted during a merge. Below the button, **Last merged** shows the time of the most recent successful sync, or "Not merged yet".

## When the same knot is edited on two devices

If you edit a knot on your phone and, before the two devices have synced, edit the same knot on your tablet, the app can't tell which version you want, so it **never picks one for you**. You'll see:

- a message: "1 knot also has edits from another device — tap to review",
- a **⚠ Also edited on another device** badge on the knot in the Knots list,
- a **Review** banner on its page.

The **Review changes** screen shows **On this device** and **Latest in the cloud** (with which device the cloud version came from and when), then lists what differs: changed text (lines marked − exist only on this device, lines marked + only in the cloud version), photos, videos or recordings that are only in one of them, transcripts and location. You choose:

- **Keep this device's version**: this device's copy replaces the cloud one.
- **Keep the cloud version**: the cloud copy replaces this device's.
- **Keep both**: this device's version stays, and the cloud version is saved as a **new knot**, which you can check off or delete later.

Reviewing needs an internet connection ("Connect to the internet to review this knot"). If the cloud version changes again while you're looking at it, nothing is overwritten; you're shown the newer version to review. With three or more devices, a review is always between the device you're holding and the newest version in the cloud, and only the device that has the unsynced edit is asked.

## Two kinds of delete

The app explains this in Settings, directly under the **Manage backups** button.

- **Manage backups** deletes a knot's **cloud backup**. Copies already on your devices are not deleted, and they won't be backed up again unless you edit them.
- **Deleting a knot** (from the Knots list or its page) removes it from **this device only**. Its cloud backup is kept, and your other devices keep their copies.

## Manage backups

Files in Drive's app-data folder are Google's *hidden* app data: they don't show up in the Drive website or the Drive app. The only built-in way to remove them is Google's account-level "Delete hidden app data" tool, which is all-or-nothing (every app's hidden data) and only available from a desktop browser. **Manage backups** is the way to remove one knot's backup without that.

Tap **Manage backups** (needs a connection) to list what's in Drive. Each row shows a description (date, place and the start of the text), whether the knot is **On this device** or **Only in backup**, a **Checked off** badge where relevant, and a **Delete** button (with a confirmation).

**Old-format backups** ("Old-format backup …", marked "Old format") are files left by very early versions of the app. They are never imported into the app and are safe to delete here.

To find a backup in a long list:

- Type in the **filter box** ("Filter by date, place or text"). Every word you type must appear in the row's main line (its description, or, for a backup without one, the "Backup from …" / "Old-format backup …" line), ignoring case and accents.
- Use the chips **All · Backup only · Checked off · On device** to narrow the list. They can be combined: *Backup only* are backups with no copy on this device, *On device* are backups whose knot is also on this device (turn both on to see either), and *Checked off* are backups of knots you've checked off, which narrows whatever the other chips show. Tap a chip again to turn it off; *All* clears the chips. Old-format backups appear only when no chip is on.
- A "Showing N of M" line tells you how many rows match, or "No backups match".

Filtering works on the list already loaded, so it doesn't call Google Drive again.

## Badges for knots that are not in Drive

Manage backups lists what is in Google Drive, so a knot that exists only on this device never appears there. While Drive is connected, the Knots list and the knot page flag such knots instead:

- **☁ Not backed up**: not uploaded yet, for example because you saved it offline or the upload failed. It backs up automatically when you're online.
- **☁ Backup deleted**: you deleted its backup in Manage backups. Edit the knot to back it up again.

Nothing is shown while a knot is uploading, while it is waiting for a conflict review, or when Drive isn't connected.
