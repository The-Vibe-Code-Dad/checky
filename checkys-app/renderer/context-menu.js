(function () {
  let heldPointer = null;
  let ignoreReleaseClickUntil = 0;

  function hold(event) {
    heldPointer = event.pointerId;
    ignoreReleaseClickUntil = Infinity;
    const target = event.target;
    // Keep the release on the original control, not a menu button under the finger.
    try { target.setPointerCapture(event.pointerId); } catch (_) {}
    if (target.matches('textarea, input') && document.activeElement === target) target.blur();
  }

  document.addEventListener('pointerdown', () => {
    if (heldPointer === null) ignoreReleaseClickUntil = 0;
  }, true);
  document.addEventListener('pointerup', event => {
    if (event.pointerId !== heldPointer) return;
    heldPointer = null;
    ignoreReleaseClickUntil = performance.now() + 700;
  }, true);
  document.addEventListener('pointercancel', event => {
    if (event.pointerId !== heldPointer) return;
    heldPointer = null;
    ignoreReleaseClickUntil = performance.now() + 700;
  }, true);
  document.addEventListener('click', event => {
    if (performance.now() >= ignoreReleaseClickUntil) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    ignoreReleaseClickUntil = 0;
  }, true);

  function bindHold(element, open) {
    let timer, pointer;
    const cancel = () => { clearTimeout(timer); timer = null; };
    element.addEventListener('pointerdown', event => {
      cancel();
      if (event.button !== 0 || event.target.closest('button, input, textarea, select, .drag-handle')) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      timer = setTimeout(() => { timer = null; hold(event); open(pointer.x, pointer.y); }, 350);
    });
    element.addEventListener('pointermove', event => {
      if (pointer?.id === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 12) cancel();
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) element.addEventListener(type, cancel);
  }

  function position(menu, point) {
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
    const padding = 8;
    menu.style.maxHeight = Math.max(0, height - padding * 2) + 'px';
    menu.style.maxWidth = Math.max(0, width - padding * 2) + 'px';
    const bounds = menu.getBoundingClientRect();
    const x = Math.max(left + padding, Math.min(point.x, left + width - bounds.width - padding));
    // Flip above the press near the bottom, keeping the menu away from the release.
    const y = point.y + bounds.height + padding <= top + height ? point.y : point.y - bounds.height - padding;
    menu.style.left = x + 'px';
    menu.style.top = Math.max(top + padding, Math.min(y, top + height - bounds.height - padding)) + 'px';
  }

  window.checkyContextMenu = { hold, bindHold, position };
})();
