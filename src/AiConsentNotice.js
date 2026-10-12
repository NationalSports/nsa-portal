import React from 'react';
export default function AiConsentNotice({ allowed, onAllow, onRevoke, onDecline, staff = false }) {
  return <div style={{padding:12,background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:8,fontSize:12,lineHeight:1.5,margin:10}}>
    {allowed ? <><span>AI replies use Anthropic.</span> <button type="button" onClick={onRevoke}>Turn off AI</button></> : <>
      <strong>Allow AI assistance?</strong>
      <p>Your messages and recent conversation {staff ? 'plus the current screen and open record name ' : 'plus order information needed for your question '}will be sent to Anthropic to generate replies. Messages may include personal information you enter. Avoid passwords and payment details. AI replies can be wrong.</p>
      <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy information</a>
      <div style={{display:'flex',gap:8,marginTop:10}}><button type="button" onClick={onAllow}>Allow AI assistance</button>{onDecline&&<button type="button" onClick={onDecline}>Continue without AI</button>}</div>
    </>}
  </div>;
}
