import { app, BrowserWindow, shell } from 'electron';
import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { getLcuAsset, getLcuMayhemDetail, getLcuMayhemMatches } from './vite.config.js';

const mimeTypes = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};

let localServer;

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function sendError(response, error) {
  sendJson(response, error.status || 500, { message: error.message || '요청을 처리하는 중 오류가 발생했습니다.' });
}

async function handleApi(response, url) {
  if (url.pathname === '/api/lcu/mayhem') {
    const count = Math.max(1, Math.min(40, Number(url.searchParams.get('count')) || 20));
    sendJson(response, 200, await getLcuMayhemMatches(count));
    return true;
  }

  const detail = url.pathname.match(/^\/api\/lcu\/mayhem\/KR_(\d+)$/);
  if (detail) {
    sendJson(response, 200, await getLcuMayhemDetail(detail[1]));
    return true;
  }

  if (url.pathname === '/api/lcu/asset') {
    const asset = await getLcuAsset(url.searchParams.get('path'));
    response.writeHead(200, { 'Content-Type': asset.contentType });
    response.end(asset.bytes);
    return true;
  }
  return false;
}

function serveStatic(request, response) {
  const distPath = join(app.getAppPath(), 'web-dist');
  const requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const filePath = resolve(distPath, requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, ''));
  const target = filePath.startsWith(resolve(distPath)) && existsSync(filePath) ? filePath : join(distPath, 'index.html');
  response.writeHead(200, { 'Content-Type': mimeTypes[extname(target)] || 'application/octet-stream' });
  createReadStream(target).pipe(response);
}

async function startLocalServer() {
  localServer = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/')) {
        if (!(await handleApi(response, url))) sendJson(response, 404, { message: '존재하지 않는 API입니다.' });
        return;
      }
      serveStatic(request, response);
    } catch (error) {
      sendError(response, error);
    }
  });
  await new Promise((resolvePromise) => localServer.listen(0, '127.0.0.1', resolvePromise));
  return localServer.address().port;
}

function createWindow(port) {
  const window = new BrowserWindow({
    width: 1280, height: 860, minWidth: 980, minHeight: 680,
    autoHideMenuBar: true, backgroundColor: '#0a0d14',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.loadURL(`http://127.0.0.1:${port}`);
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => createWindow(await startLocalServer()));
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => localServer?.close());
