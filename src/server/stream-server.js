const http = require('http');
const path = require('path');
const fs = require('fs');

class StreamServer {
  constructor(port = 8554) {
    this.port = port;
    this.server = null;
    this.mjpegClients = new Set();
    this.latestFrame = null;
    this.isRunning = false;
    this.fps = 0;
    this.frameCount = 0;
    this.lastFpsCalc = Date.now();
  }

  start() {
    if (this.isRunning) return Promise.resolve(this.port);

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        // Enable CORS for web clients / OBS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = req.url.split('?')[0];

        if (url === '/' || url === '/obs') {
          // Serve the OBS Browser Source page
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>SnapJM - OBS Camera Feed</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
  </style>
</head>
<body>
  <img id="stream" src="/stream.mjpeg" alt="SnapJM Stream" />
  <script>
    const img = document.getElementById('stream');
    img.onerror = () => {
      setTimeout(() => { img.src = '/stream.mjpeg?t=' + Date.now(); }, 1000);
    };
  </script>
</body>
</html>`);
          return;
        }

        if (url === '/stream.mjpeg') {
          // Real-time MJPEG Stream for OBS / VLC
          res.writeHead(200, {
            'Content-Type': 'multipart/x-mixed-replace; boundary=--snapjmframe',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Connection': 'close',
            'Pragma': 'no-cache'
          });

          this.mjpegClients.add(res);

          // If we already have a frame, send it immediately
          if (this.latestFrame) {
            this.sendFrameToClient(res, this.latestFrame);
          }

          req.on('close', () => {
            this.mjpegClients.delete(res);
          });
          return;
        }

        if (url === '/snapshot.jpg') {
          if (this.latestFrame) {
            res.writeHead(200, { 'Content-Type': 'image/jpeg' });
            res.end(this.latestFrame);
          } else {
            res.writeHead(404);
            res.end('No frame available yet');
          }
          return;
        }

        if (url === '/status') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'running',
            clients: this.mjpegClients.size,
            fps: this.fps,
            port: this.port
          }));
          return;
        }

        res.writeHead(404);
        res.end('Not Found');
      });

      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`[StreamServer] Port ${this.port} in use, trying ${this.port + 1}`);
          this.port++;
          this.server.listen(this.port);
        } else {
          reject(err);
        }
      });

      this.server.listen(this.port, () => {
        this.isRunning = true;
        console.log(`[StreamServer] Running on http://localhost:${this.port}`);
        resolve(this.port);
      });
    });
  }

  stop() {
    if (!this.isRunning) return;
    this.mjpegClients.forEach((client) => {
      try { client.end(); } catch (_) {}
    });
    this.mjpegClients.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.isRunning = false;
    console.log('[StreamServer] Stopped');
  }

  sendFrameToClient(client, buffer) {
    try {
      client.write(`--snapjmframe\r\nContent-Type: image/jpeg\r\nContent-Length: ${buffer.length}\r\n\r\n`);
      client.write(buffer);
      client.write('\r\n');
    } catch (_) {
      this.mjpegClients.delete(client);
    }
  }

  pushFrame(buffer) {
    this.latestFrame = buffer;
    this.frameCount++;

    const now = Date.now();
    if (now - this.lastFpsCalc >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsCalc = now;
    }

    if (this.mjpegClients.size === 0) return;

    for (const client of this.mjpegClients) {
      this.sendFrameToClient(client, buffer);
    }
  }
}

module.exports = StreamServer;
