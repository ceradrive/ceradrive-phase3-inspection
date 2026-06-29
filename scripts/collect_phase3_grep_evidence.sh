#!/usr/bin/env bash
set -euo pipefail

# Read-only helper script. Run from repo root.
# It creates grep output files under phase3_grep_output/.

OUT_DIR="phase3_grep_output"
mkdir -p "$OUT_DIR"

TERMS=(
  "recipe_rule"
  "Recipe Rule"
  "resolve_recipe"
  "output_fingerprint"
  "fingerprint"
  "specificity"
  "priority"
  "source_warehouse"
  "s_warehouse"
  "helper"
  "warehouse_helper_policy"
  "material_availability"
  "shortfall"
  "READY"
  "SHORT"
  "actual_qty"
  "projected_qty"
  "reserved_qty"
  "ordered_qty"
  "planned_qty"
  "get_stock_balance"
  "get_latest_stock_qty"
  "Stock Ledger Entry"
  "is_scrap"
  "by_product"
  "process_loss"
  "secondary_output"
  "is_stock_item"
)

for term in "${TERMS[@]}"; do
  safe_name=$(echo "$term" | tr ' /' '__' | tr -cd '[:alnum:]_.-')
  grep -RIn --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=__pycache__ "$term" . > "$OUT_DIR/${safe_name}.txt" || true
done

# File inventory
find . \
  -path './.git' -prune -o \
  -path './node_modules' -prune -o \
  -path './__pycache__' -prune -o \
  -type f -print | sort > "$OUT_DIR/file_inventory.txt"

# Possible sensitive files inventory for review
find . -type f \( \
  -name "*.sql" -o \
  -name "*.sql.gz" -o \
  -name "*.dump" -o \
  -name "*.backup" -o \
  -name "*.bak" -o \
  -name "*.pem" -o \
  -name "*.key" -o \
  -name ".env" -o \
  -name "site_config.json" -o \
  -name "common_site_config.json" \
\) -print > "$OUT_DIR/review_sensitive_file_names.txt" || true

# Possible sensitive strings for review
# Review manually before publishing output.
grep -RInE "password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|site_config|common_site_config|db_password|admin_password" . \
  --exclude-dir=.git \
  --exclude-dir=node_modules \
  --exclude-dir=__pycache__ \
  --exclude-dir="$OUT_DIR" \
  > "$OUT_DIR/review_possible_sensitive_strings.txt" || true

echo "Done. Review $OUT_DIR before sharing."
