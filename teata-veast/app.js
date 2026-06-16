/*
 * Rotermann "Teata veast" - Sharry -> Hausing veateadete vorm (klient-skript).
 * Muster: park/app.js. Kogub Sharry user-konteksti URL-ist, mint'ib
 * client_request_id (idempotentsus) ja saadab POST /api/fault.
 */

(function () {
  'use strict';

  var form = document.getElementById('fault-form');
  var formView = document.getElementById('view-form');
  var resultView = document.getElementById('view-result');
  var categoryInput = document.getElementById('category');
  var descInput = document.getElementById('description');
  var charNow = document.getElementById('char-now');
  var submitBtn = document.getElementById('submit-btn');
  var submitLabel = document.getElementById('submit-label');
  var submitSpinner = document.getElementById('submit-spinner');

  var resultIcon = document.getElementById('result-icon');
  var resultTitle = document.getElementById('result-title');
  var resultTicket = document.getElementById('result-ticket');
  var resultMeta = document.getElementById('result-meta');
  var resultStatusBtn = document.getElementById('result-status');
  var resultActionBtn = document.getElementById('result-action');

  // Sharry edastab kasutaja andmed URL query parameetritena (sama nagu parkimine).
  function collectContext() {
    var ctx = {};
    try {
      var params = new URLSearchParams(window.location.search);
      params.forEach(function (value, key) {
        if (value && value !== 'undefined' && value !== 'null') {
          ctx[key] = String(value).slice(0, 200);
        }
      });
    } catch (e) {}
    return ctx;
  }

  function extractEmail(ctx) {
    var keys = ['e', 'email', 'user_email', 'user-email'];
    for (var i = 0; i < keys.length; i++) {
      for (var k in ctx) {
        if (k.toLowerCase() === keys[i] && ctx[k]) return ctx[k];
      }
    }
    return null;
  }

  function uuid() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (e) {}
    // Fallback (mitte krüptograafiline, aga piisav idempotentsuse jaoks).
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // client_request_id pusib sama submit'i jooksul stabiilne (retry => sama ticket).
  var pendingRequestId = uuid();
  var lastReport = null; // { id, email }

  descInput.addEventListener('input', function () {
    charNow.textContent = String(descInput.value.length);
    submitBtn.disabled = descInput.value.trim().length < 3;
  });
  submitBtn.disabled = true;

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var description = descInput.value.trim();
    if (description.length < 3) {
      showResult(false, 'Palun kirjelda viga (vähemalt 3 tähemärki).');
      return;
    }
    submitBtn.disabled = true;
    submitLabel.textContent = 'Saadan…';
    submitSpinner.hidden = false;

    var ctx = collectContext();
    var email = extractEmail(ctx);

    fetch('/api/fault', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        description: description,
        category: categoryInput.value || null,
        client_request_id: pendingRequestId,
        context: ctx
      })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { status: res.status, data: data };
        });
      })
      .then(function (result) {
        if (result.status >= 200 && result.status < 300 && result.data && result.data.ok) {
          lastReport = { id: pendingRequestId, email: email };
          // Uus submit => uus idempotentsuse võti.
          pendingRequestId = uuid();
          showResult(true, null, result.data);
        } else {
          var msg = (result.data && (result.data.message || result.data.error)) || 'Saatmine ebaõnnestus. Palun proovi uuesti.';
          showResult(false, msg);
        }
      })
      .catch(function () {
        showResult(false, 'Võrguviga. Kontrolli ühendust ja proovi uuesti.');
      })
      .finally(function () {
        submitLabel.textContent = 'Saada veateade';
        submitSpinner.hidden = true;
        submitBtn.disabled = false;
      });
  });

  function showResult(success, errorMessage, data) {
    formView.hidden = true;
    resultView.hidden = false;

    if (success) {
      resultIcon.className = 'result-icon success';
      resultIcon.textContent = '✓';
      resultTitle.textContent = 'Veateade saadetud';
      if (data && data.ticketNumber) {
        resultTicket.textContent = 'Nr ' + data.ticketNumber;
        resultTicket.hidden = false;
      } else {
        resultTicket.hidden = true;
      }
      resultMeta.textContent = 'Haldus võtab teate menetlusse. Staatust saad siit kontrollida.';
      resultMeta.hidden = false;
      resultStatusBtn.hidden = !lastReport;
      resultActionBtn.textContent = 'Teata uuest veast';
    } else {
      resultIcon.className = 'result-icon error';
      resultIcon.textContent = '!';
      resultTitle.textContent = errorMessage || 'Viga';
      resultTicket.hidden = true;
      resultMeta.hidden = true;
      resultStatusBtn.hidden = true;
      resultActionBtn.textContent = 'Proovi uuesti';
    }
  }

  resultStatusBtn.addEventListener('click', function () {
    if (!lastReport) return;
    resultStatusBtn.disabled = true;
    var url = '/api/fault/status?id=' + encodeURIComponent(lastReport.id) +
      (lastReport.email ? '&email=' + encodeURIComponent(lastReport.email) : '');
    fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data && data.ok) {
          resultMeta.textContent = 'Staatus: ' + (data.statusLabel || data.status) +
            (data.resolved && data.resolution ? ' — ' + data.resolution : '');
          resultMeta.hidden = false;
        } else {
          resultMeta.textContent = 'Staatust ei õnnestunud laadida.';
          resultMeta.hidden = false;
        }
      })
      .catch(function () {
        resultMeta.textContent = 'Staatust ei õnnestunud laadida.';
        resultMeta.hidden = false;
      })
      .finally(function () {
        resultStatusBtn.disabled = false;
      });
  });

  resultActionBtn.addEventListener('click', function () {
    descInput.value = '';
    categoryInput.value = '';
    charNow.textContent = '0';
    submitBtn.disabled = true;
    resultView.hidden = true;
    formView.hidden = false;
    descInput.focus();
  });
})();
