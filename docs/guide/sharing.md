# Sharing

## Sharing one knot

Every knot has a **📤 Share** button on its page, next to Edit and Delete. Tapping it opens your device's own share sheet, whatever it offers: email, messaging apps, Bluetooth, AirDrop, "Copy", and so on.

- The shared **text** is built from the knot: its timestamp, its place (a resolved address or coordinates, plus a Google Maps link, or a manually entered label), every text item, every transcript, and a summary line such as `(1 photo, 1 voice recording attached in e-Handkerchief)`.
- **Photos, videos and voice recordings** are attached as files too, but only when the browser supports sharing files and their combined size is 50 MB or less; otherwise just the text is shared.
- If the browser has no share sheet at all, the text is copied to the clipboard instead, with a toast confirming the copy. If the clipboard is denied too: "Sharing isn't supported in this browser".
- Cancelling the share sheet does nothing: no error, no toast.
- If sharing fails for another reason, the text is copied to the clipboard ("Couldn't share — knot copied to clipboard"), or you see "Couldn't share this knot".

## Sharing several knots at once

In the Knots list, tap **Select** to turn the entries into tick-boxes, pick the knots you want, and tap **Share (N)**. Tap **Cancel** to leave selection mode. Search works in Select mode, so you can share a set of search results.

Everything goes out as **one message**: a header line ("3 knots from e-Handkerchief"), each knot's text with a `———` line between knots, and the footer once at the end. Attached files are named so they never clash (`knot1-photo-1.jpg`, `knot2-photo-1.jpg`, …), and the 50 MB limit applies to all of them together; over that, just the text is shared.

## The "Shared from e-Handkerchief" footer

By default the text ends with **— Shared from e-Handkerchief** and a link to the app, so the people you share with can find it. Turn this off in **Settings → Sharing → Append source when sharing**. With it off there is no footer, and the multi-share header is "N knots" without the app name.

## Email

A **daily email summary** (an automatic digest of the day's knots, emailed to a recipient you configure) is planned but not built yet. **Settings → Daily Email Summary** still has the toggle and recipient field, saved for when it ships, but no email is sent. Until then, Share is how you get a knot out of the app.
