/* Tests for the marketing send pipeline's compliance-critical pure logic
 * (src/lib/marketingEmail.js): merge-field rendering must escape HTML, the
 * CAN-SPAM footer must always carry the postal address + unsubscribe link,
 * and the throttle schedule must actually stagger sends. */

const m = require('../lib/marketingEmail');

const CONTACT = {
  first_name: 'Matthew', last_name: 'Ornelaz', email: 'm.o@kernhigh.org',
  role: 'Athletic Director', sport: null, school_name: 'Bakersfield',
  school_city: 'Bakersfield', school_state: 'California', section_name: 'Central Section',
};

describe('renderTemplate', () => {
  test('substitutes known merge fields', () => {
    expect(m.renderTemplate('Hi {{first_name}} at {{school_name}}', CONTACT))
      .toBe('Hi Matthew at Bakersfield');
  });

  test('unknown fields and null values render empty', () => {
    expect(m.renderTemplate('{{sport}}|{{nope}}|{{last_name}}', CONTACT)).toBe('||Ornelaz');
  });

  test('HTML-escapes values in html mode (XSS via contact data)', () => {
    const evil = { ...CONTACT, first_name: '<script>alert(1)</script>' };
    const out = m.renderTemplate('Hi {{first_name}}', evil);
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  test('subject mode does not HTML-escape', () => {
    const c = { ...CONTACT, school_name: "O'Brien & Sons" };
    expect(m.renderTemplate('{{school_name}}', c, { html: false })).toBe("O'Brien & Sons");
  });

  test('tolerates whitespace in tokens', () => {
    expect(m.renderTemplate('{{ first_name }}', CONTACT)).toBe('Matthew');
  });
});

describe('buildFooterHtml', () => {
  const footer = m.buildFooterHtml({
    companyName: 'National Sports Apparel',
    addressLine: '2238 N Glassell St Ste E, Orange, CA 92865',
    unsubUrl: 'https://example.com/unsub?e=x&sig=y',
  });

  test('contains the postal address (CAN-SPAM)', () => {
    expect(footer).toContain('2238 N Glassell St Ste E, Orange, CA 92865');
  });

  test('contains a working unsubscribe link (CAN-SPAM)', () => {
    expect(footer).toContain('href="https://example.com/unsub?e=x&sig=y"');
    expect(footer.toLowerCase()).toContain('unsubscribe');
  });

  test('says why the recipient is receiving it', () => {
    expect(footer).toContain('CIFCS school directory');
  });
});

describe('wrapEmailHtml', () => {
  test('wraps body and footer in the branded shell', () => {
    const html = m.wrapEmailHtml('<p>BODY</p>', '<div>FOOTER</div>');
    expect(html).toContain('<p>BODY</p>');
    expect(html).toContain('<div>FOOTER</div>');
    expect(html).toContain('NATIONAL SPORTS APPAREL');
    expect(html.indexOf('BODY')).toBeLessThan(html.indexOf('FOOTER'));
  });
});

describe('throttleSchedule', () => {
  const T0 = Date.UTC(2026, 6, 7, 12, 0, 0);

  test('staggers at the requested rate', () => {
    const times = m.throttleSchedule(3, T0, 60); // 1/min
    expect(times[0]).toBe(new Date(T0).toISOString());
    expect(new Date(times[1]).getTime() - T0).toBe(60000);
    expect(new Date(times[2]).getTime() - T0).toBe(120000);
  });

  test('clamps rate into [1,100]/hr', () => {
    const fast = m.throttleSchedule(2, T0, 100000);
    expect(new Date(fast[1]).getTime() - T0).toBe(36000); // 100/hr floor step
    const slow = m.throttleSchedule(2, T0, 0);
    expect(new Date(slow[1]).getTime() - T0).toBe(60000); // bad rate → default 60/hr
  });

  test('count rows out, none in the past relative to start', () => {
    const times = m.throttleSchedule(50, T0, 60);
    expect(times).toHaveLength(50);
    expect(times.every((t) => new Date(t).getTime() >= T0)).toBe(true);
  });
});

describe('normEmail', () => {
  test('lowercases and validates', () => {
    expect(m.normEmail(' Coach@School.EDU ')).toBe('coach@school.edu');
    expect(m.normEmail('bad')).toBe('');
  });
});
