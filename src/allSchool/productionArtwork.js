import { supabase } from '../lib/supabase';
export async function uploadProductionArtwork(file) {
  if (!file || !/\.ai$/i.test(file.name) || file.size > 20 * 1024 * 1024 || file.size === 0) throw new Error('Attach a nonempty .ai file of 20 MB or less.');
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  const path = `${crypto.randomUUID()}/${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const { error } = await supabase.storage.from('all-school-art').upload(path, file, { upsert: false, contentType: 'application/postscript' });
  if (error) throw error;
  return { bucket: 'all-school-art', path, name: file.name, sha256 };
}
