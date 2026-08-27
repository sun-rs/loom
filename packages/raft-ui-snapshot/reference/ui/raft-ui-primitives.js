(function (global) {
  'use strict';

  function resizablePanel(options) {
    var handle = options.handle;
    var root = options.root;
    var minimum = options.min == null ? Number(handle.getAttribute('aria-valuemin')) : options.min;
    var maximum = options.max == null ? Number(handle.getAttribute('aria-valuemax')) : options.max;
    var step = options.step == null ? 8 : options.step;
    var largeStep = options.largeStep == null ? 32 : options.largeStep;
    var origin = options.origin == null ? 0 : options.origin;
    var variable = options.variable;
    var dragStart = null;

    function set(value) {
      var width = Math.max(minimum, Math.min(maximum, Math.round(value)));
      root.style.setProperty(variable, width + 'px');
      handle.setAttribute('aria-valuenow', String(width));
      if (options.onInput) options.onInput(width);
      return width;
    }
    function commit(previous) {
      var value = Number(handle.getAttribute('aria-valuenow'));
      if (options.requestCommit) {
        options.requestCommit(value, previous, function () { set(value); }, function () { set(previous); });
      } else if (options.onCommit) options.onCommit(value, previous);
    }

    handle.addEventListener('pointerdown', function (event) {
      if (handle.getAttribute('aria-disabled') === 'true') return;
      if (event.button !== 0 || event.isPrimary === false) return;
      event.preventDefault();
      dragStart = Number(handle.getAttribute('aria-valuenow'));
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('is-dragging');
    });
    handle.addEventListener('pointermove', function (event) {
      if (handle.hasPointerCapture(event.pointerId)) {
        set(options.measure ? options.measure(event) : event.clientX - origin);
      }
    });
    handle.addEventListener('pointerup', function (event) {
      if (!handle.hasPointerCapture(event.pointerId)) return;
      var previous = dragStart;
      dragStart = null;
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      handle.classList.remove('is-dragging');
      commit(previous);
    });
    handle.addEventListener('pointercancel', function (event) {
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      handle.classList.remove('is-dragging');
      if (dragStart !== null) set(dragStart);
      dragStart = null;
    });
    handle.addEventListener('lostpointercapture', function () {
      handle.classList.remove('is-dragging');
      if (dragStart !== null) set(dragStart);
      dragStart = null;
    });
    handle.addEventListener('keydown', function (event) {
      if (handle.getAttribute('aria-disabled') === 'true') return;
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(event.key) < 0) return;
      event.preventDefault();
      var width = Number(handle.getAttribute('aria-valuenow'));
      var previous = width;
      if (event.key === 'ArrowLeft') width -= event.shiftKey ? largeStep : step;
      if (event.key === 'ArrowRight') width += event.shiftKey ? largeStep : step;
      if (event.key === 'Home') width = minimum;
      if (event.key === 'End') width = maximum;
      set(width);
      commit(previous);
    });
    return { set: set, value: function () { return Number(handle.getAttribute('aria-valuenow')); } };
  }

  function disclosure(options) {
    var trigger = options.trigger;
    var panel = options.panel;
    function set(expanded, notify) {
      trigger.setAttribute('aria-expanded', String(expanded));
      panel.hidden = !expanded;
      if (notify && options.onChange) options.onChange(expanded);
    }
    trigger.addEventListener('click', function () {
      if (trigger.getAttribute('aria-disabled') === 'true') return;
      var expanded = trigger.getAttribute('aria-expanded') !== 'true';
      if (options.requestChange) {
        options.requestChange(expanded, function () { set(expanded, false); }, function () { set(!expanded, false); });
        return;
      }
      set(expanded, true);
    });
    return { set: function (expanded) { set(Boolean(expanded), false); } };
  }

  function segmentedControl(options) {
    var root = options.root;
    var selector = options.selector || '.seg-btn';
    var selectedClass = options.selectedClass || 'is-active';
    var buttons = Array.prototype.slice.call(root.querySelectorAll(selector));

    function selected() {
      return buttons.find(function (button) { return button.classList.contains(selectedClass); }) || null;
    }
    function set(button, notify) {
      if (!button || buttons.indexOf(button) < 0) return;
      buttons.forEach(function (candidate) {
        var active = candidate === button;
        candidate.classList.toggle(selectedClass, active);
        candidate.setAttribute('aria-pressed', String(active));
      });
      if (notify && options.onChange) options.onChange(button);
    }
    function request(button, focus) {
      if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
      var previous = null;
      var apply = function () { previous = selected(); set(button, false); };
      var rollback = function () { if (previous) set(previous, false); };
      if (options.requestChange) options.requestChange(button, apply, rollback);
      else { apply(); if (options.onChange) options.onChange(button); }
      if (focus) button.focus();
    }

    buttons.forEach(function (button) { button.setAttribute('aria-pressed', String(button.classList.contains(selectedClass))); });
    root.addEventListener('click', function (event) { request(event.target.closest(selector), false); });
    root.addEventListener('keydown', function (event) {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(event.key) < 0) return;
      var index = buttons.indexOf(document.activeElement);
      if (index < 0) return;
      event.preventDefault();
      var next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
        (index + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length;
      request(buttons[next], true);
    });
    return { set: function (button) { set(button, false); }, selected: selected };
  }

  function listboxSelect(options) {
    var root = options.root;
    var trigger = options.trigger || root.querySelector('[role="combobox"]');
    var panel = options.panel || root.querySelector('[data-listbox-panel]');
    var search = panel.querySelector('[data-listbox-search]');
    var listbox = panel.querySelector('[role="listbox"]') || panel;
    var valueNode = trigger.querySelector('[data-listbox-value]');
    var optionSelector = options.optionSelector || '[role="option"]';
    var openEvent = 'raftui:listbox-open';

    Array.prototype.forEach.call(listbox.querySelectorAll(optionSelector), function (option) {
      option.dataset.raftControlOwner = 'listboxSelect';
    });

    function optionsList(visibleOnly) {
      return Array.prototype.slice.call(listbox.querySelectorAll(optionSelector)).filter(function (option) {
        return !visibleOnly || !option.hidden;
      });
    }

    function selectedOption() {
      return optionsList(false).find(function (option) {
        return option.getAttribute('aria-selected') === 'true';
      }) || null;
    }

    function isDisabled() {
      return trigger.disabled || trigger.getAttribute('aria-disabled') === 'true';
    }

    function focusOption(position) {
      var available = optionsList(true);
      if (!available.length) return;
      var current = available.indexOf(document.activeElement);
      var index = position;
      if (position === 'selected') {
        index = available.indexOf(selectedOption());
        if (index < 0) index = 0;
      } else if (position === 'next') {
        index = current < 0 ? 0 : (current + 1) % available.length;
      } else if (position === 'previous') {
        index = current < 0 ? available.length - 1 : (current + available.length - 1) % available.length;
      }
      available[Math.max(0, Math.min(available.length - 1, Number(index)))].focus();
    }

    function setOpen(opened, focusTarget) {
      if (opened && isDisabled()) return;
      trigger.setAttribute('aria-expanded', String(opened));
      panel.hidden = !opened;
      root.classList.toggle('is-open', opened);
      if (!opened) {
        if (search) {
          search.value = '';
          optionsList(false).forEach(function (option) { option.hidden = false; });
        }
        return;
      }
      document.dispatchEvent(new CustomEvent(openEvent, { detail: { root: root } }));
      window.requestAnimationFrame(function () {
        if (focusTarget === 'search' && search) search.focus();
        else focusOption(focusTarget === 'last' ? optionsList(true).length - 1 : 'selected');
      });
    }

    function setValue(option, notify) {
      if (!option || option.hidden || option.getAttribute('aria-disabled') === 'true') return;
      optionsList(false).forEach(function (candidate) {
        candidate.setAttribute('aria-selected', String(candidate === option));
      });
      var value = option.dataset.value == null ? option.textContent.trim() : option.dataset.value;
      var label = option.dataset.label == null ? option.textContent.trim() : option.dataset.label;
      root.dataset.value = value;
      if (valueNode) valueNode.textContent = label;
      setOpen(false);
      trigger.focus();
      if (notify && options.onChange) options.onChange({ value: value, label: label, option: option });
    }

    trigger.addEventListener('click', function () {
      setOpen(trigger.getAttribute('aria-expanded') !== 'true', search ? 'search' : 'selected');
    });
    trigger.addEventListener('keydown', function (event) {
      if (isDisabled()) return;
      if (event.key === 'Escape' && trigger.getAttribute('aria-expanded') === 'true') {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp', 'Home', 'End'].indexOf(event.key) < 0) return;
      event.preventDefault();
      if (event.key === 'Enter' || event.key === ' ') {
        setOpen(trigger.getAttribute('aria-expanded') !== 'true', search ? 'search' : 'selected');
      } else {
        setOpen(true, search ? 'search' : event.key === 'ArrowUp' || event.key === 'End' ? 'last' : 'selected');
      }
    });
    listbox.addEventListener('click', function (event) {
      setValue(event.target.closest(optionSelector), true);
    });
    listbox.addEventListener('keydown', function (event) {
      var option = event.target.closest(optionSelector);
      if (!option) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        trigger.focus();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setValue(option, true);
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].indexOf(event.key) >= 0) {
        event.preventDefault();
        focusOption(event.key === 'ArrowDown' ? 'next' : event.key === 'ArrowUp' ? 'previous' : event.key === 'Home' ? 0 : optionsList(true).length - 1);
      }
    });
    if (search) {
      search.addEventListener('input', function () {
        var query = search.value.trim().toLocaleLowerCase();
        optionsList(false).forEach(function (option) {
          option.hidden = query !== '' && option.textContent.toLocaleLowerCase().indexOf(query) < 0;
        });
      });
      search.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setOpen(false);
          trigger.focus();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          focusOption(event.key === 'ArrowDown' ? 0 : optionsList(true).length - 1);
        }
      });
    }
    document.addEventListener(openEvent, function (event) {
      if (event.detail.root !== root) setOpen(false);
    });
    document.addEventListener('pointerdown', function (event) {
      if (!root.contains(event.target)) setOpen(false);
    });

    setOpen(false);
    return {
      open: function () { setOpen(true, search ? 'search' : 'selected'); },
      close: function () { setOpen(false); },
      value: function () { return root.dataset.value || ''; },
      select: function (value) {
        setValue(optionsList(false).find(function (option) { return option.dataset.value === value; }), false);
      },
      setDisabled: function (disabled) {
        trigger.disabled = Boolean(disabled);
        trigger.setAttribute('aria-disabled', String(Boolean(disabled)));
        if (disabled) setOpen(false);
      }
    };
  }

  /* Published Raft bundle viewport protocol (Eit): while an editable control has
     focus and the visual viewport shrinks by more than 100px, expose the visual
     viewport height/offset as CSS variables. The shell remains transport-free;
     this only projects browser geometry for Web/PWA keyboard accommodation. */
  function visualViewport(options) {
    options = options || {};
    var root = options.root || document.documentElement;
    var viewport = options.viewport === undefined ? window.visualViewport : options.viewport;
    var threshold = options.threshold == null ? 100 : options.threshold;

    function editable(element) {
      if (!element) return false;
      if (element instanceof HTMLTextAreaElement) return true;
      if (element instanceof HTMLInputElement) {
        return ['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']
          .indexOf(element.type.toLowerCase()) < 0;
      }
      return element instanceof HTMLElement && element.isContentEditable;
    }

    function sync() {
      if (!viewport) {
        root.style.removeProperty('--vv-height');
        root.style.removeProperty('--vv-offset-top');
        return;
      }
      if (editable(document.activeElement) && window.innerHeight - viewport.height > threshold) {
        root.style.setProperty('--vv-height', viewport.height + 'px');
        root.style.setProperty('--vv-offset-top', viewport.offsetTop + 'px');
      } else {
        root.style.removeProperty('--vv-height');
        root.style.removeProperty('--vv-offset-top');
      }
    }

    var windowEvents = ['resize', 'orientationchange', 'pageshow', 'focusin', 'focusout'];
    sync();
    if (viewport) {
      viewport.addEventListener('resize', sync);
      viewport.addEventListener('scroll', sync, { passive: true });
    }
    windowEvents.forEach(function (name) { window.addEventListener(name, sync); });
    document.addEventListener('visibilitychange', sync);

    return {
      sync: sync,
      destroy: function () {
        if (viewport) {
          viewport.removeEventListener('resize', sync);
          viewport.removeEventListener('scroll', sync);
        }
        windowEvents.forEach(function (name) { window.removeEventListener(name, sync); });
        document.removeEventListener('visibilitychange', sync);
        root.style.removeProperty('--vv-height');
        root.style.removeProperty('--vv-offset-top');
      }
    };
  }

  global.RaftUIPrimitives = Object.freeze({
    resizablePanel: resizablePanel,
    disclosure: disclosure,
    segmentedControl: segmentedControl,
    listboxSelect: listboxSelect,
    visualViewport: visualViewport
  });
})(window);
