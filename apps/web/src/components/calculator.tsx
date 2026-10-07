'use client';
import { useState } from 'react';
import { estimateCost } from '@core/contracts';
import { SmartLink } from './links';
const defaults = {
  students: 1000,
  annualFee: 60000,
  onTime: 70,
  delayDays: 60,
  capitalRate: 12,
  staffMonthly: 25000,
  staffShare: 50,
};
const money = (n: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
export function Calculator() {
  const [values, setValues] = useState(defaults);
  let result;
  try {
    result = estimateCost(values);
  } catch {}
  const inputs: [keyof typeof defaults, string, string, number, number][] = [
    ['students', 'Number of students', 'students', 1, 10000000],
    ['annualFee', 'Average annual fee', '₹ / student', 0, 10000000],
    ['onTime', 'Fees received on time', '%', 0, 100],
    ['delayDays', 'Average delay', 'days', 0, 365],
    ['capitalRate', 'Annual cost of capital', '%', 0, 100],
    ['staffMonthly', 'Monthly salary per collection staff member', '₹', 0, 1000000],
    ['staffShare', 'Staff time spent on collection', '%', 0, 100],
  ];
  return (
    <div className="calculator-grid">
      <form className="calculator-inputs" onSubmit={(e) => e.preventDefault()}>
        <h2>Your institute, in numbers.</h2>
        {inputs.map(([key, label, unit, min, max]) => (
          <label className="field" key={key}>
            <span>
              {label}
              <small>{unit}</small>
            </span>
            <input
              type="number"
              value={values[key]}
              min={min}
              max={max}
              step="1"
              onChange={(e) => setValues({ ...values, [key]: Number(e.target.value) })}
            />
          </label>
        ))}
        <button type="button" className="text-button" onClick={() => setValues(defaults)}>
          Reset example values
        </button>
      </form>
      <div className="calculator-result" aria-live="polite">
        <p className="eyebrow">Illustrative annual estimate</p>
        <h2>{result ? money(result.total) : 'Check the inputs'}</h2>
        <p>Estimated financing and administration cost</p>
        {result && (
          <dl>
            <div>
              <dt>Annual fees</dt>
              <dd>{money(result.annualFees)}</dd>
            </div>
            <div>
              <dt>Delayed amount</dt>
              <dd>{money(result.delayed)}</dd>
            </div>
            <div>
              <dt>Financing cost</dt>
              <dd>{money(result.financing)}</dd>
            </div>
            <div>
              <dt>Staff allocation</dt>
              <dd>{money(result.administration)}</dd>
            </div>
          </dl>
        )}
        <details>
          <summary>See the formula and assumptions</summary>
          <p>
            Financing = students × annual fee × late share × annual capital rate × delay days ÷ 365.
          </p>
          <p>
            Administration = round up(students ÷ 400) × 2 staff × monthly salary × 12 × staff-time
            share. Change the assumptions to fit your situation.
          </p>
          <p>
            These cost categories may overlap in your accounts. This estimate is not a quote,
            audited loss or guaranteed saving. Jodo’s undisclosed proprietary calculations are not
            reproduced.
          </p>
        </details>
        <SmartLink href="/contact-us/" className="button primary">
          Discuss your collection process
        </SmartLink>
        <p className="small">
          Calculated in your browser. Inputs are not sent to analytics or saved as leads.
        </p>
      </div>
    </div>
  );
}
