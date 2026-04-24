const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

let waitingPlayer = null;
const codeRooms = {};
const battles = {};
let battleIdCounter = 0;

function send(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

function startBattle(wsA, wsB) {
  const id = ++battleIdCounter;
  wsA._battleId = wsB._battleId = id;
  wsA._role = 0; wsB._role = 1;
  battles[id] = { players: [wsA, wsB] };
  // 互いのニックネームを伝える
  send(wsA, { type: 'matched', role: 0, battleId: id, opponentNick: wsB._nick || '相手' });
  send(wsB, { type: 'matched', role: 1, battleId: id, opponentNick: wsA._nick || '相手' });
}

wss.on('connection', ws => {
  ws._battleId = null;
  ws._role = null;
  ws._code = null;
  ws._nick = '相手';

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ニックネームを保存
    if (msg.nick) ws._nick = String(msg.nick).slice(0, 12);

    if (msg.type === 'random') {
      if (waitingPlayer && waitingPlayer !== ws && waitingPlayer.readyState === 1) {
        const opponent = waitingPlayer;
        waitingPlayer = null;
        startBattle(ws, opponent);
      } else {
        waitingPlayer = ws;
        send(ws, { type: 'waiting' });
      }
    }

    if (msg.type === 'code') {
      const code = String(msg.code).trim();
      ws._code = code;
      if (!codeRooms[code]) {
        codeRooms[code] = [ws];
        send(ws, { type: 'waiting', code });
      } else {
        const opponent = codeRooms[code][0];
        if (opponent && opponent !== ws && opponent.readyState === 1) {
          delete codeRooms[code];
          startBattle(ws, opponent);
        } else {
          codeRooms[code] = [ws];
          send(ws, { type: 'waiting', code });
        }
      }
    }

    // ゲームメッセージを相手に転送
    if (msg.type === 'game' && ws._battleId) {
      const battle = battles[ws._battleId];
      if (!battle) return;
      const opponent = battle.players[1 - ws._role];
      if (opponent && opponent.readyState === 1) {
        send(opponent, { type: 'game', data: msg.data, from: ws._role });
      }
    }
  });

  ws.on('close', () => {
    if (waitingPlayer === ws) waitingPlayer = null;
    if (ws._code && codeRooms[ws._code]) {
      codeRooms[ws._code] = codeRooms[ws._code].filter(w => w !== ws);
      if (codeRooms[ws._code].length === 0) delete codeRooms[ws._code];
    }
    if (ws._battleId && battles[ws._battleId]) {
      const battle = battles[ws._battleId];
      const opponent = battle.players[1 - ws._role];
      if (opponent && opponent.readyState === 1) {
        send(opponent, { type: 'opponent_left' });
      }
      delete battles[ws._battleId];
    }
  });
});

console.log(`WebSocket server running on port ${PORT}`);
