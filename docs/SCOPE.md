# DOIntelligence — Scope & Keputusan Terkunci

Dokumen ini adalah sumber kebenaran untuk kelanjutan proyek DOIntelligence.
Dikunci: 2026-11-06. Jangan diubah tanpa konfirmasi user.

## Identitas produk (Fase 1)

**Asisten analisis investasi** — bukan aplikasi pencatatan keuangan.
Single user, berbahasa Indonesia, mata uang IDR, single-page app.

## Scope Fase 1

### 1. Analisis saham — memilih saham yang bagus
- Analisis **fundamental DAN teknikal dipakai bersama** untuk menentukan saham mana yang bagus dipilih, bukan sekadar menampilkan rasio.
- Fundamental: PER, PBV, ROE, DER, dividend yield, growth, estimasi fair value, skor dan verdict.
- Teknikal: tren, Moving Average, RSI, MACD, support/resistance (dari data harga nyata).
- Output: rekomendasi pilihan saham berdasarkan gabungan keduanya.

### 2. Analisis proyek — membandingkan skema pembiayaan
- Kalkulator feasibility proyek/bisnis dengan **NPV, IRR, payback period, dan WACC**.
- Mendukung **BEBERAPA skema pembiayaan sekaligus** (mis. 100% ekuitas, campuran utang/ekuitas dengan rasio berbeda, suku bunga pinjaman berbeda).
- Tiap skema dihitung terpisah (WACC berbeda per skema), lalu dibandingkan dan diberi peringkat berdasarkan NPV/IRR/payback — user bisa melihat skema pembiayaan mana yang paling baik.

### 3. NPV / IRR / WACC — pembeda utama
- Dipakai di **DUA modul terpisah**: (a) valuasi saham model DCF (WACC sebagai discount rate) dan (b) feasibility proyek/bisnis (WACC sebagai hurdle rate).
- Modul ini harus dirancang khusus: input arus kas, asumsi pertumbuhan, cost of equity, cost of debt, struktur modal, dan pajak harus jelas.

### 4. Pasar & analisis
- **Fase 1: saham IDX + kripto** dulu (datanya paling gampang didapat gratis dan paling relevan untuk IDR).
- Menyusul setelahnya: saham global, forex, emas, dan reksa dana.
- Analisis gabungan: teknikal + fundamental + sentimen berita.
- Fitur pendukung: watchlist, price alert (dengan pengiriman nyata), portfolio tracking (P/L, alokasi).

## Data — aturan kejujuran

- Sumber gratis yang credible: **Yahoo Finance** (saham IDX/global, kode .JK; endpoint chart v8 tidak resmi; intraday umumnya delay ~15 menit, real-time resmi IDX berbayar) dan **CoinGecko** (kripto; Demo gratis 10.000 credits/bulan, 100 calls/min — batas mengikatnya kuota bulanan ~333 calls/hari, jadi wajib cache/interval).
- Forex: tier gratis fxapi 300 req/bulan dan CurrencyAPI 500 req/bulan (alert tidak bisa polling tiap menit).
- Emas: XAU/USD via Yahoo/forex API; emas fisik lokal (mis. Antam) diumumkan harian, tidak ada API yang terkonfirmasi.
- Reksa dana: **tidak ada API publik gratis yang terkonfirmasi** — jangan klaim ada API Bareksa; ingestion lewat input NAB harian manual, scraping, atau vendor berbayar.
- Sentimen berita: **belum ada sumber terverifikasi** — jangan klaim API harga sudah mencakup sentimen.
- Sumber gratis itu credible tapi **delay, bukan real-time tick**. Real-time penuh hampir selalu berbayar.
- **Jangan pernah menyajikan data dummy sebagai data nyata.** Setiap data harus berlabel live atau dummy, lengkap dengan sumber dan waktu update terakhir.

## Ditunda ke Fase 2 (BUKAN bagian Fase 1)

Pencatatan keuangan pribadi: pemasukan/pengeluaran, budget, target tabungan, tagihan rutin, utang, dan laporan keuangan.

## Modul Tim & Workspace (bagian dari rebuild)

- Section **Tim**: analisa tim untuk GM Marketing — hasil kerja tim, progress vs target/KPI, analisa laporan data. (Detail KPI, sumber data, ukuran tim, dan multi-user masih menunggu jawaban GM.)
- **Workspace kolaborasi** bergaya gather.town sebagai halaman utama/hub, dengan avatar, chat, dan widget progress tim.
- Workspace real-time **TIDAK bisa jalan hanya dengan hosting statis + localStorage**. Arsitektur realtime (mis. Supabase Realtime, Firebase, atau server WebSocket kecil) beserta estimasi biayanya WAJIB diusulkan dan disetujui user sebelum dibangun. Tanpa backend, workspace hanya berjalan lokal/single-user dengan avatar simulasi — dan keterbatasan ini harus dilabeli dengan jujur.

## Aturan pembangunan

- Bangun dari nol — jangan menambal file demo lama (`doIntelligence.html` hanya referensi).
- Utamakan solusi gratis. Jangan memakai layanan berbayar apa pun tanpa menyampaikan estimasi biayanya dan mendapat persetujuan user.
- Pertahankan bahasa Indonesia, mata uang IDR, dan struktur satu halaman, kecuali ada alasan teknis yang kuat (sampaikan dulu alasannya).
- Angka harus selalu disertai konteks (target, periode, perbandingan) di modul Tim, dan bukan saran investasi di semua bagian analisa.

## Prompt pembangunan

Prompt lengkap untuk agent builder disimpan lokal di `~/workspace/dointelligence/prompt-final.md` (belum di repo).
