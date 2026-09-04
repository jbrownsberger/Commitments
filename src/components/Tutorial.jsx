/**
 * Tutorial.jsx — first-login welcome modal with feature slides and visual mockups.
 */
import React, { useState } from 'react';
import '../styles/tutorial.css';

const MockupUrgency = () => (
  <div className="tutorial-mockup">
    <div className="mock-focus-card">
      <div className="mock-fc-header">
        <span className="mock-fc-cat">Work</span>
        <span className="mock-fc-date">Due Today</span>
      </div>
      <div className="mock-fc-title">Finalize Q3 Report</div>
      <div className="mock-fc-footer">
        <div className="mock-fc-urgency hot">92</div>
        <div className="mock-fc-hint">Urgency Score</div>
      </div>
    </div>
  </div>
);

const MockupAutofill = () => (
  <div className="tutorial-mockup">
    <div className="mock-planner-header">
      <div className="mock-planner-tabs">
        <span className="mock-tab">Mon</span>
        <span className="mock-tab active">Tue</span>
        <span className="mock-tab">Wed</span>
      </div>
      <button className="mock-btn pulse">⚡ Auto-fill</button>
    </div>
    <div className="mock-planner-hint">Distributes tasks automatically across your week</div>
  </div>
);

const MockupCategory = () => (
  <div className="tutorial-mockup center">
    <div className="mock-cat-list">
      <div className="mock-cat-item" style={{'--c': '#e27b7b'}}>Personal</div>
      <div className="mock-cat-item" style={{'--c': '#529b63'}}>Deep Work</div>
      <div className="mock-cat-item" style={{'--c': '#4c73a1'}}>Admin</div>
      <button className="mock-btn">+ New category</button>
    </div>
  </div>
);

const SLIDES = [
  {
    emoji: '👋',
    title: 'Welcome to TaskTriage!',
    body:  "TaskTriage helps you track every task and deadline, then turn them into a realistic weekly plan. Here's a quick tour to get you started.",
    mockup: null,
  },
  {
    emoji: '📂',
    title: 'Step 1: Categories',
    body:  'Everything starts with Categories. Create them to organize your work (e.g. "Deep Work", "Personal", "Admin"). Each gets its own color.',
    tip:   'Go to the Categories tab and click "+ New category" to create your first one.',
    mockup: <MockupCategory />
  },
  {
    emoji: '🔥',
    title: 'The Urgency Score',
    body:  'On the Overview tab, tasks are automatically sorted by an Urgency Score (0-100). It calculates remaining time vs. due date so you always know what needs attention right now.',
    tip:   'Overdue tasks and close deadlines get red "hot" badges.',
    mockup: <MockupUrgency />
  },
  {
    emoji: '⚡',
    title: 'Magic Auto-fill (Premium)',
    body:  'In the Planner tab, instead of dragging tasks one by one, click the Auto-fill button. It uses your Urgency Scores and time estimates to instantly build a balanced schedule for the week.',
    tip:   'Look for the ⚡ Auto-fill button in the top right of the Planner.',
    mockup: <MockupAutofill />
  },
  {
    emoji: '🗓️',
    title: 'Google Calendar Sync (Premium)',
    body:  'Connect Google Calendar to automatically block off your busy times, and push your scheduled work blocks directly to a calendar of your choice.',
    mockup: null
  },
  {
    emoji: '🚀',
    title: "You're all set!",
    body:  'Your data is synced automatically and accessible from any device. Press "Get started" to jump in.',
    mockup: null
  },
];

export default function Tutorial({ onClose }) {
  const [step, setStep] = useState(0);
  const slide     = SLIDES[step];
  const isFirst   = step === 0;
  const isLast    = step === SLIDES.length - 1;
  const progress  = ((step + 1) / SLIDES.length) * 100;

  return (
    <div className="tutorial-overlay">
      <div className="tutorial-modal">
        <div className="tutorial-progress">
          <div className="tutorial-progress-bar" style={{ width: `${progress}%` }} />
        </div>

        <div className="tutorial-content">
          <div className="tutorial-icon">{slide.emoji}</div>
          <h2 className="tutorial-title">{slide.title}</h2>
          <p className="tutorial-body">{slide.body}</p>
          
          {slide.mockup && (
            <div className="tutorial-mockup-wrapper">
              {slide.mockup}
            </div>
          )}

          {slide.tip && (
            <div className="tutorial-tip">
              <strong>Tip:</strong> {slide.tip}
            </div>
          )}
        </div>

        <div className="tutorial-footer">
          <button
            className="btn btn-ghost"
            onClick={isFirst ? onClose : () => setStep(s => s - 1)}
          >
            {isFirst ? 'Skip tour' : 'Back'}
          </button>

          <div className="tutorial-dots">
            {SLIDES.map((_, i) => (
              <span key={i} className={`tutorial-dot ${i === step ? 'active' : ''}`} />
            ))}
          </div>

          <button
            className="btn btn-primary"
            onClick={isLast ? onClose : () => setStep(s => s + 1)}
          >
            {isLast ? 'Get started' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
