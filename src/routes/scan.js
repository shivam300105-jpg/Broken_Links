// src/routes/scan.js
import express from 'express';
import { startScan } from '../services/scannerService.js';

const router = express.Router();

// Simple request/response - waits for the full scan to finish, then returns JSON.
router.post('/scan', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ success: false, error: 'url is required' });
  }

  try {
    const report = await startScan(url);
    res.json(report);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Live progress via Server-Sent Events - use this from the frontend for
// real-time "Pages Scanned / Links Found / Checked / Remaining" updates.
router.get('/scan-stream', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ success: false, error: 'url is required' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await startScan(url, sendEvent);
  } catch (err) {
    sendEvent({ phase: 'error', error: err.message });
  }

  res.end();
});

export default router;