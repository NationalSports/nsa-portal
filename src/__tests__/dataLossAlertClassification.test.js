import { classifySaveAlert } from '../lib/saveAlertClassification';
import fs from 'fs';
import path from 'path';

describe('data-loss alert classification', () => {
  const appSource=fs.readFileSync(path.join(__dirname,'..','App.js'),'utf8');

  test('verified and pre-verification item shrink observations are audit-only', () => {
    expect(appSource).toContain("if(kind==='hydrated_shrink'||kind==='lost')");
    expect(appSource).toContain("kind==='hydrated_shrink'?'items_removed_verified':'item_shrink_observed'");

    const auditOnlyBranch=appSource.match(/if\(kind==='hydrated_shrink'\|\|kind==='lost'\)\{([\s\S]*?)\n\s*\}/)?.[1]||'';
    expect(auditOnlyBranch).toContain('logChange(');
    expect(auditOnlyBranch).toContain('return;');
    expect(auditOnlyBranch).not.toContain('sendBrevoEmail');
  });

  test('email dispatch honors successful recovery classification', () => {
    expect(appSource.indexOf("if(auditOnly||kind==='blocked')return;")).toBeLessThan(appSource.indexOf("const subject='⚠️ NSA Portal — '+alertTitle"));
    expect(appSource).not.toContain("'🚨 NSA Portal — Items lost on '");
  });
});


test('EST-2434 decoration guard reports a blocked estimate save, never lost garments', () => {
  expect(classifySaveAlert('deco_shrink_blocked', 'EST-2434')).toMatchObject({
    isBlocked: true, entity: 'Estimate', action: 'save_blocked',
    unit: 'decoration(s)', countLabel: 'Decorations',
  });
});

test('item-count guards keep item units and the correct document type', () => {
  expect(classifySaveAlert('bg_shrink_blocked', 'SO-1140')).toMatchObject({
    isBlocked: true, entity: 'SO', action: 'save_blocked',
    unit: 'item(s)', countLabel: 'Items',
  });
});

test.each([
  ['est_id_reminted','EST-2630','Estimate'],
  ['inv_id_reminted','INV-1','Invoice'],
  ['received_restored','SO-2429','SO'],
])('%s is a recovery, not an emailed data-loss event', (kind,id,entity) => {
  expect(classifySaveAlert(kind,id)).toMatchObject({auditOnly:true,action:'save_recovered',entity,title:'Save recovery'});
});

test.each(['jobs_wipe_blocked','overcommit_blocked'])('%s remains actionable without claiming the whole save failed', kind => {
  const result=classifySaveAlert(kind,'SO-2429');
  expect(result).toMatchObject({auditOnly:false,isBlocked:true,title:'Save protection triggered',action:'save_blocked'});
  expect(result.notice).toContain('Other changes may have saved');
});

test.each(['batch_promotion_failed','future_event_kind'])('%s still alerts for review instead of silently disappearing', kind => {
  const result=classifySaveAlert(kind,'SO-1');
  expect(result).toMatchObject({auditOnly:false,action:'save_needs_review'});
  expect(result.title).not.toMatch(/lost/i);
});
