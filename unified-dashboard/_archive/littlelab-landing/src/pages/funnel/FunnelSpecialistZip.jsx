import React, { useState } from 'react';

import { postFunnelMatch } from '../../lib/funnelApi';

import {

  getConfirmedAge,

  getFaceRead,

  getInquiry,

  setInquiry,

  setMatchResult,

  setZip,

} from '../../lib/funnelSession';



const MIN_INQUIRY_LEN = 8;



export default function FunnelSpecialistZip({ onSpecialist, onError, onBack }) {

  const initialInquiry = String(getInquiry() || '').trim();

  const [inquiry, setInquiryState] = useState(() => getInquiry());

  const [zip, setZipState] = useState('');

  const [loading, setLoading] = useState(false);

  const [editSymptoms, setEditSymptoms] = useState(initialInquiry.length < MIN_INQUIRY_LEN);



  const capturedInquiry = String(inquiry || '').trim();

  const hasCapturedInquiry = capturedInquiry.length >= MIN_INQUIRY_LEN;

  const showSymptomsField = editSymptoms || !hasCapturedInquiry;



  async function findSpecialists() {

    const z = String(zip || '').replace(/\D/g, '').slice(0, 5);

    if (z.length < 5) {

      onError?.('Enter a 5-digit US ZIP code.');

      return;

    }

    setLoading(true);

    onError?.('');

    try {

      const text = capturedInquiry;

      if (text) setInquiry(text);

      setZip(z);

      const match = await postFunnelMatch({

        inquiry: text,

        concern_chip: null,

        face_read: getFaceRead(),

        confirmed_age: getConfirmedAge(),

        zip: z,

        user_goal: 'find_specialist',

      });

      setMatchResult(match);

      if (match.route === 'specialist' || match.route === 'dual') {

        onSpecialist?.(match, z);

        return;

      }

      onError?.('Could not load specialists for this ZIP. Try again.');

    } catch (e) {

      onError?.(e.message || 'Could not continue');

    } finally {

      setLoading(false);

    }

  }



  const summary =

    capturedInquiry.length > 72 ? `${capturedInquiry.slice(0, 72)}…` : capturedInquiry;



  return (

    <div className="funnel-card funnel-card--age">

      <p className="funnel-preview-body">

        Enter your US 5-digit ZIP code to find dermatology specialists near you (NPPES directory).

      </p>

      <label htmlFor="funnel-spec-zip" className="funnel-age-field-label">

        US ZIP code

      </label>

      <input

        id="funnel-spec-zip"

        className="funnel-input funnel-input--zip"

        type="text"

        inputMode="numeric"

        maxLength={5}

        placeholder="10469"

        value={zip}

        onChange={(e) => setZipState(e.target.value.replace(/\D/g, '').slice(0, 5))}

      />



      {hasCapturedInquiry && !showSymptomsField ? (

        <p className="funnel-photo-honest">

          Searching with: {summary}{' '}

          <button

            type="button"

            className="funnel-btn-ghost"

            onClick={() => setEditSymptoms(true)}

          >

            Edit

          </button>

        </p>

      ) : null}



      {showSymptomsField ? (

        <>

          <label htmlFor="funnel-spec-symptoms" className="funnel-age-field-label funnel-zip-label">

            Symptoms <span className="funnel-optional">(optional)</span>

          </label>

          <textarea

            id="funnel-spec-symptoms"

            className="funnel-input funnel-input--inquiry"

            rows={2}

            placeholder="e.g. rash, acne"

            value={inquiry}

            onChange={(e) => setInquiryState(e.target.value)}

          />

        </>

      ) : null}



      <div className="funnel-card-actions funnel-card-actions--stacked">

        <button

          type="button"

          className="funnel-btn"

          disabled={loading || zip.length < 5}

          onClick={findSpecialists}

        >

          {loading ? 'Searching…' : 'Find specialists'}

        </button>

        {onBack ? (

          <button

            type="button"

            className="funnel-btn funnel-btn-secondary"

            disabled={loading}

            onClick={onBack}

          >

            Back

          </button>

        ) : null}

      </div>

    </div>

  );

}

