(function () {
  'use strict';

  var CONSENT_KEY = 'cc_cookie_consent';

  function getConsent() { return localStorage.getItem(CONSENT_KEY); }

  function setConsent(value) {
    localStorage.setItem(CONSENT_KEY, value);
    dismissBanner();
  }

  function dismissBanner() {
    var el = document.getElementById('cookie-banner');
    if (el) {
      el.style.animation = 'slideUpBanner .3s ease reverse';
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 280);
    }
  }

  function t(key, fallback) {
    if (typeof i18n !== 'undefined') return i18n.t(key);
    return fallback || key;
  }

  function showBanner() {
    if (document.getElementById('cookie-banner')) return;

    var banner = document.createElement('div');
    banner.id = 'cookie-banner';
    banner.className = 'cookie-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookie consent');

    banner.innerHTML =
      '<div class="cookie-banner-inner">' +
        '<div class="cookie-banner-body">' +
          '<span class="cookie-icon">🍪</span>' +
          '<div>' +
            '<strong class="cookie-banner-title" data-i18n="cookie_title">' + t('cookie_title', 'Cookie-uri și stocare locală') + '</strong>' +
            '<p class="cookie-banner-text" data-i18n="cookie_desc">' + t('cookie_desc', 'Folosim stocare locală pentru sesiunea ta, preferința de limbă și voturile tale. Fără tracking sau publicitate.') + '</p>' +
          '</div>' +
        '</div>' +
        '<div class="cookie-banner-actions">' +
          '<a href="cookies.html" class="btn btn-ghost btn-sm" data-i18n="cookie_details">' + t('cookie_details', 'Detalii') + '</a>' +
          '<button id="cb-necessary" class="btn btn-secondary btn-sm" data-i18n="cookie_necessary">' + t('cookie_necessary', 'Doar necesare') + '</button>' +
          '<button id="cb-accept" class="btn btn-success btn-sm" data-i18n="cookie_accept">' + t('cookie_accept', 'Acceptă toate') + '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(banner);

    document.getElementById('cb-accept').addEventListener('click', function () { setConsent('all'); });
    document.getElementById('cb-necessary').addEventListener('click', function () { setConsent('necessary'); });
  }

  function init() {
    if (!getConsent()) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', showBanner);
      } else {
        showBanner();
      }
    }
  }

  init();

  window.CookieConsent = {
    getConsent: getConsent,
    accept: function () { setConsent('all'); },
    necessary: function () { setConsent('necessary'); },
    reset: function () { localStorage.removeItem(CONSENT_KEY); },
  };
})();
