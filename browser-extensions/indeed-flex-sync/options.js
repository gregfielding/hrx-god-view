const DEFAULTS = {
  baseUrl: 'https://us-central1-hrx1-d3beb.cloudfunctions.net',
  tenantId: 'BCiP2bQ9CgVOCTfV6MhD',
  extensionKey: '',
};

function $(id) {
  return document.getElementById(id);
}

chrome.storage.sync.get(DEFAULTS, (cfg) => {
  $('extensionKey').value = cfg.extensionKey || '';
  $('tenantId').value = cfg.tenantId || DEFAULTS.tenantId;
  $('baseUrl').value = cfg.baseUrl || DEFAULTS.baseUrl;
});

$('save').addEventListener('click', () => {
  chrome.storage.sync.set(
    {
      extensionKey: $('extensionKey').value.trim(),
      tenantId: $('tenantId').value.trim() || DEFAULTS.tenantId,
      baseUrl: $('baseUrl').value.trim() || DEFAULTS.baseUrl,
    },
    () => {
      $('saved').textContent = 'Saved ✓';
      setTimeout(() => ($('saved').textContent = ''), 2000);
    },
  );
});
