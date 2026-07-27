const statusEl = document.getElementById('status');

function render(s) {
  if (!s) return;
  statusEl.textContent = s.message || '';
  statusEl.className = 'status ' + (s.ok ? 'ok' : 'err');
}

chrome.storage.session.get('flexSyncStatus', (v) => render(v.flexSyncStatus));
chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.flexSyncStatus) render(changes.flexSyncStatus.newValue);
});

document.getElementById('opts').addEventListener('click', () => chrome.runtime.openOptionsPage());
