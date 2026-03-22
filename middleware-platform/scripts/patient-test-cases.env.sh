#!/bin/bash
# Patient test case definitions for run-patient-tests.sh
# Each case exports: CASE_ID, CASE_NAME, OPQRST vars, PATIENT_* vars, FIRST_MESSAGE, PREFERRED_SPECIALTY

# Case 1: Lower back pain → Orthopedics (baseline)
export_case_back_pain() {
  export CASE_ID="back_pain"
  export CASE_NAME="Lower back pain → Orthopedics"
  export PATIENT_NAME="John Doe"
  export PATIENT_EMAIL="johndoe@example.com"
  export PATIENT_PHONE="+15551234567"
  export OP_ONSET="3 days ago"
  export OP_PROVOCATION="worse when bending"
  export OP_QUALITY="dull ache"
  export OP_RADIATION="lower back only"
  export OP_SEVERITY="4"
  export OP_TIMING="comes and goes"
  export ASSOCIATED_SX="none else"
  export PREFERRED_SPECIALTY="Orthopedics"
  export FIRST_MESSAGE="I want to book a visit. I have lower back pain. Onset: $OP_ONSET. Provocation: $OP_PROVOCATION. Quality: $OP_QUALITY. Radiation: $OP_RADIATION. Severity: $OP_SEVERITY. Timing: $OP_TIMING. Associated: $ASSOCIATED_SX. No medications. No allergies. No known conditions. Alcohol: 0 drinks/week. Smoking: Non-smoker. Name: $PATIENT_NAME. Phone: $PATIENT_PHONE. Email: $PATIENT_EMAIL."
}

# Case 2: Rash → Dermatology (may trigger photo upload)
export_case_rash() {
  export CASE_ID="rash"
  export CASE_NAME="Itchy rash → Dermatology"
  export PATIENT_NAME="Maria Garcia"
  export PATIENT_EMAIL="maria.garcia@example.com"
  export PATIENT_PHONE="+15559876543"
  export OP_ONSET="1 week ago"
  export OP_PROVOCATION="worse with heat"
  export OP_QUALITY="itchy, red patches"
  export OP_RADIATION="arms and chest"
  export OP_SEVERITY="3"
  export OP_TIMING="constant itching"
  export ASSOCIATED_SX="no fever"
  export PREFERRED_SPECIALTY="Dermatology"
  export FIRST_MESSAGE="I need to see a doctor about a rash. Onset: $OP_ONSET. Provocation: $OP_PROVOCATION. Quality: $OP_QUALITY. Radiation: $OP_RADIATION. Severity: $OP_SEVERITY. Timing: $OP_TIMING. Associated: $ASSOCIATED_SX. No medications. No allergies. Name: $PATIENT_NAME. Phone: $PATIENT_PHONE. Email: $PATIENT_EMAIL."
}

# Case 3: Chest discomfort → Cardiology (higher acuity)
export_case_chest_discomfort() {
  export CASE_ID="chest_discomfort"
  export CASE_NAME="Chest tightness → Cardiology"
  export PATIENT_NAME="Robert Chen"
  export PATIENT_EMAIL="robert.chen@example.com"
  export PATIENT_PHONE="+15552223333"
  export OP_ONSET="2 days ago"
  export OP_PROVOCATION="with exertion"
  export OP_QUALITY="pressure, tightness"
  export OP_RADIATION="center of chest"
  export OP_SEVERITY="3"
  export OP_TIMING="comes and goes with activity"
  export ASSOCIATED_SX="no shortness of breath"
  export PREFERRED_SPECIALTY="Cardiology"
  export FIRST_MESSAGE="I have mild chest tightness when I exercise. Onset: $OP_ONSET. Provocation: $OP_PROVOCATION. Quality: $OP_QUALITY. Radiation: $OP_RADIATION. Severity: $OP_SEVERITY. Timing: $OP_TIMING. Associated: $ASSOCIATED_SX. No medications. No allergies. No known heart conditions. Name: $PATIENT_NAME. Phone: $PATIENT_PHONE. Email: $PATIENT_EMAIL."
}

# Case 4: Routine/annual visit → Primary Care
export_case_routine_visit() {
  export CASE_ID="routine_visit"
  export CASE_NAME="Annual physical → Primary Care"
  export PATIENT_NAME="Sarah Johnson"
  export PATIENT_EMAIL="sarah.j@example.com"
  export PATIENT_PHONE="+15554445555"
  export OP_ONSET="N/A"
  export OP_PROVOCATION="N/A"
  export OP_QUALITY="N/A"
  export OP_RADIATION="N/A"
  export OP_SEVERITY="N/A"
  export OP_TIMING="N/A"
  export ASSOCIATED_SX="N/A"
  export PREFERRED_SPECIALTY="Primary Care"
  export FIRST_MESSAGE="I'd like to schedule my annual physical. No current symptoms. Name: $PATIENT_NAME. Phone: $PATIENT_PHONE. Email: $PATIENT_EMAIL."
}

