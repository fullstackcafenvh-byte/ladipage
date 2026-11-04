(function () {
  'use strict';

  var config = {
    blocked: true,
    formSelector: 'form, .ladi-form',
    blockedRequestUrls: [
      'https://api1.ldpform.com/sendform',
      'https://api2.ldpform.com/sendform',
      'https://api1.ldpform.net/sendform',
      'https://api2.ldpform.net/sendform',
      'https://apiv5.ladipage.com/2.0/send-form-data'
    ]
  };

  var campaigns = new URLSearchParams(window.location.search).getAll('utm_campaign');
  if (!campaigns.some(function (value) { return value.trim() !== ''; })) return;

  if (window.LadiPurchaseBlock) {
    window.LadiPurchaseBlock.setBlocked(config.blocked);
    return;
  }

  var reloading = false;

  function isBlockedForm(target) {
    return config.blocked && target instanceof Element &&
      target.closest(config.formSelector) !== null;
  }

  function stopSubmission(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    reloadPage();
  }

  function reloadPage() {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  }

  function onSubmit(event) {
    if (isBlockedForm(event.target)) stopSubmission(event);
  }

  function onFocusOut(event) {
    var target = event.target;
    if (target instanceof Element &&
        target.matches('input[name="email"], input[name="phone"]') &&
        target.closest('.ladi-form') && isBlockedForm(target)) {
      event.stopImmediatePropagation();
    }
  }

  function onInput(event) {
    var target = event.target;
    if (target instanceof Element &&
        target.matches('input[name="email"], input[name="phone"]') &&
        target.closest('.ladi-form') && isBlockedForm(target)) {
      event.stopImmediatePropagation();
    }
  }

  function onClick(event) {
    if (!(event.target instanceof Element)) return;
    var button = event.target.closest('.ladi-button, button, input');
    if (!button) return;

    var nativeSubmit = button.form &&
      (button.type === 'submit' || button.type === 'image');
    var ladiSubmit = button.matches('.ladi-button') && button.closest('.ladi-form');
    if ((nativeSubmit && isBlockedForm(button.form)) ||
      (ladiSubmit && isBlockedForm(button))) stopSubmission(event);
  }

  var originalSubmit = HTMLFormElement.prototype.submit;
  function wrappedSubmit() {
    if (isBlockedForm(this)) {
      reloadPage();
      return;
    }
    return originalSubmit.apply(this, arguments);
  }

  function isBlockedRequest(url) {
    if (!config.blocked) return false;
    try {
      var parsed = new URL(url, window.location.href);
      return config.blockedRequestUrls.indexOf(parsed.origin + parsed.pathname) !== -1;
    } catch (error) {
      return false;
    }
  }

  function blockedRequestError() {
    return new DOMException('LadiPage form request blocked.', 'AbortError');
  }

  var requestUrls = new WeakMap();
  var originalOpen = XMLHttpRequest.prototype.open;
  var originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    var result = originalOpen.apply(this, arguments);
    requestUrls.set(this, String(url));
    return result;
  };
  XMLHttpRequest.prototype.send = function () {
    if (isBlockedRequest(requestUrls.get(this))) throw blockedRequestError();
    return originalSend.apply(this, arguments);
  };

  var originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function (input) {
      var url = typeof Request !== 'undefined' && input instanceof Request ? input.url : input;
      if (isBlockedRequest(url)) return Promise.reject(blockedRequestError());
      return originalFetch.apply(this, arguments);
    };
  }

  window.addEventListener('submit', onSubmit, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('focusout', onFocusOut, true);
  window.addEventListener('input', onInput, true);
  HTMLFormElement.prototype.submit = wrappedSubmit;

  window.LadiPurchaseBlock = {
    setBlocked: function (blocked) {
      config.blocked = Boolean(blocked);
    },
    isBlocked: function () {
      return config.blocked;
    }
  };

})();
