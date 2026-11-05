-- Homevio: neuer Produktname (alter Standardname wird ersetzt, eigene Namen bleiben)
alter table public.app_settings alter column product_name set default 'Homevio';
update public.app_settings set product_name = 'Homevio' where product_name in ('', 'HausOps Immobilien');
