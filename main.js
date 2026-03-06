const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { startServer } = require('./server');

let mainWindow;

async function createWindow() {
    // Start the Express server first
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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    app.quit();
});

app.on('activate', () => {
    if (mainWindow === null) createWindow();
});
