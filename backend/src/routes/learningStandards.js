/**
 * CERADRIVE ERP — Learning Standards routes (FUTURE-STANDARDS-0)
 *
 * PLACEHOLDER. This router is intentionally NOT mounted in routes/index.js.
 * It is delivered un-wired so no endpoint is reachable by any user.
 *
 * If/when activated in a future phase, mount it AND flip the feature flag:
 *   // in routes/index.js (future):
 *   // import learningStandards from './learningStandards.js';
 *   // router.use('/learning-standards', learningStandards);
 *
 * While the flag is false, every handler short-circuits to 503 (disabled) and
 * never reaches the placeholder service.
 */
import { Router } from 'express';
import { FEATURE_FLAGS } from '../config/featureFlags.js';

const router = Router();

function disabledGate(req, res, next) {
  if (FEATURE_FLAGS.learning_standards_enabled !== true) {
    return res.status(503).json({
      success: false,
      error: { code: 'FEATURE_DISABLED', message: 'Learning Standards is an inactive future module.' },
    });
  }
  return next();
}

// All routes pass through the gate first. With the flag false, they return 503.
router.use(disabledGate);

router.get('/status', (req, res) => res.json({ success: true, data: { phase: 'FUTURE-STANDARDS-0' } }));
router.get('/variance-report', (req, res) => res.status(501).json({ success: false, error: { code: 'NOT_IMPLEMENTED' } }));
router.get('/suggestions', (req, res) => res.status(501).json({ success: false, error: { code: 'NOT_IMPLEMENTED' } }));

export default router;
