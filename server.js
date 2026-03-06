const express = require('express');
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3456;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_PATH = path.join(__dirname, 'taascor_ppe.db');
let db;

// Save database to file
function saveDB() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Initialize database
async function initDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const file = fs.readFileSync(DB_PATH);
    db = new SQL.Database(file);
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS ppe_items (id INTEGER PRIMARY KEY AUTOINCREMENT, ppe_name TEXT NOT NULL, category TEXT NOT NULL, unit TEXT NOT NULL DEFAULT 'pcs', current_stock INTEGER NOT NULL DEFAULT 0, minimum_stock INTEGER NOT NULL DEFAULT 10, date_added TEXT NOT NULL DEFAULT (date('now')))`);
  db.run(`CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY AUTOINCREMENT, company_name TEXT NOT NULL, contact_person TEXT, contact_number TEXT, project_location TEXT, date_added TEXT NOT NULL DEFAULT (date('now')))`);
  db.run(`CREATE TABLE IF NOT EXISTS incoming_ppe (id INTEGER PRIMARY KEY AUTOINCREMENT, date_received TEXT NOT NULL, ppe_id INTEGER NOT NULL, quantity INTEGER NOT NULL, supplier TEXT, received_by TEXT, remarks TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS distribution (id INTEGER PRIMARY KEY AUTOINCREMENT, date_issued TEXT NOT NULL, client_id INTEGER NOT NULL, ppe_id INTEGER NOT NULL, quantity INTEGER NOT NULL, issued_by TEXT, remarks TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, ppe_id INTEGER NOT NULL, transaction_type TEXT NOT NULL, quantity INTEGER NOT NULL, client_id INTEGER, date TEXT NOT NULL, responsible_person TEXT, remarks TEXT)`);

  const pinCheck = db.exec("SELECT value FROM settings WHERE key = 'pin_hash'");
  if (pinCheck.length === 0 || pinCheck[0].values.length === 0) {
    const hash = bcrypt.hashSync('000000', 10);
    db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('pin_hash', ?)", [hash]);
  }
  saveDB();
}

// Helper: run query and return array of objects
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}
function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// ==================== PIN API ====================
app.post('/api/pin/verify', (req, res) => {
  const { pin } = req.body;
  const row = queryOne("SELECT value FROM settings WHERE key = 'pin_hash'");
  if (row && bcrypt.compareSync(pin, row.value)) {
    res.json({ success: true });
  } else {
    res.json({ success: false, message: 'Invalid PIN' });
  }
});

app.post('/api/pin/change', (req, res) => {
  const { currentPin, newPin } = req.body;
  const row = queryOne("SELECT value FROM settings WHERE key = 'pin_hash'");
  if (!row || !bcrypt.compareSync(currentPin, row.value)) {
    return res.json({ success: false, message: 'Current PIN is incorrect' });
  }
  const hash = bcrypt.hashSync(newPin, 10);
  db.run("UPDATE settings SET value = ? WHERE key = 'pin_hash'", [hash]);
  saveDB();
  res.json({ success: true });
});

// ==================== DASHBOARD API ====================
app.get('/api/dashboard', (req, res) => {
  const totalItems = queryOne('SELECT COUNT(*) as count FROM ppe_items').count;
  const totalStock = queryOne('SELECT COALESCE(SUM(current_stock), 0) as total FROM ppe_items').total;
  const lowStockItems = queryOne('SELECT COUNT(*) as count FROM ppe_items WHERE current_stock <= minimum_stock').count;
  const totalClients = queryOne('SELECT COUNT(*) as count FROM clients').count;
  const recentTransactions = queryAll(`SELECT t.*, p.ppe_name, c.company_name FROM transactions t LEFT JOIN ppe_items p ON t.ppe_id = p.id LEFT JOIN clients c ON t.client_id = c.id ORDER BY t.id DESC LIMIT 10`);
  const stockChart = queryAll(`SELECT ppe_name, current_stock, minimum_stock FROM ppe_items ORDER BY current_stock DESC LIMIT 12`);
  const monthlyIn = queryAll(`SELECT strftime('%Y-%m', date) as month, SUM(quantity) as total FROM transactions WHERE transaction_type = 'IN' GROUP BY month ORDER BY month DESC LIMIT 6`).reverse();
  const monthlyOut = queryAll(`SELECT strftime('%Y-%m', date) as month, SUM(quantity) as total FROM transactions WHERE transaction_type = 'OUT' GROUP BY month ORDER BY month DESC LIMIT 6`).reverse();
  res.json({ totalItems, totalStock, lowStockItems, totalClients, recentTransactions, stockChart, monthlyIn, monthlyOut });
});

// ==================== PPE ITEMS API ====================
app.get('/api/ppe', (req, res) => {
  const { search } = req.query;
  if (search) {
    res.json(queryAll(`SELECT * FROM ppe_items WHERE ppe_name LIKE ? OR category LIKE ? ORDER BY id DESC`, [`%${search}%`, `%${search}%`]));
  } else {
    res.json(queryAll('SELECT * FROM ppe_items ORDER BY id DESC'));
  }
});

app.get('/api/ppe/:id', (req, res) => {
  res.json(queryOne('SELECT * FROM ppe_items WHERE id = ?', [req.params.id]) || {});
});

app.post('/api/ppe', (req, res) => {
  const { ppe_name, category, unit, current_stock, minimum_stock } = req.body;
  try {
    db.run('INSERT INTO ppe_items (ppe_name, category, unit, current_stock, minimum_stock) VALUES (?, ?, ?, ?, ?)',
      [ppe_name, category, unit || 'pcs', current_stock || 0, minimum_stock || 10]);
    saveDB();
    res.json({ success: true, id: db.exec("SELECT last_insert_rowid()")[0].values[0][0] });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.put('/api/ppe/:id', (req, res) => {
  const { ppe_name, category, unit, current_stock, minimum_stock } = req.body;
  try {
    db.run('UPDATE ppe_items SET ppe_name=?, category=?, unit=?, current_stock=?, minimum_stock=? WHERE id=?',
      [ppe_name, category, unit, current_stock, minimum_stock, req.params.id]);
    saveDB();
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.delete('/api/ppe/:id', (req, res) => {
  try {
    db.run('DELETE FROM ppe_items WHERE id = ?', [req.params.id]);
    saveDB();
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ==================== CLIENTS API ====================
app.get('/api/clients', (req, res) => {
  res.json(queryAll('SELECT * FROM clients ORDER BY id DESC'));
});

app.get('/api/clients/:id', (req, res) => {
  res.json(queryOne('SELECT * FROM clients WHERE id = ?', [req.params.id]) || {});
});

app.get('/api/clients/:id/history', (req, res) => {
  res.json(queryAll(`SELECT d.*, p.ppe_name FROM distribution d LEFT JOIN ppe_items p ON d.ppe_id = p.id WHERE d.client_id = ? ORDER BY d.id DESC`, [req.params.id]));
});

app.post('/api/clients', (req, res) => {
  const { company_name, contact_person, contact_number, project_location } = req.body;
  try {
    db.run('INSERT INTO clients (company_name, contact_person, contact_number, project_location) VALUES (?, ?, ?, ?)',
      [company_name, contact_person, contact_number, project_location]);
    saveDB();
    res.json({ success: true, id: db.exec("SELECT last_insert_rowid()")[0].values[0][0] });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.put('/api/clients/:id', (req, res) => {
  const { company_name, contact_person, contact_number, project_location } = req.body;
  try {
    db.run('UPDATE clients SET company_name=?, contact_person=?, contact_number=?, project_location=? WHERE id=?',
      [company_name, contact_person, contact_number, project_location, req.params.id]);
    saveDB();
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ==================== INCOMING PPE API ====================
app.get('/api/incoming', (req, res) => {
  res.json(queryAll(`SELECT i.*, p.ppe_name FROM incoming_ppe i LEFT JOIN ppe_items p ON i.ppe_id = p.id ORDER BY i.id DESC`));
});

app.post('/api/incoming', (req, res) => {
  const { date_received, ppe_id, quantity, supplier, received_by, remarks } = req.body;
  const qty = parseInt(quantity);
  if (qty <= 0) return res.json({ success: false, message: 'Quantity must be greater than 0' });
  const ppe = queryOne('SELECT * FROM ppe_items WHERE id = ?', [ppe_id]);
  if (!ppe) return res.json({ success: false, message: 'PPE item not found' });
  try {
    db.run('INSERT INTO incoming_ppe (date_received, ppe_id, quantity, supplier, received_by, remarks) VALUES (?, ?, ?, ?, ?, ?)',
      [date_received, ppe_id, qty, supplier, received_by, remarks]);
    db.run('UPDATE ppe_items SET current_stock = current_stock + ? WHERE id = ?', [qty, ppe_id]);
    db.run('INSERT INTO transactions (ppe_id, transaction_type, quantity, date, responsible_person, remarks) VALUES (?, ?, ?, ?, ?, ?)',
      [ppe_id, 'IN', qty, date_received, received_by, remarks]);
    saveDB();
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ==================== DISTRIBUTION API ====================
app.get('/api/distribution', (req, res) => {
  res.json(queryAll(`SELECT d.*, p.ppe_name, c.company_name FROM distribution d LEFT JOIN ppe_items p ON d.ppe_id = p.id LEFT JOIN clients c ON d.client_id = c.id ORDER BY d.id DESC`));
});

app.post('/api/distribution', (req, res) => {
  const { date_issued, client_id, ppe_id, quantity, issued_by, remarks } = req.body;
  const qty = parseInt(quantity);
  if (qty <= 0) return res.json({ success: false, message: 'Quantity must be greater than 0' });
  const ppe = queryOne('SELECT * FROM ppe_items WHERE id = ?', [ppe_id]);
  if (!ppe) return res.json({ success: false, message: 'PPE item not found' });
  if (ppe.current_stock < qty) return res.json({ success: false, message: `Insufficient stock. Available: ${ppe.current_stock} ${ppe.unit}` });
  try {
    db.run('INSERT INTO distribution (date_issued, client_id, ppe_id, quantity, issued_by, remarks) VALUES (?, ?, ?, ?, ?, ?)',
      [date_issued, client_id, ppe_id, qty, issued_by, remarks]);
    db.run('UPDATE ppe_items SET current_stock = current_stock - ? WHERE id = ?', [qty, ppe_id]);
    db.run('INSERT INTO transactions (ppe_id, transaction_type, quantity, client_id, date, responsible_person, remarks) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [ppe_id, 'OUT', qty, client_id, date_issued, issued_by, remarks]);
    saveDB();
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ==================== TRANSACTIONS API ====================
app.get('/api/transactions', (req, res) => {
  const { search, type, date_from, date_to } = req.query;
  let sql = `SELECT t.*, p.ppe_name, c.company_name FROM transactions t LEFT JOIN ppe_items p ON t.ppe_id = p.id LEFT JOIN clients c ON t.client_id = c.id WHERE 1=1`;
  const params = [];
  if (search) { sql += ' AND (p.ppe_name LIKE ? OR c.company_name LIKE ? OR t.responsible_person LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (type) { sql += ' AND t.transaction_type = ?'; params.push(type); }
  if (date_from) { sql += ' AND t.date >= ?'; params.push(date_from); }
  if (date_to) { sql += ' AND t.date <= ?'; params.push(date_to); }
  sql += ' ORDER BY t.id DESC';
  res.json(queryAll(sql, params));
});

// ==================== REPORTS API ====================
app.get('/api/reports/inventory', (req, res) => res.json(queryAll('SELECT * FROM ppe_items ORDER BY ppe_name')));
app.get('/api/reports/received', (req, res) => res.json(queryAll(`SELECT i.*, p.ppe_name, p.unit FROM incoming_ppe i LEFT JOIN ppe_items p ON i.ppe_id = p.id ORDER BY i.date_received DESC`)));
app.get('/api/reports/issued', (req, res) => res.json(queryAll(`SELECT d.*, p.ppe_name, p.unit, c.company_name FROM distribution d LEFT JOIN ppe_items p ON d.ppe_id = p.id LEFT JOIN clients c ON d.client_id = c.id ORDER BY d.date_issued DESC`)));

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

  if (type === 'inventory') {
    const ws = workbook.addWorksheet('PPE Inventory');
    addCompanyHeader(ws, 'PPE Inventory Summary Report', 'G');
    const r = ws.addRow(['ID', 'PPE Name', 'Category', 'Unit', 'Current Stock', 'Min Stock', 'Status']);
    r.eachCell(c => { c.font = headerStyle.font; c.fill = headerStyle.fill; c.alignment = headerStyle.alignment; c.border = headerStyle.border; });
    queryAll('SELECT * FROM ppe_items ORDER BY ppe_name').forEach(item => {
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
    queryAll('SELECT i.*, p.ppe_name FROM incoming_ppe i LEFT JOIN ppe_items p ON i.ppe_id = p.id ORDER BY i.date_received DESC').forEach(item => {
      const row = ws.addRow([item.id, item.date_received, item.ppe_name, item.quantity, item.supplier, item.received_by, item.remarks]);
      row.eachCell(c => { c.border = cellBorder; c.alignment = { vertical: 'middle' }; });
    });
    ws.columns.forEach(c => { c.width = 18; });
  } else if (type === 'issued') {
    const ws = workbook.addWorksheet('Issued to Clients');
    addCompanyHeader(ws, 'PPE Issued to Clients Report', 'G');
    const r = ws.addRow(['ID', 'Date Issued', 'Client Company', 'PPE Item', 'Quantity', 'Issued By', 'Remarks']);
    r.eachCell(c => { c.font = headerStyle.font; c.fill = headerStyle.fill; c.alignment = headerStyle.alignment; c.border = headerStyle.border; });
    queryAll('SELECT d.*, p.ppe_name, c.company_name FROM distribution d LEFT JOIN ppe_items p ON d.ppe_id = p.id LEFT JOIN clients c ON d.client_id = c.id ORDER BY d.date_issued DESC').forEach(item => {
      const row = ws.addRow([item.id, item.date_issued, item.company_name, item.ppe_name, item.quantity, item.issued_by, item.remarks]);
      row.eachCell(c => { c.border = cellBorder; c.alignment = { vertical: 'middle' }; });
    });
    ws.columns.forEach(c => { c.width = 18; });
  }

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
