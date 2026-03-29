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
