const path = require('path');
const { startServer } = require('./server');

// Try to load Electron — if not available (cloud/server mode), just run the Express server
let electronApp, BrowserWindow;
try {
    const electron = require('electron');
    electronApp = electron.app;
    BrowserWindow = electron.BrowserWindow;
} catch (e) {
    // Electron not installed (running on cloud like Render)
    console.log('Running in server-only mode (no Electron)...');
    startServer().then(() => {
        console.log('TAASCOR PPE Inventory is running!');
    });
}

if (electronApp) {
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
