describe('LittleLab landing & journeys', () => {
  const baseUrl = Cypress.config('baseUrl') || 'http://localhost:4000';

  function extractCodeFromLogs() {
    // Very lightweight heuristic: look for a 6-digit number in recent console logs
    // when /api/patient/verify/send is called locally and code is logged server-side.
    // In CI you can replace this with a deterministic test mailbox.
    return cy
      .task('getLastVerificationCode')
      .then((code) => {
        expect(code, 'verification code from backend logs').to.match(/^[0-9]{6}$/);
        return code;
      });
  }

  it('Journey A – New patient via landing', () => {
    cy.visit('/');

    cy.contains('LittleLab').should('exist');

    cy.get('input[type="search"], input[type="text"]').first().type('cough and fever');

    cy.contains("I'm a Patient").click();

    cy.url().should('include', '/unified-dashboard/patients/patient-login.html');

    const email = 'patient@doclittle.com';
    cy.get('#emailInput').clear().type(email);
    cy.get('#emailSubmitBtn').click();

    extractCodeFromLogs().then((code) => {
      code.split('').forEach((digit, idx) => {
        cy.get(`#code${idx + 1}`).type(digit);
      });
      cy.get('#codeSubmitBtn').click();

      cy.url({ timeout: 20000 }).should('include', 'patient-dashboard.html');
      cy.contains('Appointments').should('exist');
    });
  });

  it('Journey B – Returning patient skips onboarding when verified', () => {
    cy.visit('/unified-dashboard/patients/patient-login.html');

    const email = 'patient@doclittle.com';
    cy.get('#emailInput').clear().type(email);
    cy.get('#emailSubmitBtn').click();

    extractCodeFromLogs().then((code) => {
      code.split('').forEach((digit, idx) => {
        cy.get(`#code${idx + 1}`).type(digit);
      });
      cy.get('#codeSubmitBtn').click();

      cy.url({ timeout: 20000 }).should('include', 'patient-dashboard.html');
    });
  });

  it('Journey C – Patient sees appointment + payment CTA', () => {
    cy.visit('/unified-dashboard/patients/appointments.html');

    cy.contains(/Appointments/i).should('exist');

    cy.contains(/Pay now|Pay Now|Make Payment/).should('exist');
  });

  it('Journey D – Provider login from landing', () => {
    cy.visit('/');

    cy.contains("I'm a Provider").click();

    cy.url().should('include', '/unified-dashboard/login.html');

    cy.get('#loginEmail').type('provider@doclittle.com');
    cy.get('#loginPassword').type('demo123');
    cy.get('#loginBtn').click();

    cy.url({ timeout: 20000 }).should('include', '/unified-dashboard/business/business-dashboard.html');
  });

  it('Journey E – Provider signup entry', () => {
    cy.visit('/unified-dashboard/login.html');

    cy.contains('Create Account').click();

    cy.url().should('include', '/unified-dashboard/signup.html');

    cy.contains(/Tell us about your company/i).should('exist');
  });
});

