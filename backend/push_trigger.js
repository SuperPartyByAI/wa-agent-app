const { Client } = require('pg');

const client = new Client(process.env.SUPABASE_CONNECTION_STRING);

(async () => {
  try {
    await client.connect();
    console.log('Connected to Supabase Postgres DB');
    
    await client.query(`
      CREATE OR REPLACE FUNCTION public.handle_new_user()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER SET search_path = public
      AS $$
      BEGIN
        INSERT INTO public.profiles (id, email, full_name, role)
        VALUES (
          NEW.id,
          NEW.email,
          COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
          'agent'
        );
        RETURN NEW;
      END;
      $$;

      DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
      CREATE TRIGGER on_auth_user_created
        AFTER INSERT ON auth.users
        FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
    `);
    
    console.log('Trigger on_auth_user_created successfully installed');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    await client.end();
  }
})();
