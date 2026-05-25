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
      body: JSON.stringify({ floor: floor, plate: plate })
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
      if (data && data.end_time) {
        var end = parseEuroparkTime(data.end_time);
        if (end) {
          resultMeta.textContent = 'until ' + formatTime(end);
          resultMeta.hidden = false;
        } else {
          resultMeta.hidden = true;
        }
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

  // Europark tagastab "dd.mm.yyyy HH:MM" Eesti aja j2rgi
  function parseEuroparkTime(s) {
    if (!s) return null;
    var iso = new Date(s);
    if (!isNaN(iso.getTime())) return iso;
    var m = String(s).match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
    if (m) {
      return new Date(parseInt(m[3],10), parseInt(m[2],10)-1, parseInt(m[1],10), parseInt(m[4],10), parseInt(m[5],10));
    }
    return null;
  }

  resultActionBtn.addEventListener('click', function () {
    plateInput.value = '';
    submitBtn.disabled = true;
    resultView.hidden = true;
    formView.hidden = false;
    plateInput.focus();
  });

  function formatTime(date) {
    var hh = String(date.getHours()).padStart(2, '0');
    var mm = String(date.getMinutes()).padStart(2, '0');
    return hh + ':' + mm;
  }
})();
