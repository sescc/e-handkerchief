// Runtime configuration injected at build time.
// The CLIENT_ID placeholder below is replaced by the CI deploy workflow with the
// value of the GOOGLE_CLIENT_ID GitHub Actions secret. The placeholder must stay
// distinct from the global name (window.__GOOGLE_CLIENT_ID__), otherwise the
// replacement would also rewrite the assignment target and break this script.
// If it is not replaced (e.g. local dev or the secret is unset), the app treats
// cloud backup as unconfigured and shows "Google Drive client ID not configured".
(function () {
  var CLIENT_ID = '@@GOOGLE_CLIENT_ID@@';
  // Guard: if the placeholder was never replaced, leave the global empty so the
  // app's own "not configured" handling kicks in rather than sending the literal
  // placeholder to Google.
  window.__GOOGLE_CLIENT_ID__ =
    CLIENT_ID === ('@@GOOGLE' + '_CLIENT_ID@@') ? '' : CLIENT_ID;
})();
