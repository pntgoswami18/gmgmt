const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

// Only these extensions/mime types are accepted for image uploads.
const ALLOWED_EXTENSIONS = new Set(['.jpeg', '.jpg', '.png', '.gif']);
const ALLOWED_MIMETYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif']);

// Sanitize a caller-supplied prefix so it can't be used for path traversal or
// to inject unexpected characters into the stored filename.
function sanitizePrefix(prefix) {
  return (
    String(prefix || 'upload')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 40) || 'upload'
  );
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, './public/uploads/'),
  filename: function (req, file, cb) {
    const base = sanitizePrefix(req.body && req.body.prefix);
    // crypto random suffix avoids same-millisecond collisions and makes
    // stored filenames unguessable.
    const unique = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${base}-${unique}${ext}`);
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 1000000 }, // 1MB limit
  fileFilter: function (req, file, cb) {
    checkFileType(file, cb);
  },
});

const uploadSingle = (field) =>
  multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => checkFileType(file, cb),
  }).single(field);

module.exports = { uploadSingle };

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

// Do not overwrite the named exports
