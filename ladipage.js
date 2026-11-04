(function () {
  'use strict';

  var config = {
    blocked: true,
    sheetEndpoint: 'https://script.google.com/macros/s/AKfycbxqQslaNdVe8Jc5rl-mM5sdDI3knXU17hbQC0QcokEhxskb6FP4WwxjEvxsgEtELEQ2hQ/exec',
    sheetTimeoutMs: 15000,
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
  var saving = false;

  function isBlockedForm(target) {
    return config.blocked && target instanceof Element &&
      target.closest(config.formSelector) !== null;
  }

  function stopSubmission(event, form) {
    event.preventDefault();
    event.stopImmediatePropagation();
    saveAndReload(form);
  }

  function sheetPayload(form) {
    var parent = form.closest('.ladi-element');
    var id = form.id || (parent && parent.id) || '';
    var runtime = window.LadiPageScript && window.LadiPageScript.runtime;
    var data = runtime && runtime.eventData && runtime.eventData[id];
    var fields = [];
    var allowedFields = ['name', 'phone', 'email', 'address', 'message', 'type',
      'productId', 'products', 'quantity', 'note_de_in', 'phi_giao_hang',
      'country', 'state', 'district', 'ward'];
    function appendField(name, value) {
      if (allowedFields.indexOf(name) === -1) return;
      if (typeof value !== 'string') throw new Error('File fields are not supported');
      fields.push({ name: name, value: value });
    }
    if (form instanceof HTMLFormElement) {
      new FormData(form).forEach(function (value, name) { appendField(name, value); });
    } else {
      Array.prototype.forEach.call(form.querySelectorAll('input[name], select[name], textarea[name]'), function (control) {
        if (control.disabled || /^(checkbox|radio)$/i.test(control.type) && !control.checked) return;
        if (control.type === 'file') {
          if (control.files && control.files.length) throw new Error('File fields are not supported');
          return;
        }
        if (control.tagName === 'SELECT' && control.multiple) {
          Array.prototype.forEach.call(control.options, function (option) {
            if (option.selected) appendField(control.name, option.value);
          });
        } else {
          appendField(control.name, control.value);
        }
      });
    }
    var params = new URLSearchParams(window.location.search);
    var utm = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (key) {
      utm[key] = params.getAll(key).find(function (value) { return value.trim() !== ''; }) || '';
    });
    var submissionId = window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : 'order-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    return {
      submission_id: submissionId,
      status_send: 2,
      ladi_form_id: id,
      ladipage_id: runtime && runtime.ladipage_id || '',
      total_revenue: data && data['option.form_purchase_value'] || '',
      page_url: window.location.href,
      utm: utm,
      form_data: fields
    };
  }

  async function saveAndReload(form) {
    if (saving || reloading) return;
    var nativeForm = form instanceof HTMLFormElement ? form :
      (typeof form.querySelector === 'function' ? form.querySelector('form') : null);
    if (nativeForm && !nativeForm.reportValidity()) return;
    if (!config.sheetEndpoint) {
      window.dispatchEvent(new CustomEvent('ladi-sheet-error', {
        detail: { message: 'Unable to save submission' }
      }));
      reloadPage();
      return;
    }
    saving = true;
    var timeout;
    try {
      var endpoint = new URL(config.sheetEndpoint);
      if (endpoint.protocol !== 'https:' || typeof originalFetch !== 'function') {
        throw new Error('Sheet endpoint must use HTTPS');
      }
      var payload = sheetPayload(form);
      var controller = new AbortController();
      timeout = window.setTimeout(function () { controller.abort(); }, config.sheetTimeoutMs);
      var response = await originalFetch.call(window, endpoint.href, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        credentials: 'omit',
        redirect: 'follow',
        signal: controller.signal
      });
      if (!response.ok) throw new Error('Sheet request failed');
      var receipt = await response.json();
      if (!receipt || receipt.ok !== true || receipt.submission_id !== payload.submission_id) {
        throw new Error('Sheet did not acknowledge this submission');
      }
    } catch (error) {
      window.dispatchEvent(new CustomEvent('ladi-sheet-error', {
        detail: { message: 'Unable to save submission' }
      }));
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout);
      reloadPage();
    }
  }

  function reloadPage() {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  }

  function onSubmit(event) {
    if (isBlockedForm(event.target)) stopSubmission(event, event.target);
  }

  function onFocusOut(event) {
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
      (ladiSubmit && isBlockedForm(button))) stopSubmission(event, nativeSubmit ? button.form : ladiSubmit);
  }

  var originalSubmit = HTMLFormElement.prototype.submit;
  function wrappedSubmit() {
    if (isBlockedForm(this)) {
      saveAndReload(this);
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
  HTMLFormElement.prototype.submit = wrappedSubmit;

  window.LadiPurchaseBlock = {
    setBlocked: function (blocked) {
      config.blocked = Boolean(blocked);
    },
    isBlocked: function () {
      return config.blocked;
    },
    setSheetEndpoint: function (endpoint) {
      config.sheetEndpoint = String(endpoint);
    }
  };

})();
