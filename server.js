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

// 简单的健康检查接口，方便部署平台探测服务是否存活
const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('mp-server running. connect via ws.');
});

const wss = new WebSocketServer({ server: httpServer });

let nextId = 1;

wss.on('connection', (ws) => {
  const playerId = 'p' + (nextId++);
  let roomId = 'lobby';
  let joined = false;

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch (e) { return; }

    if (data.type === 'join') {
      roomId = data.room || 'lobby';
      const room = getRoom(roomId);
      room.set(playerId, ws);
      joined = true;

      ws.send(JSON.stringify({
        type: 'welcome',
        id: playerId,
        players: [...room.keys()].filter(id => id !== playerId)
      }));

      broadcast(roomId, { type: 'player_join', id: playerId }, playerId);
      return;
    }

    if (!joined) return;

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
