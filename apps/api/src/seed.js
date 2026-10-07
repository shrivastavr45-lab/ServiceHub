import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { pool, withTransaction } from './db.js';
import { migrate } from './migrate.js';
import { slugify } from './routes/catalog.js';

const CATALOG = {
  Electrician: ['⚡', ['Fan installation', 'Switch repair', 'Wiring', 'Light installation', 'MCB repair']],
  Plumber: ['🔧', ['Pipe repair', 'Tap installation', 'Leakage repair', 'Bathroom fitting']],
  'AC Technician': ['❄️', ['AC service', 'AC installation', 'Gas refill']],
  Carpenter: ['🪚', ['Furniture repair', 'Door fitting', 'Modular wardrobe']],
  Painter: ['🎨', ['Room painting', 'Wall waterproofing']],
  Cleaner: ['🧹', ['Home deep cleaning', 'Bathroom cleaning', 'Sofa cleaning']],
  'Appliance Repair': ['🔌', ['Washing machine repair', 'Refrigerator repair', 'Microwave repair']],
};

// provider: [name, email, city, headline, years, skills, [[service, price ₹, unit]], areas, bio]
const PROVIDERS = [
  ['Rajesh Kumar', 'rajesh@servicehub.test', 'New Delhi', 'Licensed electrician, 12 yrs', 12, ['Wiring', 'Safety audit'], [['Fan installation', 400], ['Switch repair', 250], ['Wiring', 1500], ['Light installation', 350], ['MCB repair', 500]], [['New Delhi', '110001'], ['New Delhi', '110016'], ['Gurugram', null]], 'Certified electrician handling residential wiring, repairs and installations across South Delhi.'],
  ['Amit Sharma', 'amit@servicehub.test', 'New Delhi', 'Residential electrician', 6, ['Fan fitting', 'LED lighting'], [['Fan installation', 350], ['Light installation', 300], ['Switch repair', 200]], [['New Delhi', '110024'], ['Noida', null]], 'Fast, tidy work with 30-day workmanship warranty.'],
  ['Suresh Yadav', 'suresh@servicehub.test', 'New Delhi', 'Plumber – leaks & bathrooms', 9, ['Leak detection', 'Bathroom fitting'], [['Pipe repair', 450], ['Tap installation', 300], ['Leakage repair', 600], ['Bathroom fitting', 3500]], [['New Delhi', '110001'], ['New Delhi', '110017']], 'Specialised in hidden leakage and complete bathroom fittings.'],
  ['Imran Khan', 'imran@servicehub.test', 'Gurugram', 'AC service & installation expert', 8, ['Split AC', 'Gas refill'], [['AC service', 599], ['AC installation', 1800], ['Gas refill', 2200]], [['Gurugram', null], ['New Delhi', '110016']], 'All major brands. Genuine spares only.'],
  ['Mohan Singh', 'mohan@servicehub.test', 'Noida', 'Carpenter & furniture repair', 15, ['Wood work', 'Modular kitchens'], [['Furniture repair', 700], ['Door fitting', 900], ['Modular wardrobe', 18000]], [['Noida', null], ['New Delhi', '110024']], 'Custom woodwork and repairs, 15 years of experience.'],
  ['Sunita Devi', 'sunita@servicehub.test', 'New Delhi', 'Professional home cleaning', 5, ['Deep cleaning', 'Sofa cleaning'], [['Home deep cleaning', 2499], ['Bathroom cleaning', 499], ['Sofa cleaning', 799]], [['New Delhi', '110001'], ['New Delhi', '110016'], ['Gurugram', null]], 'Trained team with eco-friendly products.'],
  ['Pradeep Verma', 'pradeep@servicehub.test', 'New Delhi', 'Home appliance repair', 10, ['Washing machines', 'Refrigerators'], [['Washing machine repair', 499], ['Refrigerator repair', 599], ['Microwave repair', 399]], [['New Delhi', '110017'], ['New Delhi', '110024']], 'Doorstep repair with spare part warranty.'],
];
const CUSTOMERS = [
  ['Priya Mehta', 'priya@servicehub.test', 'New Delhi', '110016', '24 Green Park Extension'],
  ['Arjun Nair', 'arjun@servicehub.test', 'New Delhi', '110001', '7 Barakhamba Road'],
  ['Neha Gupta', 'neha@servicehub.test', 'Gurugram', '122001', '12 Sector 14'],
];

