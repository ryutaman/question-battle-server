const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

// 分野ごとの待機プレイヤー: { all: ws, history: ws, geo: ws, civics: ws }
const waitingPlayers = {};
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

  // 互いにニックネーム・称号メダルID・分野を伝える
  send(wsA, {
    type: 'matched',
    role: 0,
    battleId: id,
    opponentNick: wsB._nick || '相手',
    opponentMedalId: wsB._medalId || null,
    subject: wsA._subject || 'all'
  });
  send(wsB, {
    type: 'matched',
    role: 1,
    battleId: id,
    opponentNick: wsA._nick || '相手',
    opponentMedalId: wsA._medalId || null,
    subject: wsB._subject || 'all'
  });
}

wss.on('connection', ws => {
  ws._battleId = null;
  ws._role = null;
  ws._code = null;
  ws._nick = '相手';
  ws._medalId = null;
  ws._subject = 'all';

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ニックネーム・メダルID・分野を保存
    if (msg.nick)     ws._nick    = String(msg.nick).slice(0, 12);
    if (msg.medalId)  ws._medalId = String(msg.medalId).slice(0, 32);
    if (msg.subject)  ws._subject = String(msg.subject).slice(0, 16);

    if (msg.type === 'random') {
      const subj = ws._subject || 'all';

      // 同じ分野の待機プレイヤーを探す
      const waiting = waitingPlayers[subj];
      if (waiting && waiting !== ws && waiting.readyState === 1) {
        delete waitingPlayers[subj];
        startBattle(ws, waiting);
      } else {
        // 既に自分が別の分野で待機していたら解除
        Object.keys(waitingPlayers).forEach(k => {
          if (waitingPlayers[k] === ws) delete waitingPlayers[k];
        });
        waitingPlayers[subj] = ws;
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
    // 待機中なら除外
    Object.keys(waitingPlayers).forEach(k => {
      if (waitingPlayers[k] === ws) delete waitingPlayers[k];
    });
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
