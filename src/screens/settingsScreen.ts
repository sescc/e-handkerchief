// ============================================================
// e-Handkerchief — SettingsScreen
// Configure optional features: transcription, email, cloud backup.
// ============================================================

import { settingsStore } from '../settingsStore.js';
import { cloudSyncService } from '../cloudSyncService.js';
import { toastService } from '../toastService.js';
import { formatNoteTimestamp, getTimezoneOptions } from '../dateFormat.js';
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
  // Section: Email Summary
  // =========================================================
  const emailSection = document.createElement('div');
  emailSection.className = 'settings-section';

  const emailHeading = document.createElement('h2');
  emailHeading.textContent = 'Email Summary';
  emailSection.appendChild(emailHeading);

  const emailRow = document.createElement('div');
  emailRow.className = 'settings-row';

  const emailLabelWrap = document.createElement('div');
  const emailLabel = document.createElement('div');
  emailLabel.className = 'settings-row-label';
  emailLabel.textContent = 'Enable Email Summary';
  emailLabelWrap.appendChild(emailLabel);
  emailRow.appendChild(emailLabelWrap);

  const emailToggle = buildToggle(current.emailSummaryEnabled);
  emailRow.appendChild(emailToggle.wrapper);
  emailSection.appendChild(emailRow);

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
  const tzControl = buildSelect(getTimezoneOptions(), current.timezone);
  tzGroup.appendChild(tzControl.wrapper);
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
    previewLine.textContent = `Preview: ${formatNoteTimestamp(new Date().toISOString())}`;
  }
  updateDateTimePreview();
  dateTimeSection.appendChild(previewLine);

  root.appendChild(dateTimeSection);

  const onTimezoneChange = async (): Promise<void> => {
    const prev = settingsStore.getCurrent().timezone;
    const next = tzControl.select.value;
    try {
      await settingsStore.save({ timezone: next });
      updateDateTimePreview();
    } catch {
      tzControl.select.value = prev;
      toastService.show('Could not save setting');
    }
  };
  tzControl.select.addEventListener('change', () => void onTimezoneChange());
  listenerCleanups.push(() =>
    tzControl.select.removeEventListener('change', () => void onTimezoneChange())
  );

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

  // Import from Cloud button
  const importBtn = document.createElement('button');
  importBtn.className = 'btn btn-ghost btn-full mt-sm';
  importBtn.textContent = 'Import from Cloud';
  cloudSection.appendChild(importBtn);

  root.appendChild(cloudSection);

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

  const onImportClick = async (): Promise<void> => {
    importBtn.disabled = true;
    importBtn.textContent = 'Importing…';
    try {
      const result = await cloudSyncService.importAll();
      toastService.show(`Imported ${result.imported} notes (${result.skipped} skipped)`);
    } catch {
      toastService.show('Import failed — check your connection');
    } finally {
      importBtn.disabled = false;
      importBtn.textContent = 'Import from Cloud';
    }
  };
  importBtn.addEventListener('click', () => void onImportClick());
  listenerCleanups.push(() =>
    importBtn.removeEventListener('click', () => void onImportClick())
  );

  // Subscribe to connection status changes
  unsubscribeStatus = cloudSyncService.onStatusChange((status) => {
    updateStatusBadge(status);
    updateConnectBtn(status);
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
    if (document.activeElement !== tzControl.select) {
      tzControl.select.value = settings.timezone;
    }
    if (document.activeElement !== dateFormatControl.select) {
      dateFormatControl.select.value = settings.dateFormat;
    }
    if (document.activeElement !== timeFormatControl.select) {
      timeFormatControl.select.value = settings.timeFormat;
    }
    updateDateTimePreview();
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
