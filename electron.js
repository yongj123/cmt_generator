const { app, BrowserWindow } = require('electron');
const path =require('path');
const child_process = require('child_process');
const portfinder = require('portfinder');

let mainWindow;
let expressApp;

// Function to find an available port and start the Express app
async function startExpressApp() {
    // Get userData path after app is ready
    const userDataPath = app.getPath('userData');
    const appDataTempDir = path.join(userDataPath, 'temp');
    const appDataOutputDir = path.join(userDataPath, 'output');

    const port = await portfinder.getPortPromise({
        port: 3333,    // 修改起始端口为 3333
        stopPort: 3383 // 相应调整停止端口 (例如 3333 + 50)
    });

    return new Promise((resolve, reject) => {
        // Start the app.js (Express server) as a child process
        // We pass the selected port and writable directory paths to the Express app via environment variables
        expressApp = child_process.fork(path.join(__dirname, 'app.js'), [], {
            env: { 
                ...process.env, 
                PORT: port,
                APP_TEMP_DIR: appDataTempDir,
                APP_OUTPUT_DIR: appDataOutputDir,
                APP_PATH: app.getAppPath()
            },
            silent: false // Set to true to suppress output from child process
        });

        expressApp.on('message', (message) => {
            if (message === 'SERVER_STARTED') {
                console.log(`Express server started on port ${port}`);
                console.log(`Using TEMP_DIR: ${appDataTempDir}`);
                console.log(`Using OUTPUT_DIR: ${appDataOutputDir}`);
                resolve(port);
            }
        });
        
        expressApp.on('error', (err) => {
            console.error('Failed to start Express app:', err);
            reject(err);
        });

        expressApp.on('exit', (code) => {
            console.log(`Express app exited with code ${code}`);
            // Handle unexpected exit if necessary
        });
    });
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false, // It's generally a good practice to keep this false
      contextIsolation: true, // And this true for security
      // preload: path.join(__dirname, 'preload.js') // Optional: if you need a preload script
    }
  });

  // Load the Express app
  const appUrl = `http://localhost:${port}`;
  mainWindow.loadURL(appUrl);

  // Open the DevTools (optional)
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.on('ready', async () => {
    try {
        const port = await startExpressApp();
        createWindow(port);
    } catch (error) {
        console.error("Error during app initialization:", error);
        app.quit(); // Quit if Express app fails to start
    }
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    // Re-create window if app is activated and no window is open (macOS behavior)
    startExpressApp().then(port => createWindow(port)).catch(err => {
        console.error("Error on activate:", err);
        app.quit();
    });
  }
});

// Quit Express app when Electron app quits
app.on('will-quit', () => {
  if (expressApp) {
    console.log('Stopping Express app...');
    expressApp.kill();
  }
});

// Modify app.js to send a message when the server has started
// Add this to your app.js where the server starts listening:
//
// server.listen(PORT, () => {
//   console.log(`Server is running on port ${PORT}`);
//   if (process.send) { // Check if it's a child process (forked)
//     process.send('SERVER_STARTED');
//   }
// });
//
// Make sure app.js uses the PORT from process.env.PORT
// const PORT = process.env.PORT || 3000; // (already in your app.js, ensure it's used) 