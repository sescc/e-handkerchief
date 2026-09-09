// ============================================================
// e-Handkerchief — SettingsScreen
// Configure optional features: transcription, email, cloud backup.
// ============================================================

import { settingsStore } from '../settingsStore.js';
import { cloudSyncService } from '../cloudSyncService.js';
import { toastService } from '../toastService.js';
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
  transcriptionDesc.textContent = 'Automatically transcribe voice recordings to text';
  transcriptionLabelWrap.appendChild(transcriptionLabel);
  transcriptionLabelWrap.appendChild(transcriptionDesc);
  transcriptionRow.appendChild(transcriptionLabelWrap);

  const transcriptionToggle = buildToggle(current.transcriptionEnabled);
  transcriptionRow.appendChild(transcriptionToggle.wrapper);
  transcriptionSection.appendChild(transcriptionRow);
  root.appendChild(transcriptionSection);

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
    emailToggle.input.checked = settings.emailSummaryEnabled;
    recipientInput.disabled = !settings.emailSummaryEnabled;
    if (document.activeElement !== recipientInput) {
      recipientInput.value = settings.emailSummaryRecipient ?? '';
    }
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
