// Account-scoped snapshots. These never authenticate a server request.
(() => {
  const accountKey = 'checky.base.cachedAccount';
  const lockKey = 'checky.base.offlineLocked';
  const prefix = 'checky.base.offline:';
  function account() {
    try {
      if (localStorage.getItem(lockKey)) return '';
      return localStorage.getItem(accountKey) || JSON.parse(localStorage.getItem('checky.android.syncMeta') || '{}').userId || '';
    } catch (_) { return ''; }
  }
  window.checkyOfflineCache = {
    account,
    session(session) {
      if (session.authenticated && session.user?.id) {
        localStorage.setItem(accountKey, session.user.id);
        localStorage.removeItem(lockKey);
      } else localStorage.setItem(lockKey, '1');
    },
    read(userId, key) {
      if (!userId || account() !== userId) return null;
      try { return JSON.parse(localStorage.getItem(prefix + userId + ':' + key)); } catch (_) { return null; }
    },
    write(userId, key, value) {
      if (!userId || account() !== userId) throw Error('Sign in again before saving offline data.');
      localStorage.setItem(prefix + userId + ':' + key, JSON.stringify(value));
    },
    remove(userId, key) { localStorage.removeItem(prefix + userId + ':' + key); },
    unavailable(error) { return !error?.status || error.status >= 500 || error.status === 408 || error.status === 429; }
  };
})();
