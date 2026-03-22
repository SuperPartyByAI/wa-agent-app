INSERT INTO public.event_field_definitions (field_key, label, data_type, description, required_for_booking) VALUES
('data_evenimentului', 'Data Evenimentului', 'date', 'Data calendaristică', true),
('ora_evenimentului', 'Ora', 'string', 'Ora la care începe petrecerea', true),
('locatie_eveniment', 'Locația', 'string', 'Locația (acasă, restaurant, etc)', true),
('numar_copii', 'Număr Copii', 'number', 'Număr estimat', false),
('tip_eveniment', 'Tip Eveniment', 'string', 'Aniversare, botez, etc', false)
ON CONFLICT (field_key) DO NOTHING;
