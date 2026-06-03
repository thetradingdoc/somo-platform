# POLICIES

**Last updated:** 2026-06-02


---

<a id="privacy-policy"></a>

## PRIVACY POLICY

*Merged from `docs/legal/PRIVACY_POLICY.md` on 2026-06-02.*

# Somo Privacy Policy

**Version 1.0**  
**Last Updated: May 29, 2026**

## 1. Introduction

Somo ("we", "us", or "our") provides an AI front desk and revenue cycle management platform for healthcare and business customers. This Privacy Policy describes how we collect, use, disclose, and protect information when you use our websites, applications, and APIs.

Production services may be served from **callsomo.com** and related infrastructure until **somopay.ai** cutover. See [INFRA_BRAND_DEFERRAL.md](../Brand/INFRA_BRAND_DEFERRAL.md).

## 2. Information we collect

- **Account data:** name, email, business name, billing details you provide at signup.
- **Usage data:** API calls, voice session metadata, logs, and security events.
- **Healthcare-related data:** when you use Somo pay or clinical integrations, we process data you or your EHR submit for eligibility, claims, and patient billing — subject to your agreements and applicable law (including HIPAA where we act as a business associate).

## 3. How we use information

- Provide and improve the Service (voice agents, scheduling, RCM, payments).
- Authenticate users, prevent fraud, and enforce terms.
- Send transactional email (verification, invoices, password reset).
- Comply with legal obligations.

We do not sell personal information.

## 4. Sharing

We share data with subprocessors needed to operate the Service (e.g. telephony, AI voice, payment, clearinghouse). A current list is available on request. We may disclose information if required by law or to protect rights and safety.

## 5. Retention and security

We retain data as long as your account is active or as needed for legal, billing, and audit purposes. We use administrative, technical, and organizational safeguards appropriate to the data we process.

## 6. Your choices

You may request access, correction, or deletion of account data by contacting support. California and other regional rights may apply where relevant.

## 7. Contact

For privacy questions: use the support contact on your Somo account or the address provided in your order form.

## 8. Changes

We may update this policy; material changes will be posted with an updated "Last Updated" date.


---

<a id="terms-of-service"></a>

## TERMS OF SERVICE

*Merged from `docs/legal/TERMS_OF_SERVICE.md` on 2026-06-02.*

# Somo API Terms of Service

**Version 1.0**  
**Last Updated: November 17, 2025**

## 1. Agreement to Terms

By accessing or using the Somo API Service ("Service") provided by Somo ("Company", "we", "us", or "our"), you agree to be bound by these Terms of Service ("Terms"). If you disagree with any part of these terms, then you do not have permission to access the Service.

## 2. Description of Service

Somo provides an API service that enables voice commerce, healthcare integration, payment processing, and related services through voice agents and webhook integrations. The Service includes:

- Voice agent integration via Retell AI
- Telephony services via Twilio
- API endpoints for appointments, payments, insurance, and healthcare data
- Webhook management
- Documentation and developer tools

## 3. Account Registration and API Keys

### 3.1 Account Requirements
To use the Service, you must:
- Provide accurate, current, and complete information during registration
- Maintain and update your account information to keep it accurate
- Be at least 18 years old or have legal authority to enter into contracts
- Use a valid business email address

### 3.2 Email Verification
- You must verify your email address before accessing documentation or creating API keys
- Verification codes expire after 15 minutes
- Limited to 3 verification attempts per email per hour

### 3.3 API Keys
- API keys are required to access the Service
- API keys are unique to your account and must be kept confidential
- You are responsible for all activities that occur under your API key(s)
- You must immediately notify us if you suspect unauthorized use of your API key
- API keys can be revoked at any time by us for security or policy violations

## 4. Pricing and Payment Terms

### 4.1 Usage-Based Pricing

**Voice Call Minutes:**
- **$0.05 per minute** for voice calls processed through the Service
- Pricing includes:
  - Retell AI conversation minutes ($0.02/min)
  - Twilio telephony minutes ($0.013/min)
  - Infrastructure and platform fees ($0.017/min)

**API Requests:**
- First **1,000 requests per month**: Included at no charge
- Additional requests: **$0.01 per 1,000 requests**

**Webhooks:**
- Included at no additional cost

