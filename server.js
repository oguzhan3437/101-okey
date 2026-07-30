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
    enYuksekAcilanPuan: 100, // Katlamalı için baraj (İlk açan min 101)
    oyunBasladi: false,
    tasCekildiMi: false
};

// DESTE VE TAS OLUSTURMA
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
        // Sahte Okey (Joker)
        deste.push({ id: idCounter++, renk: 'sahte', sayi: 0 });
    }

    // Karıştır (Fisher-Yates)
    for (let i = deste.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deste[i], deste[j]] = [deste[j], deste[i]];
    }
    return deste;
}

// OKEY (JOKER) DESTEKLİ ESNEK PER KONTROLÜ
function isOkey(tas, okey) {
    if (!okey || !tas) return false;
    let okeySayi = okey.sayi === 13 ? 1 : okey.sayi + 1;
    return tas.renk === okey.renk && tas.sayi === okeySayi;
}

function isGecerliPer(grup, okey) {
    if (!grup || grup.length < 3) return false;

    let normalTaslar = grup.filter(t => t.sayi !== 0 && !isOkey(t, okey));
    if (normalTaslar.length === 0) return true; // Hepsi okey/sahte ise geçerli

    // 1. KONTROL: Grup (Aynı sayı, farklı renkler)
    let hedefSayi = normalTaslar[0].sayi;
    if (normalTaslar.every(t => t.sayi === hedefSayi)) {
        let benzersizRenkler = new Set(normalTaslar.map(t => t.renk));
        if (benzersizRenkler.size === normalTaslar.length && grup.length <= 4) {
            return true;
        }
    }

    // 2. KONTROL: Seri (Aynı renk, ardışık)
    let hedefRenk = normalTaslar[0].renk;
    if (normalTaslar.every(t => t.renk === hedefRenk)) {
        let sayilar = normalTaslar.map(t => t.sayi).sort((a, b) => a - b);
        if (sayilar.includes(13) && sayilar.includes(1)) {
            sayilar = sayilar.map(s => s === 1 ? 14 : s).sort((a, b) => a - b);
        }
        let min = sayilar[0];
        let max = sayilar[sayilar.length - 1];
        if ((max - min) < grup.length) {
            return true;
        }
    }

    return false;
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
    
    // Gösterge ve Okey Belirle
    let gostergeTas = gameState.deste.pop();
    while (gostergeTas.sayi === 0) { // Sahte okey gösterge olamaz
        gameState.deste.unshift(gostergeTas);
        gostergeTas = gameState.deste.pop();
    }
    gameState.gosterge = gostergeTas;
    
    let okeySayi = gostergeTas.sayi === 13 ? 1 : gostergeTas.sayi + 1;
    gameState.okey = { renk: gostergeTas.renk, sayi: okeySayi };

    // 3 Kişiye Taş Dağıtımı (21'er taş, başlayana 22)
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
    gameState.tasCekildiMi = true; // İlk oyuncunun 22 taşı var, çekmesine gerek yok
}

io.on('connection', (socket) => {
    // Koltuk Atama (Max 3 oyuncu)
    let assignedIndex = gameState.oyuncular.findIndex(o => o.id === null);
    if (assignedIndex !== -1) {
        gameState.oyuncular[assignedIndex].id = socket.id;
        socket.emit('playerAssigned', assignedIndex);
    } else {
        socket.emit('playerAssigned', -1); // İzleyici
    }

    io.emit('stateUpdate', gameState);

    socket.on('oyunuBaslat', () => {
        oyunuBaslat();
        io.emit('stateUpdate', gameState);
    });

    // TAŞ ÇEKME (DESTEDEN)
    socket.on('tasCek', (pIdx) => {
        if (pIdx === gameState.aktifOyuncu && !gameState.tasCekildiMi && gameState.deste.length > 0) {
            let cekilen = gameState.deste.pop();
            gameState.oyuncular[pIdx].taslar.push(cekilen);
            gameState.tasCekildiMi = true;
            io.emit('stateUpdate', gameState);
        }
    });

    // YANDAN TAŞ ALMA
    socket.on('yandanTasAl', (pIdx) => {
        if (pIdx === gameState.aktifOyuncu && !gameState.tasCekildiMi && gameState.sonAtilanTas) {
            gameState.oyuncular[pIdx].taslar.push(gameState.sonAtilanTas);
            gameState.sonAtilanTas = null;
            gameState.tasCekildiMi = true;
            socket.emit('yandanTasAldiBildir');
            io.emit('stateUpdate', gameState);
        }
    });

    // PER AÇMA (101 BARAJ + KATLAMALI KONTROLÜ)
    socket.on('seriAc', ({ pIdx, seciliIndices }) => {
        if (pIdx !== gameState.aktifOyuncu) return;

        let oyuncu = gameState.oyuncular[pIdx];
        let acilacakTaslar = seciliIndices.map(idx => oyuncu.taslar[idx]).filter(Boolean);

        // Seçilen veya belirlenen taşların gruplara ayrılması ve puan hesabı
        let toplamPuan = 0;
        let gecerliMi = true;

        // Basit kontrol: Taşlar geçerli per oluşturuyor mu?
        if (isGecerliPer(acilacakTaslar, gameState.okey)) {
            acilacakTaslar.forEach(t => toplamPuan += getTasPuan(t, gameState.okey));
        } else {
            gecerliMi = false;
        }

        // Katlamalı Baraj Kontrolü
        if (gecerliMi && toplamPuan > gameState.enYuksekAcilanPuan) {
            // Başarılı Per Açma
            gameState.enYuksekAcilanPuan = toplamPuan; // Katlamalı yeni baraj
            oyuncu.acilanPuan = toplamPuan;
            oyuncu.elAcaliMi = true;

            // Açılan taşları oyuncunun elinden sil
            oyuncu.taslar = oyuncu.taslar.filter(t => !acilacakTaslar.includes(t));
            
            io.emit('bildirim', `${oyuncu.isim}, ${toplamPuan} puan ile elini açtı! (Yeni Baraj: ${toplamPuan + 1})`);
            io.emit('stateUpdate', gameState);
        } else {
            let gerekli = gameState.enYuksekAcilanPuan + 1;
            socket.emit('bildirim', `Geçersiz Per veya Puan Yetersiz! Açabilmek için en az ${gerekli} puan lazım (Senin Puanın: ${toplamPuan}).`);
        }
    });

    // YANDAN TAŞ ALIP AÇAMAMA CEZASI VEYA TAŞ ATMA
    socket.on('yandanTasCezasiYaz', ({ pIdx }) => {
        gameState.oyuncular[pIdx].ceza += 101;
        io.emit('bildirim', `${gameState.oyuncular[pIdx].isim} yandan taş alıp per açamadığı için +101 CEZA YEDİ!`);
        io.emit('stateUpdate', gameState);
    });

    // TAŞ ATMA VE SIRA GEÇİRME
    socket.on('tasAt', ({ pIdx, tasIndex }) => {
        if (pIdx === gameState.aktifOyuncu && gameState.tasCekildiMi) {
            let atilan = gameState.oyuncular[pIdx].taslar.splice(tasIndex, 1)[0];
            gameState.sonAtilanTas = atilan;
            
            // Sıradaki oyuncuya geç (0 -> 1 -> 2 -> 0)
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
server.listen(PORT, () => console.log(`101 Okey Plus 3 Kişilik Sunucu ${PORT} Portunda Aktif!`));
