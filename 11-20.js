// BDMS Labs 11-20: units, inventory, requesters, requests. Loaded before app.js; uses its helpers at run time.
const staffList = n => run(db.from('users').select('full_name, roles!inner(name)').eq('is_active', true).in('roles.name', n));
const staffOpts = s => `<option value="">Select staff</option>${s.map(x => `<option>${esc(x.full_name)}</option>`).join('')}`;
const head = a => `<thead><tr>${a.map(h => `<th>${h}</th>`).join('')}</tr></thead>`;

// Labs 13, 15, 16: blood units, workflow, transactions
async function units() {
  const [dn, us, tx, staff] = await Promise.all([
    run(db.from('donations').select('id, donation_number, donation_date, blood_types(code), donation_screening!inner(status), blood_units(id)').eq('donation_screening.status', 'Approved')),
    run(db.from('blood_units').select('*, blood_types(code)').order('id', { ascending: false })),a
    run(db.from('inventory_transactions').select('*, blood_units(unit_number)').order('id', { ascending: false }).limit(30)),
    staffList(['Administrator', 'Inventory Officer'])]);
  const ready = dn.filter(d => !one(d.blood_units));
  $('#view').innerHTML = `<section class="card"><h2>Create blood unit from an approved donation</h2><form id="uf" class="grid">
  <label>Donation<select name="donation_id" required><option value="">${ready.length ? 'Select donation' : 'No approved donations waiting'}</option>${ready.map(d => `<option value="${d.id}">${esc(d.donation_number)} - ${esc(d.blood_types?.code)} - ${esc(d.donation_date)}</option>`).join('')}</select></label>
  <label>Component<select name="component_type">${['Whole Blood', 'Red Cells', 'Plasma', 'Platelets'].map(c => `<option>${c}</option>`).join('')}</select></label>
  <label>Storage location<input name="storage_location" required placeholder="e.g. Fridge A, Shelf 2"></label>
  <label>Staff member<select name="handled_by" required>${staffOpts(staff)}</select></label>
  <label class="w">Remarks<input name="remarks"></label><button class="p">Create unit</button></form></section>
  <section class="card"><h2>Blood units</h2><table>${head(['Unit no.', 'Type', 'Component', 'Collected', 'Expires', 'Location', 'Status', ''])}<tbody id="urows">
  ${us.map(u => `<tr><td>${esc(u.unit_number)}</td><td>${esc(u.blood_types.code)}</td><td>${esc(u.component_type)}</td><td>${esc(u.collection_date)}</td><td>${esc(u.expiration_date)}</td><td>${esc(u.storage_location)}</td><td>${tag(u.inventory_status)}</td>
  <td class="act">${u.inventory_status === 'Available' ? `<button data-a="Expired" data-u="${u.id}">Expire</button><button data-a="Discarded" data-u="${u.id}">Discard</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8">No blood units yet.</td></tr>'}</tbody></table></section>
  <section class="card"><h2>Inventory transactions (latest 30)</h2><table>${head(['Date/time', 'Unit', 'Type', 'Qty', 'User', 'Reference', 'Remarks'])}<tbody>
  ${tx.map(t => `<tr><td>${esc(new Date(t.created_at).toLocaleString())}</td><td>${esc(t.blood_units.unit_number)}</td><td>${tag(t.transaction_type)}</td><td>${t.quantity}</td><td>${esc(t.performed_by || 'System')}</td><td>${esc(t.reference_number)}</td><td>${esc(t.remarks || '')}</td></tr>`).join('') || '<tr><td colspan="7">No transactions yet.</td></tr>'}</tbody></table></section>`;
  $('#uf').onsubmit = safe(async e => { e.preventDefault(); const r = await run(db.from('blood_units').insert(form(e.target)).select('unit_number').single()); toast(`Unit ${r.unit_number} created and added to inventory.`); route(); });
  $('#urows').onclick = e => { const b = e.target.closest('button'); if (b) unitAction(us.find(u => String(u.id) === b.dataset.u), b.dataset.a); };
}

async function unitAction(u, status) {
  const staff = await staffList(['Administrator', 'Inventory Officer']);
  const m = modal(`<form><h3>${status}: ${esc(u.unit_number)}</h3><label>Staff member *<select name="handled_by" required>${staffOpts(staff)}</select></label>
  <label>Reason *<input name="remarks" required></label><div class="act"><button class="p">Confirm ${status.toLowerCase()}</button><button type="button" data-x>Cancel</button></div></form>`);
  $('form', m).onsubmit = safe(async e => { e.preventDefault(); await run(db.from('blood_units').update({ inventory_status: status, ...form(e.target) }).eq('id', u.id)); m.close(); toast(`Unit marked ${status.toLowerCase()}.`); route(); });
}

// Labs 14, 17, 18: inventory, stock monitoring, alerts (inventory is calculated live from blood units)
async function inventory() {
  const us = await run(db.from('blood_units').select('id, unit_number, blood_type_id, component_type, storage_location, inventory_status, expiration_date, blood_types(code)'));
  const soon = new Date(Date.now() + 7 * 864e5).toLocaleDateString('en-CA');
  const n = f => us.filter(f).length, av = t => n(u => u.blood_type_id === t.id && u.inventory_status === 'Available');
  $('#view').innerHTML = `<section class="card"><h2>Blood stock</h2><label style="max-width:240px">Low-stock level (available units)<input id="lo" type="number" min="1" value="5"></label>
  <table>${head(['Blood type', 'Available', 'Reserved', 'Expired', 'Total', 'Level'])}<tbody id="grid"></tbody></table></section>
  <section class="card"><h2>Alerts</h2><div id="alerts"></div></section>
  <section class="card"><h2>Inventory by component and location</h2><table>${head(['Blood type', 'Component', 'Location', 'Available', 'Reserved', 'Released', 'Expired', 'Status'])}<tbody id="det"></tbody></table></section>`;
  const paint = () => {
    const lo = +$('#lo').value || 1, lows = types.filter(t => av(t) < lo).map(t => t.code);
    $('#grid').innerHTML = types.map(t => `<tr><td>${esc(t.code)}</td><td>${av(t)}</td><td>${n(u => u.blood_type_id === t.id && u.inventory_status === 'Reserved')}</td><td>${n(u => u.blood_type_id === t.id && u.inventory_status === 'Expired')}</td><td>${n(u => u.blood_type_id === t.id)}</td><td>${av(t) < lo ? tag('Rejected').replace('Rejected', 'Low') : tag('Active').replace('Active', 'OK')}</td></tr>`).join('');
    const live = us.filter(u => u.inventory_status === 'Available'), exp = live.filter(u => u.expiration_date < today), near = live.filter(u => u.expiration_date >= today && u.expiration_date <= soon);
    $('#alerts').innerHTML = `<ul><li>Low stock: <b>${esc(lows.join(', ') || 'none')}</b></li>
    <li>Expiring within 7 days: <b>${esc(near.map(u => `${u.unit_number} (${u.expiration_date})`).join(', ') || 'none')}</b></li>
    <li>Past expiry but still Available: <b>${exp.length}</b> ${exp.length ? '<button id="fx">Mark as expired</button>' : ''}</li>
    <li>Reserved: <b>${n(u => u.inventory_status === 'Reserved')}</b> | Unavailable (Expired or Discarded): <b>${n(u => ['Expired', 'Discarded'].includes(u.inventory_status))}</b></li></ul>`;
    if (exp.length) $('#fx').onclick = safe(async () => { await run(db.from('blood_units').update({ inventory_status: 'Expired', handled_by: 'System', remarks: 'Past expiration date' }).in('id', exp.map(u => u.id))); toast('Expired units updated.'); route(); });
  };
  const g = {}; us.forEach(u => (g[JSON.stringify([u.blood_types.code, u.component_type, u.storage_location])] ||= []).push(u));
  $('#det').innerHTML = Object.entries(g).map(([k, a]) => { const [t, c, l] = JSON.parse(k), c2 = s => a.filter(u => u.inventory_status === s).length;
    return `<tr><td>${esc(t)}</td><td>${esc(c)}</td><td>${esc(l)}</td><td>${c2('Available')}</td><td>${c2('Reserved')}</td><td>${c2('Released')}</td><td>${c2('Expired')}</td><td>${tag(c2('Available') ? 'Available' : 'Empty')}</td></tr>`; }).join('') || '<tr><td colspan="8">No inventory yet. Create blood units first.</td></tr>';
  $('#lo').oninput = paint; paint();
}

// Lab 19: requesters
async function requesters() {
  const rows = await run(db.from('requesters').select('*').order('name'));
  $('#view').innerHTML = `<section class="card"><h2>Requesters</h2><div class="bar"><button id="new" class="p">Add requester</button></div><table>${head(['Facility / department', 'Contact person', 'Contact no.', 'Email', 'Status', ''])}<tbody id="qrows">
  ${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.contact_person)}</td><td>${esc(r.contact_number)}</td><td>${esc(r.email || '')}</td><td>${tag(r.status)}</td><td class="act"><button data-e="${r.id}">Edit</button><button data-t="${r.id}" data-s="${r.status}">${r.status === 'Active' ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('') || '<tr><td colspan="6">No requesters yet.</td></tr>'}</tbody></table></section>`;
  $('#new').onclick = () => requesterForm();
  $('#qrows').onclick = safe(async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.e) return requesterForm(rows.find(r => String(r.id) === b.dataset.e));
    await run(db.from('requesters').update({ status: b.dataset.s === 'Active' ? 'Inactive' : 'Active' }).eq('id', b.dataset.t)); route();
  });
}