### 4.2 Billing
- Billing is calculated based on actual usage
- Usage is tracked per calendar month
- Invoices are generated monthly and sent via email
- Payment is due within **15 days** of invoice date
- All fees are non-refundable except as required by law

### 4.3 Payment Methods
We accept payment via:
- Credit card (Visa, Mastercard, American Express)
- ACH bank transfer
- Wire transfer (for enterprise accounts)

### 4.4 Late Payment
- If payment is not received within 30 days, service may be suspended
- Late fees of **1.5% per month** or maximum allowed by law may apply
- Service will be reinstated upon payment of all outstanding amounts

## 5. Acceptable Use Policy

### 5.1 Prohibited Uses
You agree NOT to use the Service to:
- Violate any applicable laws or regulations
- Infringe upon intellectual property rights
- Transmit malicious code, viruses, or harmful content
- Engage in fraud, phishing, or deceptive practices
- Spam, harass, or abuse users
- Interfere with or disrupt the Service or servers
- Attempt to gain unauthorized access to any part of the Service
- Use the Service for any illegal healthcare data access or HIPAA violations
- Resell or redistribute the Service without written authorization

### 5.2 Rate Limits
- API requests are subject to rate limiting
- General API: 100 requests per 15 minutes per API key
- Voice endpoints: 20 requests per minute per API key
- Payment endpoints: 10 requests per hour per API key
- We reserve the right to adjust rate limits with 7 days notice

### 5.3 Abuse Prevention
We monitor usage patterns and may:
- Suspend accounts that violate these Terms
- Block API keys that show abusive patterns
- Require additional verification for suspicious activity

## 6. Healthcare Data and HIPAA Compliance

### 6.1 Healthcare Data
If you use the Service to process Protected Health Information (PHI) or healthcare data:
- You are responsible for ensuring HIPAA compliance
- You must have appropriate Business Associate Agreements (BAAs) in place
- You must comply with all applicable healthcare data protection laws
- You are responsible for obtaining patient consent where required

### 6.2 Our Role
- We provide infrastructure and services but do not directly handle PHI
- We implement industry-standard security measures
- We comply with applicable data protection regulations

## 7. Intellectual Property and Copyright Protection

### 7.1 Service Ownership and Copyright
- The Service, including all content, features, functionality, code, designs, documentation, and proprietary methods, is owned by Somo and protected by copyright laws
- All trademarks, service marks, logos, and brand names are the exclusive property of Somo
- The Service is protected by copyright, trademark, trade secret, and other intellectual property laws in the United States and internationally

### 7.2 Prohibited Use - No Copying or Reverse Engineering
**YOU ARE EXPRESSLY PROHIBITED FROM:**
- Copying, reproducing, or duplicating any part of the Service, including but not limited to:
  - Source code, API structures, or technical documentation
  - User interface designs, layouts, or styling
  - Proprietary algorithms, methods, or business logic
  - Integration patterns or workflow designs
- Reverse engineering, decompiling, or disassembling the Service
- Creating derivative works based on the Service
- Extracting or scraping data beyond what is permitted through official API endpoints
- Redistributing, sublicensing, or reselling the Service without written authorization
- Removing, altering, or obscuring any copyright, trademark, or proprietary notices

### 7.3 Protection of Our Work
- Somo invests significant resources in developing, maintaining, and improving the Service
- Any unauthorized use, copying, or distribution of our intellectual property may result in:
  - Immediate termination of your account and access to the Service
  - Legal action for copyright infringement and damages
  - Claims for lost profits, statutory damages, and attorney fees

### 7.4 Your Content
- You retain ownership of any data or content you provide through the Service
- By using the Service, you grant us a limited, non-exclusive license to use your data solely to provide the Service
- You are responsible for ensuring you have rights to any data you provide
- You agree not to upload content that infringes on third-party intellectual property rights

## 8. Data Privacy and Security

### 8.1 Data Security
We implement industry-standard security measures including:
- Encryption in transit (TLS/SSL)
- Secure API key storage (hashed)
- Regular security audits
- Access controls and monitoring

### 8.2 Data Retention
- We retain usage data for billing and service improvement purposes
- You may request deletion of your account and data subject to legal requirements
- Backup data may be retained for up to 90 days after deletion

