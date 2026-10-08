import React, { useEffect, useRef } from 'react';
import { DecoOverlay } from '../lib/decoOverlay';
import { garmentFrame } from '../lib/garmentFrame';
import './shoppingFeedback.css';

export const selectionSummary = (product, size) => [product.school_design_label, product.variant_label, product.color, size].filter(Boolean).join(' · ');

export function MobilePurchaseBar({ price, action, disabled, onAction, summary, color }) {
  return <div className="sf-mobile-purchase" style={{ '--purchase-color': color }}>
    <div><strong>{price}</strong><span>{summary}</span></div>
    <button type="button" disabled={disabled} onClick={onAction}>{action}</button>
  </div>;
}

// Native modal provides focus containment, Escape handling and an inert background.
// Capture the added item, so later selection changes cannot change the receipt.
export function CartConfirmation({ item, onClose, onCheckout, color }) {
  const dialog = useRef(null);
  useEffect(() => {
    if (!item) return undefined;
    const previous = document.activeElement;
    const node = dialog.current;
    node.showModal();
    return () => { node.close(); previous?.focus?.(); };
  }, [item]);
  if (!item) return null;
  const frame = garmentFrame(item.product.image_front_url, item.product.decorations);
  return <dialog ref={dialog} className="sf-cart-confirmation" aria-labelledby="sf-cart-confirmation-title"
    style={{ '--purchase-color': color }} onCancel={onClose}>
    <button type="button" className="sf-confirm-close" aria-label="Close cart confirmation" onClick={onClose}>×</button>
    <h2 id="sf-cart-confirmation-title">✓ Added to your cart</h2>
    <div className="sf-confirm-item">
      <div className="sf-confirm-image">{frame.src && <img className="sf-confirm-garment" src={frame.src} alt={item.product.name} style={{ objectFit: frame.fit }} />}<DecoOverlay decorations={item.product.decorations} colorName={item.product.color} /></div>
      <div><strong>{item.product.name}</strong><p>{selectionSummary(item.product, item.size)}</p>
        {item.name && <p>Name: {item.name}</p>}{item.number && <p>Number: {item.number}</p>}
        {item.options?.map((option, index) => <p key={index}>{option}</p>)}
        <p>Quantity: {item.qty} · {item.price}</p>
      </div>
    </div>
    <div className="sf-confirm-actions"><button type="button" onClick={onCheckout}>Checkout</button><button type="button" onClick={onClose}>Keep shopping</button></div>
  </dialog>;
}
