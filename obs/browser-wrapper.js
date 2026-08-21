(() => {
  'use strict';

  const DEFAULT_ORIGIN = 'http://localhost:3399';
  const DEFAULT_ROUTE = '/overlay';
  const INITIAL_RETRY_MS = 500;
  const MAX_RETRY_MS = 5000;
  const HEALTH_POLL_MS = 5000;
  const HEALTH_TIMEOUT_MS = 1500;
  const root = document.documentElement;
  const frame = document.getElementById('stream-sync-frame');
  const status = document.getElementById('status');

  function parseHashConfig() {
    let hash = window.location.hash.slice(1);
    try {
      hash = decodeURIComponent(hash);
    } catch {
      hash = '';
    }

    if (!hash || hash.startsWith('/')) {
      return { route: hash || DEFAULT_ROUTE, origin: DEFAULT_ORIGIN };
    }

    const params = new URLSearchParams(hash);
    return {
      route: params.get('route') || DEFAULT_ROUTE,
      origin: params.get('origin') || `${params.get('protocol') || 'http'}://${params.get('host') || 'localhost'}:${params.get('port') || '3399'}`
    };
  }

  function normalizeRoute(value) {
    try {
      const url = new URL(value.startsWith('/') ? value : `/${value}`, DEFAULT_ORIGIN);
      return url.origin === DEFAULT_ORIGIN && !url.pathname.includes('..')
        ? `${url.pathname}${url.search}`
        : DEFAULT_ROUTE;
    } catch {
      return DEFAULT_ROUTE;
    }
  }

  function normalizeOrigin(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:'
        ? url.origin
        : DEFAULT_ORIGIN;
    } catch {
      return DEFAULT_ORIGIN;
    }
  }

  async function getHealthState(healthUrl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const response = await fetch(healthUrl, {
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal
      });
      if (!response.ok) return 'indeterminate';
      const payload = await response.json();
      if (payload?.ok === true) return 'healthy';
      return payload?.ok === false ? 'unavailable' : 'indeterminate';
    } catch {
      return 'indeterminate';
    } finally {
      clearTimeout(timeout);
    }
  }

  function setWaiting(healthUrl) {
    status.textContent = `Waiting for Stream Sync at ${healthUrl}...`;
    status.style.display = root.dataset.statusVisible === 'true' ? 'block' : 'none';
  }

  function setConnecting() {
    status.textContent = 'Connecting to Stream Sync...';
    status.style.display = root.dataset.statusVisible === 'true' ? 'block' : 'none';
  }

  function setHealthMonitoring(healthUrl, loadFrame) {
    let frameAttached = true;

    const monitor = async () => {
      const healthState = await getHealthState(healthUrl);
      if (healthState === 'unavailable' && frameAttached) {
        frame.removeAttribute('src');
        frame.style.display = 'none';
        frameAttached = false;
        setWaiting(healthUrl);
      } else if (healthState === 'healthy' && !frameAttached) {
        loadFrame();
        frameAttached = true;
      }
      setTimeout(() => void monitor(), HEALTH_POLL_MS);
    };

    setTimeout(() => void monitor(), HEALTH_POLL_MS);
  }

  async function start() {
    if (!frame || !status) return;

    const hashConfig = parseHashConfig();
    const origin = normalizeOrigin(hashConfig.origin);
    const baseRoute = normalizeRoute(root.dataset.route || hashConfig.route);
    const targetRoute = root.dataset.route ? `${baseRoute}${window.location.search}` : baseRoute;
    const routePath = new URL(targetRoute, DEFAULT_ORIGIN).pathname;
    const healthUrl = `${origin}/health?route=${encodeURIComponent(routePath)}`;
    const targetUrl = new URL(targetRoute, origin).toString();
    let retryMs = INITIAL_RETRY_MS;

    frame.addEventListener('load', () => {
      if (frame.getAttribute('src') === targetUrl) {
        status.style.display = 'none';
      }
    });

    const loadFrame = () => {
      frame.src = targetUrl;
      frame.style.display = 'block';
      setConnecting();
    };

    while (true) {
      setWaiting(healthUrl);
      if (await getHealthState(healthUrl) === 'healthy') {
        loadFrame();
        setHealthMonitoring(healthUrl, loadFrame);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, retryMs));
      retryMs = Math.min(Math.round(retryMs * 1.5), MAX_RETRY_MS);
    }
  }

  start();
})();