### 8.3 Privacy Policy
Our Privacy Policy, available at `api.callsomo.com/privacy`, governs how we collect, use, and disclose your information.

## 9. Service Availability and Modifications

### 9.1 Service Availability
- We strive for 99.9% uptime but do not guarantee uninterrupted access
- Scheduled maintenance will be announced with reasonable notice
- We are not liable for service interruptions beyond our control

### 9.2 Service Modifications
- We reserve the right to modify, suspend, or discontinue the Service at any time
- We will provide notice of significant changes when possible
- Continued use of the Service after changes constitutes acceptance

## 10. Support and Service Level Agreement

### 10.1 Support
- Email support: support@api.callsomo.com
- Documentation: api.api.callsomo.com/docs
- Response time targets:
  - **Standard**: 48 hours
  - **Urgent**: 24 hours (for enterprise accounts)

### 10.2 Service Level Agreement (SLA)
- **Uptime Target**: 99.9% (measured monthly)
- **Credits**: If uptime falls below 99.9%, you may be eligible for service credits
- **Exclusions**: Maintenance windows, force majeure events, and user-caused issues are excluded

## 11. Termination

### 11.1 Termination by You
- You may terminate your account at any time via the admin portal or by contacting support
- Termination takes effect at the end of your current billing period
- You remain responsible for all charges incurred until termination

### 11.2 Termination by Us
We may terminate or suspend your account immediately if:
- You violate these Terms
- You fail to pay fees when due
- You engage in fraudulent or illegal activity
- Required by law or government request

### 11.3 Effect of Termination
- Upon termination, your access to the Service will cease
- All API keys will be revoked
- We may delete your account data after 90 days
- You remain responsible for all fees accrued before termination

## 12. Disclaimer of Warranties

THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO:
- WARRANTIES OF MERCHANTABILITY
- FITNESS FOR A PARTICULAR PURPOSE
- NON-INFRINGEMENT
- UNINTERRUPTED OR ERROR-FREE OPERATION

## 13. Limitation of Liability

TO THE MAXIMUM EXTENT PERMITTED BY LAW:
- OUR TOTAL LIABILITY SHALL NOT EXCEED THE AMOUNT YOU PAID US IN THE 12 MONTHS PRECEDING THE CLAIM
- WE SHALL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES
- WE SHALL NOT BE LIABLE FOR DATA LOSS, LOST PROFITS, OR BUSINESS INTERRUPTION

## 14. Indemnification

You agree to indemnify, defend, and hold harmless Somo and its officers, directors, employees, and agents from any claims, damages, losses, liabilities, and expenses (including attorney's fees) arising from:
- Your use of the Service
- Your violation of these Terms
- Your violation of any third-party rights
- Your handling of healthcare data or PHI

## 15. Governing Law and Disputes

### 15.1 Governing Law
These Terms shall be governed by and construed in accordance with the laws of [Your State/Country], without regard to its conflict of law provisions.

### 15.2 Dispute Resolution
- Disputes shall first be addressed through good faith negotiation
- If negotiation fails, disputes shall be resolved through binding arbitration
- Class action waivers apply to the maximum extent permitted by law

## 16. Changes to Terms

- We may modify these Terms at any time
- Material changes will be communicated via email or through the Service
- Your continued use after changes constitutes acceptance
- If you disagree with changes, you must stop using the Service

## 17. General Provisions

### 17.1 Entire Agreement
These Terms, together with our Privacy Policy, constitute the entire agreement between you and Somo.

### 17.2 Severability
If any provision of these Terms is found to be unenforceable, the remaining provisions shall remain in full effect.

### 17.3 Assignment
You may not assign or transfer these Terms without our written consent. We may assign these Terms at any time.

### 17.4 Waiver
No waiver of any provision shall be effective unless in writing and signed by the party waiving the right.

### 17.5 Notices
Notices may be sent via email to the address associated with your account or posted through the Service.

## 18. Contact Information

**Somo**  
Email: support@api.callsomo.com  
API Documentation: https://api.api.callsomo.com/docs  
Website: https://api.callsomo.com

---

**By creating an account and using the Somo API Service, you acknowledge that you have read, understood, and agree to be bound by these Terms of Service.**
