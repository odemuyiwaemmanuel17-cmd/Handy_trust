/**
 * HandyTrust — File Upload Middleware (Multer)
 * Memory storage — files passed as buffers to controllers for S3 upload
 */

const multer = require('multer');
const { AppError } = require('../utils/response');

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
const ALLOWED_DOC_TYPES = ['application/pdf'];
const ALLOWED_ALL_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES, ...ALLOWED_DOC_TYPES];

const memoryStorage = multer.memoryStorage();

const makeFilter = (types) => (_req, file, cb) => {
    if (types.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new AppError(`File type not allowed. Accepted: ${types.join(', ')}`, 415, 'INVALID_FILE_TYPE'));
    }
};

const onError = (err, next) => {
    if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError('File exceeds size limit', 413, 'FILE_TOO_LARGE'));
    }
    next(err);
};

/** Single image upload (avatars, etc.) — 5 MB */
const uploadImage = multer({
    storage: memoryStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: makeFilter(ALLOWED_IMAGE_TYPES),
});

/** Single evidence file (image or video) — 25 MB */
const uploadEvidence = multer({
    storage: memoryStorage,
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: makeFilter(ALLOWED_ALL_TYPES),
});

/** Multiple ID docs — 10 MB each */
const uploadDocuments = multer({
    storage: memoryStorage,
    limits: { fileSize: 10 * 1024 * 1024, files: 3 },
    fileFilter: makeFilter([...ALLOWED_IMAGE_TYPES, ...ALLOWED_DOC_TYPES]),
});

module.exports = { uploadImage, uploadEvidence, uploadDocuments, onError };