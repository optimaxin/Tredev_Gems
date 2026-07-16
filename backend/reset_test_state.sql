-- Reset transactional state between test runs. The suite is order-dependent and
-- assumes available units; leftover sold/reserved units from a prior run starve it.
-- Catalogue, users and certificates are preserved (re-seeding is idempotent anyway).
UPDATE product_units SET status='in_stock', sold_order_item_id=NULL;
DELETE FROM order_events;
DELETE FROM affiliate_commissions;
DELETE FROM payments;
DELETE FROM shipment_items;
DELETE FROM shipments;
DELETE FROM verified_items;
DELETE FROM order_items;
DELETE FROM orders;
DELETE FROM cart_items;
DELETE FROM reservations;
DELETE FROM carts;
DELETE FROM addresses;
UPDATE qr_codes SET status='active', activated_at=now();
UPDATE authenticity_certificates SET revoked_at=NULL;
-- test users are referenced by user_roles/permissions/prefs; clear those first.
-- (Guest-checkout users are created by /checkout from the buyer email.)
DELETE FROM user_permissions WHERE user_id IN
  (SELECT id FROM users WHERE email LIKE 'test_%@example.com' OR email LIKE 'staff_%@example.com'
        OR email LIKE 'qa%@example.com' OR email LIKE '%@staff.test'
        OR email = 'b@b.com');
DELETE FROM user_roles WHERE user_id IN
  (SELECT id FROM users WHERE email LIKE 'test_%@example.com' OR email LIKE 'staff_%@example.com'
        OR email LIKE 'qa%@example.com' OR email LIKE '%@staff.test'
        OR email = 'b@b.com');
DELETE FROM notification_preferences WHERE user_id IN
  (SELECT id FROM users WHERE email LIKE 'test_%@example.com' OR email LIKE 'staff_%@example.com'
        OR email LIKE 'qa%@example.com' OR email LIKE '%@staff.test'
        OR email = 'b@b.com');
DELETE FROM user_sessions WHERE user_id IN
  (SELECT id FROM users WHERE email LIKE 'test_%@example.com' OR email LIKE 'staff_%@example.com'
        OR email LIKE 'qa%@example.com' OR email LIKE '%@staff.test'
        OR email = 'b@b.com');
DELETE FROM users WHERE email LIKE 'test_%@example.com' OR email LIKE 'staff_%@example.com'
        OR email LIKE 'qa%@example.com' OR email LIKE '%@staff.test'
        OR email = 'b@b.com';
