jest.mock('../../netlify/functions/_shared',()=>({verifyUser:jest.fn(),corsHeaders:()=>({})}));
const {verifyUser}=require('../../netlify/functions/_shared');
const {handler}=require('../../netlify/functions/meeting-ask');
function adminFor() {
  const tables={customers:[{id:'school',parent_id:null}],meetings:[
    {id:'own',team_member_id:'rep',status:'approved',customer_id:'school',title:'Own note',final:{summary:'Budget 100'},created_at:'2026-10-08'},
    {id:'other',team_member_id:'other-rep',status:'approved',customer_id:'school',title:'Shared note',final:{summary:'Approved shared summary'},created_at:'2026-10-07'},
    {id:'draft',team_member_id:'other-rep',status:'ready',customer_id:'school',draft:{summary:'SECRET DRAFT'}},
  ],meeting_transcripts:[{meeting_id:'own',source_text:'My transcript budget 100'},{meeting_id:'other',source_text:'SECRET OTHER TRANSCRIPT'}]};
  const reads=[];
  const from=table=>{const filters=[];reads.push(table);const rows=()=>tables[table].filter(r=>filters.every(f=>f(r)));const q={select:()=>q,eq:(c,v)=>{filters.push(r=>r[c]===v);return q},in:(c,v)=>{filters.push(r=>v.includes(r[c]));return q},order:()=>q,limit:()=>q,maybeSingle:async()=>({data:rows()[0]}),then:(r,j)=>Promise.resolve({data:rows()}).then(r,j)};return q};
  return {from,reads};
}
const event={httpMethod:'POST',body:JSON.stringify({customer_id:'school',question:'What budget was discussed?'})};
let original;
beforeEach(()=>{original=global.fetch;global.fetch=jest.fn(async()=>({ok:true,json:async()=>({content:[{type:'text',text:JSON.stringify({answer:'Budget 100',citations:[{id:'E1',quote:'budget 100'}]})}]})}))});
afterEach(()=>{global.fetch=original});
test('staff Q&A excludes another rep’s raw transcript and unapproved draft',async()=>{
  verifyUser.mockResolvedValue({ok:true,role:'rep',teamMemberId:'rep',admin:adminFor()});
  const r=await handler(event);expect(r.statusCode).toBe(200);
  const payload=JSON.parse(global.fetch.mock.calls[0][1].body).messages[0].content;
  expect(payload).toContain('My transcript budget 100');expect(payload).toContain('Approved shared summary');expect(payload).not.toContain('SECRET');
});
test('admin Q&A may use other reps’ transcripts but still excludes drafts',async()=>{
  verifyUser.mockResolvedValue({ok:true,role:'admin',teamMemberId:'admin',admin:adminFor()});await handler(event);
  const payload=JSON.parse(global.fetch.mock.calls[0][1].body).messages[0].content;
  expect(payload).toContain('SECRET OTHER TRANSCRIPT');expect(payload).not.toContain('SECRET DRAFT');
});
test('unauthenticated requests do not call the model or database',async()=>{
  verifyUser.mockResolvedValue({ok:false,status:401,error:'Invalid token'});expect((await handler(event)).statusCode).toBe(401);expect(global.fetch).not.toHaveBeenCalled();
});
