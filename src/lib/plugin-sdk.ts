/**
 * Plugin SDK source code — injected into plugin iframe srcdoc.
 * Provides a postMessage-based RPC interface for plugins to communicate with the host.
 *
 * API surface (inside plugin):
 *   const plugin = eduskript.init()
 *   plugin.onReady(({ config, data, theme }) => { ... })
 *   plugin.onThemeChange((theme) => { ... })
 *   plugin.onDataChanged((data) => { ... })
 *   await plugin.getData()
 *   await plugin.setData(data)
 */
export const PLUGIN_SDK_SOURCE = `
(function() {
  'use strict';

  var _readyCallback = null;
  var _themeCallback = null;
  var _dataChangedCallback = null;
  var _fullscreenCallback = null;
  var _pendingRequests = {};
  var _requestId = 0;

  function sendMessage(msg) {
    window.parent.postMessage(msg, '*');
  }

  function request(type, payload) {
    return new Promise(function(resolve) {
      var id = ++_requestId;
      _pendingRequests[id] = resolve;
      sendMessage(Object.assign({ type: type, requestId: id }, payload || {}));
    });
  }

  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'host:init':
        if (_readyCallback) {
          _readyCallback({ config: msg.config, data: msg.data, theme: msg.theme });
        }
        break;

      case 'host:data':
        if (msg.requestId && _pendingRequests[msg.requestId]) {
          _pendingRequests[msg.requestId](msg.data);
          delete _pendingRequests[msg.requestId];
        }
        break;

      case 'host:dataChanged':
        if (_dataChangedCallback) {
          _dataChangedCallback(msg.data);
        }
        break;

      case 'host:themeChange':
        if (_themeCallback) {
          _themeCallback(msg.theme);
        }
        break;

      case 'host:fullscreenChange':
        if (_fullscreenCallback) {
          _fullscreenCallback(!!msg.isFullscreen);
        }
        break;
    }
  });

  window.eduskript = {
    init: function() {
      return {
        onReady: function(cb) {
          _readyCallback = cb;
          // Tell host we're ready — it will respond with host:init
          sendMessage({ type: 'plugin:ready' });
        },

        onThemeChange: function(cb) {
          _themeCallback = cb;
        },

        onDataChanged: function(cb) {
          _dataChangedCallback = cb;
        },

        getData: function() {
          return request('plugin:getData');
        },

        setData: function(data) {
          sendMessage({ type: 'plugin:setData', data: data });
        },

        resize: function(height) {
          sendMessage({ type: 'plugin:resize', height: height });
        },

        requestFullscreen: function() {
          sendMessage({ type: 'plugin:requestFullscreen' });
        },

        exitFullscreen: function() {
          sendMessage({ type: 'plugin:exitFullscreen' });
        },

        onFullscreenChange: function(cb) {
          _fullscreenCallback = cb;
        }
      };
    }
  };
})();

// Forward zoom gestures to host so they don't trigger browser viewport zoom.
// The host's annotation-layer handles zoom via CSS transform on #paper.
(function() {
  // Ctrl+wheel / trackpad pinch (fires as wheel with ctrlKey=true)
  document.addEventListener('wheel', function(e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    window.parent.postMessage({
      type: 'plugin:zoomWheel',
      deltaY: e.deltaY,
      clientX: e.clientX,
      clientY: e.clientY
    }, '*');
  }, { passive: false });

  // Touch pinch zoom — coalesce via rAF so we send exactly one message per
  // animation frame with the accumulated ratio. Without this, multiple touchmove
  // events per frame each trigger an async postMessage, causing visible stutter.
  var prevDist = 0;
  var pendingRatio = 1;
  var pendingCX = 0;
  var pendingCY = 0;
  var rafId = 0;

  function flushPinch() {
    if (pendingRatio !== 1) {
      window.parent.postMessage({
        type: 'plugin:zoomTouchMove',
        ratio: pendingRatio,
        centerX: pendingCX,
        centerY: pendingCY
      }, '*');
      pendingRatio = 1;
    }
    rafId = 0;
  }

  document.addEventListener('touchstart', function(e) {
    if (e.touches.length >= 2) {
      e.preventDefault();
      // Use screenX/screenY for distance — immune to parent CSS transform changes.
      // clientX/clientY shifts when the parent applies scale(), creating a feedback loop
      // where each zoom-in causes the next frame to measure a phantom zoom-out.
      var dx = e.touches[0].screenX - e.touches[1].screenX;
      var dy = e.touches[0].screenY - e.touches[1].screenY;
      prevDist = Math.sqrt(dx * dx + dy * dy);
      pendingRatio = 1;
    }
  }, { passive: false });

  document.addEventListener('touchmove', function(e) {
    if (e.touches.length >= 2 && prevDist > 0) {
      e.preventDefault();
      var dx = e.touches[0].screenX - e.touches[1].screenX;
      var dy = e.touches[0].screenY - e.touches[1].screenY;
      var dist = Math.sqrt(dx * dx + dy * dy);
      // Accumulate incremental ratio (multiplicative) across touchmoves within one frame
      pendingRatio *= dist / prevDist;
      prevDist = dist;
      // Use screenX/screenY for center too — clientX/clientY is in iframe CSS space
      // which is distorted by the parent's CSS transform
      pendingCX = (e.touches[0].screenX + e.touches[1].screenX) / 2;
      pendingCY = (e.touches[0].screenY + e.touches[1].screenY) / 2;
      if (!rafId) {
        rafId = requestAnimationFrame(flushPinch);
      }
    }
  }, { passive: false });

  document.addEventListener('touchend', function(e) {
    if (e.touches.length < 2) {
      // Flush any pending ratio before ending the gesture
      if (rafId) { cancelAnimationFrame(rafId); flushPinch(); }
      prevDist = 0;
    }
  }, { passive: false });
})();

// Auto-resize: report content height to host whenever layout changes
(function() {
  var lastHeight = 0;
  var timer = null;
  function report() {
    var h = document.documentElement.scrollHeight;
    if (h !== lastHeight && h > 0) {
      lastHeight = h;
      window.parent.postMessage({ type: 'plugin:resize', height: h }, '*');
    }
  }
  if (window.ResizeObserver) {
    new ResizeObserver(function() {
      clearTimeout(timer);
      timer = setTimeout(report, 100);
    }).observe(document.documentElement);
  }
  if (document.readyState === 'complete') report();
  else window.addEventListener('load', report);
})();
`;

