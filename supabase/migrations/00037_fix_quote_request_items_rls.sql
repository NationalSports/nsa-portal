-- quote_request_items had RLS enabled but zero policies, blocking all access
CREATE POLICY "allow_all" ON quote_request_items FOR ALL USING (true) WITH CHECK (true);
