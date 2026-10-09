// BDMS Labs 1-10. Conventions: camelCase in JS, snake_case in the database, kebab-case file names.
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = new Date().toLocaleDateString('en-CA');
const one = v => Array.isArray(v) ? v[0] : v;
const tag = s => `<span class="tag ${esc(s)}">${esc(s)}</span>`;
const form = f => Object.fromEntries([...new FormData(f)].map(([k, v]) => [k, v === '' ? null : v]));
const opts = (rows, val, label, sel) => rows.map(r => `<option value="${esc(r[val])}"${String(r[val]) === String(sel) ? ' selected' : ''}>${esc(r[label])}</option>`).join('');
const FLOW = { Pending: ['Approved', 'Deferred', 'Rejected'], Deferred: ['Approved', 'Rejected'], Approved: [], Rejected: [] };
let types = [];

function toast(t, bad) { const m = $('#msg'); m.textContent = t; m.className = bad ? 'bad' : 'ok'; clearTimeout(toast.id); toast.id = setTimeout(() => m.className = '', 3500); }
async function run(p) { const { data, error } = await p; if (error) { toast(error.code === '23505' ? 'That record already exists.' : error.message, true); throw error; } return data; }
const safe = fn => async (...a) => { try { await fn(...a); } catch (e) { console.error(e); } };
function modal(html) { const d = document.createElement('dialog'); d.innerHTML = html; d.onclick = e => e.target.matches('[data-x]') && d.close(); d.onclose = () => d.remove(); document.body.append(d); d.showModal(); return d; }

// Lab 1: connection test
async function home() {
  const { count, error } = await db.from('donors').select('*', { count: 'exact', head: true });
  if (error) throw error;
  $('#view').innerHTML = `<section class="card"><h2>Welcome</h2><p style="color:var(--ok)">Connected to Supabase: ${types.length} blood types, ${count} donors.</p><p>Workflow so far: Donor, Blood type, Donation, Screening.</p></section>`;
}

