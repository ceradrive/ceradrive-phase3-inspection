/**
 * CERADRIVE ERP — feature flags (FUTURE-STANDARDS-0)
 * Inactive foundation. Flags here gate not-yet-active modules.
 * Flipping a flag to true does NOT implement the feature — it only un-guards
 * placeholder services that currently throw. Real logic lands in later phases.
 */
export const FEATURE_FLAGS = Object.freeze({
  // Learning Standards from Actual Production — DESIGN/PLACEHOLDER ONLY.
  // Must stay false until the learning engine, variance report, suggestion queue,
  // approval flow, and versioned-standard writer are built and reviewed.
  learning_standards_enabled: false,

  // SFG Builder commit (Generate). 2A-2-alpha = ITEMS-only write slice.
  // Stays false in committed code. Enable ONLY via env for command/test runs:
  //   SFG_COMMIT_ENABLED=true node ...   (never commit this flag as true)
  sfg_commit_enabled: false,

  // SFG Builder DRAFT RECIPE commit. 2A-2-gamma = draft-recipe-only write slice.
  // Stays false in committed code. Enable ONLY via env for command/test runs:
  //   SFG_RECIPE_COMMIT_ENABLED=true node ...   (never commit this flag as true)
  sfg_recipe_commit_enabled: false,

  // SFG Builder recipe ACTIVATE. 2A-2-delta = activate-draft-recipe-only (NO BOM in this slice).
  // Stays false in committed code. Enable ONLY via env for command/test runs:
  //   SFG_RECIPE_ACTIVATE_ENABLED=true node ...   (never commit this flag as true)
  sfg_recipe_activate_enabled: false,

  // SFG Builder BOM auto-generation. 2A-2-epsilon = BOM-only from the ACTIVE recipe.
  // Stays false in committed code. Enable ONLY via env for command/test runs:
  //   SFG_BOM_COMMIT_ENABLED=true node ...   (never commit this flag as true)
  sfg_bom_commit_enabled: false,

  // SFG Builder ROUTING creation. 2A-2-zeta = routing-only from the active recipe + BOM.
  // Stays false in committed code. Enable ONLY via env for command/test runs:
  //   SFG_ROUTING_COMMIT_ENABLED=true node ...   (never commit this flag as true)
  sfg_routing_commit_enabled: false,

  // SFG Builder FG-SFG LINKS creation. 2A-2-eta = links-only (final structural slice).
  // Stays false in committed code. Enable ONLY via env for command/test runs:
  //   SFG_LINKS_COMMIT_ENABLED=true node ...   (never commit this flag as true)
  sfg_links_commit_enabled: false,

  // SFG Builder FULL GENERATE (orchestrated items->draft->activate->BOM->routing->links).
  // Master flag: when true it also enables every sub-slice for the orchestrated run.
  // Stays false in committed code. Enable ONLY via env for command/test runs:
  //   SFG_FULL_GENERATE_ENABLED=true node ...   (never commit this flag as true)
  sfg_full_generate_enabled: false,
});

export function isEnabled(flag) {
  return FEATURE_FLAGS[flag] === true;
}
