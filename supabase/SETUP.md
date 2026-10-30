# Supabase setup for Dental Clinic OS

This branch adds the database policy required for owner-only cloud sync.

## 1. Create / open the Supabase project

In Supabase Dashboard, open the project for Dental Clinic OS. Copy:
- Project URL
- Publishable key (or legacy anon key)

Do not share or put the `service_role` / secret key in the browser app.

## 2. Create the sync table

Open SQL Editor and run `supabase/schema.sql` from this repository.

The table stores one JSON payload per authenticated owner. Row Level Security ensures each signed-in owner can only read or write the row whose `user_id` equals `auth.uid()`.

## 3. Enable email confirmation

In Authentication > Sign In / Providers > Email:
- Enable email/password sign-ups.
- Enable Confirm email.
- Keep automatic confirmation disabled.

In Authentication > URL Configuration, add the deployed app URL and the app's confirmation redirect URL to the allowed redirect URLs. The app must handle the Supabase confirmation callback before considering the account verified.

## 4. Configure email delivery

The built-in Supabase mailer is only for limited testing: it sends only to addresses belonging to the Supabase organization team and is limited to about 2 emails per hour. For real clinic-owner signups, configure custom SMTP in Authentication > Emails > SMTP Settings (for example Resend, Brevo, Postmark, SendGrid, or AWS SES).

Set a verified sender address and configure SPF/DKIM/DMARC with the mail provider. Do not disable email confirmation as a workaround.

## 5. Test before production

Use a real inbox not merely a team member test if custom SMTP is configured:
1. Sign up with a new address.
2. Verify the confirmation email arrives.
3. Click the confirmation link and return to the app.
4. Confirm the app recognizes the authenticated, verified session.
5. Sign out and sign in again.
6. Save a test record; open the app on a second device using the same account and confirm it loads.
7. Sign in as a second account and confirm it cannot read the first account's data.

Do not claim email delivery is verified until the actual inbox test succeeds.
