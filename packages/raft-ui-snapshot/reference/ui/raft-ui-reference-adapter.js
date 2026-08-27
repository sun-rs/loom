(function (global) {
  'use strict';

  if (!global.RaftUI) throw new Error('raft-ui-runtime.js must load before the reference adapter');

  document.body.dataset.raftSurface = 'reference';

  function referenceProjection(intent) {
    var result = {
      projection: 'reference-fixture',
      source: intent.meta.source
    };

    /* Preserve the source-observed submitting state for destructive channel actions. */
    if (intent.domain === 'chat' && intent.action === 'channel.lifecycle') {
      return new Promise(function (resolve) {
        global.setTimeout(function () { resolve(result); }, 360);
      });
    }
    return result;
  }

  global.RaftUI.setAdapter(referenceProjection, {
    kind: 'reference',
    name: 'raft-reference-fixture'
  });
})(window);
