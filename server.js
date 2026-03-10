const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3456;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function queryAll(sql, params = []) {
    const res = await pool.query(sql, params);
    return res.rows;
}
async function queryOne(sql, params = []) {
    const rows = await queryAll(sql, params);
    return rows.length > 0 ? rows[0] : null;
}
async function queryRun(sql, params = []) {
    return await pool.query(sql, params);
}

async function initDB() {
    await queryRun(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    await queryRun(`CREATE TABLE IF NOT EXISTS ppe_items (id SERIAL PRIMARY KEY, ppe_name TEXT NOT NULL, category TEXT NOT NULL, unit TEXT NOT NULL DEFAULT 'pcs', current_stock INTEGER NOT NULL DEFAULT 0, minimum_stock INTEGER NOT NULL DEFAULT 10, date_added TEXT NOT NULL DEFAULT CURRENT_DATE)`);
    await queryRun(`CREATE TABLE IF NOT EXISTS clients (id SERIAL PRIMARY KEY, company_name TEXT NOT NULL, contact_person TEXT, contact_number TEXT, project_location TEXT, date_added TEXT NOT NULL DEFAULT CURRENT_DATE)`);
    await queryRun(`CREATE TABLE IF NOT EXISTS incoming_ppe (id SERIAL PRIMARY KEY, date_received TEXT NOT NULL, ppe_id INTEGER NOT NULL, quantity INTEGER NOT NULL, supplier TEXT, received_by TEXT, remarks TEXT)`);
    await queryRun(`CREATE TABLE IF NOT EXISTS distribution (id SERIAL PRIMARY KEY, date_issued TEXT NOT NULL, client_id INTEGER NOT NULL, ppe_id INTEGER NOT NULL, quantity INTEGER NOT NULL, issued_by TEXT, remarks TEXT)`);
    await queryRun(`CREATE TABLE IF NOT EXISTS transactions (id SERIAL PRIMARY KEY, ppe_id INTEGER NOT NULL, transaction_type TEXT NOT NULL, quantity INTEGER NOT NULL, client_id INTEGER, date TEXT NOT NULL, responsible_person TEXT, remarks TEXT)`);
    const pinCheck = await queryOne("SELECT value FROM settings WHERE key = 'pin_hash'");
    if (!pinCheck) {
          const hash = bcrypt.hashSync('000000', 10);
          await queryRun("INSERT INTO settings (key, value) VALUES ('pin_hash', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [hash]);
    }
}

app.post('/api/pin/verify', async (req, res) => {
    const { pin } = req.body;
    const row = await queryOne("SELECT value FROM settings WHERE key = 'pin_hash'");
    if (row && bcrypt.compareSync(pin, row.value)) { res.json({ success: true }); }
    else { res.json({ success: false, message: 'Invalid PIN' }); }
});

app.post('/api/pin/change', async (req, res) => {
    const { currentPin, newPin } = req.body;
    const row = await queryOne("SELECT value FROM settings WHERE key = 'pin_hash'");
    if (!row || !bcrypt.compareSync(currentPin, row.value)) { return res.json({ success: false, message: 'Current PIN is incorrect' }); }
    const hash = bcrypt.hashSync(newPin, 10);
    await queryRun("UPDATE settings SET value = $1 WHERE key = 'pin_hash'", [hash]);
    res.json({ success: true });
});
app.get('/api/dashboard', async (req, res) => {
    const totalItems = (await queryOne('SELECT COUNT(*) as count FROM ppe_items')).count;
    const totalStock = (await queryOne('SELECT COALESCE(SUM(current_stock), 0) as total FROM ppe_items')).total;
    const lowStockItems = (await queryOne('SELECT COUNT(*) as count FROM ppe_items WHERE current_stock <= minimum_stock')).count;
    const totalClients = (await queryOne('SELECT COUNT(*) as count FROM clients')).count;
    const recentTransactions = await queryAll(`SELECT t.*, p.ppe_name, c.company_name FROM transactions t LEFT JOIN ppe_items p ON t.ppe_id = p.id LEFT JOIN clients c ON t.client_id = c.id ORDER BY t.id DESC LIMIT 10`);
    const stockChart = await queryAll(`SELECT ppe_name, current_stock, minimum_stock FROM ppe_items ORDER BY current_stock DESC LIMIT 12`);
    const monthlyIn = (await queryAll(`SELECT to_char(date::date, 'YYYY-MM') as month, SUM(quantity) as total FROM transactions WHERE transaction_type = 'IN' GROUP BY month ORDER BY month DESC LIMIT 6`)).reverse();
    const monthlyOut = (await queryAll(`SELECT to_char(date::date, 'YYYY-MM') as month, SUM(quantity) as total FROM transactions WHERE transaction_type = 'OUT' GROUP BY month ORDER BY month DESC LIMIT 6`)).reverse();
    res.json({ totalItems, totalStock, lowStockItems, totalClients, recentTransactions, stockChart, monthlyIn, monthlyOut });
});

app.get('/api/ppe', async (req, res) => {
    const { search } = req.query;
    if (search) { res.json(await queryAll(`SELECT * FROM ppe_items WHERE ppe_name ILIKE $1 OR category ILIKE $2 ORDER BY id DESC`, [`%${search}%`, `%${search}%`])); }
    else { res.json(await queryAll('SELECT * FROM ppe_items ORDER BY id DESC')); }
});
app.get('/api/ppe/:id', async (req, res) => { res.json((await queryOne('SELECT * FROM ppe_items WHERE id = $1', [req.params.id])) || {}); });
app.post('/api/ppe', async (req, res) => {
      const { ppe_name, category, unit, current_stock, minimum_stock } = req.body;
      try { const result = await queryOne('INSERT INTO ppe_items (ppe_name, category, unit, current_stock, minimum_stock) VALUES ($1, $2, $3, $4, $5) RETURNING id', [ppe_name, category, unit || 'pcs', current_stock || 0, minimum_stock || 10]); res.json({ success: true, id: result.id }); }
      catch (e) { res.json({ success: false, message: e.message }); }
});
app.put('/api/ppe/:id', async (req, res) => {
      const { ppe_name, category, unit, current_stock, minimum_stock } = req.body;
      try { await queryRun('UPDATE ppe_items SET ppe_name=$1, category=$2, unit=$3, current_stock=$4, minimum_stock=$5 WHERE id=$6', [ppe_name, category, unit, current_stock, minimum_stock, req.params.id]); res.json({ success: true }); }
      catch (e) { res.json({ success: false, message: e.message }); }
});
app.delete('/api/ppe/:id', async (req, res) => {
      try { await queryRun('DELETE FROM ppe_items WHERE id = $1', [req.params.id]); res.json({ success: true }); }
      catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/clients', async (req, res) => { res.json(await queryAll('SELECT * FROM clients ORDER BY id DESC')); });
app.get('/api/clients/:id', async (req, res) => { res.json((await queryOne('SELECT * FROM clients WHERE id = $1', [req.params.id])) || {}); });
app.get('/api/clients/:id/history', async (req, res) => { res.json(await queryAll(`SELECT d.*, p.ppe_name FROM distribution d LEFT JOIN ppe_items p ON d.ppe_id = p.id WHERE d.client_id = $1 ORDER BY d.id DESC`, [req.params.id])); });
app.post('/api/clients', async (req, res) => {
      const { company_name, contact_person, contact_number, project_location } = req.body;
      try { const result = await queryOne('INSERT INTO clients (company_name, contact_person, contact_number, project_location) VALUES ($1, $2, $3, $4) RETURNING id', [company_name, contact_person, contact_number, project_location]); res.json({ success: true, id: result.id }); }
      catch (e) { res.json({ success: false, message: e.message }); }
});
app.put('/api/clients/:id', async (req, res) => {
      const { company_name, contact_person, contact_number, project_location } = req.body;
      try { await queryRun('UPDATE clients SET company_name=$1, contact_person=$2, contact_number=$3, project_location=$4 WHERE id=$5', [company_name, contact_person, contact_number, project_location, req.params.id]); res.json({ success: true }); }
      catch (e) { res.json({ success: false, message: e.message }); }
});
app.delete('/api/clients/:id', async (req, res) => {
      try {
              const distributions = await queryOne('SELECT COUNT(*) as count FROM distribution WHERE client_id = $1', [req.params.id]);
              if (parseInt(distributions.count) > 0) { return res.json({ success: false, message: `Cannot delete: This client has ${distributions.count} distribution record(s).` }); }
              await queryRun('DELETE FROM clients WHERE id = $1', [req.params.id]); res.json({ success: true });
      } catch (e) { res.json({ success: false, message: e.message }); }
});
app.get('/api/incoming', async (req, res) => { res.json(await queryAll(`SELECT i.*, p.ppe_name FROM incoming_ppe i LEFT JOIN ppe_items p ON i.ppe_id = p.id ORDER BY i.id DESC`)); });
app.get('/api/incoming/:id', async (req, res) => { res.json((await queryOne('SELECT * FROM incoming_ppe WHERE id = $1', [req.params.id])) || {}); });
app.post('/api/incoming', async (req, res) => {
      const { date_received, ppe_id, quantity, supplier, received_by, remarks } = req.body;
      const qty = parseInt(quantity);
      if (qty <= 0) return res.json({ success: false, message: 'Quantity must be greater than 0' });
      const ppe = await queryOne('SELECT * FROM ppe_items WHERE id = $1', [ppe_id]);
      if (!ppe) return res.json({ success: false, message: 'PPE item not found' });
      try {
              await queryRun('INSERT INTO incoming_ppe (date_received, ppe_id, quantity, supplier, received_by, remarks) VALUES ($1, $2, $3, $4, $5, $6)', [date_received, ppe_id, qty, supplier, received_by, remarks]);
              await queryRun('UPDATE ppe_items SET current_stock = current_stock + $1 WHERE id = $2', [qty, ppe_id]);
              await queryRun('INSERT INTO transactions (ppe_id, transaction_type, quantity, date, responsible_person, remarks) VALUES ($1, $2, $3, $4, $5, $6)', [ppe_id, 'IN', qty, date_received, received_by, remarks]);
              res.json({ success: true });
      } catch (e) { res.json({ success: false, message: e.message }); }
});
app.put('/api/incoming/:id', async (req, res) => {
      const { date_received, ppe_id, quantity, supplier, received_by, remarks } = req.body;
      const newQty = parseInt(quantity);
      if (newQty <= 0) return res.json({ success: false, message: 'Quantity must be greater than 0' });
      try {
              const old = await queryOne('SELECT * FROM incoming_ppe WHERE id = $1', [req.params.id]);
              if (!old) return res.json({ success: false, message: 'Record not found' });
              await queryRun('UPDATE
    const { ppe_name, category, unit, current_stock, minimum_stock } = req.body;
    try { const result = await queryOne('INSERT INTO ppe_items (ppe_name, category, unit, current_st
