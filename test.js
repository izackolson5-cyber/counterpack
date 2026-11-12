const L = require('./packlogic.js');
let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; } else { fail++; console.log('FAIL: ' + name); } }

// 1. Empty input: gaps flagged, nothing invented, not ready
let p = L.buildPack({});
ok(p.readyToSubmit === false, 'empty pack not ready');
ok(p.allGaps.length > 0, 'empty pack has gaps');
ok(p.statusLine.indexOf('NOT READY') === 0, 'empty status says NOT READY');
ok(p.paragraphs.join(' ').indexOf('[MISSING') >= 0, 'empty narrative has gap markers');

// 2. No fabricated dates: timeline only from provided dates
let t = L.buildTimeline({ chargeDate: '', shipDate: null, deliveryDate: '2026-01-05' });
ok(t.length === 1 && t[0].date === '2026-01-05', 'timeline uses only provided dates');
ok(L.buildTimeline({}).length === 0, 'no dates -> empty timeline');

// 3. Timeline sorts chronologically
t = L.buildTimeline({ deliveryDate: '2026-01-05', chargeDate: '2026-01-01', shipDate: '2026-01-03' });
ok(t.map(e => e.date).join(',') === '2026-01-01,2026-01-03,2026-01-05', 'timeline sorted');

// 4. Full fraud pack with all evidence have -> ready, narrative contains only provided facts
const full = {
  category: 'fraudulent', reasonCode: '10.4', processor: 'Stripe',
  merchantName: 'Kiri Crafts', orderId: '#9', chargeDate: '2026-10-01', amount: '80', currency: 'NZD',
  productDescription: 'Wool scarf', customerName: 'Sam Buyer', customerEmail: 'sam@x.com',
  billingAddress: '1 Rd', purchaseIp: '1.2.3.4', avsResult: 'match', cvcResult: 'match',
  priorTxns: 'order #1 Jan', receiptNote: 'sent',
  evidenceAnswers: { avs_cvc: {status:'have'}, ip_device: {status:'have'}, history: {status:'have'}, auth: {status:'na'}, comms: {status:'have'}, terms: {status:'have'} }
};
p = L.buildPack(full);
ok(p.readyToSubmit === true, 'complete fraud pack ready, got gaps: ' + p.allGaps.join(' | '));
const txt = p.paragraphs.join(' ');
ok(txt.indexOf('Sam Buyer') >= 0 && txt.indexOf('Wool scarf') >= 0 && txt.indexOf('NZD 80') >= 0, 'narrative uses provided facts');
ok(txt.indexOf('1.2.3.4') >= 0, 'narrative includes IP');
ok(txt.indexOf('We believe this qualifies') === -1 && txt.indexOf('Compelling Evidence 3.0') === -1, 'narrative never concludes CE3.0 eligibility');
ok(txt.indexOf('[MISSING') === -1, 'complete narrative has no gap markers');

// 5. Fraud pack missing auth evidence -> gap flagged
delete full.avsResult; delete full.cvcResult; delete full.purchaseIp;
let n = L.buildNarrative(full);
ok(n.gaps.some(g => g.indexOf('authorisation') >= 0), 'fraud without auth evidence flagged');

// 6. product_not_received without delivery proof -> gap
n = L.buildNarrative({ category: 'product_not_received', customerName: 'X', productDescription: 'Y', amount: '10', chargeDate: '2026-01-01' });
ok(n.gaps.some(g => g.indexOf('delivery confirmation') >= 0), 'pnr without delivery flagged');

// 7. subscription without cancellation date AND without log marked have -> no assertion, gap instead
n = L.buildNarrative({ category: 'subscription_canceled', customerName: 'X', productDescription: 'Y', amount: '10', chargeDate: '2026-01-01', policyExcerpt: 'cancel anytime' });
ok(n.paragraphs.join(' ').indexOf('no cancellation request') === -1, 'sub canceled without log does NOT assert records');
ok(n.gaps.some(g => g.indexOf('cancellation-request log') >= 0), 'sub canceled without log flags the gap');
// 7b. subscription with log marked have -> assertion allowed
n = L.buildNarrative({ category: 'subscription_canceled', customerName: 'X', productDescription: 'Y', amount: '10', chargeDate: '2026-01-01', policyExcerpt: 'p', evidenceAnswers: { cancel_logs: {status:'have'} } });
ok(n.paragraphs.join(' ').indexOf('no cancellation request') >= 0, 'sub canceled with log have asserts records');