function requesterForm(r = {}) {
  const m = modal(`<form><h3>${r.id ? 'Edit requester' : 'Add requester'}</h3>
  <label>Facility / department *<input name="name" required value="${esc(r.name)}"></label>
  <label>Contact person *<input name="contact_person" required value="${esc(r.contact_person)}"></label>
  <label>Contact number *<input name="contact_number" required pattern="[0-9+ \\-]{7,15}" title="7 to 15 digits" value="${esc(r.contact_number)}"></label>
  <label>Email<input name="email" type="email" value="${esc(r.email)}"></label><label>Address<input name="address" value="${esc(r.address)}"></label>
  <div class="act"><button class="p">Save requester</button><button type="button" data-x>Cancel</button></div></form>`);
  $('form', m).onsubmit = safe(async e => { e.preventDefault(); const v = form(e.target); await run(r.id ? db.from('requesters').update(v).eq('id', r.id) : db.from('requesters').insert(v)); m.close(); toast('Requester saved.'); route(); });
}

// Lab 20: blood requests
async function requests() {
  const [rq, rows] = await Promise.all([run(db.from('requesters').select('id, name').eq('status', 'Active').order('name')),
    run(db.from('blood_requests').select('*, requesters(name)').order('id', { ascending: false }))]);
  $('#view').innerHTML = `<section class="card"><h2>New blood request</h2><form id="rf" class="grid">
  <label>Requester<select name="requester_id" required><option value="">Select active requester</option>${opts(rq, 'id', 'name')}</select></label>
  <label>Request date<input name="request_date" type="date" required value="${today}"></label>
  <label>Patient / case reference<input name="patient_reference" required></label>
  <label>Urgency<select name="urgency">${['Routine', 'Urgent', 'Emergency'].map(x => `<option>${x}</option>`).join('')}</select></label>
  <label class="w">Purpose<input name="purpose" required></label><label class="w">Remarks<input name="remarks"></label><button class="p">Save request</button></form></section>
  <section class="card"><h2>Blood requests</h2><table>${head(['Request no.', 'Requester', 'Date', 'Patient / case', 'Urgency', 'Status', 'Purpose'])}<tbody>
  ${rows.map(r => `<tr><td>${esc(r.request_number)}</td><td>${esc(r.requesters.name)}</td><td>${esc(r.request_date)}</td><td>${esc(r.patient_reference)}</td><td>${esc(r.urgency)}</td><td>${tag(r.status)}</td><td>${esc(r.purpose)}</td></tr>`).join('') || '<tr><td colspan="7">No requests yet.</td></tr>'}</tbody></table></section>`;
  $('#rf').onsubmit = safe(async e => { e.preventDefault(); const r = await run(db.from('blood_requests').insert(form(e.target)).select('request_number').single()); toast(`Request saved: ${r.request_number}`); route(); });
}
