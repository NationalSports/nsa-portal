// A rep's legacy color list is not necessarily a needle-stop sequence. Never
// infer confirmation from dates, counts, or an automatically saved stitch logo.
export const dstThreadOrderKey = (cw, url) => JSON.stringify([url, cw?.inks || []]);
export const hasConfirmedDstThreadOrder = (cw, url) => !!url
  && cw?.dst_thread_order === dstThreadOrderKey(cw, url);
