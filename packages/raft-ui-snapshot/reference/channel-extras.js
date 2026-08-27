/* Channel panels and overlays. Product actions use Raft UI protocol v1. */
(() => {
  const channel = document.querySelector('.channel');
  if (!channel) return;
  const project = (options) => RaftUI.project(options);

  /* ---- 聊天 / 任务 / 文件 面板切换（含 aria-selected 与方向键导航） ---- */
  const tabBar = channel.querySelector('.tabs');
  const tabs = [...tabBar.querySelectorAll('.tab')];
  const panes = [...channel.querySelectorAll('.chan-pane')];

  function applyPane(name) {
    tabs.forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    panes.forEach((p) => { p.hidden = p.dataset.pane !== name; });
  }
  function activatePane(name) {
    let previous = 'chat';
    return project({
      domain: 'chat', action: 'pane.change', target: { room: 'onboarding-owner', pane: name }, payload: {}, key: 'chat.pane',
      apply: () => { previous = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true')?.dataset.tab || 'chat'; applyPane(name); },
      rollback: () => applyPane(previous),
    });
  }
  function syncHash() {
    if (location.hash === '#tasks') applyPane('tasks');
    else if (location.hash === '#files') applyPane('files');
  }
  tabBar.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab && tab.dataset.tab) activatePane(tab.dataset.tab);
  });
  /* 方向键在 tab 间移动（ARIA tabs 模式：移动焦点并跟随激活） */
  tabBar.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.focus();
    next.click();
  });
  window.addEventListener('hashchange', syncHash);
  syncHash();

  /* ---- 看板：列折叠 ---- */
  document.querySelectorAll('.kcol .fold').forEach((btn) => {
    btn.addEventListener('click', () => {
      const column = btn.closest('.kcol');
      let before = false;
      const index = [...document.querySelectorAll('.kcol')].indexOf(column);
      const next = !column.classList.contains('is-collapsed');
      project({
        domain: 'chat', action: 'task.column.toggle', target: { room: 'onboarding-owner', column: String(index) }, payload: { collapsed: next }, key: `chat.task.column.${index}`,
        apply: () => { before = column.classList.contains('is-collapsed'); column.classList.toggle('is-collapsed', next); },
        rollback: () => column.classList.toggle('is-collapsed', before),
      });
    });
  });

  /* ---- 看板 / 列表 视图切换 ---- */
  const kanban = document.getElementById('kanban');
  document.querySelectorAll('.view-toggle .sq-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      let previous = null;
      const applyView = (selected) => {
        document.querySelectorAll('.view-toggle .sq-btn').forEach((b) => b.classList.toggle('is-active', b === selected));
        if (kanban) kanban.classList.toggle('list-mode', selected.dataset.view === 'list');
      };
      project({
        domain: 'chat', action: 'task.view.change', target: { room: 'onboarding-owner', view: btn.dataset.view }, payload: {}, key: 'chat.task.view',
        apply: () => { previous = document.querySelector('.view-toggle .sq-btn.is-active'); applyView(btn); },
        rollback: () => { if (previous) applyView(previous); },
      });
    });
  });

  const visibleFocusables = (root) =>
    [...root.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')]
      .filter((el) => !el.disabled && el.tabIndex >= 0 && el.getBoundingClientRect().width > 0);
  const syncOverlayLock = () => {
    const membersOpen = document.getElementById('membersModal')?.hidden === false;
    const addMembersOpen = document.getElementById('addMembersModal')?.hidden === false;
    const settingsOpen = document.getElementById('settingsLayer')?.hidden === false;
    const confirmOpen = document.getElementById('actionConfirm')?.hidden === false;
    document.body.classList.toggle('overlay-open', membersOpen || addMembersOpen || settingsOpen || confirmOpen);
  };

  /* ---- 成员模态：官方协议为遮罩 / X / Esc 关闭，打开先聚焦遮罩根，
     Tab 键随后进入弹窗；关闭后把焦点归还参与者按钮。 ---- */
  const membersModal = document.getElementById('membersModal');
  const openMembers = document.getElementById('openMembers');
  if (openMembers && membersModal) {
    const closeMembers = () => {
      if (membersModal.hidden) return;
      membersModal.hidden = true;
      syncOverlayLock();
      openMembers.focus();
    };
    openMembers.addEventListener('click', () => {
      membersModal.hidden = false;
      syncOverlayLock();
      membersModal.focus();
    });
    membersModal.addEventListener('click', (e) => {
      if (e.target.closest('.modal-close') || !e.target.closest('.modal')) closeMembers();
    });
    membersModal.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const els = visibleFocusables(membersModal.querySelector('.modal'));
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (document.activeElement === membersModal) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    membersModal._close = closeMembers;
  }

  /* ---- 添加成员：官方在成员弹窗上再叠一层 z-60 模态，搜索框自动聚焦。
     本地模板选择候选人后同步更新成员数量与列表，模拟真实添加结果。 ---- */
  const addMembersModal = document.getElementById('addMembersModal');
  if (membersModal && addMembersModal) {
    const openAddMembers = membersModal.querySelector('.modal-add');
    const memberSearch = addMembersModal.querySelector('#memberSearch');
    const candidateRows = [...addMembersModal.querySelectorAll('.add-member-row')];
    const addEmpty = addMembersModal.querySelector('.add-members-empty');
    const closeAddMembers = () => {
      if (addMembersModal.hidden) return;
      addMembersModal.hidden = true;
      memberSearch.value = '';
      candidateRows.forEach((row) => { row.hidden = false; });
      addEmpty.hidden = true;
      syncOverlayLock();
      openAddMembers.focus();
    };
    const openAddMembersModal = () => {
      addMembersModal.hidden = false;
      syncOverlayLock();
      memberSearch.focus();
    };
    openAddMembers.addEventListener('click', openAddMembersModal);
    addMembersModal.addEventListener('click', (e) => {
      if (e.target.closest('.add-members-close') || !e.target.closest('.add-members-card')) closeAddMembers();
    });
    addMembersModal.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const els = visibleFocusables(addMembersModal.querySelector('.add-members-card'));
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    memberSearch.addEventListener('input', () => {
      const query = memberSearch.value.trim().toLocaleLowerCase();
      let shown = 0;
      candidateRows.forEach((row) => {
        const matches = !query || row.innerText.toLocaleLowerCase().includes(query);
        row.hidden = !matches;
        if (matches) shown += 1;
      });
      addEmpty.hidden = shown !== 0;
    });
    candidateRows.forEach((row) => {
      row.addEventListener('click', () => {
        const key = row.dataset.addMember;
        const name = row.querySelector('.add-member-name').textContent.trim();
        const humanLabel = [...membersModal.querySelectorAll('.modal-group-label')]
          .find((label) => label.textContent.trim() === '人类');
        project({
          domain: 'chat', action: 'member.add', target: { room: 'onboarding-owner', member: key }, payload: { name }, control: row, optimistic: false,
          apply: () => {
            if (!membersModal.querySelector(`[data-member="${key}"]`)) {
              const member = document.createElement('div');
              member.className = 'member-row';
              member.innerHTML = `<button class="member-avatar" type="button" aria-label="在线" data-member="${key}"><span class="avatar sm"><svg><use href="#av-${key}"/></svg><i class="presence"></i></span></button><div class="member-copy"><div class="member-name"></div><div class="member-status">在线</div></div>`;
              member.querySelector('.member-name').textContent = name;
              humanLabel.before(member);
              const count = membersModal.querySelectorAll('.member-row').length;
              membersModal.querySelector('#membersTitle').textContent = `成员（${count}）`;
              openMembers.querySelector('b').textContent = String(count);
            }
            row.remove();
            closeAddMembers();
          },
        });
      });
    });
    addMembersModal._close = closeAddMembers;
  }

  /* ---- 频道设置抽屉：官方协议为 240ms 右侧滑入、页面遮罩、名称输入框
     自动聚焦、完整焦点圈、取消还原、保存/关闭/Esc 回焦齿轮。 ---- */
  const settingsLayer = document.getElementById('settingsLayer');
  const settingsDrawer = document.getElementById('settingsDrawer');
  const openSettings = document.getElementById('openSettings');
  if (openSettings && settingsLayer && settingsDrawer) {
    const settingsForm = document.getElementById('channelSettingsForm');
    const nameInput = document.getElementById('chName');
    const descInput = document.getElementById('chDesc');
    const actionConfirm = document.getElementById('actionConfirm');
    const confirmTitle = document.getElementById('actionConfirmTitle');
    const confirmMessage = document.getElementById('actionConfirmMessage');
    const confirmAlert = document.getElementById('actionConfirmAlert');
    const confirmSubmit = actionConfirm.querySelector('.action-confirm-submit');
    const confirmCancel = actionConfirm.querySelector('.action-confirm-cancel');
    const confirmClose = actionConfirm.querySelector('.action-confirm-close');
    let closeTimer = 0;
    let initialValues = null;
    let activeAction = null;
    let actionTrigger = null;
    let isPublic = false;

    /* 这些标题、正文、按钮颜色与 loading label 直接来自官方 bundle 中的
       ChannelSettings + ConfirmDialog（Fl/Gi/Ln），不是截图推断。 */
    const actionCopy = {
      leave: {
        title: '退出频道',
        message: '确定退出 #onboarding-owner 吗？常规频道消息将停止推送，且在重新加入前你无法发送消息。已关注的消息列不会自动取消关注；在你取消关注或另行处理这些消息列之前，已关注的公开消息列仍可能通知你。私密内容仍受当前访问权限限制。',
        confirm: '退出频道', loading: '正在退出…', destructive: false,
      },
      archive: {
        title: '归档频道',
        message: '确定归档「onboarding-owner」吗？成员仍可阅读消息和历史记录，但将无法发送新消息，且该频道会从侧栏中隐藏。你之后可以取消归档。',
        confirm: '归档频道', loading: '归档中…', destructive: false,
      },
      delete: {
        title: '删除频道',
        message: '确定删除「onboarding-owner」吗？所有消息都将丢失。',
        confirm: '删除频道', loading: '删除中…', destructive: true,
      },
    };
    const visibilityCopy = () => isPublic ? {
      title: '将频道设为私密',
      message: '确定将「onboarding-owner」设为私密吗？已加入的人类和 Agent 仍保留访问权限。未加入的服务器成员以及历史消息列关注者，将失去对该频道及其消息列的访问权限。',
      confirm: '设为私密', loading: '更新中…', destructive: false,
    } : {
      title: '将频道设为公开',
      message: '确定将「onboarding-owner」设为公开吗？所有服务器成员将恢复读取权限。已加入的人类和 Agent 会保持加入状态。',
      confirm: '设为公开', loading: '更新中…', destructive: false,
    };

    const closeActionConfirm = ({ returnFocus = true } = {}) => {
      if (actionConfirm.hidden || confirmSubmit.disabled) return;
      actionConfirm.hidden = true;
      activeAction = null;
      syncOverlayLock();
      if (returnFocus) actionTrigger?.focus();
    };
    const openActionConfirm = (action, trigger) => {
      const copy = action === 'visibility' ? visibilityCopy() : actionCopy[action];
      activeAction = action;
      actionTrigger = trigger;
      confirmTitle.textContent = copy.title;
      confirmMessage.textContent = copy.message;
      confirmSubmit.textContent = copy.confirm;
      confirmSubmit.dataset.loadingLabel = copy.loading;
      confirmAlert.classList.toggle('is-destructive', copy.destructive);
      confirmSubmit.classList.toggle('is-destructive', copy.destructive);
      actionConfirm.hidden = false;
      syncOverlayLock();
      actionConfirm.focus();
    };

    const finishCloseSettings = () => {
      settingsLayer.hidden = true;
      settingsLayer.removeAttribute('aria-hidden');
      syncOverlayLock();
      openSettings.focus();
    };
    const closeSettings = ({ restore = false, immediate = false } = {}) => {
      if (settingsLayer.hidden) return;
      if (restore && initialValues) {
        nameInput.value = initialValues.name;
        descInput.value = initialValues.description;
      }
      window.clearTimeout(closeTimer);
      settingsLayer.classList.remove('is-open');
      settingsLayer.setAttribute('aria-hidden', 'true');
      if (immediate) finishCloseSettings();
      else closeTimer = window.setTimeout(finishCloseSettings, 240);
    };
    const openSettingsDrawer = () => {
      if (membersModal && !membersModal.hidden) membersModal._close();
      window.clearTimeout(closeTimer);
      initialValues = { name: nameInput.value, description: descInput.value };
      settingsLayer.hidden = false;
      settingsLayer.removeAttribute('aria-hidden');
      syncOverlayLock();
      requestAnimationFrame(() => {
        settingsLayer.classList.add('is-open');
        nameInput.focus();
        nameInput.select();
      });
    };

    openSettings.addEventListener('click', openSettingsDrawer);
    settingsLayer.querySelector('.drawer-close').addEventListener('click', () => closeSettings());
    settingsLayer.querySelector('.drawer-scrim').addEventListener('click', () => closeSettings({ restore: true }));
    settingsLayer.querySelector('.drawer-cancel').addEventListener('click', () => closeSettings({ restore: true }));
    settingsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const next = { name: nameInput.value.trim(), description: descInput.value.trim() };
      if (!next.name) { nameInput.focus(); return; }
      project({
        domain: 'chat', action: 'channel.update', target: { room: 'onboarding-owner' }, payload: next,
        control: settingsLayer.querySelector('.drawer-save'),
        controls: [nameInput, descInput, settingsLayer.querySelector('.drawer-cancel'), settingsLayer.querySelector('.drawer-close')],
        optimistic: false,
        apply: () => { initialValues = next; closeSettings(); },
      });
    });
    settingsDrawer.querySelectorAll('[data-channel-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.channelAction;
        if (action === 'pin') {
          const pinned = button.getAttribute('aria-pressed') !== 'true';
          project({
            domain: 'chat', action: 'channel.pin', target: { room: 'onboarding-owner' }, payload: { pinned }, control: button,
            apply: () => { button.setAttribute('aria-pressed', String(pinned)); button.querySelector('span').textContent = pinned ? '取消置顶' : '置顶'; },
            rollback: () => { button.setAttribute('aria-pressed', String(!pinned)); button.querySelector('span').textContent = pinned ? '置顶' : '取消置顶'; },
          });
          return;
        }
        openActionConfirm(action, button);
      });
    });
    confirmClose.addEventListener('click', closeActionConfirm);
    confirmCancel.addEventListener('click', closeActionConfirm);
    actionConfirm.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const els = visibleFocusables(actionConfirm.querySelector('.action-confirm-card'));
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (document.activeElement === actionConfirm) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    confirmSubmit.addEventListener('click', () => {
      if (!activeAction || confirmSubmit.disabled) return;
      const action = activeAction;
      const loadingLabel = confirmSubmit.dataset.loadingLabel;
      RaftUI.transaction({
        domain: 'chat', action: 'channel.lifecycle', target: { room: 'onboarding-owner', operation: action }, payload: {},
        control: confirmSubmit, controls: [confirmCancel, confirmClose], pendingLabel: loadingLabel, optimistic: false,
        apply: () => {
          actionConfirm.hidden = true;
          if (action === 'visibility') {
            isPublic = !isPublic;
            const visibilityButton = settingsDrawer.querySelector('[data-channel-action="visibility"]');
            visibilityButton.querySelector('span').textContent = isPublic ? '设为私密' : '设为公开';
            visibilityButton.querySelector('use').setAttribute('href', isPublic ? '#i-lock' : '#i-hash');
            activeAction = null;
            syncOverlayLock();
            visibilityButton.focus();
            return;
          }
          activeAction = null;
          syncOverlayLock();
          closeSettings();
        },
      });
    });
    actionConfirm._close = closeActionConfirm;
    settingsDrawer.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const els = visibleFocusables(settingsDrawer);
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    settingsLayer._close = closeSettings;
  }

  /* ---- 通知提示条：X 关闭（仅 index.html 有此元素，其他页不加载本文件也要兜住） ---- */
  const noticeBanner = document.querySelector('.notice-banner');
  if (noticeBanner) {
    const dismiss = noticeBanner.querySelector('.notice-close');
    const enable = noticeBanner.querySelector('.btn-pink');
    dismiss.addEventListener('click', () => {
      project({
        domain: 'shell', action: 'notification.dismiss', target: { notice: 'agent-background-work' }, payload: {}, control: dismiss,
        apply: () => { noticeBanner.style.display = 'none'; }, rollback: () => { noticeBanner.style.display = ''; },
      });
    });
    enable?.addEventListener('click', () => {
      project({
        domain: 'shell', action: 'notification.enable', target: { notice: 'agent-background-work' }, payload: {}, control: enable, optimistic: false,
        apply: () => { noticeBanner.style.display = 'none'; },
      });
    });
  }

  /* ---- 官方 NotificationCenter：由 rail/header 铃铛共享同一个 popup ---- */
  const notificationCenter = document.getElementById('notificationCenter');
  const notificationTriggers = [...document.querySelectorAll('[data-notification-trigger]')];
  let notificationTrigger = null;
  const closeNotificationCenter = ({ restore = true } = {}) => {
    if (!notificationCenter || notificationCenter.hidden) return;
    notificationCenter.hidden = true;
    notificationTriggers.forEach((trigger) => trigger.setAttribute('aria-expanded', 'false'));
    const restoreTarget = notificationTrigger;
    notificationTrigger = null;
    if (restore && restoreTarget) restoreTarget.focus();
  };
  const placeNotificationCenter = (trigger) => {
    const triggerRect = trigger.getBoundingClientRect();
    const width = 320;
    const height = 288;
    const offset = 8;
    const isRailTrigger = trigger.closest('.rail') !== null;
    let left = isRailTrigger ? triggerRect.right + offset : triggerRect.right - width;
    let top = isRailTrigger ? triggerRect.bottom - height : triggerRect.bottom + offset;
    left = Math.max(offset, Math.min(left, window.innerWidth - width - offset));
    top = Math.max(offset, Math.min(top, window.innerHeight - height - offset));
    notificationCenter.style.left = `${Math.round(left)}px`;
    notificationCenter.style.top = `${Math.round(top)}px`;
  };
  notificationTriggers.forEach((trigger) => {
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!notificationCenter) return;
      if (!notificationCenter.hidden && notificationTrigger === trigger) {
        closeNotificationCenter();
        return;
      }
      notificationTrigger = trigger;
      placeNotificationCenter(trigger);
      notificationCenter.hidden = false;
      notificationTriggers.forEach((item) => item.setAttribute('aria-expanded', String(item === trigger)));
      notificationCenter.focus({ preventScroll: true });
    });
  });
  notificationCenter?.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', () => closeNotificationCenter({ restore: false }));
  window.addEventListener('resize', () => {
    if (notificationCenter && !notificationCenter.hidden && notificationTrigger) placeNotificationCenter(notificationTrigger);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const actionConfirm = document.getElementById('actionConfirm');
    if (notificationCenter && !notificationCenter.hidden) closeNotificationCenter();
    else if (actionConfirm && !actionConfirm.hidden) actionConfirm._close();
    else if (addMembersModal && !addMembersModal.hidden) addMembersModal._close();
    else if (membersModal && !membersModal.hidden) membersModal._close();
    else if (settingsLayer && !settingsLayer.hidden) settingsLayer._close({ restore: true });
  });
})();
