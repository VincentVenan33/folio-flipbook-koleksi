<?php
/**
 * Mengambil PDF sebagai data untuk pembaca flipbook, bukan mengarahkan browser
 * ke URL .pdf. Ini membantu menghindari penangkapan unduhan oleh IDM/ekstensi.
 * Hanya melayani file PDF di dalam folder pdf/, tanpa subfolder.
 */
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    http_response_code(405);
    header('Content-Type: text/plain; charset=utf-8');
    exit('Gunakan pembaca flipbook pada index.php.');
}

$filename = $_POST['file'] ?? null;
if (!is_string($filename)
    || $filename === ''
    || preg_match('~[/\\\\\x00]~', $filename)
    || strtolower(pathinfo($filename, PATHINFO_EXTENSION)) !== 'pdf') {
    http_response_code(400);
    header('Content-Type: text/plain; charset=utf-8');
    exit('Nama file PDF tidak valid.');
}

$directory = realpath(__DIR__ . DIRECTORY_SEPARATOR . 'pdf');
$path = $directory === false ? false : $directory . DIRECTORY_SEPARATOR . $filename;
if ($path === false || !is_file($path) || is_link($path) || !is_readable($path)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    exit('File PDF tidak ditemukan di folder pdf/.');
}

// PDF.js membaca byte dari fetch() JavaScript; respons tidak memicu penampil
// PDF bawaan browser / jendela unduh. MIME ini sengaja bukan application/pdf.
@ini_set('zlib.output_compression', '0');
while (ob_get_level() > 0) {
    @ob_end_clean();
}
header('Content-Type: application/x-folio-book');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: private, no-store, max-age=0');
header('Content-Length: ' . filesize($path));
readfile($path);
