# Contributing

Thanks for your interest in e-Handkerchief. This page covers what you need to build, test and change it. For using or self-hosting the app see the [README](README.md) and `docs/guide/`.

## Setup and tests

You need Node.js (20 or newer). There are no runtime dependencies; TypeScript is the only dev dependency.

```sh
npm ci
npm test
```

`npm test` compiles the app (`tsc`) and the service worker (`tsc -p tsconfig.sw.json`), then runs every compiled `src/**/*.chartest.js` and `src/**/*.proptest.js` with `node` (`scripts/run-tests.js`). It exits non-zero if anything fails to compile or any test file fails.

### How tests are written

There is no test framework. Each pure module has a small dependency-free test file beside it (`foo.ts` and `foo.chartest.ts`, or `foo.proptest.ts` for property-style tests). It runs under plain `node` after compiling, prints one PASS/FAIL line per case, and exits non-zero on failure. Put decision logic in pure modules so it can be tested this way; screens and services call into them.

## Preview locally

```sh
npx tsc && npx tsc -p tsconfig.sw.json
python -m http.server 8080        # or: npx serve .
```

Open `http://localhost:8080`. HTTPS is needed for the service worker, geolocation and the microphone on real devices (not on `localhost`); use a tunnel such as `ngrok http 8080` for device testing. Locally the Google Drive configuration is empty, so Connect shows "Google Drive client ID not configured".

## The service worker is a classic script

`sw.js` is registered as a classic script, so `sw.ts` must not contain any `import` or `export` (not even `export {};`). A module-syntax file fails to evaluate and no service worker runs at all. After compiling, check that it still parses as a classic script (CI runs the same check and fails the deploy otherwise):

```sh
node -e "new Function(require('fs').readFileSync('sw.js','utf8'))"
```

Every file listed in the service worker's precache list must exist after `tsc`; if you add a module that the app loads, add it there.

## The spec of record

`.kiro/specs/e-handkerchief/` holds the requirements (`requirements.md`) and the design (`design.md`, including the file-level tree, the properties each test pins and the known limitations). Keep both updated when you change behaviour or structure: a behaviour change updates `requirements.md`, a structural change updates `design.md`.

## Decision log

`CLAUDE.md` records the decisions made (what, who, why) and the edge cases discussed with how they're handled, per working session. Append to it rather than rewriting it, and mark superseded decisions instead of deleting them. Per-session hand-off notes live in `docs/sessions/`.

## No personal data in the repo

Treat the repository as public. Commit nothing identifying: no real names, usernames, email addresses, home or machine paths, private URLs, account or project ids, or location and time-zone hints. Use placeholders such as `<your-user>` and repo-relative paths in docs. Personal configuration belongs in git-ignored local files (`.env.local`, `.dev.vars`), and secrets only in Cloudflare Worker secrets or GitHub Actions secrets, never in the repo. Use neutral defaults in shipped code (for example UTC).

## Docs

The user and operator guide is in `docs/guide/` (`Home.md` is the index). CI mirrors it to the GitHub Wiki, so link only between guide pages there and refer to other repository files as plain code paths.

## License

By contributing you agree that your contribution is licensed under the project's [PolyForm Noncommercial License 1.0.0](LICENSE).
