(function (global) {
  'use strict';

  var PROTOCOL = 'raft-ui';
  var VERSION = 1;
  var INTENT_EVENT = 'raft:ui-intent';
  var STATE_EVENT = 'raft:ui-state';
  var ACTIONS = {
    activity: ['filter.change', 'item.open', 'item.complete'],
    admin: ['agreement.save', 'invite.create', 'member-permissions.save', 'onboarding.save', 'role.remove', 'role.update', 'system-channel.save', 'translation.save'],
    billing: ['checkout.configure', 'checkout.submit'],
    chat: ['agents.stop', 'bookmarks.open', 'channel.lifecycle', 'channel.pin', 'channel.update', 'composer.asset.request', 'file.download', 'file.menu.open', 'file.preview', 'file.reveal', 'member.add', 'message.action', 'message.expand.toggle', 'message.send', 'mobile.pane.change', 'mobile.route.change', 'pane.change', 'room.create', 'room.select', 'room.sort', 'sidebar.resize', 'task.column.toggle', 'task.create', 'task.filter.open', 'task.view.change', 'thread.close', 'thread.open', 'thread.resize'],
    computers: ['computer.action', 'computer.select', 'agent.open', 'runtime.open', 'command.copy', 'recovery.toggle', 'sidebar.resize'],
    members: ['tab.change', 'participant.select', 'relationship.open', 'profile.update', 'agent.action', 'member.create', 'member.invite', 'sidebar.resize'],
    search: ['filter.change', 'filters.clear', 'query.change', 'sort.change'],
    settings: ['account.connection.change', 'password.update', 'preferences.update', 'profile.update', 'section.open', 'sessions.revoke'],
    shell: ['navigation.open', 'notification.dismiss', 'notification.enable', 'notification.open', 'workspace.switcher.open'],
    tasks: ['filter.change', 'filters.clear', 'view.change']
  };
  var DOMAINS = Object.keys(ACTIONS).sort();
  var ACTION_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
  var transactions = new Map();
  var keyedTransactions = new Map();
  var adapter = null;
  var sequence = 0;

  function plainObject(value, label) {
    if (!value || Object.prototype.toString.call(value) !== '[object Object]') {
      throw new TypeError(label + ' must be a plain object');
    }
    return value;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
    return Object.freeze(value);
  }

  function exactKeys(value, keys, label) {
    var actual = Object.keys(value).sort().join(',');
    var expected = keys.slice().sort().join(',');
    if (actual !== expected) throw new TypeError(label + ' has unsupported or missing fields');
  }

  function makeId(prefix) {
    sequence += 1;
    return (prefix || 'rui') + '_' + Date.now().toString(36) + '_' + sequence.toString(36);
  }

  function sourceName() {
    return document.body.dataset.raftRoute || location.pathname.split('/').pop() || 'index';
  }

  function validateIntent(input) {
    plainObject(input, 'intent');
    exactKeys(input, ['protocol', 'version', 'id', 'kind', 'domain', 'action', 'target', 'payload', 'meta'], 'intent');
    if (input.protocol !== PROTOCOL || input.version !== VERSION || input.kind !== 'intent') throw new TypeError('Unsupported Raft UI protocol envelope');
    if (!/^rui_[a-z0-9_-]+$/.test(input.id)) throw new TypeError('Invalid intent id');
    if (DOMAINS.indexOf(input.domain) < 0) throw new TypeError('Invalid intent domain: ' + input.domain);
    if (!ACTION_PATTERN.test(input.action)) throw new TypeError('Invalid intent action: ' + input.action);
    if (ACTIONS[input.domain].indexOf(input.action) < 0) throw new TypeError('Unregistered intent action: ' + input.domain + '.' + input.action);
    plainObject(input.target, 'intent.target');
    plainObject(input.payload, 'intent.payload');
    plainObject(input.meta, 'intent.meta');
    exactKeys(input.meta, ['source', 'timestamp', 'optimistic'], 'intent.meta');
    if (typeof input.meta.source !== 'string' || !input.meta.source) throw new TypeError('Invalid intent source');
    if (typeof input.meta.timestamp !== 'string' || isNaN(Date.parse(input.meta.timestamp))) throw new TypeError('Invalid intent timestamp');
    if (typeof input.meta.optimistic !== 'boolean') throw new TypeError('Invalid intent optimistic flag');
    return true;
  }

  function normalizeError(error) {
    if (error && typeof error === 'object') {
      return {
        code: String(error.code || error.name || 'UNKNOWN'),
        message: String(error.message || 'The UI transaction failed')
      };
    }
    return { code: 'UNKNOWN', message: String(error || 'The UI transaction failed') };
  }

  function nativeDisableable(control) {
    return /^(BUTTON|FIELDSET|INPUT|OPTGROUP|OPTION|SELECT|TEXTAREA)$/.test(control.tagName || '');
  }

  function validControl(control) {
    return control && control.dataset && typeof control.setAttribute === 'function';
  }

  function setControlState(control, status, id, pendingLabel) {
    if (!control) return;
    if (status !== 'pending' && control.dataset.raftIntentId !== id) return;
    control.dataset.raftState = status;
    control.dataset.raftIntentId = id;
    if (status === 'pending') {
      control.dataset.raftWasDisabled = nativeDisableable(control) && control.disabled ? 'true' : 'false';
      control.dataset.raftWasAriaDisabled = control.hasAttribute('aria-disabled') ? control.getAttribute('aria-disabled') : '__missing__';
      control.dataset.raftWasInert = control.inert ? 'true' : 'false';
      control.setAttribute('aria-busy', 'true');
      control.setAttribute('aria-disabled', 'true');
      if (nativeDisableable(control)) control.disabled = true;
      else control.inert = true;
      if (pendingLabel && control.textContent) {
        control.dataset.raftOriginalLabel = control.innerHTML;
        control.textContent = pendingLabel;
      }
      return;
    }
    control.removeAttribute('aria-busy');
    if (nativeDisableable(control)) control.disabled = control.dataset.raftWasDisabled === 'true';
    else control.inert = control.dataset.raftWasInert === 'true';
    delete control.dataset.raftWasDisabled;
    delete control.dataset.raftWasInert;
    if (control.dataset.raftWasAriaDisabled === '__missing__') control.removeAttribute('aria-disabled');
    else control.setAttribute('aria-disabled', control.dataset.raftWasAriaDisabled);
    delete control.dataset.raftWasAriaDisabled;
    if (control.dataset.raftOriginalLabel !== undefined) {
      control.innerHTML = control.dataset.raftOriginalLabel;
      delete control.dataset.raftOriginalLabel;
    }
  }

  function announce(status, error) {
    var region = document.getElementById('raftUiStatus');
    if (!region) {
      region = document.createElement('div');
      region.id = 'raftUiStatus';
      region.className = 'raft-ui-sr-only';
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      region.setAttribute('aria-atomic', 'true');
      document.body.appendChild(region);
    }
    var copy = { pending: '正在处理', succeeded: '操作已完成', cancelled: '操作已取消' };
    region.textContent = status === 'failed' ? '操作失败：' + normalizeError(error).message : copy[status];
  }

  function dispatchState(record, status, options) {
    options = options || {};
    var state = {
      protocol: PROTOCOL,
      version: VERSION,
      id: makeId('rui'),
      kind: 'state',
      intentId: record.intent.id,
      domain: record.intent.domain,
      action: record.intent.action,
      status: status,
      result: options.result ? clone(plainObject(options.result, 'state.result')) : null,
      error: options.error ? normalizeError(options.error) : null,
      meta: {
        source: sourceName(),
        timestamp: new Date().toISOString(),
        optimistic: record.intent.meta.optimistic
      }
    };
    deepFreeze(state);
    document.dispatchEvent(new CustomEvent(STATE_EVENT, { bubbles: true, detail: state }));
    if (!options.silent) announce(status, options.error);
    return state;
  }

  function finish(record, status, options) {
    if (!record || record.terminal) return false;
    if (status !== 'succeeded' && status !== 'failed' && status !== 'cancelled') throw new TypeError('Invalid terminal state: ' + status);
    record.terminal = status;
    if (status === 'cancelled' && record.controller) record.controller.abort();
    if ((status === 'failed' || status === 'cancelled') && record.applied && record.rollback) {
      try {
        record.rollback(options && (options.error || options.reason));
      } catch (rollbackError) {
        options = { error: { code: 'ROLLBACK_FAILED', message: normalizeError(rollbackError).message } };
        status = 'failed';
        record.terminal = status;
      }
    }
    record.sensitive = null;
    record.controls.forEach(function (control) {
      setControlState(control, status, record.intent.id, control === record.control ? record.pendingLabel : null);
    });
    if (status === 'succeeded' && record.commit) {
      try {
        record.commit(options && options.result ? options.result : {});
      } catch (commitError) {
        status = 'failed';
        record.terminal = status;
        record.controls.forEach(function (control) { control.dataset.raftState = status; });
        options = { error: { code: 'COMMIT_FAILED', message: normalizeError(commitError).message } };
        if (record.applied && record.rollback) {
          try {
            record.rollback(options.error);
          } catch (rollbackError) {
            options = { error: { code: 'ROLLBACK_FAILED', message: normalizeError(rollbackError).message } };
          }
        }
      }
    }
    dispatchState(record, status, options);
    transactions.delete(record.intent.id);
    if (record.key && keyedTransactions.get(record.key) === record) keyedTransactions.delete(record.key);
    return true;
  }

  function makeHandle(record, accepted, managed) {
    return {
      id: record.intent.id,
      intent: record.intent,
      accepted: accepted,
      managed: managed,
      succeed: function (result) {
        if (record.terminal) return false;
        var safeResult;
        try {
          safeResult = clone(plainObject(result == null ? {} : result, 'adapter result'));
        } catch (error) {
          return finish(record, 'failed', { error: { code: 'INVALID_RESULT', message: normalizeError(error).message } });
        }
        if (!record.applied && record.apply) {
          try {
            record.applied = true;
            record.apply();
          } catch (error) {
            return finish(record, 'failed', { error: error });
          }
        }
        return finish(record, 'succeeded', { result: safeResult });
      },
      fail: function (error) { return finish(record, 'failed', { error: error }); },
      cancel: function (reason) { return finish(record, 'cancelled', { error: normalizeError(reason || { code: 'CANCELLED', message: 'Cancelled' }) }); }
    };
  }

  function transaction(options) {
    plainObject(options, 'transaction options');
    if (options.key != null && (typeof options.key !== 'string' || !options.key.trim())) throw new TypeError('transaction.key must be a non-empty string');
    var intent = {
      protocol: PROTOCOL,
      version: VERSION,
      id: makeId('rui'),
      kind: 'intent',
      domain: options.domain,
      action: options.action,
      target: clone(options.target || {}),
      payload: clone(options.payload || {}),
      meta: {
        source: sourceName(),
        timestamp: new Date().toISOString(),
        optimistic: options.optimistic !== false
      }
    };
    validateIntent(intent);
    deepFreeze(intent);

    var record = {
      intent: intent,
      control: options.control || null,
      controls: [],
      pendingLabel: options.pendingLabel || null,
      sensitive: options.sensitive ? clone(plainObject(options.sensitive, 'transaction.sensitive')) : null,
      controller: typeof AbortController === 'function' ? new AbortController() : null,
      apply: typeof options.apply === 'function' ? options.apply : null,
      rollback: typeof options.rollback === 'function' ? options.rollback : null,
      commit: typeof options.commit === 'function' ? options.commit : null,
      key: options.key || null,
      applied: false,
      terminal: null
    };
    if (options.controls != null && (typeof options.controls !== 'object' || typeof options.controls.length !== 'number')) {
      throw new TypeError('transaction.controls must be an array-like collection');
    }
    var extraControls = options.controls == null ? [] : Array.prototype.slice.call(options.controls);
    record.controls = extraControls.concat(record.control || []).filter(function (control, index, all) {
      return control && all.indexOf(control) === index;
    });
    record.controls.forEach(function (control) {
      if (!validControl(control)) throw new TypeError('transaction controls must be DOM controls');
    });
    var previousKeyed = record.key ? keyedTransactions.get(record.key) : null;
    var conflictingControl = record.controls.find(function (control) {
      return control.dataset.raftState === 'pending' && (!previousKeyed || control.dataset.raftIntentId !== previousKeyed.intent.id);
    });
    if (conflictingControl) throw new Error('A transaction control is already pending');
    var legacyEvent = null;
    if (options.legacy != null) {
      plainObject(options.legacy, 'transaction.legacy');
      if (typeof options.legacy.name !== 'string' || !options.legacy.name) throw new TypeError('transaction.legacy.name must be a non-empty string');
      legacyEvent = new CustomEvent(options.legacy.name, {
        bubbles: true,
        cancelable: true,
        detail: clone(options.legacy.detail || {})
      });
    }
    var canonicalAccepted = document.dispatchEvent(new CustomEvent(INTENT_EVENT, { bubbles: true, cancelable: true, detail: intent }));
    var legacyAccepted = true;
    if (canonicalAccepted && legacyEvent) legacyAccepted = document.dispatchEvent(legacyEvent);
    if (!canonicalAccepted || !legacyAccepted) {
      finish(record, 'cancelled', { error: { code: 'VETOED', message: 'The UI intent was cancelled by a listener' } });
      return makeHandle(record, false, false);
    }

    if (previousKeyed && keyedTransactions.get(record.key) === previousKeyed) {
      finish(previousKeyed, 'cancelled', {
        error: { code: 'SUPERSEDED', message: 'A newer UI intent replaced this transaction' },
        silent: true
      });
    }
    conflictingControl = record.controls.find(function (control) { return control.dataset.raftState === 'pending'; });
    if (conflictingControl) {
      finish(record, 'cancelled', { error: { code: 'CONTROL_BUSY', message: 'A transaction control became busy' } });
      return makeHandle(record, false, false);
    }
    transactions.set(intent.id, record);
    if (record.key) keyedTransactions.set(record.key, record);
    record.controls.forEach(function (control) { setControlState(control, 'pending', intent.id, control === record.control ? record.pendingLabel : null); });
    dispatchState(record, 'pending');
    var activeAdapter = adapter;
    var handle = makeHandle(record, true, Boolean(activeAdapter));

    if (typeof options.apply === 'function' && intent.meta.optimistic) {
      try {
        record.applied = true;
        options.apply();
      } catch (error) {
        handle.fail(error);
        return handle;
      }
    }

    if (activeAdapter) {
      try {
        var adapterContext = Object.freeze({
          sensitive: deepFreeze(clone(record.sensitive || {})),
          signal: record.controller ? record.controller.signal : null
        });
        Promise.resolve(activeAdapter.handler(clone(intent), adapterContext)).then(function (result) {
          handle.succeed(result == null ? {} : result);
        }, function (error) { handle.fail(error); });
      } catch (error) {
        handle.fail(error);
      }
    } else {
      handle.fail({ code: 'ADAPTER_REQUIRED', message: 'No Raft UI adapter is installed' });
    }
    return handle;
  }

  function adapterDescriptor(input) {
    if (input == null) return Object.freeze({ kind: 'test', name: 'anonymous-test-adapter' });
    plainObject(input, 'adapter descriptor');
    exactKeys(input, ['kind', 'name'], 'adapter descriptor');
    if (['reference', 'rah-client', 'test'].indexOf(input.kind) < 0) throw new TypeError('Invalid Raft UI adapter kind');
    if (typeof input.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(input.name)) throw new TypeError('Invalid Raft UI adapter name');
    return Object.freeze({ kind: input.kind, name: input.name });
  }

  function setAdapter(nextAdapter, descriptorInput) {
    if (typeof nextAdapter !== 'function') throw new TypeError('RaftUI adapter must be a function');
    var descriptor = adapterDescriptor(descriptorInput);
    if (descriptor.kind === 'rah-client' && document.body.dataset.raftSurface === 'reference') {
      throw new Error('A rah-client adapter cannot be installed on a Raft reference surface');
    }
    var previous = adapter;
    var installed = Object.freeze({ handler: nextAdapter, descriptor: descriptor });
    adapter = installed;
    return function () { if (adapter === installed) adapter = previous; };
  }

  function project(options) {
    return transaction(options);
  }

  global.RaftUI = Object.freeze({
    PROTOCOL: PROTOCOL,
    VERSION: VERSION,
    INTENT_EVENT: INTENT_EVENT,
    STATE_EVENT: STATE_EVENT,
    DOMAINS: Object.freeze(DOMAINS.slice()),
    ACTIONS: deepFreeze(clone(ACTIONS)),
    validateIntent: validateIntent,
    transaction: transaction,
    project: project,
    createId: function (prefix) {
      if (typeof prefix !== 'string' || !/^[a-z][a-z0-9-]*$/.test(prefix)) throw new TypeError('Invalid identity prefix');
      return makeId(prefix);
    },
    setAdapter: setAdapter,
    adapterInfo: function () { return adapter ? clone(adapter.descriptor) : null; },
    resolve: function (id, result) {
      var record = transactions.get(id);
      return record ? makeHandle(record, true, true).succeed(result == null ? {} : result) : false;
    },
    reject: function (id, error) { return finish(transactions.get(id), 'failed', { error: error }); },
    cancel: function (id, reason) { return finish(transactions.get(id), 'cancelled', { error: normalizeError(reason || { code: 'CANCELLED', message: 'Cancelled' }) }); },
    pendingCount: function () { return transactions.size; }
  });
})(window);
