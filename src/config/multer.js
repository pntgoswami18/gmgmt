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

// getPrefix, when provided, is called with req at filename-generation time
// (after Express has populated req.params, but before/independent of
// req.body — multer resets req.body while parsing the multipart stream, so
// a prefix set on req.body by earlier middleware is silently discarded).
const uploadSingle = (field, getPrefix) =>
  multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, './public/uploads/'),
      filename: function (req, file, cb) {
        const rawPrefix = typeof getPrefix === 'function' ? getPrefix(req) : undefined;
        const base = sanitizePrefix(rawPrefix);
        // crypto random suffix avoids same-millisecond collisions and makes
        // stored filenames unguessable.
        const unique = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${base}-${unique}${ext}`);
      },
    }),
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
