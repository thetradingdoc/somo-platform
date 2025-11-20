# DocLittle Platform Documentation

Welcome to the DocLittle Medical Coding Assistant documentation.

## 📚 Documentation Structure

### [Patient Journey](./patient-journey/)
Complete patient workflow documentation including:
- Test scenarios and demos
- Appointment setup
- Patient data management
- Full user journey flows

### [Integrations](./integrations/)
Third-party API integrations:
- **STEDI API** - Healthcare insurance operations (X12 EDI)
- **UHC FHIR API** - UnitedHealthcare FHIR integration
- Insurance eligibility, claims, and EOB processing

### [Voice Agent](./voice-agent/)
Retell AI voice agent documentation:
- 11 core voice agent functions
- Production test results
- Agent capabilities and configuration
- Voice booking workflows

### [Deployment](./deployment/)
Production deployment documentation:
- Azure deployment guides
- DNS and SSL configuration
- Deployment checklists
- Recent deployment notes

### [Architecture](./architecture/)
System architecture and design:
- Multi-tenant voice agent architecture
- Real-time language switching
- System components and data flow

### [Testing](./testing/)
Testing documentation:
- Test suites and scenarios
- Voice agent flow tests
- Tenant isolation tests
- API testing guides

## 🚀 Quick Links

- **API Reference**: See [API documentation](../middleware-platform/routes/README.md)
- **Setup Guide**: See [Setup documentation](./setup/README.md)
- **Recent Deployments**: See [Deployment Notes](./deployment/DEPLOYMENT_NOTES_2025_11_20.md)

## 📋 Recent Updates

### November 20, 2025
- ✅ Patient dashboard "Hi OJ" greeting implementation
- ✅ Business hours extended to 7pm for 6pm appointments
- ✅ Patient name update endpoint added
- ✅ Documentation organized into structured directories
- ✅ STEDI API endpoints documented
- ✅ Voice agent capabilities documented

## 🔍 Key Features

### Medical Bill Sorting Agent
An intelligent agent that automates the entire medical billing workflow:
1. Receives bills from providers, patients, insurers
2. Sorts and categorizes by patient, provider, insurer
3. Matches bills to appointments and EOBs
4. Automates claim submission via STEDI
5. Processes EOBs and calculates patient responsibility
6. Deducts from patient wallet automatically

### Voice Agent (Kelly)
11 core functions for healthcare voice interactions:
- Insurance collection and verification
- Appointment scheduling and management
- Payment checkout creation
- Claim history retrieval
- Multilingual support

### Insurance Integration (STEDI)
X12 EDI transactions for healthcare:
- Eligibility checks (270/271)
- Claim submission (837)
- Claim status (276/277)
- Payer directory

## 📞 Support

For questions or issues, refer to the specific documentation section or check the deployment notes for recent changes.
