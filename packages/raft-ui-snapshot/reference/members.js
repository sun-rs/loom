(function () {
  'use strict';
  var rows = Array.prototype.slice.call(document.querySelectorAll('.member-row'));
  function applySelection(row) { rows.forEach(function (candidate) { candidate.classList.toggle('is-selected', candidate === row); }); }
  rows.forEach(function (row) {
    row.addEventListener('click', function () {
      var previous = null;
      RaftUI.project({
        domain: 'members', action: 'participant.select', target: { member: row.dataset.member }, payload: {}, control: row, key: 'members.navigation',
        apply: function () { previous = rows.filter(function (candidate) { return candidate.classList.contains('is-selected'); })[0]; applySelection(row); },
        rollback: function () { if (previous) applySelection(previous); }
      });
    });
  });

  var relationship = document.querySelector('.sec-body .side-section:first-child .channel-row');
  if (relationship) relationship.addEventListener('click', function () {
    RaftUI.project({ domain: 'members', action: 'relationship.open', target: { workspace: 'current' }, payload: {}, control: relationship, optimistic: false });
  });
  document.querySelectorAll('.side-actions button').forEach(function (button) {
    button.addEventListener('click', function () {
      var invite = (button.getAttribute('title') || '').indexOf('邀请') >= 0;
      RaftUI.project({
        domain: 'members', action: invite ? 'member.invite' : 'member.create', target: { workspace: 'current' }, payload: {},
        control: button, optimistic: false
      });
    });
  });
})();
