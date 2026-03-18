const db = require('../database');
const FHIRService = require('../services/fhir-service');

describe('FHIRService.mergePatients', () => {
  test('moves dependent rows and records merge event', () => {
    const suffix = String(Date.now());
    const primaryId = `patient-primary-${suffix}`;
    const secondaryId = `patient-secondary-${suffix}`;
    const apptId = `appt-merge-${suffix}`;
    const docId = `doc-merge-${suffix}`;

    db.db.prepare(`INSERT OR IGNORE INTO fhir_patients (resource_id, resource_data, is_deleted) VALUES (?, '{}', 0)`).run(primaryId);
    db.db.prepare(`INSERT OR IGNORE INTO fhir_patients (resource_id, resource_data, is_deleted) VALUES (?, '{}', 0)`).run(secondaryId);

    db.db.prepare(`INSERT INTO appointments (id, patient_id, patient_name, date, time, start_time, end_time, duration_minutes) VALUES (?, ?, 'Test', '2025-01-01', '10:00', '2025-01-01T10:00:00', '2025-01-01T11:00:00', 60)`).run(apptId, secondaryId);
    db.db.prepare(`INSERT INTO patient_documents (id, patient_id, file_name, file_type, storage_path) VALUES (?, ?, 'file.pdf', 'application/pdf', '/tmp/file.pdf')`).run(docId, secondaryId);

    FHIRService.mergePatients(primaryId, secondaryId, 'test');

    const appt = db.db.prepare(`SELECT patient_id FROM appointments WHERE id = ?`).get(apptId);
    const doc = db.db.prepare(`SELECT patient_id FROM patient_documents WHERE id = ?`).get(docId);
    const secondary = db.db.prepare(`SELECT is_deleted, merged_into FROM fhir_patients WHERE resource_id = ?`).get(secondaryId);
    const mergeEvents = db.getRecentPatientMergeEvents ? db.getRecentPatientMergeEvents(10) : [];

    expect(appt.patient_id).toBe(primaryId);
    expect(doc.patient_id).toBe(primaryId);
    expect(secondary.is_deleted).toBe(1);
    expect(secondary.merged_into).toBe(primaryId);
    expect(mergeEvents.find(e => e.primary_id === primaryId && e.secondary_id === secondaryId)).toBeDefined();
  });
});

