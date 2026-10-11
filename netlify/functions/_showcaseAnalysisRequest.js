// Retry temporary analysis-provider failures without regenerating the garment.
async function analysisRequest(url, init, { fetchImpl = fetch, sleep = ms => new Promise(resolve=>setTimeout(resolve,ms)), beforeAttempt = async()=>{} } = {}) {
  const delays = [3000,8000,20000];
  for (let attempt=0;attempt<=delays.length;attempt++) {
    await beforeAttempt(); // Cancellation must stop retries, not become a transport error.
    let response, payload, transportError;
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(),90000);
    try {
      response = await fetchImpl(url,{...init,signal:controller.signal});
      payload = await response.json().catch(()=>({}));
    } catch (error) { transportError=error; }
    finally { clearTimeout(timeout); }
    if (response?.ok && !transportError) return payload;
    const transient = !!transportError || [429,502,503,504].includes(response?.status);
    if (!transient) throw new Error(`Image analysis failed (${response.status}): ${payload?.error?.message || 'provider error'}`);
    if (attempt === delays.length) throw new Error('Image analysis is temporarily unavailable after automatic retries. Retry Create images or Refresh this image later; you do not need to change the pose. Approved images are unchanged.');
    const retryAfter = response?.headers?.get('retry-after');
    const seconds = retryAfter == null ? NaN : Number(retryAfter);
    const requested = Number.isFinite(seconds) ? seconds*1000 : Date.parse(retryAfter)-Date.now();
    // Do not retry sooner than requested. Very long cooldowns return control.
    if (Number.isFinite(requested) && requested>60000) throw new Error('Image analysis is busy and requested a longer cooldown. Retry later; approved images are unchanged.');
    const backoff = Math.round(delays[attempt]*(1+Math.random()*.25));
    await sleep(Math.max(backoff,Number.isFinite(requested)?requested:0));
  }
}
module.exports = { analysisRequest };
