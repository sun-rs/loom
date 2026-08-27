/* Shared desktop Chat projection. Product actions use Raft UI protocol v1. */
(function () {
  'use strict';

  var app = document.getElementById('app');
  if (!app || !window.RaftUI) return;
  var roomId = 'onboarding-owner';

  if (window.matchMedia('(max-width: 1279.98px)').matches) app.classList.add('thread-hidden');

  function project(options) { return RaftUI.project(options); }

  /* Room selection is a projection only; the host adapter owns navigation/data. */
  var roomRows = Array.prototype.slice.call(document.querySelectorAll('.sidebar .channel-row, .sidebar .dm-row'));
  function roomTarget(row) {
    var direct = row.classList.contains('dm-row');
    var name = direct ? row.querySelector('.dm-name').textContent.trim() : row.textContent.replace(/^\s*#\s*/, '').trim();
    return { room: name.toLocaleLowerCase().replace(/\s+/g, '-'), kind: direct ? 'direct' : 'channel' };
  }
  function applyRoomSelection(selected) {
    roomRows.forEach(function (row) {
      var on = row === selected;
      row.classList.toggle('is-selected', on);
      row.setAttribute('aria-pressed', String(on));
    });
    roomId = roomTarget(selected).room;
  }
  roomRows.forEach(function (row) {
    row.setAttribute('aria-pressed', String(row.classList.contains('is-selected')));
    row.addEventListener('click', function () {
      var previous = null;
      var target = roomTarget(row);
      project({
        domain: 'chat', action: 'room.select', target: target, payload: {}, key: 'chat.room.select',
        apply: function () {
          previous = roomRows.filter(function (candidate) { return candidate.classList.contains('is-selected'); })[0];
          applyRoomSelection(row);
        },
        rollback: function () { if (previous) applyRoomSelection(previous); }
      });
    });
  });

  var bookmarks = document.querySelector('.sidebar-bookmarks');
  if (bookmarks) bookmarks.addEventListener('click', function () {
    project({ domain: 'chat', action: 'bookmarks.open', target: { workspace: 'current' }, payload: {}, control: bookmarks, optimistic: false });
  });

  document.querySelectorAll('.side-actions button').forEach(function (button) {
    button.addEventListener('click', function () {
      var create = (button.getAttribute('title') || '').indexOf('新建') >= 0;
      var section = button.closest('.side-section, .m-group');
      project({
        domain: 'chat', action: create ? 'room.create' : 'room.sort',
        target: { workspace: 'current', section: section ? section.textContent.trim().slice(0, 32) : 'rooms' },
        payload: {}, control: button, optimistic: false
      });
    });
  });

  /* Thread column open/close. */
  var toggleThread = document.getElementById('toggleThread');
  var closeThread = document.getElementById('closeThread');
  var threadToggles = Array.prototype.slice.call(document.querySelectorAll('[aria-controls="threadPanel"]'));
  function applyThreadOpen(open) {
    app.classList.toggle('thread-hidden', !open);
    threadToggles.forEach(function (button) { button.setAttribute('aria-expanded', String(open)); });
  }
  function requestThread(open, source, control) {
    var previous = null;
    return project({
      domain: 'chat', action: open ? 'thread.open' : 'thread.close',
      target: { room: roomId, thread: 'fixture-thread-4' }, payload: { source: source || 'control' }, control: control || null, key: 'chat.thread',
      apply: function () { previous = !app.classList.contains('thread-hidden'); applyThreadOpen(open); },
      rollback: function () { applyThreadOpen(previous); }
    });
  }
  if (toggleThread) toggleThread.addEventListener('click', function () { requestThread(app.classList.contains('thread-hidden'), 'header', toggleThread); });
  if (closeThread) closeThread.addEventListener('click', function () { requestThread(false, 'close', closeThread); });
  document.querySelectorAll('.thread-preview').forEach(function (preview, index) {
    preview.addEventListener('click', function () { requestThread(true, 'preview-' + (index + 1), preview.matches('button') ? preview : null); });
  });
  document.querySelectorAll('.mention-chip').forEach(function (button, index) {
    button.addEventListener('click', function () { requestThread(true, 'mention-' + (index + 1), button); });
  });
  applyThreadOpen(!app.classList.contains('thread-hidden'));

  function nowTime() {
    var date = new Date();
    return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
  }

  /* Composer is pessimistic: draft remains until the matching adapter success. */
  document.querySelectorAll('.composer').forEach(function (composer) {
    var textarea = composer.querySelector('textarea');
    var sendButton = composer.querySelector('.send-btn');
    var list = composer.parentElement.querySelector('.messages');
    if (!textarea || !sendButton || !list) return;
    var context = list.id === 'threadMessages' ? 'thread' : 'channel';

    function syncSend() {
      sendButton.disabled = sendButton.getAttribute('aria-busy') === 'true' || !textarea.value.trim();
    }

    function send() {
      var originalDraft = textarea.value;
      var text = originalDraft.trim();
      if (!text || sendButton.getAttribute('aria-busy') === 'true') return;
      var clientMessageId = RaftUI.createId('msg');
      var clientTurnId = RaftUI.createId('turn');
      var taskInput = composer.querySelector('.task-check input');
      var article = null;
      project({
        domain: 'chat', action: 'message.send',
        target: { room: roomId, thread: context === 'thread' ? 'fixture-thread-4' : null },
        payload: { text: text, asTask: Boolean(taskInput && taskInput.checked), clientMessageId: clientMessageId, clientTurnId: clientTurnId },
        control: sendButton, optimistic: false,
        apply: function () {
          article = document.createElement('article');
          article.className = 'msg';
          article.dataset.clientMessageId = clientMessageId;
          article.innerHTML = '<span class="avatar"><svg><use href="#av-user"></use></svg></span>' +
            '<div class="msg-body"><header class="msg-head"><b>你</b><time></time></header><p></p></div>';
          article.querySelector('time').textContent = nowTime();
          article.querySelector('p').textContent = text;
          list.appendChild(article);
          list.scrollTop = list.scrollHeight;
          if (textarea.value === originalDraft) textarea.value = '';
          textarea.focus();
          queueMicrotask(syncSend);
        },
        rollback: function () {
          if (article) article.remove();
          if (!textarea.value) textarea.value = originalDraft;
          queueMicrotask(syncSend);
        }
      });
    }

    sendButton.addEventListener('click', send);
    textarea.addEventListener('keydown', function (event) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); send(); }
    });
    textarea.addEventListener('input', syncSend);
    syncSend();
  });

  document.querySelectorAll('.composer .sq-btn[title="图片"], .composer .sq-btn[title="附件"]').forEach(function (button) {
    button.addEventListener('click', function () {
      project({
        domain: 'chat', action: 'composer.asset.request', target: { room: roomId },
        payload: { kind: button.getAttribute('title') === '图片' ? 'image' : 'attachment' }, control: button, optimistic: false
      });
    });
  });

  document.querySelectorAll('.board-toolbar .filter-chip').forEach(function (button) {
    button.addEventListener('click', function () {
      project({ domain: 'chat', action: 'task.filter.open', target: { room: roomId, filter: button.textContent.trim() }, payload: {}, control: button, optimistic: false });
    });
  });
  var createTask = document.querySelector('.board-toolbar .btn-pink');
  if (createTask) createTask.addEventListener('click', function () {
    project({ domain: 'chat', action: 'task.create', target: { room: roomId }, payload: {}, control: createTask, optimistic: false });
  });

  document.querySelectorAll('.file-row').forEach(function (row, index) {
    row.querySelectorAll('.sq-btn').forEach(function (button) {
      button.addEventListener('click', function () {
        project({
          domain: 'chat', action: button.classList.contains('file-dl') ? 'file.download' : 'file.menu.open',
          target: { room: roomId, file: 'fixture-file-' + (index + 1) }, payload: {}, control: button, optimistic: false
        });
      });
    });
  });
  document.querySelectorAll('.attach-card .sq-btn[title="预览"]').forEach(function (button, index) {
    button.addEventListener('click', function () {
      project({ domain: 'chat', action: 'file.preview', target: { room: roomId, file: 'fixture-attachment-' + (index + 1) }, payload: {}, control: button, optimistic: false });
    });
  });
  var revealFile = document.querySelector('.thread-head .sq-btn.wide');
  if (revealFile) revealFile.addEventListener('click', function () {
    project({ domain: 'chat', action: 'file.reveal', target: { room: roomId, thread: 'fixture-thread-4' }, payload: {}, control: revealFile, optimistic: false });
  });

  document.querySelectorAll('.muted-link').forEach(function (button, index) {
    button.setAttribute('aria-expanded', String(button.textContent.trim() === '收起'));
    button.addEventListener('click', function () {
      var before = button.getAttribute('aria-expanded') === 'true';
      project({
        domain: 'chat', action: 'message.expand.toggle', target: { room: roomId, message: 'fixture-thread-message-' + (index + 1) },
        payload: { expanded: !before }, control: button,
        apply: function () { button.setAttribute('aria-expanded', String(!before)); button.textContent = before ? '展开全文' : '收起'; },
        rollback: function () { button.setAttribute('aria-expanded', String(before)); button.textContent = before ? '收起' : '展开全文'; }
      });
    });
  });

  /* Message actions: reply opens the thread; other actions leave a typed intent. */
  document.querySelectorAll('.msg').forEach(function (message, messageIndex) {
    message.querySelectorAll('.msg-action-btn').forEach(function (button) {
      button.addEventListener('click', function () {
        var label = button.getAttribute('title') || '';
        if (label.indexOf('回复') >= 0) {
          requestThread(true, 'message-' + (messageIndex + 1), button);
          return;
        }
        var operation = label.indexOf('收藏') >= 0 ? 'bookmark' : 'reaction';
        var pressed = button.getAttribute('aria-pressed') === 'true';
        project({
          domain: 'chat', action: 'message.action', target: { room: roomId, message: 'fixture-message-' + (messageIndex + 1), operation: operation }, payload: {}, control: button,
          apply: function () { button.setAttribute('aria-pressed', String(!pressed)); },
          rollback: function () { button.setAttribute('aria-pressed', String(pressed)); }
        });
      });
    });
  });

  var stopAgents = document.getElementById('stopChannelAgents');
  if (stopAgents) stopAgents.addEventListener('click', function () {
    project({ domain: 'chat', action: 'agents.stop', target: { room: roomId }, payload: {}, control: stopAgents, optimistic: false });
  });

  /* Shared resizer primitive owns pointer capture, keyboard and ARIA projection. */
  function readPx(name, fallback) {
    var value = parseFloat(getComputedStyle(app).getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  }
  function mountResizer(panel, side, options) {
    if (!panel) return;
    var handle = document.createElement('div');
    handle.className = 'col-resizer';
    handle.style[side] = '-4px';
    handle.title = options.label;
    handle.tabIndex = 0;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-label', options.label);
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-valuemin', String(options.min));
    handle.setAttribute('aria-valuemax', String(options.max));
    handle.setAttribute('aria-valuenow', String(Math.round(options.initial())));
    panel.prepend(handle);
    RaftUIPrimitives.resizablePanel({
      root: app, handle: handle, variable: options.variable, min: options.min, max: options.max,
      origin: options.origin || 0, measure: options.measure,
      requestCommit: function (width, previous, apply, rollback) {
        project({
          domain: 'chat', action: options.action, target: { panel: options.panel }, payload: { width: width },
          key: 'chat.resize.' + options.panel, control: handle, apply: apply, rollback: rollback
        });
      }
    });
  }
  mountResizer(document.querySelector('.sidebar'), 'right', {
    label: '调整聊天边栏宽度', min: 180, max: 400, variable: '--sidebar-w', panel: 'rooms', action: 'sidebar.resize',
    origin: readPx('--rail-w', 64), initial: function () { return readPx('--sidebar-w', 320); }
  });
  mountResizer(document.getElementById('threadPanel'), 'left', {
    label: '调整消息列宽度', min: 360, max: 900, variable: '--thread-w', panel: 'thread', action: 'thread.resize',
    measure: function (event) { return window.innerWidth - event.clientX; }, initial: function () { return readPx('--thread-w', 520); }
  });
})();
