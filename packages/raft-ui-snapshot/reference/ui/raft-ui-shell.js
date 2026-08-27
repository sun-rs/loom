(function () {
  'use strict';
  if (!window.RaftUI) return;

  function slug(value) {
    return String(value || '').trim().toLocaleLowerCase().replace(/\s+/g, '-');
  }

  document.querySelectorAll('button.rail-logo').forEach(function (button) {
    button.addEventListener('click', function () {
      RaftUI.project({
        domain: 'shell', action: 'workspace.switcher.open', target: { workspace: 'current' }, payload: {},
        control: button, optimistic: false
      });
    });
  });

  document.querySelectorAll('.rail a[href="#"]').forEach(function (link) {
    link.addEventListener('click', function (event) {
      event.preventDefault();
      var title = link.getAttribute('title') || link.textContent;
      var notification = title.indexOf('通知') >= 0;
      RaftUI.project({
        domain: 'shell', action: notification ? 'notification.open' : 'navigation.open',
        target: { surface: notification ? 'notifications' : slug(title) }, payload: {}, control: link, optimistic: false
      });
    });
  });
  document.querySelectorAll('.rail button[title="通知"]:not([data-notification-trigger])').forEach(function (button) {
    button.addEventListener('click', function () {
      RaftUI.project({
        domain: 'shell', action: 'notification.open', target: { surface: 'notifications' }, payload: {},
        control: button, optimistic: false
      });
    });
  });

  var route = document.body.dataset.raftRoute;
  if (route === 'settings' || route === 'billing' || route === 'admin') {
    document.querySelectorAll('.sec-sidebar button.channel-row').forEach(function (button) {
      button.addEventListener('click', function () {
        RaftUI.project({
          domain: 'settings', action: 'section.open', target: { section: slug(button.textContent) }, payload: {},
          control: button, key: 'settings.section', optimistic: false
        });
      });
    });
  }
})();
