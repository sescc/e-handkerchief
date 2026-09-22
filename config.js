// Runtime configuration injected at build time.
// `__GOOGLE_CLIENT_ID__` is replaced by the CI deploy workflow with the value
// of the GOOGLE_CLIENT_ID GitHub Actions secret. If it is not replaced (e.g.
// local dev or the secret is unset), the app treats cloud backup as
// unconfigured and shows "Google Drive client ID not configured".
(function () {
  var CLIENT_ID = '__GOOGLE_CLIENT_ID__';
  // Guard: if the placeholder was never replaced, leave the global empty so the
  // app's own "not configured" handling kicks in rather than sending the literal
  // placeholder to Google.
  window.__GOOGLE_CLIENT_ID__ =
    CLIENT_ID === ('__GOOGLE' + '_CLIENT_ID__') ? '' : CLIENT_ID;
})();
