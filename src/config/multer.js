const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, './public/uploads/'),
    filename: function(req, file, cb){
        const base = (req.body && req.body.prefix) ? String(req.body.prefix) : 'upload';
        const unique = Date.now();
        cb(null, `${base}-${unique}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 1000000 }, // 1MB limit
    fileFilter: function(req, file, cb){
        checkFileType(file, cb);
    }
});

const uploadSingle = (field) => multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req, file, cb) => checkFileType(file, cb) }).single(field);

module.exports = { uploadSingle };

function checkFileType(file, cb){
    const filetypes = /jpeg|jpg|png|gif/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);

    if(mimetype && extname){
        return cb(null, true);
    } else {
        cb('Error: Images Only!');
    }
}

// Do not overwrite the named exports

