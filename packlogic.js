/* CounterPack - pure logic. No DOM access here so it can be unit-tested in node.
   Grounded in Stripe dispute documentation fetched 2026-11-12:
   - https://docs.stripe.com/disputes/reason-codes-defense-requirements
   - https://docs.stripe.com/disputes/best-practices
   - https://docs.stripe.com/disputes/categories
   Scope: rules shown are Stripe's published guidance (covers Stripe and Stripe-powered
   processors such as Shopify Payments). Other processors run their own processes.
   Rule: assemble ONLY what the merchant provides. Missing facts become flagged gaps,
   never invented content, never default dates, never attestations. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  root.PackLogic = api;
}(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  /* Upload types mirror Stripe's evidence categories: ONE combined file per type. */
  var UPLOAD_TYPES = {
    receipt: 'Receipt',
    customer_communication: 'Customer communication',
    customer_signature: 'Customer signature',
    shipping_documentation: 'Shipping documentation',
    service_documentation: 'Service / usage documentation',
    policy: 'Policy excerpt (refund / cancellation / terms)',
    other: 'Other records'
  };

  var CATEGORIES = {
    fraudulent: {
      label: 'Fraudulent / not authorised',
      blurb: 'The cardholder claims they did not authorise or participate in this purchase. This is the most common dispute type.',
      codes: ['10.4 Other fraud - card-absent (online)', '10.3 Other fraud - card-present'],
      evidence: [
        { id: 'avs_cvc', type: 'other', label: 'AVS and CVV check results', hint: 'Whether the billing address and card security code matched at purchase. Stripe includes these automatically when available - note the results in your response text.' },
        { id: 'ip_device', type: 'other', label: 'Purchase IP address / device data', hint: 'The IP address used at purchase, especially if it matches the billing address area or a known returning device.' },
        { id: 'history', type: 'other', label: 'Prior undisputed orders (Visa Compelling Evidence 3.0)', hint: 'Prior successful, undisputed orders from the same customer (same email/device/IP). For eligible Visa fraud disputes this can qualify as Compelling Evidence 3.0.' },
        { id: 'auth', type: 'customer_signature', label: 'Extra authentication (3DS result, signed receipt)', hint: '3-D Secure authentication result, or a signed receipt/contract if you have one.' },
        { id: 'comms', type: 'customer_communication', label: 'Customer communications', hint: 'Any messages showing the customer knew about or used the purchase (relevant excerpts only).' },
        { id: 'terms', type: 'policy', label: 'Terms agreed at checkout', hint: 'Screenshot or excerpt showing the customer accepted your terms, especially for subscriptions or digital goods.' }
      ]
    },
    product_not_received: {
      label: 'Product or service not received',
      blurb: 'The cardholder claims the order never arrived or the service was never provided.',
      codes: ['13.1 Merchandise/services not received'],
      evidence: [
        { id: 'delivery', type: 'shipping_documentation', label: 'Proof of shipment and delivery', hint: 'Tracking number and carrier delivery confirmation, or a signed receipt. Must show the full delivery address, not just city/postcode.' },
        { id: 'digital', type: 'service_documentation', label: 'Proof of digital access (digital goods)', hint: 'Login records, download logs, or usage timestamps showing the customer got the product.' },
        { id: 'service', type: 'service_documentation', label: 'Proof of service completion (services)', hint: 'Appointment records, work logs, or check-in confirmations.' },
        { id: 'comms', type: 'customer_communication', label: 'Customer communications', hint: 'Messages confirming receipt, delivery enquiries, or troubleshooting (relevant excerpts only).' },
        { id: 'terms', type: 'policy', label: 'Delivery and refund policies', hint: 'Relevant excerpts of your fulfilment, delivery and refund terms as shown at checkout.' }
      ]
    },
    product_unacceptable: {
      label: 'Product unacceptable / not as described',
      blurb: 'The cardholder says what they received was defective, damaged, or materially different from what was advertised.',
      codes: ['13.3 Not as described or defective', '13.4 Counterfeit merchandise', '13.5 Misrepresentation'],
      evidence: [
        { id: 'listing', type: 'other', label: 'Product listing as shown at purchase', hint: 'Screenshots or an archived copy of the exact description, photos and specs the customer saw.' },
        { id: 'fulfilment', type: 'receipt', label: 'Order and fulfilment records', hint: 'Timestamps for purchase, shipping, delivery and any acceptance confirmation.' },
        { id: 'usage', type: 'service_documentation', label: 'Usage logs (if applicable)', hint: 'For digital products, logins, downloads or use after purchase.' },
        { id: 'comms', type: 'customer_communication', label: 'Customer communications', hint: 'Complaints plus your responses offering troubleshooting or solutions (relevant excerpts only).' },
        { id: 'support', type: 'customer_communication', label: 'Technical support records', hint: 'Troubleshooting attempts, or evidence the customer did not engage with resolution steps. Combine with other communications into one file.' },
        { id: 'terms', type: 'policy', label: 'Return policy and terms', hint: 'The return/refund terms agreed at purchase - relevant excerpt only, not the whole policy.' }
      ]
    },
    credit_not_processed: {
      label: 'Credit or refund not processed',
      blurb: 'The cardholder claims they were owed a refund or credit, or cancelled, but were still charged.',
      codes: ['13.6 Credit not processed', '13.7 Cancelled merchandise/services'],
      evidence: [
        { id: 'refund_proof', type: 'receipt', label: 'Proof of refund (if one was issued)', hint: 'Refund transaction log, timestamp and confirmation number, or a processor statement showing it.' },
        { id: 'policy', type: 'policy', label: 'Return / cancellation policy excerpt', hint: 'Only the relevant section, plus proof the customer agreed at checkout. Show how their request did or did not meet it.' },
        { id: 'cancel_logs', type: 'other', label: 'Cancellation request records', hint: 'Whether a cancellation was ever requested, and when, versus when the charge was processed.' },
        { id: 'comms', type: 'customer_communication', label: 'Customer communications', hint: 'Messages where the refund was promised, explained or declined (relevant excerpts only).' },
        { id: 'delivery', type: 'shipping_documentation', label: 'Delivery / return tracking', hint: 'If goods were returned, tracking showing whether the return arrived.' },
        { id: 'usage', type: 'service_documentation', label: 'Usage after cancellation (services)', hint: 'Access or usage timestamps showing continued use after the claimed cancellation.' }
      ]
    },
    subscription_canceled: {
      label: 'Subscription charged after cancellation',
      blurb: 'The cardholder says they cancelled a recurring subscription but were charged again.',
      codes: ['13.2 Cancelled recurring transaction'],
      evidence: [
        { id: 'policy', type: 'policy', label: 'Subscription and cancellation terms', hint: 'Proof the customer agreed to the billing terms, including any cancellation deadline.' },
        { id: 'cancel_logs', type: 'other', label: 'Cancellation request records', hint: 'System logs showing no cancellation was submitted, or that it came after the charge.' },
        { id: 'usage', type: 'service_documentation', label: 'Post-cancellation usage (digital)', hint: 'Logins or usage timestamps after the claimed cancellation date.' },
        { id: 'shipping', type: 'shipping_documentation', label: 'Shipping records (physical goods)', hint: 'Tracking showing the recurring order had already shipped before cancellation.' },
        { id: 'comms', type: 'customer_communication', label: 'Customer communications', hint: 'Messages showing the customer was informed of the billing cycle or non-refundable terms.' },
        { id: 'refund_proof', type: 'receipt', label: 'Refund records (if applicable)', hint: 'Proof of any refund already issued before the dispute.' }
      ]
    },
    duplicate: {
      label: 'Duplicate charge',
      blurb: 'The cardholder claims they were charged twice, or already paid another way.',
      codes: ['12.6.1 Duplicate processing', '12.6.2 Paid by other means'],
      evidence: [
        { id: 'receipts', type: 'receipt', label: 'Itemised receipts for each charge', hint: 'Show the two charges were for different items/orders, or that only one settled charge exists.' },
        { id: 'logs', type: 'other', label: 'Payment and system logs', hint: 'Timestamps distinguishing a temporary authorisation hold from a settled charge.' },
        { id: 'refund_proof', type: 'receipt', label: 'Refund records (if applicable)', hint: 'Proof any genuine duplicate was already refunded. Combine with the receipts into one Receipt file.' },
        { id: 'other_payment', type: 'other', label: 'Other-payment records', hint: 'Records showing no alternative payment (cash, other card, PayPal) was received.' },
        { id: 'comms', type: 'customer_communication', label: 'Customer communications', hint: 'Support responses clarifying the charges (relevant excerpts only).' }
      ]
    },
    general: {
      label: 'Incorrect amount / other',
      blurb: 'The cardholder disputes the amount charged, or the claim does not fit another category.',
      codes: ['12.5 Incorrect amount', '12.2 Incorrect transaction code'],
      evidence: [
        { id: 'receipt', type: 'receipt', label: 'Itemised order confirmation / receipt', hint: 'Base price, taxes, fees and discounts exactly as shown to the customer.' },
        { id: 'pos', type: 'receipt', label: 'Pricing shown at purchase', hint: 'Screenshot or system record of the price presented at checkout. Combine with the receipt into one file.' },
        { id: 'logs', type: 'other', label: 'System / transaction logs', hint: 'Records showing the correct amount was recorded and transmitted.' },
        { id: 'comms', type: 'customer_communication', label: 'Customer communications', hint: 'Pre-purchase messages confirming the amount (relevant excerpts only).' }
      ]
    }
  };

  var CATEGORY_ORDER = ['fraudulent', 'product_not_received', 'product_unacceptable', 'credit_not_processed', 'subscription_canceled', 'duplicate', 'general'];

  /* Background evidence Stripe recommends for every dispute (best-practices doc). */
  var BACKGROUND_EVIDENCE = [
    { field: 'customerName', label: 'Customer name' },
    { field: 'customerEmail', label: 'Customer email' },
    { field: 'billingAddress', label: 'Billing address (as verified by AVS)' },
    { field: 'purchaseIp', label: 'Purchase IP address' },
    { field: 'productDescription', label: 'Product / service description' },
    { field: 'receiptNote', label: 'Receipt sent to customer (order confirmation)' }
  ];

  /* Formatting rules from Stripe's best-practices doc (fetched 2026-11-12).
     Labelled as Stripe guidance in the UI; not universal processor rules. */
  var SUBMISSION_RULES = [
    'Files must be PDF, JPEG or PNG only.',
    'Combined file size must stay under 4.5 MB.',
    'Keep the whole response under 50 pages (individual disputes can have lower limits).',
    'Use 12pt or larger text, A4 or US Letter, portrait.',
    'Submit only ONE file per evidence type - combine everything of the same type into a single file.',
    'Crop screenshots to what matters and circle the key detail. Upload only the relevant policy excerpt, never the whole document.',
    'Do not include links to files on external drives - issuers will not open them.',
    'Keep the tone factual and concise; reviewers handle thousands of these daily.'
  ];

  var FIELDS = [
    { id: 'merchantName', label: 'Your store / business name', placeholder: 'e.g. Kiri Crafts', group: 'order' },
    { id: 'orderId', label: 'Order / charge reference', placeholder: 'e.g. #1042 or ch_3O...', group: 'order' },
    { id: 'chargeDate', label: 'Purchase date', type: 'date', group: 'order' },
    { id: 'amount', label: 'Disputed amount', type: 'number', placeholder: 'e.g. 49.00', group: 'order' },
    { id: 'currency', label: 'Currency', placeholder: 'e.g. NZD, USD', group: 'order' },
    { id: 'processor', label: 'Payment processor', placeholder: 'e.g. Stripe, Shopify Payments', group: 'order' },
    { id: 'productDescription', label: 'What was sold (as presented at purchase)', type: 'textarea', placeholder: 'Describe the product or service exactly as your listing presented it.', group: 'order' },
    { id: 'customerName', label: 'Customer name', group: 'customer' },
    { id: 'customerEmail', label: 'Customer email', type: 'email', group: 'customer' },
    { id: 'billingAddress', label: 'Billing address', type: 'textarea', group: 'customer' },
    { id: 'shippingAddress', label: 'Delivery address', type: 'textarea', group: 'customer' },
    { id: 'purchaseIp', label: 'Purchase IP address (if known)', group: 'customer' },
    { id: 'avsResult', label: 'AVS result (address check)', placeholder: 'e.g. full match, partial, unavailable', group: 'customer' },
    { id: 'cvcResult', label: 'CVV result', placeholder: 'e.g. match, unavailable', group: 'customer' },
    { id: 'carrier', label: 'Shipping carrier', placeholder: 'e.g. NZ Post, DHL', group: 'fulfilment' },
    { id: 'trackingNumber', label: 'Tracking number', group: 'fulfilment' },
    { id: 'shipDate', label: 'Ship date', type: 'date', group: 'fulfilment' },
    { id: 'deliveryDate', label: 'Delivery date (per carrier)', type: 'date', group: 'fulfilment' },
    { id: 'refundIssued', label: 'Refund already issued?', type: 'select', options: ['', 'no', 'yes - full', 'yes - partial'], group: 'resolution' },
    { id: 'receiptNote', label: 'Order confirmation / receipt sent to customer', placeholder: 'e.g. Emailed automatically at purchase on 1 Oct 2026', group: 'resolution' },
    { id: 'refundDate', label: 'Refund date (if issued)', type: 'date', group: 'resolution' },
    { id: 'cancellationDate', label: 'Cancellation request date (if any)', type: 'date', group: 'resolution' },
    { id: 'commsSummary', label: 'Key customer messages (short factual excerpts)', type: 'textarea', placeholder: 'e.g. 12 Mar - customer emailed "where is my order"; replied same day with tracking link.', group: 'resolution' },
    { id: 'policyExcerpt', label: 'Relevant policy excerpt (refund / cancellation / terms)', type: 'textarea', placeholder: 'Paste only the sentences that matter, not the whole policy.', group: 'resolution' },
    { id: 'priorTxns', label: 'Prior undisputed orders from this customer (Visa CE 3.0)', type: 'textarea', placeholder: 'e.g. Order #998 on 2 Jan 2026, $35, same email and IP, never disputed.', group: 'resolution' },
    { id: 'duplicateExplanation', label: 'Duplicate-charge explanation (duplicate disputes only)', type: 'textarea', placeholder: 'Explain the two charges in your own words, e.g. "Two separate valid orders #1041 and #1042 for different items". If the second charge was your error, say so and refund it.', group: 'resolution' },
    { id: 'extraNotes', label: 'Anything else relevant (facts only)', type: 'textarea', group: 'resolution' }
  ];

  var GAP_PREFIX = '[MISSING - FILL IN BEFORE SUBMITTING: ';

  function isFilled(v) {
    return typeof v === 'string' ? v.trim().length > 0 : v != null && v !== '';
  }

  function val(input, id) {
    var v = input && input[id];
    return isFilled(v) ? String(v).trim() : null;
  }

  function gap(what) { return GAP_PREFIX + what + ']'; }

  function money(input) {
    var a = val(input, 'amount');
    if (!a) return null;
    var c = val(input, 'currency');
    return (c ? c + ' ' : '') + a;
  }

  /* Chronological timeline from provided dates only. No invented or default dates. */
  function buildTimeline(input) {
    var events = [];
    function add(date, text) { if (date) events.push({ date: date, text: text }); }
    add(val(input, 'chargeDate'), 'Customer placed the order' + (money(input) ? ' for ' + money(input) : '') + '.');
    add(val(input, 'shipDate'), 'Order shipped' + (val(input, 'carrier') ? ' via ' + val(input, 'carrier') : '') + (val(input, 'trackingNumber') ? ' (tracking ' + val(input, 'trackingNumber') + ')' : '') + '.');
    add(val(input, 'deliveryDate'), 'The seller reports carrier records showing the order as delivered.');
    add(val(input, 'cancellationDate'), 'Customer submitted a cancellation request.');
    add(val(input, 'refundDate'), 'A ' + (val(input, 'refundIssued') === 'yes - partial' ? 'partial ' : '') + 'refund was issued.');
    events.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return events;
  }

  /* Narrative: assembled strictly from provided values. Missing core facts become
     unmistakable gap placeholders in the text AND entries in the gaps list. */
  function buildNarrative(input) {
    var gaps = [];
    var cat = CATEGORIES[input.category] ? input.category : null;
    if (!cat) gaps.push('Dispute category not selected.');
    var name = val(input, 'customerName');
    var merchant = val(input, 'merchantName');
    var product = val(input, 'productDescription');
    var amount = money(input);
    var chargeDate = val(input, 'chargeDate');

    if (!name) gaps.push('Customer name missing.');
    if (!product) gaps.push('Product description missing.');
    if (!amount) gaps.push('Disputed amount missing.');
    if (!chargeDate) gaps.push('Purchase date missing.');

    var parts = [];
    var s1 = '';
    s1 += name ? name : gap('customer name');
    s1 += ' purchased ';
    s1 += product ? truncate(product, 160) : gap('product/service description');
    s1 += ' from ' + (merchant ? merchant : gap('your store name'));
    s1 += ' on ' + (chargeDate ? chargeDate : gap('purchase date'));
    s1 += amount ? ' for ' + amount + '.' : ' for ' + gap('disputed amount') + '.';
    parts.push(s1);

    if (cat === 'fraudulent') {
      var auth = [];
      if (val(input, 'avsResult')) auth.push('the billing address check (AVS) returned: ' + val(input, 'avsResult'));
      if (val(input, 'cvcResult')) auth.push('the card security code (CVV) check returned: ' + val(input, 'cvcResult'));
      if (val(input, 'purchaseIp')) auth.push('the purchase was made from IP address ' + val(input, 'purchaseIp'));
      if (auth.length) parts.push('Authorisation evidence for this transaction: ' + auth.join('; ') + '.');
      else gaps.push('No authorisation evidence (AVS/CVV/IP) provided - this is usually decisive in fraud disputes.');
      if (val(input, 'priorTxns')) parts.push('The same customer has prior undisputed orders with us: ' + truncate(val(input, 'priorTxns'), 220));
      else if (isVisaLike(input)) gaps.push('No prior-transaction history provided; for eligible Visa fraud disputes, CE 3.0 history materially improves the response.');
    }
    if (cat === 'product_not_received') {
      if (val(input, 'deliveryDate')) {
        var d = 'My carrier records show the order as delivered on ' + val(input, 'deliveryDate');
        if (val(input, 'carrier')) d += ' per ' + val(input, 'carrier');
        if (val(input, 'trackingNumber')) d += ' (tracking ' + val(input, 'trackingNumber') + ')';
        if (has(input, 'delivery')) {
          parts.push(d + '. The delivery confirmation is attached separately.');
        } else {
          parts.push(d + '. ' + gap('attach the carrier delivery confirmation - it must show the FULL delivery address, not just city/postcode'));
          gaps.push('Delivery date entered but the delivery proof is not marked as available.');
        }
      } else {
        gaps.push('No delivery confirmation provided - without carrier proof this category is very hard to answer.');
      }
    }
    if (cat === 'product_unacceptable') {
      if (has(input, 'listing')) {
        parts.push('The product was presented at purchase as described in the product listing from that time, which I attach separately.');
      } else {
        gaps.push('Product listing as shown at purchase not marked as available - without it there is little to answer a not-as-described claim with.');
      }
      if (!val(input, 'commsSummary')) gaps.push('No customer-communication excerpt provided; showing you offered help usually matters here.');
    }
    if (cat === 'credit_not_processed' || cat === 'subscription_canceled') {
      if (val(input, 'refundIssued') && val(input, 'refundIssued') !== 'no') {
        if (has(input, 'refund_proof')) {
          parts.push('A ' + (val(input, 'refundIssued') === 'yes - partial' ? 'partial ' : '') + 'refund was issued' + (val(input, 'refundDate') ? ' on ' + val(input, 'refundDate') : '') + '; I attach the refund record separately.');
        } else {
          parts.push('A ' + (val(input, 'refundIssued') === 'yes - partial' ? 'partial ' : '') + 'refund was issued' + (val(input, 'refundDate') ? ' on ' + val(input, 'refundDate') : '') + '.');
          gaps.push('Refund stated as issued but the refund record is not marked as available - attach the processor/bank record or remove the claim.');
        }
      }
      if (val(input, 'policyExcerpt')) parts.push('Our relevant policy, agreed to at checkout, states: "' + truncate(val(input, 'policyExcerpt'), 240) + '"');
      else gaps.push('No policy excerpt provided; for cancellation/refund disputes the agreed terms are central.');
      if (cat === 'subscription_canceled' && !val(input, 'cancellationDate')) {
        if (has(input, 'cancel_logs')) {
          parts.push('My system records show no cancellation request was submitted before this charge; I attach the system log separately.');
        } else {
          gaps.push('No cancellation date entered and no cancellation-request log marked as available - check your system records and attach the log before claiming no request was made.');
        }
      }
    }
    if (cat === 'duplicate') {
      if (has(input, 'receipts')) {
        parts.push('I attach the itemised receipts for the charges separately.');
      } else {
        gaps.push('Itemised receipts not marked as available - a duplicate-charge answer needs them.');
      }
      /* The explanation is the seller's own: no default assertion about which
         case applies (separate charges, authorisation hold, or seller error). */
      if (val(input, 'duplicateExplanation')) {
        parts.push(truncate(val(input, 'duplicateExplanation'), 240));
      } else {
        gaps.push('No duplicate-charge explanation entered - use the Resolution section to explain the two charges in your own words (separate valid charges, one entry only a temporary authorisation hold, or your own error to refund).');
      }
    }
    if (cat === 'general') {
      if (val(input, 'amount') && has(input, 'receipt')) {
        parts.push('The amount charged matches the itemised receipt presented to the customer at checkout, which I attach separately.');
      } else if (val(input, 'amount')) {
        gaps.push('Amount entered but the itemised receipt is not marked as available - attach it before claiming the charge matches it.');
      }
    }
    if (val(input, 'commsSummary')) parts.push('Relevant customer communications: ' + truncate(val(input, 'commsSummary'), 260));
    if (val(input, 'extraNotes')) parts.push(truncate(val(input, 'extraNotes'), 260));

    return { paragraphs: parts, gaps: gaps, timeline: buildTimeline(input) };
  }

  function isVisaLike(input) {
    var rc = (val(input, 'reasonCode') || '').toLowerCase();
    var pr = (val(input, 'processor') || '').toLowerCase();
    return rc.indexOf('10.') === 0 || rc.indexOf('visa') >= 0 || pr.indexOf('visa') >= 0;
  }

  /* True only when the seller marked that evidence item as available. Assertions
     about attached records are gated on this - the tool never claims a record
     exists or is attached unless the seller said they have it. */
  function has(input, evId) {
    var a = input && input.evidenceAnswers && input.evidenceAnswers[evId];
    return !!(a && a.status === 'have');
  }

  function truncate(s, n) {
    s = String(s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  /* Checklist result per evidence item, grouped by upload type for one-file-per-type assembly. */
  function buildChecklist(input) {
    var cat = CATEGORIES[input.category];
    if (!cat) return { items: [], byType: [], gaps: ['Select a dispute category to get its evidence checklist.'], haveCount: 0, missingCount: 0 };
    var answers = (input && input.evidenceAnswers) || {};
    var items = cat.evidence.map(function (ev) {
      var a = answers[ev.id] || {};
      var status = a.status === 'have' ? 'have' : a.status === 'na' ? 'na' : 'missing';
      return { id: ev.id, type: ev.type, typeLabel: UPLOAD_TYPES[ev.type], label: ev.label, hint: ev.hint, status: status, note: isFilled(a.note) ? String(a.note).trim() : null };
    });
    var byType = [];
    Object.keys(UPLOAD_TYPES).forEach(function (t) {
      var group = items.filter(function (i) { return i.type === t; });
      if (group.length) byType.push({ type: t, label: UPLOAD_TYPES[t], items: group });
    });
    var gaps = items.filter(function (i) { return i.status === 'missing'; })
      .map(function (i) { return i.label + ' - not provided.'; });
    BACKGROUND_EVIDENCE.forEach(function (b) {
      if (!val(input, b.field)) gaps.push(b.label + ' (background evidence) not provided.');
    });
    return {
      items: items,
      byType: byType,
      gaps: gaps,
      haveCount: items.filter(function (i) { return i.status === 'have'; }).length,
      missingCount: items.filter(function (i) { return i.status === 'missing'; }).length
    };
  }

  /* Calculator: only the seller's own numbers. No odds, no estimates, no predicted recovery. */
  function worthFighting(o) {
    o = o || {};
    var amount = num(o.amount), fee = num(o.fee), hours = num(o.hours), rate = num(o.hourlyRate);
    if ([amount, fee, hours, rate].some(function (n) { return n == null || isNaN(n) || n < 0; })) {
      return { error: 'Enter non-negative numbers for amount, fee, hours and hourly value.' };
    }
    if (amount <= 0) return { error: 'Disputed amount must be above zero.' };
    var cost = fee + hours * rate;
    var breakEvenPct = Math.round((cost / amount) * 1000) / 10;
    var result = {
      cost: Math.round(cost * 100) / 100,
      amount: amount,
      breakEvenPct: breakEvenPct,
      breakEvenNote: 'Fighting costs about ' + fmtMoney(cost) + ' (fee + your time). To break even on average, you would need to win at least ' + breakEvenPct + '% of the time. Only you can judge how strong your evidence is - no tool can predict the outcome of your dispute.'
    };
    return result;
  }

  function fmtMoney(n) {
    return (Math.round(n * 100) / 100).toString();
  }

  function num(v) {
    if (v == null || v === '') return null;
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? null : n;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Full pack model used by both the on-page preview and the print view. */
  function buildPack(input) {
    input = input || {};
    var narr = buildNarrative(input);
    var check = buildChecklist(input);
    var cat = CATEGORIES[input.category] || null;
    var allGaps = narr.gaps.concat(check.gaps);
    /* Never certify readiness: even a gap-free pack is an unverified organiser,
       and an all-N/A checklist (nothing actually available) is never ready. */
    var ready = allGaps.length === 0 && check.haveCount > 0;
    return {
      generatedAt: (input.now || new Date().toISOString().slice(0, 10)),
      readyToSubmit: ready,
      statusLine: allGaps.length > 0
        ? 'NOT READY TO SUBMIT - ' + allGaps.length + ' gap' + (allGaps.length === 1 ? '' : 's') + ' to resolve below.'
        : check.haveCount === 0
          ? 'NOT READY TO SUBMIT - every item is marked not applicable, which means no evidence is attached at all.'
          : 'All items marked. This is still only an organiser: evidence is NOT verified, nothing is attached by this tool, and this does not certify the response meets network or processor rules. Review everything yourself before submitting.',
      merchant: val(input, 'merchantName'),
      orderId: val(input, 'orderId'),
      category: cat ? cat.label : null,
      reasonCode: val(input, 'reasonCode'),
      processor: val(input, 'processor'),
      amount: money(input),
      paragraphs: narr.paragraphs,
      timeline: narr.timeline,
      narrativeGaps: narr.gaps,
      checklist: check,
      background: BACKGROUND_EVIDENCE.map(function (b) { return { label: b.label, value: val(input, b.field) }; }),
      submissionRules: SUBMISSION_RULES.slice(),
      allGaps: allGaps
    };
  }

  return {
    UPLOAD_TYPES: UPLOAD_TYPES,
    CATEGORIES: CATEGORIES,
    CATEGORY_ORDER: CATEGORY_ORDER,
    BACKGROUND_EVIDENCE: BACKGROUND_EVIDENCE,
    SUBMISSION_RULES: SUBMISSION_RULES,
    FIELDS: FIELDS,
    GAP_PREFIX: GAP_PREFIX,
    buildNarrative: buildNarrative,
    buildTimeline: buildTimeline,
    buildChecklist: buildChecklist,
    buildPack: buildPack,
    worthFighting: worthFighting,
    escapeHtml: escapeHtml
  };
}));
