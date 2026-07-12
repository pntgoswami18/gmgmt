// Verifies a file's actual content against known image magic-byte signatures.
// The client-supplied extension/mimetype are spoofable; this checks what the
// bytes really are before anything gets written to disk.

const SIGNATURES = {
  '.jpg': [[0xff, 0xd8, 0xff]],
  '.jpeg': [[0xff, 0xd8, 0xff]],
  '.png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  '.gif': [
    [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
    [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // GIF89a
  ],
};

function matchesSignature(buffer, ext) {
  const candidates = SIGNATURES[String(ext).toLowerCase()];
  if (!candidates || !Buffer.isBuffer(buffer)) {
    return false;
  }
  return candidates.some(
    (bytes) => buffer.length >= bytes.length && bytes.every((byte, i) => buffer[i] === byte)
  );
}

module.exports = { matchesSignature };
