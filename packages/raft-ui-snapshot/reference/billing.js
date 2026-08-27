(function () {
  'use strict';
  var PRICE_SEAT_MONTH = 10;
  var YEAR_DISCOUNT = 0.88;
  var seats = 2;
  var cycle = 'year';
  var seatNum = document.getElementById('seatNum');
  var sumSeats = document.getElementById('sumSeats');
  var sumCapacity = document.getElementById('sumCapacity');
  var sumStrike = document.getElementById('sumStrike');
  var sumTotal = document.getElementById('sumTotal');
  var cycleSegment = document.getElementById('cycleSeg');

  function money(value) { return '$' + (Number.isInteger(value) ? String(value) : value.toFixed(2)); }
  function render() {
    seatNum.textContent = seats;
    sumSeats.textContent = seats;
    sumCapacity.textContent = '最多 ' + seats + ' 人类或 ' + seats * 10 + ' Agent';
    var listYear = PRICE_SEAT_MONTH * 12 * seats;
    sumStrike.textContent = money(listYear) + ' / 年';
    sumTotal.textContent = cycle === 'year' ? money(listYear * YEAR_DISCOUNT) + ' / 年' : money(PRICE_SEAT_MONTH * seats) + ' / 月';
  }
  function configure(nextSeats, nextCycle, control, applySelection, rollbackSelection) {
    var before = null;
    RaftUI.project({
      domain: 'billing', action: 'checkout.configure', target: { plan: 'pro' }, payload: { seats: nextSeats, cycle: nextCycle }, control: control, key: 'billing.checkout.configure',
      apply: function () {
        before = { seats: seats, cycle: cycle };
        seats = nextSeats; cycle = nextCycle;
        if (applySelection) applySelection();
        render();
      },
      rollback: function () {
        seats = before.seats; cycle = before.cycle;
        if (rollbackSelection) rollbackSelection();
        render();
      }
    });
  }
  document.querySelectorAll('[data-seat-step]').forEach(function (button) {
    button.addEventListener('click', function () { configure(Math.max(1, seats + parseInt(button.dataset.seatStep, 10)), cycle, button); });
  });
  RaftUIPrimitives.segmentedControl({
    root: cycleSegment,
    requestChange: function (button, apply, rollback) {
      configure(seats, button.dataset.cycle, button, apply, rollback);
    }
  });
  var upgrade = document.querySelector('[data-billing-action="upgrade"]');
  upgrade.addEventListener('click', function () {
    RaftUI.project({
      domain: 'billing', action: 'checkout.submit', target: { plan: 'pro' }, payload: { seats: seats, cycle: cycle }, control: upgrade,
      controls: Array.prototype.slice.call(document.querySelectorAll('[data-seat-step], [data-cycle]')), optimistic: false
    });
  });
  render();
})();
