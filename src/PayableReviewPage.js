import React from 'react';
import QBPayableServerReviewCard from './QBPayableServerReviewCard';
import QBPayableCanaryCard from './QBPayableCanaryCard';

// MainApp retains its existing LoginGate. Each card request also passes the
// existing server-side QBO staff/realm authorization; this adds no API surface.
export default function PayableReviewPage(){
  return <main style={{maxWidth:1100,margin:'32px auto',padding:'0 24px',fontFamily:'system-ui,sans-serif',color:'#172033',lineHeight:1.5}}>
    <a href="/?pg=qb">Back to QuickBooks Sync</a>
    <h1>Payable review</h1>
    <p>Review purchase orders, bills, credits, and payment exceptions. The single-bill canary requires a separate preparation step and confirmation.</p>
    <QBPayableServerReviewCard />
    <QBPayableCanaryCard />
  </main>;
}
