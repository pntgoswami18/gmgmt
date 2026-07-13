const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { matchesSignature } = require('../../utils/imageSignature');
const { writeUploadedFile } = require('../../config/multer');
const memberController = require('../../api/controllers/memberController');
const settingsController = require('../../api/controllers/settingsController');

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const GIF_BYTES = Buffer.from('GIF89a' + 'x'.repeat(10));
const NOT_AN_IMAGE = Buffer.from('<?php system($_GET["c"]); ?>');

function mockRes() {
  const res = { _status: 200, _body: null };
  res.status = (code) => {
    res._status = code;
    return res;
  };
  res.json = (body) => {
    res._body = body;
    return res;
  };
  return res;
}

test('matchesSignature — accepts real JPEG bytes for .jpg/.jpeg', () => {
  assert.equal(matchesSignature(JPEG_BYTES, '.jpg'), true);
  assert.equal(matchesSignature(JPEG_BYTES, '.jpeg'), true);
});

test('matchesSignature — accepts real PNG bytes for .png', () => {
  assert.equal(matchesSignature(PNG_BYTES, '.png'), true);
});

test('matchesSignature — accepts real GIF bytes for .gif', () => {
  assert.equal(matchesSignature(GIF_BYTES, '.gif'), true);
});

test('matchesSignature — rejects mismatched content/extension pairs', () => {
  assert.equal(matchesSignature(JPEG_BYTES, '.png'), false);
  assert.equal(matchesSignature(PNG_BYTES, '.gif'), false);
  assert.equal(matchesSignature(NOT_AN_IMAGE, '.jpg'), false);
  assert.equal(matchesSignature(NOT_AN_IMAGE, '.png'), false);
  assert.equal(matchesSignature(NOT_AN_IMAGE, '.gif'), false);
});

test('matchesSignature — rejects a real image of one type spoofed as another (the actual attack this feature stops)', () => {
  // A genuine GIF renamed to .jpg/.png, or a genuine JPEG renamed to .gif — not
  // garbage bytes, but a real image of the WRONG claimed type.
  assert.equal(matchesSignature(GIF_BYTES, '.jpg'), false);
  assert.equal(matchesSignature(GIF_BYTES, '.png'), false);
  assert.equal(matchesSignature(JPEG_BYTES, '.gif'), false);
});

test('matchesSignature — does not false-positive on empty or truncated buffers', () => {
  assert.equal(matchesSignature(Buffer.alloc(0), '.png'), false);
  assert.equal(matchesSignature(Buffer.from([0x89, 0x50]), '.png'), false); // shorter than PNG signature
  assert.equal(matchesSignature(Buffer.from([0xff, 0xd8]), '.jpg'), false); // shorter than JPEG signature
});

test('writeUploadedFile — writes a valid image to public/uploads and returns its filename', async () => {
  const file = { originalname: 'photo.png', buffer: PNG_BYTES };
  const filename = await writeUploadedFile(file, 'test-prefix');

  assert.match(filename, /^test-prefix-\d+-[0-9a-f]{16}\.png$/);
  const written = fs.readFileSync(path.join('./public/uploads/', filename));
  assert.deepEqual(written, PNG_BYTES);

  fs.unlinkSync(path.join('./public/uploads/', filename));
});

test('writeUploadedFile — rejects content that does not match its extension, without writing to disk', async () => {
  const file = { originalname: 'fake.png', buffer: NOT_AN_IMAGE };
  const before = fs.readdirSync('./public/uploads/');

  await assert.rejects(() => writeUploadedFile(file, 'test-prefix'));

  const after = fs.readdirSync('./public/uploads/');
  assert.deepEqual(after, before);
});

test('writeUploadedFile — the rejection is tagged statusCode 400 (so callers can distinguish it from I/O errors)', async () => {
  const file = { originalname: 'fake.png', buffer: NOT_AN_IMAGE };
  await assert.rejects(
    () => writeUploadedFile(file, 'test-prefix'),
    (err) => {
      assert.equal(err.statusCode, 400);
      return true;
    }
  );
});

test('uploadMemberPhoto handler — 400s with a clear message when the uploaded content is spoofed, and does not touch the DB', async () => {
  const handler = memberController.uploadMemberPhoto[memberController.uploadMemberPhoto.length - 1];
  const req = {
    params: {}, // no id -> DB update branch is skipped entirely
    body: { prefix: 'member-unknown' },
    file: { originalname: 'photo.png', buffer: NOT_AN_IMAGE },
  };
  const res = mockRes();

  await handler(req, res);

  assert.equal(res._status, 400);
  assert.match(res._body.message, /does not match/i);
});

test('uploadMemberPhoto handler — derives the filename prefix from the route param, ignoring any client-supplied req.body.prefix', async () => {
  // Regression test: the prefix must come from req.params.id, never from
  // req.body — multer resets req.body while parsing the multipart stream,
  // so a client-supplied value there is unreliable and must not be trusted
  // for naming (or as an injection vector).
  const handler = memberController.uploadMemberPhoto[memberController.uploadMemberPhoto.length - 1];
  const req = {
    params: { id: '999999999' }, // nonexistent id -> UPDATE affects 0 rows, no throw
    body: { prefix: 'evil-injected-name' },
    file: { originalname: 'photo.png', buffer: PNG_BYTES },
  };
  const res = mockRes();

  await handler(req, res);

  assert.equal(res._status, 200);
  assert.match(res._body.photo_url, /^\/uploads\/member-999999999-/);
  assert.doesNotMatch(res._body.photo_url, /evil-injected-name/);
});

test('settingsController.uploadLogo — 400s when the uploaded content is spoofed', async () => {
  const req = {
    body: { prefix: 'logo' },
    file: { originalname: 'logo.gif', buffer: NOT_AN_IMAGE },
  };
  const res = mockRes();

  await settingsController.uploadLogo(req, res);

  assert.equal(res._status, 400);
  assert.match(res._body.message, /does not match/i);
});

test('uploadMemberPhoto handler — a non-validation error (e.g. disk write failure) surfaces as 500, not 400', async () => {
  // Distinguishes the fix from the old behavior, where the controller mapped
  // ANY error out of writeUploadedFile — including real I/O failures — to 400.
  // Making public/uploads/ read-only forces a genuine fs.writeFile failure
  // (not a signature-validation failure) on an otherwise-valid PNG.
  const uploadsDir = './public/uploads/';
  const originalMode = fs.statSync(uploadsDir).mode;
  fs.chmodSync(uploadsDir, 0o444);
  try {
    const handler =
      memberController.uploadMemberPhoto[memberController.uploadMemberPhoto.length - 1];
    const req = {
      params: {},
      body: { prefix: 'member-unknown' },
      file: { originalname: 'photo.png', buffer: PNG_BYTES },
    };
    const res = mockRes();

    await handler(req, res);

    assert.equal(res._status, 500);
  } finally {
    fs.chmodSync(uploadsDir, originalMode);
  }
});
