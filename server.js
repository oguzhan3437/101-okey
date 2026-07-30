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

// OYUN VERİ YAPISI
let players = [];
let deck = [];
let indicatorTile = null;
let discards = { p1: null, p2: null, p3: null };

// 101 OKEY DESTE OLUŞTURMA
function createDeck() {
  const colors = ['kirmizi', 'siyah', 'mavi', 'sari'];
  let newDeck = [];

  // Her renkten 1-13 arası çift seri
  colors.forEach(color => {
    for (let set = 0; set < 2; set++) {
      for (let value = 1; value <= 13; value++) {
        newDeck.push({ color, value });
      }
    }
  });

  // 2 Adet Sahte Okey (Joker)
  newDeck.push({ color: 'joker', value: '★' });
  newDeck.push({ color: 'joker', value: '★' });

  // Karıştır (Fisher-Yates)
  for (let i = newDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
  }

  return newDeck;
}

// OYUNU BAŞLATMA
function startNewGame() {
  deck = createDeck();
  indicatorTile = deck.pop(); // Gösterge seç
  discards = { p1: null, p2: null, p3: null };

  // Oyunculara taş dağıtma (101 Okey: Oyunculara 21'er taş, başlayana 22)
  players.forEach((player, index) => {
    const tileCount = index === 0 ? 22 : 21;
    player.hand = deck.splice(0, tileCount);
    
    // Her oyuncuya kendi kartlarını gönder
    io.to(player.id).emit('initGame', {
      hand: player.hand,
      indicator: indicatorTile,
      playerId: `p${index + 1}`
    });
  });

  broadcastGameState();
}

function broadcastGameState() {
  io.emit('updateGameState', {
    deckCount: deck.length,
    discards: discards,
    players: players.map((p, idx) => ({ id: p.id, name: `Oyuncu ${idx + 1}` }))
  });
}

// SOCKET BAĞLANTILARI
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
    if (deck.length > 0) {
      const drawnTile = deck.pop();
      socket.emit('tileDrawn', drawnTile);
      broadcastGameState();
    }
  });

  // TAŞ ATMA
  socket.on('throwTile', (data) => {
    const playerIndex = players.findIndex(p => p.id === socket.id);
    if (playerIndex !== -1) {
      const pKey = `p${playerIndex + 1}`;
      discards[pKey] = data.tile;
      broadcastGameState();
    }
  });

  // AYRILMA
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