/**
 * Content-Security-Policy for plugin iframes.
 * - connect-src 'none': no fetch/XHR/WebSocket (prevents data exfiltration)
 * - script-src: inline + allowlisted CDNs only
 * - default-src 'none': block everything not explicitly allowed
 */
export const PLUGIN_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com blob:",
  "style-src 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com https://cdn.jsdelivr.net",
  "img-src data: blob: https:",
  "connect-src https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com",
  "worker-src blob:",
].join('; ');

/**
 * Build the full srcdoc HTML for a plugin iframe.
 * Injects CSP meta tag and SDK script before the plugin's own HTML.
 */
/**
 * Build the full srcdoc HTML for a plugin iframe.
 * Injects CSP meta tag, base styles, and SDK script before the plugin's own HTML.
 * Sets color-scheme to match host theme so the browser default background is correct
 * before the plugin's onReady fires.
 */
export function buildPluginSrcdoc(entryHtml: string, theme?: string): string {
  const isDark = theme === 'dark'
  return `<!DOCTYPE html>
<html style="color-scheme:${isDark ? 'dark' : 'light'}">
<head>
<meta http-equiv="Content-Security-Policy" content="${PLUGIN_CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;padding:0;background:transparent;}</style>
<script>${PLUGIN_SDK_SOURCE}</script>
</head>
<body>
${entryHtml}
</body>
</html>`;
}
