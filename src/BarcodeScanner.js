/* Shared camera barcode / QR scanner — used by the desktop warehouse (App.js), the
   mobile portal (MobilePortal.js), and available to any other surface. Native
   BarcodeDetector where the browser has it, the 'barcode-detector' polyfill where it
   doesn't (iOS Safari), tesseract.js OCR fallback for unreadable labels. Heavy libs are
   dynamic-import()ed at point of use, matching App.js's heavy-lib pattern. */
import React, { useState, useRef } from 'react';

// ─── PO NUMBER EXTRACTION FROM OCR TEXT ───
const extractPOFromText=(text)=>{
  if(!text)return null;
  // Patterns to match PO numbers on shipping labels:
  // "PO-NO : 0902323374", "PO-NO: 0902323374"
  // "TEAM/CUSTOMER PO : PO7540 EXP", "Cust PO#: PO7770 CSM SP"
  // "PO: 7775GBHSTEN-JB", "PO#: 12345", "PO 12345"
  // "SalesOrder#:SO-158374470", "RO12173689"
  const lines=text.split('\n');
  for(const line of lines){
    const l=line.trim();
    // Match "PO-NO" or "PO NO" followed by separator and value
    let m=l.match(/PO[\s-]*NO\s*[:#=]\s*(\S+)/i);
    if(m)return m[1].replace(/[.,]+$/,'');
    // Match "Cust PO#" or "CUSTOMER PO" or "TEAM/CUSTOMER PO" followed by value
    m=l.match(/(?:CUST(?:OMER)?|TEAM\/CUSTOMER)\s*PO\s*#?\s*[:#=]\s*(.+)/i);
    if(m)return m[1].trim().replace(/[.,]+$/,'');
    // Match "PO#:" or "PO:" followed by value
    m=l.match(/\bPO\s*#?\s*[:#=]\s*(.+)/i);
    if(m){const v=m[1].trim();if(v.length>=4)return v.replace(/[.,]+$/,'')}
    // Match "SalesOrder#:" pattern
    m=l.match(/Sales\s*Order\s*#?\s*[:#=]\s*(\S+)/i);
    if(m)return m[1].replace(/[.,]+$/,'');
  }
  return null;
};

// ─── BARCODE / QR CAMERA SCANNER ───
const BarcodeScanner=({onScan,onClose,placeholder='Scan barcode or QR code...'})=>{
  const videoRef=useRef(null);const streamRef=useRef(null);const scanningRef=useRef(false);
  const[active,setActive]=useState(false);const[error,setError]=useState(null);const[manualVal,setManualVal]=useState('');
  const detectorRef=useRef(null);
  const[scanMode,setScanMode]=useState('barcode');// 'barcode' | 'text'
  const[ocrStatus,setOcrStatus]=useState('');// OCR progress status
  const[ocrResults,setOcrResults]=useState([]);// extracted PO numbers from OCR
  const ocrBusyRef=useRef(false);
  const canvasRef=useRef(null);
  const[torchOn,setTorchOn]=useState(false);const[torchOk,setTorchOk]=useState(false);// phone flashlight (warehouse aisles are dim)

  const startCamera=async()=>{
    setError(null);setOcrResults([]);setOcrStatus('');
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment',width:{ideal:1280},height:{ideal:720}}});
      streamRef.current=stream;
      // Torch is only exposed on a live track on some phones — probe once we have the stream.
      try{const _trk=stream.getVideoTracks&&stream.getVideoTracks()[0];const _caps=_trk&&_trk.getCapabilities&&_trk.getCapabilities();setTorchOk(!!(_caps&&_caps.torch))}catch(e){setTorchOk(false)}
      const v=videoRef.current;
      if(v){
        v.srcObject=stream;
        await new Promise((resolve)=>{
          if(v.readyState>=v.HAVE_METADATA){resolve();return}
          v.onloadedmetadata=()=>resolve();
        });
        await v.play();
      }
      setActive(true);
      if(scanMode==='barcode'){
        // iOS Safari has no native BarcodeDetector — pull in the polyfill only when needed.
        let DetectorImpl='BarcodeDetector' in window?window.BarcodeDetector:null;
        if(!DetectorImpl){const mod=await import('barcode-detector');DetectorImpl=mod.BarcodeDetector}
        detectorRef.current=new DetectorImpl({formats:['qr_code','code_128','code_39','ean_13','ean_8','upc_a','upc_e','codabar','itf']});
      }
      scanningRef.current=true;
      if(scanMode==='barcode')scanLoop();
    }catch(err){
      if(err.name==='NotAllowedError')setError('Camera permission denied. Please allow camera access and try again.');
      else if(err.name==='NotFoundError')setError('No camera found. Use manual entry below.');
      else setError('Camera error: '+err.message);
    }
  };

  const scanLoop=async()=>{
    if(!scanningRef.current||!videoRef.current||!detectorRef.current)return;
    try{
      const barcodes=await detectorRef.current.detect(videoRef.current);
      if(barcodes.length>0){
        const val=barcodes[0].rawValue;
        if(val){try{navigator.vibrate&&navigator.vibrate(120)}catch(e){}stopCamera();onScan(val);return}
      }
    }catch(err){if(err?.name!=='InvalidStateError')console.warn('[BarcodeScanner] detect error:',err?.message||err)}
    requestAnimationFrame(()=>setTimeout(scanLoop,150));
  };

  // Capture a frame from video for OCR
  const captureFrame=()=>{
    const v=videoRef.current;
    if(!v||!v.videoWidth)return null;
    let canvas=canvasRef.current;
    if(!canvas){canvas=document.createElement('canvas');canvasRef.current=canvas}
    canvas.width=v.videoWidth;canvas.height=v.videoHeight;
    const ctx=canvas.getContext('2d');
    ctx.drawImage(v,0,0);
    return canvas;
  };

  // Run OCR on current camera frame
  const runOCR=async()=>{
    if(ocrBusyRef.current)return;
    ocrBusyRef.current=true;
    setOcrStatus('Reading text...');setOcrResults([]);
    try{
      const canvas=captureFrame();
      if(!canvas){setOcrStatus('No camera frame available');ocrBusyRef.current=false;return}
      const{createWorker}=await import('tesseract.js');
      const worker=await createWorker('eng');
      const{data:{text}}=await worker.recognize(canvas);
      await worker.terminate();
      if(!text||!text.trim()){setOcrStatus('No text detected — try adjusting angle');ocrBusyRef.current=false;return}
      // Extract PO numbers from OCR text
      const po=extractPOFromText(text);
      if(po){
        setOcrResults([po]);setOcrStatus('Found PO: '+po);
      }else{
        // Show raw text so user can pick out the PO
        const lines=text.split('\n').map(l=>l.trim()).filter(l=>l.length>2);
        setOcrResults(lines.slice(0,10));
        setOcrStatus('No PO pattern found — select a line or try again');
      }
    }catch(err){
      console.warn('[OCR] error:',err?.message||err);
      setOcrStatus('OCR error: '+(err?.message||'Unknown error'));
    }
    ocrBusyRef.current=false;
  };

  // Toggle the phone flashlight on the live video track (no-op where unsupported).
  const toggleTorch=async()=>{
    try{const track=streamRef.current&&streamRef.current.getVideoTracks&&streamRef.current.getVideoTracks()[0];if(!track)return;const next=!torchOn;await track.applyConstraints({advanced:[{torch:next}]});setTorchOn(next)}catch(e){setTorchOk(false)}
  };

  const stopCamera=()=>{
    scanningRef.current=false;
    if(streamRef.current){streamRef.current.getTracks().forEach(t=>t.stop());streamRef.current=null}
    if(videoRef.current){videoRef.current.srcObject=null}
    setActive(false);setOcrStatus('');setOcrResults([]);setTorchOn(false);setTorchOk(false);
  };

  // Cleanup on unmount
  React.useEffect(()=>()=>{scanningRef.current=false;if(streamRef.current){streamRef.current.getTracks().forEach(t=>t.stop())};},[]);

  // Restart camera when mode changes while active
  const prevMode=useRef(scanMode);
  React.useEffect(()=>{
    if(prevMode.current!==scanMode&&active){stopCamera();setTimeout(()=>startCamera(),200)}
    prevMode.current=scanMode;
  },[scanMode]);// eslint-disable-line

  const handleManual=(e)=>{
    if(e.key==='Enter'&&manualVal.trim()){onScan(manualVal.trim());setManualVal('')}
  };

  return<div style={{background:'#0f172a',borderRadius:12,overflow:'hidden',border:'2px solid #334155'}}>
    {/* Mode toggle */}
    <div style={{display:'flex',borderBottom:'1px solid #1e293b'}}>
      <button onClick={()=>setScanMode('barcode')} style={{flex:1,padding:'8px 0',fontSize:12,fontWeight:700,cursor:'pointer',border:'none',
        background:scanMode==='barcode'?'#1e293b':'transparent',color:scanMode==='barcode'?'#22c55e':'#64748b',borderBottom:scanMode==='barcode'?'2px solid #22c55e':'2px solid transparent'}}>
        Barcode Scan
      </button>
      <button onClick={()=>setScanMode('text')} style={{flex:1,padding:'8px 0',fontSize:12,fontWeight:700,cursor:'pointer',border:'none',
        background:scanMode==='text'?'#1e293b':'transparent',color:scanMode==='text'?'#f59e0b':'#64748b',borderBottom:scanMode==='text'?'2px solid #f59e0b':'2px solid transparent'}}>
        PO Text Scan
      </button>
    </div>
    {/* Single video element always in DOM so ref/stream survive re-renders */}
    <div style={{position:'relative',background:'#000',display:active?'block':'none'}}>
      <video ref={videoRef} style={{width:'100%',maxHeight:'58vh',minHeight:240,objectFit:'cover',display:'block',background:'#000'}} autoPlay playsInline muted/>
      {/* Scan overlay */}
      <div style={{position:'absolute',top:0,left:0,right:0,bottom:0,display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none'}}>
        <div style={{width:scanMode==='text'?280:200,height:scanMode==='text'?160:200,
          border:scanMode==='text'?'2px solid rgba(245,158,11,0.7)':'2px solid rgba(34,197,94,0.7)',borderRadius:12,boxShadow:'0 0 0 9999px rgba(0,0,0,0.3)'}}/>
      </div>
      <div style={{position:'absolute',bottom:scanMode==='text'?40:8,left:0,right:0,textAlign:'center',
        color:scanMode==='text'?'#f59e0b':'#22c55e',fontSize:11,fontWeight:600,textShadow:'0 1px 3px rgba(0,0,0,0.8)'}}>
        {scanMode==='text'?'Point camera at PO label, then tap Capture':'Point camera at barcode or QR code'}
      </div>
      {scanMode==='text'&&<button onClick={runOCR} disabled={ocrBusyRef.current}
        style={{position:'absolute',bottom:8,left:'50%',transform:'translateX(-50%)',background:ocrBusyRef.current?'#475569':'#f59e0b',
          color:ocrBusyRef.current?'#94a3b8':'#000',border:'none',borderRadius:8,padding:'6px 24px',cursor:ocrBusyRef.current?'default':'pointer',fontSize:13,fontWeight:700}}>
        {ocrBusyRef.current?'Reading...':'Capture & Read'}
      </button>}
      {torchOk&&<button onClick={toggleTorch} title="Toggle flashlight" style={{position:'absolute',top:8,left:8,background:torchOn?'#fde68a':'rgba(0,0,0,0.6)',border:'none',color:torchOn?'#000':'white',borderRadius:8,padding:'4px 10px',cursor:'pointer',fontSize:12,fontWeight:700}}>🔦 {torchOn?'On':'Off'}</button>}
      <button onClick={stopCamera} style={{position:'absolute',top:8,right:8,background:'rgba(0,0,0,0.6)',border:'none',color:'white',borderRadius:8,padding:'4px 10px',cursor:'pointer',fontSize:12}}>Close Camera</button>
    </div>
    {/* OCR results */}
    {scanMode==='text'&&active&&(ocrStatus||ocrResults.length>0)&&<div style={{padding:'8px 12px',borderBottom:'1px solid #1e293b'}}>
      {ocrStatus&&<div style={{fontSize:11,color:ocrResults.length===1?'#22c55e':'#f59e0b',marginBottom:ocrResults.length>1?6:0,fontWeight:600}}>{ocrStatus}</div>}
      {ocrResults.length===1&&<button onClick={()=>{const v=ocrResults[0];stopCamera();onScan(v)}}
        style={{marginTop:4,width:'100%',background:'#22c55e',color:'#000',border:'none',borderRadius:6,padding:'8px',fontSize:13,fontWeight:700,cursor:'pointer'}}>
        Use: {ocrResults[0]}
      </button>}
      {ocrResults.length>1&&<div style={{maxHeight:120,overflowY:'auto'}}>
        {ocrResults.map((line,i)=><button key={i} onClick={()=>{stopCamera();onScan(line)}}
          style={{display:'block',width:'100%',textAlign:'left',background:'#1e293b',color:'#e2e8f0',border:'1px solid #334155',borderRadius:4,padding:'4px 8px',marginBottom:2,fontSize:11,fontFamily:'monospace',cursor:'pointer',':hover':{background:'#334155'}}}>
          {line}
        </button>)}
      </div>}
    </div>}
    {!active&&<div style={{padding:'20px',textAlign:'center'}}>
      {error?<div style={{color:'#f87171',fontSize:12,marginBottom:10}}>{error}</div>:
      <div style={{color:'#94a3b8',fontSize:12,marginBottom:10}}>
        {scanMode==='text'?'Open the camera to scan PO text from shipping labels':'Open the camera to scan barcodes/QR codes, or type manually below'}
      </div>}
      <button onClick={startCamera} style={{background:scanMode==='text'?'#f59e0b':'#22c55e',color:scanMode==='text'?'#000':'white',border:'none',borderRadius:8,padding:'10px 24px',fontSize:14,fontWeight:700,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:8}}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
        Open Camera
      </button>
    </div>}
    {/* Manual entry always available */}
    <div style={{padding:'10px 16px',borderTop:'1px solid #1e293b',display:'flex',gap:8}}>
      <input value={manualVal} onChange={e=>setManualVal(e.target.value)} onKeyDown={handleManual}
        placeholder={placeholder} style={{flex:1,background:'#1e293b',border:'1px solid #334155',borderRadius:6,padding:'8px 12px',color:'white',fontSize:13,fontWeight:600,fontFamily:'monospace'}}/>
      <button onClick={()=>{if(manualVal.trim()){onScan(manualVal.trim());setManualVal('')}}}
        style={{background:'#2563eb',color:'white',border:'none',borderRadius:6,padding:'8px 16px',fontSize:12,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>Look Up</button>
      {onClose&&<button onClick={onClose} style={{background:'#334155',color:'#94a3b8',border:'none',borderRadius:6,padding:'8px 12px',cursor:'pointer',fontSize:12}}>Cancel</button>}
    </div>
  </div>;
};

export default BarcodeScanner;
