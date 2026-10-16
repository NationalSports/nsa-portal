import { createdAfterThreadCutoff, requiresDstThreadOrder, requiredDstThreadMessage } from '../lib/dstThreadPolicy';
import { dstThreadOrderKey } from '../lib/dstThreadOrder';
import { threadLinesMissingMsg } from '../DstPreview';
import { jobThreadOrderMessage, mockAwareProductionStatus } from '../lib/jobMockReadiness';
const url = 'https://example.com/a.dst';
const art = {id:'a',name:'Embroidery',deco_type:'embroidery',uploaded:'10/15/2026',prod_files:[{url}],color_ways:[{id:'c',inks:['White','Red']}]};
const oldJob = {id:'j',art_file_id:'a',created_at:'10/16/2026',prod_status:'ready',items:[]};
const newJob = {...oldJob,created_at:'10/17/2026'};

test.each(['2026-10-16','10/16/2026','2026-10-17T06:59:59Z',null,'bad date'])('old or undated %s is grandfathered', d => expect(createdAfterThreadCutoff(d)).toBe(false));
test.each(['2026-10-17','10/17/2026','2026-10-17T07:00:00Z','2027-01-01'])('new %s requires confirmation', d => expect(createdAfterThreadCutoff(d)).toBe(true));
test('new job with reused old art and old job with new art both require confirmation', () => {
 expect(requiresDstThreadOrder(art,newJob)).toBe(true);
 expect(requiresDstThreadOrder({...art,uploaded:'10/17/2026'},oldJob)).toBe(true);
 expect(requiresDstThreadOrder({...art,updated_at:'10/20/2026'},oldJob)).toBe(false);
 expect(requiresDstThreadOrder({...art,deco_type:'screen_print'},newJob)).toBe(false);
});
test('new jobs cannot bypass by missing DST, empty color ways or unconfirmed threads', async () => {
 for (const a of [art,{...art,prod_files:[]},{...art,color_ways:[]}]) {
  expect(requiredDstThreadMessage([a],newJob)).toContain('Confirm DST thread order');
  expect(await threadLinesMissingMsg([a],newJob)).toContain('Confirm DST thread order');
 }
 expect(await threadLinesMissingMsg([art],oldJob)).toBe('');
});
test('verified thread order clears the gate, changes invalidate it', () => {
 const cw = art.color_ways[0];
 const verified = {...art,color_ways:[{...cw,dst_thread_order:dstThreadOrderKey(cw,url)}]};
 expect(requiredDstThreadMessage([verified],newJob)).toBe('');
 expect(requiredDstThreadMessage([{...verified,prod_files:[{url:'https://example.com/new.dst'}]}],newJob)).not.toBe('');
});
test('production board checks job-owned art and holds stale ready jobs', () => {
 const so = {art_files:[art],items:[]};
 expect(jobThreadOrderMessage(newJob,so)).toContain('Confirm DST thread order');
 expect(mockAwareProductionStatus(newJob,so)).toBe('hold');
 expect(jobThreadOrderMessage(oldJob,so)).toBe('');
 expect(jobThreadOrderMessage({...newJob,art_file_id:'other'},so)).toBe('');
});
