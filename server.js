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

// PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Initialize database tables
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    await client.query(`CREATE TABLE IF NOT EXISTS ppe_items (
      id SERIAL PRIMARY KEY,
      ppe_name TEXT NOT NULL,
      category TEXT NOT NULL,
      size TEXT DEFAULT NULL,
      unit TEXT NOT NULL DEFAULT 'pcs',
      current_stock INTEGER NOT NULL DEFAULT 0,
      minimum_stock INTEGER NOT NULL DEFAULT 10,
      date_added DATE NOT NULL DEFAULT CURRENT_DATE
    )`);
    // Add size column if it doesn't exist (for existing databases)
    await client.query(`DO $$ BEGIN ALTER TABLE ppe_items ADD COLUMN size TEXT DEFAULT NULL; EXCEPTION WHEN duplicate_column THEN NULL; END $$`);
    await client.query(`CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      company_name TEXT NOT NULL,
      contact_person TEXT,
      contact_number TEXT,
      project_location TEXT,
      date_added DATE NOT NULL DEFAULT CURRENT_DATE
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS incoming_ppe (
      id SERIAL PRIMARY KEY,
      date_received TEXT NOT NULL,
      ppe_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      supplier TEXT,
      received_by TEXT,
      remarks TEXT
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS distribution (
      id SERIAL PRIMARY KEY,
      date_issued TEXT NOT NULL,
      client_id INTEGER NOT NULL,
      ppe_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      issued_by TEXT,
      remarks TEXT
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      ppe_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      client_id INTEGER,
      date TEXT NOT NULL,
      responsible_person TEXT,
      remarks TEXT
    )`);

    // Seed default PIN if not exists
    const pinCheck = await client.query("SELECT value FROM settings WHERE key = 'pin_hash'");
    if (pinCheck.rows.length === 0) {
      const hash = bcrypt.hashSync('000000', 10);
      await client.query("INSERT INTO settings (key, value) VALUES ('pin_hash', $1) ON CONFLICT (key) DO NOTHING", [hash]);
    }
  } finally {
    client.release();
  }
}

