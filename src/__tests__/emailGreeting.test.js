// Greeting helpers for outgoing estimate / art-proof / invoice emails.
// Estimates, proofs and invoices routinely go to several people, so the greeting has to
// name whoever is actually selected — and re-write itself as the rep ticks boxes without
// clobbering edits made to the rest of the drafted message.
import { greetFirstNames, greetLine, withGreeting, emailMoney } from '../utils';

const CONTACTS=[
  {name:'Hillary Markey',email:'hillary.markley@fresno.edu',role:'Billing'},
  {name:'Jim Jeltma',email:'jim.jeltema@fresno.edu',role:'Athletic Director'},
  {name:'Cam Shahrokhi',email:'cameron.shahrokhi@fresno.edu'},
];

describe('greetFirstNames',()=>{
  test('first names only, in the order selected',()=>{
    expect(greetFirstNames(['cameron.shahrokhi@fresno.edu','hillary.markley@fresno.edu'],CONTACTS)).toEqual(['Cam','Hillary']);
  });
  test('matches email case-insensitively',()=>{
    expect(greetFirstNames(['  Hillary.Markley@Fresno.edu '],CONTACTS)).toEqual(['Hillary']);
  });
  test('drops duplicates and unknown (hand-typed) addresses',()=>{
    expect(greetFirstNames(['jim.jeltema@fresno.edu','jim.jeltema@fresno.edu','someone@else.com'],CONTACTS)).toEqual(['Jim']);
  });
});

describe('greetLine',()=>{
  test('one recipient',()=>{expect(greetLine(['cameron.shahrokhi@fresno.edu'],CONTACTS)).toBe('Hi Cam,')});
  test('two recipients',()=>{expect(greetLine(['cameron.shahrokhi@fresno.edu','hillary.markley@fresno.edu'],CONTACTS)).toBe('Hi Cam and Hillary,')});
  test('three recipients',()=>{expect(greetLine(CONTACTS.map(c=>c.email),CONTACTS)).toBe('Hi Hillary, Jim and Cam,')});
  test('no name on file falls back to "Hi there,"',()=>{
    expect(greetLine(['ap@district.org'],CONTACTS)).toBe('Hi there,');
    expect(greetLine([],CONTACTS)).toBe('Hi there,');
    expect(greetLine(['x@y.com'],[{email:'x@y.com',name:''}])).toBe('Hi there,');
  });
});

describe('withGreeting',()=>{
  const body='Hi Cam,\n\nAttached below is your invoice for "Hoods", totalling $1,234.56, due on 09/06/26.\n\nNSA Team';
  test('swaps the greeting and leaves the rest untouched',()=>{
    const out=withGreeting(body,'Hi Cam and Hillary,');
    expect(out.split('\n')[0]).toBe('Hi Cam and Hillary,');
    expect(out.slice(out.indexOf('\n'))).toBe(body.slice(body.indexOf('\n')));
  });
  test('leaves a hand-written opener alone',()=>{
    const custom='Coaches — quick one before Friday.\n\nAttached below is your invoice.';
    expect(withGreeting(custom,'Hi Cam,')).toBe(custom);
  });
  test('recognizes Hello/Hey openers',()=>{
    expect(withGreeting('Hello Jim,\n\nbody','Hi there,')).toBe('Hi there,\n\nbody');
    expect(withGreeting('Hey Jim,\n\nbody','Hi there,')).toBe('Hi there,\n\nbody');
  });
});

test('emailMoney formats with thousands separators and cents',()=>{
  expect(emailMoney(1234.5)).toBe('$1,234.50');
  expect(emailMoney(0)).toBe('$0.00');
});
