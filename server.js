// ================================================================
// 木板1v1 - 联机中继服务器 (Node.js + ws)
// 作用：不做任何游戏逻辑计算，只负责把每个玩家的状态广播给房间里的其他人。
// 部署到 Render / Railway 后，把生成的 wss://xxx.onrender.com 地址填进
// 客户端游戏里的 SERVER_URL 常量即可联机。
// ================================================================

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8787;

// 房间表：roomId -> Map<playerId, ws>
const rooms = new Map();

// 内存排行榜：{name, kills} 数组，按 kills 降序，保留前100
let leaderboard = [];

function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Map());
  return rooms.get(roomId);
}

function broadcast(roomId, data, exceptId) {
  const room = getRoom(roomId);
  const msg = JSON.stringify(data);
  for (const [pid, sock] of room) {
    if (pid !== exceptId && sock.readyState === sock.OPEN) sock.send(msg);
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(body));
  });
}

const httpServer = http.createServer(async (req, res) => {
  // 允许网页游戏跨域访问
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (req.url === '/leaderboard' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(leaderboard.slice(0, 100)));
    return;
  }

  if (req.url === '/leaderboard' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body || '{}');
      const name = String(data.name || '玩家').slice(0, 24);
      const kills = Math.max(0, Math.min(100000, parseInt(data.kills, 10) || 0));
      leaderboard.push({ name, kills, ts: Date.now() });
      leaderboard.sort((a, b) => b.kills - a.kills);
      leaderboard = leaderboard.slice(0, 100);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false }));
    }
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('mp-server running. connect via ws.');
});

const wss = new WebSocketServer({ server: httpServer });

let nextId = 1;

wss.on('connection', (ws) => {
  const playerId = 'p' + (nextId++);
  let roomId = 'lobby'; // 先都放同一个房间，简单可靠；以后要分房间再扩展
  let joined = false;

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch (e) { return; }

    // 客户端第一条消息应该是 join，带上想加入的房间号（没有就用默认房间）
    if (data.type === 'join') {
      roomId = data.room || 'lobby';
      const room = getRoom(roomId);
      room.set(playerId, ws);
      joined = true;

      // 告诉这个玩家他的 id，以及房间里已有的其他玩家列表
      ws.send(JSON.stringify({
        type: 'welcome',
        id: playerId,
        players: [...room.keys()].filter(id => id !== playerId)
      }));

      // 通知房间里其他人：有新玩家加入
      broadcast(roomId, { type: 'player_join', id: playerId }, playerId);
      return;
    }

    if (!joined) return; // 没 join 之前忽略其它消息

    // 剩下的所有消息（位置、射击、命中、死亡……）原样转发给房间里其他人
    // 服务器不校验内容，纯中继，客户端自己决定怎么处理
    data.from = playerId;
    broadcast(roomId, data, playerId);
  });

  ws.on('close', () => {
    if (joined) {
      getRoom(roomId).delete(playerId);
      broadcast(roomId, { type: 'player_leave', id: playerId }, playerId);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log('mp-server listening on port ' + PORT);
});
