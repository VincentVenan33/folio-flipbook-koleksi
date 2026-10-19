/*
 * Folio PDF Flipbook — Otomatis memindai folder pdf/ lewat index.php.
 * Pengunjung memilih buku dari koleksi; tanpa upload atau database.
 * PDF.js v3.11.174 + StPageFlip v2.0.7 dari CDN.
 */
(() => {
  'use strict';

  const BOOKS = Array.isArray(window.FOLIO_BOOKS) ? window.FOLIO_BOOKS : [];
  let BOOK_CONFIG = { pdfUrl: '', title: '', downloadName: '' };
  let activeBook = null;
  let activeRequestController = null;
  const PDF_ENDPOINT = './baca.php';
  const escapeSearch = (text) => String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const formatBytes = (value) => (value >= 1024 * 1024)
    ? `${(value / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(value / 1024))} KB`;

  const $ = (id) => document.getElementById(id);
  const dom = {
    coverButton: $('coverButton'), retryButton: $('retryButton'), errorMessage: $('errorMessage'),
    libraryButton: $('libraryButton'), libraryView: $('libraryView'), readerView: $('readerView'),
    bookSearch: $('bookSearch'), bookGrid: $('bookGrid'), bookCount: $('bookCount'),
    libraryEmpty: $('libraryEmpty'), libraryEmptyTitle: $('libraryEmptyTitle'), libraryEmptyMessage: $('libraryEmptyMessage'),
    intro: $('intro'), readerHeader: $('readerHeader'), fileName: $('fileName'), fileMeta: $('fileMeta'),
    stage: $('dropZone'), empty: $('emptyState'), loading: $('loadingState'), bookArea: $('bookArea'),
    loadingMessage: $('loadingMessage'), progressValue: $('progressValue'), progressLabel: $('progressLabel'),
    pageInput: $('pageInput'), totalPages: $('totalPages'),
    firstPage: $('firstPage'), prevPage: $('prevPage'), nextPage: $('nextPage'), lastPage: $('lastPage'),
    zoomButton: $('zoomButton'), fullscreenButton: $('fullscreenButton'), downloadPdf: $('downloadPdf'),
    zoomModal: $('zoomModal'), zoomImage: $('zoomImage'), zoomPageLabel: $('zoomPageLabel'), zoomLevel: $('zoomLevel'),
    zoomIn: $('zoomIn'), zoomOut: $('zoomOut'), closeZoom: $('closeZoom'), toast: $('toast')
  };

  let flip = null;
  let pdfDocument = null;
  let imageUrls = [];
  let currentPage = 0;
  let totalPages = 0;
  let baseAspectRatio = 1 / Math.sqrt(2);
  let loadId = 0;
  let busy = false;
  let resizeTimer = null;
  let toastTimer = null;
  let zoomFactor = 1;

  const WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const navButtons = [dom.firstPage, dom.prevPage, dom.nextPage, dom.lastPage];
  const allViewerControls = [...navButtons, dom.pageInput, dom.zoomButton, dom.fullscreenButton, dom.coverButton];

  function toast(message) {
    dom.toast.textContent = message;
    dom.toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { dom.toast.hidden = true; }, 4800);
  }

  function show(name) {
    dom.empty.hidden = name !== 'empty' && name !== 'error';
    dom.loading.hidden = name !== 'loading';
    dom.bookArea.hidden = name !== 'book';
    dom.readerHeader.hidden = name !== 'book';
    dom.intro.hidden = name === 'book';
  }

  function updateControls() {
    const enabled = Boolean(flip) && !busy && totalPages > 0;
    allViewerControls.forEach((button) => { button.disabled = !enabled; });
    dom.pageInput.max = String(Math.max(1, totalPages));
    dom.pageInput.value = String(enabled ? currentPage + 1 : 1);
    dom.totalPages.textContent = enabled ? String(totalPages) : '—';
    dom.firstPage.disabled = !enabled || currentPage === 0;
    dom.prevPage.disabled = !enabled || currentPage === 0;
    dom.lastPage.disabled = !enabled || currentPage >= totalPages - 1;
    dom.nextPage.disabled = !enabled || currentPage >= totalPages - 1;
    dom.coverButton.disabled = !enabled || currentPage === 0;
    dom.downloadPdf.setAttribute('aria-disabled', String(!enabled));
    dom.downloadPdf.tabIndex = enabled ? 0 : -1;
  }

  function setProgress(done, count) {
    const percentage = Math.round((done / Math.max(count, 1)) * 100);
    dom.progressValue.style.width = percentage + '%';
    dom.progressLabel.textContent = percentage + '%';
    dom.loadingMessage.textContent = done === 0
      ? `Mendeteksi ${count} halaman PDF...`
      : `Memproses halaman ${done} dari ${count}`;
  }

  function destroyFlip() {
    if (flip) {
      try { flip.destroy(); } catch (error) { console.warn('Tidak dapat melepas flipbook:', error); }
      flip = null;
    }
    const existing = $('book');
    if (existing) existing.remove();
    const fresh = document.createElement('div');
    fresh.id = 'book';
    fresh.className = 'book-mount';
    fresh.setAttribute('aria-label', 'Flipbook PDF');
    dom.bookArea.insertBefore(fresh, dom.bookArea.firstChild);
  }

  function releaseOldDocument() {
    destroyFlip();
    if (pdfDocument) {
      const old = pdfDocument;
      pdfDocument = null;
      try { void old.destroy().catch(() => {}); } catch (_) { /* no-op */ }
    }
    for (const url of imageUrls) if (url) URL.revokeObjectURL(url);
    imageUrls = [];
    dom.downloadPdf.removeAttribute('href');
    dom.downloadPdf.removeAttribute('download');
    totalPages = 0;
    currentPage = 0;
    updateControls();
  }

  async function canvasToJpegBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Konversi halaman gagal')), 'image/jpeg', 0.88);
    });
  }

  async function renderPage(documentHandle, index) {
    const page = await documentHandle.getPage(index + 1);
    const viewportAtOne = page.getViewport({ scale: 1 });
    // JPEG resolusi lebar ±1300 px cukup tajam sambil menghemat memori.
    // Untuk halaman ukuran besar, jumlah piksel juga dibatasi.
    const wantedScale = Math.min(2.25, 1350 / viewportAtOne.width);
    const pixelBudgetScale = Math.sqrt(2_400_000 / (viewportAtOne.width * viewportAtOne.height));
    const scale = Math.min(wantedScale, pixelBudgetScale);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
    if (!context) throw new Error('Browser tidak mendukung Canvas 2D.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport, background: 'rgb(255,255,255)' }).promise;
    const blob = await canvasToJpegBlob(canvas);
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
    return URL.createObjectURL(blob);
  }

  async function startBook() {
    if (!window.pdfjsLib || !window.St?.PageFlip) {
      show('error');
      dom.errorMessage.textContent = 'Library pembaca PDF belum termuat. Pastikan internet aktif untuk PDF.js dan PageFlip, lalu klik Coba buka lagi.';
      return;
    }
    const myLoadId = ++loadId;
    activeRequestController?.abort();
    const controller = new AbortController();
    activeRequestController = controller;
    busy = true;
    releaseOldDocument();
    show('loading');
    setProgress(0, 1);
    updateControls();

    let workingDocument = null;
    const pendingUrls = [];
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
      // Perbaikan IDM: ambil isi PDF lewat POST PHP, BUKAN navigasi ke URL *.pdf.
      // Uint8Array diberikan langsung ke PDF.js; browser tidak melakukan unduhan.
      dom.loadingMessage.textContent = 'Mengambil isi buku dari server...';
      const response = await fetch(PDF_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: new URLSearchParams({ file: BOOK_CONFIG.downloadName }),
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal
      });
      if (!response.ok) {
        const serverMessage = (await response.text()).trim();
        throw new Error(`Server ${response.status}: ${serverMessage || 'Tidak dapat membaca PDF.'}`);
      }
      const contents = new Uint8Array(await response.arrayBuffer());
      if (myLoadId !== loadId) return;
      // Cek header PDF (boleh muncul dalam 1024 byte pertama sesuai format PDF).
      const header = Array.from(contents.subarray(0, 1024), (byte) => String.fromCharCode(byte)).join('');
      if (!header.includes('%PDF-')) {
        throw new Error('Respons server bukan PDF yang valid. Periksa isi file dan pengaturan PHP.');
      }
      const pdfTask = window.pdfjsLib.getDocument({ data: contents });
      workingDocument = await pdfTask.promise;
      if (myLoadId !== loadId) return;
      const count = workingDocument.numPages;
      if (!count) throw new Error('Dokumen tidak memiliki halaman.');

      const firstPage = await workingDocument.getPage(1);
      const size = firstPage.getViewport({ scale: 1 });
      const aspect = size.width / size.height;
      firstPage.cleanup();
      setProgress(0, count);
      pendingUrls.length = count;

      let nextIndex = 0;
      let completed = 0;
      const worker = async () => {
        while (nextIndex < count && myLoadId === loadId) {
          const index = nextIndex++;
          const imageUrl = await renderPage(workingDocument, index);
          if (myLoadId !== loadId) { URL.revokeObjectURL(imageUrl); return; }
          pendingUrls[index] = imageUrl;
          completed++;
          setProgress(completed, count);
        }
      };
      await Promise.all(Array.from({ length: Math.min(count, 2) }, worker));
      if (myLoadId !== loadId) return;

      pdfDocument = workingDocument;
      workingDocument = null;
      imageUrls = pendingUrls.slice();
      pendingUrls.length = 0;
      totalPages = count;
      baseAspectRatio = aspect;
      currentPage = 0;
      dom.downloadPdf.href = BOOK_CONFIG.pdfUrl;
      dom.downloadPdf.download = BOOK_CONFIG.downloadName;
      dom.fileName.textContent = BOOK_CONFIG.title;
      dom.fileMeta.textContent = `${count} halaman · Buku siap dibaca`;

      busy = false;
      show('book');
      initFlipbook(0);
      updateControls();
    } catch (error) {
      if (myLoadId !== loadId) return;
      console.error('Tidak dapat membuka buku PDF:', error);
      busy = false;
      show('error');
      if (error?.name === 'PasswordException') {
        dom.errorMessage.textContent = 'PDF dilindungi kata sandi. Gunakan PDF tanpa sandi pada konfigurasi buku.';
      } else if (error?.name === 'AbortError') {
        dom.errorMessage.textContent = 'Pemuatan PDF dibatalkan.';
      } else {
        dom.errorMessage.textContent = `Tidak dapat membuka buku: ${error?.message || String(error)}. Pastikan Apache/XAMPP aktif dan file ada dalam folder pdf/.`;
      }
      updateControls();
    } finally {
      if (activeRequestController === controller) activeRequestController = null;
      if (workingDocument) {
        try { await workingDocument.destroy(); } catch (_) { /* no-op */ }
      }
      pendingUrls.forEach((url) => { if (url) URL.revokeObjectURL(url); });
      if (myLoadId === loadId && !flip && !busy) updateControls();
    }
  }

  function initFlipbook(pageIndex = 0) {
    if (!imageUrls.length) return;
    destroyFlip();
    const mount = $('book');
    const stageWidth = Math.max(250, dom.bookArea.clientWidth - 32);
    const stageHeight = Math.max(270, dom.bookArea.clientHeight - 32);
    const portrait = stageWidth < 700;
    const fitWidth = portrait ? stageWidth - 12 : stageWidth / 2 - 20;
    const width = Math.max(135, Math.floor(Math.min(fitWidth, stageHeight * baseAspectRatio, 585)));
    const height = Math.floor(width / baseAspectRatio);
    mount.style.width = `${portrait ? width : width * 2}px`;
    mount.style.height = `${height}px`;

    const pageElements = imageUrls.map((url, index) => {
      const sheet = document.createElement('div');
      sheet.className = 'book-page' + (index === 0 ? ' book-page--cover' : '');
      const img = document.createElement('img');
      img.src = url;
      img.alt = `Halaman ${index + 1} dari ${totalPages}`;
      img.draggable = false;
      sheet.appendChild(img);
      mount.appendChild(sheet);
      return sheet;
    });

    flip = new window.St.PageFlip(mount, {
      width, height,
      size: 'fixed',
      autoSize: false,
      showCover: true,
      usePortrait: true,
      drawShadow: true,
      maxShadowOpacity: 0.48,
      flippingTime: 850,
      startPage: Math.min(Math.max(0, pageIndex), totalPages - 1),
      mobileScrollSupport: false,
      swipeDistance: 30,
      showPageCorners: true
    });
    flip.on('flip', (event) => {
      currentPage = Number(event.data) || 0;
      updateControls();
    });
    flip.on('init', (event) => {
      currentPage = Number(event.data?.page) || 0;
      updateControls();
    });
    flip.loadFromHTML(pageElements);
    currentPage = flip.getCurrentPageIndex();
    updateControls();
  }

  function previousPage() { if (flip && !busy) flip.flipPrev(); }
  function nextPage() { if (flip && !busy) flip.flipNext(); }
  function goToPage(index) {
    if (!flip || busy) return;
    const target = Math.min(totalPages - 1, Math.max(0, index));
    flip.turnToPage(target);
    currentPage = flip.getCurrentPageIndex();
    updateControls();
  }

  function usePageInput() {
    const requested = Number.parseInt(dom.pageInput.value, 10);
    if (!Number.isFinite(requested)) { updateControls(); return; }
    goToPage(requested - 1);
  }

  function openZoom() {
    if (!imageUrls.length || busy) return;
    zoomFactor = 1;
    const imageIndex = Math.min(Math.max(currentPage, 0), totalPages - 1);
    dom.zoomImage.src = imageUrls[imageIndex];
    dom.zoomPageLabel.textContent = `Halaman ${imageIndex + 1} dari ${totalPages}`;
    dom.zoomImage.alt = `Halaman PDF nomor ${imageIndex + 1}`;
    dom.zoomModal.hidden = false;
    document.body.style.overflow = 'hidden';
    updateZoom();
    dom.closeZoom.focus();
  }
  function updateZoom() {
    const fittedWidth = Math.min(window.innerWidth - 65, 890);
    dom.zoomImage.style.width = `${Math.round(fittedWidth * zoomFactor)}px`;
    dom.zoomLevel.textContent = Math.round(zoomFactor * 100) + '%';
  }
  function closeZoom() {
    dom.zoomModal.hidden = true;
    document.body.style.overflow = '';
    dom.zoomImage.removeAttribute('src');
    dom.zoomButton.focus();
  }
  function changeZoom(delta) {
    zoomFactor = Math.max(0.5, Math.min(3, Math.round((zoomFactor + delta) * 100) / 100));
    updateZoom();
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await $('appShell').requestFullscreen();
    } catch (_) { toast('Browser tidak mengizinkan mode layar penuh.'); }
  }

  dom.coverButton.addEventListener('click', () => goToPage(0));
  dom.libraryButton.addEventListener('click', () => openLibrary());
  dom.retryButton.addEventListener('click', () => { void startBook(); });
  dom.prevPage.addEventListener('click', previousPage);
  dom.nextPage.addEventListener('click', nextPage);
  dom.firstPage.addEventListener('click', () => goToPage(0));
  dom.lastPage.addEventListener('click', () => goToPage(totalPages - 1));
  dom.pageInput.addEventListener('change', usePageInput);
  dom.pageInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); usePageInput(); dom.pageInput.blur(); } });
  dom.zoomButton.addEventListener('click', openZoom);
  dom.closeZoom.addEventListener('click', closeZoom);
  dom.zoomIn.addEventListener('click', () => changeZoom(0.25));
  dom.zoomOut.addEventListener('click', () => changeZoom(-0.25));
  dom.fullscreenButton.addEventListener('click', () => { void toggleFullscreen(); });
  dom.downloadPdf.addEventListener('click', (event) => { if (!totalPages) event.preventDefault(); });

  document.addEventListener('keydown', (event) => {
    if (!dom.zoomModal.hidden) {
      if (event.key === 'Escape') closeZoom();
      else if (event.key === '+' || event.key === '=') changeZoom(0.25);
      else if (event.key === '-') changeZoom(-0.25);
      return;
    }
    if (dom.readerView.hidden || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); nextPage(); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); previousPage(); }
    if (event.key === 'Home') { event.preventDefault(); goToPage(0); }
    if (event.key === 'End') { event.preventDefault(); goToPage(totalPages - 1); }
  });

  // Re-layout buku tanpa merender ulang PDF, misalnya setelah memutar HP.
  window.addEventListener('resize', () => {
    if (!dom.zoomModal.hidden) updateZoom();
    if (!flip || busy) return;
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (flip && !busy && !dom.bookArea.hidden) initFlipbook(currentPage);
    }, 260);
  });
  document.addEventListener('fullscreenchange', () => {
    dom.fullscreenButton.title = document.fullscreenElement ? 'Keluar dari layar penuh' : 'Layar penuh';
    if (flip && !busy) {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => initFlipbook(currentPage), 350);
    }
  });
  window.addEventListener('pagehide', () => {
    // URL objek bersifat sementara dan otomatis dibersihkan saat tab ditutup.
    for (const url of imageUrls) if (url) URL.revokeObjectURL(url);
  });

  // Sampul otomatis: baca hanya halaman pertama lewat endpoint PHP.
  const coverCache = new Map();
  const pageCountCache = new Map();
  const coverQueue = [];
  let coverWorkers = 0;
  const MAX_COVER_WORKERS = 2;
  async function makeCover(book, img, pageLabel) {
    if (pageCountCache.has(book.file) && pageLabel.isConnected) {
      pageLabel.textContent = `${pageCountCache.get(book.file)} halaman`;
    }
    if (coverCache.has(book.file)) { img.src = coverCache.get(book.file); return; }
    const response = await fetch(PDF_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ file: book.file }),
      cache: 'no-store'
    });
    if (!response.ok) throw new Error('Tidak dapat membaca sampul');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const task = window.pdfjsLib.getDocument({ data: bytes });
    const pdf = await task.promise;
    pageCountCache.set(book.file, pdf.numPages);
    if (pageLabel.isConnected) pageLabel.textContent = `${pdf.numPages} halaman`;
    try {
      const page = await pdf.getPage(1);
      const viewport1 = page.getViewport({ scale: 1 });
      const scale = Math.min(1.6, 540 / viewport1.width);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      coverCache.set(book.file, dataUrl);
      if (img.isConnected) img.src = dataUrl;
      page.cleanup();
      canvas.width = canvas.height = 0;
    } finally { await pdf.destroy(); }
  }
  function pumpCovers() {
    if (!window.pdfjsLib) return;
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
    while (coverWorkers < MAX_COVER_WORKERS && coverQueue.length) {
      const [book, img, pageLabel] = coverQueue.shift();
      coverWorkers++;
      makeCover(book, img, pageLabel).catch((err) => {
        if (pageLabel.isConnected && !pageCountCache.has(book.file)) pageLabel.textContent = 'Jumlah halaman tidak tersedia';
        console.warn('Sampul / jumlah halaman gagal:', book.file, err);
      })
        .finally(() => { coverWorkers--; pumpCovers(); });
    }
  }
  // ==================== DAFTAR KOLEKSI ====================
  function renderCatalog() {
    const keyword = escapeSearch(dom.bookSearch.value.trim());
    const matching = BOOKS.filter((book) => escapeSearch(book.title + ' ' + book.file).includes(keyword));
    dom.bookGrid.replaceChildren();
    dom.bookCount.textContent = `${BOOKS.length} buku`;
    dom.libraryEmpty.hidden = matching.length > 0;
    if (!matching.length) {
      dom.libraryEmptyTitle.textContent = BOOKS.length ? 'Buku tidak ditemukan' : 'Belum ada PDF di folder';
      dom.libraryEmptyMessage.textContent = BOOKS.length
        ? 'Coba cari dengan kata lain.'
        : 'Masukkan file .pdf ke dalam folder pdf/, kemudian refresh halaman.';
    }
    matching.forEach((book, index) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'library-card';
      card.setAttribute('aria-label', `Baca buku ${book.title}`);
      const cover = document.createElement('div');
      cover.className = `library-cover library-cover-${index % 6}`;
      const logo = document.createElement('span');
      logo.className = 'cover-mark';
      logo.textContent = 'FOLIO / DIGITAL LIBRARY';
      const coverTitle = document.createElement('strong');
      coverTitle.className = 'cover-book-title';
      coverTitle.textContent = book.title;
      const tag = document.createElement('span');
      tag.className = 'cover-book-tag';
      tag.textContent = 'BUKU DIGITAL  ✦  PDF';
      cover.append(logo, coverTitle, tag);
      const coverImage = document.createElement('img');
      coverImage.className = 'library-cover-image';
      coverImage.alt = `Sampul ${book.title}`;
      coverImage.loading = 'lazy';
      cover.appendChild(coverImage);
      const description = document.createElement('div');
      description.className = 'library-card-detail';
      const name = document.createElement('strong');
      name.className = 'library-book-name';
      name.textContent = book.title;
      name.title = book.title;
      const foot = document.createElement('div');
      foot.className = 'library-card-foot';
      const size = document.createElement('span');
      size.textContent = pageCountCache.has(book.file)
        ? `${pageCountCache.get(book.file)} halaman`
        : 'Memuat halaman...';
      coverQueue.push([book, coverImage, size]);
      const action = document.createElement('span');
      action.className = 'library-read-label';
      action.textContent = 'Baca buku →';
      foot.append(size, action);
      description.append(name, foot);
      card.append(cover, description);
      card.addEventListener('click', () => openBook(book));
      dom.bookGrid.appendChild(card);
    });
    pumpCovers();
  }

  function openBook(book, { updateHistory = true } = {}) {
    if (!book) return;
    activeBook = book;
    BOOK_CONFIG = { pdfUrl: book.url, title: book.title, downloadName: book.file };
    document.title = `${book.title} — Folio`;
    dom.libraryView.hidden = true;
    dom.readerView.hidden = false;
    dom.libraryButton.hidden = false;
    dom.coverButton.hidden = false;
    dom.fileName.textContent = book.title;
    if (updateHistory) {
      history.pushState({ book: book.file }, '', `${location.pathname}?book=${encodeURIComponent(book.file)}`);
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    void startBook();
  }

  function openLibrary({ updateHistory = true } = {}) {
    ++loadId; // batalkan pembacaan PDF sebelumnya (jika masih berjalan)
    activeRequestController?.abort();
    activeRequestController = null;
    busy = false;
    releaseOldDocument();
    activeBook = null;
    dom.libraryView.hidden = false;
    dom.readerView.hidden = true;
    dom.libraryButton.hidden = true;
    dom.coverButton.hidden = true;
    dom.zoomModal.hidden = true;
    document.body.style.overflow = '';
    document.title = 'Folio — Perpustakaan Digital';
    if (updateHistory) history.pushState({}, '', location.pathname);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  dom.bookSearch.addEventListener('input', renderCatalog);
  window.addEventListener('popstate', () => {
    const file = new URLSearchParams(location.search).get('book');
    const book = BOOKS.find((candidate) => candidate.file === file);
    if (book && activeBook?.file !== book.file) openBook(book, { updateHistory: false });
    else if (!book) openLibrary({ updateHistory: false });
  });
  renderCatalog();
  updateControls();
  const bookFromUrl = new URLSearchParams(location.search).get('book');
  const initialBook = BOOKS.find((book) => book.file === bookFromUrl);
  if (initialBook) openBook(initialBook, { updateHistory: false });
})();
