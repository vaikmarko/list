/*
 * Rotermann kulaliste parkimine - jagatud klient-skript.
 * Iga vorm seab data-floor atribuudi (5 v6i 6).
 */

(function () {
  'use strict';

  var form = document.getElementById('park-form');
  var formView = document.getElementById('view-form');
  var resultView = document.getElementById('view-result');
  var plateInput = document.getElementById('plate');
  var submitBtn = document.getElementById('submit-btn');
  var submitLabel = document.getElementById('submit-label');
  var submitSpinner = document.getElementById('submit-spinner');

  var resultIcon = document.getElementById('result-icon');
  var resultTitle = document.getElementById('result-title');
  var resultPlate = document.getElementById('result-plate');
  var resultMeta = document.getElementById('result-meta');
  var resultActionBtn = document.getElementById('result-action');

  var floor = form.getAttribute('data-floor');

  // Sharry äpp suunab URL-i kaudu kasutaja andmed query parameetritena.
  // Kogume kõik saadud query paramid ja saadame Function'ile audit log'iks.
  // Sharry võimalikud muutujad: User e-mail, User name, User ID, Tenant name,
  //   Tenant ID, Primary site, Base location ID, Site ID
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

  // Numbri sisestus: automaatne uppercase + ainult A-Z, 0-9
  plateInput.addEventListener('input', function () {
    var cleaned = plateInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleaned !== plateInput.value) {
      plateInput.value = cleaned;
    }
    submitBtn.disabled = cleaned.length < 2;
  });

  // Esialgu nupp keelatud
  submitBtn.disabled = true;

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var plate = plateInput.value.trim().toUpperCase();
    if (plate.length < 2 || plate.length > 10) {
      showResult(false, plate, 'Enter a license plate (2-10 characters).');
      return;
    }
    submitBtn.disabled = true;
    submitLabel.textContent = 'Parking\u2026';
    submitSpinner.hidden = false;

    fetch('/api/park', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ floor: floor, plate: plate, context: collectContext() })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { status: res.status, data: data };
        });
      })
      .then(function (result) {
        if (result.status >= 200 && result.status < 300 && result.data && result.data.ok) {
          showResult(true, plate, null, result.data);
        } else {
          var msg = (result.data && (result.data.message || result.data.error)) || 'Parking failed. Please try again.';
          showResult(false, plate, msg);
        }
      })
      .catch(function () {
        showResult(false, plate, 'Network error. Check your connection and try again.');
      })
      .finally(function () {
        submitLabel.textContent = 'Park 3 hours free';
        submitSpinner.hidden = true;
        submitBtn.disabled = false;
      });
  });

  function showResult(success, plate, errorMessage, data) {
    formView.hidden = true;
    resultView.hidden = false;

    if (success) {
      resultIcon.className = 'result-icon success';
      resultIcon.textContent = '\u2713';
      resultTitle.textContent = 'Parked';
      resultPlate.textContent = plate;
      resultPlate.hidden = false;
      // Server tagastab valmis Estonia HH:MM (DST-aware) - kuva ilma parsing'uta.
      if (data && data.end_time_local) {
        resultMeta.textContent = 'until ' + data.end_time_local;
        resultMeta.hidden = false;
      } else {
        resultMeta.hidden = true;
      }
      resultActionBtn.textContent = 'Park another car';
    } else {
      resultIcon.className = 'result-icon error';
      resultIcon.textContent = '!';
      resultTitle.textContent = errorMessage || 'Error';
      resultPlate.hidden = true;
      resultMeta.hidden = true;
      resultActionBtn.textContent = 'Try again';
    }
  }

  resultActionBtn.addEventListener('click', function () {
    plateInput.value = '';
    submitBtn.disabled = true;
    resultView.hidden = true;
    formView.hidden = false;
    plateInput.focus();
  });
})();
