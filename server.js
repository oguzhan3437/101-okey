const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// OYUN VERİ YAPILARI
let players = [];
let deck = [];
let indicatorTile = null;
let okeyTile = null;
let discards = { p1: null, p2: null, p3: null };
let turnIndex = 0; // 0: p1, 1: p2, 2: p3
let hasDrawnTile = false; // Taş çekilmeden taş atılamaz kuralı

function createDeck() {
  const colors = ['kirmizi', 'siyah', 'mavi', 'sari'];
  let newDeck = [];

  colors.forEach(color => {
    for (let set = 0; set < 2; set++) {
      for (let value = 1; value <= 13; value++) {
        newDeck.push({ color, value });
      }
    }
  });

  newDeck.push({ color: 'joker', value: '★' });
  newDeck.push({ color: 'joker', value: '★' });

  for (let i = newDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
  }

  return newDeck;
}

function calculateOkey(indicator) {
  if (indicator.color === 'joker') return { color: 'kirmizi', value: 1 };
  
  let val = parseInt(indicator.value);
  let okeyVal = val === 13 ? 1 : val + 1;
  return { color: indicator.color, value: okeyVal };
}

function startNewGame() {
  deck = createDeck();
  indicatorTile = deck.pop();
  okeyTile = calculateOkey(indicatorTile);
  discards = { p1: null, p2: null, p3: null };
  turnIndex = 0;
  hasDrawnTile = true; // Başlayan kişi ilk taş atacağı için doğrudan taş çekmiş kabul edilir

  players.forEach((player, index) => {
    const tileCount = index === 0 ? 22 : 21;
    player.hand = deck.splice(0, tileCount);
    
    io.to(player.id).emit('initGame', {
      hand: player.hand,
      indicator: indicatorTile,
      okey: okeyTile,
      playerId: `p${index + 1}`
    });
  });

  broadcastGameState();
}

function broadcastGameState() {
  const turnKeys = ['p1', 'p2', 'p3'];
  io.emit('updateGameState', {
    deckCount: deck.length,
    discards: discards,
    currentTurn: turnKeys[turnIndex],
    players: players.map((p, idx) => ({ id: p.id, name: `Oyuncu ${idx + 1}` }))
  });
}

io.on('connection', (socket) => {
  console.log('Yeni oyuncu katıldı:', socket.id);

  if (players.length < 3) {
    players.push({ id: socket.id, hand: [] });

    if (players.length === 3) {
      startNewGame();
    } else {
      broadcastGameState();
    }
  }

  // TAŞ ÇEKME
  socket.on('drawTile', () => {
    const pKey = `p${turnIndex + 1}`;
    const currentPlayer = players[turnIndex];

    if (!currentPlayer || currentPlayer.id !== socket.id) {
      return socket.emit('errorMessage', 'Sıra sizde değil!');
    }

    if (hasDrawnTile) {
      return socket.emit('errorMessage', 'Zaten taş çektiniz, elinizden taş atmalısınız!');
    }

    if (deck.length > 0) {
      const drawnTile = deck.pop();
      hasDrawnTile = true;
      socket.emit('tileDrawn', drawnTile);
      broadcastGameState();
    }
  });

  // TAŞ ATMA
  socket.on('throwTile', (data) => {
    const pKey = `p${turnIndex + 1}`;
    const currentPlayer = players[turnIndex];

    if (!currentPlayer || currentPlayer.id !== socket.id) {
      return socket.emit('errorMessage', 'Sıra sizde değil!');
    }

    if (!hasDrawnTile) {
      return socket.emit('errorMessage', 'Önce ortadan taş çekmelisiniz!');
    }

    discards[pKey] = data.tile;
    
    // Sırayı bir sonraki oyuncuya geçir
    turnIndex = (turnIndex + 1) % 3;
    hasDrawnTile = false;

    broadcastGameState();
  });

  socket.on('disconnect', () => {
    console.log('Oyuncu ayrıldı:', socket.id);
    players = players.filter(p => p.id !== socket.id);
    if (players.length === 0) {
      deck = [];
    }
    broadcastGameState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda aktif!`);
});
