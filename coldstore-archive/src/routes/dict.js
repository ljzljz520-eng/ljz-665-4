const express = require('express');
const { db } = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

router.get('/zones', (_req, res) => res.json(db.prepare('SELECT * FROM temp_zones ORDER BY sort_no').all()));
router.get('/statuses', (_req, res) => res.json(db.prepare('SELECT * FROM status_dict ORDER BY sort_no').all()));

module.exports = router;
