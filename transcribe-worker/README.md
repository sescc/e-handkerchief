# e-Handkerchief Transcription Worker

A tiny [Cloudflare Worker](https://developers.cloudflare.com/workers/) that proxies audio
transcription requests to [Groq's Whisper API](https://console.groq.com/docs/speech-text).

The e-Handkerchief PWA (hosted on GitHub Pages) records an audio clip and `POST`s it to this
Worker. The Worker forwards the audio to Groq using a secret API key and returns the transcript
JSON. This keeps the Groq API key **off the client** and **out of version control** — the key lives
only as an encrypted Cloudflare secret.

```
Browser (PWA)  ──POST multipart/form-data──▶  Cloudflare Worker  ──Bearer key──▶  Groq Whisper
     ▲                                                                                  │
     └──────────────────────  { "text": "…" }  ◀──────────────────────────────────────┘
```

## Why a proxy?

Whisper API keys must not be shipped in front-end code — anyone could read them from the browser.
By routing through a Worker, the key stays server-side as a Cloudflare secret. This folder therefore
contains **no secrets** and is safe to publish.

---

## Prerequisites

- A free **Cloudflare account** — <https://dash.cloudflare.com/sign-up>
- A free **Groq API key** — <https://console.groq.com> (create an account, then generate an API key)
- **Node.js** installed locally (for running `wrangler`, the Cloudflare CLI)

---

## Setup & Deploy

From this folder:

1. **Install dependencies**
   ```bash
   cd transcribe-worker
   npm install
   ```

2. **Log in to Cloudflare** (opens a browser to authorize `wrangler`)
   ```bash
   npx wrangler login
   ```

3. **Set the Groq API key as a secret**
   ```bash
   npx wrangler secret put GROQ_API_KEY
   ```
   Paste your Groq key when prompted. It is stored **encrypted in Cloudflare** and is never written
   to this repo.

4. **(Recommended) Lock down CORS.** Edit `wrangler.toml` and set `ALLOWED_ORIGIN` to your
   GitHub Pages origin, e.g.:
   ```toml
   [vars]
   ALLOWED_ORIGIN = "https://YOUR_USERNAME.github.io"
   ```
   If left unset, the Worker allows all origins (`*`) — convenient for testing, less secure.

5. **Deploy**
   ```bash
   npx wrangler deploy
   ```
   Wrangler prints your Worker URL, e.g.:
   ```
   https://ehk-transcribe.<your-subdomain>.workers.dev
   ```

6. **Copy that URL** and paste it into the e-Handkerchief PWA **Settings** as the
   **"Transcription server URL"**.

---

## Local testing

For local development you can supply the secret via a `.dev.vars` file (git-ignored):

```bash
cp .dev.vars.example .dev.vars
# edit .dev.vars and paste your Groq key
npm run dev
```

`wrangler dev` starts a local server (usually `http://localhost:8787`). Point the PWA at that URL
or test with `curl`:

```bash
curl -X POST http://localhost:8787 \
  -F "file=@sample.webm" \
  -F "language=en"
```

Expected response:

```json
{ "text": "…transcribed text…" }
```

---

## API

**`POST /`** (any path is accepted)

- Body: `multipart/form-data`
  - `file` (required) — the audio blob (webm/ogg/wav/mp3/…)
  - `language` (optional) — an ISO language hint, e.g. `en`
- Response: `200` with `{ "text": "…" }`

The Worker always sends the `whisper-large-v3-turbo` model to Groq with `response_format=json`.

**`OPTIONS /`** — CORS preflight, returns `204` with CORS headers.

Any other method returns `405`.

### Error responses

| Status | Meaning |
| ------ | ------- |
| `400`  | Missing `file` field / not multipart form data |
| `405`  | Method not allowed (not POST/OPTIONS) |
| `500`  | Worker misconfigured (secret `GROQ_API_KEY` not set) |
| `502`  | Couldn't reach Groq, or Groq returned an unexpected response |
| other  | Groq's own error status is passed through with a `detail` snippet |

All responses include CORS headers.

---

## Security notes

- The Groq API key is a **Cloudflare secret** (`wrangler secret put GROQ_API_KEY`). It is never in
  this source tree, so **this repo is safe to push publicly**.
- Set `ALLOWED_ORIGIN` in `wrangler.toml` to restrict CORS to your PWA's origin so other sites
  can't use your Worker (and your Groq quota).
- `.dev.vars` (local secrets) is git-ignored — do not commit it.

---

## Free tier notes

- **Cloudflare Workers** free plan: ~100,000 requests/day — plenty for personal use.
- **Groq** free tier: generous limits for Whisper transcription.

Usage will vary; check each provider's current limits.

---

## Repo layout

- This Worker lives in the `transcribe-worker/` subfolder of the e-Handkerchief monorepo — the same
  git repository as the PWA.
- It deploys independently of the PWA (via `wrangler deploy`), but shares the repo, so a single
  `git push` backs up both the app and this Worker.
- The folder contains **no secrets**, so committing it to the (public or private) e-Handkerchief
  repo is safe.
