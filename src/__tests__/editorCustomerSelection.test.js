import fs from 'fs';
import path from 'path';

// A chosen customer has to land in BOTH places the editor reads it from: the local `cust`
// object (drives the header, tier, tax) and the order's `customer_id` (what actually persists).
// When they drifted — the editor mounts with whatever customer object the page hands it, which
// is null if the customers list hadn't loaded yet — an order that already HAD a customer showed
// the "Select Customer *" picker again and Save refused it with "Select a customer first", so the
// rep had to pick the very same customer a second time. Both editors are covered: classic is the
// default UI, the redesign ships behind the toggle (CLAUDE.md).
describe.each(['OrderEditor.js','OrderEditorClassic.js'])('%s customer selection',file=>{
  const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');

  test('picking a customer sets the local object and the order field together',()=>{
    const body=source.match(/const selC=(id=>\{.*?\});\n/)[1];
    const allCustomers=[{id:'c1',name:'San Joaquin Memorial',catalog_markup:1.8}];
    const setCust=jest.fn(),setCustChanging=jest.fn(),sv=jest.fn();
    Function('allCustomers','setCust','setCustChanging','sv','return '+body)(allCustomers,setCust,setCustChanging,sv)('c1');
    expect(setCust).toHaveBeenCalledWith(allCustomers[0]);
    expect(sv).toHaveBeenCalledWith('customer_id','c1');
    expect(setCustChanging).toHaveBeenCalledWith(false);
  });

  const healBody=source.match(/React\.useEffect\(\(\)=>\{\n(\s*const _cid=o\.customer_id;[\s\S]*?)\},\[o\.customer_id,allCustomers,cust\]\);/)[1];
  const heal=(o,cust,allCustomers)=>{const setCust=jest.fn();Function('o','cust','allCustomers','setCust',healBody)(o,cust,allCustomers,setCust);return setCust};

  test('a missing customer object is healed from the order customer_id',()=>{
    const allCustomers=[{id:'c1',name:'San Joaquin Memorial'}];
    expect(heal({customer_id:'c1'},null,allCustomers)).toHaveBeenCalledWith(allCustomers[0]);
  });

  test('a customer object left over from another order is replaced',()=>{
    const allCustomers=[{id:'c1',name:'San Joaquin Memorial'},{id:'c2',name:'Clovis West'}];
    expect(heal({customer_id:'c2'},allCustomers[0],allCustomers)).toHaveBeenCalledWith(allCustomers[1]);
  });

  test('the matching customer is left alone so local edits (promo periods) survive',()=>{
    const loaded={id:'c1',name:'San Joaquin Memorial',promo_periods:[{id:'pp1'}]};
    expect(heal({customer_id:'c1'},loaded,[{id:'c1',name:'San Joaquin Memorial'}])).not.toHaveBeenCalled();
  });

  test('an order with no customer keeps the picker empty',()=>{
    expect(heal({customer_id:null},{id:'c1'},[{id:'c1'}])).toHaveBeenCalledWith(null);
  });

  test('Save gates on the persisted customer_id, not the local object',()=>{
    expect(source).not.toContain("if(!cust){nf('Select a customer first'");
    expect(source).toContain("if(!o.customer_id){nf('Select a customer first'");
  });

  test('the change link never drops the customer object on its own',()=>{
    // The old handler ran setCust(null) even when the confirm was cancelled, and its selC(null)
    // never cleared customer_id — leaving exactly the half-state this suite guards against.
    expect(source).not.toContain('selC(null);setCust(null)');
  });
});
