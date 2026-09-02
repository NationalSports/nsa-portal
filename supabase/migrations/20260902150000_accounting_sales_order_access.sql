-- Accounting's dashboard and invoice/customer workflows link directly into sales orders,
-- and the order editor already has accounting-specific cost controls. Existing explicit
-- access arrays were seeded before `orders` was added to the accounting default, so bring
-- those users forward; NULL/empty access continues to use the client role default.
update public.team_members
set access = array_append(access, 'orders')
where role = 'accounting'
  and access is not null
  and not ('orders' = any(access));
