CREATE TABLE IF NOT EXISTS form_revisions(id text PRIMARY KEY,body jsonb NOT NULL,created_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE TRIGGER form_revision_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON form_revisions FOR EACH STATEMENT EXECUTE FUNCTION protect_history();
INSERT INTO form_revisions(id,body) SELECT value->>'revision',value FROM settings WHERE key='form' ON CONFLICT(id) DO NOTHING;
ALTER TABLE leads ADD CONSTRAINT submission_form_revision FOREIGN KEY(form_revision) REFERENCES form_revisions(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE leads ADD COLUMN chat_id uuid REFERENCES chats(id);
CREATE TABLE IF NOT EXISTS notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid UNIQUE NOT NULL,message_id text UNIQUE NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','sending','provider_accepted','uncertain','failed','disabled')),last_error text,updated_at timestamptz NOT NULL DEFAULT now());
