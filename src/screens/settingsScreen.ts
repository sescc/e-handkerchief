// ============================================================
// e-Handkerchief — SettingsScreen
// Configure optional features: transcription, email, cloud backup.
// ============================================================

import { settingsStore } from '../settingsStore.js';
import { cloudSyncService, type BackupEntry } from '../cloudSyncService.js';
import { knotStore } from '../knotStore.js';
import { toastService } from '../toastService.js';
import { formatKnotTimestamp, getTimezoneOptions } from '../dateFormat.js';
import { createTimezoneCombobox } from '../components/timezoneCombobox.js';
import type { AppSettings } from '../types.js';

// RFC 5321-compatible email regex (local-part@domain)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function renderSettings(container: HTMLElement): () => void {
  const listenerCleanups: Array<() => void> = [];
  let unsubscribeSettings: (() => void) | null = null;
  let unsubscribeStatus: (() => void) | null = null;

  const root = document.createElement('div');
  root.className = 'settings-screen';

  const titleEl = document.createElement('h1');
  titleEl.className = 'page-title';
  titleEl.textContent = 'Settings';
  root.appendChild(titleEl);

  const current = settingsStore.getCurrent();

  // =========================================================
  // Section: Transcription
  // =========================================================
  const transcriptionSection = document.createElement('div');
  transcriptionSection.className = 'settings-section';

  const transcriptionRow = document.createElement('div');
  transcriptionRow.className = 'settings-row';

  const transcriptionLabelWrap = document.createElement('div');
  const transcriptionLabel = document.createElement('div');
  transcriptionLabel.className = 'settings-row-label';
  transcriptionLabel.textContent = 'Voice Transcription';
  const transcriptionDesc = document.createElement('div');
  transcriptionDesc.className = 'settings-row-desc';
  transcriptionDesc.textContent =
    'Live transcription while recording (needs internet, Chrome on Android). Offline recordings can be transcribed later.';
  transcriptionLabelWrap.appendChild(transcriptionLabel);
  transcriptionLabelWrap.appendChild(transcriptionDesc);
  transcriptionRow.appendChild(transcriptionLabelWrap);

  const transcriptionToggle = buildToggle(current.transcriptionEnabled);
  transcriptionRow.appendChild(transcriptionToggle.wrapper);
  transcriptionSection.appendChild(transcriptionRow);

  // --- Transcription server URL (optional) ---
  const serverUrlGroup = document.createElement('div');
  serverUrlGroup.className = 'form-group mt-sm';

  const serverUrlLabel = document.createElement('label');
  serverUrlLabel.className = 'form-label';
  serverUrlLabel.textContent = 'Transcription server URL (optional)';
  serverUrlGroup.appendChild(serverUrlLabel);

  const serverUrlHelp = document.createElement('div');
  serverUrlHelp.className = 'settings-row-desc';
  serverUrlHelp.textContent =
    'For transcribing offline recordings later via your Groq/Cloudflare Worker. Leave blank to use live transcription only.';
  serverUrlGroup.appendChild(serverUrlHelp);

  const serverUrlInput = document.createElement('input');
  serverUrlInput.type = 'url';
  serverUrlInput.className = 'form-input';
  serverUrlInput.placeholder = 'https://ehk-transcribe.you.workers.dev';
  serverUrlInput.value = current.transcriptionServerUrl;
  serverUrlGroup.appendChild(serverUrlInput);

  transcriptionSection.appendChild(serverUrlGroup);
  root.appendChild(transcriptionSection);

  const onServerUrlBlur = async (): Promise<void> => {
    const value = serverUrlInput.value.trim();
    const prev = settingsStore.getCurrent().transcriptionServerUrl;
    if (value === prev) return;
    try {
      await settingsStore.save({ transcriptionServerUrl: value });
      serverUrlInput.value = value;
    } catch {
      serverUrlInput.value = prev;
      toastService.show('Could not save setting');
    }
  };
  serverUrlInput.addEventListener('blur', () => void onServerUrlBlur());
  listenerCleanups.push(() =>
    serverUrlInput.removeEventListener('blur', () => void onServerUrlBlur())
  );

  const onTranscriptionChange = async (): Promise<void> => {
    const prev = settingsStore.getCurrent().transcriptionEnabled;
    const next = transcriptionToggle.input.checked;
    try {
      await settingsStore.save({ transcriptionEnabled: next });
    } catch {
      transcriptionToggle.input.checked = prev;
      toastService.show('Could not save setting');
    }
  };
  transcriptionToggle.input.addEventListener('change', () => void onTranscriptionChange());
  listenerCleanups.push(() =>
    transcriptionToggle.input.removeEventListener('change', () => void onTranscriptionChange())
  );

  // =========================================================
  // Section: Daily Email Summary
  // =========================================================
  const emailSection = document.createElement('div');
  emailSection.className = 'settings-section';

  const emailHeading = document.createElement('h2');
  emailHeading.textContent = 'Daily Email Summary';
  emailSection.appendChild(emailHeading);

  const emailRow = document.createElement('div');
  emailRow.className = 'settings-row';

  const emailLabelWrap = document.createElement('div');
  const emailLabel = document.createElement('div');
  emailLabel.className = 'settings-row-label';
  emailLabel.textContent = 'Enable daily email summary';
  emailLabelWrap.appendChild(emailLabel);
  emailRow.appendChild(emailLabelWrap);

  const emailToggle = buildToggle(current.emailSummaryEnabled);
  emailRow.appendChild(emailToggle.wrapper);
  emailSection.appendChild(emailRow);

  // Not implemented yet — the toggle/recipient are saved for when it ships.
  // Sharing a single knot right now goes through the Share button instead.
  const emailComingSoonHint = document.createElement('div');
  emailComingSoonHint.className = 'settings-row-desc mt-sm';
  emailComingSoonHint.textContent =
    "Coming soon — your recipient address is saved for when it's available. To send a single knot now, open it and tap Share.";
  emailSection.appendChild(emailComingSoonHint);

  // Recipient field
  const recipientGroup = document.createElement('div');
  recipientGroup.className = 'form-group mt-sm';

  const recipientLabel = document.createElement('label');
  recipientLabel.className = 'form-label';
  recipientLabel.textContent = 'Recipient Email';
  recipientGroup.appendChild(recipientLabel);

  const recipientInput = document.createElement('input');
  recipientInput.type = 'email';
  recipientInput.className = 'form-input';
  recipientInput.maxLength = 254;
  recipientInput.placeholder = 'you@example.com';
  recipientInput.value = current.emailSummaryRecipient ?? '';
  recipientInput.disabled = !current.emailSummaryEnabled;
  recipientGroup.appendChild(recipientInput);

  const recipientError = document.createElement('div');
  recipientError.className = 'error-message';
  recipientError.style.display = 'none';
  recipientError.textContent = 'Invalid email address';
  recipientGroup.appendChild(recipientError);

  emailSection.appendChild(recipientGroup);
  root.appendChild(emailSection);

  const onEmailToggleChange = async (): Promise<void> => {
    const prev = settingsStore.getCurrent().emailSummaryEnabled;
    const next = emailToggle.input.checked;
    try {
      await settingsStore.save({ emailSummaryEnabled: next });
      recipientInput.disabled = !next;
    } catch {
      emailToggle.input.checked = prev;
      toastService.show('Could not save setting');
    }
  };
  emailToggle.input.addEventListener('change', () => void onEmailToggleChange());
  listenerCleanups.push(() =>
    emailToggle.input.removeEventListener('change', () => void onEmailToggleChange())
  );

  const onRecipientBlur = async (): Promise<void> => {
    const value = recipientInput.value.trim();
    if (value === '') {
      // Empty is allowed — clear recipient
      recipientError.style.display = 'none';
      try {
        await settingsStore.save({ emailSummaryRecipient: null });
      } catch {
        toastService.show('Could not save setting');
      }
      return;
    }

    if (!EMAIL_REGEX.test(value) || value.length > 254) {
      recipientError.style.display = 'flex';
      // Do not save the invalid address; revert to previous stored value
      recipientInput.value = settingsStore.getCurrent().emailSummaryRecipient ?? '';
      return;
    }

    recipientError.style.display = 'none';
    const prev = settingsStore.getCurrent().emailSummaryRecipient;
    try {
      await settingsStore.save({ emailSummaryRecipient: value });
    } catch {
      recipientInput.value = prev ?? '';
      toastService.show('Could not save setting');
    }
  };
  recipientInput.addEventListener('blur', () => void onRecipientBlur());
  listenerCleanups.push(() =>
    recipientInput.removeEventListener('blur', () => void onRecipientBlur())
  );

  // =========================================================
  // Section: Date & Time
  // =========================================================
  const dateTimeSection = document.createElement('div');
  dateTimeSection.className = 'settings-section';

  const dateTimeHeading = document.createElement('h2');
  dateTimeHeading.textContent = 'Date & Time';
  dateTimeSection.appendChild(dateTimeHeading);

  // --- Timezone ---
  const tzGroup = document.createElement('div');
  tzGroup.className = 'form-group';
  const tzLabel = document.createElement('label');
  tzLabel.className = 'form-label';
  tzLabel.textContent = 'Timezone';
  tzGroup.appendChild(tzLabel);
  // onSelect: save/preview/revert/no-op flow (refined & reviewed by task 7.2).
  const onTimezoneSelect = async (next: string): Promise<void> => {
    const prev = settingsStore.getCurrent().timezone;
    if (next === prev) return; // no-op skip (Req 6.4)
    try {
      await settingsStore.save({ timezone: next });
      updateDateTimePreview();
    } catch {
      tzControl.setValue(prev);
      toastService.show('Could not save setting');
    }
  };
  const tzControl = createTimezoneCombobox({
    options: getTimezoneOptions(),
    value: current.timezone,
    onSelect: (next) => void onTimezoneSelect(next),
    idPrefix: 'tz',
  });
  // Associate the "Timezone" label with the combobox input (Req 9.4).
  tzLabel.htmlFor = tzControl.input.id; // 'tz-input'
  tzGroup.appendChild(tzControl.root);
  dateTimeSection.appendChild(tzGroup);

  // --- Date Format ---
  const dateFormatOptions: Array<{ value: string; label: string }> = [
    { value: 'DD MMM YYYY', label: 'DD MMM YYYY' },
    { value: 'MMM DD, YYYY', label: 'MMM DD, YYYY' },
    { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
    { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
    { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
  ];
  const dateFormatGroup = document.createElement('div');
  dateFormatGroup.className = 'form-group mt-sm';
  const dateFormatLabel = document.createElement('label');
  dateFormatLabel.className = 'form-label';
  dateFormatLabel.textContent = 'Date Format';
  dateFormatGroup.appendChild(dateFormatLabel);
  const dateFormatControl = buildSelect(dateFormatOptions, current.dateFormat);
  dateFormatGroup.appendChild(dateFormatControl.wrapper);
  dateTimeSection.appendChild(dateFormatGroup);

  // --- Time Format ---
  const timeFormatOptions: Array<{ value: string; label: string }> = [
    { value: '24h', label: '24-hour' },
    { value: '12h', label: '12-hour (AM/PM)' },
  ];
  const timeFormatGroup = document.createElement('div');
  timeFormatGroup.className = 'form-group mt-sm';
  const timeFormatLabel = document.createElement('label');
  timeFormatLabel.className = 'form-label';
  timeFormatLabel.textContent = 'Time Format';
  timeFormatGroup.appendChild(timeFormatLabel);
  const timeFormatControl = buildSelect(timeFormatOptions, current.timeFormat);
  timeFormatGroup.appendChild(timeFormatControl.wrapper);
  dateTimeSection.appendChild(timeFormatGroup);

  // --- Live preview ---
  const previewLine = document.createElement('div');
  previewLine.className = 'settings-row-desc mt-sm';
  function updateDateTimePreview(): void {
    previewLine.textContent = `Preview: ${formatKnotTimestamp(new Date().toISOString())}`;
  }
  updateDateTimePreview();
  dateTimeSection.appendChild(previewLine);

  root.appendChild(dateTimeSection);

  // Combobox reports selections via onSelect (wired at construction). Register its
  // own cleanup so listeners are removed and the root detached on unmount (task 7.3
  // finalizes; added here to keep cleanup correct).
  listenerCleanups.push(() => tzControl.destroy());

  const onDateFormatChange = async (): Promise<void> => {
    const prev = settingsStore.getCurrent().dateFormat;
    const next = dateFormatControl.select.value as AppSettings['dateFormat'];
    try {
      await settingsStore.save({ dateFormat: next });
      updateDateTimePreview();
    } catch {
      dateFormatControl.select.value = prev;
      toastService.show('Could not save setting');
    }
  };
  dateFormatControl.select.addEventListener('change', () => void onDateFormatChange());
  listenerCleanups.push(() =>
    dateFormatControl.select.removeEventListener('change', () => void onDateFormatChange())
  );

  const onTimeFormatChange = async (): Promise<void> => {
    const prev = settingsStore.getCurrent().timeFormat;
    const next = timeFormatControl.select.value as AppSettings['timeFormat'];
    try {
      await settingsStore.save({ timeFormat: next });
      updateDateTimePreview();
    } catch {
      timeFormatControl.select.value = prev;
      toastService.show('Could not save setting');
    }
  };
  timeFormatControl.select.addEventListener('change', () => void onTimeFormatChange());
  listenerCleanups.push(() =>
    timeFormatControl.select.removeEventListener('change', () => void onTimeFormatChange())
  );

  // =========================================================
  // Section: Cloud Backup
  // =========================================================
  const cloudSection = document.createElement('div');
  cloudSection.className = 'settings-section';

  const cloudHeading = document.createElement('h2');
  cloudHeading.textContent = 'Cloud Backup';
  cloudSection.appendChild(cloudHeading);

  const cloudRow = document.createElement('div');
  cloudRow.className = 'settings-row';

  const cloudLabelWrap = document.createElement('div');
  const cloudLabel = document.createElement('div');
  cloudLabel.className = 'settings-row-label';
  cloudLabel.textContent = 'Google Drive';
  const statusBadge = document.createElement('div');
  updateStatusBadge(cloudSyncService.getConnectionStatus());
  cloudLabelWrap.appendChild(cloudLabel);
  cloudLabelWrap.appendChild(statusBadge);
  cloudRow.appendChild(cloudLabelWrap);

  const connectBtn = document.createElement('button');
  connectBtn.className = 'btn btn-ghost';
  updateConnectBtn(cloudSyncService.getConnectionStatus());
  cloudRow.appendChild(connectBtn);

  cloudSection.appendChild(cloudRow);

  // --- Explanatory copy: what each delete action does, in plain words.
  // Built with DOM APIs / textContent (never innerHTML) even though the
  // text itself is static, per the project's no-innerHTML-with-content rule. ---
  const explainEl = document.createElement('div');
  explainEl.className = 'settings-row-desc mt-sm';

  const explainPara1 = document.createElement('p');
  appendBoldSentence(explainPara1, [
    { text: 'Deleting a knot', bold: true },
    { text: ' (from Knots or its detail page) removes it from ', bold: false },
    { text: 'this device only', bold: true },
    { text: '. Its cloud backup is kept, and your other devices keep their copies.', bold: false },
  ]);
  explainEl.appendChild(explainPara1);

  const explainPara2 = document.createElement('p');
  explainPara2.className = 'mt-sm';
  appendBoldSentence(explainPara2, [
    { text: 'Manage backups', bold: true },
    { text: " deletes a knot's ", bold: false },
    { text: 'cloud backup', bold: true },
    { text: ". Copies already on your devices are not deleted, and they won't be backed up again unless you edit them.", bold: false },
  ]);
  explainEl.appendChild(explainPara2);

  cloudSection.appendChild(explainEl);

  // --- Merge with Cloud button ---
  const syncBtn = document.createElement('button');
  syncBtn.className = 'btn btn-ghost btn-full mt-sm';
  syncBtn.textContent = 'Merge with Cloud';
  cloudSection.appendChild(syncBtn);

  // --- Merge description line ---
  const syncDescEl = document.createElement('div');
  syncDescEl.className = 'settings-row-desc mt-sm';
  syncDescEl.textContent =
    'Sends new and edited knots from this device to Google Drive, and brings in new and edited knots from your other devices. Data is never deleted during a merge.';
  cloudSection.appendChild(syncDescEl);

  // --- Last merged line ---
  const lastSyncedEl = document.createElement('div');
  lastSyncedEl.className = 'settings-row-desc mt-sm';
  function updateLastSynced(): void {
    const lastSyncAt = settingsStore.getCurrent().lastSyncAt;
    lastSyncedEl.textContent =
      lastSyncAt !== null
        ? `Last merged: ${formatKnotTimestamp(new Date(lastSyncAt).toISOString())}`
        : 'Not merged yet';
  }
  updateLastSynced();
  cloudSection.appendChild(lastSyncedEl);

  // --- Manage backups button + inline panel ---
  const manageBtn = document.createElement('button');
  manageBtn.className = 'btn btn-ghost btn-full mt-sm';
  manageBtn.textContent = 'Manage backups';
  cloudSection.appendChild(manageBtn);

  const backupHint = document.createElement('div');
  backupHint.className = 'settings-row-desc mt-sm';
  backupHint.textContent = 'Connect Google Drive and go online to merge or manage backups.';
  cloudSection.appendChild(backupHint);

  const backupPanel = document.createElement('div');
  backupPanel.className = 'backup-list mt-sm';
  backupPanel.style.display = 'none';
  cloudSection.appendChild(backupPanel);

  root.appendChild(cloudSection);

  let syncInFlight = false;
  let backupPanelOpen = false;

  /** Merge with Cloud / Manage backups are only usable when connected AND online. */
  function updateAvailability(): void {
    const available = cloudSyncService.getConnectionStatus() === 'connected' && navigator.onLine;
    syncBtn.disabled = !available || syncInFlight;
    manageBtn.disabled = !available;
    backupHint.style.display = available ? 'none' : 'block';
    if (!available && backupPanelOpen) {
      backupPanelOpen = false;
      backupPanel.style.display = 'none';
      backupPanel.innerHTML = '';
    }
  }
  updateAvailability();

  const onSyncClick = async (): Promise<void> => {
    syncInFlight = true;
    syncBtn.disabled = true;
    syncBtn.textContent = 'Merging…';
    try {
      const result = await cloudSyncService.syncAll();
      toastService.show(`Merged — ${result.pulled} knots updated on this device, ${result.pushed} backed up`);
    } catch {
      toastService.show('Merge failed — check your connection');
    } finally {
      syncInFlight = false;
      syncBtn.textContent = 'Merge with Cloud';
      updateAvailability();
      updateLastSynced();
      if (backupPanelOpen) void loadBackups();
    }
  };
  syncBtn.addEventListener('click', () => void onSyncClick());
  listenerCleanups.push(() => syncBtn.removeEventListener('click', () => void onSyncClick()));

  function renderBackupRow(b: BackupEntry, localIds: Set<string>): HTMLElement {
    const row = document.createElement('div');
    row.className = 'backup-row';

    const mainWrap = document.createElement('div');
    mainWrap.style.flex = '1';
    mainWrap.style.minWidth = '0';

    const mainLine = document.createElement('div');
    mainLine.className = 'backup-row-main';
    mainLine.textContent = b.description
      ? b.description
      : b.kind === 'knot'
      ? `Backup from ${formatKnotTimestamp(b.modifiedTime)}`
      : `Old-format backup (${b.name})`;
    mainWrap.appendChild(mainLine);

    const metaLine = document.createElement('div');
    metaLine.className = 'backup-row-meta';
    metaLine.textContent =
      b.kind === 'old' ? 'Old format' : b.knotId && localIds.has(b.knotId) ? 'On this device' : 'Only in backup';
    mainWrap.appendChild(metaLine);

    row.appendChild(mainWrap);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger btn-sm';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      void (async () => {
        if (!confirm('Delete this backup from Google Drive? Copies on your devices are not deleted.')) return;
        try {
          await cloudSyncService.deleteBackup(b.fileId, b.knotId);
          row.remove();
          toastService.show('Backup deleted');
        } catch {
          toastService.show('Could not delete backup — check your connection');
        }
      })();
    });
    row.appendChild(deleteBtn);

    return row;
  }

  async function loadBackups(): Promise<void> {
    backupPanel.innerHTML = '';
    const loadingEl = document.createElement('div');
    loadingEl.className = 'settings-row-desc';
    loadingEl.textContent = 'Loading backups…';
    backupPanel.appendChild(loadingEl);

    try {
      const [backups, localKnots] = await Promise.all([cloudSyncService.listBackups(), knotStore.listAll()]);
      const localIds = new Set(localKnots.map((k) => k.id));

      backupPanel.innerHTML = '';
      if (backups.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'settings-row-desc';
        empty.textContent = 'No backups in Google Drive yet.';
        backupPanel.appendChild(empty);
        return;
      }
      for (const b of backups) {
        backupPanel.appendChild(renderBackupRow(b, localIds));
      }
    } catch {
      backupPanel.innerHTML = '';
      const errEl = document.createElement('div');
      errEl.className = 'settings-row-desc';
      errEl.textContent = 'Could not load backups — check your connection';
      backupPanel.appendChild(errEl);
    }
  }

  const onManageClick = (): void => {
    backupPanelOpen = !backupPanelOpen;
    backupPanel.style.display = backupPanelOpen ? 'block' : 'none';
    if (backupPanelOpen) void loadBackups();
  };
  manageBtn.addEventListener('click', onManageClick);
  listenerCleanups.push(() => manageBtn.removeEventListener('click', onManageClick));

  const onOnlineOrOffline = (): void => updateAvailability();
  window.addEventListener('online', onOnlineOrOffline);
  window.addEventListener('offline', onOnlineOrOffline);
  listenerCleanups.push(() => {
    window.removeEventListener('online', onOnlineOrOffline);
    window.removeEventListener('offline', onOnlineOrOffline);
  });

  function updateStatusBadge(status: 'connected' | 'disconnected'): void {
    statusBadge.className = status === 'connected' ? 'badge-connected' : 'badge-disconnected';
    statusBadge.textContent = status === 'connected' ? 'Connected' : 'Disconnected';
  }

  function updateConnectBtn(status: 'connected' | 'disconnected'): void {
    connectBtn.textContent = status === 'connected' ? 'Disconnect' : 'Connect';
  }

  const onConnectClick = async (): Promise<void> => {
    const status = cloudSyncService.getConnectionStatus();
    if (status === 'connected') {
      await cloudSyncService.disconnect();
    } else {
      await cloudSyncService.connect();
    }
  };
  connectBtn.addEventListener('click', () => void onConnectClick());
  listenerCleanups.push(() =>
    connectBtn.removeEventListener('click', () => void onConnectClick())
  );

  // Subscribe to connection status changes
  unsubscribeStatus = cloudSyncService.onStatusChange((status) => {
    updateStatusBadge(status);
    updateConnectBtn(status);
    updateAvailability();
  });

  // Subscribe to settings changes (keep controls in sync)
  unsubscribeSettings = settingsStore.onChange((settings: AppSettings) => {
    transcriptionToggle.input.checked = settings.transcriptionEnabled;
    if (document.activeElement !== serverUrlInput) {
      serverUrlInput.value = settings.transcriptionServerUrl;
    }
    emailToggle.input.checked = settings.emailSummaryEnabled;
    recipientInput.disabled = !settings.emailSummaryEnabled;
    if (document.activeElement !== recipientInput) {
      recipientInput.value = settings.emailSummaryRecipient ?? '';
    }
    if (document.activeElement !== tzControl.input) {
      tzControl.setValue(settings.timezone);
    }
    if (document.activeElement !== dateFormatControl.select) {
      dateFormatControl.select.value = settings.dateFormat;
    }
    if (document.activeElement !== timeFormatControl.select) {
      timeFormatControl.select.value = settings.timeFormat;
    }
    updateDateTimePreview();
    updateLastSynced();
  });

  container.appendChild(root);

  // Cleanup
  return () => {
    for (const cleanup of listenerCleanups) cleanup();
    unsubscribeSettings?.();
    unsubscribeStatus?.();
    root.remove();
  };
}

