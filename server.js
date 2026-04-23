const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

// 待機中のランダムマッチング
let waitingPlayer = null;

// 合言葉部屋 { code: [playerA, playerB] }
const codeRooms = {};

// 対戦中のペア { id: { players:[ws,ws], round:0, scores:[0,0] } }
const battles = {};
let battleIdCounter = 0;

function send(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

function startBattle(wsA, wsB) {
  const id = ++battleIdCounter;
  wsA._battleId = wsB._battleId = id;
  wsA._role = 0; wsB._role = 1;
  battles[id] = { players: [wsA, wsB], round: 0, scores: [0, 0], phase: 'myPick' };
  send(wsA, { type: 'matched', role: 0, battleId: id });
  send(wsB, { type: 'matched', role: 1, battleId: id });
}

wss.on('connection', ws => {
  ws._battleId = null;
  ws._role = null;
  ws._code = null;

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ランダムマッチング
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

    // 合言葉マッチング
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
    // 待機中なら解除
    if (waitingPlayer === ws) waitingPlayer = null;

    // 合言葉部屋から削除
    if (ws._code && codeRooms[ws._code]) {
      codeRooms[ws._code] = codeRooms[ws._code].filter(w => w !== ws);
      if (codeRooms[ws._code].length === 0) delete codeRooms[ws._code];
    }

    // 対戦中なら相手に通知
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
