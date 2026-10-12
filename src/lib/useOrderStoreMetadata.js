import { useEffect, useState } from 'react';

// Fetch the small store identity records used to separate historical SO-numbered
// 24/7 orders. A failed lookup must not silently mix them into the main list.
export default function useOrderStoreMetadata(orders, supabase, active) {
  const key = JSON.stringify([...new Set(orders.map(o => o.webstore_id).filter(Boolean))].sort());
  const [result, setResult] = useState({ key:null, stores:[], error:null });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const ids = JSON.parse(key);
    (async () => {
      try {
        if (ids.length && !supabase) throw new Error('Store connection unavailable');
        const stores = [];
        for (let i=0;i<ids.length;i+=100) {
          const {data,error} = await supabase.from('webstores').select('id,name,org_type,source').in('id',ids.slice(i,i+100));
          if (error) throw error;
          stores.push(...(data || []));
        }
        if (!cancelled) setResult({key,stores,error:null});
      } catch (error) {
        if (!cancelled) setResult({key,stores:[],error:error.message || 'Store lookup failed'});
      }
    })();
    return () => { cancelled=true; };
  }, [active,key,supabase,retry]);
  return { ...result, loading:result.key!==key, retry:()=>{setResult(r=>({...r,key:null}));setRetry(n=>n+1);} };
}
