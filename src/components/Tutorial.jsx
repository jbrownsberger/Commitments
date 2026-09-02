/**
 * Tutorial.jsx — first-login welcome modal with feature slides.
 */
import React, { useState } from 'react';
import '../styles/tutorial.css';

const SLIDES = [
  {
    emoji: '👋',
    title: 'Welcome to Commitments!',
    body:  "Commitments helps you track every task and deadline, then turn them into a realistic weekly plan. Here's a quick tour to get you started.",
  },
  {
    emoji: '📂',
    title: 'Start with Categories',
    body:  'Create categories to organize your work — things like "Work", "Personal", or "Side Projects". Each category holds tasks and gets its own color in your plan.',
    tip:   'Tap the Categories tab → click "New category" to create your first one.',
  },
  {
    emoji: '✅',
    title: 'Add Tasks',
    body:  'Add tasks to your categories with due dates, estimated hours, priority, and substeps. Tasks can be one-off or recurring on any schedule.',
    tip:   'Press the "+ New task" button in the top-right to get started.',
  },
  {
    emoji: '📅',
    title: 'Plan Your Week (Premium)',
    body:  'The Planner tab shows all your pending tasks and lets you drag them onto the days you\'ll work on them. It\'s how to-do lists become actual plans.',
    tip:   'Premium feature — upgrade to unlock.',
  },
  {
    emoji: '🗓️',
    title: 'Sync with Google Calendar (Premium)',
    body:  'Connect Google Calendar to automatically block off your free time, and push scheduled work blocks directly to a calendar of your choice.',
    tip:   'Premium feature — upgrade to unlock.',
  },
  {
    emoji: '🚀',
    title: 'You\'re all set!',
    body:  'Your data is synced automatically and accessible from any device. Press "Get started" to jump in.',
  },
];

export default function Tutorial({ onClose }) {
  const [step, setStep] = useState(0);
  const slide     = SLIDES[step];
  const isFirst   = step === 0;
  const isLast    = step === SLIDES.length - 1;
  const progress  = ((step + 1) / SLIDES.length) * 100;

  return (
    <div className="tutorial-overlay" role="dialog" aria-modal="true" aria-label="Welcome tour">
      <div className="tutorial-modal">
        {/* Progress bar */}
        <div className="tutorial-progress" aria-hidden="true">
          <div className="tutorial-progress-fill" style={{ width: `${progress}%` }} />
        </div>

        {/* Step count */}
        <div className="tutorial-step-count">{step + 1} of {SLIDES.length}</div>

        {/* Content */}
        <div className="tutorial-body">
          <div className="tutorial-emoji" aria-hidden="true">{slide.emoji}</div>
          <h2 className="tutorial-title">{slide.title}</h2>
          <p className="tutorial-text">{slide.body}</p>
          {slide.tip && (
            <p className="tutorial-tip">💡 {slide.tip}</p>
          )}
        </div>

        {/* Navigation */}
        <div className="tutorial-footer">
          <button
            className="btn tutorial-skip"
            onClick={onClose}
          >
            Skip tour
          </button>

          <div className="tutorial-nav">
            {!isFirst && (
              <button
                className="btn tutorial-prev"
                onClick={() => setStep(s => s - 1)}
              >
                Back
              </button>
            )}
            <button
              className="btn btn-primary tutorial-next"
              onClick={() => isLast ? onClose() : setStep(s => s + 1)}
            >
              {isLast ? 'Get started' : 'Next'}
            </button>
          </div>
        </div>

        {/* Dot indicators */}
        <div className="tutorial-dots" aria-hidden="true">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              className={`tutorial-dot${i === step ? ' active' : ''}`}
              onClick={() => setStep(i)}
              tabIndex={-1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