// ---------------------------------------------------------------------------
// Toggle switch builder
// ---------------------------------------------------------------------------
function buildToggle(checked: boolean): { wrapper: HTMLElement; input: HTMLInputElement } {
  const wrapper = document.createElement('label');
  wrapper.className = 'toggle-switch';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  wrapper.appendChild(input);

  const slider = document.createElement('span');
  slider.className = 'toggle-slider';
  wrapper.appendChild(slider);

  return { wrapper, input };
}

// ---------------------------------------------------------------------------
// Select dropdown builder
// ---------------------------------------------------------------------------
function buildSelect(
  options: Array<{ value: string; label: string }>,
  currentValue: string
): { wrapper: HTMLElement; select: HTMLSelectElement } {
  const wrapper = document.createElement('div');
  wrapper.className = 'select-wrapper';

  const select = document.createElement('select');
  select.className = 'form-input';

  for (const opt of options) {
    const optionEl = document.createElement('option');
    optionEl.value = opt.value;
    optionEl.textContent = opt.label;
    if (opt.value === currentValue) optionEl.selected = true;
    select.appendChild(optionEl);
  }
  select.value = currentValue;

  wrapper.appendChild(select);
  return { wrapper, select };
}

// ---------------------------------------------------------------------------
// Bold-sentence builder — appends a sequence of text/bold runs to `parent`
// using textContent-based DOM nodes (createTextNode / <strong>.textContent),
// never innerHTML, even though this particular text is static.
// ---------------------------------------------------------------------------
function appendBoldSentence(parent: HTMLElement, runs: Array<{ text: string; bold: boolean }>): void {
  for (const run of runs) {
    if (run.bold) {
      const strong = document.createElement('strong');
      strong.textContent = run.text;
      parent.appendChild(strong);
    } else {
      parent.appendChild(document.createTextNode(run.text));
    }
  }
}
