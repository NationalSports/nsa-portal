import { createArtService, filterArtRequests, validateArtRequest } from '../lib/standaloneArtRequests';

test('artist sees own and unassigned work, including assignments to retired artists',()=>{
  const rows=[{id:'mine',assigned_artist:'a'},{id:'other',assigned_artist:'b'},{id:'pool'},{id:'retired',assigned_artist:'old'}];
  const scope={cu:{id:'a',role:'artist'},reps:[{id:'a',role:'artist'},{id:'b',role:'art'},{id:'old',role:'artist',is_active:false}]};
  expect(filterArtRequests(rows,scope).map(r=>r.id)).toEqual(['mine','pool','retired']);
});
test('estimate request is the same searchable row after conversion and rep filtering',()=>{
  const row={id:'r',estimate_id:'EST-1',customer_id:'c',requested_by:'rep',request_type:'web_logo',art_name:'Logo'};
  const scope={cu:{role:'rep'},filter:'rep',search:'SO-2',customers:[{id:'c',name:'School'}],orders:[{id:'SO-2',estimate_id:'EST-1'}]};
  expect(filterArtRequests([row],scope)).toEqual([expect.objectContaining({id:'r',linked_so_id:'SO-2',customer_name:'School'})]);
  expect(filterArtRequests([row],{...scope,filter:'someone-else'})).toEqual([]);
});
test('validates an exact color way and an existing folder for web work',()=>{
  const base={customer_id:'c',request_type:'web_logo',art_name:'Logo',instructions:'PNG',art_id:'a',source_art:{color_ways:[{id:'navy'}]}};
  expect(()=>validateArtRequest(base)).toThrow(/color way/);
  expect(()=>validateArtRequest({...base,color_way_id:'navy'})).not.toThrow();
  expect(()=>validateArtRequest({...base,art_id:null})).toThrow(/existing art folder/);
});
test('service reports backend failure without emitting a saved event',async()=>{
  const dispatch=jest.spyOn(window,'dispatchEvent');
  const service=createArtService({rpc:jest.fn().mockResolvedValue({data:null,error:{message:'expired session'}})});
  await expect(service.transition('r','completed',[{url:'https://files.test/logo.png'}])).rejects.toThrow('expired session');
  expect(dispatch).not.toHaveBeenCalled();dispatch.mockRestore();
});
test('queue pagination loads work beyond the first PostgREST page',async()=>{
  const page=Array.from({length:500},(_,i)=>({id:String(i)}));
  const query={select:jest.fn().mockReturnThis(),order:jest.fn().mockReturnThis(),range:jest.fn().mockResolvedValueOnce({data:page}).mockResolvedValueOnce({data:[{id:'old'}]})};
  const service=createArtService({from:()=>query});
  const rows=await service.list();
  expect(rows).toHaveLength(501);expect(rows[500].id).toBe('old');
  expect(query.range.mock.calls).toEqual([[0,499],[500,999]]);
});
test('unassigned picker includes null assignments and admin artist scope uses its namespace',()=>{
  const rows=[{id:'pool',assigned_artist:null},{id:'assigned',assigned_artist:'artist',requested_by:'rep'}];
  expect(filterArtRequests(rows,{cu:{role:'production'},filter:''}).map(r=>r.id)).toEqual(['pool']);
  expect(filterArtRequests(rows,{cu:{role:'admin'},filter:'artist:artist'}).map(r=>r.id)).toEqual(['assigned']);
});
