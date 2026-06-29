/**
 * CERADRIVE ERP — Root API Router
 *
 * Mounts all module routers under /api/v1.
 * Health check is unauthenticated — used by monitoring and deployment checks.
 *
 * Add new module routers here as they are implemented.
 */

import { Router } from 'express';
import purchaseOrderRoutes from './purchaseOrders.js';
import grnRoutes           from './grns.js';
import purchaseBillRoutes  from './purchaseBills.js';
import supplierRoutes      from './suppliers.js';
import warehouseRoutes     from './warehouses.js';
import itemRoutes          from './items.js';
import uomRoutes           from './uoms.js';
import itemCategoryRoutes  from './itemCategories.js';
import itemTypeRoutes      from './itemTypes.js';
import processTypeRoutes   from './processTypes.js';
import customerRoutes      from './customers.js';
import machineRoutes       from './machines.js';
import bomRoutes           from './boms.js';
import routingRoutes      from './routings.js';
import routingTemplateRoutes from './routingTemplates.js';
import skuPlanningRoutes from './skuPlanning.js';
import workOrderRoutes    from './workOrders.js';
import productionLogRoutes from './productionLogs.js';
import salesOrderRoutes    from './salesOrders.js';
import salesInvoiceRoutes  from './salesInvoice.js';
import priceListRoutes     from './priceLists.js';
import vehicleRoutes       from './vehicles.js';
import taxRoutes from './taxes.js';
import employeeRoutes from './employees.js';
import shiftRoutes from './shifts.js';
import holidayRoutes from './holidays.js';
import stageRecipeRoutes from './stageRecipes.js';
import sfgBuilderRoutes from './sfgBuilder.js';
import productionRequirementRoutes from './productionRequirements.js';
import productionPlanOrderRoutes from './productionPlanOrders.js';
import mtoPlannerRoutes from './mtoPlanner.js';
import productionWorkRoutes from './productionWork.js';
import materialAvailabilityRoutes from './materialAvailability.js';
import demandProductionEngineRoutes from './demandProductionEngine.js';
import pressPlannerRoutes from './pressPlanner.js';
import dieRoutes from './dies.js';
import mouldingSlotRoutes from './mouldingSlots.js';
import purchaseRequirementsRoutes from './purchaseRequirements.js';
import numberSeriesRoutes from './numberSeries.js';
import dataImportRoutes from './dataImport.js';
import readinessRoutes from './readiness.js';
import internalProductionPlanRoutes from './internalProductionPlans.js';

const router = Router();

// ─── Health Check (unauthenticated) ──────────────────────────────────────────
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status:    'ok',
      service:   'ceradrive-erp-backend',
      timestamp: new Date().toISOString(),
      env:       process.env.NODE_ENV ?? 'unknown',
    },
  });
});

// ─── Settings Module ───────────────────────────────────────────────────────────
router.use('/number-series', numberSeriesRoutes);
router.use('/data-import', dataImportRoutes);

// ─── Purchase Module ──────────────────────────────────────────────────────────
router.use('/purchase-requirements', purchaseRequirementsRoutes);
router.use('/purchase-orders', purchaseOrderRoutes);

// ─── GRN Module ───────────────────────────────────────────────────────────────
router.use('/grns', grnRoutes);

// ─── Purchase Bill Module (PBILL-MOUNT) ───────────────────────────────────────
router.use('/purchase-bills', purchaseBillRoutes);

// ─── Customer Master Module ───────────────────────────────────────────────────
router.use('/customers', customerRoutes);

// ─── Machine Master Module ────────────────────────────────────────────────────
router.use('/machines', machineRoutes);

// ─── Supplier Master Module ─────────────────────────────────────
router.use('/suppliers', supplierRoutes);

// ─── Warehouse Master Module ───────────────────────────────────
router.use('/warehouses', warehouseRoutes);

// ─── Item Master Module ───────────────────────────────────
router.use('/items', itemRoutes);
router.use('/uoms', uomRoutes);
router.use('/item-categories', itemCategoryRoutes);
router.use('/item-types', itemTypeRoutes);
router.use('/process-types', processTypeRoutes);

// ─── BOM Master Module ────────────────────────────────────────────────────────
router.use('/boms', bomRoutes);

// —— Routing Master Module ————————————————————————————————————————————————
router.use('/routings', routingRoutes);
router.use('/routing-templates', routingTemplateRoutes);
router.use('/sku-planning', skuPlanningRoutes);
router.use('/work-orders', workOrderRoutes);
router.use('/production-logs', productionLogRoutes);
router.use('/sales-orders', salesOrderRoutes);
router.use('/sales-invoices', salesInvoiceRoutes);
router.use('/price-lists', priceListRoutes);
router.use('/vehicles', vehicleRoutes);

router.use('/taxes', taxRoutes);
router.use('/employees', employeeRoutes);
router.use('/shifts', shiftRoutes);
router.use('/holidays', holidayRoutes);
router.use('/stage-recipes', stageRecipeRoutes);
router.use('/sfg-builder', sfgBuilderRoutes);
router.use('/production-requirements', productionRequirementRoutes);
router.use('/production-plan-orders', productionPlanOrderRoutes);
router.use('/mto-planner', mtoPlannerRoutes);
router.use('/production-work', productionWorkRoutes);
router.use('/material-availability', materialAvailabilityRoutes);
router.use('/demand-production-engine', demandProductionEngineRoutes);
router.use('/press-planner', pressPlannerRoutes);
router.use('/dies', dieRoutes);
router.use('/moulding-slots', mouldingSlotRoutes);
router.use('/readiness', readinessRoutes);
router.use('/internal-production-plans', internalProductionPlanRoutes);

export default router;
