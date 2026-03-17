import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 10,
  duration: '1m'
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';

export default function () {
  const loginPage = http.get(`${BASE_URL}/unified-dashboard/patients/patient-login.html`);
  check(loginPage, { 'login page 200': (r) => r.status === 200 });

  const appointments = http.get(`${BASE_URL}/api/patient/appointments?session_id=dummy-session`, {
    headers: { 'ngrok-skip-browser-warning': 'true' }
  });
  check(appointments, { 'appointments not 5xx': (r) => r.status < 500 });

  sleep(1);
}

