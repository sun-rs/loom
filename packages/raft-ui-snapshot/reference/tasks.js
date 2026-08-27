(function () {
  'use strict';

  var filters = Array.prototype.slice.call(document.querySelectorAll('.task-filter'));
  var clearAll = document.getElementById('clearTaskFilters');
  var countSuffix = document.getElementById('taskCountSuffix');
  var emptyTitle = document.getElementById('tasksEmptyTitle');
  var emptyBody = document.getElementById('tasksEmptyBody');

  function transact(options) {
    return RaftUI.project(options).accepted;
  }

  function closeMenus(except) {
    filters.forEach(function (filter) {
      if (filter === except) return;
      var trigger = filter.querySelector('.task-filter-trigger');
      var menu = filter.querySelector('.task-filter-menu');
      trigger.setAttribute('aria-expanded', 'false');
      menu.hidden = true;
    });
  }

  function selectedValues(filter) {
    return Array.prototype.slice.call(filter.querySelectorAll('.task-filter-options .is-option-selected'))
      .map(function (option) { return option.dataset.value; });
  }

  function setOption(option, selected) {
    option.classList.toggle('is-option-selected', selected);
    var existingCheck = option.querySelector(':scope > svg');
    if (selected && !existingCheck) option.insertAdjacentHTML('beforeend', '<svg><use href="#i-check"></use></svg>');
    if (!selected && existingCheck) existingCheck.remove();
  }

  function syncFilter(filter) {
    var values = selectedValues(filter);
    var count = filter.querySelector('.task-filter-count');
    filter.classList.toggle('is-selected', values.length > 0);
    if (count && values.length) count.textContent = String(values.length);
    else if (count) count.remove();
    else if (values.length) {
      count = document.createElement('span');
      count.className = 'task-filter-count';
      count.textContent = String(values.length);
      filter.querySelector('.task-filter-trigger .chevron').before(count);
    }
  }

  function syncEmptyState() {
    var active = filters.some(function (filter) { return selectedValues(filter).length > 0; });
    clearAll.hidden = !active;
    countSuffix.textContent = active ? ' / 共 0 个频道任务' : ' 个频道任务';
    emptyTitle.textContent = active ? '没有符合此筛选的任务' : '暂无任务';
    emptyBody.textContent = active ? '换一个筛选组合，或清除当前选择。' : '服务器级视图有意排除私信与 Agent 任务看板。';
  }

  function syncTaskProjection(filter) { syncFilter(filter); syncEmptyState(); }

  filters.forEach(function (filter) {
    var trigger = filter.querySelector('.task-filter-trigger');
    var menu = filter.querySelector('.task-filter-menu');
    var search = filter.querySelector('input[type="search"]');
    var options = Array.prototype.slice.call(filter.querySelectorAll('.task-filter-options > button'));

    trigger.addEventListener('click', function () {
      var opening = menu.hidden;
      closeMenus(opening ? filter : null);
      menu.hidden = !opening;
      trigger.setAttribute('aria-expanded', String(opening));
      if (opening) requestAnimationFrame(function () { search.focus(); });
    });

    search.addEventListener('input', function () {
      var query = search.value.trim().toLocaleLowerCase();
      options.forEach(function (option) { option.hidden = Boolean(query && !option.textContent.toLocaleLowerCase().includes(query)); });
    });

    options.forEach(function (option) {
      option.addEventListener('click', function () {
        var before = null;
        var desired = !option.classList.contains('is-option-selected');
        var nextValues = selectedValues(filter).filter(function (value) { return value !== option.dataset.value; });
        if (desired) nextValues.push(option.dataset.value);
        transact({
          domain: 'tasks', action: 'filter.change', target: { filter: filter.dataset.filter }, payload: { values: nextValues },
          legacy: { name: 'raft:tasks-filter-change', detail: { filter: filter.dataset.filter, values: nextValues } },
          key: 'tasks.filter.' + filter.dataset.filter, control: option, controls: [clearAll],
          apply: function () {
            before = options.map(function (candidate) { return candidate.classList.contains('is-option-selected'); });
            options.forEach(function (candidate) { setOption(candidate, nextValues.indexOf(candidate.dataset.value) >= 0); });
            syncTaskProjection(filter);
          },
          rollback: function () { options.forEach(function (candidate, index) { setOption(candidate, before[index]); }); syncTaskProjection(filter); }
        });
      });
    });

    var clear = filter.querySelector('[data-clear]');
    if (clear) clear.addEventListener('click', function () {
      var before = null;
      transact({
        domain: 'tasks', action: 'filter.change', target: { filter: filter.dataset.filter }, payload: { values: [] },
        legacy: { name: 'raft:tasks-filter-change', detail: { filter: filter.dataset.filter, values: [] } },
        key: 'tasks.filter.' + filter.dataset.filter, control: clear, controls: [clearAll],
        apply: function () { before = options.map(function (option) { return option.classList.contains('is-option-selected'); }); options.forEach(function (option) { setOption(option, false); }); syncTaskProjection(filter); },
        rollback: function () { options.forEach(function (option, index) { setOption(option, before[index]); }); syncTaskProjection(filter); }
      });
    });
  });

  clearAll.addEventListener('click', function () {
    var snapshot = null;
    transact({
      domain: 'tasks', action: 'filters.clear', target: {}, payload: {},
      legacy: { name: 'raft:tasks-clear-filters', detail: {} }, control: clearAll, key: 'tasks.filters.clear',
      controls: Array.prototype.slice.call(document.querySelectorAll('.task-filter-options > button, [data-clear]')),
      apply: function () {
        snapshot = filters.map(function (filter) {
          return Array.prototype.map.call(filter.querySelectorAll('.task-filter-options > button'), function (option) { return option.classList.contains('is-option-selected'); });
        });
        filters.forEach(function (filter) {
          filter.querySelectorAll('.task-filter-options > button').forEach(function (option) { setOption(option, false); });
          syncFilter(filter);
        });
        closeMenus(); syncEmptyState();
      },
      rollback: function () {
        filters.forEach(function (filter, filterIndex) {
          filter.querySelectorAll('.task-filter-options > button').forEach(function (option, optionIndex) { setOption(option, snapshot[filterIndex][optionIndex]); });
          syncFilter(filter);
        });
        syncEmptyState();
      }
    });
  });

  var viewGroup = document.querySelector('.tasks-view');
  var views = Array.prototype.slice.call(viewGroup.querySelectorAll('[role="radio"]'));
  function applyView(button) {
    views.forEach(function (view) {
      var selected = view === button;
      view.setAttribute('aria-checked', String(selected));
      view.tabIndex = selected ? 0 : -1;
    });
  }
  function selectView(button, focus) {
    var previous = null;
    var accepted = transact({
      domain: 'tasks', action: 'view.change', target: { view: button.dataset.view }, payload: {},
      legacy: { name: 'raft:tasks-view-change', detail: { view: button.dataset.view } }, key: 'tasks.view',
      apply: function () { previous = views.filter(function (view) { return view.getAttribute('aria-checked') === 'true'; })[0]; applyView(button); },
      rollback: function () { applyView(previous); }
    });
    if (accepted && focus) button.focus();
  }
  views.forEach(function (button) { button.addEventListener('click', function () { selectView(button, false); }); });
  viewGroup.addEventListener('keydown', function (event) {
    var index = views.indexOf(document.activeElement);
    if (index < 0 || ['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(event.key) < 0) return;
    event.preventDefault();
    var next = event.key === 'Home' ? 0 : event.key === 'End' ? views.length - 1 :
      (index + (event.key === 'ArrowRight' ? 1 : views.length - 1)) % views.length;
    selectView(views[next], true);
  });

  document.addEventListener('pointerdown', function (event) { if (!event.target.closest('.task-filter')) closeMenus(); });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    var open = filters.find(function (filter) { return !filter.querySelector('.task-filter-menu').hidden; });
    if (!open) return;
    closeMenus(); open.querySelector('.task-filter-trigger').focus();
  });

  filters.forEach(syncFilter);
  syncEmptyState();
})();
