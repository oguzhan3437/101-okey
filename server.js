const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

// OYUN DURUMU (STATE)
let gameState = {
    oyuncular: [
        { id: null, isim: "Oyuncu 1", taslar: [], ceza: 0, acilanPuan: 0, elAcaliMi: false },
        { id: null, isim: "Oyuncu 2", taslar: [], ceza: 0, acilanPuan: 0, elAcaliMi: false },
        { id: null, isim: "Oyuncu 3", taslar: [], ceza: 0, acilanPuan: 0, elAcaliMi: false }
    ],
    deste: [],
    okey: null,
    gosterge: null,
    aktifOyuncu: 0,
    sonAtilanTas: null,
    enYuksekAcilanPuan: 100, // Başlangıç barajı (Açmak için min 101)
    oyunBasladi: false,
    tasCekildiMi: false
};

// DESTE OLUSTURMA (106 Taş)
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

function isOkey(tas, okey) {
    if (!okey || !tas) return false;
    let okeySayi = okey.sayi === 13 ? 1 : okey.sayi + 1;
    return tas.renk === okey.renk && tas.sayi === okeySayi;
}

function getTasPuan(tas, okey) {
    if (!tas) return 0;
    if (tas.sayi === 0 || isOkey(tas, okey)) {
        return okey ? okey.sayi : 10;
    }
    return tas.sayi;
}

// OYUNU BAŞLAT
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
        gameState.oyuncular[i].acilanPuan = 0;
        gameState.oyuncular[i].elAcaliMi = false;
    }

    gameState.enYuksekAcilanPuan = 100;
    gameState.sonAtilanTas = null;
    gameState.oyunBasladi = true;
    gameState.tasCekildiMi = true; // Başlayan oyuncunun 22 taşı var
}

io.on('connection', (socket) => {
    let assignedIndex = gameState.oyuncular.findIndex(o => o.id === null);
    if (assignedIndex !== -1) {
        gameState.oyuncular[assignedIndex].id = socket.id;
        socket.emit('playerAssigned', assignedIndex);
    } else {
        socket.emit('playerAssigned', -1);
    }

    io.emit('stateUpdate', gameState);

    socket.on('oyunuBaslat', () => {
        oyunuBaslat();
        io.emit('stateUpdate', gameState);
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

    socket.on('seriAc', ({ pIdx, seciliIndices }) => {
        if (pIdx !== gameState.aktifOyuncu) return;

        let oyuncu = gameState.oyuncular[pIdx];
        let acilacakTaslar = seciliIndices.map(idx => oyuncu.taslar[idx]).filter(Boolean);

        let toplamPuan = 0;
        acilacakTaslar.forEach(t => toplamPuan += getTasPuan(t, gameState.okey));

        let gerekliPuan = gameState.enYuksekAcilanPuan + 1;

        if (toplamPuan >= gerekliPuan) {
            gameState.enYuksekAcilanPuan = toplamPuan; // Katlamalı Yeni Baraj
            oyuncu.acilanPuan = toplamPuan;
            oyuncu.elAcaliMi = true;

            oyuncu.taslar = oyuncu.taslar.filter(t => !acilacakTaslar.includes(t));
            
            io.emit('bildirim', `${oyuncu.isim}, ${toplamPuan} puan ile açtı! Yeni Baraj: ${toplamPuan + 1}`);
            io.emit('stateUpdate', gameState);
        } else {
            socket.emit('bildirim', `Puan Yetersiz! Açmak için en az ${gerekliPuan} puan lazım. Senin Puanın: ${toplamPuan}`);
        }
    });

    socket.on('yandanTasCezasiYaz', ({ pIdx }) => {
        gameState.oyuncular[pIdx].ceza += 101;
        io.emit('bildirim', `${gameState.oyuncular[pIdx].isim} yandan taş alıp el açamadığı için +101 CEZA YEDİ!`);
        io.emit('stateUpdate', gameState);
    });

    socket.on('tasAt', ({ pIdx, tasIndex }) => {
        if (pIdx === gameState.aktifOyuncu && gameState.tasCekildiMi) {
            let atilan = gameState.oyuncular[pIdx].taslar.splice(tasIndex, 1)[0];
            gameState.sonAtilanTas = atilan;
            
            gameState.aktifOyuncu = (gameState.aktifOyuncu + 1) % 3;
            gameState.tasCekildiMi = false;

            io.emit('stateUpdate', gameState);
        }
    });

    socket.on('disconnect', () => {
        let pIdx = gameState.oyuncular.findIndex(o => o.id === socket.id);
        if (pIdx !== -1) {
            gameState.oyuncular[pIdx].id = null;
            io.emit('stateUpdate', gameState);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`3 Kişilik 101 Okey Plus Hazır! Port: ${PORT}`));
