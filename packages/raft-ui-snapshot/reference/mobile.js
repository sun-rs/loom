/* 移动端演示页交互：胶囊 tab 与分组列表行的选中态切换 */
(function () {
  'use strict';

  /* 胶囊底栏：单选 */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.m-tabbar .m-tab'));
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (t) { t.classList.toggle('is-active', t === tab); });
    });
  });

  /* 分组行：组内单选（频道 / 私信各自独立） */
  Array.prototype.forEach.call(document.querySelectorAll('.m-group-body'), function (group) {
    var rows = Array.prototype.slice.call(group.querySelectorAll('.m-row'));
    rows.forEach(function (row) {
      row.addEventListener('click', function () {
        rows.forEach(function (r) { r.classList.toggle('is-selected', r === row); });
      });
    });
  });
})();
