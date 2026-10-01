// Preserve existing contacts; retry if another editor claims the next sort position.
export async function rememberEmailSender(supabase, { customerId, email, name }) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!customerId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('Choose an account and a valid sender email.');
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase.from('customer_contacts')
      .select('id,email,sort_order').eq('customer_id', customerId);
    if (error) throw new Error(error.message);
    const contacts = data || [];
    if (contacts.some(c => String(c.email || '').trim().toLowerCase() === normalized)) return;
    const sortOrder = contacts.reduce((max, c) => Math.max(max, Number(c.sort_order) || 0), -1) + 1;
    const { error: insertError } = await supabase.from('customer_contacts').insert({
      customer_id: customerId, email: normalized,
      name: String(name || '').trim() || normalized, sort_order: sortOrder,
    });
    if (!insertError) return;
    if (insertError.code !== '23505') throw new Error(insertError.message);
  }
  throw new Error('Contacts changed while saving. Please try again.');
}
