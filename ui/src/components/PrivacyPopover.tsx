/** "What's on-chain?" — persistent privacy legibility. */

import { useEffect, useRef, useState } from 'react';

export const PrivacyPopover = () => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="privacy-pop" ref={ref}>
      <button
        className="btn small ghost"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title="What does the chain learn?"
      >
        🛡 what's on-chain?
      </button>
      {open && (
        <div className="privacy-panel">
          <h4>
            <span className="onchain">Goes on-chain</span>
          </h4>
          <ul>
            <li>an anonymous nullifier (proves “someone entered once”)</li>
            <li>a sealed score commitment (reveals nothing about the score)</li>
            <li>only if you choose: the revealed score, or a badge tier</li>
          </ul>
          <h4>
            <span className="local">Never leaves this device</span>
          </h4>
          <ul>
            <li>your cuts and pieces (the solution)</li>
            <li>your score — until/unless you reveal it</li>
            <li>your secret key and commitment nonce</li>
          </ul>
          <p className="small-note">
            Every submission is a zero-knowledge proof that your hidden run is geometrically valid
            for today's board — verified by network consensus, not by a server.
          </p>
        </div>
      )}
    </div>
  );
};