// 8. Calculator: no odds output without user estimate; break-even math
let c = L.worthFighting({ amount: '100', fee: '15', hours: '2', hourlyRate: '25' });
ok(!c.error, 'calc ok');
ok(Math.abs(c.cost - 65) < 0.001, 'calc cost = 65, got ' + c.cost);
ok(Math.abs(c.breakEvenPct - 65) < 0.01, 'break-even 65%, got ' + c.breakEvenPct);
ok(c.ownEstimatePct === undefined && !c.expectedAtOwnEstimate, 'no estimate -> no EV');
ok(JSON.stringify(c).indexOf('60%') === -1 && JSON.stringify(c).indexOf('Stripe') === -1, 'no Stripe odds in calc output');
c = L.worthFighting({ amount: '100', fee: '15', hours: '2', hourlyRate: '25', ownEstimatePct: '50' });
ok(c.ownEstimatePct === undefined && c.expectedAtOwnEstimate === undefined && !c.ownEstimateNote, 'calculator ignores chance estimates entirely');
ok(c.breakEvenNote.indexOf('no tool can predict') >= 0, 'break-even note disclaims prediction');
c = L.worthFighting({ amount: 'abc', fee: '15', hours: '2', hourlyRate: '25' });
ok(!!c.error, 'garbage amount errors');
c = L.worthFighting({ amount: '0', fee: '0', hours: '0', hourlyRate: '0' });
ok(!!c.error, 'zero amount errors');
c = L.worthFighting({ amount: '50', fee: '-5', hours: '2', hourlyRate: '25' });
ok(!!c.error, 'negative fee errors');
c = L.worthFighting({ amount: '50', fee: '200', hours: '0', hourlyRate: '0' });
ok(c.breakEvenPct > 100, 'break-even can exceed 100%, got ' + c.breakEvenPct);

// 8b. No adjudication or address inference in narratives
n = L.buildNarrative({ category: 'product_not_received', customerName: 'X', productDescription: 'Y', amount: '10', chargeDate: '2026-01-01', deliveryDate: '2026-01-05', carrier: 'UPS', trackingNumber: 'T1', shippingAddress: '1 Rd' });
const pnr = n.paragraphs.join(' ');
ok(pnr.indexOf('not correct') === -1 && pnr.indexOf('claim') === -1, 'pnr narrative does not adjudicate the claim');
ok(pnr.indexOf('address the customer provided') === -1, 'pnr narrative does not infer address match');
ok(pnr.indexOf('seller') >= 0 || pnr.indexOf('My carrier records') >= 0, 'pnr narrative is seller-reported framing');
ok(pnr.indexOf('[MISSING') >= 0, 'pnr narrative demands full-address check');
// 8c. Subscription no-cancellation assertion never appears without the log marked have
n = L.buildNarrative({ category: 'subscription_canceled', customerName: 'X', productDescription: 'Y', amount: '10', chargeDate: '2026-01-01', policyExcerpt: 'p' });
ok(n.paragraphs.join(' ').indexOf('attach the system log') === -1, 'sub canceled no attach claim without log');
// 8d. General category: receipt assertion gated on receipt marked have
n = L.buildNarrative({ category: 'general', customerName: 'X', productDescription: 'Y', amount: '10', chargeDate: '2026-01-01' });
ok(n.paragraphs.join(' ').indexOf('matches the itemised receipt') === -1, 'general no receipt assertion when not have');
ok(n.gaps.some(g => g.indexOf('itemised receipt') >= 0), 'general flags missing receipt');
n = L.buildNarrative({ category: 'general', customerName: 'X', productDescription: 'Y', amount: '10', chargeDate: '2026-01-01', evidenceAnswers: { receipt: {status:'have'} } });
ok(n.paragraphs.join(' ').indexOf('I attach the itemised receipt') >= 0, 'general receipt assertion gated on have without amount-match inference');
// 8e. PNR: delivery assertion gated on delivery proof marked have
n = L.buildNarrative({ category: 'product_not_received', customerName: 'X', productDescription: 'Y', amount: '10', chargeDate: '2026-01-01', deliveryDate: '2026-01-05', carrier: 'UPS', trackingNumber: 'T1', evidenceAnswers: { delivery: {status:'have'} } });
ok(n.paragraphs.join(' ').indexOf('delivery confirmation is attached') >= 0, 'pnr asserts attach only when have');
// 8f. product_unacceptable listing assertion gated
n = L.buildNarrative({ category: 'product_unacceptable', customerName: 'X', productDescription: 'Y', amount: '10', chargeDate: '2026-01-01' });
ok(n.paragraphs.join(' ').indexOf('product listing') === -1, 'unacceptable no listing assertion when not have');
// 8g. refund assertion: stated without proof -> claim kept but gap, no attach claim
n = L.buildNarrative({ category: 'credit_not_processed', customerName: 'X', productDescription: 'Y', amount: '10', chargeDate: '2026-01-01', policyExcerpt: 'p', refundIssued: 'yes' });
ok(n.paragraphs.join(' ').indexOf('attach the refund record separately') === -1, 'refund no attach claim without proof');
ok(n.gaps.some(g => g.indexOf('refund record') >= 0), 'refund without proof flags gap');

