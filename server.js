const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'rsvp-data.json');

// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Default initial data
const INITIAL_DATA = {
  event: {
    title: 'May Harvest Corporation Christmas Party 2026',
    subtitle: 'Philippine Festival — Sama-sama sa Masayang Paskuhan! 🎊',
    eventDate: '2026-12-12',
    eventTime: '17:00',
    venueName: 'May Harvest Corporation',
    venueAddress: 'Brgy. Caysio, Santa Maria, Bulacan',
    dressCode: 'Makulay na festival attire / Filipiniana / Barong',
    rsvpDeadline: 'December 5, 2026',
    adminPin: process.env.ADMIN_PIN || '2026'
  },
  guests: [],
  lastUpdated: new Date().toISOString()
};

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(INITIAL_DATA, null, 2), 'utf8');
      return JSON.parse(JSON.stringify(INITIAL_DATA));
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[MHC Festival] Error reading data file:', err);
    return JSON.parse(JSON.stringify(INITIAL_DATA));
  }
}

function saveData(data) {
  try {
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[MHC Festival] Error writing data file:', err);
    return false;
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-cache, no-store, must-revalidate'
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 2 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Request payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  // Health check for Render
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('OK');
  }

  // API: Admin PIN Verification
  if (pathname === '/api/admin/verify' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const data = loadData();
      const validPin = data.event.adminPin || '2026';
      if (String(body.pin).trim() === String(validPin).trim()) {
        return sendJson(res, 200, { success: true, valid: true });
      }
      return sendJson(res, 401, { success: false, valid: false, error: 'Maling Admin PIN.' });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // API: Get Guest Manifest & Stats
  if (pathname === '/api/guests' && req.method === 'GET') {
    const data = loadData();
    const guests = data.guests || [];
    const attendingGuests = guests.filter(g => g.status === 'Attending');
    const declinedGuests = guests.filter(g => g.status === 'Declined');
    const checkedInGuests = guests.filter(g => g.checkedIn);

    const totalSeats = attendingGuests.reduce((acc, g) => acc + (parseInt(g.seats, 10) || 1), 0);
    const checkedInSeats = checkedInGuests.reduce((acc, g) => acc + (parseInt(g.seats, 10) || 1), 0);

    return sendJson(res, 200, {
      success: true,
      event: data.event,
      stats: {
        totalGuests: guests.length,
        attendingCount: attendingGuests.length,
        declinedCount: declinedGuests.length,
        totalSeats: totalSeats,
        checkedInCount: checkedInGuests.length,
        checkedInSeats: checkedInSeats
      },
      guests: guests
    });
  }

  // API: RSVP Submission
  if (pathname === '/api/rsvp' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      let mainName = String(body.name || '').trim();
      let guestList = Array.isArray(body.guests) ? body.guests : [];

      if (!mainName && guestList.length > 0) {
        mainName = typeof guestList[0] === 'string' ? guestList[0] : (guestList[0].name || '');
      }

      if (!mainName && body.status !== 'Declined') {
        return sendJson(res, 400, { error: 'Kailangan ilagay ang iyong pangalan.' });
      }

      const data = loadData();
      const code = 'MHC-' + Math.floor(100000 + Math.random() * 900000);
      const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
      const isDeclined = body.status === 'Declined';
      const seatsCount = isDeclined ? 0 : (guestList.length > 0 ? guestList.length : Math.max(1, parseInt(body.seats || body.count, 10) || 1));

      const guestDetails = guestList.length > 0 
        ? guestList.map(g => typeof g === 'string' ? g : `${g.name || 'Kasama'} (${g.type || 'Employee'})`).join(', ')
        : '';

      const guest = {
        id,
        ticketCode: code,
        name: mainName || 'MHC Employee',
        guestList: guestDetails,
        department: String(body.department || '').trim(),
        contact: String(body.contact || '').trim(),
        status: isDeclined ? 'Declined' : 'Attending',
        seats: seatsCount,
        wishes: String(body.wishes || body.message || '').trim(),
        tableNumber: '',
        checkedIn: false,
        checkedInAt: null,
        createdAt: new Date().toISOString()
      };

      data.guests.unshift(guest);
      saveData(data);

      return sendJson(res, 201, {
        success: true,
        message: isDeclined ? 'Naitala ang iyong sagot.' : 'Maligayang pagdating sa MHC Philippine Festival!',
        guest
      });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // API: Check-in via QR Scanner or Manual Query
  if (pathname === '/api/check-in' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const query = String(body.query || body.ticketCode || '').trim().toUpperCase();

      if (!query) {
        return sendJson(res, 400, { error: 'Ilagay ang Ticket Code o i-scan ang QR code.' });
      }

      const data = loadData();
      const guest = data.guests.find(g => 
        (g.ticketCode && g.ticketCode.toUpperCase() === query) ||
        (g.id && g.id.toUpperCase() === query)
      );

      if (!guest) {
        return sendJson(res, 404, { success: false, error: 'Hindi natagpuan ang Ticket Code sa talaan.' });
      }

      if (guest.status === 'Declined') {
        return sendJson(res, 400, { success: false, error: 'Ang ticket na ito ay minarkahang hindi dadalo.' });
      }

      if (guest.checkedIn) {
        return sendJson(res, 200, {
          success: true,
          alreadyCheckedIn: true,
          message: `Naka-check in na noong ${new Date(guest.checkedInAt).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}`,
          guest
        });
      }

      guest.checkedIn = true;
      guest.checkedInAt = new Date().toISOString();
      saveData(data);

      return sendJson(res, 200, {
        success: true,
        alreadyCheckedIn: false,
        message: 'Matagumpay na na-check in!',
        guest
      });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // API: Update Guest (Table Assignment, Status, Check-in)
  if (pathname.startsWith('/api/guests/') && req.method === 'PUT') {
    try {
      const id = pathname.replace('/api/guests/', '');
      const body = await parseBody(req);
      const data = loadData();
      const idx = data.guests.findIndex(g => g.id === id);

      if (idx === -1) {
        return sendJson(res, 404, { error: 'Hindi natagpuan ang bisita.' });
      }

      data.guests[idx] = { ...data.guests[idx], ...body };
      saveData(data);
      return sendJson(res, 200, { success: true, guest: data.guests[idx] });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  // API: Delete Guest
  if (pathname.startsWith('/api/guests/') && req.method === 'DELETE') {
    const id = pathname.replace('/api/guests/', '');
    const data = loadData();
    const initialLen = data.guests.length;
    data.guests = data.guests.filter(g => g.id !== id);

    if (data.guests.length === initialLen) {
      return sendJson(res, 404, { error: 'Hindi natagpuan ang bisita.' });
    }

    saveData(data);
    return sendJson(res, 200, { success: true });
  }

  // API: Export CSV Masterlist (Excel BOM compatible)
  if (pathname === '/api/export' && req.method === 'GET') {
    const data = loadData();
    const guests = data.guests || [];

    const headers = ['Ticket Code', 'Pangalan', 'Status', 'Bilang ng Upuan / Tao', 'Nakasamang Bisita', 'Mesa / Table #', 'Checked-in', 'Oras ng Check-in', 'Mensahe', 'Petsa ng RSVP'];
    const rows = guests.map(g => [
      `"${g.ticketCode || ''}"`,
      `"${(g.name || '').replace(/"/g, '""')}"`,
      `"${g.status || ''}"`,
      g.seats || 0,
      `"${(g.guestList || '').replace(/"/g, '""')}"`,
      `"${(g.tableNumber || '').replace(/"/g, '""')}"`,
      g.checkedIn ? 'YES' : 'NO',
      `"${g.checkedInAt ? new Date(g.checkedInAt).toLocaleString('en-PH') : ''}"`,
      `"${(g.wishes || '').replace(/"/g, '""')}"`,
      `"${g.createdAt ? new Date(g.createdAt).toLocaleString('en-PH') : ''}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');

    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="MHC_Christmas_Party_2026_Masterlist.csv"',
      'Cache-Control': 'no-cache'
    });
    return res.end(csvContent);
  }

  // Static File Serving
  let relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  try {
    relativePath = decodeURIComponent(relativePath);
  } catch (e) {}

  let filePath = path.join(__dirname, relativePath);

  if (pathname === '/admin' || pathname === '/dashboard') {
    filePath = path.join(__dirname, 'admin.html');
  } else if (pathname === '/scanner' || pathname === '/checkin') {
    filePath = path.join(__dirname, 'scanner.html');
  } else if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(__dirname, 'index.html');
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    return fs.createReadStream(filePath).pipe(res);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found - May Harvest Corporation Philippine Festival RSVP');
});

server.listen(PORT, () => {
  console.log(`[MHC Philippine Festival] Server is running smoothly on port ${PORT}`);
  console.log(`[MHC Philippine Festival] Local URL: http://localhost:${PORT}`);
});
