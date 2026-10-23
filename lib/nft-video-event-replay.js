/* AR.js 3.4.8 registers its NFT video listener only after the toolkit starts.
 * An already-authorized camera can fire arjs-video-loaded before that point. */
(function (root, factory) {
  const install = factory();
  if (typeof module === 'object' && module.exports) module.exports = install;
  if (root) root.installNFTVideoEventReplay = install;
})(typeof window !== 'undefined' ? window : null, function () {
  return function installNFTVideoEventReplay(win) {
    const nativeAdd = win.addEventListener;
    const nativeRemove = win.removeEventListener;
    let lastVideoEvent = null;
    let active = true;
    const remember = (event) => { lastVideoEvent = event; };
    nativeAdd.call(win, 'arjs-video-loaded', remember);

    win.addEventListener = function (type, listener, options) {
      nativeAdd.call(this, type, listener, options);
      if (type !== 'arjs-video-loaded' || !lastVideoEvent || !listener || !active) return;
      // Registration after dispatch misses the one-time event in AR.js. Replay
      // only to this new listener; listeners registered earlier see it normally.
      queueMicrotask(() => {
        if (!active || !lastVideoEvent) return;
        if (typeof listener === 'function') listener.call(win, lastVideoEvent);
        else listener.handleEvent?.(lastVideoEvent);
      });
    };

    return function restoreNFTVideoEventReplay() {
      active = false;
      win.addEventListener = nativeAdd;
      nativeRemove.call(win, 'arjs-video-loaded', remember);
      lastVideoEvent = null;
    };
  };
});