# Case 5: Headache → mixed routing (often Primary or Neuro)
export_case_headache() {
  export CASE_ID="headache"
  export CASE_NAME="Recurring headache"
  export PATIENT_NAME="David Kim"
  export PATIENT_EMAIL="david.kim@example.com"
  export PATIENT_PHONE="+15556667777"
  export OP_ONSET="2 weeks, off and on"
  export OP_PROVOCATION="stress, screen time"
  export OP_QUALITY="tension, pressure"
  export OP_RADIATION="both temples"
  export OP_SEVERITY="5"
  export OP_TIMING="comes and goes"
  export ASSOCIATED_SX="no vision changes"
  export PREFERRED_SPECIALTY="Primary Care"
  export FIRST_MESSAGE="I have recurring headaches. Onset: $OP_ONSET. Provocation: $OP_PROVOCATION. Quality: $OP_QUALITY. Radiation: $OP_RADIATION. Severity: $OP_SEVERITY. Timing: $OP_TIMING. Associated: $ASSOCIATED_SX. No medications. No allergies. Name: $PATIENT_NAME. Phone: $PATIENT_PHONE. Email: $PATIENT_EMAIL."
}

# Case 6: Knee pain → Orthopedics (different from back)
export_case_knee_pain() {
  export CASE_ID="knee_pain"
  export CASE_NAME="Knee pain post-injury → Orthopedics"
  export PATIENT_NAME="Emily Watson"
  export PATIENT_EMAIL="emily.w@example.com"
  export PATIENT_PHONE="+15558889999"
  export OP_ONSET="1 week ago after running"
  export OP_PROVOCATION="worse going downstairs"
  export OP_QUALITY="aching, occasional sharp"
  export OP_RADIATION="right knee only"
  export OP_SEVERITY="6"
  export OP_TIMING="constant, worse with use"
  export ASSOCIATED_SX="slight swelling"
  export PREFERRED_SPECIALTY="Orthopedics"
  export FIRST_MESSAGE="I hurt my knee while running. Onset: $OP_ONSET. Provocation: $OP_PROVOCATION. Quality: $OP_QUALITY. Radiation: $OP_RADIATION. Severity: $OP_SEVERITY. Timing: $OP_TIMING. Associated: $ASSOCIATED_SX. No medications. No allergies. Name: $PATIENT_NAME. Phone: $PATIENT_PHONE. Email: $PATIENT_EMAIL."
}

# Case 7: Minimal input (vague symptoms) - tests low-confidence path
export_case_vague_symptoms() {
  export CASE_ID="vague_symptoms"
  export CASE_NAME="Vague symptoms (low-confidence triage)"
  export PATIENT_NAME="Alex Turner"
  export PATIENT_EMAIL="alex.t@example.com"
  export PATIENT_PHONE="+15551112222"
  export OP_ONSET="a few days"
  export OP_PROVOCATION="not sure"
  export OP_QUALITY="just feel off"
  export OP_RADIATION="general"
  export OP_SEVERITY="3"
  export OP_TIMING="intermittent"
  export ASSOCIATED_SX="tired"
  export PREFERRED_SPECIALTY="Primary Care"
  export FIRST_MESSAGE="I haven't been feeling well for a few days. A bit tired, generally off. Name: $PATIENT_NAME. Phone: $PATIENT_PHONE. Email: $PATIENT_EMAIL."
}

# Case 8: Spanish-speaking patient (language detection)
export_case_spanish() {
  export CASE_ID="spanish"
  export CASE_NAME="Spanish-speaking patient"
  export PATIENT_NAME="Carlos Mendez"
  export PATIENT_EMAIL="carlos.m@example.com"
  export PATIENT_PHONE="+15553334444"
  export OP_ONSET="hace 3 días"
  export OP_PROVOCATION="peor al doblar"
  export OP_QUALITY="dolor sordo"
  export OP_RADIATION="espalda baja"
  export OP_SEVERITY="4"
  export OP_TIMING="va y viene"
  export ASSOCIATED_SX="nada más"
  export PREFERRED_SPECIALTY="Orthopedics"
  export FIRST_MESSAGE="Quiero agendar una cita. Tengo dolor de espalda baja. Inicio: $OP_ONSET. Provocación: $OP_PROVOCATION. Calidad: $OP_QUALITY. Radiación: $OP_RADIATION. Severidad: $OP_SEVERITY. Tiempo: $OP_TIMING. Sin medicamentos. Sin alergias. Nombre: $PATIENT_NAME. Teléfono: $PATIENT_PHONE. Email: $PATIENT_EMAIL."
}

# List of all case export function names
ALL_CASES="export_case_back_pain export_case_rash export_case_chest_discomfort export_case_routine_visit export_case_headache export_case_knee_pain export_case_vague_symptoms export_case_spanish"
