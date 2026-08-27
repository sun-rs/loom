/* Computer detail projection. Backend-affecting actions use Raft UI protocol v1. */
(function () {
  'use strict';

  function transact(options) {
    return RaftUI.project(options);
  }

  document.querySelectorAll('.comp-row[data-computer]').forEach(function (button) {
    button.addEventListener('click', function () {
      transact({ domain: 'computers', action: 'computer.select', target: { computer: button.dataset.computer }, payload: {}, control: button, key: 'computers.selection', optimistic: false });
    });
  });

  document.querySelectorAll('[data-computer-action]').forEach(function (button) {
    button.addEventListener('click', function () {
      var operation = button.dataset.computerAction;
      transact({
        domain: 'computers', action: 'computer.action', target: { computer: 'mac-studio', operation: operation }, payload: {},
        legacy: { name: 'raft:computer-action', detail: { computer: 'mac-studio', action: operation } },
        control: button, optimistic: false
      });
    });
  });

  document.querySelectorAll('[data-agent]').forEach(function (button) {
    button.addEventListener('click', function () {
      transact({
        domain: 'computers', action: 'agent.open', target: { computer: 'mac-studio', agent: button.dataset.agent }, payload: {},
        legacy: { name: 'raft:computer-agent-open', detail: { computer: 'mac-studio', agent: button.dataset.agent } },
        control: button, optimistic: false
      });
    });
  });

  document.querySelectorAll('[data-runtime]').forEach(function (button) {
    button.addEventListener('click', function () {
      transact({
        domain: 'computers', action: 'runtime.open', target: { computer: 'mac-studio', runtime: button.dataset.runtime }, payload: {},
        legacy: { name: 'raft:computer-runtime-open', detail: { computer: 'mac-studio', runtime: button.dataset.runtime } },
        control: button, optimistic: false
      });
    });
  });

  document.querySelectorAll('.command-row .copy').forEach(function (button) {
    button.addEventListener('click', function () {
      var code = button.closest('.command-row').querySelector('code').textContent.trim();
      transact({
        domain: 'computers', action: 'command.copy', target: { computer: 'mac-studio' }, payload: { command: code },
        legacy: { name: 'raft:computer-command-copy', detail: { computer: 'mac-studio', command: code } },
        control: button,
        apply: function () {
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).catch(function () {});
          button.classList.add('is-copied');
          window.setTimeout(function () { button.classList.remove('is-copied'); }, 900);
        },
        rollback: function () { button.classList.remove('is-copied'); }
      });
    });
  });

  var recovery = document.querySelector('.recovery-toggle');
  RaftUIPrimitives.disclosure({
    trigger: recovery,
    panel: recovery.closest('.recovery-card').querySelector('.recovery-body'),
    requestChange: function (expanded, apply, rollback) {
      transact({
        domain: 'computers', action: 'recovery.toggle', target: { computer: 'mac-studio' }, payload: { expanded: expanded },
        legacy: { name: 'raft:computer-recovery-toggle', detail: { expanded: expanded } },
        key: 'computers.recovery', control: recovery, apply: apply, rollback: rollback
      });
    }
  });

  var resizer = document.getElementById('computerResizer');
  RaftUIPrimitives.resizablePanel({
    root: document.getElementById('app'), handle: resizer, variable: '--sidebar-w', min: 240, max: 520, origin: 64,
    requestCommit: function (width, previous, apply, rollback) {
      transact({
        domain: 'computers', action: 'sidebar.resize', target: { panel: 'computers' }, payload: { width: width },
        legacy: { name: 'raft:computer-sidebar-resize', detail: { width: width } }, key: 'computers.sidebar.resize',
        control: resizer, apply: apply, rollback: rollback
      });
    }
  });
})();
