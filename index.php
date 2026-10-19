<?php

/**
 * Otomatis memindai semua PDF yang berada LANGSUNG di folder pdf/.
 * Tanpa database / upload / menulis daftar buku secara manual.
 * Hosting harus mendukung PHP 7.4+; jalankan melalui index.php.
 */
$directory = __DIR__ . DIRECTORY_SEPARATOR . 'pdf';
$books = [];
if (is_dir($directory) && is_readable($directory)) {
  foreach (new DirectoryIterator($directory) as $item) {
    if (!$item->isFile() || $item->isLink() || strtolower($item->getExtension()) !== 'pdf') {
      continue;
    }
    $filename = $item->getFilename();
    // Nama asli dipakai untuk URL; browser akan menggunakan URL yang telah di-encode.
    $title = pathinfo($filename, PATHINFO_FILENAME);
    $title = trim(str_replace(['_', '-'], ' ', $title));
    $books[] = [
      'file' => $filename,
      'title' => $title !== '' ? $title : $filename,
      'url' => './pdf/' . rawurlencode($filename),
      'size' => $item->getSize(),
    ];
  }
}
usort($books, function ($a, $b) {
  return strnatcasecmp($a['title'], $b['title']);
});
$jsonBooks = json_encode($books, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES |
  JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
if ($jsonBooks === false) {
  $jsonBooks = '[]';
}
?>
<!DOCTYPE html>
<html lang="id">

<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#111621" />
    <meta name="description"
        content="Baca buku digital dengan efek membalik halaman yang realistis. Buku PDF otomatis dibaca dari folder pdf/." />
    <title>Folio. — Perpustakaan Digital</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
        href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@500;600;700&display=swap"
        rel="stylesheet" />
    <link rel="stylesheet" href="styles.css" />
    <link rel="icon" type="image/svg+xml" href="./favicon.svg">
    <!-- PDF.js untuk membaca PDF, StPageFlip untuk animasi membalik halaman. -->
    <script defer src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
    <script defer src="https://cdn.jsdelivr.net/npm/page-flip@2.0.7/dist/js/page-flip.browser.min.js"></script>
    <script>
    window.FOLIO_BOOKS = <?php echo $jsonBooks; ?>;
    </script>
    <script defer src="app.js"></script>
</head>

<body>
    <div class="app-shell" id="appShell">
        <header class="topbar">
            <a class="brand" href="./index.php" aria-label="Folio, kembali ke awal">
                <span class="brand-mark" aria-hidden="true">
                    <svg viewBox="0 0 32 32" fill="none">
                        <path
                            d="M16 8.5c-3.7-2.9-7.5-3-11.5-1.7V23c4.3-1.3 8.5-.8 11.5 1.5M16 8.5c3.7-2.9 7.5-3 11.5-1.7V23c-4.3-1.3-8.5-.8-11.5 1.5M16 8.5v16"
                            stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                </span>
                <span class="brand-word">folio<span class="brand-period">.</span></span>
            </a>
            <span class="header-divider"></span>
            <span class="header-label">PERPUSTAKAAN DIGITAL</span>
            <div class="header-right">
                <!-- <span class="online-pill"><span class="online-dot"></span><span>Koleksi PDF tersedia</span></span> -->
                <button class="btn btn-light" id="libraryButton" type="button" hidden>← Semua buku</button>
                <button class="btn btn-light" id="coverButton" type="button" hidden disabled>
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M4 12a8 8 0 1 0 2.7-6M4 4v5h5" stroke="currentColor" stroke-width="1.8"
                            stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                    <span>Ke Sampul</span>
                </button>
            </div>
        </header>

        <main class="main-content">
            <section class="library-view" id="libraryView" aria-label="Daftar buku">
                <div class="library-hero">
                    <div class="eyebrow"><span class="eyebrow-line"></span> SELAMAT DATANG DI FOLIO <span
                            class="eyebrow-line"></span></div>
                    <h1>Pilih buku, lalu <em>mulai membaca.</em></h1>
                    <!-- <p>Semua buku diambil otomatis dari folder PDF. Klik sampul untuk membaca dengan animasi membalik
                        halaman.</p> -->
                </div>
                <div class="library-heading">
                    <div class="library-heading-copy">
                        <span class="shelf-kicker">RAK BUKU DIGITAL</span>
                        <h2>Koleksi buku <span class="count-pill" id="bookCount">0 buku</span></h2>
                    </div>
                    <label class="search-field">
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="1.7" />
                            <path d="M15.5 15.5L21 21" stroke="currentColor" stroke-width="1.7"
                                stroke-linecap="round" />
                        </svg>
                        <input id="bookSearch" type="search" placeholder="Cari judul buku..." autocomplete="off"
                            aria-label="Cari judul buku" />
                    </label>
                </div>
                <div class="book-grid" id="bookGrid" aria-live="polite"></div>
                <div class="library-empty" id="libraryEmpty" hidden>
                    <div class="library-empty-icon">📚</div>
                    <h3 id="libraryEmptyTitle">Belum ada buku</h3>
                    <p id="libraryEmptyMessage">Tambahkan file PDF ke folder <code>pdf/</code> di hosting Anda, lalu
                        muat ulang halaman.</p>
                </div>
                <!-- <div class="library-tip">✦ &nbsp; Tambahkan atau hapus file PDF di folder <code>pdf/</code>, daftar buku akan berubah otomatis setelah refresh.</div> -->
            </section>
            <section class="reader-view" id="readerView" hidden>
                <div class="intro" id="intro">
                    <div class="eyebrow"><span class="eyebrow-line"></span> RUANG BACA DIGITAL <span
                            class="eyebrow-line"></span></div>
                    <h1>Setiap halaman, <em>terasa nyata.</em></h1>
                    <p>Balik halamannya seperti membaca buku sungguhan.</p>
                </div>

                <div class="reader-header" id="readerHeader" hidden>
                    <div class="reader-title-wrap">
                        <span class="file-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none">
                                <path
                                    d="M7 3h7l5 5v12a1 1 0 01-1 1H7a2 2 0 01-2-2V5a2 2 0 012-2zM14 3v5h5M9 13h6M9 17h6"
                                    stroke="currentColor" stroke-width="1.6" stroke-linecap="round"
                                    stroke-linejoin="round" />
                            </svg></span>
                        <div class="reader-title-text"><strong id="fileName">Dokumen PDF</strong><span
                                id="fileMeta">Siap dibaca</span></div>
                    </div>
                    <div class="reader-header-actions">
                        <!-- <span class="reader-privacy">PDF dari koleksi perpustakaan</span> -->
                    </div>
                </div>

                <section class="stage" id="dropZone" aria-label="Area buku digital">
                    <div class="ambient ambient-one"></div>
                    <div class="ambient ambient-two"></div>
                    <div class="stage-decoration decoration-left">✳</div>
                    <div class="stage-decoration decoration-right">✳</div>
                    <div class="empty-content" id="emptyState" hidden>
                        <div class="book-showcase" aria-hidden="true">
                            <div class="showcase-back"></div>
                            <div class="showcase-middle"></div>
                            <div class="showcase-front">
                                <div class="showcase-cover-line"></div>
                                <div class="showcase-star">✧</div>
                                <div class="showcase-title">YOUR<br />STORY</div>
                                <div class="showcase-cover-small">BEGINS HERE · VOL. 01</div>
                                <div class="showcase-bottom"></div>
                            </div><span class="showcase-spark s1">✧</span><span class="showcase-spark s2">✦</span>
                        </div>
                        <div class="empty-tag">BUKU TIDAK TERSEDIA</div>
                        <h2>PDF belum bisa dibuka</h2>
                        <p id="errorMessage">Periksa lokasi file PDF di source code dan pastikan website dijalankan
                            melalui server.</p>
                        <button class="btn btn-accent" id="retryButton" type="button">Coba buka lagi <span
                                class="btn-arrow" aria-hidden="true">↗</span></button>
                        <div class="empty-footnote">Jika PDF bermasalah, kembali ke daftar buku dan pilih buku lainnya.
                        </div>
                    </div>
                    <div class="loading" id="loadingState" hidden role="status" aria-live="polite">
                        <div class="loading-book" aria-hidden="true"><span></span><span></span><span></span></div>
                        <h2>Menyiapkan buku...</h2>
                        <p id="loadingMessage">Sedang membaca halaman PDF</p>
                        <div class="progress-track">
                            <div class="progress-value" id="progressValue"></div>
                        </div>
                        <span class="progress-label" id="progressLabel">0%</span>
                    </div>
                    <div class="book-area" id="bookArea" hidden>
                        <div id="book" class="book-mount" aria-label="Flipbook PDF"></div>
                        <div class="book-shadow"></div>
                    </div>
                </section>

                <div class="toolbar" aria-label="Navigasi flipbook">
                    <div class="toolbar-group toolbar-left"><span class="tool-caption">HALAMAN</span><span
                            class="page-indicator"><input type="number" min="1" value="1" id="pageInput"
                                aria-label="Nomor halaman" disabled /><span class="page-divider">/</span><span
                                id="totalPages">—</span></span></div>
                    <div class="toolbar-group toolbar-center">
                        <button class="icon-button" id="firstPage" type="button" title="Halaman pertama"
                            aria-label="Halaman pertama" disabled><svg viewBox="0 0 24 24" fill="none">
                                <path d="M5 5v14M18 6l-7 6 7 6" stroke="currentColor" stroke-width="1.8"
                                    stroke-linecap="round" stroke-linejoin="round" />
                            </svg></button>
                        <button class="icon-button nav-primary" id="prevPage" type="button"
                            title="Halaman sebelumnya (←)" aria-label="Halaman sebelumnya" disabled><svg
                                viewBox="0 0 24 24" fill="none">
                                <path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
                                    stroke-linejoin="round" />
                            </svg></button>
                        <span class="nav-divider"></span>
                        <button class="icon-button nav-primary" id="nextPage" type="button"
                            title="Halaman berikutnya (→)" aria-label="Halaman berikutnya" disabled><svg
                                viewBox="0 0 24 24" fill="none">
                                <path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
                                    stroke-linejoin="round" />
                            </svg></button>
                        <button class="icon-button" id="lastPage" type="button" title="Halaman terakhir"
                            aria-label="Halaman terakhir" disabled><svg viewBox="0 0 24 24" fill="none">
                                <path d="M19 5v14M6 6l7 6-7 6" stroke="currentColor" stroke-width="1.8"
                                    stroke-linecap="round" stroke-linejoin="round" />
                            </svg></button>
                    </div>
                    <div class="toolbar-group toolbar-right">
                        <button class="tool-action" id="zoomButton" type="button" disabled><svg viewBox="0 0 24 24"
                                fill="none">
                                <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="1.7" />
                                <path d="M15.5 15.5L21 21M8 10.5h5M10.5 8v5" stroke="currentColor" stroke-width="1.7"
                                    stroke-linecap="round" />
                            </svg><span>Zoom</span></button>
                        <span class="tool-separator"></span>
                        <button class="tool-action" id="fullscreenButton" type="button" disabled><svg
                                viewBox="0 0 24 24" fill="none">
                                <path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4" stroke="currentColor" stroke-width="1.7"
                                    stroke-linecap="round" stroke-linejoin="round" />
                            </svg><span>Layar penuh</span></button>
                        <a class="tool-action download-action" id="downloadPdf" download href="#" aria-disabled="true"
                            tabindex="-1"><svg viewBox="0 0 24 24" fill="none">
                                <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 17v2a1 1 0 001 1h12a1 1 0 001-1v-2"
                                    stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
                                    stroke-linejoin="round" />
                            </svg><span>Unduh</span></a>
                    </div>
                </div>
                <div class="below-toolbar"><span><span class="tip-icon">✦</span> Klik atau geser sudut halaman untuk
                        membalik buku</span><span class="tip-secondary">Tombol keyboard <kbd>←</kbd> <kbd>→</kbd> juga
                        bisa</span></div>
            </section>
        </main>
        <footer class="footer"><span>folio<span class="brand-period">.</span></span><span>Dibuat agar setiap cerita
                terasa
                lebih dekat <span class="footer-heart">♡</span></span>VINCENTVENAN33 ©2026</span></footer>
    </div>

    <div class="toast" id="toast" role="alert" hidden></div>
    <div class="zoom-modal" id="zoomModal" hidden role="dialog" aria-modal="true" aria-label="Perbesar halaman PDF">
        <div class="zoom-header"><span id="zoomPageLabel">Halaman 1</span>
            <div class="zoom-controls"><button id="zoomOut" class="zoom-icon" type="button"
                    aria-label="Perkecil">−</button><span id="zoomLevel">100%</span><button id="zoomIn"
                    class="zoom-icon" type="button" aria-label="Perbesar">+</button><button id="closeZoom"
                    class="zoom-close" type="button" aria-label="Tutup zoom">✕</button></div>
        </div>
        <div class="zoom-scroll" id="zoomScroll"><img id="zoomImage" alt="Pratinjau halaman PDF" /></div>
    </div>
</body>

</html>