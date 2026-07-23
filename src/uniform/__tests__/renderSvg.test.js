import { makeDefaultSpec } from '../designSpec';
import { renderProductionSVG } from '../renderSvg';

describe('editable production SVG', () => {
  test('exports named vector zones, exact colors and finished lettering height', async () => {
    const spec = makeDefaultSpec('crew_jersey');
    spec.meta = { teamName: 'North Gate', program: 'mens', designId: 'TEST-1012' };
    spec.zones.body = { ...spec.zones.body, color: '#7f1d1d' };
    spec.text.front.number = {
      ...spec.text.front.number,
      value: '15',
      inches: 4,
      x: 0.5,
      y: 0.3,
    };

    const svg = await renderProductionSVG(spec);

    expect(svg).toContain('EDITABLE PRODUCTION SVG');
    expect(svg).toContain('data-render-mode="vector-path-zones"');
    expect(svg).toContain('data-zone="body"');
    expect(svg).toContain('data-color="#7f1d1d"');
    expect(svg).toContain('data-finished-height-in="4"');
    expect(svg).toContain('>15</text>');
    expect(svg).toContain('North Gate');
    expect(svg).toContain('TEST-1012');
  });

  test('includes both reversible faces and matching shorts in one file', async () => {
    const sideA = makeDefaultSpec('crew_jersey');
    const sideB = makeDefaultSpec('crew_jersey');
    const shortsA = makeDefaultSpec('shorts');
    const shortsB = makeDefaultSpec('shorts');
    sideA.zones.body.color = '#111827';
    sideB.zones.body.color = '#ffffff';

    const svg = await renderProductionSVG(sideA, {
      reverseSpec: sideB,
      bottomSpec: shortsA,
      reverseBottomSpec: shortsB,
    });

    expect(svg).toContain('SIDE A · FRONT');
    expect(svg).toContain('SIDE B · BACK');
    expect(svg).toContain('SHORTS SIDE A · FRONT');
    expect(svg).toContain('SHORTS SIDE B · BACK');
    expect(svg).toContain('data-color="#111827"');
    expect(svg).toContain('data-color="#ffffff"');
  });

  test('escapes customer copy so the SVG remains valid XML', async () => {
    const spec = makeDefaultSpec('crew_jersey');
    spec.meta.teamName = 'A&B <Elite>';
    spec.text.front.name.value = 'A&B';

    const svg = await renderProductionSVG(spec);

    expect(svg).toContain('A&amp;B &lt;Elite&gt;');
    expect(svg).toContain('>A&amp;B</text>');
    expect(svg).not.toContain('>A&B</text>');
  });
});
