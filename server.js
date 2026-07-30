const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

let gameState = {
    oyuncular: [
        { id: null, isim: "Oyuncu 1", taslar: [], ceza: 0, acilanSeriler: [], acilanCiftler: [], elAcaliMi: false, acisTipi: null },
        { id: null, isim: "Oyuncu 2", taslar: [], ceza: 0, acilanSeriler: [], acilanCiftler: [], elAcaliMi: false, acisTipi: null },
        { id: null, isim: "Oyuncu 3", taslar: [], ceza: 0, acilanSeriler: [], acilanCiftler: [], elAcaliMi: false, acisTipi: null }
    ],
    deste: [],
    okey: null,
    gosterge: null,
    aktifOyuncu: 0,
    sonAtilanTas: null,
    enYuksekAcilanPuan: 100, // Katlamalı Seri barajı (Min 101)
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

function isGecerliPer(grup, okey) {
    if (!grup || grup.length < 3) return false;
    let normal = grup.filter(t => t.sayi !== 0 && !isOkey(t, okey));
    if (normal.length === 0) return true;

    let hedefSayi = normal[0].sayi;
    if (normal.every(t => t.sayi === hedefSayi)) {
        let benzersizRenkler = new Set(normal.map(t => t.renk));
        if (benzersizRenkler.size === normal.length && grup.length <= 4) return true;
    }

    let hedefRenk = normal[0].renk;
    if (normal.every(t => t.renk === hedefRenk)) {
        let sayilar = normal.map(t => t.sayi).sort((a, b) => a - b);
        if (sayilar.includes(13) && sayilar.includes(1)) {
            sayilar = sayilar.map(s => s === 1 ? 14 : s).sort((a, b) => a - b);
        }
        let min = sayilar[0];
        let max = sayilar[sayilar.length - 1];
        if ((max - min) < grup.length) return true;
    }

    return false;
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
        gameState.oyuncular[i].acisTipi = null;
    }

    gameState.enYuksekAcilanPuan = 100;
    gameState.sonAtilanTas = null;
    gameState.oyunBasladi = true;
    gameState.tasCekildiMi = true;
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

    // SERİ PER AÇMA
    socket.on('seriAc', ({ pIdx, perGruplari }) => {
        if (pIdx !== gameState.aktifOyuncu) return;
        let oyuncu = gameState.oyuncular[pIdx];

        if (oyuncu.acisTipi === 'cift') {
            socket.emit('bildirim', 'Daha önce Çift açtınız! Seri per açamazsınız.');
            return;
        }

        let toplamPuan = 0;
        let tumGecerli = true;
        let kullanilanTasIdler = [];

        perGruplari.forEach(grupIds => {
            let grupTaslar = grupIds.map(id => oyuncu.taslar.find(t => t.id === id)).filter(Boolean);
            if (isGecerliPer(grupTaslar, gameState.okey)) {
                grupTaslar.forEach(t => {
                    toplamPuan += getTasPuan(t, gameState.okey);
                    kullanilanTasIdler.push(t.id);
                });
            } else {
                tumGecerli = false;
            }
        });

        if (!tumGecerli) {
            socket.emit('bildirim', 'Seçtiğiniz perlerden biri veya birkaçı geçersiz!');
            return;
        }

        let gerekliPuan = gameState.enYuksekAcilanPuan + 1;
        if (toplamPuan >= gerekliPuan) {
            gameState.enYuksekAcilanPuan = toplamPuan;
            oyuncu.elAcaliMi = true;
            oyuncu.acisTipi = 'seri';

            perGruplari.forEach(grupIds => {
                let grupTaslar = grupIds.map(id => oyuncu.taslar.find(t => t.id === id)).filter(Boolean);
                oyuncu.acilanSeriler.push(grupTaslar);
            });

            oyuncu.taslar = oyuncu.taslar.filter(t => !kullanilanTasIdler.includes(t.id));
            io.emit('bildirim', `${oyuncu.isim}, ${toplamPuan} puan ile Seri açtı! (Yeni Baraj: ${toplamPuan + 1})`);
            io.emit('stateUpdate', gameState);
        } else {
            socket.emit('bildirim', `Puan Yetersiz! En az ${gerekliPuan} puan lazım. Senin Puanın: ${toplamPuan}`);
        }
    });

    // ÇİFT AÇMA (MIN 5 ÇİFT)
    socket.on('ciftAc', ({ pIdx, ciftGruplari }) => {
        if (pIdx !== gameState.aktifOyuncu) return;
        let oyuncu = gameState.oyuncular[pIdx];

        if (oyuncu.acisTipi === 'seri') {
            socket.emit('bildirim', 'Daha önce Seri açtınız! Çift açamazsınız.');
            return;
        }

        if (ciftGruplari.length < 5 && !oyuncu.elAcaliMi) {
            socket.emit('bildirim', 'Çift açabilmek için en az 5 ÇİFT (10 Taş) seçmelisiniz!');
            return;
        }

        let kullanilanTasIdler = [];
        let yeniCiftler = [];

        ciftGruplari.forEach(pair => {
            let t1 = oyuncu.taslar.find(t => t.id === pair[0]);
            let t2 = oyuncu.taslar.find(t => t.id === pair[1]);
            if (t1 && t2 && ((t1.renk === t2.renk && t1.sayi === t2.sayi) || isOkey(t1, gameState.okey) || isOkey(t2, gameState.okey))) {
                yeniCiftler.push([t1, t2]);
                kullanilanTasIdler.push(t1.id, t2.id);
            }
        });

        if (yeniCiftler.length === ciftGruplari.length) {
            oyuncu.elAcaliMi = true;
            oyuncu.acisTipi = 'cift';
            oyuncu.acilanCiftler.push(...yeniCiftler);
            oyuncu.taslar = oyuncu.taslar.filter(t => !kullanilanTasIdler.includes(t.id));
            io.emit('bildirim', `${oyuncu.isim} başarıyla ÇİFT açtı!`);
            io.emit('stateUpdate', gameState);
        } else {
            socket.emit('bildirim', 'Seçilen çiftlerden bazıları eşleşmiyor!');
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
