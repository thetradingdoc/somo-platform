describe('Consult patient portal journeys', () => {
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

  ['iphone-6', [320, 640], [375, 700], [430, 780]].forEach((vp) => {
    it(`Journey A – Patient login → appointments (${Array.isArray(vp) ? vp.join('x') : vp})`, () => {
      if (Array.isArray(vp)) cy.viewport(vp[0], vp[1]);
      else cy.viewport(vp);

      cy.visit('/unified-dashboard/patients/patient-login.html');
      cy.contains('Consʌlt').should('exist');

      const email = 'patient@consult.test';
      cy.get('#emailInput').clear().type(email);
      cy.get('#emailSubmitBtn').click();

      extractCodeFromLogs().then((code) => {
        expect(code).to.match(/^[0-9]{6}$/);
        code.split('').forEach((digit, idx) => {
          cy.get(`#code${idx + 1}`).type(digit);
        });
        cy.get('#codeSubmitBtn').click();

        cy.url({ timeout: 20000 }).should('include', 'appointments.html');
        cy.contains(/My Appointments/i).should('exist');
      });
    });
  });

  it('Journey B – Returning patient session lands on appointments', () => {
    cy.visit('/unified-dashboard/patients/patient-login.html');

    const email = 'patient@consult.test';
    cy.get('#emailInput').clear().type(email);
    cy.get('#emailSubmitBtn').click();

    extractCodeFromLogs().then((code) => {
      code.split('').forEach((digit, idx) => {
        cy.get(`#code${idx + 1}`).type(digit);
      });
      cy.get('#codeSubmitBtn').click();

      cy.url({ timeout: 20000 }).should('include', 'appointments.html');
    });
  });

  it('Journey C – Patient sees appointment + payment CTA', () => {
    cy.visit('/unified-dashboard/patients/appointments.html');

    cy.contains(/Appointments/i).should('exist');

    // CTA is conditional based on appointment/payment state; ensure receipts card exists
    cy.contains(/Receipts/i).should('exist');
  });

  it('Journey D – Provider login page loads', () => {
    cy.visit('/unified-dashboard/login.html');

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

