import { cloudinaryPreviewUrl } from './cloudinaryPreview';

test('uses a display-sized Cloudinary image while preserving its version and query', () => {
  const source = 'https://res.cloudinary.com/demo/image/upload/v123/art/mock.png?x=1';
  expect(cloudinaryPreviewUrl(source, 800)).toBe('https://res.cloudinary.com/demo/image/upload/c_limit,w_800/q_auto/f_auto/v123/art/mock.png?x=1');
});

test('leaves other hosts and existing transformation paths untouched', () => {
  const already = 'https://res.cloudinary.com/demo/image/upload/c_fill,w_500/v123/art/mock.png';
  expect(cloudinaryPreviewUrl(already)).toBe(already);
  expect(cloudinaryPreviewUrl('https://example.com/mock.png')).toBe('https://example.com/mock.png');
});
