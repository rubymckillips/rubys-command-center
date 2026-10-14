import { useState } from 'react';

export default function ClassGroup({ className, children }) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <section className="class-group">
      <button className="class-group-toggle" type="button" onClick={() => setIsOpen((open) => !open)} aria-expanded={isOpen}>
        <span>{className}</span><span aria-hidden="true">{isOpen ? '−' : '+'}</span>
      </button>
      {isOpen && children}
    </section>
  );
}