// ==================== PIN API ====================
app.post('/api/pin/verify', async (req, res) => {
  try {
    const { pin } = req.body;
    const result = await pool.query("SELECT value FROM settings WHERE key = 'pin_hash'");
    if (result.rows.length > 0 && bcrypt.compareSync(pin, result.rows[0].value)) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: 'Invalid PIN' });
    }
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/pin/change', async (req, res) => {
  try {
    const { currentPin, newPin } = req.body;
    const result = await pool.query("SELECT value FROM settings WHERE key = 'pin_hash'");
    if (result.rows.length === 0 || !bcrypt.compareSync(currentPin, result.rows[0].value)) {
      return res.json({ success: false, message: 'Current PIN is incorrect' });
    }
    const hash = bcrypt.hashSync(newPin, 10);
    await pool.query("UPDATE settings SET value = $1 WHERE key = 'pin_hash'", [hash]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ==================== DASHBOARD API ====================
app.get('/api/dashboard', async (req, res) => {
  try {
    const totalItems = (await pool.query('SELECT COUNT(*) as count FROM ppe_items')).rows[0].count;
    const totalStock = (await pool.query('SELECT COALESCE(SUM(current_stock), 0) as total FROM ppe_items')).rows[0].total;
    const lowStockItems = (await pool.query('SELECT COUNT(*) as count FROM ppe_items WHERE current_stock <= minimum_stock')).rows[0].count;
    const totalClients = (await pool.query('SELECT COUNT(*) as count FROM clients')).rows[0].count;
    const recentTransactions = (await pool.query(`SELECT t.*, p.ppe_name, c.company_name FROM transactions t LEFT JOIN ppe_items p ON t.ppe_id = p.id LEFT JOIN clients c ON t.client_id = c.id ORDER BY t.id DESC LIMIT 10`)).rows;
    const stockChart = (await pool.query(`SELECT ppe_name, current_stock, minimum_stock FROM ppe_items ORDER BY current_stock DESC LIMIT 12`)).rows;
    const monthlyIn = (await pool.query(`SELECT TO_CHAR(date::date, 'YYYY-MM') as month, SUM(quantity) as total FROM transactions WHERE transaction_type = 'IN' GROUP BY month ORDER BY month DESC LIMIT 6`)).rows.reverse();
    const monthlyOut = (await pool.query(`SELECT TO_CHAR(date::date, 'YYYY-MM') as month, SUM(quantity) as total FROM transactions WHERE transaction_type = 'OUT' GROUP BY month ORDER BY month DESC LIMIT 6`)).rows.reverse();
    res.json({ totalItems, totalStock, lowStockItems, totalClients, recentTransactions, stockChart, monthlyIn, monthlyOut });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== PPE ITEMS API ====================
app.get('/api/ppe', async (req, res) => {
  try {
    const { search } = req.query;
    if (search) {
      const result = await pool.query(`SELECT * FROM ppe_items WHERE ppe_name ILIKE $1 OR category ILIKE $2 ORDER BY id DESC`, [`%${search}%`, `%${search}%`]);
      res.json(result.rows);
    } else {
      const result = await pool.query('SELECT * FROM ppe_items ORDER BY id DESC');
      res.json(result.rows);
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/ppe/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM ppe_items WHERE id = $1', [req.params.id]);
    res.json(result.rows[0] || {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ppe', async (req, res) => {
  const { ppe_name, category, size, unit, current_stock, minimum_stock } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO ppe_items (ppe_name, category, size, unit, current_stock, minimum_stock) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [ppe_name, category, size || null, unit || 'pcs', current_stock || 0, minimum_stock || 10]
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.put('/api/ppe/:id', async (req, res) => {
  const { ppe_name, category, size, unit, current_stock, minimum_stock } = req.body;
  try {
    await pool.query(
      'UPDATE ppe_items SET ppe_name=$1, category=$2, size=$3, unit=$4, current_stock=$5, minimum_stock=$6 WHERE id=$7',
      [ppe_name, category, size || null, unit, current_stock, minimum_stock, req.params.id]
    );
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.delete('/api/ppe/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM ppe_items WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ==================== CLIENTS API ====================
app.get('/api/clients', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM clients ORDER BY id DESC');
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/clients/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    res.json(result.rows[0] || {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/clients/:id/history', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT d.*, p.ppe_name FROM distribution d LEFT JOIN ppe_items p ON d.ppe_id = p.id WHERE d.client_id = $1 ORDER BY d.id DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clients', async (req, res) => {
  const { company_name, contact_person, contact_number, project_location } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO clients (company_name, contact_person, contact_number, project_location) VALUES ($1, $2, $3, $4) RETURNING id',
      [company_name, contact_person, contact_number, project_location]
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.put('/api/clients/:id', async (req, res) => {
  const { company_name, contact_person, contact_number, project_location } = req.body;
  try {
    await pool.query(
      'UPDATE clients SET company_name=$1, contact_person=$2, contact_number=$3, project_location=$4 WHERE id=$5',
      [company_name, contact_person, contact_number, project_location, req.params.id]
    );
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ==================== INCOMING PPE API ====================
app.get('/api/incoming', async (req, res) => {
  try {
    const result = await pool.query(`SELECT i.*, p.ppe_name FROM incoming_ppe i LEFT JOIN ppe_items p ON i.ppe_id = p.id ORDER BY i.id DESC`);
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/incoming', async (req, res) => {
  const { date_received, ppe_id, quantity, supplier, received_by, remarks } = req.body;
  const qty = parseInt(quantity);
  if (qty <= 0) return res.json({ success: false, message: 'Quantity must be greater than 0' });
  try {
    const ppeResult = await pool.query('SELECT * FROM ppe_items WHERE id = $1', [ppe_id]);
    if (ppeResult.rows.length === 0) return res.json({ success: false, message: 'PPE item not found' });
    
    await pool.query(
      'INSERT INTO incoming_ppe (date_received, ppe_id, quantity, supplier, received_by, remarks) VALUES ($1, $2, $3, $4, $5, $6)',
      [date_received, ppe_id, qty, supplier, received_by, remarks]
    );
    await pool.query('UPDATE ppe_items SET current_stock = current_stock + $1 WHERE id = $2', [qty, ppe_id]);
    await pool.query(
      'INSERT INTO transactions (ppe_id, transaction_type, quantity, date, responsible_person, remarks) VALUES ($1, $2, $3, $4, $5, $6)',
      [ppe_id, 'IN', qty, date_received, received_by, remarks]
    );
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ==================== DISTRIBUTION API ====================
app.get('/api/distribution', async (req, res) => {
  try {
    const result = await pool.query(`SELECT d.*, p.ppe_name, c.company_name FROM distribution d LEFT JOIN ppe_items p ON d.ppe_id = p.id LEFT JOIN clients c ON d.client_id = c.id ORDER BY d.id DESC`);
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/distribution', async (req, res) => {
  const { date_issued, client_id, ppe_id, quantity, issued_by, remarks } = req.body;
  const qty = parseInt(quantity);
  if (qty <= 0) return res.json({ success: false, message: 'Quantity must be greater than 0' });
  try {
    const ppeResult = await pool.query('SELECT * FROM ppe_items WHERE id = $1', [ppe_id]);
    if (ppeResult.rows.length === 0) return res.json({ success: false, message: 'PPE item not found' });
    const ppe = ppeResult.rows[0];
    if (ppe.current_stock < qty) return res.json({ success: false, message: `Insufficient stock. Available: ${ppe.current_stock} ${ppe.unit}` });

    await pool.query(
      'INSERT INTO distribution (date_issued, client_id, ppe_id, quantity, issued_by, remarks) VALUES ($1, $2, $3, $4, $5, $6)',
      [date_issued, client_id, ppe_id, qty, issued_by, remarks]
    );
    await pool.query('UPDATE ppe_items SET current_stock = current_stock - $1 WHERE id = $2', [qty, ppe_id]);
    await pool.query(
      'INSERT INTO transactions (ppe_id, transaction_type, quantity, client_id, date, responsible_person, remarks) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [ppe_id, 'OUT', qty, client_id, date_issued, issued_by, remarks]
    );
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ==================== TRANSACTIONS API ====================
app.get('/api/transactions', async (req, res) => {
  try {
    const { search, type, date_from, date_to } = req.query;
    let sql = `SELECT t.*, p.ppe_name, c.company_name FROM transactions t LEFT JOIN ppe_items p ON t.ppe_id = p.id LEFT JOIN clients c ON t.client_id = c.id WHERE 1=1`;
    const params = [];
    let paramIndex = 1;
    if (search) {
      sql += ` AND (p.ppe_name ILIKE $${paramIndex} OR c.company_name ILIKE $${paramIndex + 1} OR t.responsible_person ILIKE $${paramIndex + 2})`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      paramIndex += 3;
    }
    if (type) { sql += ` AND t.transaction_type = $${paramIndex}`; params.push(type); paramIndex++; }
    if (date_from) { sql += ` AND t.date >= $${paramIndex}`; params.push(date_from); paramIndex++; }
    if (date_to) { sql += ` AND t.date <= $${paramIndex}`; params.push(date_to); paramIndex++; }
    sql += ' ORDER BY t.id DESC';
    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== REPORTS API ====================
app.get('/api/reports/inventory', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM ppe_items ORDER BY ppe_name');
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/reports/received', async (req, res) => {
  try {
    const result = await pool.query(`SELECT i.*, p.ppe_name, p.unit FROM incoming_ppe i LEFT JOIN ppe_items p ON i.ppe_id = p.id ORDER BY i.date_received DESC`);
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/reports/issued', async (req, res) => {
  try {
    const result = await pool.query(`SELECT d.*, p.ppe_name, p.unit, c.company_name FROM distribution d LEFT JOIN ppe_items p ON d.ppe_id = p.id LEFT JOIN clients c ON d.client_id = c.id ORDER BY d.date_issued DESC`);
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/reports/excel/:type', async (req, res) => {
  const { type } = req.params;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TAASCOR PPE Inventory System';

  const headerStyle = { font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A6B' } }, alignment: { horizontal: 'center', vertical: 'middle' }, border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } } };
  const cellBorder = { top: { style: 'thin', color: { argb: 'FFD0D0D0' } }, bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } }, left: { style: 'thin', color: { argb: 'FFD0D0D0' } }, right: { style: 'thin', color: { argb: 'FFD0D0D0' } } };

  function addCompanyHeader(ws, title, colEnd) {
    ws.mergeCells(`A1:${colEnd}1`);
    ws.getCell('A1').value = 'TAASCOR MANAGEMENT & GENERAL SERVICES CORP.';
    ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF1A3A6B' } };
    ws.getCell('A1').alignment = { horizontal: 'center' };
    ws.mergeCells(`A2:${colEnd}2`);
    ws.getCell('A2').value = title;
    ws.getCell('A2').font = { bold: true, size: 11, color: { argb: 'FFC41230' } };
    ws.getCell('A2').alignment = { horizontal: 'center' };
    ws.mergeCells(`A3:${colEnd}3`);
    ws.getCell('A3').value = `Generated: ${new Date().toLocaleDateString()}`;
    ws.getCell('A3').alignment = { horizontal: 'center' };
    ws.getCell('A3').font = { size: 9, color: { argb: 'FF666666' } };
    ws.addRow([]);
  }

  try {
    if (type === 'inventory') {
      const ws = workbook.addWorksheet('PPE Inventory');
      addCompanyHeader(ws, 'PPE Inventory Summary Report', 'G');
      const r = ws.addRow(['ID', 'PPE Name', 'Category', 'Unit', 'Current Stock', 'Min Stock', 'Status']);
      r.eachCell(c => { c.font = headerStyle.font; c.fill = headerStyle.fill; c.alignment = headerStyle.alignment; c.border = headerStyle.border; });
      const items = (await pool.query('SELECT * FROM ppe_items ORDER BY ppe_name')).rows;
      items.forEach(item => {
        const status = item.current_stock <= item.minimum_stock ? '⚠ LOW STOCK' : '✓ OK';
        const row = ws.addRow([item.id, item.ppe_name, item.category, item.unit, item.current_stock, item.minimum_stock, status]);
        row.eachCell(c => { c.border = cellBorder; c.alignment = { vertical: 'middle' }; });
        if (item.current_stock <= item.minimum_stock) { row.getCell(5).font = { color: { argb: 'FFFF0000' }, bold: true }; row.getCell(7).font = { color: { argb: 'FFFF0000' }, bold: true }; }
      });
      ws.columns.forEach(c => { c.width = 18; }); ws.getColumn(2).width = 30;
    } else if (type === 'received') {
      const ws = workbook.addWorksheet('Received History');
      addCompanyHeader(ws, 'PPE Received History Report', 'G');
      const r = ws.addRow(['ID', 'Date Received', 'PPE Item', 'Quantity', 'Supplier', 'Received By', 'Remarks']);
      r.eachCell(c => { c.font = headerStyle.font; c.fill = headerStyle.fill; c.alignment = headerStyle.alignment; c.border = headerStyle.border; });
      const items = (await pool.query('SELECT i.*, p.ppe_name FROM incoming_ppe i LEFT JOIN ppe_items p ON i.ppe_id = p.id ORDER BY i.date_received DESC')).rows;
      items.forEach(item => {
        const row = ws.addRow([item.id, item.date_received, item.ppe_name, item.quantity, item.supplier, item.received_by, item.remarks]);
        row.eachCell(c => { c.border = cellBorder; c.alignment = { vertical: 'middle' }; });
      });
      ws.columns.forEach(c => { c.width = 18; });
    } else if (type === 'issued') {
      const ws = workbook.addWorksheet('Issued to Clients');
      addCompanyHeader(ws, 'PPE Issued to Clients Report', 'G');
      const r = ws.addRow(['ID', 'Date Issued', 'Client Company', 'PPE Item', 'Quantity', 'Issued By', 'Remarks']);
      r.eachCell(c => { c.font = headerStyle.font; c.fill = headerStyle.fill; c.alignment = headerStyle.alignment; c.border = headerStyle.border; });
      const items = (await pool.query('SELECT d.*, p.ppe_name, c.company_name FROM distribution d LEFT JOIN ppe_items p ON d.ppe_id = p.id LEFT JOIN clients c ON d.client_id = c.id ORDER BY d.date_issued DESC')).rows;
      items.forEach(item => {
        const row = ws.addRow([item.id, item.date_issued, item.company_name, item.ppe_name, item.quantity, item.issued_by, item.remarks]);
        row.eachCell(c => { c.border = cellBorder; c.alignment = { vertical: 'middle' }; });
      });
      ws.columns.forEach(c => { c.width = 18; });
    }
  } catch (e) { return res.status(500).json({ error: e.message }); }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=TAASCOR_PPE_${type}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  await workbook.xlsx.write(res);
  res.end();
});

// ==================== NETWORK INFO ====================
app.get('/api/network-info', (req, res) => {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({ name, address: iface.address });
      }
    }
  }
  res.json({ port: PORT, addresses });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
async function startServer() {
  await initDB();
  return new Promise((resolve) => {
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`TAASCOR PPE Inventory Server running on port ${PORT}`);
      const interfaces = os.networkInterfaces();
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
          if (iface.family === 'IPv4' && !iface.internal) {
            console.log(`  Phone access: http://${iface.address}:${PORT}`);
          }
        }
      }
      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer, app };
