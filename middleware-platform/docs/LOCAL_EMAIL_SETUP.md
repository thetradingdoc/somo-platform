# Local Email Setup Guide

## Quick Setup (Gmail - Recommended)

### Step 1: Get Gmail App Password

1. Go to: https://myaccount.google.com/apppasswords
2. Sign in to your Google account
3. Select "Mail" and "Other (Custom name)"
4. Enter "DocLittle Local Dev"
5. Click "Generate"
6. Copy the 16-character password (you'll need this)

### Step 2: Configure .env File

Add these lines to `middleware-platform/.env`:

```bash
# Email Configuration (Local Development)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-16-char-app-password
SMTP_FROM=your-email@gmail.com

# Base URL for payment links
BASE_URL=http://localhost:4000
API_BASE_URL=http://localhost:4000
```

**Replace:**
- `your-email@gmail.com` with your Gmail address
- `your-16-char-app-password` with the App Password from Step 1

### Step 3: Test Email

Run the test script:

```bash
cd middleware-platform
node scripts/test-email-payment-link.js
```

This will:
1. Create a mock checkout
2. Send a payment link email to `drlittlekids@gmail.com`
3. Show you the email content

## Alternative: Use Setup Script

Run the interactive setup:

```bash
cd middleware-platform
node scripts/configure-local-email.js
```

Or use the bash script:

```bash
cd middleware-platform
./scripts/setup-local-email.sh
```

## Other Email Services

### SendGrid

```bash
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=your-sendgrid-api-key
SMTP_FROM=noreply@yourdomain.com
```

### Mailgun

```bash
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=your-mailgun-smtp-username
SMTP_PASSWORD=your-mailgun-smtp-password
SMTP_FROM=noreply@yourdomain.com
```

## Important Notes

1. **Payment Links**: The `BASE_URL` determines what URL is used in payment links
   - Local: `http://localhost:4000/payment/...`
   - Production: `https://api.doclittle.site/payment/...`

2. **Email Testing**: The test script uses `drlittlekids@gmail.com` as the test email

3. **Security**: Never commit your `.env` file to git (it's already in `.gitignore`)

## Troubleshooting

### "Email not sending"
- Check your SMTP credentials are correct
- For Gmail: Make sure you're using an App Password, not your regular password
- Check your firewall isn't blocking port 587

### "Payment link shows localhost"
- This is expected for local testing
- Change `BASE_URL` in `.env` if you want a different URL
- Production uses `https://api.doclittle.site`

### "nodemailer not installed"
```bash
npm install nodemailer
```

