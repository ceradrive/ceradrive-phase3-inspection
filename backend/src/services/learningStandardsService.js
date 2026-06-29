/**
 * CERADRIVE ERP — Learning Standards from Actual Production (FUTURE-STANDARDS-0)
 *
 * INACTIVE PLACEHOLDER. No calculations, no DB, no master writes, no production-log reads.
 * Every export is guarded by FEATURE_FLAGS.learning_standards_enabled (default false)
 * and throws FEATURE_DISABLED until the real engine is built in a later phase.
 *
 * This module is NOT imported by any active route/service. Importing it has no side effects
 * (no supabase import). It exists only to preserve module direction + signatures.
 *
 * Future (locked) responsibilities — see backend/docs/FUTURE_learning_standards.md:
 *   1 tentative standards (wizard/master)  2 capture actual time/output/machine/stage
 *   3 compare estimated vs actual          4 variance report
 *   5 suggest standard update (after N)     6 manager/admin approval required
 *   7 logs never overwrite standards        8 approved update versioned + audited
 *   9 old WO snapshots unchanged           10 new standard = future planning only
 */
import { FEATURE_FLAGS } from '../config/featureFlags.js';

const DISABLED = {
  code: 'FEATURE_DISABLED',
  message: 'learning_standards_enabled is false — Learning Standards is an inactive future module.',
};

function guard() {
  if (FEATURE_FLAGS.learning_standards_enabled !== true) throw DISABLED;
}

// ── placeholder signatures (no implementation yet) ──────────────────────────

/** Future: read snapshot estimate vs posted production_logs actuals; compute per-stage variance%. */
export async function computeVarianceReport(/* { sku_code, stage, machine_id, from, to } */) {
  guard();
  throw DISABLED; // real implementation deferred (read-only report; no writes ever)
}

/** Future: accumulate per (sku, process, machine) once sample size met; emit update suggestions. */
export async function buildSuggestionQueue(/* { min_samples } */) {
  guard();
  throw DISABLED;
}

/** Future: create a DRAFT standard-update proposal (not applied) for manager review. */
export async function proposeStandardUpdate(/* { suggestion_id, scope } */) {
  guard();
  throw DISABLED;
}

/** Future: on manager/admin approval -> write a NEW versioned standard (effective-dated) + audit. */
export async function approveStandardUpdate(/* { proposal_id, approver_id } */) {
  guard();
  throw DISABLED;
}

export const LEARNING_STANDARDS_STATUS = Object.freeze({
  enabled: FEATURE_FLAGS.learning_standards_enabled,
  phase: 'FUTURE-STANDARDS-0 (inactive foundation)',
  writes_master: false,
  reads_production_logs: false,
});
