const path = require('path');
const { startServer } = require('./server');

// Detect if we can actually use Electron (won't work on cloud/headless servers)
let electronApp, BrowserWindow;
try {
    const electron = require('electron');
    if (electron && electron.app) {
        electronApp = electron.app;
        BrowserWindow = electron.BrowserWindow;
    }
} catch (e) {
    // Electron not installed
}

// CLOUD / SERVER MODE — no Electron available
if (!electronApp) {
    console.log('Starting in server-only mode...');
    startServer()
        .then(() => {
            console.log('TAASCOR PPE Inventory is running!');
        })
        .catch((err) => {
            console.error('Failed to start server:', err);
            process.exit(1);
        });
} else {
    // DESKTOP MODE — Electron available
    let mainWindow;

    async function createWindow() {
        await startServer();

        mainWindow = new BrowserWindow({
            width: 1400,
            height: 900,
            minWidth: 1000,
            minHeight: 700,
            title: 'TAASCOR PPE Inventory Management System',
            icon: path.join(__dirname, 'public', 'logo-le-reacteur.png'),
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true
            },
            autoHideMenuBar: true,
            show: false
        });

        mainWindow.loadURL('http://localhost:3456');

        mainWindow.once('ready-to-show', () => {
            mainWindow.show();
            mainWindow.maximize();
        });

        mainWindow.on('closed', () => {
            mainWindow = null;
        });
    }

    electronApp.whenReady().then(createWindow);

    electronApp.on('window-all-closed', () => {
        electronApp.quit();
    });

    electronApp.on('activate', () => {
        if (mainWindow === null) createWindow();
    });
}
