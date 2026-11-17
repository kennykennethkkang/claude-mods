const $ = (id) => document.getElementById(id);

function load() {
  const s = JSON.parse(localStorage.getItem('settings') || '{}');
  $('name').value = s.name || '';
  $('email').value = s.email || '';
  $('tz').value = s.tz || 'UTC';
  $('digest').checked = !!s.digest;
  $('mentions').checked = !!s.mentions;
  const t = document.querySelector(`input[name="theme"][value="${s.theme || 'system'}"]`);
  if (t) t.checked = true;
}

$('save').addEventListener('click', () => {
  const s = {
    name: $('name').value,
    email: $('email').value,
    tz: $('tz').value,
    digest: $('digest').checked,
    mentions: $('mentions').checked,
    theme: document.querySelector('input[name="theme"]:checked').value,
  };
  localStorage.setItem('settings', JSON.stringify(s));
  $('status').textContent = 'Settings were saved successfully!';
});

$('delete').addEventListener('click', () => {
  localStorage.clear();
  $('status').textContent = 'Account removed';
});

load();
