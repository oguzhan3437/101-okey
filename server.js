const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

let gameState = {
    oyuncular: [
        { id: null, isim: "Oyuncu 1", isBot: false, taslar: [], ceza: 0, acilanSeriler: [], acilanCiftler: [], elAcaliMi: false },
        { id: null, isim: "Bot 1", isBot: true, taslar: [], ceza: 0, acilanSeriler: [], acilanCiftler: [], elAcaliMi: false },
        { id: null, isim: "Bot 2", isBot: true, taslar: [], ceza: 0, acilanSeriler: [], acilanCiftler: [], elAcaliMi: false }
    ],
    deste: [],
    okey: null,
    gosterge: null,
    aktifOyuncu: 0,
    sonAtilanTas: null,
    enYuksekAcilanPuan: 100,
    oyunBasladi: false,
    tasCekildiMi: false
};

function desteOlustur() {
    let renkler = ['kirmizi', 'siyah', 'mavi', 'sari'];
    let deste = [];
    let idCounter = 1;

    for (let set = 0; set < 2; set++) {
        renkler.forEach(renk => {
            for (let i = 1; i <= 13; i++) {
                deste.push({ id: idCounter++, renk: renk, sayi: i });
            }
        });
        deste.push({ id: idCounter++, renk: 'sahte', sayi: 0 });
    }

    for (let i = deste.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deste[i], deste[j]] = [deste[j], deste[i]];
    }
    return deste;
}

function oyunuBaslat() {
    gameState.deste = desteOlustur();
    let gostergeTas = gameState.deste.pop();
    while (gostergeTas.sayi === 0) {
        gameState.deste.unshift(gostergeTas);
        gostergeTas = gameState.deste.pop();
    }
    gameState.gosterge = gostergeTas;
    let okeySayi = gostergeTas.sayi === 13 ? 1 : gostergeTas.sayi + 1;
    gameState.okey = { renk: gostergeTas.renk, sayi: okeySayi };

    gameState.aktifOyuncu = 0;
    for (let i = 0; i < 3; i++) {
        let tasSayisi = (i === gameState.aktifOyuncu) ? 22 : 21;
        gameState.oyuncular[i].taslar = gameState.deste.splice(0, tasSayisi);
        gameState.oyuncular[i].acilanSeriler = [];
        gameState.oyuncular[i].acilanCiftler = [];
        gameState.oyuncular[i].elAcaliMi = false;
    }

    gameState.enYuksekAcilanPuan = 100;
    gameState.sonAtilanTas = null;
    gameState.oyunBasladi = true;
    gameState.tasCekildiMi = true;

    io.emit('stateUpdate', gameState);
    botHamleKontrol();
}

// BOT HAMLE MOTORU
function botHamleKontrol() {
    if (!gameState.oyunBasladi) return;

    let aktif = gameState.oyuncular[gameState.aktifOyuncu];
    if (aktif && aktif.isBot) {
        setTimeout(() => {
            if (!gameState.tasCekildiMi && gameState.deste.length > 0) {
                let cekilen = gameState.deste.pop();
                aktif.taslar.push(cekilen);
                gameState.tasCekildiMi = true;
                io.emit('stateUpdate', gameState);
            }

            setTimeout(() => {
                if (gameState.tasCekildiMi && aktif.taslar.length > 0) {
                    let atilacakIdx = Math.floor(Math.random() * aktif.taslar.length);
                    let atilan = aktif.taslar.splice(atilacakIdx, 1)[0];
                    gameState.sonAtilanTas = atilan;

                    gameState.aktifOyuncu = (gameState.aktifOyuncu + 1) % 3;
                    gameState.tasCekildiMi = false;

                    io.emit('stateUpdate', gameState);
                    botHamleKontrol();
                }
            }, 1200);
        }, 1000);
    }
}

io.on('connection', (socket) => {
    let emptyIndex = gameState.oyuncular.findIndex(o => o.id === null && !o.isBot);

    if (emptyIndex === -1) {
        emptyIndex = gameState.oyuncular.findIndex(o => o.isBot);
    }

    if (emptyIndex !== -1) {
        gameState.oyuncular[emptyIndex].id = socket.id;
        gameState.oyuncular[emptyIndex].isim = `Oyuncu ${emptyIndex + 1}`;
        gameState.oyuncular[emptyIndex].isBot = false;
        socket.emit('playerAssigned', emptyIndex);
    } else {
        socket.emit('playerAssigned', -1);
    }

    io.emit('stateUpdate', gameState);

    socket.on('oyunuBaslat', () => {
        oyunuBaslat();
    });

    socket.on('tasCek', (pIdx) => {
        if (pIdx === gameState.aktifOyuncu && !gameState.tasCekildiMi && gameState.deste.length > 0) {
            let cekilen = gameState.deste.pop();
            gameState.oyuncular[pIdx].taslar.push(cekilen);
            gameState.tasCekildiMi = true;
            io.emit('stateUpdate', gameState);
        }
    });

    socket.on('yandanTasAl', (pIdx) => {
        if (pIdx === gameState.aktifOyuncu && !gameState.tasCekildiMi && gameState.sonAtilanTas) {
            gameState.oyuncular[pIdx].taslar.push(gameState.sonAtilanTas);
            gameState.sonAtilanTas = null;
            gameState.tasCekildiMi = true;
            socket.emit('yandanTasAldiBildir');
            io.emit('stateUpdate', gameState);
        }
    });

    socket.on('seriAc', ({ pIdx, perGruplari }) => {
        if (pIdx !== gameState.aktifOyuncu) return;
        let oyuncu = gameState.oyuncular[pIdx];

        let kullanilanTasIdler = [];
        let toplamPuan = 0;

        perGruplari.forEach(grupIds => {
            let grupTaslar = grupIds.map(id => oyuncu.taslar.find(t => t.id === id)).filter(Boolean);
            grupTaslar.forEach(t => {
                toplamPuan += (t.sayi === 0 ? gameState.okey.sayi : t.sayi);
                kullanilanTasIdler.push(t.id);
            });
            oyuncu.acilanSeriler.push(grupTaslar);
        });

        if (toplamPuan > gameState.enYuksekAcilanPuan) {
            gameState.enYuksekAcilanPuan = toplamPuan;
            oyuncu.elAcaliMi = true;
            oyuncu.taslar = oyuncu.taslar.filter(t => !kullanilanTasIdler.includes(t.id));
            io.emit('bildirim', `${oyuncu.isim}, ${toplamPuan} puan ile Seri açtı!`);
            io.emit('stateUpdate', gameState);
        }
    });

    socket.on('tasAt', ({ pIdx, tasIndex }) => {
        if (pIdx === gameState.aktifOyuncu && gameState.tasCekildiMi) {
            let atilan = gameState.oyuncular[pIdx].taslar.splice(tasIndex, 1)[0];
            gameState.sonAtilanTas = atilan;
            gameState.aktifOyuncu = (gameState.aktifOyuncu + 1) % 3;
            gameState.tasCekildiMi = false;

            io.emit('stateUpdate', gameState);
            botHamleKontrol();
        }
    });

    socket.on('disconnect', () => {
        let pIdx = gameState.oyuncular.findIndex(o => o.id === socket.id);
        if (pIdx !== -1) {
            gameState.oyuncular[pIdx].id = null;
            gameState.oyuncular[pIdx].isim = `Bot ${pIdx + 1}`;
            gameState.oyuncular[pIdx].isBot = true;
            io.emit('stateUpdate', gameState);
            botHamleKontrol();
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`3 Kişilik 101 Okey Plus Hazır! Port: ${PORT}`));