// 9. XSS escaping
ok(L.escapeHtml('<img src=x onerror=alert(1)>') === '&lt;img src=x onerror=alert(1)&gt;', 'escapeHtml tags');
ok(L.escapeHtml("a'b\"c&d").indexOf('&') === 1, 'escapeHtml quotes/amp');

// 10. All 7 categories produce checklists with upload-type grouping
L.CATEGORY_ORDER.forEach(k => {
  const cl = L.buildChecklist({ category: k, evidenceAnswers: {} });
  ok(cl.items.length >= 4, k + ' has >=4 evidence items');
  ok(cl.byType.length > 0 && cl.byType.every(g => g.label && g.items.length), k + ' groups by upload type');
  ok(cl.items.every(i => i.status === 'missing'), k + ' defaults all missing');
  ok(cl.gaps.length >= cl.items.length, k + ' gaps cover items + background');
});

// 11. Unknown category handled
const cl = L.buildChecklist({ category: 'nope' });
ok(cl.items.length === 0 && cl.gaps.length === 1, 'unknown category safe');

// 12. Gap prefix is unmistakable
ok(L.GAP_PREFIX.indexOf('MISSING') >= 0 && L.GAP_PREFIX.indexOf('BEFORE SUBMITTING') >= 0, 'gap prefix unmistakable');

// 13. No default dates anywhere in pack when none provided
p = L.buildPack({ category: 'duplicate' });
ok(p.timeline.length === 0, 'no default timeline dates');
ok(p.generatedAt && /^\d{4}-\d{2}-\d{2}$/.test(p.generatedAt), 'generatedAt is a real date string');

// 14. All-N/A checklist is never ready and says so
const allNa = {
  category: 'fraudulent', reasonCode: '10.4', processor: 'Stripe',
  merchantName: 'Kiri Crafts', orderId: '#9', chargeDate: '2026-10-01', amount: '80', currency: 'NZD',
  productDescription: 'Wool scarf', customerName: 'Sam Buyer', customerEmail: 'sam@x.com',
  billingAddress: '1 Rd', purchaseIp: '1.2.3.4', avsResult: 'match', cvcResult: 'match',
  priorTxns: 'order #1 Jan', receiptNote: 'sent',
  evidenceAnswers: { avs_cvc: {status:'na'}, ip_device: {status:'na'}, history: {status:'na'}, auth: {status:'na'}, comms: {status:'na'}, terms: {status:'na'} }
};
p = L.buildPack(allNa);
ok(p.readyToSubmit === false, 'all-N/A pack not ready');
ok(p.statusLine.indexOf('NOT READY') === 0 && p.statusLine.indexOf('not applicable') >= 0, 'all-N/A status explains why');

// 15. Complete pack status never certifies: organiser / not verified / no certification
const full2 = {
  category: 'fraudulent', reasonCode: '10.4', processor: 'Stripe',
  merchantName: 'Kiri Crafts', orderId: '#9', chargeDate: '2026-10-01', amount: '80', currency: 'NZD',
  productDescription: 'Wool scarf', customerName: 'Sam Buyer', customerEmail: 'sam@x.com',
  billingAddress: '1 Rd', purchaseIp: '1.2.3.4', avsResult: 'match', cvcResult: 'match',
  priorTxns: 'order #1 Jan', receiptNote: 'sent',
  evidenceAnswers: { avs_cvc: {status:'have'}, ip_device: {status:'have'}, history: {status:'have'}, auth: {status:'na'}, comms: {status:'have'}, terms: {status:'have'} }
};
p = L.buildPack(full2);
ok(p.readyToSubmit === true, 'complete pack ready flag (haveCount>0, no gaps)');
ok(p.statusLine.indexOf('organiser') >= 0 && p.statusLine.indexOf('NOT verified') >= 0 && p.statusLine.indexOf('does not certify') >= 0, 'complete status never certifies');
ok(p.statusLine.indexOf('READY TO SUBMIT') === -1 || p.statusLine.indexOf('NOT READY') === 0, 'status never says plain READY TO SUBMIT');

