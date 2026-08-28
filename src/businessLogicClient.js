// Browser-facing ES module bridge for the dependency-free CommonJS business-logic
// module. Node/Jest callers continue to use businessLogic.js directly, while webpack
// gets explicit named exports instead of relying on CommonJS export inference.
const BL = require('./businessLogic');

export const {
  safe, safeArr, safeObj, safeNum, safeStr, safeSizes, safePicks, safePOs, safeDecos, safeItems, safeArt, safeJobs,
  commissionRepId, isCommissionRep,
  rQ, rT, spP, spFlatShare, spRunBlend, decoSplitRuns, emP, npP, twaP, twnP, dP, DTF, SP, EM, NP, TWA, TWN,
  poCommitted, calcSOStatus, buildJobs, outsourcedDecoTypes, decoIsOutsourced, decoConcreteType, isDecoOutsourced,
  pickCwAsset, normalizeWebLogos, garmentNeedsUnderbase, artReviewLocked, mockupReviewDate, isJobReady,
  allocateJobFulfillment, isOpenSplitSlice, recalcJobFulfillment, deriveJobItemStatus, jobsNowReadyForDeco,
  jobReceivedAt, jobLiveArtIds, jobScreenKey, jobGroupKey, calcTotals, createInvoice,
  isBookingOrder, bookingDaysUntilShip, isBookingActive,
  PROMO_DECO_MULT, PROMO_SHIP_MULT, PROMO_SANMAR_SS_COST_PCT, isSanmarSsPromoItem, calcPromoItemSell,
  calcPromoSizeSells, applyFullPromoPricing, calcPromoTotals, calcPromoSpendAllocation, calcQualifyingSpend,
  getCurrentPromoPeriod, getPreviousPromoPeriod,
  buildQBSalesOrder, buildQBInvoice, checkInventoryConflicts,
  itemEditReconciles, itemsWithWipedQty, unaccountedDroppedItems,
} = BL;

export default BL;
