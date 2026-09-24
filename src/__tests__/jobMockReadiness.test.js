import { isJobReady, missingJobMocks, jobMockChecks, mockAwareProductionStatus } from '../lib/jobMockReadiness';

const fixture = () => {
  const job = { id: 'JOB-2102-01', art_status: 'art_complete', prod_status: 'ready', art_file_id: 'front', _art_ids: ['front','back'], items: [{ item_idx: 0, deco_idxs: [0,1,2] }] };
  const so = {
    items: [{ sku: 'JD7373-EXP-N', color: 'Navy', sizes: { YS: 1, YM: 1 }, pick_lines: [{ status: 'pulled', YS: 1, YM: 1 }], decorations: [{ kind:'art',art_file_id:'front' },{ kind:'art',art_file_id:'back' },{ kind:'numbers' }] }],
    art_files: ['front','back'].map(id => ({ id, name:id, deco_type:'dtf', status:'approved', prod_files_attached:true, prod_files:[{name:'proof.jpg',url:'https://example.com/proof.jpg'}], mockup_files:[], files:[], item_mockups:{} })),
    jobs: [job],
  };
  return {job,so};
};
const addMock = so => { so.art_files[0].item_mockups['JD7373-EXP-N|Navy'] = [{url:'https://example.com/mock.jpg'}]; };

test('SO-2102: approved DTF and production proofs do not make unmocked garment ready', () => {
  const {job,so}=fixture(); const before=JSON.stringify({job,so});
  expect(missingJobMocks(job,so)).toEqual(['JD7373-EXP-N']);
  expect(isJobReady(job,so)).toBe(false);
  expect(mockAwareProductionStatus(job,so)).toBe('hold');
  expect(jobMockChecks(job,so)).toEqual([{sku:'JD7373-EXP-N',color:'Navy',name:'',artFiles:[]}]);
  expect(JSON.stringify({job,so})).toBe(before); // approval/files are never rewritten
});
test('existing valid garment mock retains approval and readiness', () => {
  const {job,so}=fixture();addMock(so);
  expect(isJobReady(job,so)).toBe(true);
  expect(mockAwareProductionStatus(job,so)).toBe('ready');
  expect(jobMockChecks(job,so)).toEqual([]);
});
test('wrong garment mock offers reuse without granting readiness', () => {
  const {job,so}=fixture();so.art_files[0].item_mockups['OTHER|White']=[{url:'old.jpg'}];
  expect(isJobReady(job,so)).toBe(false);
  expect(jobMockChecks(job,so)).toHaveLength(1);
  expect(jobMockChecks(job,so)[0].artFiles[0].groups[0].files[0].url).toBe('old.jpg');
});
test('prior order suggestion does not count until actually applied', () => {
  const {job,so}=fixture();
  const checks=jobMockChecks(job,so,{'front||dtf':[{from:'SO-1',files:[{url:'old.jpg'}]}]});
  expect(checks).toHaveLength(1);
  expect(checks[0].artFiles[0].groups[0].from).toBe('SO-1');
  expect(isJobReady(job,so)).toBe(false);
});
test('explicit link to a populated source mock satisfies readiness', () => {
  const {job,so}=fixture();so.art_files[0].mock_links={'JD7373-EXP-N|Navy':'OTHER|Navy'};
  so.art_files[0].item_mockups['OTHER|Navy']=[{url:'mock.jpg'}];
  expect(isJobReady(job,so)).toBe(true);
});
test('empty linked source still produces a setup action', () => {
  const {job,so}=fixture();so.art_files[0].mock_links={'JD7373-EXP-N|Navy':'OTHER|Navy'};
  expect(isJobReady(job,so)).toBe(false);
  expect(jobMockChecks(job,so)).toHaveLength(1);
});
test('numbers-only split does not inherit sibling artwork mock requirements', () => {
  const {job,so}=fixture();job.items[0].deco_idxs=[2];job._art_ids=[];job.art_file_id=null;
  expect(isJobReady(job,so)).toBe(true);
  expect(jobMockChecks(job,so)).toEqual([]);
});
test.each(['in_process','completed','shipped'])('never rewrites actual %s production progress', status => {
  const {job,so}=fixture();job.prod_status=status;
  expect(mockAwareProductionStatus(job,so)).toBe(status);
});
test.each(['_artHydrated','_decosHydrated','_itemsHydrated'])('partial load %s cannot be ready', field => {
  const {job,so}=fixture();addMock(so);so[field]=false;
  expect(isJobReady(job,so)).toBe(false);
});
test('embroidery DST alone is not a garment mock', () => {
  const {job,so}=fixture();so.art_files.forEach(a=>{a.deco_type='embroidery';a.prod_files=[{name:'design.dst'}];});
  expect(isJobReady(job,so)).toBe(false);
});
