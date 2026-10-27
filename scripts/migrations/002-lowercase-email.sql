-- Les adresses e-mail sont enregistrées en minuscules : l'unicité ne dépend pas de la casse.
UPDATE account SET email = lower(email);
ALTER TABLE account ADD CONSTRAINT account_email_lowercase CHECK (email = lower(email));