// 16. Duplicate explanation is field-driven: missing -> gap + not ready; filled -> clears, ready reachable
const dupBase = { category: 'duplicate', merchantName: 'Kiri Crafts', customerName: 'X', productDescription: 'Y', amount: '10', currency: 'NZD', chargeDate: '2026-01-01',
  customerEmail: 'x@x.com', billingAddress: '1 Rd', purchaseIp: '1.1.1.1', receiptNote: 'sent',
  evidenceAnswers: { receipts: {status:'have'}, refund_proof: {status:'na'}, logs: {status:'na'}, other_payment: {status:'na'}, comms: {status:'na'} } };
p = L.buildPack(dupBase);
ok(p.allGaps.some(g => g.indexOf('No duplicate-charge explanation') >= 0), 'duplicate without explanation flags gap');
ok(p.readyToSubmit === false, 'duplicate without explanation NOT ready');
ok(p.paragraphs.join(' ').indexOf('separate valid charges') === -1, 'no default assertion about which case applies');
const dupFull = Object.assign({}, dupBase, { duplicateExplanation: 'Two separate valid orders #1041 and #1042 for different items.' });
p = L.buildPack(dupFull);
ok(!p.allGaps.some(g => g.indexOf('duplicate-charge explanation') >= 0), 'filled explanation clears the gap, remaining gaps: ' + p.allGaps.join(' | '));
ok(p.paragraphs.join(' ').indexOf('Two separate valid orders #1041 and #1042') >= 0, 'narrative uses only the supplied explanation');
ok(p.paragraphs.join(' ').indexOf('[MISSING') === -1, 'complete duplicate narrative has no MISSING markers');
ok(p.readyToSubmit === true, 'complete duplicate pack reaches review state, gaps: ' + p.allGaps.join(' | '));
ok(p.statusLine.indexOf('organiser') >= 0, 'complete duplicate still never certifies');
// 16b. duplicateExplanation ignored for other categories (no stray assertions after switching)
p = L.buildPack({ category: 'fraudulent', customerName: 'X', productDescription: 'Y', amount: '10', chargeDate: '2026-01-01', duplicateExplanation: 'Two separate valid orders' });
ok(p.paragraphs.join(' ').indexOf('Two separate valid orders') === -1, 'duplicate explanation not asserted in other categories');
ok(!p.allGaps.some(g => g.indexOf('duplicate-charge explanation') >= 0), 'no duplicate-explanation gap in other categories');



// --- Regression: QA 13 Nov 2026 (shared packlogic defects) ---
// Calculator must reject non-plain numbers instead of corrupting them
c = L.worthFighting({ amount: '1e2', fee: '15', hours: '2', hourlyRate: '25' });
ok(c.error, 'calculator rejects 1e2 instead of corrupting it to 12');
c = L.worthFighting({ amount: '1,200.50', fee: '15', hours: '2', hourlyRate: '25' });
ok(!c.error && c.amount === 1200.5, 'calculator accepts comma thousands');
c = L.worthFighting({ amount: '$49.00', fee: '0', hours: '0', hourlyRate: '0' });
ok(!c.error && c.amount === 49, 'calculator accepts leading currency sign');
c = L.worthFighting({ amount: '12abc', fee: '0', hours: '0', hourlyRate: '0' });
ok(c.error, 'calculator rejects trailing junk instead of silently parsing 12');

// Prepared date must be the device-local date, never the UTC date
p = L.buildPack({ now: new Date(2026, 0, 15, 0, 30) });  // 00:30 local on 15 Jan, any zone
ok(p.generatedAt === '2026-01-15', 'generatedAt uses device-local date at 00:30 local, got ' + p.generatedAt);
p = L.buildPack({ now: new Date(2026, 0, 15, 23, 30) });
ok(p.generatedAt === '2026-01-15', 'generatedAt uses device-local date at 23:30 local, got ' + p.generatedAt);
p = L.buildPack({ now: '2026-01-15' });
ok(p.generatedAt === '2026-01-15', 'string now override still honoured');

