// server.js - MAIN ENTRY POINT
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { initDB } = require('./core/db');
const { connectTikTok } = require('./core/tiktok-connector');
const { setupSocket } = require('./core/socket-handler');
const cron = require('node-cron');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*" }
});

// Config
const CONFIG = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
global.CONFIG = CONFIG;

// Middleware
app.use(express.static('public'));
app.use('/dashboard', express.static('dashboard'));
app.use('/overlays', express.static('overlays'));
app.use('/static', express.static('static'));

// Routes
app.get('/', (req, res) => res.send('UNDERCOVER BATTLEBOX - LIVE'));
app.get('/health', (req, res) => res.json({ status: 'OK', time: new Date() }));

// Init
async function start() {
  await initDB();
  console.log('DB initialized');

  setupSocket(io);
  await connectTikTok(io);

  // Daily reset at midnight
  cron.schedule('0 0 * * *', () => {
    console.log('Daily reset triggered');
    require('./core/cron-jobs').resetTwists();
  });

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`BATTLEBOX LIVE op http://localhost:${PORT}`);
    console.log(`Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`Overlays: http://localhost:${PORT}/overlays/scoreboard.html`);
  });
}

start();