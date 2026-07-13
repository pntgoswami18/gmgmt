const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs/promises');
const fsSync = require('fs');
const { matchesSignature } = require('../utils/imageSignature');

// Only these extensions/mime types are accepted for image uploads.
const ALLOWED_EXTENSIONS = new Set(['.jpeg', '.jpg', '.png', '.gif']);
const ALLOWED_MIMETYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif']);

const UPLOAD_DIR = path.join(__dirname, '../../public/uploads');

// Ensure the upload directory exists at module load time (mirrors the
// pattern used by src/api/routes/firmware.js). `recursive: true` makes this
// a no-op if the directory already exists.
fsSync.mkdirSync(UPLOAD_DIR, { recursive: true });

// Sanitize a caller-supplied prefix so it can't be used for path traversal or
// to inject unexpected characters into the stored filename.
function sanitizePrefix(prefix) {
  return (
    String(prefix || 'upload')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 40) || 'upload'
  );
}

// Buffered in memory (not written to disk) so the content can be verified
// against its magic bytes before anything touches the filesystem.
const storage = multer.memoryStorage();

const uploadSingle = (field) =>
  multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => checkFileType(file, cb),
  }).single(field);

module.exports = { uploadSingle, writeUploadedFile };

function checkFileType(file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  const extOk = ALLOWED_EXTENSIONS.has(ext);
  const mimeOk = ALLOWED_MIMETYPES.has(String(file.mimetype).toLowerCase());

  if (extOk && mimeOk) {
    return cb(null, true);
  } else {
    cb(new Error('Only image files (jpeg, jpg, png, gif) are allowed.'));
  }
}

// Validates the buffered upload's actual content against its extension, then
// writes it to public/uploads/ with a randomized filename. Throws (without
// touching disk) if the bytes don't match a real image of that type.
async function writeUploadedFile(file, prefix) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!matchesSignature(file.buffer, ext)) {
    // statusCode marks this as a client-caused validation failure, distinct
    // from the fs.writeFile error below (disk full, permissions) which
    // should surface as a 500 rather than be mistaken for bad input.
    const err = new Error('File content does not match a valid image of the declared type.');
    err.statusCode = 400;
    throw err;
  }

  const base = sanitizePrefix(prefix);
  // crypto random suffix avoids same-millisecond collisions and makes
  // stored filenames unguessable.
  const unique = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  const filename = `${base}-${unique}${ext}`;

  await fs.writeFile(path.join(UPLOAD_DIR, filename), file.buffer);
  return filename;
}