export async function seed({ log = console.log } = {}) {
  await migrate({ log });
  const exists = (await pool.query(`SELECT 1 FROM users WHERE email = 'admin@servicehub.test'`)).rowCount;
  if (exists) { log('Seed data already present – skipping.'); return; }
  const hash = await bcrypt.hash(config.SEED_PASSWORD, config.BCRYPT_ROUNDS);

  await withTransaction(async (c) => {
    const user = async (name, email, role, phone) =>
      (await c.query(`INSERT INTO users (name, email, password_hash, role, phone) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [name, email, hash, role, phone])).rows[0].id;

    await user('Platform Admin', 'admin@servicehub.test', 'ADMIN', null);

    const svcIds = {};
    for (const [cat, [icon, services]] of Object.entries(CATALOG)) {
      const cid = (await c.query(`INSERT INTO categories (name, slug, icon, description) VALUES ($1,$2,$3,$4) RETURNING id`, [cat, slugify(cat), icon, `Trusted ${cat.toLowerCase()} professionals near you`])).rows[0].id;
      for (const s of services) svcIds[s] = (await c.query(`INSERT INTO services (category_id, name, slug) VALUES ($1,$2,$3) RETURNING id`, [cid, s, `${slugify(s)}-${cid}`])).rows[0].id;
    }

    const custs = [];
    for (const [i, [name, email, city, pin, addr]] of CUSTOMERS.entries()) {
      const id = await user(name, email, 'CUSTOMER', `98100000${i}1`);
      await c.query('INSERT INTO customer_profiles (user_id, address, city, pincode) VALUES ($1,$2,$3,$4)', [id, addr, city, pin]);
      custs.push({ id, name, city, pin, addr });
    }

    const provs = [];
    for (const [i, [name, email, city, headline, years, skills, services, areas, bio]] of PROVIDERS.entries()) {
      const id = await user(name, email, 'SERVICE_PROVIDER', `98200000${i}2`);
      await c.query(`INSERT INTO provider_profiles (user_id, headline, bio, experience_years, skills, city) VALUES ($1,$2,$3,$4,$5,$6)`, [id, headline, bio, years, skills, city]);
      const ps = {};
      for (const [s, rupees] of services) ps[s] = (await c.query(`INSERT INTO provider_services (provider_id, service_id, price_paise, price_unit) VALUES ($1,$2,$3,'FIXED') RETURNING id`, [id, svcIds[s], rupees * 100])).rows[0].id;
      for (const [acity, pin] of areas) await c.query('INSERT INTO service_areas (provider_id, city, pincode) VALUES ($1,$2,$3)', [id, acity, pin]);
      for (const wd of [1, 2, 3, 4, 5, 6]) await c.query(`INSERT INTO availability (provider_id, weekday, start_time, end_time) VALUES ($1,$2,'09:00','18:00')`, [id, wd]);
      provs.push({ id, name, ps, services });
    }
    const P = Object.fromEntries(provs.map((p) => [p.name.split(' ')[0], p]));
    const C = Object.fromEntries(custs.map((p) => [p.name.split(' ')[0], p]));

    const booking = async ({ cust, prov, service, status, price, offers = [], days = 0, desc }) => {
      const listed = prov.services.find(([s]) => s === service)[1] * 100;
      const cat = (await c.query('SELECT c.name FROM services s JOIN categories c ON c.id = s.category_id WHERE s.id = $1', [svcIds[service]])).rows[0].name;
      const fee = price ? Math.round(price * 0.1) : null;
      const completedAt = status === 'COMPLETED' ? new Date(Date.now() - days * 86400000) : null;
      const sched = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'].includes(status) ? new Date(Date.now() + (status === 'SCHEDULED' ? 2 : -days) * 86400000) : null;
      const b = (await c.query(`INSERT INTO bookings (customer_id, provider_id, provider_service_id, service_name, category_name, listed_price_paise, description, address, city, pincode,
        preferred_at, scheduled_at, status, agreed_price_paise, platform_fee_percent, platform_fee_paise, completed_at, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, now() - ($18 || ' days')::interval) RETURNING *`,
        [cust.id, prov.id, prov.ps[service], service, cat, listed, desc, cust.addr, cust.city, cust.pin, sched, sched, status, price, price ? 10 : null, fee, completedAt, String(days + 3)])).rows[0];
      await c.query(`INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by, note) VALUES ($1,NULL,'REQUESTED',$2,'Service requested')`, [b.id, cust.id]);
      for (const [by, amt, st] of offers) {
        const uid = by === 'P' ? prov.id : cust.id;
        await c.query(`INSERT INTO price_offers (booking_id, offered_by, offered_by_role, amount_paise, status) VALUES ($1,$2,$3,$4,$5)`, [b.id, uid, by === 'P' ? 'SERVICE_PROVIDER' : 'CUSTOMER', amt * 100, st]);
      }
      return b;
    };

    // Completed jobs with invoices and reviews
    const done = [
      { cust: C.Priya, prov: P.Rajesh, service: 'Fan installation', price: 40000, offers: [['P', 450, 'SUPERSEDED'], ['C', 350, 'SUPERSEDED'], ['P', 400, 'ACCEPTED']], days: 20, desc: 'Install two ceiling fans in the bedroom and living room.', rating: 5, comment: 'Excellent work, arrived on time and cleaned up afterwards.' },
      { cust: C.Priya, prov: P.Suresh, service: 'Leakage repair', price: 60000, offers: [['P', 600, 'ACCEPTED']], days: 12, desc: 'Water leaking from the kitchen sink pipe.', rating: 4, comment: 'Fixed the leak quickly. Slightly late.' },
      { cust: C.Arjun, prov: P.Rajesh, service: 'MCB repair', price: 50000, offers: [['P', 500, 'ACCEPTED']], days: 8, desc: 'MCB tripping repeatedly in the main panel.', rating: 5, comment: 'Very knowledgeable. Found the faulty breaker immediately.' },
      { cust: C.Neha, prov: P.Imran, service: 'AC service', price: 59900, offers: [['P', 599, 'ACCEPTED']], days: 15, desc: 'Annual service for two split ACs.', rating: 5, comment: 'Thorough service, AC cooling much better now.' },
      { cust: C.Arjun, prov: P.Sunita, service: 'Home deep cleaning', price: 230000, offers: [['P', 2499, 'SUPERSEDED'], ['C', 2200, 'SUPERSEDED'], ['P', 2300, 'ACCEPTED']], days: 5, desc: '2BHK deep cleaning before festive season.', rating: 4, comment: 'Good job overall; kitchen was spotless.' },
    ];
    let n = 1000;
    for (const d of done) {
      const b = await booking({ ...d, status: 'COMPLETED' });
      await c.query(`INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by, note) VALUES ($1,'IN_PROGRESS','COMPLETED',$2,'Work completed')`, [b.id, d.prov.id]);
      const inv = (await c.query(`INSERT INTO invoices (booking_id, invoice_number, customer_snapshot, provider_snapshot, service_name, description, subtotal_paise, tax_percent, tax_paise, total_paise, payment_status, issued_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,$7,'PAID', now() - ($8 || ' days')::interval) RETURNING id`,
        [b.id, `INV-2026-${++n}`, JSON.stringify({ name: d.cust.name, city: d.cust.city, address: d.cust.addr }), JSON.stringify({ name: d.prov.name }), d.service, d.desc, d.price, String(d.days)])).rows[0].id;
      await c.query(`INSERT INTO invoice_items (invoice_id, description, quantity, unit_price_paise, amount_paise) VALUES ($1,$2,1,$3,$3)`, [inv, d.service, d.price]);
      await c.query(`INSERT INTO payments (booking_id, invoice_id, amount_paise, method, recorded_by) VALUES ($1,$2,$3,'UPI',$4)`, [b.id, inv, d.price, d.cust.id]);
      await c.query(`INSERT INTO reviews (booking_id, customer_id, provider_id, rating, comment) VALUES ($1,$2,$3,$4,$5)`, [b.id, d.cust.id, d.prov.id, d.rating, d.comment]);
    }
    await c.query(`UPDATE provider_profiles pp SET rating_avg = r.avg, rating_count = r.n FROM
      (SELECT provider_id, ROUND(AVG(rating)::numeric,2) AS avg, COUNT(*) AS n FROM reviews GROUP BY provider_id) r WHERE r.provider_id = pp.user_id`);

    // Live bookings in each pre-completion state
    await booking({ cust: C.Neha, prov: P.Amit, service: 'Fan installation', status: 'REQUESTED', days: 0, desc: 'Need a ceiling fan installed in the study room.' });
    await booking({ cust: C.Arjun, prov: P.Mohan, service: 'Door fitting', status: 'QUOTED', days: 1, desc: 'New wooden door for the balcony.', offers: [['P', 1100, 'PENDING']] });
    await booking({ cust: C.Priya, prov: P.Pradeep, service: 'Washing machine repair', status: 'NEGOTIATING', days: 1, desc: 'Machine not draining water.', offers: [['P', 599, 'SUPERSEDED'], ['C', 450, 'PENDING']] });
    await booking({ cust: C.Neha, prov: P.Imran, service: 'Gas refill', status: 'ACCEPTED', price: 220000, days: 2, desc: 'AC not cooling, suspect gas leak.', offers: [['P', 2200, 'ACCEPTED']] });
    await booking({ cust: C.Priya, prov: P.Suresh, service: 'Tap installation', status: 'SCHEDULED', price: 30000, days: 1, desc: 'Replace two bathroom taps.', offers: [['P', 300, 'ACCEPTED']] });
    await booking({ cust: C.Arjun, prov: P.Amit, service: 'Switch repair', status: 'IN_PROGRESS', price: 20000, days: 0, desc: 'Two switches in the hall are sparking.', offers: [['P', 200, 'ACCEPTED']] });

    await c.query(`INSERT INTO notifications (user_id, type, title, body) SELECT id, 'WELCOME', 'Welcome to ServiceHub', 'Your account is ready.' FROM users`);
    await c.query(`INSERT INTO audit_logs (action, entity_type, metadata) VALUES ('system.seed', 'system', '{"note":"demo data created"}')`);
  });
  log('Seeded: 1 admin, 3 customers, 7 providers, catalog, bookings, invoices, reviews.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
