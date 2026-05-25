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
  var resultText = document.getElementById('result-text');
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
      showResult(false, plate, 'Sisesta autonumber (2-10 t2hem2rki).');
      return;
    }
    submitBtn.disabled = true;
    submitLabel.textContent = 'Parkimine...';
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
          var msg = (result.data && (result.data.message || result.data.error)) || 'Parkimine eba6nnestus. Proovi uuesti.';
          showResult(false, plate, msg);
        }
      })
      .catch(function () {
        showResult(false, plate, 'V6rguviga. Kontrolli internetiuhendust ja proovi uuesti.');
      })
      .finally(function () {
        submitLabel.textContent = 'Pargi 3 tundi tasuta';
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
      resultTitle.textContent = 'Auto on pargitud!';
      resultPlate.textContent = plate;
      resultPlate.hidden = false;
      resultText.textContent = 'Tasuta parkimine 3 tundi. Ait2h, et k2lastasite Rotermanni!';
      if (data && data.end_time) {
        var end = new Date(data.end_time);
        if (!isNaN(end.getTime())) {
          resultMeta.textContent = 'Parkimine kestab kuni ' + formatTime(end);
          resultMeta.hidden = false;
        } else {
          resultMeta.hidden = true;
        }
      } else {
        resultMeta.hidden = true;
      }
      resultActionBtn.textContent = 'Pargi veel auto';
    } else {
      resultIcon.className = 'result-icon error';
      resultIcon.textContent = '!';
      resultTitle.textContent = 'Parkimine ei 6nnestunud';
      resultPlate.hidden = true;
      resultText.textContent = errorMessage || 'Tundmatu viga.';
      resultMeta.hidden = true;
      resultActionBtn.textContent = 'Proovi uuesti';
    }
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