// N/A on a normally-needed item: narrative and checklist must tell the SAME
// story, and the gap must survive (no silent removal of a necessary fact)
let base = { category: 'duplicate', customerName: 'A', productDescription: 'X', amount: '50', currency: 'NZD', chargeDate: '2026-10-01', evidenceAnswers: {} };
p = L.buildPack(base);
ok(p.allGaps.some(g => g.indexOf('Itemised receipts not marked as available') === 0), 'duplicate receipts missing keeps original phrasing');
let naDup = Object.assign({}, base, { evidenceAnswers: { receipts: { status: 'na' } } });
p = L.buildPack(naDup);
ok(p.narrativeGaps.some(g => g.indexOf('Itemised receipts marked not applicable') === 0), 'narrative acknowledges the N/A mark on receipts');
ok(p.checklist.gaps.some(g => g.indexOf('Itemised receipts marked not applicable') === 0), 'checklist lists the same N/A gap');
ok(p.narrativeGaps.filter(g => g.indexOf('Itemised receipts marked not applicable') === 0).length === 1
   && p.checklist.gaps.filter(g => g.indexOf('Itemised receipts marked not applicable') === 0).length === 1
   && p.allGaps.filter(g => g.indexOf('Itemised receipts marked not applicable') === 0).length === 1,
   'N/A gap appears exactly once in each surface (deduped in allGaps)');
ok(p.readyToSubmit === false, 'required item marked N/A still not ready - gate not weakened');
let naPnr = { category: 'product_not_received', customerName: 'A', productDescription: 'X', amount: '50', currency: 'NZD', chargeDate: '2026-10-01', deliveryDate: '2026-10-05', evidenceAnswers: { delivery: { status: 'na' } } };
p = L.buildPack(naPnr);
ok(p.narrativeGaps.some(g => g.indexOf('Proof of shipment and delivery marked not applicable') === 0), 'pnr N/A delivery acknowledged, not falsely "not marked as available"');
ok(p.checklist.gaps.some(g => g.indexOf('Proof of shipment and delivery marked not applicable') === 0), 'pnr checklist mirrors the N/A gap');
let naRefund = { category: 'credit_not_processed', customerName: 'A', productDescription: 'X', amount: '50', currency: 'NZD', chargeDate: '2026-10-01', refundIssued: 'yes - full', policyExcerpt: 'refunds in 14 days', evidenceAnswers: { refund_proof: { status: 'na' } } };
p = L.buildPack(naRefund);
ok(p.narrativeGaps.some(g => g.indexOf('Refund record marked not applicable') === 0) && p.checklist.gaps.some(g => g.indexOf('Refund record marked not applicable') === 0), 'conditional refund-proof N/A consistent across surfaces');
let noRefund = Object.assign({}, naRefund, { refundIssued: 'no' });
p = L.buildPack(noRefund);
ok(!p.allGaps.some(g => g.indexOf('Refund record marked not applicable') === 0), 'no refund claimed -> no refund-proof N/A nag (condition respected)');



// Shared factuality: disputed amount is not purchase total; address is not AVS.
p = L.buildPack({category:'general',customerName:'Partial Buyer',merchantName:'Shop',productDescription:'Order item',amount:'15',currency:'NZD',chargeDate:'2026-10-01',billingAddress:'1 Street',avsResult:'no match',evidenceAnswers:{receipt:{status:'have'}}});
ok(p.paragraphs.join(' ').indexOf('The disputed amount is NZD 15.') >= 0, 'narrative labels disputed amount explicitly');
ok(!p.paragraphs.join(' ').includes(' for NZD 15') && !p.paragraphs.join(' ').includes('amount charged matches'), 'narrative never asserts partial dispute equals purchase total/receipt');
ok(p.timeline[0].text === 'Customer placed the order.', 'purchase timeline makes no total claim from dispute amount');
ok(p.background.some(b => b.label === 'Billing address' && b.value === '1 Street'), 'address label never claims AVS verification');
ok(p.background.some(b => /AVS/.test(b.label) && b.value === 'no match'), 'AVS result stays a separate supplied fact');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
