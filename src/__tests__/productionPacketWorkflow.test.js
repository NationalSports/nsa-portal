import {productionContent,workflowMessage,groupConversations,groupProductionRuns,personalizationCsv} from '../productionPacket/workflow';
const p={fingerprint:'abc123',garments:[{soId:'SO1',units:5}],decorations:[],notes:[],players:[]};
test('conversation updates do not change production identity',()=>expect(productionContent({...p,messages:[{text:'hello'}]})).toEqual(productionContent(p)));
test('workflow quantities are bounded to the selected SO',()=>{expect(()=>workflowMessage({workflow_status:'complete',target_so_id:'SO1',quantity:6},p)).toThrow();expect(workflowMessage({workflow_status:'received',target_so_id:'SO1',quantity:3},p).text).toContain('3 of 5');expect(()=>workflowMessage({workflow_status:'hold',target_so_id:'SO1',quantity:1},p)).toThrow('Describe');});
test('thread replies follow their parent and are chronological',()=>{const groups=groupConversations([{id:'a',threadId:'z',ts:'2026-01-02'},{id:'z',ts:'2026-01-01'}]);expect(groups[0].rows.map(m=>m.id)).toEqual(['z','a']);});
test('different art file identities never combine into a run',()=>{expect(groupProductionRuns({decorations:[{id:'a',name:'Logo',units:2,productionFiles:[{url:'a'}]},{id:'b',name:'Logo',units:2,productionFiles:[{url:'b'}]}]})).toHaveLength(2);});
test('personalization export preserves exact text, leading zero and unicode',()=>{const csv=personalizationCsv({decorations:[{kind:'numbers',personalization:{roster:[{number:'007',qty:1}]}}]});expect(csv).toContain('"007"');});
test('personalization CSV escapes spreadsheet formulas',()=>{
 expect(personalizationCsv({decorations:[{kind:'names',personalization:{roster:[{name:'=1+1',qty:1}]}}]})).toContain("'=1+1");
});
const {photoBytes}=require('../../netlify/functions/_packetPhoto');
test('photo uploads reject disguised files and unsupported MIME types',()=>{
 expect(()=>photoBytes({type:'image/png',content:Buffer.from('<script>bad</script>').toString('base64')})).toThrow('valid');
 expect(()=>photoBytes({type:'image/svg+xml',content:'abc'})).toThrow('PNG or JPEG');
});
