/* CounterPack - DOM wiring. All processing local; nothing leaves the browser. */
(function () {
  'use strict';
  var L = window.PackLogic;
  var STORE_KEY = 'counterpack.v1';
  var narrativeDirty = false;

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var state = { category: null, fields: {}, evidenceAnswers: {}, reasonCode: '' };

  /* ---------- persistence ---------- */
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* private mode etc. */ }
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && typeof s === 'object') state = Object.assign(state, s);
      }
    } catch (e) { /* ignore corrupt storage */ }
  }
  function clearAll() {
    if (!confirm('Clear everything you entered? This cannot be undone.')) return;
    state = { category: null, fields: {}, evidenceAnswers: {}, reasonCode: '' };
    narrativeDirty = false;
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    renderAll();
  }

  /* ---------- category step ---------- */
  function renderCategories() {
    var wrap = $('#categoryCards');
    wrap.innerHTML = '';
    L.CATEGORY_ORDER.forEach(function (key) {
      var c = L.CATEGORIES[key];
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cat-card' + (state.category === key ? ' selected' : '');
      btn.setAttribute('aria-pressed', state.category === key ? 'true' : 'false');
      btn.innerHTML = '<strong>' + L.escapeHtml(c.label) + '</strong>' +
        '<span>' + L.escapeHtml(c.blurb) + '</span>' +
        '<em>Common codes: ' + L.escapeHtml(c.codes.join(' · ')) + '</em>';
      btn.addEventListener('click', function () {
        state.category = key;
        state.evidenceAnswers = {};
        save();
        renderCategories();
        renderChecklist();
        renderPack();
      });
      wrap.appendChild(btn);
    });
  }

  /* ---------- checklist step ---------- */
  function renderChecklist() {
    var wrap = $('#checklist');
    var empty = $('#checklistEmpty');
    wrap.innerHTML = '';
    if (!state.category) { empty.hidden = false; return; }
    empty.hidden = true;
    L.CATEGORIES[state.category].evidence.forEach(function (ev) {
      var a = state.evidenceAnswers[ev.id] || {};
      var row = document.createElement('div');
      row.className = 'ev-item status-' + (a.status || 'missing');
      var typeTag = '<span class="type-tag">' + L.escapeHtml(L.UPLOAD_TYPES[ev.type]) + '</span>';
      row.innerHTML =
        '<div class="ev-head"><strong>' + L.escapeHtml(ev.label) + '</strong>' + typeTag + '</div>' +
        '<p class="hint">' + L.escapeHtml(ev.hint) + '</p>' +
        '<div class="ev-controls" role="group" aria-label="Status for ' + L.escapeHtml(ev.label) + '">' +
          ['have', 'missing', 'na'].map(function (s) {
            var labels = { have: 'I have this', missing: 'Missing', na: 'Not applicable' };
            return '<label class="pill' + (a.status === s ? ' on' : '') + '"><input type="radio" name="ev_' + ev.id + '" value="' + s + '"' + (a.status === s ? ' checked' : '') + '> ' + labels[s] + '</label>';
          }).join('') +
        '</div>' +
        '<input type="text" class="ev-note" placeholder="Note: file name or where it is (optional)" value="' + L.escapeHtml(a.note || '') + '">';
      row.querySelectorAll('input[type=radio]').forEach(function (r) {
        r.addEventListener('change', function () {
          state.evidenceAnswers[ev.id] = state.evidenceAnswers[ev.id] || {};
          state.evidenceAnswers[ev.id].status = r.value;
          save(); renderChecklist(); renderPack();
        });
      });
      row.querySelector('.ev-note').addEventListener('input', function (e) {
        state.evidenceAnswers[ev.id] = state.evidenceAnswers[ev.id] || {};
        state.evidenceAnswers[ev.id].note = e.target.value;
        save();
      });
      wrap.appendChild(row);
    });
  }

  /* ---------- facts step ---------- */
  function renderFields() {
    var groups = { order: $('#fieldsOrder'), customer: $('#fieldsCustomer'), fulfilment: $('#fieldsFulfilment'), resolution: $('#fieldsResolution') };
    Object.keys(groups).forEach(function (g) { groups[g].innerHTML = ''; });
    L.FIELDS.forEach(function (f) {
      var box = document.createElement('div');
      box.className = 'field';
      var input;
      if (f.type === 'textarea') {
        input = document.createElement('textarea');
        input.rows = 3;
      } else if (f.type === 'select') {
        input = document.createElement('select');
        (f.options || []).forEach(function (o) {
          var opt = document.createElement('option');
          opt.value = o; opt.textContent = o === '' ? '—' : o;
          input.appendChild(opt);
        });
      } else {
        input = document.createElement('input');
        input.type = f.type || 'text';
      }
      input.id = 'f_' + f.id;
      if (f.placeholder) input.placeholder = f.placeholder;
      input.value = state.fields[f.id] || '';
      input.addEventListener('input', function () {
        state.fields[f.id] = input.value;
        save(); renderPack();
      });
      var lab = document.createElement('label');
      lab.setAttribute('for', 'f_' + f.id);
      lab.textContent = f.label;
      box.appendChild(lab);
      box.appendChild(input);
      groups[f.group].appendChild(box);
    });
  }

  function collectInput() {
    var input = Object.assign({}, state.fields);
    input.category = state.category;
    input.reasonCode = state.reasonCode;
    input.evidenceAnswers = state.evidenceAnswers;
    return input;
  }

  /* ---------- pack preview ---------- */
  function renderPack() {
    var pack = L.buildPack(collectInput());
    var banner = $('#packStatus');
    banner.className = 'pack-status ' + (pack.readyToSubmit ? 'ready' : 'notready');
    banner.textContent = pack.statusLine;

    var ta = $('#narrative');
    if (!narrativeDirty) ta.value = pack.paragraphs.join('\n\n');
    $('#regenNarrative').onclick = function () {
      narrativeDirty = false;
      ta.value = L.buildNarrative(collectInput()).paragraphs.join('\n\n');
    };

    var tl = $('#timeline');
    tl.innerHTML = '';
    if (!pack.timeline.length) {
      tl.innerHTML = '<li class="muted">Add dates above to build a chronological timeline.</li>';
    } else {
      pack.timeline.forEach(function (e) {
        var li = document.createElement('li');
        li.innerHTML = '<strong>' + L.escapeHtml(e.date) + '</strong> — ' + L.escapeHtml(e.text);
        tl.appendChild(li);
      });
    }

    var gaps = $('#gapsList');
    gaps.innerHTML = '';
    if (!pack.allGaps.length) {
      gaps.innerHTML = '<li class="ok">No gaps flagged. Still review everything yourself - the tool only knows what you told it.</li>';
    } else {
      pack.allGaps.forEach(function (g) {
        var li = document.createElement('li');
        li.textContent = g;
        gaps.appendChild(li);
      });
    }

    var inv = $('#evidenceByType');
    inv.innerHTML = '';
    if (!pack.checklist.byType.length) {
      inv.innerHTML = '<p class="muted">Select a dispute category in step 1 to see its evidence checklist.</p>';
    } else {
      pack.checklist.byType.forEach(function (grp) {
        var div = document.createElement('div');
        div.className = 'type-group';
        var rows = grp.items.map(function (i) {
          var mark = i.status === 'have' ? '✔ available - attach separately' : i.status === 'na' ? '— n/a' : '✘ MISSING';
          return '<li class="st-' + i.status + '"><span>' + L.escapeHtml(i.label) + '</span><b>' + mark + '</b>' +
            (i.note ? '<small>' + L.escapeHtml(i.note) + '</small>' : '') + '</li>';
        }).join('');
        div.innerHTML = '<h4>' + L.escapeHtml(grp.label) + ' <small>(combine into ONE file)</small></h4><ul>' + rows + '</ul>';
        inv.appendChild(div);
      });
    }

    var rules = $('#submissionRules');
    rules.innerHTML = '';
    pack.submissionRules.forEach(function (r) {
      var li = document.createElement('li');
      li.textContent = r;
      rules.appendChild(li);
    });

    renderPrintView(pack);
  }

  /* ---------- print view ---------- */
  function renderPrintView(pack) {
    var pv = $('#printPack');
    var narrativeText = $('#narrative').value;
    var esc = L.escapeHtml;
    var h = '';
    h += '<div class="pp-head"><h1>Dispute evidence pack</h1>';
    h += '<p class="pp-meta">' + esc(pack.merchant || '[store name]') + ' · Order ' + esc(pack.orderId || '[reference]') +
      ' · ' + esc(pack.category || '[dispute category]') + (pack.reasonCode ? ' (' + esc(pack.reasonCode) + ')' : '') +
      (pack.amount ? ' · ' + esc(pack.amount) : '') + ' · Prepared ' + esc(pack.generatedAt) + '</p>';
    h += '<p class="pp-note"><strong>This document only organises the response.</strong> The supporting records listed below are NOT inside this file - the seller attaches them, one combined file per evidence type, in their own processor dashboard.</p>';
    if (!pack.readyToSubmit) h += '<p class="pp-warning">⚠ NOT READY TO SUBMIT - unresolved gaps are listed at the end. Do not send this response until they are resolved.</p>';
    h += '</div>';
    h += '<h2>Response summary</h2>';
    narrativeText.split(/\n{2,}/).forEach(function (p) {
      if (p.trim()) h += '<p>' + esc(p.trim()).replace(/\n/g, '<br>') + '</p>';
    });
    if (pack.timeline.length) {
      h += '<h2>Timeline</h2><ul>' + pack.timeline.map(function (e) {
        return '<li><strong>' + esc(e.date) + '</strong> — ' + esc(e.text) + '</li>';
      }).join('') + '</ul>';
    }
    h += '<h2>Evidence inventory - records the seller attaches separately (one combined file per type)</h2>';
    pack.checklist.byType.forEach(function (grp) {
      h += '<h3>' + esc(grp.label) + '</h3><ul>' + grp.items.map(function (i) {
        var mark = i.status === 'have' ? 'Available per seller - still to be attached' : i.status === 'na' ? 'Not applicable' : 'MISSING - add before submitting';
        return '<li>' + esc(i.label) + ' — <strong>' + mark + '</strong>' + (i.note ? ' (' + esc(i.note) + ')' : '') + '</li>';
      }).join('') + '</ul>';
    });
    h += '<h2>Background details</h2><ul>' + pack.background.map(function (b) {
      return '<li>' + esc(b.label) + ': ' + (b.value ? esc(b.value) : '<strong>MISSING</strong>') + '</li>';
    }).join('') + '</ul>';
    if (pack.allGaps.length) {
      h += '<h2>Unresolved gaps - resolve before submitting</h2><ul>' + pack.allGaps.map(function (g) {
        return '<li>' + esc(g) + '</li>';
      }).join('') + '</ul>';
    }
    h += '<p class="pp-foot">Assembled by the seller from their own records with CounterPack (local browser tool). The seller checked each statement against their own records, attaches the listed records separately, and submits the response themselves.</p>';
    pv.innerHTML = h;
  }

  /* ---------- calculator ---------- */
  function renderCalc() {
    var out = $('#calcOut');
    var res = L.worthFighting({
      amount: $('#c_amount').value,
      fee: $('#c_fee').value,
      hours: $('#c_hours').value,
      hourlyRate: $('#c_rate').value
    });
    if (res.error) { out.innerHTML = '<p class="muted">' + L.escapeHtml(res.error) + '</p>'; return; }
    var h = '<p><strong>Cost of fighting:</strong> ' + L.escapeHtml(String(res.cost)) + ' (fee + your time)</p>';
    h += '<p><strong>Break-even:</strong> ' + L.escapeHtml(res.breakEvenNote) + '</p>';
    out.innerHTML = h;
  }

  /* ---------- sample data ---------- */
  function fillSample() {
    state.category = 'product_not_received';
    state.reasonCode = '13.1';
    state.fields = {
      merchantName: 'Sample Store (delete me)',
      orderId: '#1042',
      chargeDate: '2026-10-28',
      amount: '49.00',
      currency: 'USD',
      processor: 'Shopify Payments',
      productDescription: 'Handmade ceramic mug, blue glaze, as listed with photos and dimensions.',
      customerName: 'A. Example',
      customerEmail: 'customer@example.com',
      billingAddress: '12 Example St, Austin TX 78701',
      shippingAddress: '12 Example St, Austin TX 78701',
      purchaseIp: '203.0.113.44',
      avsResult: 'full match',
      cvcResult: 'match',
      carrier: 'UPS',
      trackingNumber: '1Z999AA10123456784',
      shipDate: '2026-10-30',
      deliveryDate: '2026-11-03',
      refundIssued: 'no',
      commsSummary: '8 Nov - customer emailed "where is my order"; replied within 2 hours with the tracking link showing delivery 3 Nov.',
      policyExcerpt: 'Items lost in transit are replaced or refunded once the carrier confirms non-delivery.',
      extraNotes: ''
    };
    state.evidenceAnswers = {
      delivery: { status: 'have', note: 'UPS tracking screenshot, delivery-pic.pdf' },
      comms: { status: 'have', note: 'email thread export' },
      terms: { status: 'have', note: 'checkout-policy.png' },
      digital: { status: 'na' },
      service: { status: 'na' }
    };
    narrativeDirty = false;
    save();
    renderAll();
  }

  function renderAll() {
    renderCategories();
    renderChecklist();
    renderFields();
    $('#reasonCode').value = state.reasonCode || '';
    renderPack();
  }

  /* ---------- boot ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    load();
    renderAll();
    if (new URLSearchParams(location.search).get('sample') === '1') fillSample();

    $('#reasonCode').addEventListener('input', function (e) { state.reasonCode = e.target.value; save(); renderPack(); });
    $('#narrative').addEventListener('input', function () { narrativeDirty = true; renderPack(); });
    $('#printBtn').addEventListener('click', function () { window.print(); });
    $('#copyBtn').addEventListener('click', function () {
      var ta = $('#narrative');
      ta.select();
      try { document.execCommand('copy'); $('#copyBtn').textContent = 'Copied'; setTimeout(function () { $('#copyBtn').textContent = 'Copy summary text'; }, 1500); }
      catch (e) { $('#copyBtn').textContent = 'Select + copy manually'; }
    });
    $('#sampleBtn').addEventListener('click', fillSample);
    $('#clearBtn').addEventListener('click', clearAll);
    ['c_amount', 'c_fee', 'c_hours', 'c_rate'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', renderCalc);
    });
    renderCalc();
  });
})();
