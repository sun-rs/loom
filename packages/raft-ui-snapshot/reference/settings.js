(function () {
  'use strict';

  var collapse = document.getElementById('pwCollapse');
  var toggle = document.getElementById('pwToggle');
  if (collapse && toggle) {
    toggle.addEventListener('click', function () {
      var open = collapse.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  document.querySelectorAll('.segmented').forEach(function (group) {
    RaftUIPrimitives.segmentedControl({ root: group });
  });

  document.querySelectorAll('[data-account-provider]').forEach(function (button) {
    button.addEventListener('click', function () {
      var provider = button.dataset.accountProvider;
      var operation = button.dataset.accountOperation;
      RaftUI.project({
        domain: 'settings', action: 'account.connection.change', target: { provider: provider }, payload: { operation: operation }, control: button, optimistic: false,
        apply: function () {
          var row = button.closest('.acct-row');
          var actions = button.closest('.acct-actions');
          var chip = actions.querySelector('.chip');
          var connected = operation === 'connect';
          if (connected && !chip) {
            chip = document.createElement('span'); chip.className = 'chip chip-gray'; chip.textContent = '已连接'; actions.prepend(chip);
          }
          if (!connected && chip) chip.remove();
          button.textContent = connected ? '断开' : '连接';
          button.dataset.accountOperation = connected ? 'disconnect' : 'connect';
          row.dataset.connected = String(connected);
        }
      });
    });
  });

  var revoke = document.querySelector('[data-settings-action="revoke-sessions"]');
  revoke.addEventListener('click', function () {
    RaftUI.project({ domain: 'settings', action: 'sessions.revoke', target: { scope: 'other' }, payload: {}, control: revoke, optimistic: false });
  });

  var savePreferences = document.querySelector('[data-settings-action="save-preferences"]');
  savePreferences.addEventListener('click', function () {
    var groups = document.querySelectorAll('[aria-label="语言与区域"] .segmented');
    var agreement = document.querySelector('[aria-label="语言与区域"] .checkbox input');
    var preferenceControls = [document.getElementById('langSelect'), agreement];
    groups.forEach(function (group) { group.querySelectorAll('button').forEach(function (button) { preferenceControls.push(button); }); });
    RaftUI.project({
      domain: 'settings', action: 'preferences.update', target: { section: 'language-region' },
      payload: {
        language: document.getElementById('langSelect').value,
        translation: groups[0].querySelector('.is-active').textContent.trim(),
        timeFormat: groups[1].querySelector('.is-active').textContent.trim(),
        requireAgreement: agreement.checked
      },
      control: savePreferences, controls: preferenceControls, optimistic: false
    });
  });

  var savePassword = document.querySelector('[data-settings-action="save-password"]');
  savePassword.addEventListener('click', function () {
    var oldPassword = document.getElementById('pwOld');
    var newPassword = document.getElementById('pwNew');
    if (!oldPassword.value || newPassword.value.length < 8) { (oldPassword.value ? newPassword : oldPassword).focus(); return; }
    RaftUI.project({
      domain: 'settings', action: 'password.update', target: { account: 'current' },
      payload: { credentialFields: ['currentPassword', 'newPassword'] },
      sensitive: { currentPassword: oldPassword.value, newPassword: newPassword.value },
      control: savePassword, controls: [oldPassword, newPassword], optimistic: false,
      apply: function () { oldPassword.value = ''; newPassword.value = ''; }
    });
  });

  var saveProfile = document.querySelector('[data-settings-action="save-profile"]');
  saveProfile.addEventListener('click', function () {
    var profile = {
      name: document.getElementById('fName').value.trim(),
      handle: document.getElementById('fHandle').value.trim(),
      email: document.getElementById('fMail').value.trim()
    };
    if (!profile.name || !profile.handle || !profile.email) return;
    RaftUI.project({
      domain: 'settings', action: 'profile.update', target: { account: 'current' }, payload: profile,
      control: saveProfile, controls: [document.getElementById('fName'), document.getElementById('fHandle'), document.getElementById('fMail')], optimistic: false,
      apply: function () {
        document.querySelector('.profile-name').textContent = profile.name;
        document.querySelector('.profile-handle').textContent = '@' + profile.handle + ' · 所有者';
      }
    });
  });
})();
