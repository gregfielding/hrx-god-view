/** HRX Fieldglass Sync — options page. */

const DEFAULTS = {
  baseUrl: 'https://us-central1-hrx1-d3beb.cloudfunctions.net',
  tenantId: 'BCiP2bQ9CgVOCTfV6MhD',
  extensionKey: '',
  worklistUrl: 'https://us.fieldglass.cloud.sap/',
};

async function load() {
  const cfg = await chrome.storage.sync.get(DEFAULTS);
  document.getElementById('baseUrl').value = cfg.baseUrl || DEFAULTS.baseUrl;
  document.getElementById('tenantId').value = cfg.tenantId || DEFAULTS.tenantId;
  document.getElementById('extensionKey').value = cfg.extensionKey || '';
  document.getElementById('worklistUrl').value = cfg.worklistUrl || DEFAULTS.worklistUrl;
}

document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.sync.set({
    baseUrl: document.getElementById('baseUrl').value.trim() || DEFAULTS.baseUrl,
    tenantId: document.getElementById('tenantId').value.trim() || DEFAULTS.tenantId,
    extensionKey: document.getElementById('extensionKey').value.trim(),
    worklistUrl: document.getElementById('worklistUrl').value.trim() || DEFAULTS.worklistUrl,
  });
  const saved = document.getElementById('saved');
  saved.style.display = 'inline';
  setTimeout(() => {
    saved.style.display = 'none';
  }, 1500);
});

load();
