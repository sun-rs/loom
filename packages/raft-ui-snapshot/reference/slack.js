/* Mobile Chat projection. It shares protocol v1 with the desktop shell. */
(function () {
  'use strict';
  var tabbar = document.querySelector('.m-shell .m-tabbar');
  if (!tabbar) return;

  var views = {
    home: document.getElementById('mHome'), chat: document.getElementById('mChat'),
    tasks: document.getElementById('mTasks'), members: document.getElementById('mMembers'), settings: document.getElementById('mSettings')
  };
  var tabs = [].slice.call(tabbar.querySelectorAll('.m-tab'));
  var list = document.getElementById('mMessages');
  var current = 'home';

  /* Raft's published Web/PWA keyboard viewport projection. It owns only CSS
     geometry variables and has no dependency on fixture or future RAH data. */
  RaftUIPrimitives.visualViewport();

  function textKey(value) { return String(value || '').trim().toLocaleLowerCase().replace(/\s+/g, '-'); }

  function applyView(name) {
    Object.keys(views).forEach(function (key) { views[key].hidden = key !== name; });
    tabbar.style.display = name === 'chat' ? 'none' : '';
    tabs.forEach(function (tab) { tab.classList.toggle('is-active', tab.dataset.mtab === current); });
    if (name === 'chat') { list.scrollTop = list.scrollHeight; syncFab(); }
    window.scrollTo(0, 0);
  }

  function requestView(name, trigger, source) {
    var previous = null;
    var previousCurrent = null;
    return RaftUI.project({
      domain: 'chat', action: 'mobile.route.change', target: { route: name }, payload: { source: source || 'navigation' }, control: trigger || null, key: 'chat.mobile.route',
      apply: function () {
        previous = Object.keys(views).find(function (key) { return !views[key].hidden; }) || 'home';
        previousCurrent = current;
        if (name !== 'chat') current = name;
        applyView(name);
      },
      rollback: function () { current = previousCurrent; applyView(previous); }
    });
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      var before = null;
      var next = tab.dataset.mtab;
      RaftUI.project({
        domain: 'chat', action: 'mobile.route.change', target: { route: next }, payload: { source: 'tabbar' }, control: tab, key: 'chat.mobile.route',
        apply: function () { before = current; current = next; applyView(current); },
        rollback: function () { current = before; applyView(current); }
      });
    });
  });

  [].forEach.call(views.home.querySelectorAll('[data-open-chat]'), function (row) {
    row.addEventListener('click', function () { requestView('chat', row, 'room-row'); });
  });
  var workspaceButton = views.home.querySelector('.ws-chip');
  workspaceButton.addEventListener('click', function () {
    RaftUI.project({ domain: 'shell', action: 'workspace.switcher.open', target: { workspace: 'current' }, payload: {}, control: workspaceButton, optimistic: false });
  });
  var homeNotification = views.home.querySelector('.m-icon-btn[title="通知"]');
  homeNotification.addEventListener('click', function () {
    RaftUI.project({ domain: 'shell', action: 'notification.open', target: { surface: 'notifications' }, payload: {}, control: homeNotification, optimistic: false });
  });
  var quickRows = views.home.querySelectorAll('nav[aria-label="快捷入口"] .m-row');
  quickRows.forEach(function (button, index) {
    button.addEventListener('click', function () {
      if (index === 2) {
        RaftUI.project({ domain: 'chat', action: 'bookmarks.open', target: { workspace: 'current' }, payload: {}, control: button, optimistic: false });
        return;
      }
      var destination = index === 0 ? 'search.html' : 'activity.html';
      RaftUI.project({
        domain: 'shell', action: 'navigation.open', target: { surface: index === 0 ? 'search' : 'activity' }, payload: {}, control: button, optimistic: false,
        apply: function () { window.location.href = destination; }
      });
    });
  });
  views.chat.querySelector('.m-back').addEventListener('click', function (event) { requestView(current, event.currentTarget, 'back'); });

  var chatNotification = views.chat.querySelector('.m-head-actions [title="通知"]');
  chatNotification.addEventListener('click', function () {
    RaftUI.project({ domain: 'shell', action: 'notification.open', target: { surface: 'notifications' }, payload: {}, control: chatNotification, optimistic: false });
  });
  var chatThread = views.chat.querySelector('.m-head-actions [title="消息列"]');
  chatThread.addEventListener('click', function () {
    RaftUI.project({ domain: 'chat', action: 'thread.open', target: { room: 'onboarding-owner', thread: 'fixture-thread-4' }, payload: { source: 'mobile-header' }, control: chatThread, optimistic: false });
  });
  var chatSettings = views.chat.querySelector('.m-head-actions [title="设置"]');
  chatSettings.addEventListener('click', function () { requestView('settings', chatSettings, 'mobile-header'); });
  var chatMembers = views.chat.querySelector('.m-head-actions .members');
  chatMembers.addEventListener('click', function () { requestView('members', chatMembers, 'mobile-header'); });

  var panes = [].slice.call(views.chat.querySelectorAll('.m-chat-pane'));
  var fab = document.getElementById('mBackBottom');
  function syncFab() {
    var chatActive = !panes[0].hidden;
    fab.hidden = !(chatActive && list.scrollHeight > list.clientHeight + 1);
  }
  function applyPane(tab) {
    chatTabs.forEach(function (candidate) {
      var active = candidate === tab;
      candidate.classList.toggle('is-active', active);
      candidate.setAttribute('aria-selected', String(active));
      candidate.tabIndex = active ? 0 : -1;
    });
    panes.forEach(function (pane) { pane.hidden = pane.dataset.mpane !== tab.dataset.mpane; });
    syncFab();
  }
  var chatTabs = [].slice.call(views.chat.querySelectorAll('.tabs .tab'));
  chatTabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      var previous = null;
      RaftUI.project({
        domain: 'chat', action: 'mobile.pane.change', target: { pane: tab.dataset.mpane, room: 'onboarding-owner' }, payload: {}, key: 'chat.mobile.pane',
        apply: function () { previous = chatTabs.find(function (candidate) { return candidate.getAttribute('aria-selected') === 'true'; }); applyPane(tab); },
        rollback: function () { if (previous) applyPane(previous); }
      });
    });
  });
  views.chat.querySelector('.tabs').addEventListener('keydown', function (event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    var index = chatTabs.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    var next = chatTabs[(index + (event.key === 'ArrowRight' ? 1 : chatTabs.length - 1)) % chatTabs.length];
    next.focus(); next.click();
  });
  applyPane(chatTabs.find(function (tab) { return tab.getAttribute('aria-selected') === 'true'; }) || chatTabs[0]);

  fab.addEventListener('click', function () { list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' }); });

  var mobileNotice = document.getElementById('mNotice');
  mobileNotice.querySelector('.m-notice-close').addEventListener('click', function (event) {
    RaftUI.project({
      domain: 'shell', action: 'notification.dismiss', target: { notice: 'agent-background-work' }, payload: {}, control: event.currentTarget,
      apply: function () { mobileNotice.style.display = 'none'; }, rollback: function () { mobileNotice.style.display = ''; }
    });
  });
  mobileNotice.querySelector('.m-notice-cta').addEventListener('click', function (event) {
    RaftUI.project({
      domain: 'shell', action: 'notification.enable', target: { notice: 'agent-background-work' }, payload: {}, control: event.currentTarget, optimistic: false,
      apply: function () { mobileNotice.style.display = 'none'; }
    });
  });

  var textarea = views.chat.querySelector('.m-composer textarea');
  var sendButton = views.chat.querySelector('.m-composer .send-btn');
  function nowTime() {
    var date = new Date();
    return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
  }
  function syncSend() { sendButton.disabled = sendButton.getAttribute('aria-busy') === 'true' || !textarea.value.trim(); }
  function send() {
    var originalDraft = textarea.value;
    var text = originalDraft.trim();
    if (!text || sendButton.getAttribute('aria-busy') === 'true') return;
    var clientMessageId = RaftUI.createId('msg');
    var clientTurnId = RaftUI.createId('turn');
    var article = null;
    RaftUI.project({
      domain: 'chat', action: 'message.send', target: { room: 'onboarding-owner', thread: null },
      payload: { text: text, asTask: false, clientMessageId: clientMessageId, clientTurnId: clientTurnId },
      control: sendButton, optimistic: false,
      apply: function () {
        article = document.createElement('article');
        article.className = 'msg';
        article.dataset.clientMessageId = clientMessageId;
        article.innerHTML = '<span class="avatar"><svg><use href="#av-user"></use></svg></span><div class="msg-body"><header class="msg-head"><b>你</b><time></time></header><p></p></div>';
        article.querySelector('time').textContent = nowTime();
        article.querySelector('p').textContent = text;
        list.appendChild(article);
        list.scrollTop = list.scrollHeight;
        syncFab();
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
  views.chat.querySelectorAll('.m-composer .sq-btn[title="图片"], .m-composer .sq-btn[title="附件"]').forEach(function (button) {
    button.addEventListener('click', function () {
      RaftUI.project({
        domain: 'chat', action: 'composer.asset.request', target: { room: 'onboarding-owner' },
        payload: { kind: button.getAttribute('title') === '图片' ? 'image' : 'attachment' }, control: button, optimistic: false
      });
    });
  });
  textarea.addEventListener('input', syncSend);
  textarea.addEventListener('keydown', function (event) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); send(); }
  });
  views.members.querySelectorAll('.m-row').forEach(function (button) {
    button.addEventListener('click', function () {
      var name = button.querySelector('b')?.textContent || button.textContent;
      RaftUI.project({ domain: 'members', action: 'participant.select', target: { member: textKey(name) }, payload: {}, control: button, key: 'members.navigation', optimistic: false });
    });
  });
  views.settings.querySelectorAll('.m-row').forEach(function (button) {
    button.addEventListener('click', function () {
      RaftUI.project({ domain: 'settings', action: 'section.open', target: { section: textKey(button.textContent) }, payload: {}, control: button, key: 'settings.section', optimistic: false });
    });
  });
  syncSend();
})();
