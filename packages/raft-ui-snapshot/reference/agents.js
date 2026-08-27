/* Members / Agent detail projection. Product mutations use Raft UI protocol v1. */
(function () {
  'use strict';

  var PROFILES = {
    cindy: { name: 'Cindy', avatar: '#av-cindy', role: '管理员', handle: '@Cindy', description: 'Onboarding Assistant', online: true },
    alice: { name: 'Alice', avatar: '#av-alice', role: '成员', handle: '@Alice', description: '', online: true },
    kimi: { name: 'Kimi', avatar: '#av-cat', role: '成员', handle: '@Kimi', description: '', online: true },
    grok: { name: 'Grok', avatar: '#av-robot', role: '成员', handle: '@Grok', description: '', online: true },
    hakase: { name: 'Hakase', avatar: '#av-user', role: '所有者', handle: '@Hakase', description: '', online: false }
  };

  var currentMember = 'alice';
  var tabsEl = document.getElementById('agentTabs');
  var tabsFrame = document.querySelector('.agent-tabs-frame');
  var tabs = Array.prototype.slice.call(tabsEl.querySelectorAll('[role="tab"]'));
  var panes = {};
  Array.prototype.forEach.call(document.querySelectorAll('.agent-body'), function (pane) { panes[pane.id.replace('pane-', '')] = pane; });

  function transact(options) {
    return RaftUI.project(options);
  }

  function applyTab(tab) {
    tabs.forEach(function (candidate) {
      var active = candidate === tab;
      candidate.classList.toggle('is-active', active);
      candidate.setAttribute('aria-selected', String(active));
      candidate.tabIndex = active ? 0 : -1;
    });
    Object.keys(panes).forEach(function (key) { panes[key].hidden = key !== tab.dataset.pane; });
  }

  function activateTab(tab, focus) {
    if (!tab) return;
    var previous = null;
    var handle = transact({
      domain: 'members', action: 'tab.change', target: { member: currentMember, pane: tab.dataset.pane }, payload: {},
      legacy: { name: 'raft:agent-tab-change', detail: { member: currentMember, pane: tab.dataset.pane } }, key: 'members.tab',
      apply: function () { previous = tabs.filter(function (candidate) { return candidate.getAttribute('aria-selected') === 'true'; })[0]; applyTab(tab); },
      rollback: function () { if (previous) applyTab(previous); }
    });
    if (handle.accepted && focus) tab.focus();
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () { activateTab(tab, false); });
    tab.addEventListener('keydown', function (event) {
      var index = tabs.indexOf(tab);
      var next = null;
      if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
      if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
      if (event.key === 'Home') next = tabs[0];
      if (event.key === 'End') next = tabs[tabs.length - 1];
      if (!next) return;
      event.preventDefault();
      activateTab(next, true);
    });
  });

  var headerName = document.getElementById('agentName');
  var headerAvatar = document.getElementById('agentAvatarUse');
  var headerPresence = document.getElementById('agentPresence');
  var profileName = document.getElementById('profileName');
  var profileHandle = document.getElementById('profileHandle');
  var profileAvatar = document.getElementById('profileAvatarUse');
  var profilePresence = document.querySelector('.profile-presence');
  var roleValue = document.querySelector('.profile-role');
  var nameSection = document.querySelector('[data-field-section="name"]');
  var descriptionSection = document.querySelector('[data-field-section="description"]');

  function closeEditors() {
    document.querySelectorAll('[data-field-section].is-editing').forEach(function (section) {
      section.classList.remove('is-editing');
      section.removeAttribute('data-raft-error');
      section.querySelector('[data-field-value]').hidden = false;
      section.querySelector('[data-edit-form]').hidden = true;
    });
  }

  function openEditor(section) {
    closeEditors();
    section.classList.add('is-editing');
    section.querySelector('[data-field-value]').hidden = true;
    var form = section.querySelector('[data-edit-form]');
    form.hidden = false;
    var input = form.querySelector('input, textarea');
    input.focus();
    input.select();
  }

  function renderProfile() {
    var profile = PROFILES[currentMember];
    headerName.textContent = profile.name;
    headerAvatar.setAttribute('href', profile.avatar);
    headerPresence.hidden = !profile.online;
    profileName.textContent = profile.name;
    profileHandle.textContent = profile.handle;
    profileAvatar.setAttribute('href', profile.avatar);
    profilePresence.hidden = !profile.online;
    roleValue.textContent = profile.role;
    nameSection.querySelector('[data-field-value]').textContent = profile.name;
    nameSection.querySelector('input').value = profile.name;
    var descriptionValue = descriptionSection.querySelector('[data-field-value]');
    descriptionValue.textContent = profile.description || '暂无描述';
    descriptionValue.classList.toggle('field-empty', !profile.description);
    descriptionSection.querySelector('textarea').value = profile.description;
    closeEditors();
  }

  function selectRow(member) {
    currentMember = member;
    document.querySelectorAll('.member-row').forEach(function (row) {
      var selected = row.dataset.member === member;
      row.classList.toggle('is-selected', selected);
      row.setAttribute('aria-pressed', String(selected));
    });
    document.getElementById('graphRow').classList.remove('is-selected');
    tabsFrame.hidden = false;
    renderProfile();
  }

  var memberRows = Array.prototype.slice.call(document.querySelectorAll('.member-row'));
  memberRows.forEach(function (row) {
    row.addEventListener('click', function () {
      var key = row.dataset.member;
      if (!PROFILES[key]) return;
      var previous = null;
      transact({
        domain: 'members', action: 'participant.select', target: { member: key }, payload: {},
        legacy: { name: 'raft:agent-select', detail: { member: key } }, key: 'members.navigation',
        apply: function () { previous = currentMember; selectRow(key); }, rollback: function () { selectRow(previous); }
      });
    });
  });

  document.getElementById('graphRow').addEventListener('click', function (event) {
    var selectedMember = null;
    transact({
      domain: 'members', action: 'relationship.open', target: {}, payload: {},
      legacy: { name: 'raft:relationship-open', detail: {} }, key: 'members.navigation',
      apply: function () {
        selectedMember = currentMember;
        memberRows.forEach(function (row) { row.classList.remove('is-selected'); row.setAttribute('aria-pressed', 'false'); });
        event.currentTarget.classList.add('is-selected');
        tabsFrame.hidden = true;
        Object.keys(panes).forEach(function (key) { panes[key].hidden = key !== 'graph'; });
      },
      rollback: function () { selectRow(selectedMember); }
    });
  });

  document.querySelectorAll('[data-edit]').forEach(function (button) {
    button.addEventListener('click', function () { openEditor(document.querySelector('[data-field-section="' + button.dataset.edit + '"]')); });
  });

  document.querySelectorAll('[data-edit-form]').forEach(function (form) {
    var field = form.dataset.editForm;
    var section = form.closest('[data-field-section]');
    var input = form.querySelector('input, textarea');
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var value = input.value.trim();
      if (field === 'name' && !value) { input.focus(); return; }
      var member = currentMember;
      var before = { name: PROFILES[member].name, handle: PROFILES[member].handle, description: PROFILES[member].description };
      transact({
        domain: 'members', action: 'profile.update', target: { member: member, field: field }, payload: { value: value },
        legacy: { name: 'raft:agent-profile-save', detail: { member: member, field: field, value: value } },
        control: form.querySelector('.inline-save'), optimistic: true,
        apply: function () {
          PROFILES[member][field] = value;
          if (field === 'name') PROFILES[member].handle = '@' + value;
          renderProfile();
        },
        rollback: function (error) {
          PROFILES[member].name = before.name;
          PROFILES[member].handle = before.handle;
          PROFILES[member].description = before.description;
          if (currentMember === member) {
            renderProfile();
            openEditor(section);
            section.dataset.raftError = error && error.message ? error.message : '保存失败';
          }
        }
      });
    });
    form.querySelector('.inline-cancel').addEventListener('click', function () {
      input.value = PROFILES[currentMember][field] || '';
      section.classList.remove('is-editing');
      section.removeAttribute('data-raft-error');
      section.querySelector('[data-field-value]').hidden = false;
      form.hidden = true;
      section.querySelector('[data-edit]').focus();
    });
    input.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      form.querySelector('.inline-cancel').click();
    });
  });

  document.querySelectorAll('[data-agent-action]').forEach(function (button) {
    button.addEventListener('click', function () {
      transact({
        domain: 'members', action: 'agent.action', target: { member: currentMember, operation: button.dataset.agentAction }, payload: {},
        legacy: { name: 'raft:agent-action', detail: { member: currentMember, action: button.dataset.agentAction } },
        control: button, optimistic: false
      });
    });
  });

  document.querySelectorAll('.side-title').forEach(function (title) {
    title.addEventListener('click', function (event) {
      if (event.target.closest('button')) return;
      var section = title.closest('.side-section');
      var rows = section.querySelectorAll('.member-row, .agent-computer-label');
      var collapsing = !section.classList.contains('is-collapsed');
      section.classList.toggle('is-collapsed', collapsing);
      rows.forEach(function (row) { row.hidden = collapsing; });
      title.querySelector(':scope > svg').style.transform = collapsing ? 'rotate(-90deg)' : '';
    });
  });

  var resizer = document.getElementById('memberResizer');
  RaftUIPrimitives.resizablePanel({
    root: document.getElementById('app'), handle: resizer, variable: '--sidebar-w', min: 240, max: 520, origin: 64,
    requestCommit: function (width, previous, apply, rollback) {
      transact({
        domain: 'members', action: 'sidebar.resize', target: { panel: 'members' }, payload: { width: width },
        legacy: { name: 'raft:members-sidebar-resize', detail: { width: width } }, key: 'members.sidebar.resize',
        control: resizer, apply: apply, rollback: rollback
      });
    }
  });

  renderProfile();
})();
