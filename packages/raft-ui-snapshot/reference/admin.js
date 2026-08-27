(function () {
  'use strict';

  var selects = {};
  var roleButton = document.querySelector('[data-admin-action="role-update"]');
  var roleSelect = document.querySelector('[data-select="role"]');
  var agreementToggle = document.getElementById('agreementRequired');
  var agreementFields = document.getElementById('agreementFields');

  function formControls(form) {
    return form ? form.querySelectorAll('input, textarea, button') : [];
  }

  function serializeForm(form) {
    var values = Array.prototype.map.call(form.querySelectorAll('input, textarea'), function (control) {
      return control.type === 'checkbox' ? control.checked : control.value;
    });
    Array.prototype.forEach.call(form.querySelectorAll('.raft-select'), function (select) {
      values.push(select.dataset.value || '');
    });
    return JSON.stringify(values);
  }

  function updateDirty(form) {
    if (!form || !form.hasAttribute('data-dirty-form')) return;
    var save = form.querySelector('[data-admin-action]');
    if (save) save.disabled = serializeForm(form) === form.dataset.baseline;
  }

  function commitForm(form) {
    if (!form || !form.hasAttribute('data-dirty-form')) return;
    form.dataset.baseline = serializeForm(form);
    updateDirty(form);
  }

  document.querySelectorAll('[data-dirty-form]').forEach(function (form) {
    form.dataset.baseline = serializeForm(form);
    form.addEventListener('input', function () { updateDirty(form); });
    form.addEventListener('change', function () { updateDirty(form); });
    form.addEventListener('submit', function (event) { event.preventDefault(); });
  });

  document.querySelectorAll('.raft-select').forEach(function (root) {
    var name = root.dataset.select;
    selects[name] = RaftUIPrimitives.listboxSelect({
      root: root,
      onChange: function () {
        if (name === 'member') {
          selects.role.setDisabled(false);
          roleButton.disabled = false;
        }
        updateDirty(root.closest('[data-dirty-form]'));
      }
    });
  });

  if (agreementToggle && agreementFields) {
    agreementToggle.addEventListener('change', function () {
      var expanded = agreementToggle.checked;
      agreementToggle.setAttribute('aria-expanded', String(expanded));
      agreementFields.hidden = !expanded;
    });
    document.getElementById('agreementBody').addEventListener('input', function (event) {
      var value = event.currentTarget.value;
      document.getElementById('agreementCount').textContent = value.length + ' / 5000';
      document.getElementById('agreementPreview').textContent = value || '暂无内容';
    });
  }

  function clearInviteError() {
    var error = document.getElementById('inviteError');
    ['inviteMax', 'inviteExpire'].forEach(function (id) {
      var field = document.getElementById(id);
      field.removeAttribute('aria-invalid');
      field.removeAttribute('aria-describedby');
    });
    error.hidden = true;
    error.textContent = '';
  }

  function validateInvite() {
    var max = document.getElementById('inviteMax');
    var expiry = document.getElementById('inviteExpire');
    var error = document.getElementById('inviteError');
    clearInviteError();
    if (max.value !== '' && (!Number.isInteger(Number(max.value)) || Number(max.value) < 1)) {
      max.setAttribute('aria-invalid', 'true');
      max.setAttribute('aria-describedby', 'inviteError');
      error.textContent = '最大使用次数必须是大于或等于 1 的整数。';
      error.hidden = false;
      max.focus();
      return false;
    }
    if (expiry.value !== '' && (!Number.isFinite(new Date(expiry.value).getTime()) || new Date(expiry.value).getTime() <= Date.now())) {
      expiry.setAttribute('aria-invalid', 'true');
      expiry.setAttribute('aria-describedby', 'inviteError');
      error.textContent = '过期时间必须晚于当前时间。';
      error.hidden = false;
      expiry.focus();
      return false;
    }
    return true;
  }

  var actionMap = {
    'role-update': 'role.update',
    'role-remove': 'role.remove',
    'system-channel-save': 'system-channel.save',
    'invite-create': 'invite.create',
    'agreement-save': 'agreement.save',
    'onboarding-save': 'onboarding.save',
    'translation-save': 'translation.save',
    'member-permissions-save': 'member-permissions.save'
  };

  function projectionFor(button) {
    var operation = button.dataset.adminAction;
    var section = button.closest('.admin-section');
    var form = button.closest('[data-dirty-form]');
    var target = { workspace: 'current', operation: operation };
    var payload = {};
    var controls = form ? formControls(form) : [];
    var pendingLabel = '保存中…';
    var commit = function () { commitForm(form); };

    if (operation === 'role-update') {
      payload.member = selects.member.value();
      payload.role = selects.role.value();
      target.member = payload.member;
      controls = section.querySelectorAll('.admin-toolbar button');
      pendingLabel = '更新中…';
    } else if (operation === 'role-remove') {
      target.member = button.dataset.member;
      pendingLabel = '移除中…';
    } else if (operation === 'system-channel-save') {
      payload.hidden = form.querySelector('input[type="checkbox"]').checked;
    } else if (operation === 'invite-create') {
      if (!validateInvite()) return null;
      var maxUses = document.getElementById('inviteMax').value;
      payload.maxUses = maxUses === '' ? null : Number(maxUses);
      payload.expiresAt = document.getElementById('inviteExpire').value ? new Date(document.getElementById('inviteExpire').value).toISOString() : null;
      controls = section.querySelectorAll('input, button');
      pendingLabel = '创建中…';
      commit = function () {
        document.getElementById('inviteMax').value = '';
        document.getElementById('inviteExpire').value = '';
        clearInviteError();
      };
    } else if (operation === 'agreement-save') {
      payload.required = agreementToggle.checked;
      payload.title = payload.required ? document.getElementById('agreementTitle').value.trim() : '';
      payload.bodyMarkdown = payload.required ? document.getElementById('agreementBody').value.trim() : '';
    } else if (operation === 'onboarding-save') {
      payload.guideAgent = selects['guide-agent'].value();
      payload.greetAgents = selects.greeting.value() === 'yes';
    } else if (operation === 'translation-save') {
      payload.enabled = form.querySelector('input[type="checkbox"]').checked;
    } else if (operation === 'member-permissions-save') {
      payload.hideHumanDirectory = form.querySelector('input[type="checkbox"]').checked;
    }

    return {
      domain: 'admin',
      action: actionMap[operation],
      target: target,
      payload: payload,
      control: button,
      controls: controls,
      pendingLabel: pendingLabel,
      optimistic: false,
      key: 'admin:' + operation,
      commit: commit
    };
  }

  document.querySelectorAll('[data-admin-action]').forEach(function (button) {
    button.addEventListener('click', function () {
      var projection = projectionFor(button);
      if (projection) RaftUI.project(projection);
    });
  });

  document.addEventListener(RaftUI.STATE_EVENT, function (event) {
    var state = event.detail;
    if (!state || state.domain !== 'admin') return;
    var control = document.querySelector('[data-raft-intent-id="' + state.intentId + '"]');
    if (!control) return;
    var card = control.closest('.admin-card');
    var feedback = card && card.querySelector('.admin-feedback');
    if (state.status === 'pending' && feedback) feedback.remove();
    if (state.status === 'failed' && card) {
      if (!feedback) {
        feedback = document.createElement('p');
        feedback.className = 'admin-feedback';
        feedback.setAttribute('role', 'alert');
        card.appendChild(feedback);
      }
      feedback.textContent = state.error && state.error.message ? state.error.message : '操作失败，请重试。';
    }
    if (state.status === 'succeeded' && /\.save$/.test(state.action)) {
      var original = control.dataset.adminSettledLabel || control.textContent.trim();
      control.dataset.adminSettledLabel = original;
      control.textContent = '✓ 已保存';
      window.setTimeout(function () {
        if (control.dataset.raftIntentId === state.intentId) control.textContent = original;
      }, 1500);
    }
  });
})();
