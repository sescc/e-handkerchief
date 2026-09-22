// Runtime configuration injected at build time.
// The placeholders below are replaced by the CI deploy workflow with the
// GOOGLE_CLIENT_ID and OAUTH_BROKER_URL GitHub Actions secrets. Placeholders
// must stay distinct from the global names (window.__GOOGLE_CLIENT_ID__ etc.),
// otherwise the replacement would also rewrite the assignment targets and break
// this script. If they are not replaced (e.g. local dev), the app treats cloud
// backup as unconfigured and shows "Google Drive client ID not configured".
(function () {
  var CLIENT_ID = '@@GOOGLE_CLIENT_ID@@';
  var BROKER_URL = '@@OAUTH_BROKER_URL@@';
  // Guard: if a placeholder was never replaced, leave the global empty so the
  // app's own "not configured" handling kicks in rather than sending the literal
  // placeholder to Google.
  window.__GOOGLE_CLIENT_ID__ =
    CLIENT_ID === ('@@GOOGLE' + '_CLIENT_ID@@') ? '' : CLIENT_ID;
  window.__OAUTH_BROKER_URL__ =
    BROKER_URL === ('@@OAUTH' + '_BROKER_URL@@') ? '' : BROKER_URL.replace(/\/+$/, '');
})();
