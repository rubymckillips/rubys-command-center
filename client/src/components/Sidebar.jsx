export const sections = [
  { id: 'today', label: 'Today' }, { id: 'academics', label: 'Academics' },
  { id: 'calendar', label: 'Calendar' }, { id: 'work', label: 'Work' },
  { id: 'projects', label: 'Projects' }, { id: 'job-applications', label: 'Job Applications' },
  { id: 'workouts', label: 'Workouts' }, { id: 'meals', label: 'Meals' },
];

export default function Sidebar({ currentSection, onSelect }) {
  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="brand-mark" aria-hidden="true">UC</div>
      <div className="sidebar-heading"><p className="sidebar-kicker">Personal workspace</p><h1>Command Center</h1></div>
      <nav className="section-nav" aria-label="Sections">
        {sections.map((section) => (
          <button className={currentSection === section.id ? 'section-link is-active' : 'section-link'} key={section.id} onClick={() => onSelect(section.id)} type="button" aria-current={currentSection === section.id ? 'page' : undefined}>
            <span className="section-dot" aria-hidden="true" />{section.label}
          </button>
        ))}
      </nav>
      <p className="sidebar-footer">A calm place for what matters next.</p>
    </aside>
  );
}
