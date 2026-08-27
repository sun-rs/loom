/* Search route projection. Query/filter/sort actions use protocol v1. */
(function () {
  'use strict';

  var items = Array.prototype.slice.call(document.querySelectorAll('.filter-item[data-filter]'));
  var input = document.getElementById('searchInput');
  var emptyState = document.getElementById('emptyState');
  var resultList = document.getElementById('resultList');
  var sortButton = document.getElementById('btnSort');
  var clearFilters = document.getElementById('clearFilters');
  var results = [
    { channel: '#onboarding-owner', title: '记忆索引应该放什么', summary: '结论是只放角色、规则和活跃上下文指针，详细历史挪到 notes 按需拉取，这样每轮固定成本只取决于索引长度。', time: '昨天 19:47' },
    { channel: '#all', title: '搜索页视觉走查清单', summary: '过滤器按钮、下拉面板与结果卡片统一 2px 黑描边和硬阴影，空状态居中，移动端过滤器横向滚动。', time: '今天 09:12' },
    { channel: '#onboarding-owner', title: 'Agent 按角色还是按项目划分', summary: '官方把 Agent 定义成有长期身份和记忆的同事，同一角色可以进入多个对话，不按项目新建。', time: '08-22 14:03' }
  ];
  var sortByTime = false;

  function project(options) { return RaftUI.project(options); }
  function closeAll() {
    items.forEach(function (item) {
      item.querySelector('.dropdown-panel').hidden = true;
      item.querySelector('.filter-btn').classList.remove('is-open');
    });
  }
  function filterRows(panel, query) {
    query = query.trim().toLowerCase();
    panel.querySelectorAll('.dropdown-row').forEach(function (row) {
      row.style.display = !query || row.textContent.toLowerCase().indexOf(query) !== -1 ? '' : 'none';
    });
  }
  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }
  function renderResults() {
    var query = input.value.trim().toLowerCase();
    if (!query) {
      sortButton.disabled = true;
      resultList.hidden = true;
      resultList.innerHTML = '';
      emptyState.hidden = false;
      return;
    }
    sortButton.disabled = false;
    var hits = results.filter(function (result) { return (result.channel + result.title + result.summary).toLowerCase().indexOf(query) !== -1; });
    if (sortByTime) hits = hits.slice().reverse();
    emptyState.hidden = true;
    resultList.hidden = false;
    if (!hits.length) {
      resultList.innerHTML = '<p class="result-none">没有匹配「' + escapeHtml(input.value.trim()) + '」的结果，换个关键词或调整过滤器试试。</p>';
      return;
    }
    resultList.innerHTML = hits.map(function (result) {
      return '<article class="result-item"><div class="result-body"><p class="result-channel">' + result.channel +
        '</p><h2 class="result-title">' + result.title + '</h2><p class="result-summary">' + result.summary +
        '</p></div><time class="result-time">' + result.time + '</time></article>';
    }).join('');
  }

  items.forEach(function (item) {
    var button = item.querySelector('.filter-btn');
    var panel = item.querySelector('.dropdown-panel');
    var label = button.querySelector('.f-label');
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      var willOpen = panel.hidden;
      closeAll();
      panel.hidden = !willOpen;
      button.classList.toggle('is-open', willOpen);
      if (willOpen) {
        var search = panel.querySelector('.dropdown-search input');
        if (search) { search.value = ''; filterRows(panel, ''); search.focus(); }
      }
    });
    panel.addEventListener('click', function (event) { event.stopPropagation(); });
    panel.querySelectorAll('.dropdown-row').forEach(function (row) {
      row.addEventListener('click', function () {
        var rows = Array.prototype.slice.call(panel.querySelectorAll('.dropdown-row'));
        var snapshot = null;
        var beforeLabel = null;
        var beforeValue = row.classList.contains('is-selected');
        var nextValue = beforeValue ? null : row.dataset.value;
        project({
          domain: 'search', action: 'filter.change', target: { filter: item.dataset.filter }, payload: { value: nextValue },
          key: 'search.configuration', control: row,
          apply: function () {
            snapshot = rows.map(function (candidate) { return candidate.classList.contains('is-selected'); });
            beforeLabel = label.textContent;
            rows.forEach(function (candidate) { candidate.classList.remove('is-selected'); });
            if (nextValue !== null) row.classList.add('is-selected');
            label.textContent = nextValue === null ? button.dataset.default : nextValue;
            button.classList.toggle('has-value', label.textContent !== button.dataset.default);
            closeAll(); renderResults();
          },
          rollback: function () {
            rows.forEach(function (candidate, index) { candidate.classList.toggle('is-selected', snapshot[index]); });
            label.textContent = beforeLabel;
            button.classList.toggle('has-value', beforeLabel !== button.dataset.default);
            renderResults();
          }
        });
      });
    });
    var search = panel.querySelector('.dropdown-search input');
    if (search) search.addEventListener('input', function () { filterRows(panel, search.value); });
  });

  document.addEventListener('click', closeAll);
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    var anyOpen = items.some(function (item) { return !item.querySelector('.dropdown-panel').hidden; });
    if (anyOpen) { closeAll(); return; }
    if (input.value) {
      var before = input.value;
      project({
        domain: 'search', action: 'query.change', target: {}, payload: { query: '' }, key: 'search.query',
        apply: function () { input.value = ''; renderResults(); input.focus(); },
        rollback: function () { input.value = before; renderResults(); }
      });
      return;
    }
    window.location.href = 'slack.html';
  });

  input.addEventListener('input', function () {
    project({ domain: 'search', action: 'query.change', target: {}, payload: { query: input.value }, key: 'search.query', apply: renderResults, rollback: renderResults });
  });
  sortButton.addEventListener('click', function () {
    var before = false;
    var desired = !sortByTime;
    project({
      domain: 'search', action: 'sort.change', target: {}, payload: { sort: desired ? 'recent' : 'relevance' }, control: sortButton, key: 'search.configuration',
      apply: function () {
        before = sortByTime;
        sortByTime = desired;
        sortButton.querySelector('.f-label').textContent = sortByTime ? '最新优先' : '相关度';
        sortButton.classList.toggle('has-value', sortByTime); renderResults();
      },
      rollback: function () {
        sortByTime = before;
        sortButton.querySelector('.f-label').textContent = sortByTime ? '最新优先' : '相关度';
        sortButton.classList.toggle('has-value', sortByTime); renderResults();
      }
    });
  });

  clearFilters.addEventListener('click', function () {
    var snapshot = null;
    var beforeSort = false;
    project({
      domain: 'search', action: 'filters.clear', target: {}, payload: {}, control: clearFilters, key: 'search.configuration',
      apply: function () {
        snapshot = items.map(function (item) {
          var button = item.querySelector('.filter-btn');
          return { label: button.querySelector('.f-label').textContent, values: Array.prototype.map.call(item.querySelectorAll('.dropdown-row'), function (row) { return row.classList.contains('is-selected'); }) };
        });
        beforeSort = sortByTime;
        items.forEach(function (item) {
          var button = item.querySelector('.filter-btn');
          item.querySelectorAll('.dropdown-row').forEach(function (row) { row.classList.remove('is-selected'); });
          button.querySelector('.f-label').textContent = button.dataset.default;
          button.classList.remove('has-value', 'is-open');
          item.querySelector('.dropdown-panel').hidden = true;
        });
        sortByTime = false;
        sortButton.querySelector('.f-label').textContent = '相关度';
        sortButton.classList.remove('has-value');
        window.history.replaceState(null, '', 'search.html'); input.focus(); renderResults();
      },
      rollback: function () {
        items.forEach(function (item, itemIndex) {
          var button = item.querySelector('.filter-btn');
          item.querySelectorAll('.dropdown-row').forEach(function (row, rowIndex) { row.classList.toggle('is-selected', snapshot[itemIndex].values[rowIndex]); });
          button.querySelector('.f-label').textContent = snapshot[itemIndex].label;
          button.classList.toggle('has-value', snapshot[itemIndex].label !== button.dataset.default);
        });
        sortByTime = beforeSort; renderResults();
      }
    });
  });

  var channel = new URLSearchParams(window.location.search).get('channel');
  if (channel) {
    var channelButton = document.getElementById('btnChannel');
    var channelRow = document.querySelector('#panelChannel [data-value="#' + channel + '"]');
    if (channelButton && channelRow) {
      channelRow.classList.add('is-selected');
      channelButton.querySelector('.f-label').textContent = '#' + channel;
      channelButton.classList.add('has-value');
    }
  }
  renderResults(); input.focus();
})();
