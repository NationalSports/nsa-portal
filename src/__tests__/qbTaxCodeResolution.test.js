import { resolveQBTaxCode } from '../qbAccountMappings';

const CA={Id:'7',Name:'California',Taxable:true,Active:true};
const WA={Id:'9',Name:'Washington',Taxable:true,Active:true};
const NON={Id:'3',Name:'Non-Taxable',Taxable:false,Active:true};

describe('QBO sales tax code resolution', () => {
  test('resolves a state to its own named QBO tax code', () => {
    expect(resolveQBTaxCode([CA,WA,NON],'CA')).toEqual({value:'7',name:'California'});
    expect(resolveQBTaxCode([CA,WA,NON],'WA')).toEqual({value:'9',name:'Washington'});
  });

  test('accepts lowercase and padded state values', () => {
    expect(resolveQBTaxCode([CA],' ca ')).toEqual({value:'7',name:'California'});
  });

  test('never falls back to a lone code for an unconfigured state', () => {
    // AST has a California agency only. WA tax must not ride in under it.
    expect(()=>resolveQBTaxCode([CA],'WA')).toThrow(/No QBO tax code resolved for Washington/);
  });

  test('names the available codes so a failed run is the discovery run', () => {
    expect(()=>resolveQBTaxCode([CA],'WA')).toThrow(/California #7/);
    expect(()=>resolveQBTaxCode([],'CA')).toThrow(/no active taxable tax codes/i);
  });

  test('ignores inactive and non-taxable codes', () => {
    expect(()=>resolveQBTaxCode([{...CA,Active:false}],'CA')).toThrow(/No QBO tax code resolved/);
    expect(()=>resolveQBTaxCode([NON],'CA')).toThrow(/No QBO tax code resolved/);
  });

  test('rejects states with no mapping at all', () => {
    expect(()=>resolveQBTaxCode([CA],'SD')).toThrow(/No QBO tax-code mapping is defined for state "SD"/);
    expect(()=>resolveQBTaxCode([CA],'')).toThrow(/\(blank\)/);
  });

  test('refuses to guess when several codes match one state', () => {
    expect(()=>resolveQBTaxCode([CA,{Id:'8',Name:'California District',Taxable:true,Active:true}],'CA'))
      .toThrow(/Multiple QBO tax codes match California/);
  });
});