// Labs 4-6, 8: donors
async function donors() {
  $('#view').innerHTML = `<section class="card"><h2>Donors</h2>
  <div class="bar"><input id="q" placeholder="Donor no., name or contact"><select id="fs"><option value="">All statuses</option><option>Active</option><option>Inactive</option></select>
  <select id="fb"><option value="">All blood types</option>${opts(types, 'id', 'code')}</select><button id="new" class="p">Register donor</button></div>
  <table><thead><tr><th>Donor no.</th><th>Name</th><th>Blood type</th><th>Contact</th><th>Status</th><th></th></tr></thead><tbody id="rows"></tbody></table></section>`;
  const load = safe(async () => {
    let q = db.from('donors').select('*, blood_types(code)').order('id', { ascending: false });
    const s = $('#q').value.replace(/[,()%*]/g, '').trim();
    if (s) q = q.or(`donor_number.ilike.%${s}%,full_name.ilike.%${s}%,contact_number.ilike.%${s}%`);
    if ($('#fs').value) q = q.eq('status', $('#fs').value);
    if ($('#fb').value) q = q.eq('blood_type_id', $('#fb').value);
    const rows = await run(q);
    $('#rows').innerHTML = rows.map(d => `<tr><td>${esc(d.donor_number)}</td><td>${esc(d.full_name)}</td><td>${esc(d.blood_types?.code || 'Not set')}</td><td>${esc(d.contact_number)}</td><td>${tag(d.status)}</td>
      <td class="act"><button data-p="${d.id}">Profile</button><button data-e="${d.id}">Edit</button><button data-t="${d.id}" data-s="${d.status}">${d.status === 'Active' ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('') || '<tr><td colspan="6">No donors match. Register a donor or change the filters.</td></tr>';
  });
  ['q', 'fs', 'fb'].forEach(i => $('#' + i).addEventListener('input', load));
  $('#new').onclick = () => donorForm(null, load);
  $('#rows').onclick = safe(async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.p) return profile(b.dataset.p);
    if (b.dataset.e) return donorForm(b.dataset.e, load);
    await run(db.from('donors').update({ status: b.dataset.s === 'Active' ? 'Inactive' : 'Active' }).eq('id', b.dataset.t));
    toast('Donor status updated.'); load();
  });
  load();
}

async function donorForm(id, after) {
  const d = id ? await run(db.from('donors').select('*').eq('id', id).single()) : {};
  const m = modal(`<form><h3>${id ? 'Edit donor' : 'Register donor'}</h3>
  <label>Full name *<input name="full_name" required value="${esc(d.full_name)}"></label>
  <label>Date of birth *<input name="date_of_birth" type="date" required max="${today}" value="${esc(d.date_of_birth)}"></label>
  <label>Sex *<select name="sex" required><option value="">Select</option>${['Male', 'Female'].map(x => `<option${d.sex === x ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
  <label>Blood type<select name="blood_type_id"><option value="">Not set</option>${opts(types.filter(t => t.is_active || t.id === d.blood_type_id), 'id', 'code', d.blood_type_id)}</select></label>
  <label>Contact number *<input name="contact_number" required pattern="[0-9+ \\-]{7,15}" title="7 to 15 digits" value="${esc(d.contact_number)}"></label>
  <label>Email<input name="email" type="email" value="${esc(d.email)}"></label>
  <label>Address<input name="address" value="${esc(d.address)}"></label>
  <label>Emergency contact<input name="emergency_contact" value="${esc(d.emergency_contact)}"></label>
  <div class="act"><button class="p">Save donor</button><button type="button" data-x>Cancel</button></div></form>`);
  $('form', m).onsubmit = safe(async e => {
    e.preventDefault();
    const v = form(e.target);
    const r = await run(id ? db.from('donors').update(v).eq('id', id) : db.from('donors').insert(v).select('donor_number').single());
    m.close(); toast(id ? 'Donor updated.' : `Donor registered: ${r.donor_number}`); after();
  });
}

async function profile(id) {
  const [d, ds] = await Promise.all([
    run(db.from('donors').select('*, blood_types(code)').eq('id', id).single()),
    run(db.from('donations').select('*, donation_screening(status)').eq('donor_id', id).order('donation_date', { ascending: false }))]);
  modal(`<h3>${esc(d.full_name)} ${tag(d.status)}</h3>
  <p><b>${esc(d.donor_number)}</b> | Blood type: <b>${esc(d.blood_types?.code || 'Not set')}</b> | ${esc(d.sex)}, born ${esc(d.date_of_birth)}</p>
  <p>${esc(d.contact_number)} | ${esc(d.email || 'No email')} | ${esc(d.address || 'No address')}<br>Emergency contact: ${esc(d.emergency_contact || 'None')} | Registered ${esc(d.registered_at)}</p>
  <p>Donations: <b>${ds.length}</b> | Most recent: <b>${esc(ds[0]?.donation_date || 'None yet')}</b></p>
  <table><thead><tr><th>Donation</th><th>Date</th><th>Status</th><th>Screening</th></tr></thead><tbody>${ds.map(x => `<tr><td>${esc(x.donation_number)}</td><td>${esc(x.donation_date)}</td><td>${tag(x.status)}</td><td>${esc(one(x.donation_screening)?.status || 'Not screened')}</td></tr>`).join('') || '<tr><td colspan="4">No donations recorded.</td></tr>'}</tbody></table>
  <div class="act"><button data-x>Close</button></div>`);
}

// Lab 7: blood type reference
function typesView() {
  $('#view').innerHTML = `<section class="card"><h2>Blood types</h2>
  <form id="tf" class="bar"><label>New blood type<input id="tc" required maxlength="3" pattern="(A|B|AB|O)[+\\-]" title="Example: A+"></label><button class="p">Add blood type</button></form>
  <table><thead><tr><th>Code</th><th>Status</th><th></th></tr></thead><tbody id="trows">${types.map(t => `<tr><td>${esc(t.code)}</td><td>${tag(t.is_active ? 'Active' : 'Inactive')}</td>
  <td class="act"><button data-t="${t.id}" data-a="${t.is_active}">${t.is_active ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('')}</tbody></table></section>`;
  $('#tf').onsubmit = safe(async e => {
    e.preventDefault();
    const code = $('#tc').value.trim().toUpperCase();
    if (types.some(t => t.code === code)) return toast(`${code} already exists.`, true);
    await run(db.from('blood_types').insert({ code })); toast('Blood type added.'); route();
  });
  $('#trows').onclick = safe(async e => {
    const b = e.target.closest('button'); if (!b) return;
    await run(db.from('blood_types').update({ is_active: b.dataset.a !== 'true' }).eq('id', b.dataset.t)); route();
  });
}
 //application test run
// Labs 9-10: donations and screening
async function donations() {
  const [ds, rows] = await Promise.all([
    run(db.from('donors').select('id, donor_number, full_name, blood_type_id, blood_types(code)').eq('status', 'Active').order('full_name')),
    run(db.from('donations').select('*, donors(donor_number, full_name), blood_types(code), donation_screening(*)').order('id', { ascending: false }))]);
  $('#view').innerHTML = `<section class="card"><h2>Record donation</h2><form id="df" class="grid">
  <label>Donor<select id="dd" name="donor_id" required><option value="">Select an active donor</option>${ds.map(d => `<option value="${d.id}">${esc(d.donor_number)} - ${esc(d.full_name)}</option>`).join('')}</select></label>
  <label>Blood type<input id="bt" readonly placeholder="Filled from donor"></label>
  <label>Donation date<input name="donation_date" type="date" required max="${today}" value="${today}"></label>
  <label>Volume (mL)<input name="volume_ml" type="number" min="1" required value="450"></label>
  <label class="w">Remarks<input name="remarks"></label><button class="p">Save donation</button></form></section>
  <section class="card"><h2>Donation records</h2><table><thead><tr><th>Donation no.</th><th>Donor</th><th>Blood type</th><th>Date</th><th>Screening</th><th></th></tr></thead><tbody id="drows">
  ${rows.map(r => { const s = one(r.donation_screening); return `<tr><td>${esc(r.donation_number)}</td><td>${esc(r.donors.full_name)}</td><td>${esc(r.blood_types?.code)}</td><td>${esc(r.donation_date)}</td><td>${s ? tag(s.status) : 'Not screened'}</td><td class="act"><button data-s="${r.id}">${s ? 'Update screening' : 'Record screening'}</button></td></tr>`; }).join('') || '<tr><td colspan="6">No donations yet.</td></tr>'}</tbody></table></section>`;
  $('#dd').oninput = () => { const d = ds.find(x => String(x.id) === $('#dd').value); $('#bt').value = d ? (d.blood_types?.code || 'Not set') : ''; };
  $('#df').onsubmit = safe(async e => {
    e.preventDefault();
    const v = form(e.target), d = ds.find(x => String(x.id) === v.donor_id);
    if (!d.blood_type_id) return toast('Set this donor\'s blood type first (Donors > Edit).', true);
    const r = await run(db.from('donations').insert({ ...v, volume_ml: +v.volume_ml, blood_type_id: d.blood_type_id }).select('donation_number').single());
    toast(`Donation saved: ${r.donation_number}`); route();
  });
  $('#drows').onclick = e => { const b = e.target.closest('button'); if (b) screening(rows.find(r => String(r.id) === b.dataset.s)); };
}

function screening(r) {
  const s = one(r.donation_screening) || { status: 'Pending' };
  if (s.id && !FLOW[s.status].length) return toast(`${s.status} screenings are final.`, true);
  const m = modal(`<form><h3>Screening: ${esc(r.donation_number)}</h3>
  <label>Screening date<input name="screening_date" type="date" required max="${today}" value="${esc(s.screening_date || today)}"></label>
  <label>Status<select name="status">${[s.status, ...FLOW[s.status]].map(x => `<option${x === s.status ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
  <label>Result<input name="result" value="${esc(s.result)}"></label>
  <label>Staff reviewer *<input name="reviewer" required value="${esc(s.reviewer)}"></label>
  <label>Remarks<input name="remarks" value="${esc(s.remarks)}"></label>
  <div class="act"><button class="p">Save screening</button><button type="button" data-x>Cancel</button></div></form>`);
  $('form', m).onsubmit = safe(async e => {
    e.preventDefault();
    await run(db.from('donation_screening').upsert({ donation_id: r.id, ...form(e.target) }, { onConflict: 'donation_id' }));
    m.close(); toast('Screening saved.'); route();
  });
}

const views = { home, donors, types: typesView, donations };
async function route() {
  const v = views[location.hash.slice(1)] ? location.hash.slice(1) : 'home';
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.hash === '#' + v));
  try { types = await run(db.from('blood_types').select('*').order('id')); await views[v](); }
  catch (e) { console.error(e); $('#view').innerHTML = '<section class="card err">Cannot reach the database. Check js/config.js and run sql/schema.sql in Supabase.</section>'; }
}
addEventListener('hashchange', route); route();
