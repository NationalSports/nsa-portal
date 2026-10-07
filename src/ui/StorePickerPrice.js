import React from 'react';
export const suggestedStorePrice = (cost, decoCost = 0) => {
  const c = Number(cost) || 0;
  return c > 0 ? Math.ceil((c + decoCost) / 0.55) : null;
};
export default function StorePickerPrice({ product, storeItem, decorationCost = 0, template = false }) {
  const cost = Number(product.nsa_cost);
  const suggested = suggestedStorePrice(cost, decorationCost);
  const saved = storeItem?.retail_price;
  return <div style={{ position: 'absolute', top: 10, right: 10, background: '#191919', color: '#fff', borderRadius: 6, padding: '5px 8px', fontSize: 12, textAlign: 'right' }}>
    <div style={{ fontWeight: 700 }}>{cost > 0 ? `Garment cost $${cost.toFixed(2)}` : 'Cost unavailable'}</div>
    {saved != null ? <div>Store price ${Number(saved).toFixed(2)}</div> : template ? <div>Catalog retail ${Number(product.retail_price || 0).toFixed(2)}</div> : suggested != null ? <div>Suggested price ${suggested.toFixed(2)}</div> : null}
  </div>;
}
