/* Activity inbox projection. Product actions use Raft UI protocol v1. */
(function () {
  'use strict';

  var filters = Array.prototype.slice.call(document.querySelectorAll('.activity-filter'));
  var cards = Array.prototype.slice.call(document.querySelectorAll('.feed-card'));
  var countEl = document.getElementById('openCount');
  var activeFilter = 'all';

  function transact(options) {
    return RaftUI.project(options);
  }

  function isVisibleForFilter(card) {
    if (card.dataset.completed === 'true') return false;
    if (activeFilter === 'unread') return card.dataset.unread === 'true';
    if (activeFilter === 'mentions') return card.dataset.mention === 'true';
    return true;
  }

  function renderFilter() { cards.forEach(function (card) { card.hidden = !isVisibleForFilter(card); }); }

  function applyFilter(next) {
    activeFilter = next;
    filters.forEach(function (filter) {
      var selected = filter.dataset.filter === next;
      filter.classList.toggle('is-active', selected);
      filter.setAttribute('aria-checked', String(selected));
      filter.tabIndex = selected ? 0 : -1;
    });
    renderFilter();
  }

  function chooseFilter(next, focus) {
    var before = null;
    var value = next.dataset.filter || 'all';
    var handle = transact({
      domain: 'activity', action: 'filter.change', target: { filter: value }, payload: {}, key: 'activity.filter',
      apply: function () { before = activeFilter; applyFilter(value); }, rollback: function () { applyFilter(before); }
    });
    if (handle.accepted && focus) next.focus();
  }

  filters.forEach(function (filter, index) {
    filter.tabIndex = filter.classList.contains('is-active') ? 0 : -1;
    filter.addEventListener('click', function () { chooseFilter(filter, false); });
    filter.addEventListener('keydown', function (event) {
      var nextIndex = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % filters.length;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + filters.length) % filters.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = filters.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      chooseFilter(filters[nextIndex], true);
    });
  });

  cards.forEach(function (card) {
    var done = card.querySelector('.activity-done');

    card.addEventListener('click', function () {
      var detail = { id: card.dataset.activityId, href: card.dataset.href };
      transact({
        domain: 'activity', action: 'item.open', target: { activity: detail.id }, payload: { href: detail.href },
        legacy: { name: 'raft:open-activity', detail: detail }, optimistic: false,
        apply: function () { if (card.dataset.href) window.location.href = card.dataset.href; }
      });
    });

    function complete(event) {
      event.preventDefault();
      event.stopPropagation();
      if (card.dataset.completed === 'true') return;
      var previousCount = countEl ? countEl.textContent : '';
      var timer = null;
      transact({
        domain: 'activity', action: 'item.complete', target: { activity: card.dataset.activityId }, payload: {},
        legacy: { name: 'raft:complete-activity', detail: { id: card.dataset.activityId } }, control: done,
        apply: function () {
          card.dataset.completed = 'true';
          card.classList.add('is-completing');
          done.tabIndex = -1;
          if (countEl) {
            var count = parseInt(countEl.textContent, 10);
            countEl.textContent = String(Math.max(0, (isNaN(count) ? 1 : count) - 1));
          }
          timer = window.setTimeout(function () {
            card.classList.remove('is-completing');
            renderFilter();
            var next = cards.find(function (candidate) { return !candidate.hidden; });
            if (next) next.focus({ preventScroll: true });
          }, 150);
        },
        commit: function () {
          done.disabled = true;
          done.setAttribute('aria-disabled', 'true');
        },
        rollback: function () {
          if (timer !== null) window.clearTimeout(timer);
          card.dataset.completed = 'false';
          card.classList.remove('is-completing');
          done.disabled = false;
          done.removeAttribute('aria-disabled');
          done.tabIndex = 0;
          if (countEl) countEl.textContent = previousCount;
          renderFilter();
        }
      });
    }

    done.addEventListener('click', complete);
    done.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') complete(event); });
  });

  var header = document.querySelector('.activity-head');
  if (header) {
    header.addEventListener('dblclick', function () {
      var nextUnread = cards.find(function (card) { return card.dataset.unread === 'true' && card.dataset.completed !== 'true'; });
      if (!nextUnread) return;
      nextUnread.scrollIntoView({ block: 'nearest' });
      nextUnread.focus({ preventScroll: true });
    });
  }
})();
